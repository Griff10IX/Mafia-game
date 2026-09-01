# Live bank economy: Swiss default cap + interest deposit terms (game_settings overrides).
from __future__ import annotations

from typing import Any, Dict, List, Optional

KEY_SWISS_DEFAULT = "bank_swiss_default_limit"
KEY_INTEREST_MAX = "bank_interest_max_unclaimed_principal"
KEY_INTEREST_OPTIONS = "bank_interest_options"

# Personal interest cap: start $5B, 1000 points per +$2.5B, hard max $50B.
INTEREST_LIMIT_START = 5_000_000_000
INTEREST_LIMIT_STEP = 2_500_000_000
INTEREST_LIMIT_HARD_MAX = 50_000_000_000
INTEREST_LIMIT_UPGRADE_COST = 1000
INTEREST_LIMIT_UPGRADES_FIELD = "interest_limit_upgrades"
_LEGACY_INTEREST_MAX = 50_000_000


def normalize_interest_options(raw: Any, fallback: List[dict]) -> List[dict]:
    """Return sorted list of {hours, rate}; invalid entries dropped. fallback used if raw unusable."""
    if not isinstance(raw, list) or not raw:
        return [dict(x) for x in fallback]
    out: List[dict] = []
    seen_hours: set = set()
    for x in raw:
        if not isinstance(x, dict):
            continue
        try:
            h = int(x.get("hours", 0) or 0)
            rate = float(x.get("rate", 0) or 0)
        except (TypeError, ValueError):
            continue
        if h < 1 or h > 24 * 30:
            continue
        if rate < 0 or rate > 10:
            continue
        if h in seen_hours:
            continue
        seen_hours.add(h)
        out.append({"hours": h, "rate": rate})
    if not out:
        return [dict(x) for x in fallback]
    return sorted(out, key=lambda o: o["hours"])


async def get_bank_economy_config(
    db,
    *,
    swiss_fallback: int,
    interest_max_fallback: int,
    interest_options_fallback: List[dict],
) -> Dict[str, Any]:
    keys = [KEY_SWISS_DEFAULT, KEY_INTEREST_MAX, KEY_INTEREST_OPTIONS]
    docs = await db.game_settings.find({"key": {"$in": keys}}, {"_id": 0, "key": 1, "value": 1}).to_list(10)
    by_k = {d.get("key"): d.get("value") for d in docs if d.get("key")}

    swiss = swiss_fallback
    raw_sw = by_k.get(KEY_SWISS_DEFAULT)
    if raw_sw is not None:
        try:
            swiss = max(1_000, min(int(raw_sw), 10**15))
        except (TypeError, ValueError):
            swiss = swiss_fallback

    mx = interest_max_fallback
    raw_mx = by_k.get(KEY_INTEREST_MAX)
    if raw_mx is not None:
        try:
            mx = max(1, min(int(raw_mx), INTEREST_LIMIT_HARD_MAX))
        except (TypeError, ValueError):
            mx = interest_max_fallback

    mx = max(1, min(int(mx), INTEREST_LIMIT_HARD_MAX))
    if mx == _LEGACY_INTEREST_MAX:
        mx = INTEREST_LIMIT_START

    opts = normalize_interest_options(by_k.get(KEY_INTEREST_OPTIONS), interest_options_fallback)

    return {
        "swiss_limit_start": swiss,
        "interest_max_unclaimed_principal": mx,
        "interest_options": opts,
        "interest_limit_step": INTEREST_LIMIT_STEP,
        "interest_limit_hard_max": INTEREST_LIMIT_HARD_MAX,
        "interest_limit_upgrade_cost": INTEREST_LIMIT_UPGRADE_COST,
    }


def personal_interest_limit(user: Optional[dict], start: int) -> int:
    start_n = max(1, min(int(start or 0), INTEREST_LIMIT_HARD_MAX))
    try:
        n = max(0, int((user or {}).get(INTEREST_LIMIT_UPGRADES_FIELD) or 0))
    except (TypeError, ValueError):
        n = 0
    return min(INTEREST_LIMIT_HARD_MAX, start_n + n * INTEREST_LIMIT_STEP)


def interest_limit_upgrade_add(current: int) -> int:
    current_n = max(0, int(current or 0))
    if current_n >= INTEREST_LIMIT_HARD_MAX:
        return 0
    return min(INTEREST_LIMIT_STEP, INTEREST_LIMIT_HARD_MAX - current_n)


