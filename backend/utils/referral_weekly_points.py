"""Weekly referral point bonuses: 1,000 pts to referrer and referee when referee is active 5+ London days/week."""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from utils.game_timezone import game_today_date_str, game_week_start_date_str
from utils.point_provenance import log_points_event
from utils.referral_ids import normalize_referred_by_ids, user_has_referrers

logger = logging.getLogger(__name__)

REFERRAL_WEEKLY_POINTS_PER_LINK = 1000
REFERRAL_WEEKLY_POINTS_CAP = 3000
REFERRAL_WEEKLY_MIN_ACTIVE_DAYS = 5
ACTIVITY_DAYS_RETAIN = 14


def _week_date_set(week_start: str) -> set[str]:
    mon = date.fromisoformat(week_start)
    return {(mon + timedelta(days=i)).isoformat() for i in range(7)}


def count_activity_days_in_week(activity_days: Any, week_start: str) -> int:
    week_dates = _week_date_set(week_start)
    days = activity_days if isinstance(activity_days, list) else []
    return sum(1 for d in days if isinstance(d, str) and d in week_dates)


def trim_activity_days(activity_days: Any, *, retain: int = ACTIVITY_DAYS_RETAIN) -> List[str]:
    if not isinstance(activity_days, list):
        return []
    uniq: List[str] = []
    seen = set()
    for raw in activity_days:
        d = str(raw).strip() if raw is not None else ""
        if not d or d in seen:
            continue
        seen.add(d)
        uniq.append(d)
    if len(uniq) <= retain:
        return uniq
    cutoff = date.fromisoformat(game_today_date_str()) - timedelta(days=retain - 1)
    cutoff_s = cutoff.isoformat()
    return sorted(d for d in uniq if d >= cutoff_s)


def referee_qualifies_for_weekly_points(user: dict, week_start: str) -> bool:
    if not user or user.get("is_dead") or user.get("is_npc") or user.get("is_bodyguard"):
        return False
    if user.get("email_verified") is False:
        return False
    if not user_has_referrers(user.get("referred_by")):
        return False
    active_days = count_activity_days_in_week(user.get("activity_days"), week_start)
    return active_days >= REFERRAL_WEEKLY_MIN_ACTIVE_DAYS


async def record_referral_activity_day(db, user_id: str, *, user: Optional[dict] = None) -> bool:
    """Record one London calendar activity day for referral weekly tracking. Returns True if newly added."""
    uid = str(user_id or "").strip()
    if not uid:
        return False
    today = game_today_date_str()
    existing = trim_activity_days((user or {}).get("activity_days"))
    if today in existing:
        return False
    existing.append(today)
    trimmed = trim_activity_days(existing)
    await db.users.update_one({"id": uid}, {"$set": {"activity_days": trimmed}})
    return True


async def _weekly_points_granted_total(db, beneficiary_id: str, week_start: str) -> int:
    pipeline = [
        {"$match": {"week_start": week_start, "beneficiary_id": beneficiary_id}},
        {"$group": {"_id": None, "total": {"$sum": "$points"}}},
    ]
    rows = await db.referral_weekly_grants.aggregate(pipeline).to_list(1)
    return int(rows[0]["total"]) if rows else 0


async def _try_grant_weekly_referral_points(
    db,
    *,
    beneficiary_id: str,
    week_start: str,
    points: int,
    role: str,
    referee_id: str,
    referrer_id: Optional[str] = None,
) -> int:
    bid = str(beneficiary_id or "").strip()
    rid = str(referee_id or "").strip()
    if not bid or not rid or points <= 0:
        return 0
    granted = await _weekly_points_granted_total(db, bid, week_start)
    if granted + points > REFERRAL_WEEKLY_POINTS_CAP:
        return 0
    grant_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": grant_id,
        "week_start": week_start,
        "beneficiary_id": bid,
        "role": role,
        "referee_id": rid,
        "referrer_id": str(referrer_id).strip() if referrer_id else None,
        "points": int(points),
        "created_at": now_iso,
    }
    try:
        await db.referral_weekly_grants.insert_one(doc)
    except Exception as exc:
        if getattr(exc, "code", None) == 11000:
            return 0
        raise
    user = await db.users.find_one({"id": bid}, {"_id": 0, "points": 1})
    before = int((user or {}).get("points") or 0)
    after = before + int(points)
    await db.users.update_one(
        {"id": bid},
        {"$inc": {"points": int(points), "referral_earnings_weekly_points": int(points)}},
    )
    await log_points_event(
        db,
        user_id=bid,
        points=int(points),
        event_type="referral_weekly",
        event_ref=f"{week_start}:{role}:{rid}",
        meta={
            "week_start": week_start,
            "role": role,
            "referee_id": rid,
            "referrer_id": referrer_id,
        },
        wallet_points_before=before,
        wallet_points_after=after,
    )
    return int(points)


