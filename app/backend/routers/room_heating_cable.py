import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from dependencies.phase_edit import heating_documentation_phase_key, workflow_keys_for_room
from dependencies.roles import ROLE_ADMIN, get_current_app_role, require_room_collaborator
from dependencies.room_lock import ensure_room_mutable
from dependencies.worker_scope import worker_project_scope
from models.project_workers import Project_workers
from schemas.auth import UserResponse
from services.room_activity import actor_display, append_room_activity, phase_display_label
from services.rooms import RoomsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/rooms", tags=["room_heating_cable"])
entities_router = APIRouter(prefix="/api/v1/entities/rooms", tags=["room_heating_cable"])
admin_router = entities_router

HEATING_STEP_KEYS: List[str] = ["before_installation", "after_cable_laid", "after_screed_final"]

_HEATING_STAGE_LABELS: Dict[str, str] = {
    "before_installation": "Before installation",
    "after_cable_laid": "After cable laid",
    "after_screed_final": "After screed / final",
}


async def _heating_activity_workflow_phase(db: AsyncSession, room: Any) -> Tuple[str, str]:
    keys_wf = await workflow_keys_for_room(db, room)
    hk = await heating_documentation_phase_key(db, room, keys_wf)
    hlab = await phase_display_label(db, room, hk)
    return hk, hlab


def _sorted_photo_tuple(stage: Dict[str, Any]) -> Tuple[str, ...]:
    photos = stage.get("photos")
    if not isinstance(photos, list):
        return tuple()
    items = [str(x).strip() for x in photos if isinstance(x, str) and str(x).strip()]
    return tuple(sorted(items))


def _measurement_signature(stage: Dict[str, Any]) -> Tuple[str, str, str]:
    return (
        str(stage.get("resistance_ohm") or "").strip(),
        str(stage.get("insulation_mohm") or "").strip(),
        str(stage.get("date") or "").strip(),
    )


async def _append_heating_step_patch_activity(
    db: AsyncSession,
    room: Any,
    room_id: int,
    user_id: str,
    step_key: str,
    old_stage: Dict[str, Any],
    new_stage: Dict[str, Any],
    worker_project_id: Optional[int],
    actor: str,
    at_iso: str,
) -> None:
    hk, hlab = await _heating_activity_workflow_phase(db, room)
    stage_label = _HEATING_STAGE_LABELS.get(step_key, step_key)
    base_meta = {"stage_key": step_key, "stage_label": stage_label}

    if _measurement_signature(old_stage) != _measurement_signature(new_stage):
        await append_room_activity(
            db,
            room_id,
            user_id,
            kind="heating_cable_measurements_updated",
            actor=actor,
            phase_key=hk,
            phase_label=hlab,
            at_iso=at_iso,
            meta={
                **base_meta,
                "resistance_ohm": str(new_stage.get("resistance_ohm") or "").strip(),
                "insulation_mohm": str(new_stage.get("insulation_mohm") or "").strip(),
            },
            worker_project_id=worker_project_id,
        )

    old_note = str(old_stage.get("note") or "").strip()
    new_note = str(new_stage.get("note") or "").strip()
    if old_note != new_note:
        await append_room_activity(
            db,
            room_id,
            user_id,
            kind="heating_cable_note_updated",
            actor=actor,
            phase_key=hk,
            phase_label=hlab,
            at_iso=at_iso,
            meta={**base_meta},
            worker_project_id=worker_project_id,
        )

    if _sorted_photo_tuple(old_stage) != _sorted_photo_tuple(new_stage):
        photos = new_stage.get("photos")
        n = len([x for x in photos if isinstance(x, str) and str(x).strip()]) if isinstance(photos, list) else 0
        await append_room_activity(
            db,
            room_id,
            user_id,
            kind="heating_cable_stage_photos_updated",
            actor=actor,
            phase_key=hk,
            phase_label=hlab,
            at_iso=at_iso,
            meta={**base_meta, "photo_count": n},
            worker_project_id=worker_project_id,
        )


async def _append_heating_extra_steps_activity_if_changed(
    db: AsyncSession,
    room: Any,
    room_id: int,
    user_id: str,
    old_doc: Dict[str, Any],
    new_doc: Dict[str, Any],
    worker_project_id: Optional[int],
    actor: str,
    at_iso: str,
) -> None:
    old_ex = old_doc.get("extra_steps")
    new_ex = new_doc.get("extra_steps")
    if json.dumps(old_ex, sort_keys=True, default=str) == json.dumps(new_ex, sort_keys=True, default=str):
        return
    hk, hlab = await _heating_activity_workflow_phase(db, room)
    await append_room_activity(
        db,
        room_id,
        user_id,
        kind="heating_cable_extra_steps_updated",
        actor=actor,
        phase_key=hk,
        phase_label=hlab,
        at_iso=at_iso,
        meta={},
        worker_project_id=worker_project_id,
    )


