"""Shared username validation (registration + admin rename)."""

from typing import Optional, Tuple

USERNAME_MAX_LEN = 20


def normalize_username(raw: Optional[str]) -> str:
    return (raw or "").strip()


def validate_username(raw: Optional[str], *, email: Optional[str] = None) -> Tuple[str, Optional[str]]:
    """Return (normalized_username, error_message). error_message is None when valid."""
    u = normalize_username(raw)
    if not u:
        return u, "Username is required."
    if len(u) > USERNAME_MAX_LEN:
        return u, f"Username must be {USERNAME_MAX_LEN} characters or fewer."
    if "@" in u:
        return u, "Usernames cannot contain '@'. Choose a display name, not an email address."
    if email and u.lower() == str(email).strip().lower():
        return u, "Username must be different from your email address."
    return u, None
