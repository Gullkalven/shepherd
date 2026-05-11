"""CRUD for project_workers (admin-managed PIN workers)."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core.config import should_run_demo_seed_logic
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.project_workers import Project_workers
from models.projects import Projects
from models.rooms import Rooms
from models.worker_tasks import WorkerTasks
from services.pin_hash import hash_pin, verify_pin
from services.pin_policy import validate_new_site_worker_pin

logger = logging.getLogger(__name__)


async def list_for_project(db: AsyncSession, *, project_id: int) -> List[Project_workers]:
    logger.debug("ProjectWorkers.list_for_project start project_id=%s", project_id)
    if not await _project_exists(db, project_id):
        logger.warning("ProjectWorkers.list_for_project missing_project project_id=%s", project_id)
        return []
    r = await db.execute(
        select(Project_workers).where(Project_workers.project_id == project_id).order_by(Project_workers.id.asc())
    )
    rows = list(r.scalars().all())
    logger.debug("ProjectWorkers.list_for_project done project_id=%s count=%s", project_id, len(rows))
    return rows


async def create_worker(
    db: AsyncSession,
    *,
    project_id: int,
    name: str,
    pin: str,
    role: str = "worker",
    active: bool = True,
) -> Optional[Project_workers]:
    logger.info("ProjectWorkers.create_worker start project_id=%s role=%s", project_id, role)
    if not await _project_exists(db, project_id):
        logger.warning("ProjectWorkers.create_worker missing_project project_id=%s", project_id)
        return None
    nm = (name or "").strip()
    if not nm:
        raise ValueError("name required")
    existing_worker = await db.execute(
        select(Project_workers).where(
            Project_workers.project_id == project_id,
            Project_workers.name == nm,
        )
    )
    if existing_worker.scalar_one_or_none() is not None:
        raise ValueError("A site worker with this name already exists in this project")
    pin = validate_new_site_worker_pin(pin or "")
    row = Project_workers(
        project_id=project_id,
        name=nm,
        pin_hash=hash_pin(pin),
        role=role if role in ("worker", "admin") else "worker",
        active=bool(active),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(row)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("ProjectWorkers.create_worker commit_failed project_id=%s name=%s", project_id, nm)
        raise
    await db.refresh(row)
    logger.info("ProjectWorkers.create_worker created project_id=%s worker_id=%s", project_id, row.id)
    return row


async def update_worker(
    db: AsyncSession,
    *,
    project_id: int,
    worker_id: int,
    name: Optional[str] = None,
    pin: Optional[str] = None,
    active: Optional[bool] = None,
    role: Optional[str] = None,
) -> Optional[Project_workers]:
    if not await _project_exists(db, project_id):
        return None
    r = await db.execute(
        select(Project_workers).where(
            Project_workers.id == worker_id,
            Project_workers.project_id == project_id,
        )
    )
    row = r.scalar_one_or_none()
    if not row:
        return None
    if name is not None:
        nm = name.strip()
        if nm:
            row.name = nm
    if pin is not None:
        p = pin.strip()
        if p:
            row.pin_hash = hash_pin(validate_new_site_worker_pin(p))
    if active is not None:
        row.active = bool(active)
    if role is not None and role in ("worker", "admin"):
        row.role = role
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    return row


async def verify_worker_login(
    db: AsyncSession, *, project_id: int, pin: str
) -> Optional[Project_workers]:
    """Find active worker for project matching PIN."""
    pin = (pin or "").strip()
    if not pin:
        return None
    r = await db.execute(
        select(Project_workers).where(
            Project_workers.project_id == project_id,
            Project_workers.active.is_(True),
        )
    )
    for row in r.scalars().all():
        if verify_pin(pin, getattr(row, "pin_hash", "") or ""):
            return row
    return None


async def get_worker_by_id(db: AsyncSession, worker_id: int, project_id: int) -> Optional[Project_workers]:
    if not await _project_exists(db, project_id):
        return None
    r = await db.execute(
        select(Project_workers).where(
            Project_workers.id == worker_id,
            Project_workers.project_id == project_id,
        )
    )
    return r.scalar_one_or_none()


async def worker_row_by_id(db: AsyncSession, worker_id: int) -> Optional[Project_workers]:
    r = await db.execute(select(Project_workers).where(Project_workers.id == worker_id))
    return r.scalar_one_or_none()


async def delete_worker(
    db: AsyncSession,
    *,
    project_id: int,
    worker_id: int,
) -> bool:
    """Delete a worker record while preserving historical text logs.

    Historical logs keep plain `worker_name` strings, so deleting the worker
    account does not break old activity rows.
    """
    if not await _project_exists(db, project_id):
        return False
    r = await db.execute(
        select(Project_workers).where(
            Project_workers.id == worker_id,
            Project_workers.project_id == project_id,
        )
    )
    row = r.scalar_one_or_none()
    if not row:
        return False
    try:
        # Remove assignment pointers in rooms so deleted workers do not remain on phase cards.
        rooms_res = await db.execute(select(Rooms).where(Rooms.project_id == project_id))
        rooms = rooms_res.scalars().all()
        for room in rooms:
            raw = getattr(room, "phase_assigned_worker_ids", None)
            if not isinstance(raw, dict):
                continue
            next_map: Dict[str, Any] = {}
            changed = False
            for k, v in raw.items():
                try:
                    wid = int(v)
                except (TypeError, ValueError):
                    next_map[str(k)] = v
                    continue
                if wid == worker_id:
                    changed = True
                    continue
                next_map[str(k)] = v
            if changed:
                room.phase_assigned_worker_ids = next_map or None

        # Remove explicit worker task assignments for this account.
        await db.execute(delete(WorkerTasks).where(WorkerTasks.worker_id == worker_id))

        await db.delete(row)
        await db.commit()
        logger.info("ProjectWorkers.delete_worker deleted project_id=%s worker_id=%s", project_id, worker_id)
        return True
    except Exception:
        await db.rollback()
        logger.exception(
            "ProjectWorkers.delete_worker failed project_id=%s worker_id=%s",
            project_id,
            worker_id,
        )
        # Fallback: soft-delete by deactivating and replacing PIN hash, keeping history intact.
        row.active = False
        row.pin_hash = hash_pin(f"deleted-{worker_id}-{datetime.now(timezone.utc).isoformat()}")
        row.name = f"{row.name} (deleted)"
        row.updated_at = datetime.now(timezone.utc)
        await db.commit()
        logger.warning(
            "ProjectWorkers.delete_worker fallback_soft_delete project_id=%s worker_id=%s",
            project_id,
            worker_id,
        )
        return True


async def _project_exists(db: AsyncSession, project_id: int) -> bool:
    pr = await db.execute(select(Projects).where(Projects.id == project_id))
    return pr.scalar_one_or_none() is not None


async def ensure_dev_seed_worker(db: AsyncSession) -> None:
    """Optional demo worker (PIN 123456) on first project when enabled."""
    if not should_run_demo_seed_logic():
        logger.info("Production mode detected: skipping dev worker seed logic.")
        return
    if os.environ.get("SHEPHERD_SEED_WORKER", "1").lower() in ("0", "false", "no"):
        return
    r = await db.execute(select(Project_workers).limit(1))
    if r.scalar_one_or_none() is not None:
        return
    pr = await db.execute(select(Projects).order_by(Projects.id.asc()).limit(1))
    proj = pr.scalar_one_or_none()
    if not proj:
        return
    pid = int(proj.id)
    row = Project_workers(
        project_id=pid,
        name="PIN dev worker",
        pin_hash=hash_pin("123456"),
        role="worker",
        active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(row)
    await db.commit()
    logger.info("Seeded demo project worker on project_id=%s (PIN 123456)", pid)


def public_worker_dict(row: Project_workers) -> Dict[str, Any]:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "name": row.name,
        "role": row.role,
        "active": bool(row.active),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
