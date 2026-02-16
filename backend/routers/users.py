# Users: online list
from datetime import datetime, timezone, timedelta

from fastapi import Depends


def register(router):
    """Register users routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    get_rank_info = srv.get_rank_info
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    OnlineUsersResponse = srv.OnlineUsersResponse

    @router.get("/users/online", response_model=OnlineUsersResponse)
    async def get_online_users(current_user: dict = Depends(get_current_user)):
        """Users online in last 5 minutes OR forced-online window (exclude dead accounts)."""
        now = datetime.now(timezone.utc)
        five_min_ago = now - timedelta(minutes=5)
        users = await db.users.find(
            {
                "is_dead": {"$ne": True},
                "is_bodyguard": {"$ne": True},
                "$or": [
                    {"last_seen": {"$gte": five_min_ago.isoformat()}},
                    {"forced_online_until": {"$gt": now.isoformat()}},
                ],
            },
            {"_id": 0, "password_hash": 0}
        ).to_list(100)

        users_data = []
        for user in users:
            if user.get("email") in ADMIN_EMAILS and user.get("admin_ghost_mode"):
                continue
            rank_id, rank_name = get_rank_info(user.get("rank_points", 0))
            if user.get("email") in ADMIN_EMAILS:
                rank_name = "Admin"
            users_data.append({
                "username": user["username"],
                "rank": rank_id,
                "rank_name": rank_name,
                "location": user["current_state"],
                "in_jail": user.get("in_jail", False)
            })

        return OnlineUsersResponse(total_online=len(users_data), users=users_data)
