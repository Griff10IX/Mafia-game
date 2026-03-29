"""
Minigame API hardening: server-authoritative sessions, no client-injected fields.

- Session IDs must match the UUID format issued by /minigames/run-session/start (prevents
  garbage / operator injection in Mongo queries).
- Admin bypass of session checks is OFF in production; set ALLOW_MINIGAME_ADMIN_SESSION_BYPASS=1
  only in local/dev if needed.
"""
from __future__ import annotations

import os
import re
from typing import Optional

from fastapi import HTTPException

_SESSION_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def allow_minigame_admin_session_bypass() -> bool:
    v = os.environ.get("ALLOW_MINIGAME_ADMIN_SESSION_BYPASS", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def skip_minigame_session(is_admin: bool) -> bool:
    """If True, admin may submit scores without a run session (dev-only unless env set)."""
    if not allow_minigame_admin_session_bypass():
        return False
    return bool(is_admin)


def validate_minigame_session_id(session_id: Optional[str]) -> str:
    """Return normalized session id or raise 400 (strict UUID string)."""
    sid = (session_id or "").strip()
    if not sid or len(sid) > 40:
        raise HTTPException(status_code=400, detail="Invalid session.")
    if not _SESSION_UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid session.")
    return sid
