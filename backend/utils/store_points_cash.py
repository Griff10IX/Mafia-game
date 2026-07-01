"""Store cash → points: monthly IP/email caps and audit helpers."""
from __future__ import annotations

from typing import Optional, Tuple

from fastapi import Request

from utils.auto_rank_email_entitlement import normalize_entitlement_email
from utils.game_timezone import game_month_start_date_str
from utils.ip_normalize import normalize_ip_string

POINTS_CASH_MIN_PRICE_PER_POINT = 550_000
POINTS_CASH_MONTHLY_LIMIT = 2_000_000_000
POINTS_CASH_MIN_PRESTIGE_LEVEL = 1


def points_cash_prestige_eligible(user: dict) -> bool:
    return int(user.get("prestige_level") or 0) >= POINTS_CASH_MIN_PRESTIGE_LEVEL

STORE_POINTS_CASH_IP_MONTHLY = "store_points_cash_ip_monthly"
STORE_POINTS_CASH_EMAIL_MONTHLY = "store_points_cash_email_monthly"
STORE_POINTS_CASH_LOGS = "store_points_cash_logs"


def client_ip_from_request(request: Request) -> str:
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        n = normalize_ip_string(cf_ip)
        if n:
            return n
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        n = normalize_ip_string(forwarded)
        if n:
            return n
    if request.client:
        return normalize_ip_string(request.client.host or "") or ""
    return ""


def verified_email_for_user(user: dict) -> Optional[str]:
    if user.get("email_verified") is False:
        return None
    return normalize_entitlement_email(user.get("email"))


async def monthly_cash_spent(db, collection: str, key_name: str, key_value: str, month_key: str) -> int:
    doc = await db[collection].find_one({key_name: key_value, "month_key": month_key}, {"cash_spent": 1})
    return int((doc or {}).get("cash_spent") or 0)


async def cap_allowance_summary(db, *, client_ip: str, email: str, month_key: Optional[str] = None) -> dict:
    mk = month_key or game_month_start_date_str()
    ip_spent = await monthly_cash_spent(db, STORE_POINTS_CASH_IP_MONTHLY, "ip", client_ip, mk) if client_ip else POINTS_CASH_MONTHLY_LIMIT
    email_spent = await monthly_cash_spent(db, STORE_POINTS_CASH_EMAIL_MONTHLY, "email", email, mk) if email else POINTS_CASH_MONTHLY_LIMIT
    ip_remaining = max(0, POINTS_CASH_MONTHLY_LIMIT - ip_spent)
    email_remaining = max(0, POINTS_CASH_MONTHLY_LIMIT - email_spent)
    return {
        "month_key": mk,
        "monthly_limit": POINTS_CASH_MONTHLY_LIMIT,
        "ip_spent": ip_spent,
        "ip_remaining": ip_remaining,
        "email_spent": email_spent,
        "email_remaining": email_remaining,
        "effective_remaining": min(ip_remaining, email_remaining),
    }


async def _try_increment_cap(
    db,
    *,
    collection: str,
    key_name: str,
    key_value: str,
    month_key: str,
    cash_cost: int,
    limit: int,
) -> Tuple[bool, int]:
    """Optimistic-lock increment; returns (ok, spent_before)."""
    cash_cost = int(cash_cost)
    if cash_cost <= 0:
        return False, 0
    for _ in range(6):
        doc = await db[collection].find_one({key_name: key_value, "month_key": month_key}, {"cash_spent": 1})
        before = int((doc or {}).get("cash_spent") or 0)
        if before + cash_cost > limit:
            return False, before
        filt = {key_name: key_value, "month_key": month_key}
        if doc:
            filt["cash_spent"] = before
        else:
            filt["cash_spent"] = {"$exists": False}
        res = await db[collection].update_one(
            filt,
            {
                "$inc": {"cash_spent": cash_cost},
                "$set": {key_name: key_value, "month_key": month_key},
            },
            upsert=not bool(doc),
        )
        if res.modified_count > 0 or res.upserted_id is not None:
            return True, before
    return False, before


async def increment_ip_cap(db, *, client_ip: str, month_key: str, cash_cost: int) -> Tuple[bool, int]:
    return await _try_increment_cap(
        db,
        collection=STORE_POINTS_CASH_IP_MONTHLY,
        key_name="ip",
        key_value=client_ip,
        month_key=month_key,
        cash_cost=cash_cost,
        limit=POINTS_CASH_MONTHLY_LIMIT,
    )


async def increment_email_cap(db, *, email: str, month_key: str, cash_cost: int) -> Tuple[bool, int]:
    return await _try_increment_cap(
        db,
        collection=STORE_POINTS_CASH_EMAIL_MONTHLY,
        key_name="email",
        key_value=email,
        month_key=month_key,
        cash_cost=cash_cost,
        limit=POINTS_CASH_MONTHLY_LIMIT,
    )


async def rollback_cap(db, *, collection: str, key_name: str, key_value: str, month_key: str, cash_cost: int) -> None:
    await db[collection].update_one(
        {key_name: key_value, "month_key": month_key, "cash_spent": {"$gte": cash_cost}},
        {"$inc": {"cash_spent": -int(cash_cost)}},
    )
