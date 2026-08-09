# New account civilian protection: 14 days from created_at, revocable by rules or manual opt-out.
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Union

from fastapi import HTTPException
from starlette.requests import Request

PROTECTION_HOURS = 14 * 24

CIVILIAN_PROTECTION_KILL_BLOCKED_DETAIL = (
    "That player still has new-account protection and can't be attacked in normal PvP yet."
)

CIVILIAN_PROTECTION_HITMAN_BLOCKED_DETAIL = (
    "That player still has new-account protection and can't be targeted by Hitman yet."
)

CIVILIAN_PROTECTION_ASSET_TRANSFER_BLOCKED_DETAIL = (
    "That player still has new-account protection and can't receive casinos, armoury, or airports yet."
)

CIVILIAN_PROTECTION_CONFIRM_CODE = "civilian_protection_confirm"
CIVILIAN_PROTECTION_CONFIRM_HEADER = "X-Confirm-Civilian-Protection-Revoke"
CIVILIAN_PROTECTION_CONFIRM_MESSAGE = (
    "This will permanently remove your new account protection. "
    "Other players will be able to attack you in normal PvP. Continue?"
)

# Intentional player actions that strip protection and require an explicit confirm header.
CONFIRM_REQUIRED_REASONS = frozenset({
    "manual",
    "search_player",
    "hitlist_add",
    "crew_apply",
    "crew_join",
    "crew_create",
    "exclusive_car",
    "casino_claim",
    "casino_buyback_reject",
})

RULES_BULLETS: List[str] = [
    "Take a casino from someone and reject their buyback, or ignore buyback until it expires.",
    "Run a search on another player or a bodyguard (searching only a hitlist NPC does not remove protection).",
    "Put a real player on the hitlist.",
    "Apply to a crew, join one, or start your own.",
    "Buy an exclusive car.",
    "Claim a casino.",
]

_ASSET_RECIPIENT_PROJECTION = {
    "_id": 0,
    "id": 1,
    "created_at": 1,
    "civilian_protection_revoked_at": 1,
    "is_npc": 1,
    "email": 1,
    "is_moderator": 1,
}


async def raise_if_civilian_protected_asset_recipient(db, user_id: Optional[str]) -> None:
    """Block sending casinos / armoury / airport (and similar properties) to a protected account."""
    uid = str(user_id or "").strip()
    if not uid:
        return
    user = await db.users.find_one({"id": uid}, _ASSET_RECIPIENT_PROJECTION)
    if is_civilian_protected(user):
        raise HTTPException(status_code=400, detail=CIVILIAN_PROTECTION_ASSET_TRANSFER_BLOCKED_DETAIL)


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
    """True if this user is within the protection window and has not revoked protection. NPCs and staff are never 'protected' for combat rules."""
    if not user or user.get("is_npc"):
        return False
    try:
        from server import _is_moderator, user_has_admin_list_email

        if _is_moderator(user):
            return False
        if user_has_admin_list_email(user):
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


def parse_civilian_protection_revoke_confirmed(
    value: Optional[Union[str, bool, int]] = None,
    *,
    request: Optional[Request] = None,
) -> bool:
    """True if client sent X-Confirm-Civilian-Protection-Revoke (or equivalent)."""
    raw = value
    if raw is None and request is not None:
        raw = request.headers.get(CIVILIAN_PROTECTION_CONFIRM_HEADER)
        if raw is None:
            # Starlette lower-cases header names in .headers mapping
            raw = request.headers.get(CIVILIAN_PROTECTION_CONFIRM_HEADER.lower())
    if isinstance(raw, bool):
        return raw
    if raw is None:
        return False
    s = str(raw).strip().lower()
    return s in ("1", "true", "yes", "on")


def raise_if_protection_revoke_needs_confirm(
    user: Optional[dict],
    *,
    confirmed: bool,
    reason: str,
) -> None:
    """
    Block intentional revoke-causing actions until the client confirms.
    Raises HTTP 409 with structured detail when the user is still protected and confirmed is False.
    """
    if not is_civilian_protected(user):
        return
    r = str(reason or "").strip()
    if r not in CONFIRM_REQUIRED_REASONS:
        return
    if confirmed:
        return
    raise HTTPException(
        status_code=409,
        detail={
            "code": CIVILIAN_PROTECTION_CONFIRM_CODE,
            "message": CIVILIAN_PROTECTION_CONFIRM_MESSAGE,
            "reason": r,
        },
    )


def require_protection_revoke_confirm(
    user: Optional[dict],
    *,
    reason: str,
    request: Optional[Request] = None,
    confirmed: Optional[bool] = None,
) -> None:
    """Convenience: read confirm from Request header unless confirmed is passed explicitly."""
    ok = bool(confirmed) if confirmed is not None else parse_civilian_protection_revoke_confirmed(request=request)
    raise_if_protection_revoke_needs_confirm(user, confirmed=ok, reason=reason)


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
    points_event_type: str,
) -> None:
    """Refund former owners' escrow for expired buy-backs, delete offers, maybe revoke civilian protection."""
    if not to_user_id:
        return
    from server import refund_casino_buy_back_escrow_points

    coll = db[collection_name]
    q = {"to_user_id": to_user_id, "expires_at": {"$lt": now_iso}}
    offers = await coll.find(q, {"_id": 0, "id": 1, "from_owner_id": 1, "points_offered": 1}).to_list(500)
    if not offers:
        return
    for off in offers:
        await refund_casino_buy_back_escrow_points(
            str(off.get("from_owner_id") or ""),
            int(off.get("points_offered") or 0),
            event_type=points_event_type,
            meta={"reason": "expired", "offer_id": off.get("id")},
        )
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
