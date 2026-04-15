# Per-page sustained request pacing (jail v1): gap-based streak, optional via game_settings.
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from fastapi import HTTPException

_rng = secrets.SystemRandom()

MAX_GAP_MS = 500.0
SUSTAIN_SEC = 15.0
COOLDOWN_MIN_SEC = 10
COOLDOWN_MAX_SEC = 15
PAGE_KEY_JAIL = "jail"
COLL = "sustained_page_rl_state"


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


async def sustained_page_rl_jail_enabled(db) -> bool:
    doc = await db.game_settings.find_one({"_id": "main"}, {"sustained_page_rl_jail_enabled": 1})
    if not doc:
        return False
    return bool(doc.get("sustained_page_rl_jail_enabled"))


async def check_jail_sustained_page_rl(db, user_id: str) -> None:
    """Raise HTTPException 429 when jail pacing cooldown applies; no-op when disabled or no user."""
    if not user_id:
        return
    if not await sustained_page_rl_jail_enabled(db):
        return

    now = _now()
    doc_id = f"{user_id}:{PAGE_KEY_JAIL}"
    doc = await db[COLL].find_one({"_id": doc_id}) or {}

    cooldown_until = _parse_iso(doc.get("cooldown_until"))
    if cooldown_until and now < cooldown_until:
        sec = int(max(1, (cooldown_until - now).total_seconds() + 0.999))
        raise HTTPException(
            status_code=429,
            headers={"Retry-After": str(sec)},
            detail={
                "detail": "Jail actions are temporarily limited — try again in a few seconds.",
                "cooldown_seconds": sec,
                "page_key": PAGE_KEY_JAIL,
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
                    "page_key": PAGE_KEY_JAIL,
                    "last_at": now.isoformat(),
                    "fast_chain_start": None,
                    "updated_at": now.isoformat(),
                }
            },
            upsert=True,
        )
        return

    gap_ms = (now - last_at).total_seconds() * 1000.0

    if gap_ms >= MAX_GAP_MS:
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
                "detail": "Jail actions are temporarily limited — slow down for a few seconds.",
                "cooldown_seconds": cd_sec,
                "page_key": PAGE_KEY_JAIL,
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
