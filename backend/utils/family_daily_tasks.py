"""UTC-daily family objectives, progress, and idempotent reward settlement."""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from utils.family_vault_log import log_family_vault_tx

logger = logging.getLogger(__name__)

OBJECTIVES = {
    "crime": {"label": "Successful crimes", "target": 20},
    "gta": {"label": "Successful GTAs", "target": 5},
    "jail_bust": {"label": "Successful jail busts", "target": 3},
    "booze_run": {"label": "Completed booze runs", "target": 2},
    "car_melt": {"label": "Cars melted", "target": 5},
    "oc": {"label": "Organised crime participation", "target": 1},
    "racket_collect": {"label": "Racket collections", "target": 2},
}
OBJECTIVE_TYPES = tuple(OBJECTIVES)

# Count fields for ordinary Store tokens. Game Pass and other premium-only tokens are
# deliberately absent. Pools are awarded at rollover after the qualifier set is final.
NORMAL_STORE_TOKEN_FIELDS = (
    "xp_crimes_tokens",
    "xp_gta_tokens",
    "auto_rank_2h_tokens",
    "melt_tokens",
    "oc_reduced_tokens",
    "booze_tokens",
    "racket_tokens",
    "travel_tokens",
    "properties_tokens",
    "jailbust_tokens",
    "auto_collect_12h_tokens",
    "auto_collect_24h_tokens",
    "cooldown_skip_crime_tokens",
    "cooldown_skip_gta_tokens",
    "cooldown_skip_booze_tokens",
    "cooldown_skip_properties_tokens",
    "jail_bailout_tokens",
)

REWARD_TYPES = ("cash", "points", "loot", "tokens")
CREW_CASH_PER_COMPLETION = 1_000_000
CREW_CASH_DAILY_CAP = 25_000_000
CREW_POINTS_PER_COMPLETION = 2
CREW_POINTS_DAILY_CAP = 50
CREW_LOOT_PER_COMPLETION = 1
CREW_LOOT_DAILY_CAP = 20
TOKEN_POOL_MAX_UNITS = 10
WORKER_INTERVAL_SECONDS = 60


def _utc_now(now: Optional[datetime] = None) -> datetime:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def utc_period(now: Optional[datetime] = None) -> str:
    return _utc_now(now).date().isoformat()


def period_start(period: str) -> datetime:
    return datetime.fromisoformat(period).replace(tzinfo=timezone.utc)


def _stable_digest(*parts: Any) -> bytes:
    return hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).digest()


def objective_spec(family_id: str, period: str) -> Dict[str, Any]:
    digest = _stable_digest("family-daily-v1", family_id, period)
    objective_type = OBJECTIVE_TYPES[int.from_bytes(digest[:4], "big") % len(OBJECTIVE_TYPES)]
    reward_count = 2 + (digest[4] % 2)
    ranked_rewards = sorted(
        REWARD_TYPES,
        key=lambda reward: _stable_digest("family-daily-reward-v1", family_id, period, reward),
    )
    reward_types = ranked_rewards[:reward_count]
    definition = OBJECTIVES[objective_type]
    return {
        "objective_type": objective_type,
        "label": definition["label"],
        "target": int(definition["target"]),
        "reward_types": reward_types,
    }


def reward_amounts(reward_types: Iterable[str], completion_number: int) -> Dict[str, int]:
    """Shared reward for one completion, respecting cumulative daily caps."""
    n = max(1, int(completion_number))
    chosen = set(reward_types or ())
    cash = (
        min(CREW_CASH_PER_COMPLETION, max(0, CREW_CASH_DAILY_CAP - (n - 1) * CREW_CASH_PER_COMPLETION))
        if "cash" in chosen else 0
    )
    points = (
        min(CREW_POINTS_PER_COMPLETION, max(0, CREW_POINTS_DAILY_CAP - (n - 1) * CREW_POINTS_PER_COMPLETION))
        if "points" in chosen else 0
    )
    loot = (
        min(CREW_LOOT_PER_COMPLETION, max(0, CREW_LOOT_DAILY_CAP - (n - 1) * CREW_LOOT_PER_COMPLETION))
        if "loot" in chosen else 0
    )
    return {"cash": cash, "points": points, "loot": loot}


