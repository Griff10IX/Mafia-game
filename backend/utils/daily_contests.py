"""Competitive contest events: 6h windows (Mission Marathon 48h), ranked prizes.

One active contest at a time. Never schedules the same type back-to-back.
Score hooks call record_contest_progress from gameplay success paths.
"""
from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from pymongo import ReturnDocument

logger = logging.getLogger(__name__)

CONFIG_ID = "contest_events"
COL_EVENTS = "contest_events"
COL_SCORES = "contest_scores"

# User charge fields for buff prizes
FIELD_GTA_UR_LEG_CHARGES = "contest_gta_ur_leg_charges"
FIELD_GTA_ALWAYS_SUCCESS_CHARGES = "contest_gta_always_success_charges"
FIELD_GRAVE_PROFIT_CHARGES = "contest_grave_profit_charges"
FIELD_CRIME_GTA_ALWAYS_UNTIL = "contest_crime_gta_always_until"
FIELD_CRIME_GTA_DOUBLE_RP_UNTIL = "contest_crime_gta_double_rp_until"

STAFF_EXCLUDE_IDS = frozenset(
    {
        "36425cb4-3755-4669-b4b5-5d86345991d0",  # GhostFace
    }
)


async def contest_excluded_user_ids(db) -> set:
    """Admins, moderators, and hardcoded staff accounts. They do not score or place."""
    ids = {str(x) for x in STAFF_EXCLUDE_IDS}
    try:
        from server import _get_staff_user_ids

        ids.update(str(x) for x in (await _get_staff_user_ids(db)) if x)
    except Exception:
        logger.exception("contest staff id lookup failed")
    return ids


