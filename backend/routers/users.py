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
    _is_moderator = srv._is_moderator
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    OnlineUsersResponse = srv.OnlineUsersResponse
    MOD_ONLINE_COLOR_DEFAULT = "#1e3a5f"
    HDO_ONLINE_COLOR = "#166534"  # dark green for Help Desk Operators

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
            _rp = int(user.get("rank_points") or 0)
            _prestige_mult = float(user.get("prestige_rank_multiplier") or 1.0)
            rank_id, rank_name = get_rank_info(_rp, _prestige_mult)
            is_admin = user.get("email") in ADMIN_EMAILS
            is_mod = bool(user.get("is_moderator"))
            is_hdo = bool(user.get("is_help_desk_operator"))
            if is_admin:
                rank_name = "Admin"
            elif is_mod:
                rank_name = "Moderator"
            elif is_hdo:
                rank_name = "Help Desk Operator"
            _prestige_level = int(user.get("prestige_level") or 0)
            online_color = None
            if is_admin:
                pass  # set below from global
            elif is_mod:
                raw = (user.get("mod_online_color") or "").strip() or MOD_ONLINE_COLOR_DEFAULT
                online_color = raw if raw.startswith("#") and len(raw) <= 9 else MOD_ONLINE_COLOR_DEFAULT
            elif is_hdo:
                online_color = HDO_ONLINE_COLOR
            users_data.append({
                "username": user["username"],
                "rank": rank_id,
                "rank_name": rank_name,
                "rank_points": _rp,
                "location": user["current_state"],
                "in_jail": user.get("in_jail", False),
                "is_admin": is_admin,
                "is_moderator": is_mod,
                "is_help_desk_operator": is_hdo,
                "prestige_level": _prestige_level,
                "online_color": online_color,
            })
        users_data.sort(key=lambda u: u["rank_points"], reverse=True)

        admin_color_doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (admin_color_doc.get("value") or "#a78bfa") if admin_color_doc else "#a78bfa"
        if not isinstance(admin_online_color, str) or not admin_online_color.strip():
            admin_online_color = "#a78bfa"
        admin_online_color = admin_online_color.strip()
        for u in users_data:
            if u.get("is_admin"):
                u["online_color"] = admin_online_color

        return OnlineUsersResponse(
            total_online=len(users_data),
            users=users_data,
            admin_online_color=admin_online_color,
            mod_default_online_color=MOD_ONLINE_COLOR_DEFAULT,
            hdo_online_color=HDO_ONLINE_COLOR,
        )

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
        # Use string $regex + $options so MongoDB receives a plain pattern (avoids driver serialization issues)
        pattern_str = re.escape(q_clean)
        cursor = db.users.find(
            {"username": {"$regex": pattern_str, "$options": "i"}},
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
            # Don't expose is_bodyguard so players can't enumerate bodyguards
            result.append({
                "username": username,
                "is_dead": bool(u.get("is_dead")),
                "in_jail": bool(u.get("in_jail")),
            })
        return {"users": result}
