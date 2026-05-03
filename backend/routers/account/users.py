# Users: online list, search (all users incl. offline/dead)
from datetime import datetime, timezone, timedelta
from collections import Counter
import asyncio
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
    ActivityCountryShare = srv.ActivityCountryShare
    MOD_ONLINE_COLOR_DEFAULT = "#1e3a5f"
    HDO_ONLINE_COLOR = "#166534"  # dark green for Help Desk Operators

    async def _get_mod_default_online_color():
        doc = await db.game_settings.find_one({"key": "mod_default_online_color"}, {"_id": 0, "value": 1})
        raw = (doc.get("value") or MOD_ONLINE_COLOR_DEFAULT) if doc else MOD_ONLINE_COLOR_DEFAULT
        if not isinstance(raw, str) or not raw.strip():
            return MOD_ONLINE_COLOR_DEFAULT
        raw = raw.strip()
        return raw if raw.startswith("#") and len(raw) <= 9 else MOD_ONLINE_COLOR_DEFAULT

    async def _aggregate_country_breakdown(match: dict, limit: int = 8):
        """Group users in match by last_seen_country (2-letter) or '__' for unknown."""
        pipeline = [
            {"$match": match},
            {
                "$addFields": {
                    "_cc": {
                        "$let": {
                            "vars": {"u": {"$toUpper": {"$ifNull": ["$last_seen_country", ""]}}},
                            "in": {
                                "$cond": [
                                    {"$eq": [{"$strLenCP": "$$u"}, 2]},
                                    "$$u",
                                    "__",
                                ]
                            },
                        }
                    },
                },
            },
            {"$group": {"_id": "$_cc", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
        rows = await db.users.aggregate(pipeline).to_list(250)
        total = sum(int(r.get("count") or 0) for r in rows) or 0
        if total <= 0:
            return []
        out = []
        for r in rows[:limit]:
            cid = r.get("_id") or "__"
            code = "" if cid == "__" else str(cid)
            cnt = int(r.get("count") or 0)
            out.append(ActivityCountryShare(code=code, count=cnt, pct=round(100.0 * cnt / total, 1)))
        return out

    def _country_shares_from_counter(ct: Counter, limit: int = 8):
        total = sum(ct.values()) or 0
        if total <= 0:
            return []
        out = []
        for key, count in ct.most_common(limit):
            code = "" if key == "__" else key
            out.append(ActivityCountryShare(code=code, count=int(count), pct=round(100.0 * int(count) / total, 1)))
        return out

    @router.get("/users/online", response_model=OnlineUsersResponse)
    async def get_online_users(current_user: dict = Depends(get_current_user)):
        """Returns online and idle users with status field."""
        now = datetime.now(timezone.utc)
        five_min_ago = now - timedelta(minutes=5)
        ten_min_ago = now - timedelta(minutes=10)
        users = await db.users.find(
            {
                "is_dead": {"$ne": True},
                "is_bodyguard": {"$ne": True},
                "$or": [
                    {"last_seen": {"$gte": ten_min_ago.isoformat()}},  # Include idle users (5-10 min)
                    {"forced_online_until": {"$gt": now.isoformat()}},
                    {"$and": [{"auto_rank_enabled": True}, {"auto_rank_idle": {"$ne": True}}]},  # auto-rank not idle
                ],
            },
            {"_id": 0, "password_hash": 0}
        ).to_list(100)

        users_data = []
        id_to_user = {}
        roster_country_counter: Counter = Counter()
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
            is_ent = bool(user.get("is_entertainer"))
            if is_admin:
                rank_name = "Admin"
            elif is_mod:
                rank_name = "Moderator"
            elif is_hdo:
                rank_name = f"(HDO) {rank_name}"
            elif is_ent:
                rank_name = f"(Entertainer) {rank_name}"
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
                raw_h = (user.get("hdo_online_color") or "").strip()
                if raw_h and raw_h.startswith("#") and len(raw_h) <= 9:
                    online_color = raw_h
                else:
                    online_color = HDO_ONLINE_COLOR
            elif is_ent:
                raw_e = (user.get("entertainer_online_color") or "").strip()
                if raw_e and raw_e.startswith("#") and len(raw_e) <= 9:
                    online_color = raw_e
                else:
                    online_color = "#7c3aed"
            
            # Determine user status: online, idle, or offline
            user_status = "offline"
            last_seen_str = user.get("last_seen")
            if last_seen_str:
                try:
                    ls_dt = datetime.fromisoformat(last_seen_str)
                    if ls_dt.tzinfo is None:
                        ls_dt = ls_dt.replace(tzinfo=timezone.utc)
                    if ls_dt >= five_min_ago:
                        user_status = "online"
                    elif ls_dt >= ten_min_ago:
                        user_status = "idle"
                except Exception:
                    pass
            # forced_online_until overrides to online
            forced_until = user.get("forced_online_until")
            if forced_until and user_status != "online":
                try:
                    fu = datetime.fromisoformat(forced_until)
                    if fu.tzinfo is None:
                        fu = fu.replace(tzinfo=timezone.utc)
                    if now < fu:
                        user_status = "online"
                except Exception:
                    pass
            # Admins/mods with auto-rank enabled = always show as "online" (24/7)
            # Regular users follow normal status based on last_seen (online/idle/offline)
            if (is_admin or is_mod) and user.get("auto_rank_enabled") and not user.get("auto_rank_idle"):
                user_status = "online"
            
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
                "is_entertainer": is_ent,
                "prestige_level": _prestige_level,
                "online_color": online_color,
                "status": user_status,
            }
            raw_cc = (user.get("last_seen_country") or "").strip().upper()
            roster_country_counter[raw_cc if len(raw_cc) == 2 and raw_cc.isalpha() else "__"] += 1
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

        admin_emails = list(ADMIN_EMAILS or [])
        now_iso = now.isoformat()

        def _activity_snapshot_match(cutoff_iso: str):
            """Count accounts 'around' like the live roster: last_seen in window, or non-idle auto-rank, or forced online now.

            Pure last_seen would under-count vs the roster because many listed players are there only via auto-rank
            (or admin force-online) without a recent browser ping."""
            return {
                "is_dead": {"$ne": True},
                "is_bodyguard": {"$ne": True},
                "username": {"$regex": r"\S"},
                "$nor": [
                    {
                        "$and": [
                            {
                                "$or": [
                                    {"email": {"$in": admin_emails}},
                                    {"is_moderator": True},
                                ]
                            },
                            {"admin_ghost_mode": True},
                        ]
                    }
                ],
                "$or": [
                    {"last_seen": {"$gte": cutoff_iso}},
                    {"$and": [{"auto_rank_enabled": True}, {"auto_rank_idle": {"$ne": True}}]},
                    {"forced_online_until": {"$gt": now_iso}},
                ],
            }

        hour_ago = (now - timedelta(hours=1)).isoformat()
        day_ago = (now - timedelta(days=1)).isoformat()
        week_ago = (now - timedelta(days=7)).isoformat()
        hour_match = _activity_snapshot_match(hour_ago)
        day_match = _activity_snapshot_match(day_ago)
        week_match = _activity_snapshot_match(week_ago)
        (
            active_hour,
            active_day,
            active_week,
            countries_hour,
            countries_day,
            countries_week,
        ) = await asyncio.gather(
            db.users.count_documents(hour_match),
            db.users.count_documents(day_match),
            db.users.count_documents(week_match),
            _aggregate_country_breakdown(hour_match),
            _aggregate_country_breakdown(day_match),
            _aggregate_country_breakdown(week_match),
        )

        return OnlineUsersResponse(
            total_online=len(users_data),
            users=users_data,
            admin_online_color=admin_online_color,
            mod_default_online_color=mod_default_online_color,
            hdo_online_color=HDO_ONLINE_COLOR,
            active_last_hour=active_hour,
            active_last_day=active_day,
            active_last_week=active_week,
            countries_roster=_country_shares_from_counter(roster_country_counter),
            countries_hour=countries_hour,
            countries_day=countries_day,
            countries_week=countries_week,
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
                "is_admin": bool(u.get("email") in ADMIN_EMAILS),
                "is_moderator": bool(_is_moderator(u)),
            })
        return {"users": result}