def _prize(*parts: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [p for p in parts if p]


def _p(kind: str, amount: int = 0, **extra: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {"kind": kind, "amount": int(amount)}
    out.update(extra)
    return out


def _label_parts(prizes: List[Dict[str, Any]]) -> str:
    bits: List[str] = []
    for p in prizes:
        k = p.get("kind")
        a = int(p.get("amount") or 0)
        if k == "points":
            bits.append(f"{a:,} points")
        elif k == "rank_points":
            bits.append(f"{a:,} respect")
        elif k == "bullets":
            bits.append(f"{a:,} bullets")
        elif k == "cash":
            bits.append(f"${a:,}")
        elif k == "loot_pieces":
            bits.append(f"{a} loot pieces")
        elif k == "robot_bg_token":
            bits.append(f"{a} robot bodyguard token" + ("s" if a != 1 else ""))
        elif k == "mission_skip":
            bits.append(f"{a} mission skip" + ("s" if a != 1 else ""))
        elif k == "xp_token":
            bits.append(f"{a} XP token" + ("s" if a != 1 else ""))
        elif k == "melt_token":
            bits.append(f"{a} melt token" + ("s" if a != 1 else ""))
        elif k == "wof_spins":
            bits.append(f"{a} Wheel of Fortune free spin" + ("s" if a != 1 else ""))
        elif k == "buff_charges_gta_ur_leg":
            bits.append(f"next {a} GTAs Ultra Rare or Legendary (50/50)")
        elif k == "buff_charges_gta_success":
            bits.append(f"next {a} GTAs always succeed")
        elif k == "buff_charges_grave_profit":
            bits.append(f"next {a} digs always profit")
        elif k == "buff_timed":
            mins = int(p.get("minutes") or 0)
            mode = str(p.get("mode") or "")
            if mode == "always_succeed":
                bits.append(f"{mins // 60}h Crimes+GTA auto-succeed" if mins >= 60 else f"{mins}m Crimes+GTA auto-succeed")
            elif mode == "double_rp":
                bits.append(f"{mins}m ×2 rank points from Crimes+GTA")
            else:
                bits.append(f"{mins}m buff")
    return " + ".join(bits) if bits else "nothing"


# --- Prize tables ---

def _crime_prizes() -> Dict[int, List[Dict[str, Any]]]:
    return {
        1: _prize(_p("points", 1000)),
        2: _prize(_p("points", 500)),
        3: _prize(_p("robot_bg_token", 1)),
    }


def _gta_prizes() -> Dict[int, List[Dict[str, Any]]]:
    charges = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5]
    return {i + 1: _prize(_p("buff_charges_gta_ur_leg", charges[i])) for i in range(10)}


def _street_prizes() -> Dict[int, List[Dict[str, Any]]]:
    out: Dict[int, List[Dict[str, Any]]] = {}
    for rank in range(1, 11):
        if rank % 2 == 1:
            out[rank] = _prize(_p("buff_timed", 0, mode="always_succeed", minutes=60))
        else:
            out[rank] = _prize(_p("buff_timed", 0, mode="double_rp", minutes=45))
    return out


def _melt_prizes() -> Dict[int, List[Dict[str, Any]]]:
    return {
        1: _prize(_p("bullets", 25_000)),
        2: _prize(_p("bullets", 15_000)),
        3: _prize(_p("bullets", 5_000)),
        4: _prize(_p("xp_token", 5)),
        5: _prize(_p("xp_token", 2)),
        6: _prize(_p("xp_token", 1)),
        7: _prize(_p("points", 5)),
        8: _prize(_p("points", 1)),
    }


def _jailbust_prizes() -> Dict[int, List[Dict[str, Any]]]:
    cash = [
        2_500_000_000,
        2_000_000_000,
        1_500_000_000,
        1_000_000_000,
        750_000_000,
        500_000_000,
        350_000_000,
        250_000_000,
        150_000_000,
        100_000_000,
    ]
    out: Dict[int, List[Dict[str, Any]]] = {}
    for i, c in enumerate(cash):
        rank = i + 1
        parts = [_p("cash", c)]
        if rank == 1:
            parts.append(_p("loot_pieces", 10))
        elif rank == 2:
            parts.append(_p("loot_pieces", 5))
        out[rank] = _prize(*parts)
    return out


def _booze_prizes() -> Dict[int, List[Dict[str, Any]]]:
    loot = [25, 20, 15, 10, 5]
    spins = [3, 2, 2, 1, 1]
    out: Dict[int, List[Dict[str, Any]]] = {}
    for i, a in enumerate(loot):
        out[i + 1] = _prize(_p("loot_pieces", a))
    for i, a in enumerate(spins):
        out[i + 6] = _prize(_p("wof_spins", a))
    return out


def _racket_prizes() -> Dict[int, List[Dict[str, Any]]]:
    respect = [2500, 2000, 1500, 1200, 1000, 800, 600, 400, 250, 150]
    return {i + 1: _prize(_p("rank_points", respect[i])) for i in range(10)}


def _oc_prizes() -> Dict[int, List[Dict[str, Any]]]:
    out: Dict[int, List[Dict[str, Any]]] = {}
    for rank in (1, 2):
        out[rank] = _prize(_p("mission_skip", 2), _p("points", 200))
    for rank in (3, 4, 5):
        out[rank] = _prize(_p("robot_bg_token", 1))
    for rank in range(6, 11):
        out[rank] = _prize(_p("points", 30))
    return out


def _hitlist_prizes() -> Dict[int, List[Dict[str, Any]]]:
    points = [2000, 1500, 1250, 1000, 750, 500, 400, 300, 200, 100]
    melt = [5, 4, 3, 2, 2, 1, 1, 0, 0, 0]
    bg = [2, 1, 1, 0, 0, 0, 0, 0, 0, 0]
    out: Dict[int, List[Dict[str, Any]]] = {}
    for i in range(10):
        parts = [_p("points", points[i])]
        if melt[i]:
            parts.append(_p("melt_token", melt[i]))
        if bg[i]:
            parts.append(_p("robot_bg_token", bg[i]))
        out[i + 1] = _prize(*parts)
    return out


def _mission_prizes() -> Dict[int, List[Dict[str, Any]]]:
    rows = [
        (5, 100, 50_000, 2500),
        (4, 75, 40_000, 2000),
        (3, 50, 30_000, 1500),
        (2, 35, 20_000, 1000),
        (2, 25, 15_000, 750),
        (1, 15, 10_000, 500),
        (1, 10, 7_500, 350),
        (1, 5, 5_000, 250),
        (0, 3, 2_500, 150),
        (0, 1, 1_000, 100),
    ]
    out: Dict[int, List[Dict[str, Any]]] = {}
    for i, (ms, loot, bul, pts) in enumerate(rows):
        parts = []
        if ms:
            parts.append(_p("mission_skip", ms))
        if loot:
            parts.append(_p("loot_pieces", loot))
        if bul:
            parts.append(_p("bullets", bul))
        if pts:
            parts.append(_p("points", pts))
        out[i + 1] = _prize(*parts)
    return out


def _property_prizes() -> Dict[int, List[Dict[str, Any]]]:
    cash = [
        2_000_000_000,
        1_500_000_000,
        1_000_000_000,
        750_000_000,
        500_000_000,
        350_000_000,
        250_000_000,
        150_000_000,
        100_000_000,
        50_000_000,
    ]
    charges = [100, 80, 60, 50, 40, 30, 25, 20, 15, 10]
    return {
        i + 1: _prize(_p("cash", cash[i]), _p("buff_charges_gta_success", charges[i]))
        for i in range(10)
    }


def _grave_prizes() -> Dict[int, List[Dict[str, Any]]]:
    digs = [25, 20, 15, 12, 10, 8, 6, 4, 2, 1]
    spins = [5, 4, 3, 2, 2, 1, 1, 1, 0, 0]
    out: Dict[int, List[Dict[str, Any]]] = {}
    for i in range(10):
        parts = [_p("buff_charges_grave_profit", digs[i])]
        if spins[i]:
            parts.append(_p("wof_spins", spins[i]))
        out[i + 1] = _prize(*parts)
    return out


CONTEST_TYPES: Dict[str, Dict[str, Any]] = {
    "crime": {
        "id": "crime",
        "name": "Crime Spree",
        "score_key": "crime",
        "duration_hours": 6,
        "prize_table": _crime_prizes(),
    },
    "gta": {
        "id": "gta",
        "name": "Grand Theft",
        "score_key": "gta",
        "duration_hours": 6,
        "prize_table": _gta_prizes(),
    },
    "crime_gta": {
        "id": "crime_gta",
        "name": "Street Run",
        "score_key": "crime_gta",
        "duration_hours": 6,
        "prize_table": _street_prizes(),
    },
    "melt": {
        "id": "melt",
        "name": "Meltdown",
        "score_key": "melt",
        "duration_hours": 6,
        "prize_table": _melt_prizes(),
    },
    "jailbust": {
        "id": "jailbust",
        "name": "Jailbusta",
        "score_key": "jailbust",
        "duration_hours": 6,
        "prize_table": _jailbust_prizes(),
    },
    "booze": {
        "id": "booze",
        "name": "Booze Run",
        "score_key": "booze",
        "duration_hours": 6,
        "prize_table": _booze_prizes(),
    },
    "racket": {
        "id": "racket",
        "name": "Collection Day",
        "score_key": "racket",
        "duration_hours": 6,
        "prize_table": _racket_prizes(),
    },
    "oc": {
        "id": "oc",
        "name": "Crew Work",
        "score_key": "oc",
        "duration_hours": 6,
        "prize_table": _oc_prizes(),
    },
    "hitlist": {
        "id": "hitlist",
        "name": "Hitlist Hunt",
        "score_key": "hitlist",
        "duration_hours": 6,
        "prize_table": _hitlist_prizes(),
    },
    "mission": {
        "id": "mission",
        "name": "Mission Marathon",
        "score_key": "mission",
        "duration_hours": 48,
        "prize_table": _mission_prizes(),
    },
    "property": {
        "id": "property",
        "name": "Landlord",
        "score_key": "property",
        "duration_hours": 6,
        "prize_table": _property_prizes(),
    },
    "grave": {
        "id": "grave",
        "name": "Grave Duty",
        "score_key": "grave",
        "duration_hours": 6,
        "prize_table": _grave_prizes(),
    },
}

CONTEST_TYPE_IDS = tuple(CONTEST_TYPES.keys())
SCORE_KEY_TO_TYPES: Dict[str, Tuple[str, ...]] = {}
for _tid, _meta in CONTEST_TYPES.items():
    sk = str(_meta["score_key"])
    SCORE_KEY_TO_TYPES.setdefault(sk, ())
# rebuild properly
_sk_map: Dict[str, List[str]] = {}
for _tid, _meta in CONTEST_TYPES.items():
    _sk_map.setdefault(str(_meta["score_key"]), []).append(_tid)
SCORE_KEY_TO_TYPES = {k: tuple(v) for k, v in _sk_map.items()}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def prize_table_public(type_id: str) -> List[Dict[str, Any]]:
    meta = CONTEST_TYPES.get(type_id) or {}
    table = meta.get("prize_table") or {}
    rows = []
    for rank in sorted(table.keys()):
        prizes = table[rank]
        rows.append({"rank": rank, "label": _label_parts(prizes), "prizes": prizes})
    return rows


def _pick_next_type(exclude: Optional[str] = None) -> str:
    pool = [t for t in CONTEST_TYPE_IDS if t != exclude]
    if not pool:
        pool = list(CONTEST_TYPE_IDS)
    return random.choice(pool)


async def _get_config(db) -> dict:
    doc = await db.game_config.find_one({"id": CONFIG_ID}) or {}
    return doc


async def _set_previous_type(db, type_id: str) -> None:
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {"$set": {"id": CONFIG_ID, "previous_type_id": type_id}},
        upsert=True,
    )


