# Per-page sustained request pacing: gap-based streak, optional via game_settings `main` doc.
#
# Intent: throttle *sustained* high-frequency traffic (scripts / hammering), not normal UI.
# A "fast chain" continues only while gaps between consecutive requests stay below max_gap_ms.
# Gaps >= max_gap_ms reset the chain. Cooldown applies only after sustain_sec of wall-clock time
# in such a chain (see check_sustained_page_rl).
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from fastapi import HTTPException

_rng = secrets.SystemRandom()
logger = logging.getLogger(__name__)

# Inbox admins at most this often per (user_id, page_key) for sustained RL 429s (repeat hits while in cooldown).
_ADMIN_RL_INBOX_MIN_GAP_SEC = 180

# Default streak gap / sustain for scopes not in PAGE_KEYS_JAIL_STYLE_TUNING (except kill, which uses a tighter gap).
MAX_GAP_MS = 500.0
SUSTAIN_SEC = 15.0
COOLDOWN_MIN_SEC = 10
COOLDOWN_MAX_SEC = 15
COLL = "sustained_page_rl_state"

# Jail-style profile: same math as jail (750ms max gap between requests in a chain, 22s wall-clock sustain).
JAIL_STYLE_MAX_GAP_MS = 750.0
JAIL_STYLE_SUSTAIN_SEC = 22.0

PAGE_KEY_JAIL = "jail"
PAGE_KEY_ENTERTAINER = "entertainer"
PAGE_KEY_FORUM = "forum"
PAGE_KEY_KILL = "kill"
PAGE_KEY_GTA = "gta"
PAGE_KEY_CRIMES = "crimes"
PAGE_KEY_OC = "oc"
PAGE_KEY_BOOZE = "booze"
PAGE_KEY_GAME_CHAT = "game_chat"
PAGE_KEY_STORE = "store"
PAGE_KEY_RANKING = "ranking"
PAGE_KEY_NOTIFICATIONS = "notifications"
PAGE_KEY_HITLIST = "hitlist"
PAGE_KEY_BANK = "bank"
PAGE_KEY_LEADERBOARD = "leaderboard"

# Scopes that use JAIL_STYLE_MAX_GAP_MS / JAIL_STYLE_SUSTAIN_SEC (forum/entertainer aligned with jail per product).
PAGE_KEYS_JAIL_STYLE_TUNING = frozenset(
    {
        PAGE_KEY_JAIL,
        PAGE_KEY_FORUM,
        PAGE_KEY_ENTERTAINER,
        PAGE_KEY_GTA,
        PAGE_KEY_CRIMES,
        PAGE_KEY_OC,
        PAGE_KEY_BOOZE,
        PAGE_KEY_GAME_CHAT,
        PAGE_KEY_STORE,
        PAGE_KEY_RANKING,
        PAGE_KEY_NOTIFICATIONS,
        PAGE_KEY_HITLIST,
        PAGE_KEY_BANK,
        PAGE_KEY_LEADERBOARD,
    }
)

# Kill: stricter gap than jail-style (unchanged product behavior).
_KILL_MAX_GAP_MS = 100.0


def _max_gap_ms(page_key: str) -> float:
    if page_key in PAGE_KEYS_JAIL_STYLE_TUNING:
        return JAIL_STYLE_MAX_GAP_MS
    if page_key == PAGE_KEY_KILL:
        return _KILL_MAX_GAP_MS
    return MAX_GAP_MS


def _sustain_sec(page_key: str) -> float:
    if page_key in PAGE_KEYS_JAIL_STYLE_TUNING:
        return JAIL_STYLE_SUSTAIN_SEC
    return SUSTAIN_SEC


