# Background task: gently bump last_seen for a rotating pool of real (non-NPC) users so the game looks more active.
# Config persisted in game_settings key "presence_simulator". Admin-only API in routers/admin.
# Does not enable, disable, or overwrite Auto Rank — that was wiping real players' task ticks.
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
        "read_game_chat": True,  # drip viewed_by on recent game chat; never the whole pool at once
        "chat_readers_min": 1,
        "chat_readers_max": 3,
        "chat_marks_min": 1,
        "chat_marks_max": 3,
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
    out["read_game_chat"] = bool(out.get("read_game_chat", True))
    out["chat_readers_min"] = max(0, min(8, int(out.get("chat_readers_min") if out.get("chat_readers_min") is not None else 1)))
    out["chat_readers_max"] = max(
        out["chat_readers_min"],
        min(10, int(out.get("chat_readers_max") if out.get("chat_readers_max") is not None else 3)),
    )
    out["chat_marks_min"] = max(1, min(8, int(out.get("chat_marks_min") or 1)))
    out["chat_marks_max"] = max(
        out["chat_marks_min"],
        min(10, int(out.get("chat_marks_max") or 3)),
    )
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


_CHAT_LOOKBACK = 12
_CHAT_RETENTION_DAYS = 7


async def _recent_game_chat_messages(
    db, *, channel: str, family_id: Optional[str] = None, limit: int = _CHAT_LOOKBACK
) -> List[Dict[str, Any]]:
    """Newest on-screen messages only — same window a real open chat would see."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=_CHAT_RETENTION_DAYS)).isoformat()
    if channel == "family":
        if not family_id:
            return []
        query: Dict[str, Any] = {
            "channel": "family",
            "family_id": family_id,
            "created_at": {"$gte": cutoff},
        }
    else:
        query = {
            "$and": [
                {
                    "$or": [
                        {"channel": "global"},
                        {"channel": {"$exists": False}},
                        {"channel": None},
                    ]
                },
                {"created_at": {"$gte": cutoff}},
            ]
        }
    return await db.game_chat_messages.find(
        query, {"_id": 0, "id": 1, "user_id": 1, "viewed_by": 1}
    ).sort("created_at", -1).limit(limit).to_list(limit)


def _unread_chat_ids(messages: List[Dict[str, Any]], viewer_id: str, mark_n: int) -> List[str]:
    ids: List[str] = []
    if not viewer_id or mark_n <= 0:
        return ids
    for msg in messages:
        mid = msg.get("id")
        author = msg.get("user_id")
        if not mid or not author or author == viewer_id:
            continue
        viewed = msg.get("viewed_by")
        viewed_set = {str(x) for x in viewed if x} if isinstance(viewed, list) else set()
        if viewer_id in viewed_set:
            continue
        ids.append(str(mid))
        if len(ids) >= mark_n:
            break
    return ids


def _remember_chat_views(messages: List[Dict[str, Any]], viewer_id: str, marked_ids: List[str]) -> None:
    """Keep this tick's later readers off the same newest lines so counts drip downward."""
    if not marked_ids:
        return
    marked = set(marked_ids)
    for msg in messages:
        if msg.get("id") not in marked:
            continue
        viewed = list(msg.get("viewed_by") or [])
        if viewer_id not in viewed:
            viewed.append(viewer_id)
            msg["viewed_by"] = viewed


async def _mark_chat_views_for_user(db, viewer_id: str, messages: List[Dict[str, Any]], mark_n: int) -> int:
    ids = _unread_chat_ids(messages, viewer_id, mark_n)
    if not ids:
        return 0
    await db.game_chat_messages.update_many(
        {"id": {"$in": ids}},
        {"$addToSet": {"viewed_by": viewer_id}},
    )
    _remember_chat_views(messages, viewer_id, ids)
    return len(ids)


