# Dead-alive: cash 99.95% to recipient (0.05% state head tax); points 100% to recipient; 50% of tokens restored (one-time)
# Revive: pay £10 (Stripe) to bring back a dead account (same email, once per email)
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import Depends, HTTPException
from routers.kill.armoury import TOKEN_CONFIG
from utils.point_provenance import log_points_event
from utils.redeem_code_lifecycle import release_redeem_slots_for_deceased_user
from utils.dead_alive_transfer_log import log_dead_alive_transfer

REVEAL_KILLER_COST = 1000
TOKEN_RESTORE_PERCENT = 0.50  # 50% of tokens restored on Dead > Alive
# Stripe package id (POINT_PACKAGES) — real-money revive fee (no points deducted).
DEAD_ALIVE_REVIVE_PACKAGE_ID = "dead_alive_revive_10"
REVIVE_PRICE_GBP = 10.0
# Legacy field name kept for admin logs (points fee removed; value stays 0).
REVIVE_COST = 0
ACCOUNT_LOCKED_DEAD_ALIVE_BLOCK_DETAIL = "Error, this account has been locked for investigation."
REVIVE_INTENT_TTL_MINUTES = 60


async def clear_revive_used_slot_for_email(db, email: str) -> bool:
    """Remove the one-time Dead > Alive revive lock for an email (staff grant). Returns True if a row was deleted."""
    norm = (email or "").strip().lower()
    if not norm:
        return False
    result = await db.revive_used_by_email.delete_one({"email": norm})
    return result.deleted_count > 0


async def revive_slot_used_for_email(db, email: str) -> bool:
    norm = (email or "").strip().lower()
    if not norm:
        return False
    doc = await db.revive_used_by_email.find_one({"email": norm}, {"_id": 1})
    return bool(doc)


async def clear_inheritance_retrieval_for_user(db, user_id: str) -> bool:
    """Clear Claim Inheritance locks on a dead account (staff grant). Returns True if flags were reset."""
    if not user_id:
        return False
    result = await db.users.update_one(
        {"id": user_id, "is_dead": True},
        {
            "$set": {
                "retrieval_used": False,
                "swiss_retrieval_used": False,
                "rank_xp_pass_dead_alive_carry_used": False,
            }
        },
    )
    return result.modified_count > 0


def _parse_iso_utc(s):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def create_revive_payment_intent(
    db,
    *,
    reviver: dict,
    dead_username: str,
    dead_password: Optional[str],
    username_pattern_fn,
    verify_password_fn,
) -> Dict[str, Any]:
    """Validate revive targets and store a short-lived intent for Stripe checkout fulfillment."""
    email = (reviver.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="No email linked to this account.")
    if reviver.get("is_dead"):
        raise HTTPException(status_code=400, detail="You must be alive to revive another account.")
    if await revive_slot_used_for_email(db, email):
        raise HTTPException(
            status_code=400,
            detail="This email has already used its revive (staff can grant another from Admin).",
        )
    dead_user = await db.users.find_one({"username": username_pattern_fn(dead_username)}, {"_id": 0})
    if not dead_user:
        raise HTTPException(status_code=404, detail="No account found with that username.")
    if not dead_user.get("is_dead"):
        raise HTTPException(status_code=400, detail="That account is not dead.")
    if dead_user.get("account_locked"):
        raise HTTPException(status_code=403, detail=ACCOUNT_LOCKED_DEAD_ALIVE_BLOCK_DETAIL)
    dead_email = (dead_user.get("email") or "").strip().lower()
    if dead_email != email:
        if not (dead_password and str(dead_password).strip()):
            raise HTTPException(
                status_code=400,
                detail="That account is not linked to this email (it may have been freed when you used the same email elsewhere). Enter the dead account's password to revive it.",
            )
        if not verify_password_fn(str(dead_password).strip(), dead_user.get("password_hash") or ""):
            raise HTTPException(status_code=401, detail="Invalid password for that account.")

    intent_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "id": intent_id,
        "reviver_id": reviver["id"],
        "reviver_username": reviver.get("username"),
        "reviver_email": email,
        "dead_user_id": dead_user["id"],
        "dead_username": dead_user.get("username"),
        "status": "pending",
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=REVIVE_INTENT_TTL_MINUTES)).isoformat(),
    }
    await db.revive_payment_intents.insert_one(doc)
    return doc


