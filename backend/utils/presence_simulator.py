# Background task: gently bump last_seen for a rotating pool of real (non-NPC) users so the game looks more active.
# Config persisted in game_settings key "presence_simulator". Admin-only API in routers/admin.
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SIMULATOR_KEY = "presence_simulator"

# Plausible client paths for admin "users online live" / activity views
_SIM_PAGES = [
    "/dashboard",
    "/crime",
    "/store",
    "/bank",
    "/hitlist",
    "/messages",
    "/forum",
    "/cars",
    "/profile",
    "/casino",
    "/travel",
    "/families",
    "/minigames",
    "/stock-market",
    "/properties",
]


def default_presence_config() -> Dict[str, Any]:
    return {
        "enabled": False,
        "interval_seconds": 300,
        "min_add_per_tick": 1,
        "max_add_per_tick": 3,
        "max_remove_per_tick": 2,
        "max_pool": 25,
        "active_user_ids": [],
        "last_tick_at": None,
        "ticks_total": 0,
    }


def _merge_cfg(raw: Optional[dict]) -> Dict[str, Any]:
    out = default_presence_config()
    if raw and isinstance(raw, dict):
        for k, v in raw.items():
            if k in out:
                out[k] = v
    out["interval_seconds"] = max(120, min(3600, int(out["interval_seconds"] or 300)))
    out["min_add_per_tick"] = max(0, min(10, int(out["min_add_per_tick"] or 1)))
    out["max_add_per_tick"] = max(
        out["min_add_per_tick"], min(15, int(out["max_add_per_tick"] or 3))
    )
    out["max_remove_per_tick"] = max(0, min(10, int(out["max_remove_per_tick"] or 2)))
    out["max_pool"] = max(5, min(100, int(out["max_pool"] or 25)))
    ids = out.get("active_user_ids") or []
    out["active_user_ids"] = [str(x).strip() for x in ids if str(x).strip()]
    return out


async def load_presence_config(db) -> Dict[str, Any]:
    doc = await db.game_settings.find_one({"key": SIMULATOR_KEY}, {"_id": 0, "value": 1})
    val = doc.get("value") if doc else None
    if isinstance(val, dict):
        return _merge_cfg(val)
    return default_presence_config()


async def save_presence_config(db, cfg: Dict[str, Any]) -> None:
    merged = _merge_cfg(cfg)
    await db.game_settings.update_one(
        {"key": SIMULATOR_KEY},
        {"$set": {"value": merged}},
        upsert=True,
    )


async def presence_simulator_tick(db, admin_emails: List[str]) -> Dict[str, Any]:
    """One cycle: drop some from pool, add new offline players, refresh last_seen for everyone in pool."""
    cfg = await load_presence_config(db)
    if not cfg.get("enabled"):
        return cfg

    now = datetime.now(timezone.utc)
    ten_min_ago = now - timedelta(minutes=10)
    now_iso = now.isoformat()

    active: List[str] = list(cfg.get("active_user_ids") or [])
    max_pool = int(cfg["max_pool"])
    min_add = int(cfg["min_add_per_tick"])
    max_add = int(cfg["max_add_per_tick"])
    max_remove = int(cfg["max_remove_per_tick"])

    # Let a few drift "offline" (stop refreshing — last_seen ages out after 10m)
    remove_n = random.randint(0, min(max_remove, len(active)))
    for _ in range(remove_n):
        if not active:
            break
        active.remove(random.choice(active))

    add_n = random.randint(min_add, max_add)
    room = max_pool - len(active)
    add_n = min(add_n, max(0, room))

    offline_match: Dict[str, Any] = {
        "is_npc": {"$ne": True},
        "is_dead": {"$ne": True},
        "is_bodyguard": {"$ne": True},
        "is_moderator": {"$ne": True},
        "account_locked": {"$ne": True},
        "$or": [
            {"last_seen": {"$lt": ten_min_ago.isoformat()}},
            {"last_seen": None},
            {"last_seen": {"$exists": False}},
        ],
        "$and": [
            {
                "$or": [
                    {"forced_online_until": {"$exists": False}},
                    {"forced_online_until": None},
                    {"forced_online_until": {"$lte": now_iso}},
                ]
            },
            {
                "$or": [
                    {"auto_rank_enabled": {"$ne": True}},
                    {"auto_rank_idle": True},
                ]
            },
        ],
    }
    if admin_emails:
        offline_match["email"] = {"$nin": list(admin_emails)}

    if active:
        offline_match["id"] = {"$nin": active}

    cursor = db.users.find(offline_match, {"_id": 0, "id": 1})
    candidates = await cursor.limit(250).to_list(250)
    random.shuffle(candidates)
    seen_new = 0
    for doc in candidates:
        if seen_new >= add_n:
            break
        uid = (doc.get("id") or "").strip()
        if not uid or uid in active:
            continue
        active.append(uid)
        seen_new += 1

    # Refresh everyone still in pool so they stay in the 5m / 10m online windows
    for uid in active:
        path = random.choice(_SIM_PAGES)
        try:
            await db.users.update_one(
                {"id": uid},
                {
                    "$set": {
                        "last_seen": now_iso,
                        "last_path": path[:500],
                        "last_action_page": path[:120],
                        "last_action_at": now_iso,
                    }
                },
            )
        except Exception:
            logger.exception("presence_simulator refresh failed for %s", uid)

    cfg["active_user_ids"] = active
    cfg["last_tick_at"] = now_iso
    cfg["ticks_total"] = int(cfg.get("ticks_total") or 0) + 1
    await save_presence_config(db, cfg)
    logger.info(
        "presence_simulator tick: pool=%s added=%s removed_prior=%s",
        len(active),
        seen_new,
        remove_n,
    )
    return cfg


async def run_presence_simulator_loop() -> None:
    import server as srv

    db = srv.db
    admin_emails = list(srv.ADMIN_EMAILS or [])
    await asyncio.sleep(45)
    while True:
        try:
            cfg = await load_presence_config(db)
            interval = int(cfg.get("interval_seconds") or 300)
            interval = max(120, min(3600, interval))
            if cfg.get("enabled"):
                await presence_simulator_tick(db, admin_emails)
                await asyncio.sleep(interval)
            else:
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("presence_simulator loop")
            await asyncio.sleep(120)
