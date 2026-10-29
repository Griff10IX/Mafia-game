# Admin Player 360: one read endpoint for everything about a player, and one audited wallet adjust endpoint.
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, field_validator

logger = logging.getLogger(__name__)

WALLET_FIELDS = {
    "cash": "money",
    "points": "points",
    "respect": "respect_points",
    "bullets": "bullets",
    "loot_pieces": "loot_box_pieces",
}


class WalletAdjustBody(BaseModel):
    currency: str
    amount: int
    reason: str

    @field_validator("currency")
    @classmethod
    def currency_ok(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in WALLET_FIELDS:
            raise ValueError(f"currency must be one of {', '.join(WALLET_FIELDS)}")
        return v

    @field_validator("reason")
    @classmethod
    def reason_ok(cls, v: str) -> str:
        v = (v or "").strip()
        if len(v) < 3:
            raise ValueError("Give a reason (at least 3 characters)")
        return v[:300]


def _iso(v: Any) -> Optional[str]:
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat()
    return v if isinstance(v, str) else None


def register(router):
    import server as srv
    from routers.admin.admin import CASINO_OWNERSHIP_COLLS
    from routers.admin.revenue import payment_amount_minor

    db = srv.db
    require_admin = srv.require_admin
    require_admin_or_mod = srv.require_admin_or_mod

    async def _find_user(user_ref: str) -> dict:
        ref = (user_ref or "").strip()
        if not ref:
            raise HTTPException(status_code=400, detail="Username required")
        user = await db.users.find_one({"id": ref}, {"_id": 0, "password_hash": 0})
        if not user:
            user = await db.users.find_one({"username": srv._username_pattern(ref)}, {"_id": 0, "password_hash": 0})
        if not user and "@" in ref:
            user = await db.users.find_one({"email": ref.lower()}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=404, detail="Player not found")
        return user

    @router.get("/admin/player360/{user_ref}")
    async def admin_player360(user_ref: str, current_user: dict = Depends(require_admin_or_mod)):
        u = await _find_user(user_ref)
        uid = u["id"]
        is_admin = srv._is_admin(current_user)
        prestige_mult = float(u.get("prestige_rank_multiplier") or 1.0)
        rank_id, rank_name = srv.get_rank_info(int(u.get("rank_points") or 0), prestige_mult)

        active_ban = await db.bans.find_one({"user_id": uid, "active": True}, {"_id": 0, "reason": 1, "created_at": 1, "expires_at": 1, "banned_by": 1})
        membership = await db.family_members.find_one({"user_id": uid}, {"_id": 0, "family_id": 1, "role": 1})
        family = None
        if membership:
            fam = await db.families.find_one({"id": membership.get("family_id")}, {"_id": 0, "id": 1, "name": 1, "tag": 1})
            if fam:
                family = {**fam, "role": membership.get("role")}

        casinos = []
        for game, (coll, loc_field) in CASINO_OWNERSHIP_COLLS.items():
            async for row in db[coll].find({"owner_id": uid}, {"_id": 0, loc_field: 1, "profit": 1, "total_earnings": 1, "max_bet": 1}):
                casinos.append({"game": game, "location": row.get(loc_field) or "?", "profit": row.get("profit"),
                                "total_earnings": row.get("total_earnings"), "max_bet": row.get("max_bet")})

        payments = await db.payment_transactions.find(
            {"user_id": uid},
            {"_id": 0, "session_id": 1, "package_id": 1, "payment_status": 1, "created_at": 1, "points": 1,
             "stripe_amount_total_minor": 1, "expected_amount_minor": 1, "refunded_amount_minor": 1, "dispute_status": 1},
        ).sort("created_at", -1).to_list(200)
        paid_statuses = {"completed", "preorder_pending", "manual_credit_pending", "fulfillment_blocked"}
        spend_minor = 0
        paid_count = 0
        pay_rows = []
        for p in payments:
            amount, _ = payment_amount_minor(p, srv.POINT_PACKAGES)
            paid = p.get("payment_status") in paid_statuses
            if paid:
                spend_minor += amount
                paid_count += 1
            if len(pay_rows) < 15:
                pay_rows.append({"created_at": p.get("created_at"), "package_id": p.get("package_id"), "status": p.get("payment_status"),
                                 "amount_minor": amount, "points": p.get("points"), "refunded_minor": p.get("refunded_amount_minor"),
                                 "dispute_status": p.get("dispute_status")})

        activity = await db.activity_log.find({"user_id": uid}, {"_id": 0, "action": 1, "details": 1, "created_at": 1}).sort("created_at", -1).limit(40).to_list(40)
        points_ledger = await db.point_audit_events.find(
            {"user_id": uid}, {"_id": 0, "delta": 1, "source": 1, "event_type": 1, "created_at": 1, "wallet_points_after": 1},
        ).sort("created_at", -1).limit(40).to_list(40)
        gambling = await db.gambling_log.find({"user_id": uid}, {"_id": 0, "game_type": 1, "details": 1, "created_at": 1}).sort("created_at", -1).limit(25).to_list(25)
        sessions = u.get("sessions") or []

        interest_rows = await db.bank_deposits.aggregate([
            {"$match": {"user_id": uid, "claimed_at": None}},
            {"$group": {"_id": None, "principal": {"$sum": {"$ifNull": ["$principal", 0]}}, "n": {"$sum": 1}}},
        ]).to_list(1)
        interest = interest_rows[0] if interest_rows else {}

        profile = {
            "id": uid,
            "username": u.get("username"),
            "email": u.get("email") if is_admin else None,
            "email_verified": u.get("email_verified") is not False,
            "created_at": u.get("created_at"),
            "last_seen": u.get("last_seen"),
            "last_seen_country": u.get("last_seen_country"),
            "last_request_ip": u.get("last_request_ip") if is_admin else None,
            "last_path": u.get("last_path"),
            "current_state": u.get("current_state"),
            "rank_id": rank_id,
            "rank_name": rank_name,
            "rank_points": int(u.get("rank_points") or 0),
            "prestige_level": int(u.get("prestige_level") or 0),
            "is_moderator": bool(u.get("is_moderator")),
            "founding_member": bool(u.get("founding_member")),
            "avatar_url": u.get("avatar_url") if isinstance(u.get("avatar_url"), str) and len(u.get("avatar_url")) < 2000 else None,
        }
        status = {
            "dead": bool(u.get("is_dead")),
            "dead_at": u.get("dead_at"),
            "killed_by": u.get("killed_by_username"),
            "modkilled": bool(u.get("modkill_wipe")),
            "modkill_reason": u.get("modkill_wipe_reason"),
            "in_jail": bool(u.get("in_jail")),
            "account_locked": bool(u.get("account_locked")),
            "banned": bool(active_ban),
            "ban": active_ban,
            "auto_rank_on": u.get("auto_rank_enabled") is True,
        }
        wallet = {
            "cash": u.get("money") or 0,
            "bank": u.get("bank_balance") or 0,
            "swiss": u.get("swiss_balance") or 0,
            "interest_principal": int(interest.get("principal") or 0),
            "interest_deposits": int(interest.get("n") or 0),
            "points": int(u.get("points") or 0),
            "respect": int(u.get("respect_points") or 0),
            "bullets": int(u.get("bullets") or 0),
            "loot_pieces": int(u.get("loot_box_pieces") or 0),
        }
        stats = {
            "kills": int(srv.effective_player_kill_count(u) or 0),
            "deaths": int(u.get("total_deaths") or 0),
            "crimes": int(u.get("total_crimes") or 0),
            "gta": int(u.get("total_gta") or 0),
            "jail_busts": int(u.get("jail_busts") or 0),
            "booze_profit": int(u.get("booze_run_profit_total") or 0),
        }
        entitlements = {
            "game_pass_vip": u.get("rank_xp_pass_rewards_granted") is True,
            "game_pass_expires_at": u.get("rank_xp_pass_token_expires_at"),
            "game_pass_tokens": int(u.get("rank_xp_pass_tokens") or 0),
            "auto_rank_purchased": bool(u.get("auto_rank_purchased")),
            "auto_rank_permanent": bool(u.get("auto_rank_permanent")),
            "auto_rank_trial_until": u.get("auto_rank_trial_until"),
        }
        return {
            "profile": profile,
            "status": status,
            "wallet": wallet,
            "stats": stats,
            "entitlements": entitlements,
            "family": family,
            "casinos": casinos,
            "spend": {"total_minor": spend_minor if is_admin else None, "payments": paid_count, "recent": pay_rows if is_admin else []},
            "sessions": [{"id": s.get("id"), "created_at": s.get("created_at"), "last_used_at": s.get("last_used_at"),
                          "ip": s.get("ip") if is_admin else None, "user_agent": (s.get("user_agent") or "")[:120]} for s in sessions[-10:]],
            "activity": [{**a, "created_at": _iso(a.get("created_at"))} for a in activity],
            "points_ledger": [{**p, "created_at": _iso(p.get("created_at"))} for p in points_ledger],
            "gambling": [{"game": g.get("game_type"), "details": g.get("details"), "created_at": _iso(g.get("created_at"))} for g in gambling],
            "viewer_is_admin": is_admin,
        }

    @router.post("/admin/player360/{user_ref}/wallet")
    async def admin_player360_wallet(user_ref: str, body: WalletAdjustBody, current_user: dict = Depends(require_admin)):
        """Give or take one currency with a required reason. Every change is written to the audit logs."""
        if body.amount == 0:
            raise HTTPException(status_code=400, detail="Amount cannot be zero")
        u = await _find_user(user_ref)
        uid = u["id"]
        field = WALLET_FIELDS[body.currency]
        admin_meta = {"admin_user_id": current_user.get("id"), "admin_username": current_user.get("username") or "?", "reason": body.reason}
        before = u.get(field) or 0
        applied = body.amount

        if body.currency == "points":
            from utils.point_provenance import apply_points_delta_with_audit, consume_points_fifo, log_points_event

            correlation_id = f"admin-wallet:{uuid.uuid4()}"
            if applied > 0:
                adj = await apply_points_delta_with_audit(
                    db, user_id=uid, delta=applied, source="admin", event_type="admin_add_points",
                    correlation_id=correlation_id, origin="admin_manual_adjustment",
                    origin_ref=f"admin:{current_user.get('id') or 'unknown'}",
                    actor={"id": current_user.get("id"), "username": current_user.get("username")},
                    context={"target_username": u.get("username"), "requested_delta": applied, "reason": body.reason},
                )
                await log_points_event(
                    db, user_id=uid, points=applied, event_type="admin_add_points", event_ref=correlation_id,
                    meta={**admin_meta, "target_username": u.get("username")},
                    wallet_points_before=(adj or {}).get("wallet_points_before"),
                    wallet_points_after=(adj or {}).get("wallet_points_after"),
                    record_normalized=False,
                )
            else:
                remove = min(-applied, max(0, int(before)))
                if remove <= 0:
                    raise HTTPException(status_code=400, detail=f"{u.get('username')} has no points to remove")
                slices = await consume_points_fifo(
                    db, user_id=uid, points=remove, event_type="admin_remove_points", event_ref=correlation_id,
                    meta={**admin_meta, "source": "admin", "target_username": u.get("username")},
                    source="admin", correlation_id=correlation_id,
                    actor={"id": current_user.get("id"), "username": current_user.get("username")},
                    context={"requested_amount": -applied, "target_username": u.get("username"), "reason": body.reason},
                )
                removed = sum(int(s.get("amount") or 0) for s in (slices or []))
                await db.users.update_one({"id": uid}, {"$inc": {"points": -removed}})
                applied = -removed
        else:
            if applied < 0:
                applied = -min(-applied, max(0, int(before)))
                if applied == 0:
                    raise HTTPException(status_code=400, detail=f"{u.get('username')} has none to remove")
            await db.users.update_one({"id": uid}, {"$inc": {field: applied}})
            if body.currency == "respect":
                await srv.log_respect_delta(uid, applied, "admin_add" if applied > 0 else "admin_remove")

        await srv.log_activity(
            uid, u.get("username") or "?", "admin_wallet_adjust",
            {"currency": body.currency, "amount": applied, "before": before, "after": (before or 0) + applied, **admin_meta},
        )
        try:
            from routers.game.leaderboard import invalidate_leaderboard_cache

            invalidate_leaderboard_cache()
        except Exception:
            pass
        verb = "Added" if applied > 0 else "Removed"
        return {
            "message": f"{verb} {abs(applied):,} {body.currency.replace('_', ' ')} {'to' if applied > 0 else 'from'} {u.get('username')}.",
            "currency": body.currency,
            "applied": applied,
            "before": before,
            "after": (before or 0) + applied,
        }
