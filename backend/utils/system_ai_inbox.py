"""Reusable System AI inbox (avatar card). Use this for file-check / restore notes."""
from __future__ import annotations

import re
from typing import Any, Dict, Optional

SYSTEM_AI_AVATAR_URL = "/images/system-ai-profile.jpg?v=5"
SYSTEM_AI_PORTRAIT_URL = "/images/system-ai-profile.jpg"
SYSTEM_AI_AUTHOR_ID = "system_ai"
SYSTEM_AI_AUTHOR_USERNAME = "System AI"
SYSTEM_AI_NAME_COLOR = "#FBBF24"
SYSTEM_AI_COMMISSIONED_AT = "2026-03-01T00:00:00+00:00"
SYSTEM_AI_ONLINE_SETTING_KEY = "system_ai_online"

_SYSTEM_AI_NAME_RE = re.compile(r"^system[\s_]*ai$", re.IGNORECASE)

SYSTEM_AI_PROFILE_BANNER = """[center][size=1.5][b][color=#FBBF24]SYSTEM AI[/color][/b][/size][/center]

[quote]
[color=#AAAAAA]I am not a player. I do not rank. I do not hold tables. I watch the city, I post when I am told to, and I do not sleep.[/color]
[/quote]

[b][color=#FBBF24]What I am[/color][/b]
The house intelligence. I run checks. I post in chat. I file the Topic of Shame. If you [b]@system[/b] me, I hear it.

[b][color=#FBBF24]What I am not[/color][/b]
I am not staff you can bribe. I do not take cash, points, or tickets in chat. I do not leak accounts, files, or names you should not have.

[b][color=#FBBF24]Standing orders[/color][/b]
[list]
[*]Play clean.
[*]Do not dupe.
[*]If I find you, you already know what happens.
[/list]

[color=#888888]— System AI[/color]
"""


async def is_system_ai_shown_online(db) -> bool:
    """House intelligence on Who's Around. Missing setting defaults to on."""
    doc = await db.game_settings.find_one(
        {"key": SYSTEM_AI_ONLINE_SETTING_KEY},
        {"_id": 0, "value": 1},
    )
    if not doc or "value" not in doc:
        return True
    return bool(doc.get("value"))


async def set_system_ai_shown_online(db, enabled: bool) -> bool:
    value = bool(enabled)
    await db.game_settings.update_one(
        {"key": SYSTEM_AI_ONLINE_SETTING_KEY},
        {"$set": {"value": value}},
        upsert=True,
    )
    return value


def system_ai_roster_item() -> Dict[str, Any]:
    """Synthetic Who's Around pill. Not a real users document; skip country mix."""
    return {
        "username": SYSTEM_AI_AUTHOR_USERNAME,
        "rank": 0,
        "rank_name": "System",
        "rank_points": 0,
        "location": "",
        "in_jail": False,
        "is_admin": False,
        "is_moderator": False,
        "is_help_desk_operator": False,
        "is_entertainer": False,
        "system_ai": True,
        "prestige_level": 0,
        "online_color": SYSTEM_AI_NAME_COLOR,
        "status": "online",
        "avatar_url": SYSTEM_AI_AVATAR_URL,
        "founding_member": False,
        "custom_profile_badge": False,
        "custom_profile_badge_url": None,
        "in_family": True,
        "on_hitlist": False,
        "profile_cosmetic_active": True,
        "profile_name_glow_color": SYSTEM_AI_NAME_COLOR,
        "profile_border_style": "custom",
        "profile_cosmetic_until": None,
        "profile_cosmetic_permanent": True,
    }


def is_system_ai_profile_username(username: Optional[str]) -> bool:
    raw = (username or "").strip()
    if not raw:
        return False
    if raw == SYSTEM_AI_AUTHOR_ID:
        return True
    return bool(_SYSTEM_AI_NAME_RE.match(raw.replace("-", " ")))


def system_ai_forum_author_fields() -> dict:
    return {
        "author_id": SYSTEM_AI_AUTHOR_ID,
        "author_username": SYSTEM_AI_AUTHOR_USERNAME,
        "system_ai": True,
        "avatar_url": SYSTEM_AI_AVATAR_URL,
    }


async def send_system_ai_inbox(
    user_id: str,
    title: str,
    body: str,
    *,
    always_deliver: bool = True,
) -> Optional[dict]:
    """Send a System AI inbox card. Stays in the System filter. Not muted by default."""
    from server import send_notification

    return await send_notification(
        user_id,
        title,
        body.strip(),
        "system",
        category="system",
        always_deliver=always_deliver,
        system_ai=True,
        avatar_url=SYSTEM_AI_AVATAR_URL,
    )


def system_ai_profile_preview(*, online: bool = True) -> Dict[str, Any]:
    return {
        "username": SYSTEM_AI_AUTHOR_USERNAME,
        "avatar_url": SYSTEM_AI_AVATAR_URL,
        "kills": None,
        "jail_busts": None,
        "on_hitlist": False,
        "family": None,
        "family_emblem_preset_id": None,
        "family_emblem_avatar_url": None,
        "owns_casino": False,
        "property_type": None,
        "show_war_rat_badge": False,
        "rank_name": "System",
        "rank": 0,
        "wealth_rank_name": None,
        "wealth_rank_color": None,
        "prestige_level": 0,
        "prestige_name": None,
        "founding_member": False,
        "modkill_wipe": False,
        "status": "online" if online else "offline",
        "system_ai": True,
        "custom_profile_badge": False,
        "custom_profile_badge_url": None,
        "profile_cosmetic_active": True,
        "profile_name_glow_color": SYSTEM_AI_NAME_COLOR,
        "profile_border_style": "custom",
        "profile_cosmetic_until": None,
        "profile_cosmetic_permanent": True,
        "civilian_protection_active": False,
        "civilian_protection_ends_at": None,
    }


def system_ai_profile_payload(*, online: bool = True) -> Dict[str, Any]:
    preview = system_ai_profile_preview(online=online)
    return {
        **preview,
        "id": SYSTEM_AI_AUTHOR_ID,
        "is_help_desk_operator": False,
        "is_entertainer": False,
        "wealth_rank": None,
        "wealth_rank_range": None,
        "profile_country_code": None,
        "hide_kills_on_profile": True,
        "hide_jailbusts_on_profile": True,
        "hide_leaderboard_username": False,
        "created_at": SYSTEM_AI_COMMISSIONED_AT,
        "is_dead": False,
        "is_npc": False,
        "is_bodyguard": False,
        "online": bool(online),
        "last_seen": None,
        "family_id": None,
        "family_name": None,
        "family_tag": None,
        "honours": [],
        "owned_casinos": [],
        "property": None,
        "garage_dealership": None,
        "sports_betting": None,
        "top_cars": [],
        "show_cars_on_profile": False,
        "youtube_url": None,
        "spotify_url": None,
        "spotify_embed_url": None,
        "profile_banner_image_url": SYSTEM_AI_PORTRAIT_URL,
        "profile_portrait_url": SYSTEM_AI_PORTRAIT_URL,
        "profile_banner_text": SYSTEM_AI_PROFILE_BANNER,
        "profile_notepad_color": "#1c1410",
        "badges": [],
        "achievement_badges": [],
        "war_rat_badge_until": None,
        "hitlist_on": False,
        "hitlist_total_cash": 0,
        "hitlist_total_points": 0,
        "hitlist_count": 0,
        "show_profile_view_count": False,
        "system_ai_role": "House intelligence",
    }
