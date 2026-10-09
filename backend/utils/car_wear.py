"""Garage cars wear from 0% to 100% by rarity, then are removed.

Common 5 days, uncommon 7, rare 10, ultra rare 12, legendary 14.
Other rarities are left alone. The clock starts when damage_as_of is set
(repair, a new car, or the first stamp), not from the original acquire time.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

WEAR_DAYS = {
    "common": 5,
    "uncommon": 7,
    "rare": 10,
    "ultra_rare": 12,
    "legendary": 14,
}

_RARITY_LABEL = {
    "common": "common",
    "uncommon": "uncommon",
    "rare": "rare",
    "ultra_rare": "ultra rare",
    "legendary": "legendary",
}

_rarity_by_car_id: Optional[Dict[str, str]] = None
_SWEEP_INTERVAL_SEC = 120


def normalize_rarity(raw: Any) -> str:
    rarity = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    if rarity == "ultrarare":
        return "ultra_rare"
    return rarity


def _catalog_rarity_by_car_id() -> Dict[str, str]:
    global _rarity_by_car_id
    if _rarity_by_car_id is not None:
        return _rarity_by_car_id
    from server import CARS

    out: Dict[str, str] = {}
    for car in CARS or []:
        cid = str(car.get("id") or "")
        rarity = normalize_rarity(car.get("rarity"))
        if cid and rarity in WEAR_DAYS:
            out[cid] = rarity
    _rarity_by_car_id = out
    return out


def _parse_dt(raw: Any) -> Optional[datetime]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _clamp_damage(raw: Any) -> float:
    try:
        value = float(raw or 0)
    except (TypeError, ValueError):
        value = 0.0
    return min(100.0, max(0.0, value))


def _window_seconds(rarity: str) -> Optional[float]:
    days = WEAR_DAYS.get(rarity)
    if not days:
        return None
    return float(days) * 86400.0


def accrued_damage(stored: Any, as_of: Any, now: datetime, rarity: str) -> Optional[float]:
    """Current damage, or None when this rarity does not wear."""
    window = _window_seconds(rarity)
    if window is None:
        return None
    base = _clamp_damage(stored)
    anchor = _parse_dt(as_of)
    if anchor is None:
        return base
    elapsed = max(0.0, (now - anchor).total_seconds())
    return min(100.0, base + (elapsed / window) * 100.0)


def is_wrecked(stored: Any, as_of: Any, now: datetime, rarity: str) -> bool:
    window = _window_seconds(rarity)
    if window is None:
        return False
    base = _clamp_damage(stored)
    if base >= 100.0:
        return True
    anchor = _parse_dt(as_of)
    if anchor is None:
        return False
    needed = ((100.0 - base) / 100.0) * window
    return (now - anchor).total_seconds() >= needed - 0.5


def loss_message(counts: Dict[str, int]) -> str:
    parts: List[str] = []
    for rarity in WEAR_DAYS:
        n = int(counts.get(rarity) or 0)
        if n <= 0:
            continue
        label = _RARITY_LABEL[rarity]
        noun = "car" if n == 1 else "cars"
        parts.append(f"{n} {label} {noun}")
    if not parts:
        return ""
    if len(parts) == 1:
        return f"You lost {parts[0]}."
    if len(parts) == 2:
        return f"You lost {parts[0]} and {parts[1]}."
    return "You lost " + ", ".join(parts[:-1]) + f", and {parts[-1]}."


async def _delete_and_notify(db, doomed: List[dict]) -> int:
    if not doomed:
        return 0
    ids = [doc["_id"] for doc in doomed if doc.get("_id") is not None]
    if not ids:
        return 0
    result = await db.user_cars.delete_many({"_id": {"$in": ids}})
    deleted = int(getattr(result, "deleted_count", 0) or 0)
    if deleted <= 0:
        return 0
    gone = doomed
    if deleted < len(ids):
        still = set()
        async for row in db.user_cars.find({"_id": {"$in": ids}}, {"_id": 1}):
            still.add(row["_id"])
        gone = [doc for doc in doomed if doc.get("_id") not in still]
    counts: Dict[str, Dict[str, int]] = {}
    for doc in gone:
        uid = str(doc.get("user_id") or "")
        rarity = str(doc.get("_wear_rarity") or "")
        if not uid or rarity not in WEAR_DAYS:
            continue
        bucket = counts.setdefault(uid, {})
        bucket[rarity] = bucket.get(rarity, 0) + 1
    if not counts:
        return deleted
    from server import send_notification

    for uid, bucket in counts.items():
        message = loss_message(bucket)
        if not message:
            continue
        try:
            await send_notification(uid, "Cars lost", message, "system", category="car_drops")
        except Exception:
            logger.exception("car wear notify failed user=%s", uid)
    try:
        from routers.admin.airport import _invalidate_travel_info_cache

        for uid in counts:
            try:
                _invalidate_travel_info_cache(uid)
            except Exception:
                pass
    except Exception:
        logger.exception("car wear travel cache invalidate failed")
    return deleted


async def settle_car_wear(db, docs: List[dict], *, now: Optional[datetime] = None) -> List[dict]:
    """Apply wear to these rows. Wrecks are deleted and the owner is notified. Kept rows get live damage."""
    if not docs:
        return []
    now = now or datetime.now(timezone.utc)
    now_iso = now.isoformat()
    rarity_by_id = _catalog_rarity_by_car_id()
    stamp_ids = []
    doomed: List[dict] = []
    kept: List[dict] = []
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        rarity = rarity_by_id.get(str(doc.get("car_id") or ""))
        if not rarity or doc.get("_id") is None:
            kept.append(doc)
            continue
        stored = _clamp_damage(doc.get("damage_percent"))
        has_anchor = "damage_as_of" in doc and _parse_dt(doc.get("damage_as_of")) is not None
        if not has_anchor and stored < 100.0:
            stamp_ids.append(doc["_id"])
            doc["damage_as_of"] = now_iso
            doc["damage_percent"] = round(stored, 1)
            kept.append(doc)
            continue
        if is_wrecked(stored, doc.get("damage_as_of"), now, rarity):
            doomed.append({**doc, "_wear_rarity": rarity})
            continue
        live = accrued_damage(stored, doc.get("damage_as_of"), now, rarity)
        doc["damage_percent"] = round(live if live is not None else stored, 1)
        kept.append(doc)
    if stamp_ids:
        await db.user_cars.update_many({"_id": {"$in": stamp_ids}}, {"$set": {"damage_as_of": now_iso}})
    if doomed:
        await _delete_and_notify(db, doomed)
    return kept


async def sweep_car_wear(db, *, now: Optional[datetime] = None) -> int:
    """Stamp unstarted clocks, then remove every car that has reached 100%."""
    now = now or datetime.now(timezone.utc)
    now_iso = now.isoformat()
    wearing_ids = list(_catalog_rarity_by_car_id().keys())
    if not wearing_ids:
        return 0
    await db.user_cars.update_many(
        {
            "car_id": {"$in": wearing_ids},
            "$or": [
                {"damage_as_of": {"$exists": False}},
                {"damage_as_of": None},
                {"damage_as_of": ""},
            ],
        },
        {"$set": {"damage_as_of": now_iso}},
    )
    rarity_by_id = _catalog_rarity_by_car_id()
    doomed: List[dict] = []
    deleted = 0
    cursor = db.user_cars.find(
        {"car_id": {"$in": wearing_ids}},
        {"_id": 1, "user_id": 1, "car_id": 1, "damage_percent": 1, "damage_as_of": 1},
    )
    async for doc in cursor:
        rarity = rarity_by_id.get(str(doc.get("car_id") or ""))
        if not rarity:
            continue
        if not is_wrecked(doc.get("damage_percent"), doc.get("damage_as_of"), now, rarity):
            continue
        doomed.append({**doc, "_wear_rarity": rarity})
        if len(doomed) >= 1000:
            deleted += await _delete_and_notify(db, doomed)
            doomed = []
    if doomed:
        deleted += await _delete_and_notify(db, doomed)
    return deleted


async def run_car_wear_loop() -> None:
    import server as srv

    await asyncio.sleep(25)
    while True:
        try:
            n = await sweep_car_wear(srv.db)
            if n:
                logger.info("car wear removed %s", n)
        except Exception:
            logger.exception("car wear sweep failed")
        await asyncio.sleep(_SWEEP_INTERVAL_SEC)
