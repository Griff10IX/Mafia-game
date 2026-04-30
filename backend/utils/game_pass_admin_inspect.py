"""
Admin-only helpers: derive Game Pass status from user docs and payment history.
"""

from __future__ import annotations

import calendar
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from utils.game_pass_micro_rewards import micro_tier_for_vip_game_pass, micro_tier_from_rank_points

RANK_XP_PASS_PACKAGE_ID = "rank_xp_pass_499"

# Fields returned for list + inspect (no passwords).
GAME_PASS_USER_PROJECTION = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "rank_points": 1,
    "rank_xp_pass_season_rp": 1,
    "game_pass_season_id": 1,
    "rank_xp_pass_tokens": 1,
    "rank_xp_pass_token_expires_at": 1,
    "rank_xp_pass_rewards_granted": 1,
    "rank_xp_pass_last_granted_micro_tier": 1,
    "rank_xp_pass_tier_snapshot": 1,
    "rank_xp_pass_pending_tier_snapshot": 1,
    "rank_xp_pass_free_last_micro_tier_granted": 1,
    "rank_xp_pass_bonus_until": 1,
    "rank_xp_pass_prestige_carry_rp": 1,
}


def _parse_iso_utc(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _add_calendar_months(dt: datetime, months: int) -> datetime:
    """Add signed calendar months in UTC (matches payments Game Pass expiry math)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    y = dt.year + (dt.month - 1 + months) // 12
    m = (dt.month - 1 + months) % 12 + 1
    last_day = calendar.monthrange(y, m)[1]
    d = min(dt.day, last_day)
    return dt.replace(year=y, month=m, day=d)


def escape_regex_fragment(q: str) -> str:
    return re.escape((q or "").strip())


def game_pass_mongo_filter() -> Dict[str, Any]:
    """Users with any Game Pass–related state worth listing."""
    return {
        "$or": [
            {"rank_xp_pass_tokens": {"$gt": 0}},
            {"rank_xp_pass_rewards_granted": True},
            {"rank_xp_pass_free_last_micro_tier_granted": {"$gt": 0}},
            {
                "rank_xp_pass_token_expires_at": {
                    "$exists": True,
                    "$nin": [None, ""],
                }
            },
            {"rank_xp_pass_tier_snapshot": {"$exists": True, "$ne": None}},
            {"rank_xp_pass_pending_tier_snapshot": {"$exists": True, "$ne": None}},
        ]
    }


def game_pass_vip_or_token_mongo_filter() -> Dict[str, Any]:
    """
    Subset: looks like a real Game Pass entitlement (token, VIP, expiry, or tier snapshots).
    Excludes free-track-only users (only rank_xp_pass_free_last_micro_tier_granted).
    """
    return {
        "$or": [
            {"rank_xp_pass_tokens": {"$gt": 0}},
            {"rank_xp_pass_rewards_granted": True},
            {
                "rank_xp_pass_token_expires_at": {
                    "$exists": True,
                    "$nin": [None, ""],
                }
            },
            {"rank_xp_pass_pending_tier_snapshot": {"$exists": True, "$ne": None}},
            {"rank_xp_pass_tier_snapshot": {"$exists": True, "$ne": None}},
        ]
    }


POINTS_GAME_PASS_EVENT_TYPE = "buy_game_pass_points"


async def aggregate_game_pass_users_without_stripe_purchase(
    db,
    *,
    skip: int,
    limit: int,
    username_regex: Optional[str],
    now_utc: datetime,
) -> Dict[str, Any]:
    """
    Users with VIP/token-style pass state and no completed Stripe rank_xp_pass_499 row.
    Adds points-ledger timestamp (buy_game_pass_points) and an attribution hint for admin review.
    """
    from utils.game_pass_season_rp import (
        current_game_pass_season_id,
        reconcile_stale_game_pass_users_for_filter,
    )

    await reconcile_stale_game_pass_users_for_filter(db, game_pass_vip_or_token_mongo_filter())
    current_sid = await current_game_pass_season_id(db)

    base: Dict[str, Any] = game_pass_vip_or_token_mongo_filter()
    if username_regex:
        base = {"$and": [base, {"username": {"$regex": username_regex, "$options": "i"}}]}

    stripe_lookup = {
        "$lookup": {
            "from": "payment_transactions",
            "let": {"uid": "$id"},
            "pipeline": [
                {
                    "$match": {
                        "$expr": {
                            "$and": [
                                {"$eq": ["$user_id", "$$uid"]},
                                {"$eq": ["$package_id", RANK_XP_PASS_PACKAGE_ID]},
                                {"$eq": ["$payment_status", "completed"]},
                            ]
                        }
                    }
                },
                {"$limit": 1},
                {"$project": {"_id": 0}},
            ],
            "as": "_gp_stripe",
        }
    }
    points_lookup = {
        "$lookup": {
            "from": "point_ledger_events",
            "let": {"uid": "$id"},
            "pipeline": [
                {
                    "$match": {
                        "$expr": {
                            "$and": [
                                {"$eq": ["$user_id", "$$uid"]},
                                {"$eq": ["$event_type", POINTS_GAME_PASS_EVENT_TYPE]},
                            ]
                        }
                    }
                },
                {"$sort": {"created_at": -1}},
                {"$limit": 1},
                {"$project": {"_id": 0, "created_at": 1}},
            ],
            "as": "_gp_pts",
        }
    }

    pipeline: List[Dict[str, Any]] = [
        {"$match": base},
        stripe_lookup,
        {"$match": {"_gp_stripe": {"$eq": []}}},
        points_lookup,
        {"$sort": {"username": 1}},
        {
            "$facet": {
                "meta": [{"$count": "total"}],
                "data": [{"$skip": int(skip)}, {"$limit": int(limit)}],
            }
        },
    ]

    agg = await db.users.aggregate(pipeline).to_list(1)
    bucket = (agg[0] if agg else {}) or {}
    raw_rows = list(bucket.get("data") or [])
    meta = bucket.get("meta") or []
    total = int(meta[0]["total"]) if meta and isinstance(meta[0], dict) and "total" in meta[0] else 0

    proj_keys = [k for k in GAME_PASS_USER_PROJECTION if k != "_id"]
    items: List[Dict[str, Any]] = []
    for doc in raw_rows:
        row = {k: doc.get(k) for k in proj_keys}
        pts_rows = doc.get("_gp_pts") or []
        pts_at = (pts_rows[0] or {}).get("created_at") if pts_rows else None
        derived = game_pass_derived_fields(row, now_utc=now_utc, current_season_id=current_sid)
        hint = "points_ledger" if pts_at else "unattributed"
        items.append(
            {
                **row,
                **derived,
                "last_stripe_pass_entitled_at": None,
                "points_game_pass_purchase_at": pts_at,
                "pass_attribution_hint": hint,
            }
        )

    return {
        "items": items,
        "total": total,
        "list_mode": "without_stripe_purchase",
    }


def _game_pass_row_stale_for_season(user_row: Dict[str, Any], current_season_id: Optional[str]) -> bool:
    if not current_season_id or not str(current_season_id).strip():
        return False
    cur = str(current_season_id).strip()
    raw = user_row.get("game_pass_season_id")
    if raw is None:
        return True
    return str(raw).strip() != cur


def _masked_user_row_for_stale_season(user_row: Dict[str, Any]) -> Dict[str, Any]:
    """Prior-season progress must not read as active before/without a DB reconcile."""
    m = dict(user_row)
    m["rank_xp_pass_rewards_granted"] = False
    m["rank_xp_pass_tokens"] = 0
    m["rank_xp_pass_token_expires_at"] = None
    m["rank_xp_pass_bonus_until"] = None
    m["rank_xp_pass_last_granted_micro_tier"] = 0
    m["rank_xp_pass_tier_snapshot"] = None
    m["rank_xp_pass_pending_tier_snapshot"] = None
    m["rank_xp_pass_season_rp"] = 0
    m["rank_xp_pass_free_last_micro_tier_granted"] = 0
    return m


def game_pass_derived_fields(
    user_row: Dict[str, Any],
    *,
    now_utc: datetime,
    current_season_id: Optional[str] = None,
) -> Dict[str, Any]:
    stale = _game_pass_row_stale_for_season(user_row, current_season_id)
    eff = _masked_user_row_for_stale_season(user_row) if stale else user_row

    rp = int(eff.get("rank_points") or 0)
    season_rp = int(eff.get("rank_xp_pass_season_rp") or 0)
    vip_claimed = eff.get("rank_xp_pass_rewards_granted") is True
    current_micro = micro_tier_for_vip_game_pass(eff) if vip_claimed else micro_tier_from_rank_points(season_rp)
    tokens = int(eff.get("rank_xp_pass_tokens") or 0)
    last_granted = int(eff.get("rank_xp_pass_last_granted_micro_tier") or 0)
    free_last = int(eff.get("rank_xp_pass_free_last_micro_tier_granted") or 0)

    expires_dt = _parse_iso_utc(eff.get("rank_xp_pass_token_expires_at"))

    unactivated_active = bool(tokens > 0 and (expires_dt is None or expires_dt > now_utc))
    unactivated_expired = bool(tokens > 0 and expires_dt is not None and expires_dt <= now_utc)

    vip_window_active = False
    if vip_claimed:
        vip_window_active = True if expires_dt is None else bool(expires_dt > now_utc)

    catch_up_pending = bool(vip_claimed and vip_window_active and current_micro > last_granted)

    has_gp_fields = bool(
        tokens > 0
        or vip_claimed
        or free_last > 0
        or eff.get("rank_xp_pass_token_expires_at")
        or eff.get("rank_xp_pass_tier_snapshot") is not None
        or eff.get("rank_xp_pass_pending_tier_snapshot") is not None
    )

    if not has_gp_fields:
        status = "none"
    elif unactivated_expired:
        status = "token_expired"
    elif tokens > 0 and not vip_claimed:
        status = "token_ready"
    elif vip_claimed and vip_window_active:
        status = "vip_active"
    elif vip_claimed and not vip_window_active:
        status = "vip_claimed_expired_window"
    elif free_last > 0 and not vip_claimed and tokens <= 0:
        status = "free_track_only"
    else:
        status = "partial_or_legacy"

    return {
        "current_micro_tier": current_micro,
        "rank_points": rp,
        "rank_xp_pass_season_rp": season_rp,
        "catch_up_pending": catch_up_pending,
        "unactivated_token_active": unactivated_active,
        "vip_token_expired_unactivated": unactivated_expired,
        "vip_reward_window_active": vip_window_active,
        "game_pass_status": status,
        "rank_xp_pass_last_granted_micro_tier": last_granted,
        "rank_xp_pass_free_last_micro_tier_granted": free_last,
        "game_pass_season_stale_for_display": stale,
        "game_pass_season_current_id": str(current_season_id).strip() if current_season_id else None,
        "game_pass_season_stored_id": user_row.get("game_pass_season_id"),
    }


def estimate_entitlement_from_token_expiry(expires_iso: Any) -> Optional[Dict[str, Any]]:
    """
    Unactivated token expiry is set to ~now+1 month at purchase; approximate grant time as expiry - 1 month.
    """
    exp = _parse_iso_utc(expires_iso)
    if not exp:
        return None
    approx = _add_calendar_months(exp, -1)
    return {
        "estimated_entitlement_at": approx.isoformat(),
        "is_estimate": True,
        "note": "Derived from rank_xp_pass_token_expires_at minus one calendar month (same rule as checkout). Not stored on user.",
    }


async def aggregate_latest_game_pass_entitlement_iso(
    db,
    user_ids: List[str],
) -> Dict[str, Optional[str]]:
    """
    Latest completed Stripe Game Pass checkout per user (ISO timestamp for list column).
    Uses pass_entitled_at, else points_credited_at, else created_at.
    """
    if not user_ids:
        return {}
    uids = list({str(x) for x in user_ids})
    pipeline: List[Dict[str, Any]] = [
        {
            "$match": {
                "user_id": {"$in": uids},
                "package_id": RANK_XP_PASS_PACKAGE_ID,
                "payment_status": "completed",
            }
        },
        {
            "$addFields": {
                "_ts": {
                    "$ifNull": [
                        "$pass_entitled_at",
                        {"$ifNull": ["$points_credited_at", "$created_at"]},
                    ]
                }
            }
        },
        {"$sort": {"_ts": -1}},
        {
            "$group": {
                "_id": "$user_id",
                "pass_entitled_at": {"$first": "$pass_entitled_at"},
                "points_credited_at": {"$first": "$points_credited_at"},
                "created_at": {"$first": "$created_at"},
            }
        },
    ]
    out: Dict[str, Optional[str]] = {}
    async for doc in db.payment_transactions.aggregate(pipeline):
        uid = str(doc["_id"])
        ts = doc.get("pass_entitled_at") or doc.get("points_credited_at") or doc.get("created_at")
        out[uid] = ts
    return out


async def fetch_latest_points_game_pass_purchase(db, user_id: str) -> Optional[Dict[str, Any]]:
    """Most recent points spend for Game Pass (no Stripe row)."""
    if not user_id:
        return None
    cur = (
        db.point_ledger_events.find(
            {"user_id": str(user_id), "event_type": POINTS_GAME_PASS_EVENT_TYPE},
            {"_id": 0, "created_at": 1, "points": 1, "meta": 1},
        )
        .sort("created_at", -1)
        .limit(1)
    )
    rows = await cur.to_list(1)
    return rows[0] if rows else None


async def fetch_game_pass_payment_events(db, user_id: str, *, limit: int = 5) -> List[Dict[str, Any]]:
    cur = (
        db.payment_transactions.find(
            {
                "user_id": user_id,
                "package_id": RANK_XP_PASS_PACKAGE_ID,
                "payment_status": "completed",
            },
            {
                "_id": 0,
                "session_id": 1,
                "pass_entitled_at": 1,
                "points_credited_at": 1,
                "created_at": 1,
                "payment_status": 1,
            },
        )
        .sort([("pass_entitled_at", -1), ("points_credited_at", -1), ("created_at", -1)])
        .limit(limit)
    )
    return await cur.to_list(limit)


def classify_purchase_source(
    stripe_events: List[Dict[str, Any]],
    user_row: Dict[str, Any],
    *,
    has_points_game_pass_ledger: bool = False,
) -> str:
    if stripe_events:
        return "stripe"
    if has_points_game_pass_ledger:
        return "points_purchase"
    if (
        int(user_row.get("rank_xp_pass_tokens") or 0) > 0
        or user_row.get("rank_xp_pass_rewards_granted") is True
        or user_row.get("rank_xp_pass_pending_tier_snapshot") is not None
        or user_row.get("rank_xp_pass_tier_snapshot") is not None
        or user_row.get("rank_xp_pass_token_expires_at")
    ):
        return "admin_inheritance_or_legacy"
    return "unknown"