async def _eligible_members(db, family_id: str, day_start: datetime) -> List[Dict[str, str]]:
    day_start_iso = day_start.isoformat()
    rows = await db.family_members.find(
        {
            "family_id": family_id,
            "$or": [
                {"joined_at": {"$type": "date", "$lt": day_start}},
                {"joined_at": {"$type": "string", "$lt": day_start_iso}},
            ],
        },
        {"_id": 0, "user_id": 1, "joined_at": 1},
    ).to_list(500)
    user_ids = sorted({str(row.get("user_id") or "") for row in rows if row.get("user_id")})
    if not user_ids:
        return []
    users = await db.users.find(
        {"id": {"$in": user_ids}, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1},
    ).to_list(len(user_ids))
    by_id = {str(user.get("id")): user for user in users}
    return [
        {"user_id": uid, "username": str(by_id[uid].get("username") or "?")}
        for uid in user_ids
        if uid in by_id
    ]


async def ensure_family_objective(
    db,
    family_id: str,
    *,
    now: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    now = _utc_now(now)
    period = utc_period(now)
    existing = await db.family_daily_objectives.find_one(
        {"family_id": family_id, "period": period},
        {"_id": 0},
    )
    if existing:
        return existing
    family = await db.families.find_one(
        {"id": family_id, "wiped": {"$ne": True}, "provisioning": {"$ne": True}},
        {"_id": 0, "id": 1, "name": 1, "tag": 1},
    )
    if not family:
        return None
    start = period_start(period)
    members = await _eligible_members(db, family_id, start)
    spec = objective_spec(family_id, period)
    doc = {
        "family_id": family_id,
        "period": period,
        "period_start": start,
        "period_end": start + timedelta(days=1),
        **spec,
        "eligible_user_ids": [m["user_id"] for m in members],
        "eligible_count": len(members),
        "completion_count": 0,
        "tokens_rolled_over": False,
        "created_at": now,
    }
    try:
        await db.family_daily_objectives.insert_one(doc)
    except DuplicateKeyError:
        return await db.family_daily_objectives.find_one(
            {"family_id": family_id, "period": period},
            {"_id": 0},
        )
    if members:
        rows = [
            {
                "family_id": family_id,
                "period": period,
                "user_id": member["user_id"],
                "username": member["username"],
                "objective_type": spec["objective_type"],
                "target": spec["target"],
                "progress": 0,
                "completed": False,
                "created_at": now,
                "updated_at": now,
            }
            for member in members
        ]
        try:
            await db.family_daily_progress.insert_many(rows, ordered=False)
        except Exception:
            # A concurrent creator may have inserted some/all rows.
            pass
    doc.pop("_id", None)
    return doc


async def _current_eligible_family(
    db,
    user_id: str,
    day_start: datetime,
) -> Optional[str]:
    rows = await db.family_members.find(
        {"user_id": user_id},
        {"_id": 0, "family_id": 1, "joined_at": 1},
    ).sort([("joined_at", -1), ("id", 1)]).to_list(10)
    for row in rows:
        family_id = str(row.get("family_id") or "")
        if not family_id:
            continue
        joined = row.get("joined_at")
        try:
            joined_dt = joined if isinstance(joined, datetime) else datetime.fromisoformat(str(joined).replace("Z", "+00:00"))
            joined_dt = _utc_now(joined_dt)
        except Exception:
            continue
        if joined_dt >= day_start:
            continue
        family = await db.families.find_one(
            {"id": family_id, "wiped": {"$ne": True}, "provisioning": {"$ne": True}},
            {"_id": 1},
        )
        if family:
            return family_id
    return None


async def record_family_daily_activity(
    db,
    user_id: str,
    objective_type: str,
    amount: int = 1,
    *,
    source_id: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    """Record eligible activity and queue exactly one completion reward."""
    if objective_type not in OBJECTIVES or int(amount or 0) <= 0 or not user_id:
        return None
    now = _utc_now(now)
    period = utc_period(now)
    family_id = await _current_eligible_family(db, str(user_id), period_start(period))
    if not family_id:
        return None
    objective = await ensure_family_objective(db, family_id, now=now)
    if (
        not objective
        or objective.get("objective_type") != objective_type
        or str(user_id) not in set(objective.get("eligible_user_ids") or ())
    ):
        return None

    if source_id:
        try:
            await db.family_daily_activity_receipts.insert_one(
                {
                    "family_id": family_id,
                    "period": period,
                    "user_id": str(user_id),
                    "source_id": str(source_id),
                    "objective_type": objective_type,
                    "created_at": now,
                }
            )
        except DuplicateKeyError:
            return None

    await db.family_daily_progress.update_one(
        {
            "family_id": family_id,
            "period": period,
            "user_id": str(user_id),
            "completed": False,
        },
        {"$inc": {"progress": int(amount)}, "$set": {"updated_at": now}},
    )
    completed = await db.family_daily_progress.find_one_and_update(
        {
            "family_id": family_id,
            "period": period,
            "user_id": str(user_id),
            "completed": False,
            "progress": {"$gte": int(objective["target"])},
        },
        {"$set": {"completed": True, "completed_at": now, "updated_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if not completed:
        return await db.family_daily_progress.find_one(
            {"family_id": family_id, "period": period, "user_id": str(user_id)},
            {"_id": 0},
        )

    claimed = await db.family_daily_objectives.find_one_and_update(
        {"family_id": family_id, "period": period},
        {"$inc": {"completion_count": 1}, "$set": {"updated_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    completion_number = int((claimed or {}).get("completion_count") or 1)
    completed["completion_number"] = completion_number
    await db.family_daily_progress.update_one(
        {"family_id": family_id, "period": period, "user_id": str(user_id)},
        {"$set": {"completion_number": completion_number}},
    )
    await _ensure_shared_reward_event(db, objective, completed, now=now)
    await settle_pending_reward_events(db, family_id=family_id, period=period)
    completed.pop("_id", None)
    return completed


async def _ensure_shared_reward_event(
    db,
    objective: Dict[str, Any],
    progress: Dict[str, Any],
    *,
    now: Optional[datetime] = None,
) -> None:
    """Repairable event creation: deterministic member slot makes retries cap-safe."""
    family_id = str(objective["family_id"])
    period = str(objective["period"])
    user_id = str(progress["user_id"])
    completion_number = int(progress.get("completion_number") or 0)
    if completion_number <= 0:
        return
    amounts = reward_amounts(objective.get("reward_types") or (), completion_number)
    event_id = f"family-daily:{family_id}:{period}:{user_id}:shared"
    event = {
        "event_id": event_id,
        "family_id": family_id,
        "period": period,
        "user_id": user_id,
        "username": progress.get("username") or "?",
        "kind": "shared",
        "status": "pending",
        "completion_number": completion_number,
        "cash": amounts["cash"],
        "points": amounts["points"],
        "loot": amounts["loot"],
        "created_at": _utc_now(now),
        "updated_at": _utc_now(now),
    }
    await db.family_daily_reward_events.update_one(
        {"event_id": event_id},
        {"$setOnInsert": event},
        upsert=True,
    )


async def _settle_shared_event(db, event: Dict[str, Any]) -> None:
    event_id = event["event_id"]
    inc = {}
    if int(event.get("cash") or 0):
        inc["treasury"] = int(event["cash"])
    if int(event.get("points") or 0):
        inc["treasury_points"] = int(event["points"])
    if int(event.get("loot") or 0):
        inc["treasury_loot_pieces"] = int(event["loot"])
    update: Dict[str, Any] = {
        "$addToSet": {"daily_reward_event_ids": event_id},
    }
    if inc:
        update["$inc"] = inc
    result = await db.families.update_one(
        {
            "id": event["family_id"],
            "wiped": {"$ne": True},
            "provisioning": {"$ne": True},
            "daily_reward_event_ids": {"$ne": event_id},
        },
        update,
    )
    family = await db.families.find_one(
        {"id": event["family_id"]},
        {"_id": 0, "daily_reward_event_ids": 1},
    )
    applied = bool(result.modified_count) or event_id in set((family or {}).get("daily_reward_event_ids") or ())
    if not applied:
        raise RuntimeError("active family unavailable for daily reward")
    if result.modified_count:
        await log_family_vault_tx(
            db,
            event["family_id"],
            "daily_objective_completion",
            event.get("user_id") or "",
            event.get("username") or "?",
            cash_delta=int(event.get("cash") or 0),
            points_delta=int(event.get("points") or 0),
            loot_delta=int(event.get("loot") or 0),
            meta={"period": event["period"], "event_id": event_id},
            event_id=event_id,
        )
    await db.family_daily_reward_events.update_one(
        {"event_id": event_id},
        {"$set": {"status": "settled", "settled_at": _utc_now(), "updated_at": _utc_now()}},
    )


async def _settle_token_event(db, event: Dict[str, Any]) -> None:
    event_id = event["event_id"]
    token_grants = {
        field: int(amount)
        for field, amount in (event.get("token_grants") or {}).items()
        if field in NORMAL_STORE_TOKEN_FIELDS and int(amount or 0) > 0
    }
    update: Dict[str, Any] = {"$addToSet": {"daily_reward_event_ids": event_id}}
    if token_grants:
        update["$inc"] = token_grants
    result = await db.users.update_one(
        {
            "id": event["user_id"],
            "is_dead": {"$ne": True},
            "daily_reward_event_ids": {"$ne": event_id},
        },
        update,
    )
    user = await db.users.find_one(
        {"id": event["user_id"]},
        {"_id": 0, "daily_reward_event_ids": 1},
    )
    applied = bool(result.modified_count) or event_id in set((user or {}).get("daily_reward_event_ids") or ())
    if not applied:
        raise RuntimeError("qualifier unavailable for token reward")
    await db.family_daily_reward_events.update_one(
        {"event_id": event_id},
        {"$set": {"status": "settled", "settled_at": _utc_now(), "updated_at": _utc_now()}},
    )


async def settle_pending_reward_events(
    db,
    *,
    family_id: Optional[str] = None,
    period: Optional[str] = None,
    limit: int = 500,
) -> Dict[str, int]:
    query: Dict[str, Any] = {"status": "pending"}
    if family_id:
        query["family_id"] = family_id
    if period:
        query["period"] = period
    events = await db.family_daily_reward_events.find(query).sort("created_at", 1).to_list(limit)
    settled = 0
    failed = 0
    for event in events:
        try:
            if event.get("kind") == "tokens":
                await _settle_token_event(db, event)
            else:
                await _settle_shared_event(db, event)
            settled += 1
        except Exception as exc:
            failed += 1
            await db.family_daily_reward_events.update_one(
                {"event_id": event.get("event_id")},
                {
                    "$set": {"last_error": str(exc)[:500], "updated_at": _utc_now()},
                    "$inc": {"attempts": 1},
                },
            )
    return {"settled": settled, "failed": failed}


def _token_allocations(
    family_id: str,
    period: str,
    qualifiers: List[Dict[str, Any]],
    _eligible_count: int,
) -> Dict[str, Dict[str, int]]:
    if not qualifiers:
        return {}
    # Each additional qualifier grows the token pool by one, up to the daily cap.
    units = min(TOKEN_POOL_MAX_UNITS, len(qualifiers))
    ordered = sorted(
        qualifiers,
        key=lambda row: _stable_digest("family-daily-qualifier", family_id, period, row["user_id"]),
    )
    allocations: Dict[str, Dict[str, int]] = {str(row["user_id"]): {} for row in ordered}
    for index in range(units):
        user_id = str(ordered[index % len(ordered)]["user_id"])
        token_field = NORMAL_STORE_TOKEN_FIELDS[
            int.from_bytes(_stable_digest("family-daily-token", family_id, period, index)[:4], "big")
            % len(NORMAL_STORE_TOKEN_FIELDS)
        ]
        allocations[user_id][token_field] = allocations[user_id].get(token_field, 0) + 1
    return {uid: grants for uid, grants in allocations.items() if grants}


async def rollover_objective_tokens(db, objective: Dict[str, Any], *, now: Optional[datetime] = None) -> int:
    active_family = await db.families.find_one(
        {
            "id": objective["family_id"],
            "wiped": {"$ne": True},
            "provisioning": {"$ne": True},
        },
        {"_id": 1},
    )
    if not active_family:
        await db.family_daily_objectives.update_one(
            {"family_id": objective["family_id"], "period": objective["period"]},
            {"$set": {"tokens_rolled_over": True, "tokens_rolled_over_at": _utc_now(now)}},
        )
        return 0
    if "tokens" not in set(objective.get("reward_types") or ()):
        await db.family_daily_objectives.update_one(
            {"family_id": objective["family_id"], "period": objective["period"]},
            {"$set": {"tokens_rolled_over": True, "tokens_rolled_over_at": _utc_now(now)}},
        )
        return 0
    qualifiers = await db.family_daily_progress.find(
        {
            "family_id": objective["family_id"],
            "period": objective["period"],
            "completed": True,
        },
        {"_id": 0, "user_id": 1, "username": 1},
    ).to_list(500)
    allocations = _token_allocations(
        objective["family_id"],
        objective["period"],
        qualifiers,
        int(objective.get("eligible_count") or 0),
    )
    created = 0
    by_user = {str(row["user_id"]): row for row in qualifiers}
    for user_id, grants in allocations.items():
        event_id = f"family-daily:{objective['family_id']}:{objective['period']}:{user_id}:tokens"
        result = await db.family_daily_reward_events.update_one(
            {"event_id": event_id},
            {
                "$setOnInsert": {
                    "event_id": event_id,
                    "family_id": objective["family_id"],
                    "period": objective["period"],
                    "user_id": user_id,
                    "username": (by_user.get(user_id) or {}).get("username") or "?",
                    "kind": "tokens",
                    "status": "pending",
                    "token_grants": grants,
                    "created_at": _utc_now(now),
                    "updated_at": _utc_now(now),
                }
            },
            upsert=True,
        )
        created += int(bool(result.upserted_id))
    await db.family_daily_objectives.update_one(
        {"family_id": objective["family_id"], "period": objective["period"]},
        {"$set": {"tokens_rolled_over": True, "tokens_rolled_over_at": _utc_now(now)}},
    )
    return created


async def run_family_daily_tasks_tick(db, *, now: Optional[datetime] = None) -> Dict[str, int]:
    now = _utc_now(now)
    today = utc_period(now)
    active = await db.families.find(
        {"wiped": {"$ne": True}, "provisioning": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(1000)
    ensured = 0
    for family in active:
        if await ensure_family_objective(db, str(family["id"]), now=now):
            ensured += 1
    repair_objectives = await db.family_daily_objectives.find(
        {"period": {"$lte": today}},
        {"_id": 0},
    ).sort("period", -1).to_list(1000)
    repaired_events = 0
    for objective in repair_objectives:
        completed_rows = await db.family_daily_progress.find(
            {
                "family_id": objective["family_id"],
                "period": objective["period"],
                "completed": True,
            },
            {"_id": 0},
        ).to_list(500)
        completed_rows.sort(
            key=lambda row: (
                row.get("completed_at") or datetime.max.replace(tzinfo=timezone.utc),
                str(row.get("user_id") or ""),
            )
        )
        used_numbers = {
            int(row.get("completion_number") or 0)
            for row in completed_rows
            if int(row.get("completion_number") or 0) > 0
        }
        next_number = 1
        for progress in completed_rows:
            if int(progress.get("completion_number") or 0) > 0:
                continue
            while next_number in used_numbers:
                next_number += 1
            progress["completion_number"] = next_number
            used_numbers.add(next_number)
            await db.family_daily_progress.update_one(
                {
                    "family_id": objective["family_id"],
                    "period": objective["period"],
                    "user_id": progress["user_id"],
                },
                {"$set": {"completion_number": next_number, "updated_at": now}},
            )
        await db.family_daily_objectives.update_one(
            {"family_id": objective["family_id"], "period": objective["period"]},
            {"$set": {"completion_count": len(completed_rows), "updated_at": now}},
        )
        for progress in completed_rows:
            event_id = (
                f"family-daily:{objective['family_id']}:{objective['period']}:"
                f"{progress['user_id']}:shared"
            )
            existed = await db.family_daily_reward_events.find_one(
                {"event_id": event_id},
                {"_id": 1},
            )
            await _ensure_shared_reward_event(db, objective, progress, now=now)
            repaired_events += int(not bool(existed))
    old = await db.family_daily_objectives.find(
        {"period": {"$lt": today}, "tokens_rolled_over": {"$ne": True}},
        {"_id": 0},
    ).sort("period", 1).to_list(1000)
    token_events = 0
    for objective in old:
        token_events += await rollover_objective_tokens(db, objective, now=now)
    result = await settle_pending_reward_events(db)
    return {
        "objectives_ensured": ensured,
        "shared_events_repaired": repaired_events,
        "objectives_rolled_over": len(old),
        "token_events_created": token_events,
        **result,
    }


async def run_family_daily_tasks_worker(db) -> None:
    while True:
        try:
            await run_family_daily_tasks_tick(db)
        except Exception:
            logger.exception("Family daily objective worker tick failed")
        await asyncio.sleep(WORKER_INTERVAL_SECONDS)


async def get_today_family_objective(
    db,
    family_id: str,
    user_id: str,
    *,
    now: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    objective = await ensure_family_objective(db, family_id, now=now)
    if not objective:
        return None
    period = objective["period"]
    progress_rows = await db.family_daily_progress.find(
        {"family_id": family_id, "period": period},
        {"_id": 0},
    ).sort([("completed_at", 1), ("username", 1)]).to_list(500)
    contributors = [
        {
            "user_id": row.get("user_id"),
            "username": row.get("username") or "?",
            "progress": min(int(row.get("progress") or 0), int(objective["target"])),
            "completed": bool(row.get("completed")),
            "completed_at": row.get("completed_at"),
        }
        for row in progress_rows
        if int(row.get("progress") or 0) > 0 or row.get("completed")
    ]
    mine = next((row for row in progress_rows if str(row.get("user_id")) == str(user_id)), None)
    reward_types = list(objective.get("reward_types") or ())
    completion_count = int(objective.get("completion_count") or 0)
    reward_per_completion = {
        "cash": CREW_CASH_PER_COMPLETION if "cash" in reward_types else 0,
        "points": CREW_POINTS_PER_COMPLETION if "points" in reward_types else 0,
        "loot": CREW_LOOT_PER_COMPLETION if "loot" in reward_types else 0,
    }
    reward_caps = {
        "cash": CREW_CASH_DAILY_CAP,
        "points": CREW_POINTS_DAILY_CAP,
        "loot": CREW_LOOT_DAILY_CAP,
        "token_pool_units": TOKEN_POOL_MAX_UNITS if "tokens" in reward_types else 0,
    }
    accrued = {
        "cash": min(CREW_CASH_DAILY_CAP, completion_count * CREW_CASH_PER_COMPLETION)
        if "cash" in reward_types else 0,
        "points": min(CREW_POINTS_DAILY_CAP, completion_count * CREW_POINTS_PER_COMPLETION)
        if "points" in reward_types else 0,
        "loot": min(CREW_LOOT_DAILY_CAP, completion_count * CREW_LOOT_PER_COMPLETION)
        if "loot" in reward_types else 0,
        "tokens": min(TOKEN_POOL_MAX_UNITS, completion_count)
        if "tokens" in reward_types else 0,
    }
    rewards = []
    for reward_type in reward_types:
        if reward_type == "tokens":
            rewards.append(
                {
                    "type": "tokens",
                    "label": "Normal Store tokens",
                    "amount": 1,
                    "cap": reward_caps["token_pool_units"],
                    "accrued": accrued["tokens"],
                    "destination": "qualifying members at UTC rollover",
                }
            )
        else:
            rewards.append(
                {
                    "type": reward_type,
                    "amount": reward_per_completion[reward_type],
                    "cap": reward_caps[reward_type],
                    "accrued": accrued[reward_type],
                    "destination": "crew vault",
                }
            )
    my_progress = min(int((mine or {}).get("progress") or 0), int(objective["target"]))
    my_completed = bool((mine or {}).get("completed"))
    eligible_count = int(objective.get("eligible_count") or 0)
    return {
        "family_id": family_id,
        "period": period,
        "period_start": objective.get("period_start"),
        "period_end": objective.get("period_end"),
        "reset_at": objective.get("period_end"),
        "objective_type": objective["objective_type"],
        "label": objective["label"],
        "target": int(objective["target"]),
        "objective": {
            "type": objective["objective_type"],
            "label": objective["label"],
            "target": int(objective["target"]),
        },
        "reward_types": reward_types,
        "rewards": rewards,
        "reward_per_completion": reward_per_completion,
        "reward_caps": reward_caps,
        "eligible_count": eligible_count,
        "eligible_member_count": eligible_count,
        "completion_count": completion_count,
        "completed_member_count": completion_count,
        "my_progress": my_progress,
        "my_completed": my_completed,
        "personal_progress": {
            "current": my_progress,
            "target": int(objective["target"]),
            "completed": my_completed,
        },
        "my_eligible": mine is not None,
        "contributors": contributors,
    }
