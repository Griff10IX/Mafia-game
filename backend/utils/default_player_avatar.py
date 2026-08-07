"""Default portraits for human players with no custom avatar (files under public/images/)."""
from __future__ import annotations

import random
from typing import Optional, Sequence

DEFAULT_PLAYER_AVATAR_URLS: Sequence[str] = (
    "/images/default-avatar-1.png",
    "/images/default-avatar-2.png",
    "/images/default-avatar-3.png",
    "/images/default-avatar-4.png",
)


def default_player_avatar_url(seed: Optional[str] = None) -> str:
    """Pick a default portrait. With seed, choice is stable; otherwise random (registration)."""
    urls = list(DEFAULT_PLAYER_AVATAR_URLS)
    if not urls:
        return "/images/default-avatar-1.png"
    if seed:
        h = 0
        for ch in str(seed):
            h = (h * 31 + ord(ch)) & 0xFFFFFFFF
        return urls[h % len(urls)]
    return random.choice(urls)


def resolve_player_avatar_url(user: dict) -> Optional[str]:
    """
    Return avatar to show for a user.
    Never replaces a stored custom avatar_url.
    Robots use robot portraits; other users without avatar get a stable default.
    """
    stored = user.get("avatar_url")
    if isinstance(stored, str) and stored.strip():
        return stored.strip()
    if bool(user.get("is_npc")) and bool(user.get("is_bodyguard")):
        from utils.robot_bodyguard_avatar import robot_bodyguard_avatar_url

        return robot_bodyguard_avatar_url(str(user.get("id") or user.get("username") or ""))
    if bool(user.get("is_npc")):
        return None
    return default_player_avatar_url(str(user.get("id") or user.get("username") or ""))