async def _create_event(db, type_id: str, *, now: Optional[datetime] = None) -> dict:
    now = now or _now()
    meta = CONTEST_TYPES[type_id]
    hours = int(meta.get("duration_hours") or 6)
    ends = now + timedelta(hours=hours)
    doc = {
        "id": str(uuid.uuid4()),
        "type_id": type_id,
        "name": meta["name"],
        "score_key": meta["score_key"],
        "status": "active",
        "starts_at": _iso(now),
        "ends_at": _iso(ends),
        "duration_hours": hours,
        "settled_at": None,
    }
    await db[COL_EVENTS].insert_one(doc)
    return doc


async def settle_contest_if_needed(db, event: dict) -> dict:
    """Settle an expired active contest once; returns updated event doc."""
    if not event or event.get("status") != "active":
        return event
    try:
        ends = datetime.fromisoformat(str(event["ends_at"]).replace("Z", "+00:00"))
    except Exception:
        return event
    if ends.tzinfo is None:
        ends = ends.replace(tzinfo=timezone.utc)
    if _now() < ends:
        return event

    claimed = await db[COL_EVENTS].find_one_and_update(
        {"id": event["id"], "status": "active", "settled_at": None},
        {"$set": {"status": "settling"}},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        return await db[COL_EVENTS].find_one({"id": event["id"]}) or event

    type_id = str(claimed.get("type_id") or "")
    meta = CONTEST_TYPES.get(type_id) or {}
    table = meta.get("prize_table") or {}

    cursor = db[COL_SCORES].find({"event_id": claimed["id"]}).sort(
        [("score", -1), ("updated_at", 1), ("user_id", 1)]
    )
    rankings: List[dict] = []
    place = 0
    staff = await contest_excluded_user_ids(db)
    async for row in cursor:
        uid = str(row.get("user_id") or "")
        if not uid or uid in STAFF_EXCLUDE_IDS or uid in staff:
            continue
        place += 1
        prizes = table.get(place) or []
        rankings.append(
            {
                "rank": place,
                "user_id": uid,
                "score": int(row.get("score") or 0),
                "prize_label": _label_parts(prizes) if prizes else "",
                "prizes": prizes,
            }
        )
        if prizes:
            try:
                await _grant_prizes(db, uid, prizes)
                from utils.system_ai_inbox import send_system_ai_inbox

                await send_system_ai_inbox(
                    uid,
                    f"Contest: {claimed.get('name') or type_id}",
                    f"You placed #{place} in {claimed.get('name') or type_id} — {_label_parts(prizes)}.",
                )
            except Exception:
                logger.exception("contest prize grant failed event=%s user=%s", claimed.get("id"), uid)

    # Attach usernames for Previous / My Wins UI
    if rankings:
        uids = [r["user_id"] for r in rankings]
        names: Dict[str, str] = {}
        async for u in db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "username": 1}):
            names[str(u["id"])] = str(u.get("username") or "Player")
        for r in rankings:
            r["username"] = names.get(r["user_id"]) or "Player"

    now = _now()
    await db[COL_EVENTS].update_one(
        {"id": claimed["id"]},
        {
            "$set": {
                "status": "ended",
                "settled_at": _iso(now),
                "results": rankings[:50],
            }
        },
    )
    await _set_previous_type(db, type_id)
    return await db[COL_EVENTS].find_one({"id": claimed["id"]}) or claimed