async def execute_paid_revive(
    db,
    *,
    intent_id: str,
    send_notification,
    default_health: int = 100,
) -> Dict[str, Any]:
    """
    Fulfill a paid (£10 Stripe) revive intent: transfer balances, revive dead account, kill reviver.
    Idempotent on intent status / email revive slot.
    """
    intent = await db.revive_payment_intents.find_one({"id": intent_id}, {"_id": 0})
    if not intent:
        raise HTTPException(status_code=400, detail="Revive payment intent not found.")
    if intent.get("status") == "completed":
        return {
            "already_completed": True,
            "revived_username": intent.get("dead_username"),
            "revived_id": intent.get("dead_user_id"),
        }
    if intent.get("status") not in (None, "pending", "paid", "checkout_pending"):
        raise HTTPException(status_code=400, detail=f"Revive intent is {intent.get('status')}.")

    expires = _parse_iso_utc(intent.get("expires_at"))
    if expires and datetime.now(timezone.utc) > expires and intent.get("status") == "pending":
        await db.revive_payment_intents.update_one({"id": intent_id}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=400, detail="Revive checkout expired — start again.")

    reviver = await db.users.find_one({"id": intent["reviver_id"]}, {"_id": 0})
    dead_user = await db.users.find_one({"id": intent["dead_user_id"]}, {"_id": 0})
    if not reviver or not dead_user:
        raise HTTPException(status_code=400, detail="Revive accounts no longer available.")
    if reviver.get("is_dead"):
        raise HTTPException(status_code=400, detail="Reviver account is already dead.")
    if not dead_user.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target account is no longer dead.")
    if dead_user.get("account_locked"):
        raise HTTPException(status_code=403, detail=ACCOUNT_LOCKED_DEAD_ALIVE_BLOCK_DETAIL)

    email = (intent.get("reviver_email") or reviver.get("email") or "").strip().lower()
    points_balance = int(reviver.get("points") or 0)
    reviver_money = int(reviver.get("money") or 0)
    # Full points transfer — fee was paid in GBP via Stripe.
    reviver_points_after = points_balance
    if dead_user.get("retrieval_used"):
        dead_carry = max(
            0,
            int(dead_user.get("points") or 0) - int(dead_user.get("points_at_death") or 0),
        )
    else:
        dead_carry = max(0, int(dead_user.get("points_at_death") or 0))
    revived_points = reviver_points_after + dead_carry
    now_iso = datetime.now(timezone.utc).isoformat()

    from pymongo.errors import DuplicateKeyError

    try:
        await db.revive_used_by_email.insert_one(
            {"email": email, "used_at": now_iso, "reviver_id": reviver["id"], "intent_id": intent_id}
        )
    except (DuplicateKeyError, Exception) as e:
        if "duplicate" in str(e).lower() or "E11000" in str(e):
            # Slot already used — if this intent already completed, treat as success.
            snap = await db.revive_payment_intents.find_one({"id": intent_id}, {"status": 1, "dead_username": 1})
            if (snap or {}).get("status") == "completed":
                return {
                    "already_completed": True,
                    "revived_username": (snap or {}).get("dead_username") or intent.get("dead_username"),
                    "revived_id": intent.get("dead_user_id"),
                }
            raise HTTPException(
                status_code=400,
                detail="This email has already used its revive (staff can grant another from Admin).",
            )
        existing = await db.revive_used_by_email.find_one({"email": email})
        if existing:
            raise HTTPException(
                status_code=400,
                detail="This email has already used its revive (staff can grant another from Admin).",
            )

    try:
        revive_result = await db.users.update_one(
            {"id": dead_user["id"], "is_dead": True, "account_locked": {"$ne": True}},
            {
                "$set": {
                    "is_dead": False,
                    "dead_at": None,
                    "money": reviver_money,
                    "points": revived_points,
                    "health": default_health,
                    "health_regen_last_at": now_iso,
                    "in_jail": False,
                },
                "$unset": {
                    "killed_by_username": "",
                    "killed_by_user_id": "",
                    "killed_by_family_name": "",
                    "death_by_staff": "",
                    "points_at_death": "",
                    "money_at_death": "",
                    "tokens_at_death": "",
                    "traveling_to": "",
                    "travel_arrives_at": "",
                    "jail_until": "",
                },
            },
        )
        if revive_result.modified_count == 0:
            locked_now = await db.users.find_one(
                {"id": dead_user["id"], "account_locked": True}, {"_id": 0, "id": 1}
            )
            if locked_now:
                raise HTTPException(status_code=403, detail=ACCOUNT_LOCKED_DEAD_ALIVE_BLOCK_DETAIL)
            raise HTTPException(status_code=400, detail="That account could not be revived.")
        if revived_points > 0:
            await log_points_event(
                db,
                user_id=dead_user["id"],
                points=revived_points,
                event_type="dead_alive_reviver_pay",
                event_ref=reviver["id"],
            )
        restore_summary = {}
        try:
            from utils.death_revive_snapshot import restore_death_revive_snapshot

            restore_summary = await restore_death_revive_snapshot(db, victim_id=dead_user["id"])
        except Exception:
            logging.getLogger(__name__).exception("death_revive_snapshot restore revived=%s", dead_user.get("id"))

        # Move VIP Pass Cars + exclusive weed from the sacrificing alt onto the revived character.
        try:
            from utils.game_pass_vip_car import transfer_vip_pass_cars_dead_alive

            vip_xfer = await transfer_vip_pass_cars_dead_alive(
                db,
                dead_user_id=reviver["id"],
                recipient_user_id=dead_user["id"],
                dead_username=reviver.get("username"),
                recipient_username=dead_user.get("username"),
                notify=True,
            )
            if restore_summary is not None and int((vip_xfer or {}).get("transferred_count") or 0) > 0:
                restore_summary["vip_pass_cars_from_reviver"] = int(vip_xfer["transferred_count"])
        except Exception:
            logging.getLogger(__name__).exception(
                "vip transfer reviver→revived reviver=%s revived=%s",
                reviver.get("id"),
                dead_user.get("id"),
            )
        try:
            from utils.weed_empire_exclusive_strains import (
                transfer_exclusive_weed_strains_between_users,
            )

            weed_xfer = await transfer_exclusive_weed_strains_between_users(
                db,
                from_user_id=reviver["id"],
                to_user_id=dead_user["id"],
                from_username=reviver.get("username"),
                to_username=dead_user.get("username"),
                notify=True,
                transfer_source="revive_sacrifice_transfer",
            )
            if restore_summary is not None and weed_xfer:
                restore_summary["exclusive_weed_from_reviver"] = list(weed_xfer)
                restore_summary["exclusive_weed_restored"] = len(weed_xfer)
        except Exception:
            logging.getLogger(__name__).exception(
                "exclusive weed transfer reviver→revived reviver=%s revived=%s",
                reviver.get("id"),
                dead_user.get("id"),
            )

        await db.users.update_one(
            {"id": reviver["id"]},
            {
                "$set": {
                    "is_dead": True,
                    "dead_at": now_iso,
                    "death_by_staff": False,
                    "points_at_death": 0,
                    "money_at_death": 0,
                    "tokens_at_death": {},
                    "revive_sacrifice": True,
                    "revive_sacrifice_for_user_id": dead_user["id"],
                    "money": 0,
                    "points": 0,
                    "health": 0,
                },
            },
        )
        try:
            await release_redeem_slots_for_deceased_user(db, reviver["id"])
        except Exception:
            logging.getLogger(__name__).exception(
                "release_redeem_slots_for_deceased_user (revive reviver death)"
            )

        notification_body = (
            f"This account was revived for £{REVIVE_PRICE_GBP:.0f}!\n\n"
            f"Balance before revive: $0 cash, 0 points\n"
            f"Balance after revive: ${reviver_money:,} cash, {revived_points:,} points"
        )
        estate_text = (restore_summary or {}).get("summary_text") or ""
        if estate_text:
            notification_body += f"\n\nEstate restored: {estate_text}."
        await send_notification(
            dead_user["id"],
            "Account revived",
            notification_body,
            "system",
            category="system",
        )
        try:
            await log_dead_alive_transfer(
                db,
                {
                    "event_type": "revive",
                    "reviver_id": reviver["id"],
                    "reviver_username": reviver.get("username"),
                    "revived_id": dead_user["id"],
                    "revived_username": dead_user.get("username"),
                    "dead_id": dead_user["id"],
                    "dead_username": dead_user.get("username"),
                    "recipient_id": dead_user["id"],
                    "recipient_username": dead_user.get("username"),
                    "revive_cost": REVIVE_COST,
                    "revive_cost_gbp": REVIVE_PRICE_GBP,
                    "revive_payment": "stripe",
                    "revive_intent_id": intent_id,
                    "reviver_points_before": points_balance,
                    "reviver_points_after_cost": reviver_points_after,
                    "reviver_points_after_death": 0,
                    "reviver_money_transferred": reviver_money,
                    "points_transferred": revived_points,
                    "dead_carry_points": dead_carry,
                    "retrieval_used_on_dead": bool(dead_user.get("retrieval_used")),
                },
            )
        except Exception:
            logging.getLogger(__name__).exception("dead_alive transfer log (revive)")

        await db.revive_payment_intents.update_one(
            {"id": intent_id},
            {
                "$set": {
                    "status": "completed",
                    "completed_at": now_iso,
                    "revived_points": revived_points,
                    "reviver_money_transferred": reviver_money,
                }
            },
        )
    except Exception:
        await db.revive_used_by_email.delete_one({"email": email, "intent_id": intent_id})
        await db.revive_used_by_email.delete_one({"email": email, "reviver_id": reviver["id"]})
        raise

    revived_username = dead_user.get("username") or intent.get("dead_username")
    return {
        "already_completed": False,
        "revived_username": revived_username,
        "revived_id": dead_user["id"],
        "revived_balance_cash": reviver_money,
        "revived_balance_points": revived_points,
        "message": (
            f"{revived_username} has been revived with your money and points. "
            f"This account is now dead; log in as {revived_username} to continue."
        ),
    }


