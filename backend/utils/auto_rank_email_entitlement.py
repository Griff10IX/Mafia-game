"""Email-tied permanent Auto Rank entitlement (Stripe £15)."""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

COLLECTION = "auto_rank_email_entitlements"


def normalize_entitlement_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    e = str(email).strip().lower()
    return e or None


async def get_auto_rank_email_entitlement(db, email: Optional[str]) -> Optional[dict]:
    norm = normalize_entitlement_email(email)
    if not norm:
        return None
    doc = await db[COLLECTION].find_one({"email": norm}, {"_id": 0})
    if not doc or doc.get("revoked"):
        return None
    return doc


async def email_has_auto_rank_entitlement(db, email: Optional[str]) -> bool:
    return (await get_auto_rank_email_entitlement(db, email)) is not None


async def grant_auto_rank_email_entitlement(
    db,
    email: Optional[str],
    *,
    source: str,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Optional[dict]:
    norm = normalize_entitlement_email(email)
    if not norm:
        return None
    now_iso = datetime.now(timezone.utc).isoformat()
    update: Dict[str, Any] = {
        "email": norm,
        "granted_at": now_iso,
        "source": str(source or "admin").strip() or "admin",
        "revoked": False,
    }
    if session_id:
        update["session_id"] = str(session_id)
    if user_id:
        update["granted_by_user_id"] = str(user_id)
    await db[COLLECTION].update_one(
        {"email": norm},
        {"$set": update, "$unset": {"revoked_at": "", "revoke_reason": ""}},
        upsert=True,
    )
    return await get_auto_rank_email_entitlement(db, norm)


async def revoke_auto_rank_email_entitlement(
    db,
    email: Optional[str],
    *,
    reason: str = "admin",
) -> bool:
    norm = normalize_entitlement_email(email)
    if not norm:
        return False
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db[COLLECTION].update_one(
        {"email": norm, "revoked": {"$ne": True}},
        {"$set": {"revoked": True, "revoked_at": now_iso, "revoke_reason": (reason or "admin")[:500]}},
    )
    return result.modified_count > 0


def _user_permanent_set_fields() -> Dict[str, Any]:
    return {
        "auto_rank_purchased": True,
        "auto_rank_permanent": True,
        "auto_rank_trial": False,
        "auto_rank_email_entitlement": True,
    }


async def sync_auto_rank_email_entitlement_to_user(
    db,
    user_id: Optional[str],
    email: Optional[str],
) -> bool:
    """If email has active entitlement, mirror permanent Auto Rank onto the user doc."""
    if not user_id:
        return False
    if not await email_has_auto_rank_entitlement(db, email):
        return False
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": _user_permanent_set_fields(),
            "$unset": {"auto_rank_trial_until": ""},
        },
    )
    try:
        from routers.account.auto_rank import wake_auto_rank_if_idle

        await wake_auto_rank_if_idle(db, user_id)
    except Exception:
        pass
    return True


async def clear_email_entitlement_from_users(db, email: Optional[str]) -> int:
    """Remove email-sourced permanent Auto Rank from all users with this email."""
    norm = normalize_entitlement_email(email)
    if not norm:
        return 0
    result = await db.users.update_many(
        {"email": norm, "auto_rank_email_entitlement": True},
        {
            "$set": {
                "auto_rank_purchased": False,
                "auto_rank_permanent": False,
                "auto_rank_enabled": False,
                "auto_rank_trial": False,
            },
            "$unset": {
                "auto_rank_trial_until": "",
                "auto_rank_email_entitlement": "",
            },
        },
    )
    return int(result.modified_count or 0)


async def sync_auto_rank_email_entitlement_to_all_users_with_email(db, email: Optional[str]) -> int:
    norm = normalize_entitlement_email(email)
    if not norm or not await email_has_auto_rank_entitlement(db, norm):
        return 0
    users = await db.users.find(
        {"email": norm, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(100)
    n = 0
    for u in users:
        if await sync_auto_rank_email_entitlement_to_user(db, u.get("id"), norm):
            n += 1
    return n


async def inspect_auto_rank_email_entitlement(db, email: Optional[str]) -> dict:
    norm = normalize_entitlement_email(email)
    if not norm:
        return {"email": None, "entitled": False, "record": None, "users": []}
    record = await db[COLLECTION].find_one({"email": norm}, {"_id": 0})
    active = bool(record and not record.get("revoked"))
    users: List[dict] = []
    if norm:
        rows = await db.users.find(
            {"email": norm},
            {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "auto_rank_permanent": 1, "auto_rank_email_entitlement": 1},
        ).to_list(50)
        users = [
            {
                "id": r.get("id"),
                "username": r.get("username"),
                "is_dead": bool(r.get("is_dead")),
                "auto_rank_permanent": bool(r.get("auto_rank_permanent")),
                "auto_rank_email_entitlement": bool(r.get("auto_rank_email_entitlement")),
            }
            for r in rows
        ]
    return {
        "email": norm,
        "entitled": active,
        "record": record,
        "users": users,
    }
