# Dead-alive: retrieve points from a dead account (one-time)
from fastapi import Depends, HTTPException


def register(router):
    """Register dead-alive routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    _username_pattern = srv._username_pattern
    verify_password = srv.verify_password
    DeadAliveRetrieveRequest = srv.DeadAliveRetrieveRequest
    DEAD_ALIVE_POINTS_PERCENT = srv.DEAD_ALIVE_POINTS_PERCENT

    @router.post("/dead-alive/retrieve")
    async def dead_alive_retrieve(request: DeadAliveRetrieveRequest, current_user: dict = Depends(get_current_user)):
        """Retrieve a % of points from a dead account into your current account. One-time per dead account."""
        username_pattern = _username_pattern(request.dead_username)
        dead_user = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not dead_user:
            raise HTTPException(status_code=404, detail="No account found with that username")
        if not dead_user.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is not dead. Only dead accounts can be retrieved.")
        if dead_user.get("retrieval_used"):
            raise HTTPException(status_code=400, detail="Points from that dead account have already been retrieved.")
        if not verify_password(request.dead_password, dead_user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid password for that account")
        points_at_death = dead_user.get("points_at_death", 0)
        if points_at_death <= 0:
            raise HTTPException(status_code=400, detail="That account had no points to retrieve")
        retrieved = int(points_at_death * DEAD_ALIVE_POINTS_PERCENT)
        retrieved = max(1, retrieved)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"points": retrieved}}
        )
        await db.users.update_one(
            {"id": dead_user["id"]},
            {"$set": {"retrieval_used": True}}
        )
        return {
            "message": f"Retrieved {retrieved} points from your dead account ({dead_user['username']}). One-time retrieval complete.",
            "points_retrieved": retrieved
        }
