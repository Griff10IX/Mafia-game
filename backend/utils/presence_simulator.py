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
_SIM_AR_PREV_FIELD = "presence_simulator_auto_rank_prev"
_SIM_AR_MANAGED_FIELD = "presence_simulator_auto_rank_managed"

# Only one tick at a time (background loop + admin "run now" + multi-worker overlap reduced per process).
_tick_lock = asyncio.Lock()

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
        "max_add_per_tick": 2,
        "max_remove_per_tick": 1,
        "max_pool": 25,
        "min_seconds_between_ticks": 45,
        "stagger_seconds_max": None,  # None = auto from interval (spread last_seen so idle/offline fades gradually)
        "skip_usernames": [],  # lowercase compared; never added to pool; removed from pool if already present
        "gradual_add": True,  # space out DB updates for new pool members across seconds_between_adds
        "seconds_between_adds": 25,
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
    out["min_seconds_between_ticks"] = max(15, min(600, int(out.get("min_seconds_between_ticks") or 45)))
    ssm = out.get("stagger_seconds_max")
    if ssm is not None:
        out["stagger_seconds_max"] = max(0, min(900, int(ssm)))
    ids = out.get("active_user_ids") or []
    out["active_user_ids"] = [str(x).strip() for x in ids if str(x).strip()]
    raw_skip = out.get("skip_usernames") or []
    skip_list: List[str] = []
    if isinstance(raw_skip, list):
        for x in raw_skip[:500]:
            s = str(x).strip()
            if s:
                skip_list.append(s[:64])
    out["skip_usernames"] = skip_list
    out["gradual_add"] = bool(out.get("gradual_add", True))
    out["seconds_between_adds"] = max(5, min(300, int(out.get("seconds_between_adds") or 25)))
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


def _effective_stagger_seconds(cfg: Dict[str, Any]) -> int:
    """Spread last_seen within [0, N] seconds in the past so online/idle/offline boundaries don’t all hit at once."""
    raw = cfg.get("stagger_seconds_max")
    if raw is not None:
        return int(raw)
    interval_sec = int(cfg.get("interval_seconds") or 300)
    # Stay inside the 5m “online” window right after a tick (cap 4m back); still spreads drop-off over time.
    return min(4 * 60, max(30, int(interval_sec * 0.85)))


def _staggered_last_seen(now: datetime, spread_secs: int) -> str:
    if spread_secs <= 0:
        return now.isoformat()
    ago = random.randint(0, int(spread_secs))
    return (now - timedelta(seconds=ago)).isoformat()


def _skip_username_set(cfg: Dict[str, Any]) -> set:
    raw = cfg.get("skip_usernames") or []
    out = set()
    if not isinstance(raw, list):
        return out
    for x in raw:
        s = str(x).strip().lower()
        if s:
            out.add(s[:64])
    return out


