# Dead-alive: 5% tax — you receive 95% of dead account's money and points (one-time)
# 50% of tokens are also restored
from fastapi import Depends, HTTPException
from routers.kill.armoury import TOKEN_CONFIG

REVEAL_KILLER_COST = 1000
TOKEN_RESTORE_PERCENT = 0.50  # 50% of tokens restored on Dead > Alive


def register(router):
    """Register dead-alive routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    get_current_user_verified = srv.get_current_user_verified
    get_head_family_id_for_state = srv.get_head_family_id_for_state
    _username_pattern = srv._username_pattern
    verify_password = srv.verify_password
    DeadAliveRetrieveRequest = srv.DeadAliveRetrieveRequest
    DEAD_ALIVE_PERCENT = srv.DEAD_ALIVE_PERCENT

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
        points = int(current_user.get("points") or 0)
        if points < REVEAL_KILLER_COST:
            raise HTTPException(status_code=400, detail=f"You need {REVEAL_KILLER_COST:,} points to reveal your killer")
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"points": -REVEAL_KILLER_COST}, "$set": {"killer_revealed": True}}
        )
        return {
            "killer_username": current_user.get("killed_by_username"),
            "killer_family": current_user.get("killed_by_family_name"),
            "already_revealed": False,
        }

    @router.post("/dead-alive/retrieve")
    async def dead_alive_retrieve(request: DeadAliveRetrieveRequest, current_user: dict = Depends(get_current_user_verified)):
        """Transfer 95% of a dead account's money and points into your current account (5% tax). One-time per dead account."""
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
        msg = f"Transferred 95% from your dead account ({dead_user['username']}, 5% tax): "
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
