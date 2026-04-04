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


def game_pass_derived_fields(user_row: Dict[str, Any], *, now_utc: datetime) -> Dict[str, Any]:
    rp = int(user_row.get("rank_points") or 0)
    vip_claimed = user_row.get("rank_xp_pass_rewards_granted") is True
    current_micro = micro_tier_for_vip_game_pass(user_row) if vip_claimed else micro_tier_from_rank_points(rp)
    tokens = int(user_row.get("rank_xp_pass_tokens") or 0)
    last_granted = int(user_row.get("rank_xp_pass_last_granted_micro_tier") or 0)
    free_last = int(user_row.get("rank_xp_pass_free_last_micro_tier_granted") or 0)

    expires_dt = _parse_iso_utc(user_row.get("rank_xp_pass_token_expires_at"))

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
        or user_row.get("rank_xp_pass_token_expires_at")
        or user_row.get("rank_xp_pass_tier_snapshot") is not None
        or user_row.get("rank_xp_pass_pending_tier_snapshot") is not None
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
        "catch_up_pending": catch_up_pending,
        "unactivated_token_active": unactivated_active,
        "vip_token_expired_unactivated": unactivated_expired,
        "vip_reward_window_active": vip_window_active,
        "game_pass_status": status,
        "rank_xp_pass_last_granted_micro_tier": last_granted,
        "rank_xp_pass_free_last_micro_tier_granted": free_last,
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
) -> str:
    if stripe_events:
        return "stripe"
    if (
        int(user_row.get("rank_xp_pass_tokens") or 0) > 0
        or user_row.get("rank_xp_pass_rewards_granted") is True
        or user_row.get("rank_xp_pass_pending_tier_snapshot") is not None
        or user_row.get("rank_xp_pass_tier_snapshot") is not None
        or user_row.get("rank_xp_pass_token_expires_at")
    ):
        return "points_or_admin"
    return "unknown"
