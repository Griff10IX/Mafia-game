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

    async def _get_mod_default_online_color():
        doc = await db.game_settings.find_one({"key": "mod_default_online_color"}, {"_id": 0, "value": 1})
        raw = (doc.get("value") or MOD_ONLINE_COLOR_DEFAULT) if doc else MOD_ONLINE_COLOR_DEFAULT
        if not isinstance(raw, str) or not raw.strip():
            return MOD_ONLINE_COLOR_DEFAULT
        raw = raw.strip()
        return raw if raw.startswith("#") and len(raw) <= 9 else MOD_ONLINE_COLOR_DEFAULT

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
        id_to_user = {}
        for user in users:
            if not (user.get("username") or "").strip():
                continue
            if (user.get("email") in ADMIN_EMAILS or user.get("is_moderator")) and user.get("admin_ghost_mode"):
                continue
            uid = user.get("id")
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
                raw = (user.get("mod_online_color") or "").strip()
                if raw and raw.startswith("#") and len(raw) <= 9:
                    online_color = raw
                else:
                    online_color = None  # will use mod_default from settings below
            elif is_hdo:
                online_color = HDO_ONLINE_COLOR
            item = {
                "username": (user.get("username") or "").strip(),
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
            }
            users_data.append(item)
            if uid:
                id_to_user[uid] = item
        # Hitlist totals for online users (bounties on user or their bodyguards). Uses internal ids only server-side.
        if id_to_user:
            user_ids = list(id_to_user.keys())
            hitlist_entries = await db.hitlist.find(
                {"target_id": {"$in": user_ids}, "target_type": {"$in": ["user", "bodyguards"]}},
                {"_id": 0, "target_id": 1, "reward_type": 1, "reward_amount": 1},
            ).to_list(1000)
            hitlist_totals = {}
            for e in hitlist_entries:
                tid = e.get("target_id")
                if tid not in hitlist_totals:
                    hitlist_totals[tid] = [0, 0]
                if e.get("reward_type") == "cash":
                    hitlist_totals[tid][0] += int(e.get("reward_amount") or 0)
                elif e.get("reward_type") == "points":
                    hitlist_totals[tid][1] += int(e.get("reward_amount") or 0)
            for uid, user_item in id_to_user.items():
                tc, tp = hitlist_totals.get(uid, (0, 0))
                user_item["on_hitlist"] = tc > 0 or tp > 0
                user_item["hitlist_total_cash"] = tc
                user_item["hitlist_total_points"] = tp
        # Staff first (admins, then mods only); everyone else (including HDOs) by rank_points desc
        def _sort_key(u):
            if u.get("is_admin"):
                return (0, -u.get("rank_points", 0))
            if u.get("is_moderator"):
                return (1, -u.get("rank_points", 0))
            return (2, -u.get("rank_points", 0))
        users_data.sort(key=_sort_key)

        admin_color_doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (admin_color_doc.get("value") or "#a78bfa") if admin_color_doc else "#a78bfa"
        if not isinstance(admin_online_color, str) or not admin_online_color.strip():
            admin_online_color = "#a78bfa"
        admin_online_color = admin_online_color.strip()

        mod_default_online_color = await _get_mod_default_online_color()
        for u in users_data:
            if u.get("is_admin"):
                u["online_color"] = admin_online_color
            elif u.get("is_moderator") and u.get("online_color") is None:
                u["online_color"] = mod_default_online_color

        return OnlineUsersResponse(
            total_online=len(users_data),
            users=users_data,
            admin_online_color=admin_online_color,
            mod_default_online_color=mod_default_online_color,
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