_SETTINGS_FIELD_BY_PAGE = {
    PAGE_KEY_JAIL: "sustained_page_rl_jail_enabled",
    PAGE_KEY_ENTERTAINER: "sustained_page_rl_entertainer_enabled",
    PAGE_KEY_FORUM: "sustained_page_rl_forum_enabled",
    PAGE_KEY_KILL: "sustained_page_rl_kill_enabled",
    PAGE_KEY_GTA: "sustained_page_rl_gta_enabled",
    PAGE_KEY_CRIMES: "sustained_page_rl_crimes_enabled",
    PAGE_KEY_OC: "sustained_page_rl_oc_enabled",
    PAGE_KEY_BOOZE: "sustained_page_rl_booze_enabled",
    PAGE_KEY_GAME_CHAT: "sustained_page_rl_game_chat_enabled",
    PAGE_KEY_STORE: "sustained_page_rl_store_enabled",
    PAGE_KEY_RANKING: "sustained_page_rl_ranking_enabled",
    PAGE_KEY_NOTIFICATIONS: "sustained_page_rl_notifications_enabled",
    PAGE_KEY_HITLIST: "sustained_page_rl_hitlist_enabled",
    PAGE_KEY_BANK: "sustained_page_rl_bank_enabled",
    PAGE_KEY_LEADERBOARD: "sustained_page_rl_leaderboard_enabled",
}

_COOLDOWN_MSG = {
    PAGE_KEY_JAIL: "Too many jail requests too fast — try again in a few seconds.",
    PAGE_KEY_ENTERTAINER: "Entertainer actions are temporarily limited — try again in a few seconds.",
    PAGE_KEY_FORUM: "Forum actions are temporarily limited — try again in a few seconds.",
    PAGE_KEY_KILL: "Attack / kill actions are temporarily limited — try again in a few seconds.",
    PAGE_KEY_GTA: "Too many GTA requests too fast — try again in a few seconds.",
    PAGE_KEY_CRIMES: "Too many crimes requests too fast — try again in a few seconds.",
    PAGE_KEY_OC: "Too many organised crime requests too fast — try again in a few seconds.",
    PAGE_KEY_BOOZE: "Too many booze run requests too fast — try again in a few seconds.",
    PAGE_KEY_GAME_CHAT: "Too many game chat requests too fast — try again in a few seconds.",
    PAGE_KEY_STORE: "Too many store requests too fast — try again in a few seconds.",
    PAGE_KEY_RANKING: "Too many ranking requests too fast — try again in a few seconds.",
    PAGE_KEY_NOTIFICATIONS: "Too many notification requests too fast — try again in a few seconds.",
    PAGE_KEY_HITLIST: "Too many hitlist requests too fast — try again in a few seconds.",
    PAGE_KEY_BANK: "Too many bank requests too fast — try again in a few seconds.",
    PAGE_KEY_LEADERBOARD: "Too many leaderboard requests too fast — try again in a few seconds.",
}

_SLOW_MSG = {
    PAGE_KEY_JAIL: "You're hitting the jail server too fast — slow down for a few seconds.",
    PAGE_KEY_ENTERTAINER: "Entertainer actions are temporarily limited — slow down for a few seconds.",
    PAGE_KEY_FORUM: "Forum actions are temporarily limited — slow down for a few seconds.",
    PAGE_KEY_KILL: "Attack / kill actions are temporarily limited — slow down for a few seconds.",
    PAGE_KEY_GTA: "You're hitting the GTA server too fast — slow down for a few seconds.",
    PAGE_KEY_CRIMES: "You're hitting the crimes server too fast — slow down for a few seconds.",
    PAGE_KEY_OC: "You're hitting the OC server too fast — slow down for a few seconds.",
    PAGE_KEY_BOOZE: "You're hitting the booze run server too fast — slow down for a few seconds.",
    PAGE_KEY_GAME_CHAT: "You're loading game chat too fast — slow down for a few seconds.",
    PAGE_KEY_STORE: "You're hitting the store server too fast — slow down for a few seconds.",
    PAGE_KEY_RANKING: "You're hitting the ranking server too fast — slow down for a few seconds.",
    PAGE_KEY_NOTIFICATIONS: "You're hitting notifications too fast — slow down for a few seconds.",
    PAGE_KEY_HITLIST: "You're hitting the hitlist server too fast — slow down for a few seconds.",
    PAGE_KEY_BANK: "You're hitting the bank server too fast — slow down for a few seconds.",
    PAGE_KEY_LEADERBOARD: "You're hitting the leaderboard too fast — slow down for a few seconds.",
}

