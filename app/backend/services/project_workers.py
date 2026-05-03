"""CRUD for project_workers (admin-managed PIN workers)."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.project_workers import Project_workers
from models.projects import Projects
from services.pin_hash import hash_pin, verify_pin

logger = logging.getLogger(__name__)


async def list_for_project(db: AsyncSession, *, project_id: int, owner_user_id: str) -> List[Project_workers]:
    ok = await _project_owned_by(db, project_id, owner_user_id)
    if not ok:
        return []
    r = await db.execute(
        select(Project_workers).where(Project_workers.project_id == project_id).order_by(Project_workers.id.asc())
    )
    return list(r.scalars().all())


async def create_worker(
    db: AsyncSession,
    *,
    project_id: int,
    owner_user_id: str,
    name: str,
    pin: str,
    role: str = "worker",
) -> Optional[Project_workers]:
    if not await _project_owned_by(db, project_id, owner_user_id):
        return None
    nm = (name or "").strip()
    if not nm:
        raise ValueError("name required")
    pin = (pin or "").strip()
    if len(pin) < 4:
        raise ValueError("PIN must be at least 4 characters")
    row = Project_workers(
        project_id=project_id,
        name=nm,
        pin_hash=hash_pin(pin),
        role=role if role in ("worker", "admin") else "worker",
        active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_worker(
    db: AsyncSession,
    *,
    project_id: int,
    worker_id: int,
    owner_user_id: str,
    name: Optional[str] = None,
    pin: Optional[str] = None,
    active: Optional[bool] = None,
    role: Optional[str] = None,
) -> Optional[Project_workers]:
    if not await _project_owned_by(db, project_id, owner_user_id):
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
        if len(p) < 4:
            raise ValueError("PIN must be at least 4 characters")
        row.pin_hash = hash_pin(p)
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


async def get_worker_by_id(
    db: AsyncSession, worker_id: int, project_id: int, owner_user_id: str
) -> Optional[Project_workers]:
    if not await _project_owned_by(db, project_id, owner_user_id):
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


async def _project_owned_by(db: AsyncSession, project_id: int, user_id: str) -> bool:
    pr = await db.execute(select(Projects).where(Projects.id == project_id, Projects.user_id == user_id))
    return pr.scalar_one_or_none() is not None


async def ensure_dev_seed_worker(db: AsyncSession) -> None:
    """Optional demo worker (PIN 1234) on first project when enabled."""
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
        pin_hash=hash_pin("1234"),
        role="worker",
        active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(row)
    await db.commit()
    logger.info("Seeded demo project worker on project_id=%s (PIN 1234)", pid)


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
