# Per-page sustained request pacing: gap-based streak, optional via game_settings `main` doc.
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from fastapi import HTTPException

_rng = secrets.SystemRandom()

# Default streak gap: requests farther apart than this reset the fast chain.
MAX_GAP_MS = 500.0
SUSTAIN_SEC = 15.0
COOLDOWN_MIN_SEC = 10
COOLDOWN_MAX_SEC = 15
COLL = "sustained_page_rl_state"

PAGE_KEY_JAIL = "jail"
PAGE_KEY_ENTERTAINER = "entertainer"
PAGE_KEY_FORUM = "forum"
PAGE_KEY_KILL = "kill"

_MAX_GAP_MS_BY_PAGE = {
    PAGE_KEY_KILL: 100.0,
}


def _max_gap_ms(page_key: str) -> float:
    return float(_MAX_GAP_MS_BY_PAGE.get(page_key, MAX_GAP_MS))


_SETTINGS_FIELD_BY_PAGE = {
    PAGE_KEY_JAIL: "sustained_page_rl_jail_enabled",
    PAGE_KEY_ENTERTAINER: "sustained_page_rl_entertainer_enabled",
    PAGE_KEY_FORUM: "sustained_page_rl_forum_enabled",
    PAGE_KEY_KILL: "sustained_page_rl_kill_enabled",
}

_COOLDOWN_MSG = {
    PAGE_KEY_JAIL: "Jail actions are temporarily limited — try again in a few seconds.",
    PAGE_KEY_ENTERTAINER: "Entertainer actions are temporarily limited — try again in a few seconds.",
    PAGE_KEY_FORUM: "Forum actions are temporarily limited — try again in a few seconds.",
    PAGE_KEY_KILL: "Attack / kill actions are temporarily limited — try again in a few seconds.",
}

_SLOW_MSG = {
    PAGE_KEY_JAIL: "Jail actions are temporarily limited — slow down for a few seconds.",
    PAGE_KEY_ENTERTAINER: "Entertainer actions are temporarily limited — slow down for a few seconds.",
    PAGE_KEY_FORUM: "Forum actions are temporarily limited — slow down for a few seconds.",
    PAGE_KEY_KILL: "Attack / kill actions are temporarily limited — slow down for a few seconds.",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(val: Any) -> Optional[datetime]:
    if not val:
        return None
    try:
        s = str(val).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


async def sustained_page_rl_enabled_for(db, page_key: str) -> bool:
    field = _SETTINGS_FIELD_BY_PAGE.get(page_key)
    if not field:
        return False
    doc = await db.game_settings.find_one({"_id": "main"}, {field: 1})
    if not doc:
        return False
    return bool(doc.get(field))


async def check_sustained_page_rl(db, user_id: str, page_key: str) -> None:
    """Raise HTTPException 429 when pacing cooldown applies; no-op when disabled, unknown scope, or no user."""
    if not user_id or page_key not in _SETTINGS_FIELD_BY_PAGE:
        return
    if not await sustained_page_rl_enabled_for(db, page_key):
        return

    now = _now()
    doc_id = f"{user_id}:{page_key}"
    doc = await db[COLL].find_one({"_id": doc_id}) or {}

    cooldown_msg = _COOLDOWN_MSG.get(page_key, "Actions are temporarily limited — try again in a few seconds.")
    slow_msg = _SLOW_MSG.get(page_key, "Actions are temporarily limited — slow down for a few seconds.")

    cooldown_until = _parse_iso(doc.get("cooldown_until"))
    if cooldown_until and now < cooldown_until:
        sec = int(max(1, (cooldown_until - now).total_seconds() + 0.999))
        raise HTTPException(
            status_code=429,
            headers={"Retry-After": str(sec)},
            detail={
                "detail": cooldown_msg,
                "cooldown_seconds": sec,
                "page_key": page_key,
            },
        )

    last_at = _parse_iso(doc.get("last_at"))
    fast_chain_start = _parse_iso(doc.get("fast_chain_start"))

    if last_at is None:
        await db[COLL].update_one(
            {"_id": doc_id},
            {
                "$set": {
                    "user_id": user_id,
                    "page_key": page_key,
                    "last_at": now.isoformat(),
                    "fast_chain_start": None,
                    "updated_at": now.isoformat(),
                }
            },
            upsert=True,
        )
        return

    gap_ms = (now - last_at).total_seconds() * 1000.0

    if gap_ms >= _max_gap_ms(page_key):
        await db[COLL].update_one(
            {"_id": doc_id},
            {
                "$set": {
                    "last_at": now.isoformat(),
                    "fast_chain_start": None,
                    "updated_at": now.isoformat(),
                }
            },
            upsert=True,
        )
        return

    if fast_chain_start is None:
        fast_chain_start = last_at

    if (now - fast_chain_start).total_seconds() >= SUSTAIN_SEC:
        cd_sec = _rng.randint(COOLDOWN_MIN_SEC, COOLDOWN_MAX_SEC)
        until = now + timedelta(seconds=cd_sec)
        await db[COLL].update_one(
            {"_id": doc_id},
            {
                "$set": {
                    "last_at": now.isoformat(),
                    "fast_chain_start": None,
                    "cooldown_until": until.isoformat(),
                    "updated_at": now.isoformat(),
                }
            },
            upsert=True,
        )
        raise HTTPException(
            status_code=429,
            headers={"Retry-After": str(cd_sec)},
            detail={
                "detail": slow_msg,
                "cooldown_seconds": cd_sec,
                "page_key": page_key,
            },
        )

    await db[COLL].update_one(
        {"_id": doc_id},
        {
            "$set": {
                "last_at": now.isoformat(),
                "fast_chain_start": fast_chain_start.isoformat(),
                "updated_at": now.isoformat(),
            }
        },
        upsert=True,
    )


async def check_jail_sustained_page_rl(db, user_id: str) -> None:
    """Raise HTTPException 429 when jail pacing cooldown applies; no-op when disabled or no user."""
    await check_sustained_page_rl(db, user_id, PAGE_KEY_JAIL)