async def _filter_active_skip_skipped(db, active_ids: List[str], skip_set: set) -> List[str]:
    """Drop pool members whose username is in skip_set (case-insensitive)."""
    if not active_ids or not skip_set:
        return active_ids
    users = await db.users.find({"id": {"$in": active_ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(len(active_ids) + 10)
    by_id = {str(u.get("id") or "").strip(): u for u in users}
    kept: List[str] = []
    for uid in active_ids:
        u = by_id.get(uid)
        if not u:
            kept.append(uid)
            continue
        un = str(u.get("username") or "").strip().lower()
        if un in skip_set:
            continue
        kept.append(uid)
    return kept


async def _refresh_sim_user(db, uid: str, now: datetime, spread_secs: int) -> None:
    path = random.choice(_SIM_PAGES)
    ls = _staggered_last_seen(now, spread_secs)
    await db.users.update_one(
        {"id": uid},
        {
            "$set": {
                "last_seen": ls,
                "last_path": path[:500],
                "last_action_page": path[:120],
                "last_action_at": ls,
            }
        },
    )


def _sim_mode_for_index(seed: int, idx: int) -> str:
    return "crimes" if ((seed + idx) % 2 == 0) else "gta"


async def _enable_sim_autorank_for_new(db, new_ids: List[str], seed: int) -> None:
    """Enable autorank for new simulated users and alternate mode (crimes vs gta)."""
    for i, uid in enumerate(new_ids):
        if not uid:
            continue
        mode = _sim_mode_for_index(seed, i)
        user = await db.users.find_one(
            {"id": uid},
            {
                "_id": 0,
                "id": 1,
                "auto_rank_purchased": 1,
                "auto_rank_enabled": 1,
                "auto_rank_crimes": 1,
                "auto_rank_gta": 1,
                "auto_rank_bust_every_5_sec": 1,
                "auto_rank_oc": 1,
                "auto_rank_booze": 1,
                "auto_rank_melt": 1,
                "auto_rank_scrap": 1,
                _SIM_AR_MANAGED_FIELD: 1,
            },
        )
        if not user:
            continue
        prev = {
            "auto_rank_purchased": bool(user.get("auto_rank_purchased")),
            "auto_rank_enabled": bool(user.get("auto_rank_enabled")),
            "auto_rank_crimes": bool(user.get("auto_rank_crimes")),
            "auto_rank_gta": bool(user.get("auto_rank_gta")),
            "auto_rank_bust_every_5_sec": bool(user.get("auto_rank_bust_every_5_sec")),
            "auto_rank_oc": bool(user.get("auto_rank_oc")),
            "auto_rank_booze": bool(user.get("auto_rank_booze")),
            "auto_rank_melt": bool(user.get("auto_rank_melt")),
            "auto_rank_scrap": bool(user.get("auto_rank_scrap")),
        }
        updates = {
            "auto_rank_purchased": True,
            "auto_rank_enabled": True,
            "auto_rank_crimes": mode == "crimes",
            "auto_rank_gta": mode == "gta",
            "auto_rank_bust_every_5_sec": False,
            "auto_rank_oc": False,
            "auto_rank_booze": False,
            "auto_rank_melt": False,
            "auto_rank_scrap": False,
            _SIM_AR_MANAGED_FIELD: True,
        }
        if not bool(user.get(_SIM_AR_MANAGED_FIELD)):
            updates[_SIM_AR_PREV_FIELD] = prev
        await db.users.update_one({"id": uid}, {"$set": updates})


async def _disable_sim_autorank_for_removed(db, removed_ids: List[str]) -> None:
    """Restore prior autorank settings for users removed from simulated active pool."""
    for uid in removed_ids:
        if not uid:
            continue
        user = await db.users.find_one(
            {"id": uid, _SIM_AR_MANAGED_FIELD: True},
            {"_id": 0, _SIM_AR_PREV_FIELD: 1},
        )
        if not user:
            continue
        prev = user.get(_SIM_AR_PREV_FIELD) if isinstance(user.get(_SIM_AR_PREV_FIELD), dict) else {}
        restore = {
            "auto_rank_purchased": bool(prev.get("auto_rank_purchased", False)),
            "auto_rank_enabled": bool(prev.get("auto_rank_enabled", False)),
            "auto_rank_crimes": bool(prev.get("auto_rank_crimes", False)),
            "auto_rank_gta": bool(prev.get("auto_rank_gta", False)),
            "auto_rank_bust_every_5_sec": bool(prev.get("auto_rank_bust_every_5_sec", False)),
            "auto_rank_oc": bool(prev.get("auto_rank_oc", False)),
            "auto_rank_booze": bool(prev.get("auto_rank_booze", False)),
            "auto_rank_melt": bool(prev.get("auto_rank_melt", False)),
            "auto_rank_scrap": bool(prev.get("auto_rank_scrap", False)),
        }
        await db.users.update_one(
            {"id": uid},
            {
                "$set": restore,
                "$unset": {
                    _SIM_AR_PREV_FIELD: "",
                    _SIM_AR_MANAGED_FIELD: "",
                },
            },
        )


async def clear_presence_simulator_autorank(db) -> int:
    """Disable simulator-managed autorank and clear simulator markers for all users."""
    rows = await db.users.find(
        {_SIM_AR_MANAGED_FIELD: True},
        {"_id": 0, "id": 1, _SIM_AR_PREV_FIELD: 1},
    ).to_list(5000)
    restored = 0
    for row in rows:
        uid = str(row.get("id") or "").strip()
        if not uid:
            continue
        prev = row.get(_SIM_AR_PREV_FIELD) if isinstance(row.get(_SIM_AR_PREV_FIELD), dict) else {}
        restore = {
            "auto_rank_purchased": bool(prev.get("auto_rank_purchased", False)),
            "auto_rank_enabled": bool(prev.get("auto_rank_enabled", False)),
            "auto_rank_crimes": bool(prev.get("auto_rank_crimes", False)),
            "auto_rank_gta": bool(prev.get("auto_rank_gta", False)),
            "auto_rank_bust_every_5_sec": bool(prev.get("auto_rank_bust_every_5_sec", False)),
            "auto_rank_oc": bool(prev.get("auto_rank_oc", False)),
            "auto_rank_booze": bool(prev.get("auto_rank_booze", False)),
            "auto_rank_melt": bool(prev.get("auto_rank_melt", False)),
            "auto_rank_scrap": bool(prev.get("auto_rank_scrap", False)),
        }
        res = await db.users.update_one(
            {"id": uid},
            {
                "$set": restore,
                "$unset": {
                    _SIM_AR_PREV_FIELD: "",
                    _SIM_AR_MANAGED_FIELD: "",
                },
            },
        )
        if res.modified_count:
            restored += 1
    return restored


async def presence_simulator_tick(db, admin_emails: List[str], *, force: bool = False) -> Dict[str, Any]:
    """One cycle: drop some from pool, add new offline players, refresh last_seen for everyone in pool."""
    async with _tick_lock:
        return await _presence_simulator_tick_impl(db, admin_emails, force=force)


async def _presence_simulator_tick_impl(db, admin_emails: List[str], *, force: bool) -> Dict[str, Any]:
    cfg = await load_presence_config(db)
    if not cfg.get("enabled"):
        return cfg

    now = datetime.now(timezone.utc)
    min_gap = int(cfg.get("min_seconds_between_ticks") or 45)
    last_raw = cfg.get("last_tick_at")
    if not force and last_raw:
        try:
            last_dt = datetime.fromisoformat(str(last_raw).replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            if (now - last_dt).total_seconds() < min_gap:
                logger.info(
                    "presence_simulator tick skipped (%.0fs since last; min_gap=%ss, force=%s)",
                    (now - last_dt).total_seconds(),
                    min_gap,
                    force,
                )
                return cfg
        except Exception:
            pass

    ten_min_ago = now - timedelta(minutes=10)
    now_iso = now.isoformat()
    spread_secs = _effective_stagger_seconds(cfg)
    skip_set = _skip_username_set(cfg)
    gradual = bool(cfg.get("gradual_add", True))
    sec_between_raw = max(5, min(300, int(cfg.get("seconds_between_adds") or 25)))

    active: List[str] = list(cfg.get("active_user_ids") or [])
    active_before = list(active)
    max_pool = int(cfg["max_pool"])
    min_add = int(cfg["min_add_per_tick"])
    max_add = int(cfg["max_add_per_tick"])
    max_remove = int(cfg["max_remove_per_tick"])

    # At most one removal when max_remove is 1 (0 or 1); still random so some ticks make no removals.
    remove_cap = min(max_remove, len(active))
    remove_n = random.randint(0, remove_cap) if remove_cap > 0 else 0
    for _ in range(remove_n):
        if not active:
            break
        active.remove(random.choice(active))

    active = await _filter_active_skip_skipped(db, active, skip_set)
    removed_ids = [uid for uid in active_before if uid not in active]

    add_n = random.randint(min_add, max_add) if max_add > 0 and min_add <= max_add else 0
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

    cursor = db.users.find(offline_match, {"_id": 0, "id": 1, "username": 1})
    candidates = await cursor.limit(250).to_list(250)
    random.shuffle(candidates)
    pool_before_add = list(active)
    to_add_docs: List[Dict[str, Any]] = []
    for doc in candidates:
        if len(to_add_docs) >= add_n:
            break
        uid = (doc.get("id") or "").strip()
        if not uid or uid in active:
            continue
        un = str(doc.get("username") or "").strip().lower()
        if un in skip_set:
            continue
        to_add_docs.append(doc)

    new_ids = [(d.get("id") or "").strip() for d in to_add_docs]
    seen_new = len(new_ids)
    for uid in new_ids:
        if uid:
            active.append(uid)

    if removed_ids:
        try:
            await _disable_sim_autorank_for_removed(db, removed_ids)
        except Exception:
            logger.exception("presence_simulator autorank disable failed (removed=%s)", len(removed_ids))
    if new_ids:
        try:
            seed = int(cfg.get("ticks_total") or 0)
            await _enable_sim_autorank_for_new(db, new_ids, seed)
        except Exception:
            logger.exception("presence_simulator autorank enable failed (new=%s)", len(new_ids))

    # Cap total sleep so one tick doesn't block longer than most of the configured interval.
    interval_sec = max(120, min(3600, int(cfg.get("interval_seconds") or 300)))
    max_spread = max(0, int(interval_sec * 0.85))
    sec_between = sec_between_raw
    if gradual and len(new_ids) > 1 and max_spread > 0:
        need = (len(new_ids) - 1) * sec_between
        if need > max_spread:
            sec_between = max(5, max_spread // max(1, len(new_ids) - 1))

    # Existing pool first (single batch), then new members with optional delay between each so they appear gradually.
    for uid in pool_before_add:
        try:
            await _refresh_sim_user(db, uid, now, spread_secs)
        except Exception:
            logger.exception("presence_simulator refresh failed for %s", uid)

    for i, uid in enumerate(new_ids):
        if not uid:
            continue
        if gradual and i > 0:
            await asyncio.sleep(float(sec_between))
        try:
            await _refresh_sim_user(db, uid, now, spread_secs)
        except Exception:
            logger.exception("presence_simulator refresh failed for %s", uid)

    cfg["active_user_ids"] = active
    cfg["last_tick_at"] = now_iso
    cfg["ticks_total"] = int(cfg.get("ticks_total") or 0) + 1
    await save_presence_config(db, cfg)
    logger.info(
        "presence_simulator tick: pool=%s added=%s removed_prior=%s spread_s=%s gradual=%s skip_n=%s",
        len(active),
        seen_new,
        remove_n,
        spread_secs,
        gradual,
        len(skip_set),
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