async def _grant_prizes(db, user_id: str, prizes: List[Dict[str, Any]]) -> None:
    inc: Dict[str, int] = {}
    sets: Dict[str, Any] = {}
    now = _now()
    for p in prizes:
        k = p.get("kind")
        a = int(p.get("amount") or 0)
        if k == "points" and a:
            inc["points"] = inc.get("points", 0) + a
        elif k == "rank_points" and a:
            inc["rank_points"] = inc.get("rank_points", 0) + a
        elif k == "bullets" and a:
            inc["bullets"] = inc.get("bullets", 0) + a
        elif k == "cash" and a:
            inc["money"] = inc.get("money", 0) + a
        elif k == "loot_pieces" and a:
            inc["loot_box_pieces"] = inc.get("loot_box_pieces", 0) + a
        elif k == "robot_bg_token" and a:
            inc["robot_bodyguard_hire_tokens"] = inc.get("robot_bodyguard_hire_tokens", 0) + a
        elif k == "mission_skip" and a:
            inc["mission_skip_tokens"] = inc.get("mission_skip_tokens", 0) + a
        elif k == "xp_token" and a:
            inc["xp_crimes_tokens"] = inc.get("xp_crimes_tokens", 0) + a
        elif k == "melt_token" and a:
            inc["melt_tokens"] = inc.get("melt_tokens", 0) + a
        elif k == "wof_spins" and a:
            inc["wheel_bonus_free_spins"] = inc.get("wheel_bonus_free_spins", 0) + a
        elif k == "buff_charges_gta_ur_leg" and a:
            inc[FIELD_GTA_UR_LEG_CHARGES] = inc.get(FIELD_GTA_UR_LEG_CHARGES, 0) + a
        elif k == "buff_charges_gta_success" and a:
            inc[FIELD_GTA_ALWAYS_SUCCESS_CHARGES] = inc.get(FIELD_GTA_ALWAYS_SUCCESS_CHARGES, 0) + a
        elif k == "buff_charges_grave_profit" and a:
            inc[FIELD_GRAVE_PROFIT_CHARGES] = inc.get(FIELD_GRAVE_PROFIT_CHARGES, 0) + a
        elif k == "buff_timed":
            mins = int(p.get("minutes") or 0)
            mode = str(p.get("mode") or "")
            until = _iso(now + timedelta(minutes=max(1, mins)))
            if mode == "always_succeed":
                sets[FIELD_CRIME_GTA_ALWAYS_UNTIL] = until
            elif mode == "double_rp":
                sets[FIELD_CRIME_GTA_DOUBLE_RP_UNTIL] = until
    update: Dict[str, Any] = {}
    if inc:
        update["$inc"] = inc
    if sets:
        update["$set"] = sets
    if update:
        await db.users.update_one({"id": user_id}, update)