def interest_limit_max_upgrades(start: int) -> int:
    start_n = max(1, min(int(start or 0), INTEREST_LIMIT_HARD_MAX))
    if start_n >= INTEREST_LIMIT_HARD_MAX:
        return 0
    remaining = INTEREST_LIMIT_HARD_MAX - start_n
    return (remaining + INTEREST_LIMIT_STEP - 1) // INTEREST_LIMIT_STEP


async def apply_interest_limit_upgrade(db, uid: str, *, inc: Dict[str, Any], gte_filter: Dict[str, Any]) -> Dict[str, Any]:
    """Atomically spend currency in `inc` and raise the personal interest cap by one step."""
    from fastapi import HTTPException
    from pymongo import ReturnDocument

    cfg = await get_bank_economy_config(
        db,
        swiss_fallback=1,
        interest_max_fallback=INTEREST_LIMIT_START,
        interest_options_fallback=[],
    )
    start = int(cfg["interest_max_unclaimed_principal"])
    max_upgrades = interest_limit_max_upgrades(start)
    if max_upgrades <= 0:
        raise HTTPException(status_code=400, detail="Interest limit is already at the $50,000,000,000 maximum")

    user = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1, INTEREST_LIMIT_UPGRADES_FIELD: 1})
    current_limit = personal_interest_limit(user, start)
    add = interest_limit_upgrade_add(current_limit)
    if add <= 0:
        raise HTTPException(status_code=400, detail="Interest limit is already at the $50,000,000,000 maximum")

    merged_inc = {**dict(inc or {}), INTEREST_LIMIT_UPGRADES_FIELD: 1}
    after = await db.users.find_one_and_update(
        {
            "id": uid,
            **dict(gte_filter or {}),
            "$or": [
                {INTEREST_LIMIT_UPGRADES_FIELD: {"$exists": False}},
                {INTEREST_LIMIT_UPGRADES_FIELD: {"$lt": max_upgrades}},
            ],
        },
        {"$inc": merged_inc},
        return_document=ReturnDocument.AFTER,
    )
    if not after:
        raise HTTPException(status_code=400, detail="Could not raise interest limit. Check points and try again.")
    return {
        "added": add,
        "interest_limit": personal_interest_limit(after, start),
        "points": int(after.get("points") or 0),
        "upgrades": max(0, int(after.get(INTEREST_LIMIT_UPGRADES_FIELD) or 0)),
    }


def interest_limit_public(user: Optional[dict], start: int, *, principal: int = 0, points: int = 0) -> Dict[str, Any]:
    limit = personal_interest_limit(user, start)
    add = interest_limit_upgrade_add(limit)
    return {
        "interest_limit": limit,
        "interest_principal": max(0, int(principal or 0)),
        "interest_limit_max": INTEREST_LIMIT_HARD_MAX,
        "interest_limit_step": INTEREST_LIMIT_STEP,
        "interest_limit_upgrade_cost": INTEREST_LIMIT_UPGRADE_COST,
        "interest_limit_upgrade_add": add,
        "interest_limit_at_max": add <= 0,
        "points": max(0, int(points or 0)),
    }


def interest_option_for_hours(options: List[dict], duration_hours: int) -> Optional[dict]:
    try:
        h = int(duration_hours)
    except (TypeError, ValueError):
        return None
    return next((o for o in options if int(o.get("hours", 0) or 0) == h), None)


def compute_bank_interest_previews(interest_options: List[dict], principals: List[int]) -> List[dict]:
    """For admin UI: sample maturity math per principal."""
    out: List[dict] = []
    opts = sorted(interest_options, key=lambda x: int(x.get("hours", 0) or 0))
    for p in principals:
        try:
            principal = max(0, int(p))
        except (TypeError, ValueError):
            continue
        rows = []
        for o in opts:
            h = int(o.get("hours", 0) or 0)
            rate = float(o.get("rate", 0) or 0)
            interest = int(round(principal * rate))
            rows.append(
                {
                    "hours": h,
                    "rate": rate,
                    "rate_percent": round(rate * 100, 4),
                    "interest": interest,
                    "maturity_total": principal + interest,
                }
            )
        out.append({"principal": principal, "options": rows})
    return out
