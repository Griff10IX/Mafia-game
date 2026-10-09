"""
Two world-unique loot relics. Drop rules stay server-side.

A player can hold only one. Opens 1–100 never roll. Later opens have a flat
chance when a relic is free. Death clears the owner and the unclaimed stack.
Friday 18:00 Europe/London adds 2.5% of that game's net loss to the stack.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pymongo import ReturnDocument

logger = logging.getLogger(__name__)

COLLECTION = "casino_loss_relics"
OPEN_FIELD = "casino_loss_relic_opens"
OPENS_BEFORE_ROLL = 100
DROP_CHANCE = 0.01
REBATE_RATE = 0.025
LONDON = ZoneInfo("Europe/London")

RELICS: Dict[str, Dict[str, str]] = {
    "henhouse_slip": {
        "name": "Henhouse Slip",
        "game_type": "chicken_cross",
        "buff_label": "2.5% of all Chicken Cross losses, every Friday at 6pm UK",
    },
    "black_box": {
        "name": "Black Box",
        "game_type": "crash",
        "buff_label": "2.5% of all Crash losses, every Friday at 6pm UK",
    },
}
ALL_ITEM_IDS: List[str] = list(RELICS.keys())
CURRENCIES = ("cash", "points")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _parse(raw) -> Optional[datetime]:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def next_friday_1800_after(moment: datetime) -> datetime:
    """First Friday 18:00 Europe/London strictly after moment, as UTC."""
    local = moment.astimezone(LONDON)
    days_ahead = (4 - local.weekday()) % 7
    candidate = (local + timedelta(days=days_ahead)).replace(hour=18, minute=0, second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=7)
    return candidate.astimezone(timezone.utc)


def rebate_amount(wagered: float, paid: float) -> int:
    """2.5% of a window's net loss, floored. A winning window pays nothing."""
    loss = float(wagered) - float(paid)
    if loss <= 0:
        return 0
    return int(loss * REBATE_RATE)


def _spans(doc: dict, window_start: datetime, window_end: datetime) -> Iterable[Tuple[str, datetime, datetime]]:
    history = doc.get("currency_history") or []
    if isinstance(history, list):
        for row in history:
            if not isinstance(row, dict):
                continue
            currency = str(row.get("currency") or "")
            start = _parse(row.get("from"))
            end = _parse(row.get("until"))
            if currency not in CURRENCIES or not start or not end:
                continue
            lo = max(start, window_start)
            hi = min(end, window_end)
            if lo < hi:
                yield currency, lo, hi
    currency = str(doc.get("payout_currency") or "")
    since = _parse(doc.get("currency_since"))
    if currency in CURRENCIES and since:
        lo = max(since, window_start)
        if lo < window_end:
            yield currency, lo, window_end


async def ensure_indexes(db) -> None:
    try:
        await db[COLLECTION].create_index("item_id", unique=True)
        await db[COLLECTION].create_index("owner_id")
    except Exception:
        logger.exception("casino_loss_relics index ensure failed")


async def _seed(db) -> None:
    now = _iso(_utcnow())
    for item_id in ALL_ITEM_IDS:
        try:
            await db[COLLECTION].update_one(
                {"item_id": item_id},
                {
                    "$setOnInsert": {
                        "item_id": item_id,
                        "owner_id": None,
                        "owner_username": None,
                        "granted_at": None,
                        "payout_currency": None,
                        "currency_since": None,
                        "currency_history": [],
                        "unclaimed_cash": 0,
                        "unclaimed_points": 0,
                        "last_settled_until": None,
                        "created_at": now,
                    }
                },
                upsert=True,
            )
        except Exception:
            logger.exception("seed casino loss relic failed item_id=%s", item_id)


def _public(doc: dict) -> Dict[str, Any]:
    item_id = str(doc.get("item_id") or "")
    cfg = RELICS.get(item_id) or {}
    currency = doc.get("payout_currency")
    if currency not in CURRENCIES:
        currency = None
    return {
        "id": item_id,
        "name": cfg.get("name") or item_id,
        "buff_label": cfg.get("buff_label") or "",
        "payout_currency": currency,
        "unclaimed_cash": int(doc.get("unclaimed_cash") or 0),
        "unclaimed_points": int(doc.get("unclaimed_points") or 0),
    }


