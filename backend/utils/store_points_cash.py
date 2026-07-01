"""Store cash → points: monthly IP/email caps and audit helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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
STORE_CASH_PURCHASE_LOGS = "store_cash_purchase_logs"

STORE_CASH_PURCHASE_KINDS = (
    "points_cash",
    "token_cash",
    "token_bundle_cash",
    "token_selectable_bundle_cash",
)


def store_cash_item_label(
    purchase_kind: str,
    *,
    points: Optional[int] = None,
    token_type: Optional[str] = None,
    amount: Optional[int] = None,
    bundle_id: Optional[str] = None,
    selected_tokens: Optional[List[dict]] = None,
) -> str:
    k = (purchase_kind or "").strip()
    if k == "points_cash":
        return f"+{int(points or 0):,} points"
    if k == "token_cash":
        tt = (token_type or "?").replace("_", " ")
        return f"+{int(amount or 0):,}× {tt}"
    if k == "token_bundle_cash":
        return f"Token bundle: {bundle_id or '?'}"
    if k == "token_selectable_bundle_cash":
        if selected_tokens:
            parts = [f"{int(t.get('amount') or 0)}× {(t.get('token_type') or '?').replace('_', ' ')}" for t in selected_tokens]
            return "Selectable bundle: " + ", ".join(parts)
        return "Selectable token bundle"
    return k or "store_cash"


async def record_store_cash_purchase(
    db,
    *,
    purchase_id: str,
    purchase_kind: str,
    user: dict,
    cash_cost: int,
    price_per_point: float,
    money_before: float,
    money_after: float,
    client_ip: str = "",
    email: Optional[str] = None,
    qt_offers_used: int = 0,
    used_qt_average: bool = False,
    points: Optional[int] = None,
    points_before: Optional[int] = None,
    points_after: Optional[int] = None,
    points_equivalent: Optional[int] = None,
    token_type: Optional[str] = None,
    amount: Optional[int] = None,
    bundle_id: Optional[str] = None,
    selected_tokens: Optional[List[dict]] = None,
    month_key: Optional[str] = None,
    ip_month_spent_before: Optional[int] = None,
    ip_month_spent_after: Optional[int] = None,
    email_month_spent_before: Optional[int] = None,
    email_month_spent_after: Optional[int] = None,
    token_cash_day_before: Optional[int] = None,
    token_cash_day_after: Optional[int] = None,
) -> None:
    """Detailed audit row for any store purchase paid with in-game cash."""
    now_iso = datetime.now(timezone.utc).isoformat()
    item_label = store_cash_item_label(
        purchase_kind,
        points=points,
        token_type=token_type,
        amount=amount,
        bundle_id=bundle_id,
        selected_tokens=selected_tokens,
    )
    doc: Dict[str, Any] = {
        "id": purchase_id,
        "purchase_kind": purchase_kind,
        "item_label": item_label,
        "user_id": user.get("id"),
        "username": user.get("username", "?"),
        "prestige_level": int(user.get("prestige_level") or 0),
        "email": email,
        "client_ip": client_ip or None,
        "cash_cost": int(cash_cost),
        "price_per_point": round(float(price_per_point), 2),
        "qt_offers_used": int(qt_offers_used or 0),
        "used_qt_average": bool(used_qt_average),
        "money_before": float(money_before),
        "money_after": float(money_after),
        "created_at": now_iso,
    }
    if points is not None:
        doc["points"] = int(points)
    if points_before is not None:
        doc["points_before"] = int(points_before)
    if points_after is not None:
        doc["points_after"] = int(points_after)
    if points_equivalent is not None:
        doc["points_equivalent"] = int(points_equivalent)
    if token_type:
        doc["token_type"] = token_type
    if amount is not None:
        doc["amount"] = int(amount)
    if bundle_id:
        doc["bundle_id"] = bundle_id
    if selected_tokens:
        doc["selected_tokens"] = selected_tokens
    if month_key:
        doc["month_key"] = month_key
    if ip_month_spent_before is not None:
        doc["ip_month_spent_before"] = int(ip_month_spent_before)
    if ip_month_spent_after is not None:
        doc["ip_month_spent_after"] = int(ip_month_spent_after)
    if email_month_spent_before is not None:
        doc["email_month_spent_before"] = int(email_month_spent_before)
    if email_month_spent_after is not None:
        doc["email_month_spent_after"] = int(email_month_spent_after)
    if token_cash_day_before is not None:
        doc["token_cash_day_before"] = int(token_cash_day_before)
    if token_cash_day_after is not None:
        doc["token_cash_day_after"] = int(token_cash_day_after)
    await db[STORE_CASH_PURCHASE_LOGS].insert_one(doc)
    if purchase_kind == "points_cash":
        legacy = {k: v for k, v in doc.items() if k != "purchase_kind" and k != "item_label" and k != "points_equivalent" and k != "prestige_level" and k != "token_cash_day_before" and k != "token_cash_day_after"}
        await db[STORE_POINTS_CASH_LOGS].insert_one(legacy)


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
