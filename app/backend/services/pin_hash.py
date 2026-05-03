"""PIN hashing for provisional project workers (replaceable later)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Final

_ITER_DEFAULT: Final[int] = 390_000
_PREFIX: Final[str] = "pbkdf2_sha256"


def hash_pin(pin: str) -> str:
    """Return an encoded hash string safe to store in `project_workers.pin_hash`."""
    pin_bytes = pin.encode("utf-8")
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pin_bytes, salt, _ITER_DEFAULT)
    return f"{_PREFIX}${_ITER_DEFAULT}${salt.hex()}${dk.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    """Constant-time compare against stored `pbkdf2_sha256$...` string."""
    if not stored or not pin:
        return False
    parts = stored.split("$")
    if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
        return False
    try:
        iterations = int(parts[1])
        salt = bytes.fromhex(parts[2])
        expected = bytes.fromhex(parts[3])
    except (ValueError, TypeError):
        return False
    pin_bytes = pin.encode("utf-8")
    dk = hashlib.pbkdf2_hmac("sha256", pin_bytes, salt, iterations)
    return hmac.compare_digest(dk, expected)