async def _grant_referee_weekly_bonus(db, referee: dict, week_start: str) -> int:
    referee_id = str(referee.get("id") or "").strip()
    if not referee_id or not referee_qualifies_for_weekly_points(referee, week_start):
        return 0
    return await _try_grant_weekly_referral_points(
        db,
        beneficiary_id=referee_id,
        week_start=week_start,
        points=REFERRAL_WEEKLY_POINTS_PER_LINK,
        role="referee",
        referee_id=referee_id,
    )


async def _grant_referrer_weekly_bonus_for_referee(
    db,
    *,
    referrer_id: str,
    referee: dict,
    week_start: str,
) -> int:
    rid = str(referrer_id or "").strip()
    referee_id = str(referee.get("id") or "").strip()
    if not rid or not referee_id or rid == referee_id:
        return 0
    if not referee_qualifies_for_weekly_points(referee, week_start):
        return 0
    return await _try_grant_weekly_referral_points(
        db,
        beneficiary_id=rid,
        week_start=week_start,
        points=REFERRAL_WEEKLY_POINTS_PER_LINK,
        role="referrer",
        referee_id=referee_id,
        referrer_id=rid,
    )


async def process_referral_weekly_points(db, user_id: str) -> Dict[str, Any]:
    """Evaluate and grant weekly referral point bonuses for this user (referee + referrer roles)."""
    uid = str(user_id or "").strip()
    if not uid:
        return {}
    week_start = game_week_start_date_str()
    user = await db.users.find_one(
        {"id": uid},
        {
            "_id": 0,
            "id": 1,
            "referred_by": 1,
            "activity_days": 1,
            "is_dead": 1,
            "is_npc": 1,
            "is_bodyguard": 1,
            "email_verified": 1,
            "referral_earnings_weekly_points": 1,
        },
    )
    if not user:
        return {}

    granted_referee = await _grant_referee_weekly_bonus(db, user, week_start)
    granted_referrer = 0

    if referee_qualifies_for_weekly_points(user, week_start):
        for referrer_id in normalize_referred_by_ids(user.get("referred_by")):
            granted_referrer += await _grant_referrer_weekly_bonus_for_referee(
                db, referrer_id=referrer_id, referee=user, week_start=week_start
            )

    cursor = db.users.find(
        {"referred_by": uid},
        {
            "_id": 0,
            "id": 1,
            "referred_by": 1,
            "activity_days": 1,
            "is_dead": 1,
            "is_npc": 1,
            "is_bodyguard": 1,
            "email_verified": 1,
        },
    )
    async for referee in cursor:
        if str(referee.get("id") or "") == uid:
            continue
        granted_referrer += await _grant_referrer_weekly_bonus_for_referee(
            db, referrer_id=uid, referee=referee, week_start=week_start
        )

    earned_this_week = await _weekly_points_granted_total(db, uid, week_start)
    active_days = count_activity_days_in_week(user.get("activity_days"), week_start)
    return {
        "week_start": week_start,
        "active_days_this_week": active_days,
        "min_active_days_required": REFERRAL_WEEKLY_MIN_ACTIVE_DAYS,
        "weekly_cap": REFERRAL_WEEKLY_POINTS_CAP,
        "points_per_qualifying_link": REFERRAL_WEEKLY_POINTS_PER_LINK,
        "earned_this_week": earned_this_week,
        "cap_remaining": max(0, REFERRAL_WEEKLY_POINTS_CAP - earned_this_week),
        "referee_qualifies": referee_qualifies_for_weekly_points(user, week_start),
        "granted_this_run": int(granted_referee + granted_referrer),
    }
