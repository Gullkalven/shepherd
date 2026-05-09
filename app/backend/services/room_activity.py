"""Append-only room activity log stored on `Rooms.activity_log` (JSON array)."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.projects import Projects
from models.rooms import Rooms
from services.rooms import RoomsService

logger = logging.getLogger(__name__)


def _iso_utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _iso_utc_from_dt(value: Any) -> str:
    if not hasattr(value, "astimezone"):
        return _iso_utc_now()
    try:
        as_utc = value.astimezone(timezone.utc)
        return as_utc.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except Exception:
        return _iso_utc_now()


async def phase_display_label(db: AsyncSession, room: Rooms, phase_key: str) -> str:
    try:
        row = await db.execute(select(Projects).where(Projects.id == room.project_id))
        proj = row.scalar_one_or_none()
        raw = getattr(proj, "phase_workflow_json", None) if proj else None
        if raw and str(raw).strip():
            data = json.loads(raw)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and item.get("key") == phase_key:
                        lab = item.get("label")
                        if isinstance(lab, str) and lab.strip():
                            return lab.strip()
    except Exception as e:
        logger.warning("phase_display_label: %s", e)
    return phase_key


def actor_display(user: Any) -> str:
    if user is None:
        return "Someone"
    for attr in ("display_name", "full_name", "name", "email"):
        v = getattr(user, attr, None)
        if isinstance(v, str) and v.strip():
            return v.strip()
    uid = getattr(user, "id", None)
    return str(uid) if uid is not None else "Someone"


async def append_room_activity(
    db: AsyncSession,
    room_id: int,
    user_id: str,
    *,
    kind: str,
    actor: str,
    phase_key: str,
    phase_label: str,
    area_id: Optional[str] = None,
    item_name: Optional[str] = None,
    task_id: Optional[int] = None,
    photo_id: Optional[int] = None,
    at_iso: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    worker_project_id: Optional[int] = None,
) -> bool:
    """Persist one immutable activity row. Never call this to revise prior rows."""
    svc = RoomsService(db)
    room = await svc.get_by_id(room_id, user_id=user_id, worker_project_id=worker_project_id)
    if not room:
        return False
    raw = getattr(room, "activity_log", None)
    log: List[Dict[str, Any]] = list(raw) if isinstance(raw, list) else []
    ts = at_iso or _iso_utc_now()
    entry: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "at": ts,
        "kind": kind,
        "actor": (actor or "").strip() or "Someone",
        "phase_key": phase_key or "",
        "phase_label": phase_label or phase_key or "",
        "area_id": area_id,
        "item_name": item_name,
        "task_id": task_id,
        "photo_id": photo_id,
        "meta": meta if isinstance(meta, dict) else {},
    }
    log.append(entry)
    updated = await svc.update(
        room_id,
        {"activity_log": log},
        user_id=user_id,
        worker_project_id=worker_project_id,
    )
    return updated is not None


async def maybe_backfill_legacy_visits_photos(
    db: AsyncSession,
    room: Rooms,
    user_id: str,
) -> Optional[Rooms]:
    """One-time style import when `activity_log` is empty: copies visits and photos as historic rows."""
    raw = getattr(room, "activity_log", None)
    if isinstance(raw, list) and len(raw) > 0:
        return None
    try:
        from models.room_visits import Room_visits
        from models.room_photos import Room_photos
    except ImportError:
        return None

    svc = RoomsService(db)
    keys_wf = []
    try:
        from dependencies.phase_edit import workflow_keys_for_room

        keys_wf = await workflow_keys_for_room(db, room)
    except Exception:
        keys_wf = []

    log: List[Dict[str, Any]] = []

    vr = await db.execute(select(Room_visits).where(Room_visits.room_id == room.id))
    for v in vr.scalars().all():
        pk = getattr(v, "phase", None) or ""
        if isinstance(pk, str) and pk.strip():
            pk = pk.strip()
        else:
            pk = keys_wf[0] if keys_wf else ""
        label = await phase_display_label(db, room, pk)
        visited = getattr(v, "visited_at", None)
        ts = _iso_utc_from_dt(visited)
        aid = getattr(v, "area_id", None)
        if isinstance(aid, str):
            aid = aid.strip() or None
        else:
            aid = None
        wn = getattr(v, "worker_name", "") or "Someone"
        act = getattr(v, "action", None)
        tail = act.strip() if isinstance(act, str) and act.strip() else " visited the room"
        log.append(
            {
                "id": str(uuid.uuid4()),
                "at": ts,
                "kind": "legacy_visit",
                "actor": wn,
                "phase_key": pk,
                "phase_label": label,
                "area_id": aid,
                "item_name": None,
                "task_id": None,
                "photo_id": None,
                "meta": {"summary": tail, "visit_id": getattr(v, "id", None)},
            }
        )

    pr = await db.execute(select(Room_photos).where(Room_photos.room_id == room.id))
    for p in pr.scalars().all():
        pk = getattr(p, "phase", None) or ""
        if isinstance(pk, str) and pk.strip():
            pk = pk.strip()
        else:
            pk = keys_wf[0] if keys_wf else ""
        label = await phase_display_label(db, room, pk)
        created = getattr(p, "created_at", None)
        ts = _iso_utc_from_dt(created)
        aid = getattr(p, "area_id", None)
        if isinstance(aid, str):
            aid = aid.strip() or None
        else:
            aid = None
        fn = getattr(p, "filename", None)
        log.append(
            {
                "id": str(uuid.uuid4()),
                "at": ts,
                "kind": "legacy_photo",
                "actor": "System",
                "phase_key": pk,
                "phase_label": label,
                "area_id": aid,
                "item_name": None,
                "task_id": None,
                "photo_id": getattr(p, "id", None),
                "meta": {"filename": fn if isinstance(fn, str) else None},
            }
        )

    if not log:
        return None

    log.sort(key=lambda e: str(e.get("at") or ""))
    await svc.update(room.id, {"activity_log": log}, user_id=user_id)
    return await svc.get_by_id(room.id, user_id=user_id)


def _merge_bool_map(raw: Any) -> Dict[str, bool]:
    out: Dict[str, bool] = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            if isinstance(k, str) and isinstance(v, bool):
                out[k.strip()] = v
    return out


def _iso_deadline(v: Any) -> Optional[str]:
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except Exception:
            return str(v)
    return str(v)


async def append_room_patch_activity(
    db: AsyncSession,
    existing: Rooms,
    update_dict: Dict[str, Any],
    actor_user: Any,
    user_id: str,
    worker_project_id: Optional[int] = None,
) -> None:
    """Emit structured activity lines for supported room PATCH fields (best-effort)."""
    from dependencies.phase_edit import (
        heating_documentation_phase_key,
        normalize_room_phase,
        workflow_keys_for_room,
    )

    actor = actor_display(actor_user)
    rid = existing.id
    try:
        keys_wf = await workflow_keys_for_room(db, existing)
    except Exception:
        keys_wf = ["demontering", "varmekabel", "remontering", "sluttkontroll"]

    rp = normalize_room_phase(getattr(existing, "phase", None), keys_wf)
    phase_lab_default = await phase_display_label(db, existing, rp)

    if "status" in update_dict:
        old_s = getattr(existing, "status", None)
        new_s = update_dict.get("status")
        if old_s != new_s:
            await append_room_activity(
                db,
                rid,
                user_id,
                kind="status_changed",
                actor=actor,
                phase_key=rp,
                phase_label=phase_lab_default,
                meta={"from": old_s, "to": new_s},
                worker_project_id=worker_project_id,
            )

    if "deadline_at" in update_dict:
        old_d = _iso_deadline(getattr(existing, "deadline_at", None))
        new_d = _iso_deadline(update_dict.get("deadline_at"))
        if old_d != new_d:
            await append_room_activity(
                db,
                rid,
                user_id,
                kind="due_date_changed",
                actor=actor,
                phase_key=rp,
                phase_label=phase_lab_default,
                meta={"from": old_d, "to": new_d},
                worker_project_id=worker_project_id,
            )

    if "comment" in update_dict:
        old_c = (getattr(existing, "comment", None) or "").strip()
        nv = update_dict["comment"]
        new_c = "" if nv is None else str(nv).strip()
        if old_c != new_c:
            await append_room_activity(
                db,
                rid,
                user_id,
                kind="room_note_updated",
                actor=actor,
                phase_key=rp,
                phase_label=phase_lab_default,
                meta={"previous_len": len(old_c), "new_len": len(new_c)},
                worker_project_id=worker_project_id,
            )

    if "heating_cable_doc" in update_dict:
        try:
            hk = await heating_documentation_phase_key(db, existing, keys_wf)
            hlab = await phase_display_label(db, existing, hk)
        except Exception:
            hk, hlab = rp, phase_lab_default
        await append_room_activity(
            db,
            rid,
            user_id,
            kind="heating_cable_doc_saved",
            actor=actor,
            phase_key=hk,
            phase_label=hlab,
            meta={},
            worker_project_id=worker_project_id,
        )

    if "phase_statuses" in update_dict and isinstance(update_dict.get("phase_statuses"), dict):
        old_ps = getattr(existing, "phase_statuses", None)
        old_d = old_ps if isinstance(old_ps, dict) else {}
        new_d = update_dict["phase_statuses"]
        if isinstance(new_d, dict):
            for pk, nv in new_d.items():
                if not isinstance(pk, str):
                    continue
                ov = old_d.get(pk) if isinstance(old_d, dict) else None
                if ov != nv:
                    plab = await phase_display_label(db, existing, pk.strip())
                    await append_room_activity(
                        db,
                        rid,
                        user_id,
                        kind="phase_status_changed",
                        actor=actor,
                        phase_key=pk.strip(),
                        phase_label=plab,
                        meta={"from": ov, "to": nv},
                        worker_project_id=worker_project_id,
                    )

    if "phase_lock_overrides" in update_dict:
        old_o = _merge_bool_map(getattr(existing, "phase_lock_overrides", None))
        new_raw = update_dict.get("phase_lock_overrides")
        new_o = _merge_bool_map(new_raw) if isinstance(new_raw, dict) else old_o
        for pk in sorted(set(old_o) | set(new_o)):
            ov = old_o.get(pk)
            nv = new_o.get(pk)
            if ov == nv:
                continue
            plab = await phase_display_label(db, existing, pk)
            await append_room_activity(
                db,
                rid,
                user_id,
                kind="phase_lock_changed",
                actor=actor,
                phase_key=pk,
                phase_label=plab,
                meta={"from": ov, "to": nv},
                worker_project_id=worker_project_id,
            )

    if "workflow_deviations" in update_dict:
        import json

        def _deviation_dicts(raw: Any) -> List[Dict[str, Any]]:
            if not isinstance(raw, list):
                return []
            out: List[Dict[str, Any]] = []
            for x in raw:
                if isinstance(x, dict) and isinstance(x.get("id"), str):
                    out.append(x)
            return out

        old_devs = _deviation_dicts(getattr(existing, "workflow_deviations", None))
        new_devs = _deviation_dicts(update_dict.get("workflow_deviations"))
        old_map = {str(d["id"]): d for d in old_devs}
        new_map = {str(d["id"]): d for d in new_devs}
        all_ids = set(old_map.keys()) | set(new_map.keys())

        emit_generic = False
        for iid in all_ids:
            o = old_map.get(iid)
            n = new_map.get(iid)
            if (o is None) != (n is None):
                emit_generic = True
                break
            if o is None or n is None:
                continue
            keys_cmp = set(o.keys()) | set(n.keys())
            for k in keys_cmp:
                if k in ("status", "resolved_at", "resolved_by"):
                    continue
                if o.get(k) != n.get(k):
                    emit_generic = True
                    break
            if emit_generic:
                break

        if not emit_generic:
            for iid in all_ids:
                o = old_map.get(iid)
                n = new_map.get(iid)
                if not o or not n:
                    continue
                os_ = o.get("status")
                ns_ = n.get("status")
                if os_ == "resolved" and ns_ != "resolved":
                    emit_generic = True
                    break

        for iid in all_ids:
            o = old_map.get(iid)
            n = new_map.get(iid)
            if not o or not n:
                continue
            os_ = o.get("status")
            ns_ = n.get("status")
            if os_ == "resolved" or ns_ != "resolved":
                continue
            pk_raw = n.get("phase_key")
            pk = pk_raw.strip() if isinstance(pk_raw, str) and pk_raw.strip() else rp
            plab = await phase_display_label(db, existing, pk)
            txt = n.get("text")
            text_preview = (str(txt).strip()[:120]) if txt is not None else ""
            aid_raw = n.get("area_id")
            aid: Optional[str] = None
            if isinstance(aid_raw, str) and aid_raw.strip():
                aid = aid_raw.strip()
            await append_room_activity(
                db,
                rid,
                user_id,
                kind="issue_resolved",
                actor=actor,
                phase_key=pk,
                phase_label=plab,
                area_id=aid,
                meta={"issue_id": iid, "text_preview": text_preview},
                worker_project_id=worker_project_id,
            )

        old_w = json.dumps(getattr(existing, "workflow_deviations", None), sort_keys=True, default=str)
        new_w = json.dumps(update_dict.get("workflow_deviations"), sort_keys=True, default=str)
        if old_w != new_w and emit_generic:
            await append_room_activity(
                db,
                rid,
                user_id,
                kind="workflow_deviations_updated",
                actor=actor,
                phase_key=rp,
                phase_label=phase_lab_default,
                meta={},
                worker_project_id=worker_project_id,
            )

    if "checklist_labels" in update_dict:
        await append_room_activity(
            db,
            rid,
            user_id,
            kind="checklist_labels_updated",
            actor=actor,
            phase_key=rp,
            phase_label=phase_lab_default,
            meta={},
            worker_project_id=worker_project_id,
        )

    if "phase_tool_overrides" in update_dict:
        await append_room_activity(
            db,
            rid,
            user_id,
            kind="phase_tool_overrides_updated",
            actor=actor,
            phase_key=rp,
            phase_label=phase_lab_default,
            meta={},
            worker_project_id=worker_project_id,
        )
