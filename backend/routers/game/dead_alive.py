# Dead-alive: 0.05% tax to state head — you receive 99.95% of dead account's money and points (one-time)
# 50% of tokens are also restored
# Revive: pay 50k points to bring back a dead account (same email, once per email)
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from routers.kill.armoury import TOKEN_CONFIG

REVEAL_KILLER_COST = 1000
TOKEN_RESTORE_PERCENT = 0.50  # 50% of tokens restored on Dead > Alive
REVIVE_COST = 50_000  # points to revive one dead account (same email, once per email)


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
        return {
            "killer_username": current_user.get("killed_by_username"),
            "killer_family": current_user.get("killed_by_family_name"),
            "already_revealed": False,
        }

    @router.post("/dead-alive/retrieve")
    async def dead_alive_retrieve(request: DeadAliveRetrieveRequest, current_user: dict = Depends(get_current_user_verified)):
        """Transfer 99.95% of a dead account's money and points into your current account (0.05% tax to state head). One-time per dead account."""
        username_pattern = _username_pattern(request.dead_username)
        dead_user = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not dead_user:
            raise HTTPException(status_code=404, detail="No account found with that username")
        if not dead_user.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is not dead. Only dead accounts can be used.")
        if dead_user.get("retrieval_used"):
            raise HTTPException(status_code=400, detail="That dead account has already been used for a transfer.")
        if not verify_password(request.dead_password, dead_user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid password for that account")
        points_at_death = int(dead_user.get("points_at_death") or 0)
        money_at_death = int(dead_user.get("money_at_death") or 0)
        if points_at_death <= 0 and money_at_death <= 0:
            raise HTTPException(status_code=400, detail="That account had no points or cash to transfer")
        now = datetime.now(timezone.utc)

        def _parse_iso(s):
            if not s:
                return None
            try:
                dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except Exception:
                return None

        pass_bonus_until_dt = _parse_iso(dead_user.get("rank_xp_pass_bonus_until"))
        pass_token_expires_dt = _parse_iso(dead_user.get("rank_xp_pass_token_expires_at"))
        # Atomically claim — prevents double-retrieval race condition
        claim = await db.users.find_one_and_update(
            {"id": dead_user["id"], "is_dead": True, "retrieval_used": {"$ne": True}},
            {"$set": {"retrieval_used": True}},
        )
        if not claim:
            raise HTTPException(status_code=400, detail="That dead account has already been used for a transfer.")
        add_points = max(0, int(points_at_death * DEAD_ALIVE_PERCENT))
        add_money = max(0, int(money_at_death * DEAD_ALIVE_PERCENT))
        tax_money = max(0, int(money_at_death * (1 - DEAD_ALIVE_PERCENT)))
        tax_points = max(0, int(points_at_death * (1 - DEAD_ALIVE_PERCENT)))
        # Calculate 50% token restoration
        tokens_at_death = dead_user.get("tokens_at_death") or {}
        token_inc = {}
        tokens_restored = {}
        for token_type, cfg in TOKEN_CONFIG.items():
            count_field = cfg["count_field"]
            original_count = int(tokens_at_death.get(count_field, 0) or 0)
            if original_count > 0:
                # Rank-XP pass: skip restoring an expired unactivated token.
                if token_type == "rank_xp_pass" and pass_token_expires_dt and pass_token_expires_dt <= now:
                    continue
                restored = max(1, int(original_count * TOKEN_RESTORE_PERCENT))
                token_inc[count_field] = restored
                tokens_restored[token_type] = restored
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
        if token_inc:
            user_inc.update(token_inc)
        if user_inc:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": user_inc}
            )

        # Dead > Alive carry-over for Rank-XP pass state.
        # Support both simultaneously:
        # - Active bonus window (rank_xp_pass_bonus_until + rank_xp_pass_tier_snapshot)
        # - Unactivated token entitlement (rank_xp_pass_tokens + rank_xp_pass_token_expires_at + rank_xp_pass_pending_tier_snapshot)
        pass_updates = {}
        pass_active = bool(pass_bonus_until_dt and pass_bonus_until_dt > now)
        pass_pending = bool(pass_token_expires_dt and pass_token_expires_dt > now)

        if pass_active:
            pass_updates["rank_xp_pass_bonus_until"] = pass_bonus_until_dt.isoformat()
            pass_updates["rank_xp_pass_tier_snapshot"] = dead_user.get("rank_xp_pass_tier_snapshot")
        else:
            pass_updates["rank_xp_pass_bonus_until"] = None
            pass_updates["rank_xp_pass_tier_snapshot"] = None

        if pass_pending:
            pass_updates["rank_xp_pass_token_expires_at"] = pass_token_expires_dt.isoformat()
            pass_updates["rank_xp_pass_pending_tier_snapshot"] = dead_user.get("rank_xp_pass_pending_tier_snapshot")
        else:
            pass_updates["rank_xp_pass_token_expires_at"] = None
            pass_updates["rank_xp_pass_pending_tier_snapshot"] = None

        # Preserve idempotency/reward-grant state for whichever token (pending) might be activated later.
        pass_updates["rank_xp_pass_rewards_granted"] = bool(dead_user.get("rank_xp_pass_rewards_granted", False))

        if pass_updates:
            await db.users.update_one({"id": current_user["id"]}, {"$set": pass_updates})
        msg = f"Transferred 99.95% from your dead account ({dead_user['username']}, 0.05% tax): "
        parts = []
        if add_money > 0:
            parts.append(f"${add_money:,} cash")
        if add_points > 0:
            parts.append(f"{add_points:,} points")
        if tokens_restored:
            token_parts = [f"{count} {ttype.replace('_', ' ')}" for ttype, count in tokens_restored.items()]
            parts.append(f"50% tokens restored: {', '.join(token_parts)}")
        msg += ", ".join(parts) if parts else "nothing (account had no cash, points, or tokens)"
        msg += ". One-time transfer complete."
        return {
            "message": msg,
            "points_transferred": add_points,
            "money_transferred": add_money,
            "tokens_restored": tokens_restored,
        }

    @router.get("/dead-alive/revive-eligibility")
    async def revive_eligibility(current_user: dict = Depends(get_current_user_verified)):
        """Return whether current user can revive a dead account (same email, 50k points, once per email) and list dead usernames for that email."""
        email = (current_user.get("email") or "").strip().lower()
        if not email:
            return {
                "can_revive": False,
                "reason": "No email linked to this account.",
                "points_balance": int(current_user.get("points") or 0),
                "revive_used": False,
                "dead_accounts_same_email": [],
            }
        if current_user.get("is_dead"):
            return {
                "can_revive": False,
                "reason": "You must be alive to revive another account.",
                "points_balance": int(current_user.get("points") or 0),
                "revive_used": False,
                "dead_accounts_same_email": [],
            }
        points_balance = int(current_user.get("points") or 0)
        revive_used_doc = await db.revive_used_by_email.find_one({"email": email}, {"_id": 0})
        revive_used = bool(revive_used_doc)
        if revive_used:
            return {
                "can_revive": False,
                "reason": "This email has already used its one-time revive.",
                "points_balance": points_balance,
                "revive_used": True,
                "dead_accounts_same_email": [],
            }
        if points_balance < REVIVE_COST:
            return {
                "can_revive": False,
                "reason": f"You need {REVIVE_COST:,} points to revive an account (you have {points_balance:,}).",
                "points_balance": points_balance,
                "revive_used": False,
                "dead_accounts_same_email": [],
            }
        dead_same_email = await db.users.find(
            {"email": email, "is_dead": True},
            {"_id": 0, "username": 1},
        ).to_list(50)
        dead_accounts_same_email = [{"username": u.get("username")} for u in dead_same_email if u.get("username")]
        return {
            "can_revive": True,
            "reason": None,
            "points_balance": points_balance,
            "revive_used": False,
            "dead_accounts_same_email": dead_accounts_same_email,
        }

    @router.post("/dead-alive/revive")
    async def dead_alive_revive(request: DeadAliveReviveRequest, current_user: dict = Depends(get_current_user_verified)):
        """Pay 50,000 points to revive one dead account linked to the same email. Reviver's money and points (minus 50k) transfer to revived account; reviver becomes dead. One-time per email."""
        email = (current_user.get("email") or "").strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail="No email linked to this account.")
        if current_user.get("is_dead"):
            raise HTTPException(status_code=400, detail="You must be alive to revive another account.")
        points_balance = int(current_user.get("points") or 0)
        if points_balance < REVIVE_COST:
            raise HTTPException(
                status_code=400,
                detail=f"You need {REVIVE_COST:,} points to revive (you have {points_balance:,}).",
            )
        revive_used_doc = await db.revive_used_by_email.find_one({"email": email}, {"_id": 0})
        if revive_used_doc:
            raise HTTPException(status_code=400, detail="This email has already used its one-time revive.")

        username_pattern = _username_pattern(request.dead_username)
        dead_user = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not dead_user:
            raise HTTPException(status_code=404, detail="No account found with that username.")
        if not dead_user.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is not dead.")
        dead_email = (dead_user.get("email") or "").strip().lower()
        emails_match = dead_email == email
        if not emails_match:
            # Email was freed (e.g. dead_xxx@deleted after registering new account with same email or using Dead > Alive); require password to prove ownership
            if not (request.dead_password and request.dead_password.strip()):
                raise HTTPException(
                    status_code=400,
                    detail="That account is not linked to this email (it may have been freed when you used the same email elsewhere). Enter the dead account's password to revive it.",
                )
            if not verify_password(request.dead_password.strip(), dead_user.get("password_hash") or ""):
                raise HTTPException(status_code=401, detail="Invalid password for that account.")

        reviver_money = int(current_user.get("money") or 0)
        reviver_points_after = points_balance - REVIVE_COST
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1) Deduct 50k points from current user (atomic)
        res = await db.users.find_one_and_update(
            {"id": current_user["id"], "points": {"$gte": REVIVE_COST}},
            {"$inc": {"points": -REVIVE_COST}},
            projection={"_id": 0, "id": 1},
        )
        if not res:
            raise HTTPException(status_code=400, detail="Not enough points (balance may have changed).")

        try:
            # 2) Revive dead account: alive, receive reviver's money and points (after 50k deduction)
            await db.users.update_one(
                {"id": dead_user["id"]},
                {
                    "$set": {
                        "is_dead": False,
                        "dead_at": None,
                        "money": reviver_money,
                        "points": reviver_points_after,
                        "health": DEFAULT_HEALTH,
                        "health_regen_last_at": now_iso,
                        "in_jail": False,
                    },
                    "$unset": {
                        "killed_by_username": "",
                        "killed_by_user_id": "",
                        "killed_by_family_name": "",
                        "points_at_death": "",
                        "money_at_death": "",
                        "tokens_at_death": "",
                        "traveling_to": "",
                        "travel_arrives_at": "",
                        "jail_until": "",
                    },
                },
            )
            # 3) Kill reviving account
            await db.users.update_one(
                {"id": current_user["id"]},
                {
                    "$set": {
                        "is_dead": True,
                        "dead_at": now_iso,
                        "points_at_death": reviver_points_after,
                        "money_at_death": reviver_money,
                        "money": 0,
                        "points": 0,
                        "health": 0,
                    },
                },
            )
            # 4) Record revive used for this email
            await db.revive_used_by_email.insert_one({"email": email})

            # 5) Notify the revived user with before/after balances so they can verify the transfer
            notification_body = (
                f"This account was revived for {REVIVE_COST:,} points!\n\n"
                f"Balance before revive: $0 cash, 0 points\n"
                f"Balance after revive: ${reviver_money:,} cash, {reviver_points_after:,} points"
            )
            await send_notification(
                dead_user["id"],
                "Account revived",
                notification_body,
                "system",
                category="system",
            )
        except Exception as e:
            # Refund points if we failed after deducting
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"points": REVIVE_COST}},
            )
            raise e

        revived_username = dead_user.get("username") or request.dead_username
        return {
            "message": f"{revived_username} has been revived with your money and points. This account is now dead; log in as {revived_username} to continue.",
            "revived_username": revived_username,
            "revived_balance_cash": reviver_money,
            "revived_balance_points": reviver_points_after,
        }