class HeatingCableDraftPatch(BaseModel):
    resistance: Optional[str] = None
    insulation: Optional[str] = None
    performed_at: Optional[str] = None
    recorded_at: Optional[str] = None
    photos: Optional[List[str]] = None
    note: Optional[str] = None
    extra_steps: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="When set, replaces extra_steps on the stored heating cable document.",
    )


class HeatingCableConfirmBody(BaseModel):
    """Confirm body is intentionally empty: actor identity is derived from the session."""

    pass


class HeatingCableExtraStepsPatch(BaseModel):
    extra_steps: List[Dict[str, Any]] = Field(default_factory=list)


@dataclass
class _ConfirmActor:
    canonical_id: str
    user_id: str
    worker_id: Optional[int]
    name: str
    is_worker: bool


def _iso_utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _normalize_stage(raw: Any) -> Dict[str, Any]:
    row = raw if isinstance(raw, dict) else {}
    out = dict(row)
    photos: List[str] = []
    for key in ("photos", "images"):
        val = out.get(key)
        if isinstance(val, list):
            for item in val:
                if isinstance(item, str) and item.strip():
                    photos.append(item.strip())
    deduped = list(dict.fromkeys(photos))
    out["photos"] = deduped
    out["images"] = deduped
    return out


def _normalize_doc(raw: Any) -> Dict[str, Any]:
    doc = raw if isinstance(raw, dict) else {}
    out = dict(doc)
    for key in HEATING_STEP_KEYS:
        out[key] = _normalize_stage(out.get(key))
    return out


def _step_index(step_key: str) -> int:
    if step_key not in HEATING_STEP_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid heating step '{step_key}'")
    return HEATING_STEP_KEYS.index(step_key)


async def _resolve_confirm_actor(
    db: AsyncSession, current_user: UserResponse, app_role: str, room_project_id: Optional[int]
) -> _ConfirmActor:
    """Authoritative actor for confirming a heating step.

    Workers must have a valid `Project_workers` row scoped to the room's project. Admins
    are allowed to confirm too (e.g. correcting documentation) and are stamped with their
    own user id.
    """
    user_id = (str(current_user.id) if current_user.id is not None else "").strip()

    if getattr(current_user, "is_worker_session", False):
        wid_raw = getattr(current_user, "worker_id", None)
        try:
            worker_id = int(wid_raw) if wid_raw is not None else None
        except (TypeError, ValueError):
            worker_id = None
        if not worker_id:
            raise HTTPException(
                status_code=401,
                detail="You must be logged in as a Site Worker to confirm this step.",
            )
        result = await db.execute(select(Project_workers).where(Project_workers.id == worker_id))
        worker = result.scalar_one_or_none()
        if not worker or not bool(worker.active):
            raise HTTPException(
                status_code=401,
                detail="You must be logged in as a Site Worker to confirm this step.",
            )
        session_pid = getattr(current_user, "worker_project_id", None)
        if session_pid is not None and int(worker.project_id) != int(session_pid):
            raise HTTPException(status_code=403, detail="Site Worker does not belong to this project.")
        if room_project_id is not None and int(worker.project_id) != int(room_project_id):
            raise HTTPException(status_code=403, detail="Site Worker does not belong to this project.")
        worker_name = (worker.name or getattr(current_user, "name", None) or "").strip()
        return _ConfirmActor(
            canonical_id=f"worker:{worker_id}",
            user_id=user_id,
            worker_id=worker_id,
            name=worker_name,
            is_worker=True,
        )

    if app_role == ROLE_ADMIN:
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required to confirm this step.")
        admin_name = (getattr(current_user, "name", None) or "").strip()
        return _ConfirmActor(
            canonical_id=user_id,
            user_id=user_id,
            worker_id=None,
            name=admin_name,
            is_worker=False,
        )

    raise HTTPException(
        status_code=401,
        detail="You must be logged in as a Site Worker to confirm this step.",
    )


