"""Bootstrap and verify provisional admin PIN stored hashed in DB (env seeds initial hash)."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.provisional_admin_settings import Provisional_admin_settings
from services.pin_hash import hash_pin, verify_pin

logger = logging.getLogger(__name__)

ENV_PIN_KEY = "SHEPHERD_PROVISIONAL_ADMIN_PIN"


async def get_settings_row(db: AsyncSession) -> Optional[Provisional_admin_settings]:
    r = await db.execute(select(Provisional_admin_settings).where(Provisional_admin_settings.id == 1))
    return r.scalar_one_or_none()


async def ensure_seed_from_env(db: AsyncSession) -> None:
    """If DB has no PIN hash and env provides plaintext PIN, hash and store (one-time bootstrap)."""
    raw = os.getenv(ENV_PIN_KEY)
    if not raw or not str(raw).strip():
        return
    row = await get_settings_row(db)
    if row is None:
        row = Provisional_admin_settings(id=1, pin_hash=None, updated_at=None)
        db.add(row)
        await db.flush()
    if row.pin_hash:
        return
    row.pin_hash = hash_pin(str(raw).strip())
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info("Provisioned provisional admin PIN hash from %s (plaintext not logged)", ENV_PIN_KEY)


async def verify_admin_pin(db: AsyncSession, pin: str) -> bool:
    row = await get_settings_row(db)
    if not row or not row.pin_hash:
        return False
    return verify_pin(pin, row.pin_hash)