async def ensure_active_contest(db) -> dict:
    """Return the active contest, settling/rotating as needed."""
    now = _now()
    active = await db[COL_EVENTS].find_one({"status": "active"})
    if active:
        active = await settle_contest_if_needed(db, active)
        if active and active.get("status") == "active":
            return active

    # Also settle any stuck "settling"
    stuck = await db[COL_EVENTS].find_one({"status": "settling"})
    if stuck:
        await db[COL_EVENTS].update_one(
            {"id": stuck["id"], "status": "settling"},
            {"$set": {"status": "ended", "settled_at": _iso(now)}},
        )

    cfg = await _get_config(db)
    prev = str(cfg.get("previous_type_id") or "") or None
    # Prefer last ended type as previous if config empty
    if not prev:
        last = await db[COL_EVENTS].find_one({"status": "ended"}, sort=[("ends_at", -1)])
        if last:
            prev = str(last.get("type_id") or "") or None

    type_id = _pick_next_type(prev)
    return await _create_event(db, type_id, now=now)


async def record_contest_progress(
    db,
    user_id: str,
    score_key: str,
    amount: int = 1,
    *,
    now: Optional[datetime] = None,
) -> None:
    """Bump score if the active contest matches this score_key (or crime_gta for crime/gta)."""
    if not user_id or int(amount or 0) <= 0:
        return
    uid = str(user_id)
    if uid in await contest_excluded_user_ids(db):
        return
    try:
        event = await ensure_active_contest(db)
    except Exception:
        logger.exception("ensure_active_contest failed")
        return
    if not event or event.get("status") != "active":
        return
    sk = str(event.get("score_key") or "")
    key = str(score_key or "").strip()
    matched = False
    if sk == key:
        matched = True
    elif sk == "crime_gta" and key in ("crime", "gta"):
        matched = True
    if not matched:
        return
    now = now or _now()
    await db[COL_SCORES].update_one(
        {"event_id": event["id"], "user_id": uid},
        {
            "$inc": {"score": int(amount)},
            "$set": {"updated_at": _iso(now), "type_id": event.get("type_id")},
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "event_id": event["id"],
                "user_id": uid,
                "created_at": _iso(now),
            },
        },
        upsert=True,
    )