async def _sim_read_game_chat(db, active_ids: List[str], cfg: Dict[str, Any]) -> Dict[str, int]:
    """A few pool members open chat and mark a couple of newest unread lines — not the whole pool."""
    empty = {"readers": 0, "marked": 0}
    if not cfg.get("read_game_chat", True):
        return empty
    pool = [uid for uid in (active_ids or []) if uid]
    if not pool:
        return empty
    readers_min = int(cfg.get("chat_readers_min") or 0)
    readers_max = int(cfg.get("chat_readers_max") or 3)
    if readers_max <= 0:
        return empty
    n = random.randint(readers_min, min(readers_max, len(pool)))
    if n <= 0:
        return empty
    random.shuffle(pool)
    chosen = pool[:n]
    users = await db.users.find(
        {"id": {"$in": chosen}},
        {"_id": 0, "id": 1, "family_id": 1},
    ).to_list(len(chosen) + 2)
    by_id = {str(u.get("id") or ""): u for u in users}
    global_msgs = await _recent_game_chat_messages(db, channel="global")
    family_cache: Dict[str, List[Dict[str, Any]]] = {}
    marks_min = int(cfg.get("chat_marks_min") or 1)
    marks_max = int(cfg.get("chat_marks_max") or 3)
    readers = 0
    marked = 0
    for i, uid in enumerate(chosen):
        if i > 0:
            await asyncio.sleep(random.uniform(0.8, 2.5))
        mark_n = random.randint(marks_min, marks_max)
        n_g = await _mark_chat_views_for_user(db, uid, global_msgs, mark_n)
        n_f = 0
        fam = (by_id.get(uid) or {}).get("family_id")
        if fam and random.random() < 0.35:
            if fam not in family_cache:
                family_cache[fam] = await _recent_game_chat_messages(
                    db, channel="family", family_id=str(fam)
                )
            n_f = await _mark_chat_views_for_user(
                db, uid, family_cache[fam], random.randint(1, min(2, mark_n))
            )
        if n_g or n_f:
            readers += 1
            marked += n_g + n_f
    return {"readers": readers, "marked": marked}


_HEARTBEAT_STALE_SEC = 150  # refresh before the 5-minute "online" window ends
_HEARTBEAT_SPREAD_SEC = 20
_HEARTBEAT_LOOP_SEC = 40
_HEARTBEAT_MAX_REFRESH = 2  # roster moves by 1–2, not the whole pool


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


def _last_seen_age_seconds(raw: Any, now: datetime) -> Optional[float]:
    dt = _parse_iso(raw)
    if not dt:
        return None
    return (now - dt).total_seconds()


async def _heartbeat_pool_last_seen(db, active_ids: List[str], now: datetime) -> int:
    """Bump a couple of stale pool members so they drift on/off the roster instead of snapping as a pack."""
    pool = [str(uid).strip() for uid in (active_ids or []) if str(uid).strip()]
    if not pool:
        return 0
    users = await db.users.find(
        {"id": {"$in": pool}, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1, "last_seen": 1},
    ).to_list(len(pool) + 5)
    stale: List[str] = []
    for u in users:
        uid = str(u.get("id") or "").strip()
        if not uid:
            continue
        age = _last_seen_age_seconds(u.get("last_seen"), now)
        if age is None or age >= _HEARTBEAT_STALE_SEC:
            stale.append(uid)
    if not stale:
        return 0
    random.shuffle(stale)
    n = 0
    for uid in stale[:_HEARTBEAT_MAX_REFRESH]:
        try:
            await _refresh_sim_user(db, uid, now, _HEARTBEAT_SPREAD_SEC)
            n += 1
            if n < _HEARTBEAT_MAX_REFRESH:
                await asyncio.sleep(random.uniform(0.4, 1.2))
        except Exception:
            logger.exception("presence_simulator heartbeat refresh failed for %s", uid)
    if n:
        logger.info(
            "presence_simulator heartbeat refreshed=%s stale=%s pool=%s",
            n,
            len(stale),
            len(pool),
        )
    return n


_AR_TOGGLE_FIELDS = (
    "auto_rank_purchased",
    "auto_rank_enabled",
    "auto_rank_crimes",
    "auto_rank_gta",
    "auto_rank_bust_every_5_sec",
    "auto_rank_oc",
    "auto_rank_booze",
    "auto_rank_melt",
    "auto_rank_scrap",
)


