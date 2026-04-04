# New account civilian protection: 48h from created_at, revocable by rules or manual opt-out.
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

PROTECTION_HOURS = 48

CIVILIAN_PROTECTION_KILL_BLOCKED_DETAIL = (
    "That player is under new account protection and cannot be attacked yet."
)

RULES_BULLETS: List[str] = [
    "Winning a casino and declining or ignoring buyback.",
    "Searching another user or bodyguard (assassination / hitlist NPC targets are allowed).",
    "Adding another user to the hitlist.",
    "Applying to or creating a crew.",
    "Buying an exclusive car.",
    "Purchasing or allowing casinos or properties to be sent to your account.",
]


def _parse_user_dt(val: Any) -> Optional[datetime]:
    if val is None:
        return None
    if hasattr(val, "year"):
        dt = val
        return dt.replace(tzinfo=timezone.utc) if getattr(dt, "tzinfo", None) is None else dt
    try:
        s = str(val).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


def protection_window_end_dt(user: Optional[dict]) -> Optional[datetime]:
    if not user:
        return None
    created = _parse_user_dt(user.get("created_at"))
    if not created:
        return None
    return created + timedelta(hours=PROTECTION_HOURS)


def protection_window_end_iso(user: Optional[dict]) -> Optional[str]:
    end = protection_window_end_dt(user)
    return end.isoformat() if end else None


def is_civilian_protected(user: Optional[dict]) -> bool:
    """True if this user is within the 48h window and has not revoked protection. NPCs and staff are never 'protected' for combat rules."""
    if not user or user.get("is_npc"):
        return False
    try:
        from server import ADMIN_EMAILS, _is_moderator

        if _is_moderator(user):
            return False
        if (user.get("email") or "") in ADMIN_EMAILS:
            return False
    except Exception:
        pass

    if user.get("civilian_protection_revoked_at"):
        return False

    end = protection_window_end_dt(user)
    if not end:
        return False
    now = datetime.now(timezone.utc)
    return now < end


async def revoke_civilian_protection(db, user_id: str, reason: str) -> bool:
    """Set revocation once. Returns True if this call applied the update."""
    if not user_id:
        return False
    now = datetime.now(timezone.utc).isoformat()
    r = str(reason or "unknown")[:120]
    res = await db.users.update_one(
        {
            "id": user_id,
            "$or": [
                {"civilian_protection_revoked_at": {"$exists": False}},
                {"civilian_protection_revoked_at": None},
            ],
        },
        {"$set": {"civilian_protection_revoked_at": now, "civilian_protection_revoke_reason": r}},
    )
    return res.modified_count > 0


async def maybe_revoke_civilian_protection(db, user_id: str, reason: str) -> None:
    await revoke_civilian_protection(db, user_id, reason)


async def cleanup_expired_buyback_offers_for_user(
    db,
    collection_name: str,
    to_user_id: str,
    now_iso: str,
) -> None:
    """Delete expired buy-back offers for this winner and revoke civilian protection if any were removed."""
    if not to_user_id:
        return
    coll = db[collection_name]
    q = {"to_user_id": to_user_id, "expires_at": {"$lt": now_iso}}
    n = await coll.count_documents(q)
    if n <= 0:
        return
    await maybe_revoke_civilian_protection(db, to_user_id, "casino_buyback_expired")
    await coll.delete_many(q)


def civilian_protection_status_payload(user: dict) -> Dict[str, Any]:
    """JSON for GET /account/civilian-protection."""
    ends_at = protection_window_end_iso(user)
    revoked_at = user.get("civilian_protection_revoked_at")
    revoke_reason = user.get("civilian_protection_revoke_reason")
    active = is_civilian_protected(user)
    return {
        "active": active,
        "ends_at": ends_at,
        "revoked_at": revoked_at,
        "revoke_reason": revoke_reason,
        "rules_bullets": list(RULES_BULLETS),
        "protection_hours": PROTECTION_HOURS,
    }