_PAGE_LABEL_ADMIN = {
    PAGE_KEY_JAIL: "Jail",
    PAGE_KEY_KILL: "Kill / attack",
    PAGE_KEY_FORUM: "Forum",
    PAGE_KEY_ENTERTAINER: "Entertainer",
    PAGE_KEY_GTA: "GTA",
    PAGE_KEY_CRIMES: "Crimes",
    PAGE_KEY_OC: "Organised crime",
    PAGE_KEY_BOOZE: "Booze run",
    PAGE_KEY_GAME_CHAT: "Game chat",
    PAGE_KEY_STORE: "Store / points",
    PAGE_KEY_RANKING: "Rank progress",
    PAGE_KEY_NOTIFICATIONS: "Notifications / inbox",
    PAGE_KEY_HITLIST: "Hitlist",
    PAGE_KEY_BANK: "Bank",
    PAGE_KEY_LEADERBOARD: "Leaderboard",
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


async def _notify_admins_sustained_rl_429(
    db,
    *,
    user_id: str,
    page_key: str,
    retry_after_sec: int,
    reason: str,
) -> None:
    """Inbox game admins when a user hits sustained page rate limit (HTTP 429). Best-effort; never raises."""
    if not user_id:
        return
    try:
        from server import send_notification, _get_admin_user_ids
    except Exception:
        logger.exception("sustained RL admin notify: server import failed")
        return
    try:
        admin_ids = await _get_admin_user_ids(db)
    except Exception:
        logger.exception("sustained RL admin notify: _get_admin_user_ids failed")
        return
    if not admin_ids:
        return
    uname = "?"
    try:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        if u and u.get("username"):
            uname = str(u["username"])
    except Exception:
        pass
    label = _PAGE_LABEL_ADMIN.get(page_key, page_key)
    title = "Player rate limited"
    msg = (
        f"A user was blocked by sustained page rate limiting ({label}).\n\n"
        f"User: {uname} ({user_id})\n"
        f"Retry-After: {retry_after_sec}s\n"
        f"Reason: {reason}\n"
        f"Scope: {page_key}"
    )
    for aid in admin_ids:
        try:
            await send_notification(aid, title, msg, "system", category="admin")
        except Exception:
            logger.exception("sustained RL admin notify failed for admin_id=%s", aid)


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
        last_inbox = _parse_iso(doc.get("last_admin_rl_inbox_at"))
        if last_inbox is None or (now - last_inbox).total_seconds() >= _ADMIN_RL_INBOX_MIN_GAP_SEC:
            try:
                await db[COLL].update_one({"_id": doc_id}, {"$set": {"last_admin_rl_inbox_at": now.isoformat()}})
            except Exception:
                logger.exception("sustained RL: failed to set last_admin_rl_inbox_at (cooldown path)")
            await _notify_admins_sustained_rl_429(
                db, user_id=user_id, page_key=page_key, retry_after_sec=sec, reason="cooldown_active",
            )
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

    if (now - fast_chain_start).total_seconds() >= _sustain_sec(page_key):
        cd_sec = _rng.randint(COOLDOWN_MIN_SEC, COOLDOWN_MAX_SEC)
        until = now + timedelta(seconds=cd_sec)
        last_inbox = _parse_iso(doc.get("last_admin_rl_inbox_at"))
        touch_inbox_ts = last_inbox is None or (now - last_inbox).total_seconds() >= _ADMIN_RL_INBOX_MIN_GAP_SEC
        set_fields = {
            "last_at": now.isoformat(),
            "fast_chain_start": None,
            "cooldown_until": until.isoformat(),
            "updated_at": now.isoformat(),
        }
        if touch_inbox_ts:
            set_fields["last_admin_rl_inbox_at"] = now.isoformat()
        await db[COLL].update_one(
            {"_id": doc_id},
            {"$set": set_fields},
            upsert=True,
        )
        if touch_inbox_ts:
            await _notify_admins_sustained_rl_429(
                db, user_id=user_id, page_key=page_key, retry_after_sec=cd_sec, reason="sustained_fast_chain",
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