def _parse_iso(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _user_had_real_auto_rank(user: dict, prev: dict) -> bool:
    """True if Auto Rank was theirs — keep their current ticks, do not restore the sim snapshot."""
    if user.get("auto_rank_permanent") or user.get("auto_rank_email_entitlement"):
        return True
    if prev.get("auto_rank_purchased"):
        return True
    until = _parse_iso(user.get("auto_rank_trial_until"))
    if until and until > datetime.now(timezone.utc):
        return True
    return False


def _restore_autorank_from_prev(prev: dict) -> dict:
    return {k: bool(prev.get(k, False)) for k in _AR_TOGGLE_FIELDS}


async def _release_sim_autorank(db, user_ids: Optional[List[str]] = None) -> int:
    """Drop simulator Auto Rank ownership. Keep real buyers' ticks; undo fake grants."""
    query: Dict[str, Any] = {_SIM_AR_MANAGED_FIELD: True}
    if user_ids is not None:
        ids = [str(x).strip() for x in user_ids if str(x).strip()]
        if not ids:
            return 0
        query["id"] = {"$in": ids}
    rows = await db.users.find(
        query,
        {
            "_id": 0,
            "id": 1,
            _SIM_AR_PREV_FIELD: 1,
            "auto_rank_permanent": 1,
            "auto_rank_email_entitlement": 1,
            "auto_rank_trial_until": 1,
        },
    ).to_list(5000)
    released = 0
    unset = {_SIM_AR_PREV_FIELD: "", _SIM_AR_MANAGED_FIELD: ""}
    for row in rows:
        uid = str(row.get("id") or "").strip()
        if not uid:
            continue
        prev = row.get(_SIM_AR_PREV_FIELD) if isinstance(row.get(_SIM_AR_PREV_FIELD), dict) else {}
        if _user_had_real_auto_rank(row, prev):
            op = {"$unset": unset}
        else:
            op = {"$set": _restore_autorank_from_prev(prev), "$unset": unset}
        res = await db.users.update_one({"id": uid}, op)
        if res.modified_count:
            released += 1
    return released


async def clear_presence_simulator_autorank(db) -> int:
    """Clear leftover simulator Auto Rank markers (keeps real buyers' current ticks)."""
    return await _release_sim_autorank(db)


async def presence_simulator_tick(db, admin_emails: List[str], *, force: bool = False) -> Dict[str, Any]:
    """Heartbeat a couple of pool last_seens; on interval, rotate who is in the pool (no full-pool bump)."""
    async with _tick_lock:
        return await _presence_simulator_tick_impl(db, admin_emails, force=force)


async def _presence_simulator_tick_impl(db, admin_emails: List[str], *, force: bool) -> Dict[str, Any]:
    cfg = await load_presence_config(db)
    if not cfg.get("enabled"):
        return cfg

    try:
        released = await _release_sim_autorank(db)
        if released:
            logger.info("presence_simulator released leftover Auto Rank overrides n=%s", released)
    except Exception:
        logger.exception("presence_simulator autorank release failed")

    now = datetime.now(timezone.utc)
    active: List[str] = list(cfg.get("active_user_ids") or [])
    try:
        await _heartbeat_pool_last_seen(db, active, now)
    except Exception:
        logger.exception("presence_simulator heartbeat failed")

    interval_sec = max(120, min(3600, int(cfg.get("interval_seconds") or 300)))
    last_raw = cfg.get("last_tick_at")
    due = bool(force)
    if not due:
        if not last_raw:
            due = True
        else:
            last_dt = _parse_iso(last_raw)
            if not last_dt:
                due = True
            elif (now - last_dt).total_seconds() >= interval_sec:
                due = True
    if not due:
        return cfg

    ten_min_ago = now - timedelta(minutes=10)
    now_iso = now.isoformat()
    skip_set = _skip_username_set(cfg)

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
            {
                "auto_rank_purchased": {"$ne": True},
                "auto_rank_permanent": {"$ne": True},
                "auto_rank_email_entitlement": {"$ne": True},
            },
        ],
    }
    skip_ids = list(active or [])
    if admin_emails:
        try:
            import server as srv
            admin_ids = await srv._get_admin_user_ids(db)
            for uid in admin_ids or []:
                if uid and uid not in skip_ids:
                    skip_ids.append(uid)
        except Exception:
            logger.debug("presence simulator: admin id lookup failed", exc_info=True)
    if skip_ids:
        offline_match["id"] = {"$nin": skip_ids}

    cursor = db.users.find(offline_match, {"_id": 0, "id": 1, "username": 1})
    candidates = await cursor.limit(250).to_list(250)
    random.shuffle(candidates)
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
            await _release_sim_autorank(db, removed_ids)
        except Exception:
            logger.exception("presence_simulator autorank release failed (removed=%s)", len(removed_ids))

    chat_stats = {"readers": 0, "marked": 0}
    try:
        chat_stats = await _sim_read_game_chat(db, active, cfg)
    except Exception:
        logger.exception("presence_simulator game chat read failed")

    cfg["active_user_ids"] = active
    cfg["last_tick_at"] = now_iso
    cfg["ticks_total"] = int(cfg.get("ticks_total") or 0) + 1
    await save_presence_config(db, cfg)
    logger.info(
        "presence_simulator rotate: pool=%s added=%s removed=%s skip_n=%s chat_readers=%s chat_marked=%s",
        len(active),
        seen_new,
        remove_n,
        len(skip_set),
        chat_stats.get("readers") or 0,
        chat_stats.get("marked") or 0,
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
            if cfg.get("enabled"):
                await presence_simulator_tick(db, admin_emails)
                await asyncio.sleep(_HEARTBEAT_LOOP_SEC)
            else:
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("presence_simulator loop")
            await asyncio.sleep(120)
