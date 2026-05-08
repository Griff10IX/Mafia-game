"""JWT signing secret from JWT_SECRET_KEY only — reject placeholders so weak defaults never ship."""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# Verbatim strings from docs / .env.example / deployment guides — refuse these on startup.
_JWT_SECRET_PLACEHOLDER_LOWER = frozenset(
    {
        "your-secret-key-change-in-production",
        "your-secret-key-here",
        "generate_new_secret_here",
        "your-super-secret-key-change-this",
        "paste_new_secret_here",
        "your_jwt_secret_key",
        "choose-a-long-random-secret-string-here",
        "changeme",
        "change-me",
        "secret",
    }
)


def jwt_secret_from_env() -> str:
    """Raw strip from JWT_SECRET_KEY."""
    return (os.environ.get("JWT_SECRET_KEY") or "").strip()


def is_jwt_secret_placeholder(secret: str) -> bool:
    """True if missing or matches a known placeholder (case-insensitive)."""
    s = (secret or "").strip()
    if not s:
        return True
    return s.lower() in _JWT_SECRET_PLACEHOLDER_LOWER


def require_jwt_secret_key() -> str:
    """Env JWT_SECRET_KEY only; exit process if missing or placeholder."""
    s = jwt_secret_from_env()
    if is_jwt_secret_placeholder(s):
        logger.error(
            "JWT_SECRET_KEY must be set to a long random value (not a placeholder from docs). Refusing to start."
        )
        raise SystemExit(1)
    return s
