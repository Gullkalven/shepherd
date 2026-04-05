"""Parse room.areas JSON and resolve per-area phase / lock overrides."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple



def _normalize_phase(phase: Optional[str], keys: List[str]) -> str:
    first = keys[0] if keys else "demontering"
    if not phase or not str(phase).strip():
        return first
    p = str(phase).strip()
    return p if p in keys else first


def norm_area_id(v: Optional[object]) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def parse_areas_list(raw: Any) -> Optional[List[Dict[str, Any]]]:
    if raw is None:
        return None
    if not isinstance(raw, list):
        return None
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        aid = item.get("id")
        name = item.get("name")
        if not isinstance(aid, str) or not aid.strip():
            continue
        if not isinstance(name, str) or not name.strip():
            continue
        out.append(
            {
                "id": aid.strip(),
                "name": name.strip(),
                "phase": item.get("phase"),
                "phase_lock_overrides": item.get("phase_lock_overrides"),
            }
        )
    return out if out else None


def _pick_area(areas: List[Dict[str, Any]], area_id: Optional[str]) -> Dict[str, Any]:
    if area_id and str(area_id).strip():
        sid = str(area_id).strip()
        for a in areas:
            if a["id"] == sid:
                return a
    return areas[0]


def room_phase_for_area(room: Any, area_id: Optional[str], keys: List[str]) -> Optional[str]:
    """Workflow position used when interpreting tasks/media for this area (empty task.phase, etc.)."""
    areas = parse_areas_list(getattr(room, "areas", None))
    if not areas:
        return getattr(room, "phase", None)
    a = _pick_area(areas, area_id)
    ph = a.get("phase")
    if ph is not None and str(ph).strip() != "":
        return str(ph).strip()
    if a is areas[0]:
        return getattr(room, "phase", None)
    return None


def phase_lock_overrides_for_area(room: Any, area_id: Optional[str]) -> Any:
    areas = parse_areas_list(getattr(room, "areas", None))
    if not areas:
        return getattr(room, "phase_lock_overrides", None)
    a = _pick_area(areas, area_id)
    ov = a.get("phase_lock_overrides")
    if isinstance(ov, dict):
        return ov
    if a is areas[0]:
        return getattr(room, "phase_lock_overrides", None)
    return {}


def worker_phase_context_for_area(
    room: Any, area_id: Optional[str], keys: List[str]
) -> Tuple[str, Any]:
    """(normalized room/area main phase, overrides) for worker lock checks."""
    rp = room_phase_for_area(room, area_id, keys)
    rn = _normalize_phase(rp, keys)
    ov = phase_lock_overrides_for_area(room, area_id)
    return (rn, ov)


def sanitize_areas_payload(raw: Any) -> Optional[List[Dict[str, Any]]]:
    """Validate API input for room.areas; returns None when client clears areas (legacy mode)."""
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ValueError("areas must be a JSON array or null")
    parsed = parse_areas_list(raw)
    if not parsed:
        raise ValueError("areas must contain at least one object with id and name")
    return parsed