def _ensure_step_editable(doc: Dict[str, Any], step_key: str) -> None:
    idx = _step_index(step_key)
    stage = _normalize_stage(doc.get(step_key))
    if stage.get("step_status") == "locked":
        raise HTTPException(status_code=400, detail=f"Heating step '{step_key}' is already completed.")
    if idx > 0:
        prev_key = HEATING_STEP_KEYS[idx - 1]
        prev = _normalize_stage(doc.get(prev_key))
        if prev.get("step_status") != "locked":
            raise HTTPException(status_code=400, detail=f"Heating step '{step_key}' is locked until '{prev_key}' is completed.")


async def _patch_heating_cable_step_impl(
    room_id: int,
    step_key: str,
    body: HeatingCableDraftPatch,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    logger.info("HEATING CABLE PATCH ROUTE HIT room_id=%s step_key=%s", room_id, step_key)
    await ensure_room_mutable(db, room_id, str(current_user.id), app_role, worker_project_scope(current_user))
    service = RoomsService(db)
    room = await service.get_by_id(
        room_id,
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    doc_before = _normalize_doc(getattr(room, "heating_cable_doc", None))
    old_stage = _normalize_stage(doc_before.get(step_key))

    doc = dict(doc_before)
    _ensure_step_editable(doc, step_key)
    stage = _normalize_stage(doc.get(step_key))
    if body.resistance is not None:
        stage["resistance_ohm"] = str(body.resistance)
    if body.insulation is not None:
        stage["insulation_mohm"] = str(body.insulation)
    performed_value = body.performed_at if body.performed_at is not None else body.recorded_at
    if performed_value is not None:
        stage["date"] = str(performed_value)
    if body.note is not None:
        stage["note"] = str(body.note)
    if body.photos is not None:
        photos = [str(x).strip() for x in body.photos if isinstance(x, str) and str(x).strip()]
        stage["photos"] = list(dict.fromkeys(photos))
        stage["images"] = stage["photos"]
    doc[step_key] = stage
    if body.extra_steps is not None:
        doc["extra_steps"] = [_normalize_stage(x) for x in body.extra_steps if isinstance(x, dict)]
    doc["updated_at"] = _iso_utc_now()

    new_stage = _normalize_stage(doc.get(step_key))
    at_iso = doc["updated_at"]
    user_id = str(current_user.id)
    actor = actor_display(current_user)
    wpid = worker_project_scope(current_user)

    updated = await service.update(
        room_id,
        {"heating_cable_doc": doc},
        user_id=user_id,
        worker_project_id=wpid,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Room not found")

    await _append_heating_step_patch_activity(
        db, room, room_id, user_id, step_key, old_stage, new_stage, wpid, actor, at_iso
    )
    if body.extra_steps is not None:
        await _append_heating_extra_steps_activity_if_changed(
            db, room, room_id, user_id, doc_before, doc, wpid, actor, at_iso
        )

    return {"ok": True, "step_key": step_key, "heating_cable_doc": doc}


async def _patch_heating_cable_extra_steps_impl(
    room_id: int,
    body: HeatingCableExtraStepsPatch,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Persist optional measurement rows after the final main stage is locked."""
    logger.info("HEATING CABLE EXTRA STEPS PATCH room_id=%s", room_id)
    await ensure_room_mutable(db, room_id, str(current_user.id), app_role, worker_project_scope(current_user))
    service = RoomsService(db)
    room = await service.get_by_id(
        room_id,
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    doc_before = _normalize_doc(getattr(room, "heating_cable_doc", None))
    doc = dict(doc_before)
    final = _normalize_stage(doc.get("after_screed_final"))
    if final.get("step_status") != "locked":
        raise HTTPException(
            status_code=400,
            detail="Extra heating cable steps are only available after the final main stage is completed.",
        )
    doc["extra_steps"] = [_normalize_stage(x) for x in body.extra_steps if isinstance(x, dict)]
    doc["updated_at"] = _iso_utc_now()

    at_iso = doc["updated_at"]
    user_id = str(current_user.id)
    actor = actor_display(current_user)
    wpid = worker_project_scope(current_user)

    updated = await service.update(
        room_id,
        {"heating_cable_doc": doc},
        user_id=user_id,
        worker_project_id=wpid,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Room not found")

    await _append_heating_extra_steps_activity_if_changed(
        db, room, room_id, user_id, doc_before, doc, wpid, actor, at_iso
    )

    return {"ok": True, "heating_cable_doc": doc}


async def _confirm_heating_cable_step_impl(
    room_id: int,
    step_key: str,
    body: Optional[HeatingCableConfirmBody] = None,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    logger.info("HEATING CABLE CONFIRM ROUTE HIT room_id=%s step_key=%s", room_id, step_key)
    await ensure_room_mutable(db, room_id, str(current_user.id), app_role, worker_project_scope(current_user))
    service = RoomsService(db)
    room = await service.get_by_id(
        room_id,
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    actor = await _resolve_confirm_actor(
        db, current_user, app_role, getattr(room, "project_id", None)
    )

    doc = _normalize_doc(getattr(room, "heating_cable_doc", None))
    _ensure_step_editable(doc, step_key)
    stage = _normalize_stage(doc.get(step_key))

    if not str(stage.get("resistance_ohm") or "").strip():
        raise HTTPException(status_code=400, detail="Resistance is required before confirmation.")
    if not str(stage.get("insulation_mohm") or "").strip():
        raise HTTPException(status_code=400, detail="Insulation is required before confirmation.")
    if step_key == "after_cable_laid":
        photos = stage.get("photos")
        if not isinstance(photos, list) or not any(isinstance(x, str) and x.strip() for x in photos):
            raise HTTPException(status_code=400, detail="At least one photo is required for 'after_cable_laid'.")

    now_iso = _iso_utc_now()
    actor_display_name = actor.name or actor.canonical_id
    # Worker flow is auto-stamped on confirm; the server is the sole source of truth for who/when.
    stage["date"] = now_iso
    stage["performed_at"] = now_iso
    stage["performed_by"] = actor_display_name
    stage["step_status"] = "locked"
    stage["completed_by"] = actor.canonical_id
    stage["completed_by_user_id"] = actor.user_id
    stage["completed_by_worker_id"] = actor.worker_id
    stage["completed_by_name"] = actor.name
    stage["completed_at"] = now_iso
    stage["confirmed_by"] = actor.canonical_id
    stage["confirmed_by_user_id"] = actor.user_id
    stage["confirmed_by_worker_id"] = actor.worker_id
    stage["confirmed_by_name"] = actor.name
    stage["confirmed_at"] = now_iso
    doc[step_key] = stage
    doc["updated_at"] = _iso_utc_now()

    user_id = str(current_user.id)
    wpid = worker_project_scope(current_user)

    updated = await service.update(
        room_id,
        {"heating_cable_doc": doc},
        user_id=user_id,
        worker_project_id=wpid,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Room not found")

    hk, hlab = await _heating_activity_workflow_phase(db, room)
    stage_label = _HEATING_STAGE_LABELS.get(step_key, step_key)
    await append_room_activity(
        db,
        room_id,
        user_id,
        kind="heating_cable_step_completed",
        actor=actor_display_name,
        phase_key=hk,
        phase_label=hlab,
        at_iso=now_iso,
        meta={"stage_key": step_key, "stage_label": stage_label},
        worker_project_id=wpid,
    )

    return {"ok": True, "step_key": step_key, "heating_cable_doc": doc}


@router.patch("/{room_id}/heating-cable/extra-steps")
async def patch_heating_cable_extra_steps(
    room_id: int,
    body: HeatingCableExtraStepsPatch,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    return await _patch_heating_cable_extra_steps_impl(room_id, body, current_user, _role, app_role, db)


@entities_router.patch("/{room_id}/heating-cable/extra-steps")
async def patch_heating_cable_extra_steps_entities(
    room_id: int,
    body: HeatingCableExtraStepsPatch,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    return await _patch_heating_cable_extra_steps_impl(room_id, body, current_user, _role, app_role, db)


@router.patch("/{room_id}/heating-cable/{step_key}")
async def patch_heating_cable_step(
    room_id: int,
    step_key: str,
    body: HeatingCableDraftPatch,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    return await _patch_heating_cable_step_impl(room_id, step_key, body, current_user, _role, app_role, db)


@entities_router.patch("/{room_id}/heating-cable/{step_key}")
async def patch_heating_cable_step_entities(
    room_id: int,
    step_key: str,
    body: HeatingCableDraftPatch,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    return await _patch_heating_cable_step_impl(room_id, step_key, body, current_user, _role, app_role, db)


@router.post("/{room_id}/heating-cable/{step_key}/confirm")
async def confirm_heating_cable_step(
    room_id: int,
    step_key: str,
    body: Optional[HeatingCableConfirmBody] = None,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    return await _confirm_heating_cable_step_impl(room_id, step_key, body, current_user, _role, app_role, db)


@entities_router.post("/{room_id}/heating-cable/{step_key}/confirm")
async def confirm_heating_cable_step_entities(
    room_id: int,
    step_key: str,
    body: Optional[HeatingCableConfirmBody] = None,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    return await _confirm_heating_cable_step_impl(room_id, step_key, body, current_user, _role, app_role, db)