def _parse_iso_datetime(s):
    """Parse ISO datetime string safely; return timezone-aware datetime or None."""
    return _parse_iso_utc(s)


def _dead_has_rank_xp_pass_carryover(dead_user: dict, now, pass_bonus_until_dt, pass_token_expires_dt) -> bool:
    """True if dead account has Game Pass / rank-tier state worth merging onto the recipient."""
    if int(dead_user.get("rank_xp_pass_season_rp") or 0) > 0:
        return True
    if bool(dead_user.get("rank_xp_pass_rewards_granted")):
        return True
    if int(dead_user.get("rank_xp_pass_last_granted_micro_tier") or 0) > 0:
        return True
    if dead_user.get("rank_xp_pass_tier_snapshot") is not None:
        return True
    if dead_user.get("rank_xp_pass_pending_tier_snapshot") is not None:
        return True
    if int(dead_user.get("rank_xp_pass_free_last_micro_tier_granted") or 0) > 0:
        return True
    if int(dead_user.get("rank_xp_pass_tokens") or 0) > 0:
        if not pass_token_expires_dt or pass_token_expires_dt > now:
            return True
    if pass_bonus_until_dt and pass_bonus_until_dt > now:
        return True
    return False


def _compute_token_restore_for_dead_alive(tokens_at_death: dict, pass_token_expires_dt, now) -> tuple:
    """50% token restore from tokens_at_death snapshot. Returns (token_inc dict, tokens_restored dict)."""
    token_inc = {}
    tokens_restored = {}
    for token_type, cfg in TOKEN_CONFIG.items():
        count_field = cfg["count_field"]
        original_count = int(tokens_at_death.get(count_field, 0) or 0)
        if original_count > 0:
            if token_type == "rank_xp_pass" and pass_token_expires_dt and pass_token_expires_dt <= now:
                continue
            restored = max(1, int(original_count * TOKEN_RESTORE_PERCENT))
            token_inc[count_field] = restored
            tokens_restored[token_type] = restored
    return token_inc, tokens_restored


