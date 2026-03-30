"""Shared validation for profile/family notepad background hex colours (#RGB / #RRGGBB)."""
import re
from typing import Optional

from fastapi import HTTPException

_NOTEPAD_HEX_6 = re.compile(r"^#[0-9A-Fa-f]{6}$")
_NOTEPAD_HEX_3 = re.compile(r"^#[0-9A-Fa-f]{3}$")


def notepad_color_for_api_response(raw) -> Optional[str]:
    """Normalize stored notepad colour for JSON (#RRGGBB or None). Invalid legacy values become None."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if _NOTEPAD_HEX_6.match(s):
        return s.upper()
    if _NOTEPAD_HEX_3.match(s):
        r, g, b = s[1], s[2], s[3]
        return f"#{r}{r}{g}{g}{b}{b}".upper()
    return None


def normalize_notepad_color_for_set(raw: str) -> Optional[str]:
    """
    Validate PATCH input: empty string clears to None; otherwise require #RGB or #RRGGBB.
    Raises HTTPException on invalid input.
    """
    s = (raw or "").strip()
    if not s:
        return None
    if not s.startswith("#"):
        raise HTTPException(status_code=400, detail="Notepad color must be a hex value like #RRGGBB.")
    if _NOTEPAD_HEX_6.match(s):
        return s.upper()
    if _NOTEPAD_HEX_3.match(s):
        r, g, b = s[1], s[2], s[3]
        return f"#{r}{r}{g}{g}{b}{b}".upper()
    raise HTTPException(status_code=400, detail="Notepad color must be #RGB or #RRGGBB.")
