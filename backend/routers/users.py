# Users: online list, search (all users incl. offline/dead)
from datetime import datetime, timezone, timedelta
import re

from fastapi import Depends, Query


def register(router):
    """Register users routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    get_rank_info = srv.get_rank_info
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    OnlineUsersResponse = srv.OnlineUsersResponse

    @router.get("/users/online", response_model=OnlineUsersResponse)
    async def get_online_users(current_user: dict = Depends(get_current_user)):
        """Online = last 5 min, forced-online, or Auto Rank enabled. When Auto Rank is disabled, normal rules only."""
        now = datetime.now(timezone.utc)
        five_min_ago = now - timedelta(minutes=5)
        users = await db.users.find(
            {
                "is_dead": {"$ne": True},
                "is_bodyguard": {"$ne": True},
                "$or": [
                    {"last_seen": {"$gte": five_min_ago.isoformat()}},
                    {"forced_online_until": {"$gt": now.isoformat()}},
                    {"auto_rank_enabled": True},  # when disabled, only the two above apply
                ],
            },
            {"_id": 0, "password_hash": 0}
        ).to_list(100)

        users_data = []
        for user in users:
            if user.get("email") in ADMIN_EMAILS and user.get("admin_ghost_mode"):
                continue
            _prestige_mult = float(user.get("prestige_rank_multiplier") or 1.0)
            rank_id, rank_name = get_rank_info(user.get("rank_points", 0), _prestige_mult)
            is_admin = user.get("email") in ADMIN_EMAILS
            if is_admin:
                rank_name = "Admin"
            _prestige_level = int(user.get("prestige_level") or 0)
            users_data.append({
                "username": user["username"],
                "rank": rank_id,
                "rank_name": rank_name,
                "location": user["current_state"],
                "in_jail": user.get("in_jail", False),
                "is_admin": is_admin,
                "prestige_level": _prestige_level,
            })

        admin_color_doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (admin_color_doc.get("value") or "#a78bfa") if admin_color_doc else "#a78bfa"
        if not isinstance(admin_online_color, str) or not admin_online_color.strip():
            admin_online_color = "#a78bfa"

        return OnlineUsersResponse(total_online=len(users_data), users=users_data, admin_online_color=admin_online_color.strip())

    @router.get("/users/search")
    async def search_users(
        q: str = Query(..., min_length=1, max_length=80),
        limit: int = Query(20, ge=1, le=50),
        current_user: dict = Depends(get_current_user),
    ):
        """Search all users by username (substring, case-insensitive). Returns online, offline, and dead. No robots unless full name matches."""
        q_clean = (q or "").strip()
        if not q_clean:
            return {"users": []}
        pattern = re.compile(re.escape(q_clean), re.IGNORECASE)
        cursor = db.users.find(
            {"username": {"$regex": pattern}},
            {"_id": 0, "password_hash": 0, "email": 0},
        ).limit(limit)
        users = await cursor.to_list(limit)
        result = []
        q_lower = q_clean.lower()
        for u in users:
            is_bg = bool(u.get("is_bodyguard"))
            username = u.get("username") or ""
            # Robot bodyguards only appear when search matches their full name
            if is_bg and q_lower != username.lower():
                continue
            result.append({
                "username": username,
                "is_dead": bool(u.get("is_dead")),
                "in_jail": bool(u.get("in_jail")),
                "is_bodyguard": is_bg,
            })
        return {"users": result}