def register(router):
    """Register dead-alive routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    get_current_user_verified = srv.get_current_user_verified
    get_head_family_id_for_state = srv.get_head_family_id_for_state
    send_notification = srv.send_notification
    _username_pattern = srv._username_pattern
    verify_password = srv.verify_password
    DeadAliveRetrieveRequest = srv.DeadAliveRetrieveRequest
    DeadAliveReviveRequest = srv.DeadAliveReviveRequest
    DEAD_ALIVE_PERCENT = srv.DEAD_ALIVE_PERCENT
    DEAD_ALIVE_POINTS_PERCENT = srv.DEAD_ALIVE_POINTS_PERCENT
    DEFAULT_HEALTH = srv.DEFAULT_HEALTH

    @router.post("/death/reveal-killer")
    async def reveal_killer(current_user: dict = Depends(get_current_user)):
        """Spend 1,000 points to reveal who killed you. Only usable while dead."""
        if not current_user.get("is_dead"):
            raise HTTPException(status_code=400, detail="You are not dead")
        killer_username = current_user.get("killed_by_username")
        if not killer_username:
            raise HTTPException(status_code=404, detail="Killer identity is unknown")
        if current_user.get("killer_revealed"):
            return {
                "killer_username": current_user.get("killed_by_username"),
                "killer_family": current_user.get("killed_by_family_name"),
                "already_revealed": True,
            }
        result = await db.users.update_one(
            {"id": current_user["id"], "points": {"$gte": REVEAL_KILLER_COST}},
            {"$inc": {"points": -REVEAL_KILLER_COST}, "$set": {"killer_revealed": True}}
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"You need {REVEAL_KILLER_COST:,} points to reveal your killer")
        await log_points_event(db, user_id=current_user["id"], points=-REVEAL_KILLER_COST, event_type="dead_alive_reveal")
        return {
            "killer_username": current_user.get("killed_by_username"),
            "killer_family": current_user.get("killed_by_family_name"),
            "already_revealed": False,
        }

    @router.post("/dead-alive/retrieve")
    async def dead_alive_retrieve(request: DeadAliveRetrieveRequest, current_user: dict = Depends(get_current_user_verified)):
        """Transfer dead account estate: cash at DEAD_ALIVE_PERCENT (state head tax), points at DEAD_ALIVE_POINTS_PERCENT, plus token restore rules. One-time per dead account."""
        username_pattern = _username_pattern(request.dead_username)
        dead_user = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not dead_user:
            raise HTTPException(status_code=404, detail="No account found with that username")
        if not dead_user.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is not dead. Only dead accounts can be used.")
        if dead_user.get("account_locked"):
            raise HTTPException(status_code=403, detail=ACCOUNT_LOCKED_DEAD_ALIVE_BLOCK_DETAIL)
        if not verify_password(request.dead_password, dead_user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid password for that account")
        if dead_user.get("revive_sacrifice"):
            raise HTTPException(
                status_code=400,
                detail="That account died during a revive swap — its estate was already transferred and cannot be claimed again.",
            )
        revive_as_reviver = await db.dead_alive_transfers.find_one(
            {
                "event_type": "revive",
                "reviver_id": dead_user["id"],
                "revived_id": current_user["id"],
            },
            {"_id": 0, "id": 1},
        )
        if revive_as_reviver:
            raise HTTPException(
                status_code=400,
                detail="You cannot claim inheritance from an account that died when it revived this character.",
            )
        points_at_death = int(dead_user.get("points_at_death") or 0)
        money_at_death = int(dead_user.get("money_at_death") or 0)
        swiss_at_death = int(dead_user.get("swiss_balance") or 0)
        swiss_retrieval_used = bool(dead_user.get("swiss_retrieval_used"))
        rank_pass_carry_used = bool(dead_user.get("rank_xp_pass_dead_alive_carry_used"))
        dead_live_points = max(0, int(dead_user.get("points") or 0))
        already_retrieved = bool(dead_user.get("retrieval_used"))
        supplemental_swiss_only = False
        supplemental_rank_pass_only = False
        supplemental_points_only = False
        supplemental_vip_only = False
        supplemental_points_amount = 0
        now = datetime.now(timezone.utc)
        pass_bonus_until_dt = _parse_iso_utc(dead_user.get("rank_xp_pass_bonus_until"))
        pass_token_expires_dt = _parse_iso_utc(dead_user.get("rank_xp_pass_token_expires_at"))
        has_dead_rank_xp_carry = _dead_has_rank_xp_pass_carryover(dead_user, now, pass_bonus_until_dt, pass_token_expires_dt)
        dead_current_xp = max(0, int(dead_user.get("rank_xp_pass_season_rp") or 0))
        current_current_xp = max(0, int(current_user.get("rank_xp_pass_season_rp") or 0))
        missing_game_pass_current_xp = dead_current_xp > current_current_xp
        points_at_death_snap = int(dead_user.get("points_at_death") or 0)

        pending_swiss = swiss_at_death if not swiss_retrieval_used else 0
        pending_rank_pass = has_dead_rank_xp_carry and (not rank_pass_carry_used or missing_game_pass_current_xp)
        from utils.game_pass_vip_car import count_user_vip_pass_cars

        pending_vip_cars = int(await count_user_vip_pass_cars(db, dead_user["id"]) or 0) > 0

        if already_retrieved:
            supplemental_points_amount = dead_live_points
            if (
                pending_swiss <= 0
                and supplemental_points_amount <= 0
                and not pending_rank_pass
                and not pending_vip_cars
            ):
                raise HTTPException(status_code=400, detail="That dead account has already been used for a transfer.")
            supplemental_swiss_only = pending_swiss > 0 and supplemental_points_amount <= 0 and not pending_rank_pass
            supplemental_rank_pass_only = pending_rank_pass and pending_swiss <= 0 and supplemental_points_amount <= 0
            supplemental_points_only = supplemental_points_amount > 0 and pending_swiss <= 0 and not pending_rank_pass
            supplemental_vip_only = (
                pending_vip_cars
                and pending_swiss <= 0
                and supplemental_points_amount <= 0
                and not pending_rank_pass
            )
        else:
            supplemental_vip_only = False
        tokens_at_death_raw = dead_user.get("tokens_at_death") or {}
        token_inc, tokens_restored = _compute_token_restore_for_dead_alive(tokens_at_death_raw, pass_token_expires_dt, now)

        add_swiss = pending_swiss
        if supplemental_points_only or (already_retrieved and supplemental_points_amount > 0 and not supplemental_swiss_only and not supplemental_rank_pass_only):
            has_estate = supplemental_points_amount > 0
        elif supplemental_swiss_only:
            has_estate = pending_swiss > 0
        else:
            has_estate = dead_live_points > 0 or money_at_death > 0 or add_swiss > 0
        has_rank_xp_merge = pending_rank_pass and not supplemental_swiss_only and not supplemental_points_only
        has_token_restore = (not already_retrieved) and bool(token_inc)
        if not has_estate and not has_token_restore and not has_rank_xp_merge and not pending_vip_cars:
            raise HTTPException(
                status_code=400,
                detail="That account had no points, cash, Swiss cash, restorable tokens, Game Pass state, or VIP Pass Car to transfer.",
            )

        claim_projection = {"_id": 0, "points": 1, "swiss_balance": 1}
        # Atomically claim — prevents double-retrieval race condition
        dead_claim_update: Dict[str, Any] = {}
        if already_retrieved:
            if pending_swiss > 0:
                dead_claim_update["$set"] = {"swiss_retrieval_used": True, "swiss_balance": 0}
            if supplemental_points_amount > 0:
                dead_claim_update.setdefault("$set", {})["points"] = 0
                dead_claim_update.setdefault("$set", {})["points_at_death"] = 0
            if pending_rank_pass and not rank_pass_carry_used:
                dead_claim_update.setdefault("$set", {})["rank_xp_pass_dead_alive_carry_used"] = True
            claim_filter: Dict[str, Any] = {
                "id": dead_user["id"],
                "is_dead": True,
                "account_locked": {"$ne": True},
                "retrieval_used": True,
            }
            if pending_swiss > 0:
                claim_filter["swiss_retrieval_used"] = {"$ne": True}
                claim_filter["swiss_balance"] = {"$gt": 0}
            if supplemental_points_amount > 0:
                claim_filter["points"] = {"$gt": 0}
            if pending_rank_pass and not rank_pass_carry_used:
                claim_filter["rank_xp_pass_dead_alive_carry_used"] = {"$ne": True}
            if (
                supplemental_vip_only
                or (pending_rank_pass and rank_pass_carry_used and supplemental_points_amount <= 0 and pending_swiss <= 0)
            ):
                # No estate claim to mutate — just load dead row (VIP cars / GP XP catch-up transfer below).
                claim = await db.users.find_one(
                    {"id": dead_user["id"], "is_dead": True, "account_locked": {"$ne": True}, "retrieval_used": True},
                    claim_projection,
                )
            else:
                claim = await db.users.find_one_and_update(
                    claim_filter,
                    dead_claim_update or {"$set": {"retrieval_used": True}},
                    projection=claim_projection,
                )
        else:
            dead_claim_update = {
                "$set": {
                    "retrieval_used": True,
                    "swiss_retrieval_used": True,
                    "rank_xp_pass_dead_alive_carry_used": True,
                    "swiss_balance": 0,
                    "points": 0,
                    "points_at_death": 0,
                },
            }
            claim = await db.users.find_one_and_update(
                {"id": dead_user["id"], "is_dead": True, "account_locked": {"$ne": True}, "retrieval_used": {"$ne": True}},
                dead_claim_update,
                projection=claim_projection,
            )
        if not claim:
            locked_now = await db.users.find_one({"id": dead_user["id"], "account_locked": True}, {"_id": 0, "id": 1})
            if locked_now:
                raise HTTPException(status_code=403, detail=ACCOUNT_LOCKED_DEAD_ALIVE_BLOCK_DETAIL)
            raise HTTPException(status_code=400, detail="That dead account has already been used for a transfer.")
        dead_points_before = max(0, int((claim or {}).get("points") or 0))
        add_swiss = max(0, int((claim or {}).get("swiss_balance") or pending_swiss or 0))
        if already_retrieved:
            add_points = max(0, int(dead_points_before * float(DEAD_ALIVE_POINTS_PERCENT)))
            add_money = 0
            tax_money = 0
            tax_points = 0
        else:
            add_points = max(0, int(dead_points_before * float(DEAD_ALIVE_POINTS_PERCENT)))
            add_money = max(0, int(money_at_death * DEAD_ALIVE_PERCENT))
            tax_money = max(0, int(money_at_death * (1 - DEAD_ALIVE_PERCENT)))
            tax_points = max(0, int(dead_points_before * (1 - float(DEAD_ALIVE_POINTS_PERCENT))))
        dead_state = (dead_user.get("current_state") or "").strip()
        head_family_id = await get_head_family_id_for_state(dead_state) if dead_state else None
        if head_family_id:
            family_inc = {}
            if tax_money > 0:
                family_inc["treasury"] = tax_money
                family_inc["state_head_income.dead_alive_tax"] = tax_money
            if tax_points > 0:
                family_inc["treasury_points"] = tax_points
                family_inc["state_head_income.dead_alive_points_tax"] = tax_points
            if family_inc:
                await db.families.update_one({"id": head_family_id}, {"$inc": family_inc})
        # Credit money, points, and tokens
        user_inc = {}
        if add_points > 0:
            user_inc["points"] = add_points
        if add_money > 0:
            user_inc["money"] = add_money
        if add_swiss > 0:
            user_inc["swiss_balance"] = add_swiss
        if has_token_restore and token_inc:
            user_inc.update(token_inc)
        if user_inc:
            user_update = {"$inc": user_inc}
            dead_swiss_limit = int(dead_user.get("swiss_limit") or 0)
            current_swiss_limit = int(current_user.get("swiss_limit") or 0)
            if dead_swiss_limit > current_swiss_limit:
                user_update["$max"] = {"swiss_limit": dead_swiss_limit}
            await db.users.update_one(
                {"id": current_user["id"]},
                user_update,
            )
        if add_points > 0:
            await log_points_event(db, user_id=current_user["id"], points=add_points, event_type="dead_alive_retrieve", event_ref=dead_user["id"])
        if dead_points_before > 0:
            await log_points_event(
                db,
                user_id=dead_user["id"],
                points=-dead_points_before,
                event_type="dead_alive_retrieve_out",
                event_ref=current_user["id"],
                wallet_points_before=dead_points_before,
                wallet_points_after=0,
            )

        # VIP Pass Cars survive death on the dead garage — move them to the new life.
        vip_cars_transferred = 0
        try:
            from utils.game_pass_vip_car import transfer_vip_pass_cars_dead_alive

            vip_xfer = await transfer_vip_pass_cars_dead_alive(
                db,
                dead_user_id=dead_user["id"],
                recipient_user_id=current_user["id"],
                dead_username=dead_user.get("username"),
                recipient_username=current_user.get("username"),
                notify=True,
            )
            vip_cars_transferred = int((vip_xfer or {}).get("transferred_count") or 0)
        except Exception:
            logging.getLogger(__name__).exception(
                "dead_alive VIP car transfer failed dead=%s recip=%s",
                dead_user.get("id"),
                current_user.get("id"),
            )

        try:
            await log_dead_alive_transfer(
                db,
                {
                    "event_type": "retrieve",
                    "supplemental": already_retrieved,
                    "recipient_id": current_user["id"],
                    "recipient_username": current_user.get("username"),
                    "dead_id": dead_user["id"],
                    "dead_username": dead_user.get("username"),
                    "dead_points_before": dead_points_before,
                    "dead_points_after": 0,
                    "points_at_death_snapshot": points_at_death_snap,
                    "points_transferred": add_points,
                    "money_transferred": add_money,
                    "swiss_transferred": add_swiss,
                    "tax_money": tax_money,
                    "tax_points": tax_points,
                    "tokens_restored": tokens_restored if has_token_restore else {},
                    "game_pass_merged": has_rank_xp_merge,
                    "vip_pass_cars_transferred": vip_cars_transferred,
                    "dead_state": dead_state,
                    "head_family_id": head_family_id,
                },
            )
        except Exception:
            logging.getLogger(__name__).exception("dead_alive transfer log (retrieve)")

        # Dead > Alive carry-over for Rank-XP pass state (only when dead had meaningful Game Pass data — do not wipe recipient).
        if has_rank_xp_merge:
            pass_updates = {}
            pass_active = bool(pass_bonus_until_dt and pass_bonus_until_dt > now)
            pass_rewards_granted = bool(dead_user.get("rank_xp_pass_rewards_granted", False))
            pass_pending = bool(pass_token_expires_dt and pass_token_expires_dt > now)
            dead_season_rp = max(0, int(dead_user.get("rank_xp_pass_season_rp") or 0))
            current_season_rp = max(0, int(current_user.get("rank_xp_pass_season_rp") or 0))
            carried_season_rp = max(dead_season_rp, current_season_rp)

            pass_updates["rank_xp_pass_season_rp"] = carried_season_rp
            if dead_user.get("game_pass_season_id") is not None:
                pass_updates["game_pass_season_id"] = str(dead_user.get("game_pass_season_id") or "").strip() or None

            if pass_active or pass_rewards_granted:
                pass_updates["rank_xp_pass_bonus_until"] = pass_bonus_until_dt.isoformat() if pass_active else None
                pass_updates["rank_xp_pass_tier_snapshot"] = max(
                    int(dead_user.get("rank_xp_pass_tier_snapshot") or 0),
                    int(current_user.get("rank_xp_pass_tier_snapshot") or 0),
                    carried_season_rp,
                )
            else:
                pass_updates["rank_xp_pass_bonus_until"] = None
                pass_updates["rank_xp_pass_tier_snapshot"] = None

            if pass_pending:
                pass_updates["rank_xp_pass_token_expires_at"] = pass_token_expires_dt.isoformat()
                pass_updates["rank_xp_pass_pending_tier_snapshot"] = dead_user.get("rank_xp_pass_pending_tier_snapshot")
            else:
                pass_updates["rank_xp_pass_token_expires_at"] = None
                pass_updates["rank_xp_pass_pending_tier_snapshot"] = None

            pass_updates["rank_xp_pass_rewards_granted"] = pass_rewards_granted or bool(current_user.get("rank_xp_pass_rewards_granted"))
            pass_updates["rank_xp_pass_last_granted_micro_tier"] = (
                max(
                    int(dead_user.get("rank_xp_pass_last_granted_micro_tier") or 0),
                    int(current_user.get("rank_xp_pass_last_granted_micro_tier") or 0),
                )
                if pass_updates["rank_xp_pass_rewards_granted"] else 0
            )
            pass_updates["rank_xp_pass_free_last_micro_tier_granted"] = max(
                int(dead_user.get("rank_xp_pass_free_last_micro_tier_granted") or 0),
                int(current_user.get("rank_xp_pass_free_last_micro_tier_granted") or 0),
            )
            # Carry Game Pass Current XP only. Do not merge the dead account's lifetime rank
            # points or prestige carry, because that feeds "Most Rank Points Earned".
            await db.users.update_one({"id": current_user["id"]}, {"$set": pass_updates})

        if supplemental_points_amount > 0 and already_retrieved:
            msg = f"Transferred additional points from your dead account ({dead_user['username']}): "
        elif has_estate or has_token_restore:
            msg = f"Transferred inheritance from your dead account ({dead_user['username']}): "
        else:
            msg = f"Inheritance from your dead account ({dead_user['username']}): "
        parts = []
        if add_money > 0:
            parts.append(f"${add_money:,} cash")
        if add_swiss > 0:
            parts.append(f"${add_swiss:,} Swiss cash")
        if add_points > 0:
            parts.append(f"{add_points:,} points")
        if has_token_restore and tokens_restored:
            token_parts = [f"{count} {ttype.replace('_', ' ')}" for ttype, count in tokens_restored.items()]
            parts.append(f"50% tokens restored: {', '.join(token_parts)}")
        if has_rank_xp_merge:
            parts.append("Game Pass progression transferred")
        if vip_cars_transferred > 0:
            parts.append(
                "1 VIP Pass Car transferred"
                if vip_cars_transferred == 1
                else f"{vip_cars_transferred} VIP Pass Cars transferred"
            )
        if parts:
            msg += ", ".join(parts)
        else:
            msg += "nothing (account had no cash, points, or tokens)"
        msg += ". One-time transfer complete." if not already_retrieved else "."
        return {
            "message": msg,
            "points_transferred": add_points,
            "money_transferred": add_money,
            "swiss_transferred": add_swiss,
            "tokens_restored": tokens_restored,
            "vip_pass_cars_transferred": vip_cars_transferred,
        }

    @router.get("/dead-alive/revive-eligibility")
    async def revive_eligibility(current_user: dict = Depends(get_current_user_verified)):
        """Return whether current user can revive (same email, £10 Stripe once per email) and list dead usernames for that email."""
        email = (current_user.get("email") or "").strip().lower()
        points_balance = int(current_user.get("points") or 0)
        base = {
            "points_balance": points_balance,
            "revive_price_gbp": REVIVE_PRICE_GBP,
            "revive_package_id": DEAD_ALIVE_REVIVE_PACKAGE_ID,
        }
        if not email:
            return {
                **base,
                "can_revive": False,
                "reason": "No email linked to this account.",
                "revive_used": False,
                "dead_accounts_same_email": [],
            }
        if current_user.get("is_dead"):
            return {
                **base,
                "can_revive": False,
                "reason": "You must be alive to revive another account.",
                "revive_used": False,
                "dead_accounts_same_email": [],
            }
        revive_used = await revive_slot_used_for_email(db, email)
        if revive_used:
            return {
                **base,
                "can_revive": False,
                "reason": "This email has already used its revive (staff can grant another from Admin).",
                "revive_used": True,
                "dead_accounts_same_email": [],
            }
        dead_same_email = await db.users.find(
            {"email": email, "is_dead": True},
            {"_id": 0, "username": 1, "account_locked": 1},
        ).to_list(50)
        dead_accounts_same_email = [
            {"username": u.get("username")}
            for u in dead_same_email
            if u.get("username") and not u.get("account_locked")
        ]
        if not dead_accounts_same_email and any(bool(u.get("account_locked")) for u in dead_same_email):
            return {
                **base,
                "can_revive": False,
                "reason": ACCOUNT_LOCKED_DEAD_ALIVE_BLOCK_DETAIL,
                "revive_used": False,
                "dead_accounts_same_email": [],
            }
        return {
            **base,
            "can_revive": True,
            "reason": None,
            "revive_used": False,
            "dead_accounts_same_email": dead_accounts_same_email,
        }

    @router.post("/dead-alive/revive")
    async def dead_alive_revive(request: DeadAliveReviveRequest, current_user: dict = Depends(get_current_user_verified)):
        """
        Start £10 Stripe checkout to revive a dead account (same email / password proof).
        Fulfillment runs after payment — full points+cash transfer (no points fee).
        """
        raise HTTPException(
            status_code=400,
            detail="Revive is now £10 via card checkout. Use the Revive button to pay with Stripe.",
        )

