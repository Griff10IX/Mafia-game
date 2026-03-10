# Dead-alive: 5% tax — you receive 95% of dead account's money and points (one-time)
from fastapi import Depends, HTTPException

REVEAL_KILLER_COST = 1000


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
        add_points = max(0, int(points_at_death * DEAD_ALIVE_PERCENT))
        add_money = max(0, int(money_at_death * DEAD_ALIVE_PERCENT))
        tax_money = max(0, int(money_at_death * (1 - DEAD_ALIVE_PERCENT)))
        dead_state = (dead_user.get("current_state") or "").strip()
        head_family_id = await get_head_family_id_for_state(dead_state) if dead_state else None
        if head_family_id and tax_money > 0:
            await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": tax_money, "state_head_income.dead_alive_tax": tax_money}})
        if add_points > 0 or add_money > 0:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"points": add_points, "money": add_money}}
            )
        await db.users.update_one(
            {"id": dead_user["id"]},
            {"$set": {"retrieval_used": True}}
        )
        msg = f"Transferred 95% from your dead account ({dead_user['username']}, 5% tax): "
        parts = []
        if add_money > 0:
            parts.append(f"${add_money:,} cash")
        if add_points > 0:
            parts.append(f"{add_points:,} points")
        msg += ", ".join(parts) if parts else "nothing (account had no cash or points)"
        msg += ". One-time transfer complete."
        return {
            "message": msg,
            "points_transferred": add_points,
            "money_transferred": add_money,
        }
