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

VALID_PHASE_STEP_STATUSES = frozenset({"not_started", "in_progress", "complete", "blocked"})

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


def derive_linear_phase_statuses(pointer: Optional[str], keys: List[str]) -> Dict[str, str]:
    """Legacy single-active-step model: one in_progress, earlier complete, later not_started."""
    rn = normalize_room_phase(pointer, keys)
    try:
        ri = keys.index(rn)
    except ValueError:
        ri = 0
    out: Dict[str, str] = {}
    for i, k in enumerate(keys):
        if i < ri:
            out[k] = "complete"
        elif i == ri:
            out[k] = "in_progress"
        else:
            out[k] = "not_started"
    return out


def merge_resolve_phase_statuses(raw: Any, legacy_pointer: Optional[str], keys: List[str]) -> Dict[str, str]:
    """Overlay persisted map on linear defaults from the legacy phase pointer."""
    base = derive_linear_phase_statuses(legacy_pointer, keys)
    if not isinstance(raw, dict):
        return base
    for k, v in raw.items():
        if k not in keys:
            continue
        if isinstance(v, str) and v.strip() in VALID_PHASE_STEP_STATUSES:
            base[k] = v.strip()
    return base


def primary_focus_phase(room_phase: Optional[str], phase_statuses_raw: Any, keys: List[str]) -> str:
    """First in-progress step in workflow order; falls back to normalized legacy pointer."""
    resolved = merge_resolve_phase_statuses(phase_statuses_raw, room_phase, keys)
    for k in keys:
        if resolved.get(k) == "in_progress":
            return k
    return normalize_room_phase(room_phase, keys)


def effective_task_phase(
    task_phase: Optional[str],
    room_phase: Optional[str],
    keys: List[str],
    phase_statuses_raw: Any = None,
) -> str:
    if task_phase is not None and str(task_phase).strip() != "":
        return normalize_room_phase(str(task_phase), keys)
    return primary_focus_phase(room_phase, phase_statuses_raw, keys)


def effective_media_phase(
    item_phase: Optional[str],
    room_phase: Optional[str],
    keys: List[str],
    phase_statuses_raw: Any = None,
) -> str:
    """Photos/visits with no phase follow the primary in-progress step when statuses exist."""
    if item_phase is not None and str(item_phase).strip() != "":
        return normalize_room_phase(str(item_phase), keys)
    return primary_focus_phase(room_phase, phase_statuses_raw, keys)


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
    phase_statuses_raw: Any = None,
) -> bool:
    """
    With phase_statuses: only steps marked in_progress are unlocked by default.
    Without phase_statuses (null): legacy rule — phases after the single board phase are locked.
    Overrides: { "phase_key": true } forces locked; { "phase_key": false } forces unlocked.
    """
    overrides = _coerce_overrides(overrides_raw)
    cn = normalize_room_phase(content_phase, keys)

    if phase_statuses_raw is not None:
        resolved = merge_resolve_phase_statuses(phase_statuses_raw, room_phase, keys)
        st = resolved.get(cn, "not_started")
        default_locked = st != "in_progress"
        o = overrides.get(cn)
        if o is True:
            return True
        if o is False:
            return False
        return default_locked

    rn = normalize_room_phase(room_phase, keys)
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
    phase_statuses_raw = getattr(room, "phase_statuses", None)
    if phase_tab_locked_for_worker(
        rn,
        content_phase,
        keys,
        ov,
        phase_statuses_raw,
    ):
        raise HTTPException(status_code=403, detail=PHASE_WORKER_LOCKED_DETAIL)