async def owner_view(db, user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    await _seed(db)
    doc = await db[COLLECTION].find_one(
        {"owner_id": user_id, "item_id": {"$in": ALL_ITEM_IDS}},
        {"_id": 0},
    )
    if not doc:
        return None
    return _public(doc)


async def _free_ids(db) -> List[str]:
    await _seed(db)
    rows = await db[COLLECTION].find(
        {"item_id": {"$in": ALL_ITEM_IDS}},
        {"_id": 0, "item_id": 1, "owner_id": 1},
    ).to_list(5)
    by_id = {r.get("item_id"): r for r in rows}
    free: List[str] = []
    for item_id in ALL_ITEM_IDS:
        owner = str((by_id.get(item_id) or {}).get("owner_id") or "").strip()
        if not owner:
            free.append(item_id)
    return free


async def _user_owns(db, user_id: str) -> bool:
    doc = await db[COLLECTION].find_one(
        {"owner_id": user_id, "item_id": {"$in": ALL_ITEM_IDS}},
        {"_id": 1},
    )
    return bool(doc)


def _blank_owner_fields(user_id: str, username: Optional[str], source: str) -> Dict[str, Any]:
    return {
        "owner_id": user_id,
        "owner_username": (username or "").strip() or None,
        "granted_at": _iso(_utcnow()),
        "grant_source": source,
        "payout_currency": None,
        "currency_since": None,
        "currency_history": [],
        "unclaimed_cash": 0,
        "unclaimed_points": 0,
        "last_settled_until": None,
    }


async def _claim(db, user_id: str, item_id: str, username: Optional[str]) -> Optional[Dict[str, Any]]:
    if item_id not in RELICS or await _user_owns(db, user_id):
        return None
    upd = await db[COLLECTION].update_one(
        {
            "item_id": item_id,
            "$or": [{"owner_id": None}, {"owner_id": {"$exists": False}}, {"owner_id": ""}],
        },
        {"$set": _blank_owner_fields(user_id, username, "loot_box")},
    )
    if upd.modified_count <= 0:
        return None
    owned = await db[COLLECTION].count_documents({"owner_id": user_id, "item_id": {"$in": ALL_ITEM_IDS}})
    if owned > 1:
        await db[COLLECTION].update_one(
            {"item_id": item_id, "owner_id": user_id},
            {"$set": _blank_owner_fields("", None, "") | {
                "owner_id": None,
                "owner_username": None,
                "granted_at": None,
                "grant_source": None,
            }},
        )
        return None
    doc = await db[COLLECTION].find_one({"item_id": item_id, "owner_id": user_id}, {"_id": 0})
    if not doc:
        return None
    view = _public(doc)
    view["type"] = "casino_loss_relic"
    view["rarity"] = "loot_exclusive"
    view["reward_tier"] = "loot_exclusive"
    return view


async def note_open_and_maybe_grant(
    db,
    *,
    user_id: str,
    username: Optional[str],
    rng,
) -> Optional[Dict[str, Any]]:
    """Count this open. Roll only after the gate, and only when a relic is free."""
    if not user_id:
        return None
    updated = await db.users.find_one_and_update(
        {"id": user_id},
        {"$inc": {OPEN_FIELD: 1}},
        projection={"_id": 0, OPEN_FIELD: 1},
        return_document=ReturnDocument.AFTER,
    )
    opens = int((updated or {}).get(OPEN_FIELD) or 0)
    if opens <= OPENS_BEFORE_ROLL:
        return None
    if rng.random() >= DROP_CHANCE:
        return None
    if await _user_owns(db, user_id):
        return None
    free = await _free_ids(db)
    if not free:
        return None
    item_id = rng.choice(list(free))
    return await _claim(db, user_id, item_id, username)


async def set_payout_currency(db, user_id: str, currency: str) -> Dict[str, Any]:
    choice = str(currency or "").strip().lower()
    if choice not in CURRENCIES:
        raise HTTPException(status_code=400, detail="Choose cash or points")
    doc = await db[COLLECTION].find_one(
        {"owner_id": user_id, "item_id": {"$in": ALL_ITEM_IDS}},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="You do not hold this")
    current = str(doc.get("payout_currency") or "")
    if current == choice:
        return {"relic": _public(doc)}
    now = _utcnow()
    history = list(doc.get("currency_history") or [])
    since = _parse(doc.get("currency_since"))
    if current in CURRENCIES and since:
        history.append({"currency": current, "from": _iso(since), "until": _iso(now)})
    await db[COLLECTION].update_one(
        {"item_id": doc["item_id"], "owner_id": user_id},
        {"$set": {
            "payout_currency": choice,
            "currency_since": _iso(now),
            "currency_history": history,
        }},
    )
    fresh = await db[COLLECTION].find_one({"item_id": doc["item_id"], "owner_id": user_id}, {"_id": 0})
    return {"relic": _public(fresh or doc)}


async def _net_parts(db, game_type: str, currency: str, start: datetime, end: datetime) -> Tuple[float, float]:
    rows = await db.gambling_log.aggregate([
        {"$match": {
            "game_type": game_type,
            "created_at": {"$gte": start, "$lt": end},
        }},
        {"$project": {
            "void": {"$ifNull": ["$details.void", False]},
            "currency": {"$ifNull": ["$details.currency", "cash"]},
            "bet": {"$convert": {"input": "$details.bet", "to": "double", "onError": 0, "onNull": 0}},
            "payout": {"$convert": {"input": "$details.payout", "to": "double", "onError": 0, "onNull": 0}},
        }},
        {"$match": {"void": {"$ne": True}, "currency": currency}},
        {"$group": {"_id": None, "wagered": {"$sum": "$bet"}, "paid": {"$sum": "$payout"}}},
    ]).to_list(1)
    if not rows:
        return 0.0, 0.0
    return float(rows[0].get("wagered") or 0), float(rows[0].get("paid") or 0)


async def _accrue_window(db, doc: dict, window_start: datetime, window_end: datetime) -> Tuple[int, int]:
    item_id = str(doc.get("item_id") or "")
    cfg = RELICS.get(item_id) or {}
    game_type = cfg.get("game_type") or ""
    owner_id = str(doc.get("owner_id") or "")
    cash = 0
    points = 0
    if not game_type or not owner_id:
        return 0, 0
    granted = _parse(doc.get("granted_at"))
    if granted and granted > window_start:
        window_start = granted
    if window_start >= window_end:
        return 0, 0
    for currency, start, end in _spans(doc, window_start, window_end):
        wagered, paid = await _net_parts(db, game_type, currency, start, end)
        amount = rebate_amount(wagered, paid)
        if currency == "cash":
            cash += amount
        else:
            points += amount
    return cash, points


async def settle_due(db, *, now: Optional[datetime] = None, send_notification=None) -> int:
    """Close every Friday 18:00 London that has passed. Idempotent per relic."""
    await _seed(db)
    now = now or _utcnow()
    settled = 0
    docs = await db[COLLECTION].find(
        {"owner_id": {"$nin": [None, ""]}, "item_id": {"$in": ALL_ITEM_IDS}},
        {"_id": 0},
    ).to_list(5)
    for doc in docs:
        owner_id = str(doc.get("owner_id") or "")
        granted = _parse(doc.get("granted_at"))
        if not owner_id or not granted:
            continue
        cursor = _parse(doc.get("last_settled_until")) or granted
        # Catch up a few missed Fridays, then the next tick finishes the rest.
        for _ in range(8):
            end = next_friday_1800_after(cursor)
            if end > now:
                break
            window_start = cursor
            cash, points = await _accrue_window(db, doc, window_start, end)
            previous = doc.get("last_settled_until")
            res = await db[COLLECTION].update_one(
                {
                    "item_id": doc["item_id"],
                    "owner_id": owner_id,
                    "last_settled_until": previous,
                },
                {
                    "$set": {"last_settled_until": _iso(end)},
                    "$inc": {"unclaimed_cash": int(cash), "unclaimed_points": int(points)},
                },
            )
            if res.modified_count <= 0:
                break
            settled += 1
            doc["last_settled_until"] = _iso(end)
            doc["unclaimed_cash"] = int(doc.get("unclaimed_cash") or 0) + int(cash)
            doc["unclaimed_points"] = int(doc.get("unclaimed_points") or 0) + int(points)
            cursor = end
            if send_notification and (cash or points):
                bits = []
                if cash:
                    bits.append(f"${int(cash):,}")
                if points:
                    bits.append(f"{int(points):,} points")
                name = (RELICS.get(doc["item_id"]) or {}).get("name") or "Relic"
                try:
                    await send_notification(
                        owner_id,
                        name,
                        f"This week added {' and '.join(bits)}. Collect it in My Inventory, or leave it to stack.",
                        "reward",
                    )
                except Exception:
                    logger.exception("casino loss relic notify failed")
    return settled


async def collect_unclaimed(db, user: dict, *, log_points_event=None) -> Dict[str, Any]:
    user_id = str((user or {}).get("id") or "")
    doc = await db[COLLECTION].find_one_and_update(
        {"owner_id": user_id, "item_id": {"$in": ALL_ITEM_IDS}},
        {"$set": {"unclaimed_cash": 0, "unclaimed_points": 0}},
        projection={"_id": 0},
        return_document=ReturnDocument.BEFORE,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="You do not hold this")
    cash = int(doc.get("unclaimed_cash") or 0)
    points = int(doc.get("unclaimed_points") or 0)
    if cash <= 0 and points <= 0:
        raise HTTPException(status_code=400, detail="Nothing waiting to collect")
    inc: Dict[str, int] = {}
    if cash > 0:
        inc["money"] = cash
    if points > 0:
        inc["points"] = points
    updated = await db.users.find_one_and_update(
        {"id": user_id},
        {"$inc": inc},
        projection={"_id": 0, "money": 1, "points": 1},
        return_document=ReturnDocument.AFTER,
    )
    if points > 0 and log_points_event:
        before = int((updated or {}).get("points") or 0) - points
        try:
            await log_points_event(
                db,
                user_id=user_id,
                points=points,
                event_type="casino_loss_relic",
                event_ref=f"collect:{doc.get('item_id')}",
                source="loot",
                meta={"action": "collect", "item_id": doc.get("item_id"), "cash": cash},
                wallet_points_before=before,
                wallet_points_after=before + points,
            )
        except Exception:
            logger.exception("casino loss relic points log failed")
    fresh = await db[COLLECTION].find_one({"item_id": doc.get("item_id"), "owner_id": user_id}, {"_id": 0})
    return {
        "message": "Collected",
        "collected_cash": cash,
        "collected_points": points,
        "money": int((updated or {}).get("money") or 0),
        "points": int((updated or {}).get("points") or 0),
        "relic": _public(fresh or doc),
    }


async def release_on_death(
    db,
    *,
    victim_id: str,
    victim_username: Optional[str] = None,
    send_notification=None,
) -> List[str]:
    """Return held relics to the box. The unclaimed stack is wiped, not paid and not transferred."""
    if not victim_id:
        return []
    rows = await db[COLLECTION].find(
        {"owner_id": victim_id, "item_id": {"$in": ALL_ITEM_IDS}},
        {"_id": 0, "item_id": 1},
    ).to_list(5)
    released: List[str] = []
    now = _iso(_utcnow())
    for row in rows:
        item_id = str(row.get("item_id") or "")
        res = await db[COLLECTION].update_one(
            {"item_id": item_id, "owner_id": victim_id},
            {"$set": {
                "owner_id": None,
                "owner_username": None,
                "granted_at": None,
                "payout_currency": None,
                "currency_since": None,
                "currency_history": [],
                "unclaimed_cash": 0,
                "unclaimed_points": 0,
                "last_settled_until": None,
                "reclaimed_at": now,
                "reclaimed_from": victim_id,
                "reclaimed_from_username": victim_username,
            }},
        )
        if res.modified_count > 0:
            released.append(item_id)
    if released and send_notification:
        names = ", ".join((RELICS.get(i) or {}).get("name") or i for i in released)
        try:
            await send_notification(
                victim_id,
                "Relic returned",
                f"{names} returned to the loot boxes.",
                "system",
            )
        except Exception:
            logger.exception("casino loss relic death notify failed")
    return released


async def run_casino_loss_relic_ticker(db) -> None:
    await asyncio.sleep(20)
    await ensure_indexes(db)
    await _seed(db)
    logger.info("Casino loss relic ticker started")
    while True:
        try:
            from server import send_notification

            await settle_due(db, send_notification=send_notification)
        except Exception:
            logger.exception("casino loss relic ticker")
        await asyncio.sleep(60)
