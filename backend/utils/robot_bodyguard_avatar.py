"""Default dossier portraits for robot bodyguards (files under public/images/)."""
from __future__ import annotations

import random
from typing import Optional, Sequence

ROBOT_BODYGUARD_AVATAR_URLS: Sequence[str] = (
    "/images/robot-bodyguard.png",
    "/images/robot-bodyguard-2.png",
    "/images/robot-bodyguard-3.png",
)


def robot_bodyguard_avatar_url(seed: Optional[str] = None) -> str:
    """Pick a portrait. With seed, choice is stable; otherwise random (hire time)."""
    urls = list(ROBOT_BODYGUARD_AVATAR_URLS)
    if not urls:
        return "/images/robot-bodyguard.png"
    if seed:
        h = 0
        for ch in str(seed):
            h = (h * 31 + ord(ch)) & 0xFFFFFFFF
        return urls[h % len(urls)]
    return random.choice(urls)
