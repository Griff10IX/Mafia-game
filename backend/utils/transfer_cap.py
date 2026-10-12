"""Weekly send cap for accounts tied to lifted RMT IP bans (bank cash + store points).

Sources are ip_bans docs with transfer_cap_source=True (inactive, so the IP is no longer blocked).
An account is capped when its email, registration IP, last login IP or current IP matches a source.
Only an admin clears it (transfer_cap_cleared=True stops automatic re-flagging).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

CASH_WEEK_CAP = 100_000_000_000
POINTS_WEEK_CAP = 100_000
WINDOW_DAYS = 7


async def _matches_source(db, user: dict, client_ip: str) -> bool:
    ips = {ip for ip in (client_ip, user.get("registration_ip"), user.get("last_login_ip")) if ip}
    if ips:
        hit = await db.ip_bans.find_one({"transfer_cap_source": True, "ip": {"$in": list(ips)}}, {"_id": 1})
        if hit:
            return True
    emails = {(e or "").strip() for e in (user.get("email"), user.get("email_before_freed")) if (e or "").strip()}
    if not emails:
        return False
    source_ids = await db.ip_bans.distinct("source_user_id", {"transfer_cap_source": True})
    if not source_ids:
        return False
    pats = [re.compile("^" + re.escape(e) + "$", re.IGNORECASE) for e in emails]
    hit = await db.users.find_one(
        {"id": {"$in": source_ids}, "$or": [{"email": {"$in": pats}}, {"email_before_freed": {"$in": pats}}]},
        {"_id": 1},
    )
    return bool(hit)


async def is_transfer_capped(db, user_id: str, client_ip: str = "") -> bool:
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "transfer_capped": 1, "transfer_cap_cleared": 1, "email": 1, "email_before_freed": 1, "registration_ip": 1, "last_login_ip": 1},
    )
    if not user or user.get("transfer_cap_cleared"):
        return False
    if user.get("transfer_capped"):
        return True
    if await _matches_source(db, user, client_ip):
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"transfer_capped": True, "transfer_capped_at": datetime.now(timezone.utc).isoformat()}},
        )
        return True
    return False


async def _sent_this_week(db, collection: str, user_id: str) -> int:
    since = (datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)).isoformat()
    rows = await db[collection].aggregate(
        [
            {"$match": {"from_user_id": user_id, "created_at": {"$gte": since}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]
    ).to_list(1)
    return int(rows[0]["total"]) if rows else 0


async def enforce_transfer_cap(db, user_id: str, amount: int, *, kind: str, client_ip: str = "") -> None:
    """Raise 400 if this send would take a capped account over its rolling 7-day limit. kind: 'cash' or 'points'."""
    if not await is_transfer_capped(db, user_id, client_ip):
        return
    if kind == "cash":
        cap, collection = CASH_WEEK_CAP, "money_transfers"
    else:
        cap, collection = POINTS_WEEK_CAP, "points_transfers"
    sent = await _sent_this_week(db, collection, user_id)
    left = max(0, cap - sent)
    if int(amount) <= left:
        return
    if kind == "cash":
        detail = f"Your account can send at most ${cap:,} a week. You can send ${left:,} more right now."
    else:
        detail = f"Your account can send at most {cap:,} points a week. You can send {left:,} more right now."
    raise HTTPException(status_code=400, detail=detail)


async def set_transfer_cap(db, user_id: str, enabled: bool, staff_username: Optional[str] = None) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    if enabled:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"transfer_capped": True, "transfer_capped_at": now_iso}, "$unset": {"transfer_cap_cleared": ""}},
        )
    else:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"transfer_capped": False, "transfer_cap_cleared": True, "transfer_cap_cleared_by": staff_username, "transfer_cap_cleared_at": now_iso}},
        )