def _parse_until(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def user_has_crime_gta_always(user: Optional[dict]) -> bool:
    until = _parse_until((user or {}).get(FIELD_CRIME_GTA_ALWAYS_UNTIL))
    return bool(until and until > _now())


def user_has_crime_gta_double_rp(user: Optional[dict]) -> bool:
    until = _parse_until((user or {}).get(FIELD_CRIME_GTA_DOUBLE_RP_UNTIL))
    return bool(until and until > _now())


async def consume_gta_always_success_charge(db, user_id: str) -> bool:
    doc = await db.users.find_one_and_update(
        {"id": user_id, FIELD_GTA_ALWAYS_SUCCESS_CHARGES: {"$gte": 1}},
        {"$inc": {FIELD_GTA_ALWAYS_SUCCESS_CHARGES: -1}},
        return_document=ReturnDocument.AFTER,
    )
    return bool(doc)


async def consume_gta_ur_leg_charge(db, user_id: str) -> Optional[str]:
    """Consume one charge; return 'ultra_rare' or 'legendary' or None."""
    doc = await db.users.find_one_and_update(
        {"id": user_id, FIELD_GTA_UR_LEG_CHARGES: {"$gte": 1}},
        {"$inc": {FIELD_GTA_UR_LEG_CHARGES: -1}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        return None
    return "ultra_rare" if random.random() < 0.5 else "legendary"


async def consume_grave_profit_charge(db, user_id: str) -> bool:
    doc = await db.users.find_one_and_update(
        {"id": user_id, FIELD_GRAVE_PROFIT_CHARGES: {"$gte": 1}},
        {"$inc": {FIELD_GRAVE_PROFIT_CHARGES: -1}},
        return_document=ReturnDocument.AFTER,
    )
    return bool(doc)


async def serialize_active(db, user_id: Optional[str] = None) -> Dict[str, Any]:
    event = await ensure_active_contest(db)
    type_id = str(event.get("type_id") or "")
    meta = CONTEST_TYPES.get(type_id) or {}
    excluded = await contest_excluded_user_ids(db)
    board: List[Dict[str, Any]] = []
    cursor = db[COL_SCORES].find(
        {"event_id": event["id"], "user_id": {"$nin": list(excluded)}}
    ).sort([("score", -1), ("updated_at", 1), ("user_id", 1)]).limit(10)
    uids: List[str] = []
    rows: List[dict] = []
    async for row in cursor:
        uid = str(row.get("user_id") or "")
        if not uid:
            continue
        uids.append(uid)
        rows.append(row)
    names: Dict[str, str] = {}
    if uids:
        async for u in db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "username": 1}):
            names[str(u["id"])] = str(u.get("username") or "Player")
    for i, row in enumerate(rows[:10]):
        uid = str(row["user_id"])
        board.append(
            {
                "rank": i + 1,
                "user_id": uid,
                "username": names.get(uid) or "Player",
                "score": int(row.get("score") or 0),
            }
        )

    my: Optional[Dict[str, Any]] = None
    if user_id:
        mine = await db[COL_SCORES].find_one({"event_id": event["id"], "user_id": user_id})
        score = int((mine or {}).get("score") or 0)
        rank = None
        if score > 0 and str(user_id) not in excluded:
            better = await db[COL_SCORES].count_documents(
                {
                    "event_id": event["id"],
                    "user_id": {"$nin": list(excluded)},
                    "$or": [
                        {"score": {"$gt": score}},
                        {
                            "score": score,
                            "updated_at": {"$lt": (mine or {}).get("updated_at") or ""},
                        },
                    ],
                }
            )
            rank = int(better) + 1
        my = {"score": 0 if str(user_id) in excluded else score, "rank": rank}

    return {
        "id": event.get("id"),
        "type_id": type_id,
        "name": event.get("name") or meta.get("name") or type_id,
        "score_key": event.get("score_key") or meta.get("score_key"),
        "status": event.get("status"),
        "starts_at": event.get("starts_at"),
        "ends_at": event.get("ends_at"),
        "duration_hours": event.get("duration_hours") or meta.get("duration_hours"),
        "prize_table": prize_table_public(type_id),
        "leaderboard": board,
        "me": my,
    }


async def serialize_previous(db, *, limit: int = 24) -> List[Dict[str, Any]]:
    await ensure_active_contest(db)
    out: List[Dict[str, Any]] = []
    cursor = db[COL_EVENTS].find({"status": "ended"}).sort([("ends_at", -1)]).limit(int(limit))
    async for ev in cursor:
        type_id = str(ev.get("type_id") or "")
        out.append(
            {
                "id": ev.get("id"),
                "type_id": type_id,
                "name": ev.get("name") or (CONTEST_TYPES.get(type_id) or {}).get("name") or type_id,
                "ends_at": ev.get("ends_at"),
                "starts_at": ev.get("starts_at"),
                "duration_hours": ev.get("duration_hours"),
                "prize_table": prize_table_public(type_id),
                "results": (ev.get("results") or [])[:10],
            }
        )
    return out


async def serialize_mine(db, user_id: str, *, limit: int = 30) -> List[Dict[str, Any]]:
    if not user_id:
        return []
    await ensure_active_contest(db)
    out: List[Dict[str, Any]] = []
    cursor = db[COL_EVENTS].find({"status": "ended"}).sort([("ends_at", -1)]).limit(80)
    async for ev in cursor:
        results = ev.get("results") or []
        mine = next((r for r in results if str(r.get("user_id")) == user_id), None)
        if not mine:
            continue
        type_id = str(ev.get("type_id") or "")
        out.append(
            {
                "id": ev.get("id"),
                "type_id": type_id,
                "name": ev.get("name") or (CONTEST_TYPES.get(type_id) or {}).get("name") or type_id,
                "ends_at": ev.get("ends_at"),
                "rank": mine.get("rank"),
                "score": mine.get("score"),
                "prize_label": mine.get("prize_label") or "",
            }
        )
        if len(out) >= limit:
            break
    return out
