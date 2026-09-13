"""
The Odds API monthly credit budget for free tier (~500/month).

Tracks x-requests-remaining / x-requests-used from responses, reserves credits for
settlement, and soft-caps non-settle spend across remaining days in the month.
"""
from __future__ import annotations

import calendar
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional, Tuple

logger = logging.getLogger(__name__)

QUOTA_DOC_ID = "the_odds_api"
# Keep this many credits for settle/scores so odds refreshes cannot empty the month.
DEFAULT_SETTLE_RESERVE = 80
DEFAULT_MONTHLY_BUDGET = 500


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def settle_reserve() -> int:
    return max(0, _env_int("SPORTS_ODDS_SETTLE_RESERVE", DEFAULT_SETTLE_RESERVE))


def monthly_budget_hint() -> int:
    return max(1, _env_int("SPORTS_ODDS_MONTHLY_BUDGET", DEFAULT_MONTHLY_BUDGET))


def _days_left_in_utc_month(now: Optional[datetime] = None) -> int:
    n = now or datetime.now(timezone.utc)
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    last = calendar.monthrange(n.year, n.month)[1]
    return max(1, last - n.day + 1)


async def _db():
    import server as srv  # lazy — avoid import cycles

    return srv.db


async def get_odds_quota_doc() -> dict:
    db = await _db()
    doc = await db.sports_odds_api_quota.find_one({"id": QUOTA_DOC_ID}, {"_id": 0})
    return doc if isinstance(doc, dict) else {}


async def record_odds_api_response_headers(headers: Any, *, purpose: str = "") -> dict:
    """Persist remaining/used from Odds API response headers. Safe no-op on failure."""
    try:
        h = headers
        get = h.get if hasattr(h, "get") else (lambda k, d=None: d)
        rem_raw = get("x-requests-remaining") or get("X-Requests-Remaining")
        used_raw = get("x-requests-used") or get("X-Requests-Used")
        last_raw = get("x-requests-last") or get("X-Requests-Last")
        remaining = None
        used = None
        last_cost = None
        if rem_raw is not None and str(rem_raw).strip() != "":
            remaining = int(float(str(rem_raw).strip()))
        if used_raw is not None and str(used_raw).strip() != "":
            used = int(float(str(used_raw).strip()))
        if last_raw is not None and str(last_raw).strip() != "":
            last_cost = int(float(str(last_raw).strip()))
        if remaining is None and used is None:
            return await get_odds_quota_doc()
        now = datetime.now(timezone.utc)
        fields: dict = {
            "id": QUOTA_DOC_ID,
            "updated_at": now.isoformat(),
            "last_purpose": (purpose or "")[:64],
        }
        if remaining is not None:
            fields["remaining"] = remaining
        if used is not None:
            fields["used"] = used
        if last_cost is not None:
            fields["last_cost"] = last_cost
        db = await _db()
        await db.sports_odds_api_quota.update_one({"id": QUOTA_DOC_ID}, {"$set": fields}, upsert=True)
        return fields
    except Exception as ex:
        logger.warning("odds_api_quota: failed to record headers: %s", ex)
        return {}


async def remaining_credits() -> Optional[int]:
    doc = await get_odds_quota_doc()
    rem = doc.get("remaining")
    if rem is None:
        return None
    try:
        return int(rem)
    except (TypeError, ValueError):
        return None


