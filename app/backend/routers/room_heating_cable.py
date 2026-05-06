import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from dependencies.roles import get_current_app_role, require_room_collaborator
from dependencies.room_lock import ensure_room_mutable
from dependencies.worker_scope import worker_project_scope
from schemas.auth import UserResponse
from services.rooms import RoomsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/rooms", tags=["room_heating_cable"])

HEATING_STEP_KEYS: List[str] = ["before_installation", "after_cable_laid", "after_screed_final"]
HEATING_CONFIRM_TEXT = "I confirm this step is completed"


class HeatingCableDraftPatch(BaseModel):
    resistance: Optional[str] = None
    insulation: Optional[str] = None
    performed_at: Optional[str] = None
    photos: Optional[List[str]] = None
    note: Optional[str] = None


class HeatingCableConfirmBody(BaseModel):
    completed_by: str


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
    await ensure_room_mutable(db, room_id, str(current_user.id), app_role, worker_project_scope(current_user))
    service = RoomsService(db)
    room = await service.get_by_id(
        room_id,
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    doc = _normalize_doc(getattr(room, "heating_cable_doc", None))
    _ensure_step_editable(doc, step_key)
    stage = _normalize_stage(doc.get(step_key))
    if body.resistance is not None:
        stage["resistance_ohm"] = str(body.resistance)
    if body.insulation is not None:
        stage["insulation_mohm"] = str(body.insulation)
    if body.performed_at is not None:
        stage["date"] = str(body.performed_at)
    if body.note is not None:
        stage["note"] = str(body.note)
    if body.photos is not None:
        photos = [str(x).strip() for x in body.photos if isinstance(x, str) and str(x).strip()]
        stage["photos"] = list(dict.fromkeys(photos))
        stage["images"] = stage["photos"]
    doc[step_key] = stage
    doc["updated_at"] = _iso_utc_now()

    updated = await service.update(
        room_id,
        {"heating_cable_doc": doc},
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"ok": True, "step_key": step_key, "heating_cable_doc": doc}


@router.post("/{room_id}/heating-cable/{step_key}/confirm")
async def confirm_heating_cable_step(
    room_id: int,
    step_key: str,
    body: HeatingCableConfirmBody,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    await ensure_room_mutable(db, room_id, str(current_user.id), app_role, worker_project_scope(current_user))
    service = RoomsService(db)
    room = await service.get_by_id(
        room_id,
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    completed_by = str(body.completed_by or "").strip()
    if not completed_by:
        raise HTTPException(status_code=400, detail="completed_by is required")
    if completed_by != str(current_user.id).strip():
        raise HTTPException(status_code=400, detail=f"Heating step '{step_key}' must store the current worker id as completed_by.")

    doc = _normalize_doc(getattr(room, "heating_cable_doc", None))
    _ensure_step_editable(doc, step_key)
    stage = _normalize_stage(doc.get(step_key))

    if not str(stage.get("resistance_ohm") or "").strip():
        raise HTTPException(status_code=400, detail="Resistance is required before confirmation.")
    if not str(stage.get("insulation_mohm") or "").strip():
        raise HTTPException(status_code=400, detail="Insulation is required before confirmation.")
    if not str(stage.get("date") or "").strip():
        raise HTTPException(status_code=400, detail="Performed/recorded date-time is required before confirmation.")
    if step_key == "after_cable_laid":
        photos = stage.get("photos")
        if not isinstance(photos, list) or not any(isinstance(x, str) and x.strip() for x in photos):
            raise HTTPException(status_code=400, detail="At least one photo is required for 'after_cable_laid'.")

    stage["step_status"] = "locked"
    stage["completed_by"] = completed_by
    stage["completed_by_user_id"] = completed_by
    stage["completed_by_name"] = (getattr(current_user, "name", None) or "").strip()
    stage["completed_at"] = _iso_utc_now()
    stage["confirmation_text"] = HEATING_CONFIRM_TEXT
    doc[step_key] = stage
    doc["updated_at"] = _iso_utc_now()

    updated = await service.update(
        room_id,
        {"heating_cable_doc": doc},
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"ok": True, "step_key": step_key, "heating_cable_doc": doc}
