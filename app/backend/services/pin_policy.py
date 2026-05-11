"""Validation rules for site worker PINs (exactly six ASCII digits for new/changed PINs)."""

from __future__ import annotations

import re

PIN_LENGTH = 6
MSG_PIN_LEN_NO = "PIN-koden må være 6 siffer"
MSG_PIN_DIGITS_ONLY_NO = "PIN-koden kan kun inneholde tall"

_DIGITS_ONLY = re.compile(r"^[0-9]+$")
_LOGIN_PIN = re.compile(r"^[0-9]{4,6}$")


def validate_new_site_worker_pin(pin: str) -> str:
    """Return a normalized PIN or raise ValueError with a Norwegian message."""
    s = (pin or "").strip()
    if not _DIGITS_ONLY.fullmatch(s):
        raise ValueError(MSG_PIN_DIGITS_ONLY_NO)
    if len(s) != PIN_LENGTH:
        raise ValueError(MSG_PIN_LEN_NO)
    return s


def validate_worker_login_pin_plaintext(pin: str) -> str:
    """Normalize login PIN: digits only, 4–6 characters (supports legacy hashes)."""
    s = (pin or "").strip()
    if not s:
        raise ValueError(MSG_PIN_LEN_NO)
    if not _DIGITS_ONLY.fullmatch(s):
        raise ValueError(MSG_PIN_DIGITS_ONLY_NO)
    if not _LOGIN_PIN.fullmatch(s):
        raise ValueError(MSG_PIN_LEN_NO)
    return s