def soft_daily_allowance(remaining: Optional[int], now: Optional[datetime] = None) -> int:
    """Rough per-day spend ceiling so week-1 refresh spam cannot empty the month."""
    n = now or datetime.now(timezone.utc)
    days_left = _days_left_in_utc_month(n)
    reserve = settle_reserve()
    if remaining is None:
        remaining = monthly_budget_hint()
    spendable = max(0, int(remaining) - reserve)
    # Leave a little buffer; at least 1 credit/day when anything is spendable.
    return max(1, spendable // days_left) if spendable > 0 else 0


async def can_spend_odds_credits(
    *,
    purpose: str,
    estimated_cost: int = 1,
) -> Tuple[bool, str]:
    """
    purpose:
      - catalog: free (/sports) — always allow
      - settle: scores for auto-settle — allowed down to 0
      - odds: odds refresh / LMS boarding — blocked at settle reserve + soft daily cap
    """
    purpose = (purpose or "odds").strip().lower()
    cost = max(0, int(estimated_cost or 0))
    if purpose in ("catalog", "free") or cost <= 0:
        return True, ""

    rem = await remaining_credits()
    reserve = settle_reserve()

    if purpose == "settle":
        if rem is not None and rem < cost:
            return False, f"Odds API quota too low for settle (remaining={rem}, need~{cost})"
        return True, ""

    # Non-settle (odds refresh, LMS, etc.)
    if rem is not None and rem <= reserve:
        return (
            False,
            f"Odds API settle reserve active (remaining={rem}, reserve={reserve}); skipping non-settle call",
        )
    if rem is not None and rem - cost < reserve:
        return (
            False,
            f"Odds API call would breach settle reserve (remaining={rem}, cost~{cost}, reserve={reserve})",
        )

    daily = soft_daily_allowance(rem)
    if daily <= 0 and rem is not None:
        return False, "Odds API daily soft cap is 0 (preserving settle reserve)"

    # Track today's non-settle spend in the quota doc.
    try:
        db = await _db()
        now = datetime.now(timezone.utc)
        day_key = now.strftime("%Y-%m-%d")
        doc = await get_odds_quota_doc()
        spent_today = int(doc.get("non_settle_spent_today") or 0)
        if (doc.get("non_settle_day") or "") != day_key:
            spent_today = 0
        if spent_today + cost > daily and rem is not None:
            return (
                False,
                f"Odds API daily soft cap reached ({spent_today}/{daily} today; remaining={rem})",
            )
    except Exception as ex:
        logger.warning("odds_api_quota: daily cap check failed: %s", ex)

    return True, ""


async def note_non_settle_spend(cost: int) -> None:
    """Increment today's non-settle spend after a successful paid odds call."""
    cost = max(0, int(cost or 0))
    if cost <= 0:
        return
    try:
        db = await _db()
        now = datetime.now(timezone.utc)
        day_key = now.strftime("%Y-%m-%d")
        doc = await get_odds_quota_doc()
        if (doc.get("non_settle_day") or "") != day_key:
            await db.sports_odds_api_quota.update_one(
                {"id": QUOTA_DOC_ID},
                {
                    "$set": {
                        "id": QUOTA_DOC_ID,
                        "non_settle_day": day_key,
                        "non_settle_spent_today": cost,
                        "updated_at": now.isoformat(),
                    }
                },
                upsert=True,
            )
        else:
            await db.sports_odds_api_quota.update_one(
                {"id": QUOTA_DOC_ID},
                {
                    "$inc": {"non_settle_spent_today": cost},
                    "$set": {"updated_at": now.isoformat(), "non_settle_day": day_key},
                },
                upsert=True,
            )
    except Exception as ex:
        logger.warning("odds_api_quota: note_non_settle_spend failed: %s", ex)


async def quota_status_payload() -> dict:
    doc = await get_odds_quota_doc()
    rem = doc.get("remaining")
    try:
        rem_i = int(rem) if rem is not None else None
    except (TypeError, ValueError):
        rem_i = None
    return {
        "remaining": rem_i,
        "used": doc.get("used"),
        "settle_reserve": settle_reserve(),
        "soft_daily_allowance": soft_daily_allowance(rem_i),
        "non_settle_spent_today": doc.get("non_settle_spent_today"),
        "non_settle_day": doc.get("non_settle_day"),
        "updated_at": doc.get("updated_at"),
        "last_purpose": doc.get("last_purpose"),
        "last_cost": doc.get("last_cost"),
        "monthly_budget_hint": monthly_budget_hint(),
    }
