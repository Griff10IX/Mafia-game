"""How a user got Auto Rank access (account 5k pts vs email £15 vs trial/tokens)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from utils.auto_rank_email_entitlement import (
    get_auto_rank_email_entitlement,
    normalize_entitlement_email,
)

AUTO_RANK_STORE_POINTS_COST = 5000
STORE_BUY_REF = "buy-auto-rank"
STRIPE_PACKAGE_ID = "auto_rank_permanent_2000"


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).strip().replace("Z", "+00:00"))
    except Exception:
        return None


async def build_auto_rank_entitlement_provenance(db, user: dict) -> dict:
    """Read-only audit: how this character got Auto Rank (no DB writes)."""
    uid = (user or {}).get("id") or ""
    email = normalize_entitlement_email((user or {}).get("email"))
    now = datetime.now(timezone.utc)

    email_record = await get_auto_rank_email_entitlement(db, email) if email else None
    email_entitled = bool(email_record)

    store_ledger = None
    if uid:
        store_ledger = await db.point_ledger_events.find_one(
            {
                "user_id": uid,
                "event_type": "spend_store",
                "origin_ref": STORE_BUY_REF,
                "points": {"$lt": 0},
            },
            {"_id": 0, "id": 1, "points": 1, "created_at": 1, "meta": 1},
            sort=[("created_at", -1)],
        )

    stripe_txns: List[dict] = []
    if email:
        q = {
            "payment_status": "completed",
            "package_id": STRIPE_PACKAGE_ID,
            "$or": [
                {"buyer_email": email},
                {"user_id": uid},
            ],
        }
        rows = await db.payment_transactions.find(
            q,
            {"_id": 0, "session_id": 1, "user_id": 1, "buyer_email": 1, "points_credited_at": 1, "entitlement_granted_at": 1},
        ).sort("entitlement_granted_at", -1).limit(5).to_list(5)
        stripe_txns = rows

    trial_until = _parse_iso(user.get("auto_rank_trial_until"))
    if trial_until and trial_until.tzinfo is None:
        trial_until = trial_until.replace(tzinfo=timezone.utc)
    trial_active = bool(
        user.get("auto_rank_trial")
        and trial_until
        and trial_until > now
    )

    prior_accounts: List[dict] = []
    freed_from_id = (user.get("registration_freed_email_from_user_id") or "").strip()
    if email:
        dead_rows = await db.users.find(
            {"email": email, "id": {"$ne": uid}},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "is_dead": 1,
                "auto_rank_purchased": 1,
                "auto_rank_permanent": 1,
                "auto_rank_email_entitlement": 1,
                "auto_rank_enabled": 1,
                "created_at": 1,
            },
        ).sort("created_at", -1).limit(8).to_list(8)
        for row in dead_rows:
            prior_ledger = await db.point_ledger_events.find_one(
                {
                    "user_id": row.get("id"),
                    "event_type": "spend_store",
                    "origin_ref": STORE_BUY_REF,
                    "points": {"$lt": 0},
                },
                {"_id": 0, "created_at": 1, "points": 1},
            )
            prior_accounts.append({
                "user_id": row.get("id"),
                "username": row.get("username"),
                "is_dead": bool(row.get("is_dead")),
                "auto_rank_purchased": bool(row.get("auto_rank_purchased")),
                "auto_rank_permanent": bool(row.get("auto_rank_permanent")),
                "auto_rank_email_entitlement": bool(row.get("auto_rank_email_entitlement")),
                "store_points_purchase_at": (prior_ledger or {}).get("created_at"),
                "freed_email_source": row.get("id") == freed_from_id,
            })

    sources: List[str] = []
    if email_entitled or user.get("auto_rank_email_entitlement"):
        sources.append("email_stripe_15")
    if store_ledger:
        sources.append("store_points_5000")
    if trial_active:
        sources.append("trial_active")
    elif user.get("auto_rank_trial"):
        sources.append("trial_expired")
    if int(user.get("auto_rank_2h_tokens") or 0) > 0:
        sources.append("has_2h_tokens")
    if user.get("founding_rewards_claimed"):
        sources.append("founding_member_trial")

    primary = "none"
    if email_entitled or user.get("auto_rank_email_entitlement"):
        primary = "email_stripe_15"
    elif store_ledger and (user.get("auto_rank_permanent") or user.get("auto_rank_purchased")):
        primary = "store_points_5000"
    elif trial_active:
        primary = "trial_active"
    elif user.get("auto_rank_purchased") and user.get("auto_rank_permanent"):
        primary = "unknown_permanent_flags"
    elif user.get("auto_rank_purchased"):
        primary = "flags_without_ledger"

    survives_new_account = bool(email_entitled)
    survives_same_character_revive = bool(
        store_ledger
        or user.get("auto_rank_permanent")
        or user.get("auto_rank_email_entitlement")
        or email_entitled
    )

    summary_parts: List[str] = []
    if primary == "email_stripe_15":
        summary_parts.append(
            "Email-tied permanent Auto Rank (£15 Stripe or admin grant). Survives death and new accounts on the same verified email."
        )
    elif primary == "store_points_5000":
        summary_parts.append(
            f"Account-only Auto Rank from Store ({AUTO_RANK_STORE_POINTS_COST:,} pts). Stays on this character when revived via Dead > Alive; does not transfer to a brand-new registration on the same email."
        )
    elif primary == "trial_active":
        summary_parts.append("Timed Auto Rank trial/token window is active (not permanent).")
    elif primary == "flags_without_ledger":
        summary_parts.append(
            "User flags show purchased Auto Rank but no store ledger entry — investigate (admin grant, data issue, or revoked purchase)."
        )
    elif primary == "none":
        summary_parts.append("No permanent Auto Rank purchase or active trial detected.")
    else:
        summary_parts.append("Auto Rank state does not match a clear purchase path — investigate.")

    if (
        primary == "store_points_5000"
        and user.get("auto_rank_enabled")
        and not trial_active
    ):
        summary_parts.append(
            "If they used Dead > Alive on this same character after buying 5,000 pts, Auto Rank still being on after revive is expected (not the £15 email product)."
        )

    return {
        "primary_source": primary,
        "all_sources": sources,
        "summary": " ".join(summary_parts),
        "survives_new_account_on_same_email": survives_new_account,
        "survives_dead_alive_revive_same_character": survives_same_character_revive,
        "email": email,
        "email_entitlement": {
            "active": email_entitled,
            "source": (email_record or {}).get("source"),
            "granted_at": (email_record or {}).get("granted_at"),
            "session_id": (email_record or {}).get("session_id"),
            "user_flag": bool(user.get("auto_rank_email_entitlement")),
        },
        "store_points_purchase": {
            "found": bool(store_ledger),
            "points_spent": abs(int((store_ledger or {}).get("points") or 0)) if store_ledger else None,
            "at": (store_ledger or {}).get("created_at"),
            "ledger_id": (store_ledger or {}).get("id"),
        },
        "stripe_email_purchases": stripe_txns,
        "registration_freed_email_from_user_id": freed_from_id or None,
        "prior_accounts_same_email": prior_accounts,
        "flags": {
            "auto_rank_purchased": bool(user.get("auto_rank_purchased")),
            "auto_rank_permanent": bool(user.get("auto_rank_permanent")),
            "auto_rank_trial": bool(user.get("auto_rank_trial")),
            "auto_rank_trial_until": user.get("auto_rank_trial_until"),
            "auto_rank_email_entitlement": bool(user.get("auto_rank_email_entitlement")),
            "auto_rank_enabled": bool(user.get("auto_rank_enabled")),
            "auto_rank_2h_tokens": int(user.get("auto_rank_2h_tokens") or 0),
        },
    }
