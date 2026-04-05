"""Rules for whether workers may edit checklist/media for a given workflow phase."""

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.roles import ROLE_ADMIN
from models.projects import Projects
from models.rooms import Rooms
from services.rooms import RoomsService
from dependencies.room_areas import worker_phase_context_for_area

logger = logging.getLogger(__name__)

DEFAULT_PHASE_KEYS: List[str] = ["demontering", "varmekabel", "remontering", "sluttkontroll"]

PHASE_WORKER_LOCKED_DETAIL = (
    "This phase is locked for workers. Only an admin can change data for this stage."
)


def _parse_workflow_keys(raw: Optional[str]) -> Optional[List[str]]:
    if not raw or not str(raw).strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    keys: List[str] = []
    for item in data:
        if isinstance(item, dict):
            k = item.get("key")
            if isinstance(k, str) and k.strip():
                keys.append(k.strip())
    return keys if keys else None


async def workflow_keys_for_room(db: AsyncSession, room: Rooms) -> List[str]:
    try:
        row = await db.execute(select(Projects).where(Projects.id == room.project_id))
        proj = row.scalar_one_or_none()
        raw = getattr(proj, "phase_workflow_json", None) if proj else None
        parsed = _parse_workflow_keys(raw if isinstance(raw, str) else None)
        if parsed:
            return parsed
    except Exception as e:
        logger.warning("workflow_keys_for_room: %s", e)
    return list(DEFAULT_PHASE_KEYS)


def normalize_room_phase(phase: Optional[str], keys: List[str]) -> str:
    first = keys[0] if keys else "demontering"
    if not phase or not str(phase).strip():
        return first
    p = str(phase).strip()
    return p if p in keys else first


def effective_task_phase(task_phase: Optional[str], room_phase: Optional[str], keys: List[str]) -> str:
    if task_phase is not None and str(task_phase).strip() != "":
        return normalize_room_phase(str(task_phase), keys)
    return normalize_room_phase(room_phase, keys)


def effective_media_phase(item_phase: Optional[str], room_phase: Optional[str], keys: List[str]) -> str:
    """Photos/visits with no phase follow the room's current phase for edit rules."""
    if item_phase is not None and str(item_phase).strip() != "":
        return normalize_room_phase(str(item_phase), keys)
    return normalize_room_phase(room_phase, keys)


def _coerce_overrides(raw: Any) -> Dict[str, bool]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        out: Dict[str, bool] = {}
        for k, v in raw.items():
            if not isinstance(k, str):
                continue
            if isinstance(v, bool):
                out[k.strip()] = v
        return out
    return {}


def phase_tab_locked_for_worker(
    room_phase: Optional[str],
    content_phase: str,
    keys: List[str],
    overrides_raw: Any,
) -> bool:
    """
    Default: phases strictly after the room's current phase are locked for workers.
    Overrides: { "phase_key": true } forces locked; { "phase_key": false } forces unlocked
    (e.g. allow work ahead, or keep an older phase open after admin locked it).
    """
    overrides = _coerce_overrides(overrides_raw)
    rn = normalize_room_phase(room_phase, keys)
    cn = normalize_room_phase(content_phase, keys)
    try:
        ri = keys.index(rn)
    except ValueError:
        ri = 0
    try:
        ci = keys.index(cn)
    except ValueError:
        ci = 0
    default_locked = ci > ri
    o = overrides.get(cn)
    if o is True:
        return True
    if o is False:
        return False
    return default_locked


async def ensure_room_phase_editable_for_worker(
    db: AsyncSession,
    room_id: int,
    user_id: str,
    app_role: str,
    content_phase: str,
    area_id: Optional[str] = None,
) -> None:
    if app_role == ROLE_ADMIN:
        return
    service = RoomsService(db)
    room = await service.get_by_id(room_id, user_id=user_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    keys = await workflow_keys_for_room(db, room)
    rn, ov = worker_phase_context_for_area(room, area_id, keys)
    if phase_tab_locked_for_worker(
        rn,
        content_phase,
        keys,
        ov,
    ):
        raise HTTPException(status_code=403, detail=PHASE_WORKER_LOCKED_DETAIL)
