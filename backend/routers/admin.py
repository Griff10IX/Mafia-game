# Admin: ghost mode, act-as-normal, change-rank, add-points, give-all, add-car,
# security (summary, flags, rate-limits, telegram, clear), hitlist reset,
# force-online, lock/kill player, search time, clear searches, check, activity/gambling log,
# find-duplicates, cheat-detection, user-details, wipe, delete-user, events, seed-families.
import logging
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel


class WipeConfirmation(BaseModel):
    confirmation_text: str  # Must be exactly "WIPE ALL DATA"


class EventsToggleRequest(BaseModel):
    enabled: bool


class AllEventsForTestingRequest(BaseModel):
    enabled: bool


class AdminSettingsUpdate(BaseModel):
    admin_online_color: Optional[str] = None


SEED_FAMILIES_CONFIG = [
    {"name": "Corleone", "tag": "CORL", "members": ["boss", "underboss", "consigliere", "capo", "soldier"]},
    {"name": "Baranco", "tag": "BARN", "members": ["boss", "underboss", "consigliere", "capo", "soldier"]},
    {"name": "Stracci", "tag": "STRC", "members": ["boss", "underboss", "consigliere", "capo", "soldier"]},
]
SEED_RANK_POINTS_BY_ROLE = {"boss": 24000, "underboss": 12000, "consigliere": 6000, "capo": 3000, "soldier": 1000}
SEED_RACKETS_BY_FAMILY = {
    "Corleone": {"protection": 2, "gambling": 1, "loansharking": 1, "labour": 1},
    "Baranco": {"protection": 1, "gambling": 2, "loansharking": 1, "labour": 1},
    "Stracci": {"protection": 1, "gambling": 1, "loansharking": 1, "labour": 2},
}
SEED_TREASURY = 75_000
SEED_TEST_PASSWORD = "test1234"


def register(router):
    """Register admin routes. Dependencies from server to avoid circular imports."""
    import server as srv
    import security as security_module
    from routers.families import FAMILY_RACKETS
    from routers.bodyguards import _create_robot_bodyguard_user

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    _username_pattern = srv._username_pattern
    RANKS = srv.RANKS
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    CARS = srv.CARS
    maybe_process_rank_up = srv.maybe_process_rank_up
    get_rank_info = srv.get_rank_info
    get_password_hash = srv.get_password_hash
    DEFAULT_GARAGE_BATCH_LIMIT = srv.DEFAULT_GARAGE_BATCH_LIMIT
    SWISS_BANK_LIMIT_START = srv.SWISS_BANK_LIMIT_START
    DEFAULT_HEALTH = srv.DEFAULT_HEALTH
    get_events_enabled = srv.get_events_enabled
    get_all_events_for_testing = srv.get_all_events_for_testing
    get_combined_event = srv.get_combined_event
    get_active_game_event = srv.get_active_game_event

    @router.post("/admin/ghost-mode")
    async def admin_toggle_ghost_mode(current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        new_value = not current_user.get("admin_ghost_mode", False)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"admin_ghost_mode": new_value}}
        )
        return {"admin_ghost_mode": new_value, "message": "Ghost mode " + ("on" if new_value else "off")}

    @router.post("/admin/act-as-normal")
    async def admin_act_as_normal(acting: bool, current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"admin_acting_as_normal": bool(acting)}}
        )
        return {"admin_acting_as_normal": bool(acting), "message": "Act as normal user " + ("on" if acting else "off")}

    @router.post("/admin/change-rank")
    async def admin_change_rank(
        target_username: str,
        new_rank: int,
        prestige_level: Optional[int] = Query(None, ge=0, le=5, description="Prestige level 0–5; if omitted, keeps target's current prestige"),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not (1 <= new_rank <= len(RANKS)):
            raise HTTPException(status_code=400, detail=f"new_rank must be 1–{len(RANKS)}")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        # Resolve prestige: use provided level or keep target's current
        if prestige_level is not None:
            new_prestige_level = prestige_level
            new_prestige_mult = PRESTIGE_CONFIGS[new_prestige_level]["threshold_mult"] if new_prestige_level > 0 else 1.0
        else:
            new_prestige_level = int(target.get("prestige_level") or 0)
            new_prestige_mult = float(target.get("prestige_rank_multiplier") or 1.0)

        rank_def = RANKS[new_rank - 1]
        required_pts_base = int(rank_def["required_points"])
        # Set rank_points so effective rank (rank_points / prestige_mult) equals the requested rank
        required_pts = int(required_pts_base * new_prestige_mult)

        old_rp = int(target.get("rank_points") or 0)
        updates = {"rank": new_rank, "rank_points": required_pts, "prestige_level": new_prestige_level, "prestige_rank_multiplier": new_prestige_mult}
        await db.users.update_one({"id": target["id"]}, {"$set": updates})

        rp_added = required_pts - old_rp
        if rp_added > 0:
            try:
                await maybe_process_rank_up(target["id"], old_rp, rp_added, target.get("username", ""), new_prestige_mult)
            except Exception as e:
                logging.exception("Rank-up notification (admin set rank): %s", e)

        prestige_msg = f", prestige {new_prestige_level}" if new_prestige_level > 0 else ""
        return {"message": f"Changed {target['username']}'s rank to {rank_def['name']} (rank_points set to {required_pts:,}{prestige_msg})"}

    @router.post("/admin/add-points")
    async def admin_add_points(target_username: str, points: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one(
            {"id": target["id"]},
            {"$inc": {"points": points}}
        )
        return {"message": f"Added {points} points to {target_username}"}

    @router.post("/admin/give-all-points")
    async def admin_give_all_points(points: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if points < 1:
            raise HTTPException(status_code=400, detail="Points must be at least 1")
        result = await db.users.update_many(
            {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}},
            {"$inc": {"points": points}}
        )
        return {"message": f"Gave {points} points to {result.modified_count} accounts", "updated": result.modified_count}

    @router.post("/admin/give-all-money")
    async def admin_give_all_money(amount: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if amount < 1:
            raise HTTPException(status_code=400, detail="Amount must be at least 1")
        result = await db.users.update_many(
            {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}},
            {"$inc": {"money": amount}}
        )
        return {"message": f"Gave ${amount:,} to {result.modified_count} accounts", "updated": result.modified_count}

    @router.post("/admin/add-car")
    async def admin_add_car(target_username: str, car_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        car = next((c for c in CARS if c["id"] == car_id), None)
        if not car:
            raise HTTPException(status_code=404, detail="Car not found")
        await db.user_cars.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": target["id"],
            "car_id": car_id,
            "car_name": car["name"],
            "acquired_at": datetime.now(timezone.utc).isoformat()
        })
        return {"message": f"Added {car['name']} to {target_username}'s garage"}

    @router.get("/admin/security/summary")
    async def admin_security_summary(limit: int = 100, flag_type: str = None, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        summary = await security_module.get_security_summary(db, limit=limit, flag_type=flag_type)
        return summary

    @router.get("/admin/security/flags")
    async def admin_security_flags(
        limit: int = 100,
        flag_type: str = None,
        user_id: str = None,
        resolved: bool = None,
        current_user: dict = Depends(get_current_user)
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        query = {}
        if flag_type:
            query["flag_type"] = flag_type
        if user_id:
            query["user_id"] = user_id
        if resolved is not None:
            query["resolved"] = resolved
        flags = await db.security_flags.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
        return {"flags": flags, "count": len(flags)}

    @router.post("/admin/security/flags/{flag_id}/resolve")
    async def admin_resolve_security_flag(flag_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await db.security_flags.update_one(
            {"id": flag_id},
            {"$set": {"resolved": True, "resolved_at": datetime.now(timezone.utc).isoformat()}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Flag not found")
        return {"message": "Flag marked as resolved", "flag_id": flag_id}

    @router.get("/admin/security/rate-limits")
    async def admin_get_rate_limits(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return {
            "rate_limits": security_module.RATE_LIMIT_CONFIG,
            "note": "Min seconds between clicks per endpoint. Rate limits are in-memory; changes apply immediately."
        }

    @router.post("/admin/security/rate-limits/toggle")
    async def admin_toggle_rate_limit(
        endpoint: str,
        enabled: bool,
        current_user: dict = Depends(get_current_user)
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if endpoint not in security_module.RATE_LIMIT_CONFIG:
            raise HTTPException(status_code=404, detail=f"Endpoint '{endpoint}' not found in rate limit config")
        interval, _ = security_module.RATE_LIMIT_CONFIG[endpoint]
        security_module.RATE_LIMIT_CONFIG[endpoint] = (interval, enabled)
        return {
            "message": f"Rate limit for '{endpoint}' {'enabled' if enabled else 'disabled'}",
            "endpoint": endpoint,
            "min_interval_sec": interval,
            "enabled": enabled
        }

    @router.post("/admin/security/rate-limits/update")
    async def admin_update_rate_limit(
        endpoint: str,
        min_interval_sec: float,
        current_user: dict = Depends(get_current_user)
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if endpoint not in security_module.RATE_LIMIT_CONFIG:
            raise HTTPException(status_code=404, detail=f"Endpoint '{endpoint}' not found in rate limit config")
        if min_interval_sec < 0.1 or min_interval_sec > 60:
            raise HTTPException(status_code=400, detail="Min interval must be between 0.1 and 60 seconds")
        _, enabled = security_module.RATE_LIMIT_CONFIG[endpoint]
        security_module.RATE_LIMIT_CONFIG[endpoint] = (min_interval_sec, enabled)
        return {
            "message": f"Rate limit for '{endpoint}' updated to {min_interval_sec}s between clicks",
            "endpoint": endpoint,
            "min_interval_sec": min_interval_sec,
            "enabled": enabled
        }

    @router.post("/admin/security/rate-limits/disable-all")
    async def admin_disable_all_rate_limits(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        security_module.GLOBAL_RATE_LIMITS_ENABLED = False
        count = 0
        for endpoint in security_module.RATE_LIMIT_CONFIG:
            interval, _ = security_module.RATE_LIMIT_CONFIG[endpoint]
            security_module.RATE_LIMIT_CONFIG[endpoint] = (interval, False)
            count += 1
        return {
            "message": f"Disabled ALL rate limiting (global toggle OFF + {count} endpoints disabled)",
            "global_enabled": False,
            "count": count
        }

    @router.post("/admin/security/rate-limits/enable-all")
    async def admin_enable_all_rate_limits(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        security_module.GLOBAL_RATE_LIMITS_ENABLED = True
        count = 0
        for endpoint in security_module.RATE_LIMIT_CONFIG:
            interval, _ = security_module.RATE_LIMIT_CONFIG[endpoint]
            security_module.RATE_LIMIT_CONFIG[endpoint] = (interval, True)
            count += 1
        return {
            "message": f"Enabled ALL rate limiting (global toggle ON + {count} endpoints enabled)",
            "global_enabled": True,
            "count": count
        }

    @router.post("/admin/security/rate-limits/global-toggle")
    async def admin_toggle_global_rate_limits(
        enabled: bool,
        current_user: dict = Depends(get_current_user)
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        security_module.GLOBAL_RATE_LIMITS_ENABLED = enabled
        return {
            "message": f"Global rate limits {'ENABLED' if enabled else 'DISABLED'}",
            "global_enabled": enabled
        }

    @router.post("/admin/security/test-telegram")
    async def admin_test_telegram(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not security_module.TELEGRAM_ENABLED:
            return {
                "success": False,
                "message": "Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env file."
            }
        await security_module.send_telegram_alert(
            f"🧪 Test alert from Mafia Game\n\nAdmin: {current_user.get('username', 'Unknown')}\n\nIf you see this, Telegram integration is working!",
            "info"
        )
        await security_module.flush_telegram_alerts()
        return {
            "success": True,
            "message": "Test alert sent! Check your Telegram chat."
        }

    @router.post("/admin/security/clear-user-flags")
    async def admin_clear_user_flags(user_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        count = await security_module.clear_user_security_flags(db, user_id)
        return {"message": f"Cleared {count} flag(s) for user {user_id}", "cleared_count": count}

    @router.post("/admin/security/clear-old-flags")
    async def admin_clear_old_flags(days: int = 30, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        count = await security_module.clear_old_security_flags(db, days)
        return {
            "message": f"Cleared {count} flag(s) older than {days} days",
            "cleared_count": count,
            "days": days
        }

    @router.post("/admin/hitlist/reset-npc-timers")
    async def admin_reset_hitlist_npc_timers(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await db.users.update_many(
            {},
            {"$set": {"hitlist_npc_add_timestamps": []}}
        )
        return {"message": f"Reset hitlist NPC timers for all users ({result.modified_count} accounts)", "modified_count": result.modified_count}

    @router.post("/admin/oc/reset-all-timers")
    async def admin_reset_all_oc_timers(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await db.users.update_many(
            {},
            {"$unset": {"oc_cooldown_until": ""}}
        )
        return {"message": f"Reset OC timers for all users ({result.modified_count} accounts)", "modified_count": result.modified_count}

    @router.post("/admin/force-online")
    async def admin_force_online(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        five_min_ago = now - timedelta(minutes=5)
        until = now + timedelta(hours=1)
        until_iso = until.isoformat()
        res = await db.users.update_many(
            {
                "is_dead": {"$ne": True},
                "$and": [
                    {
                        "$or": [
                            {"last_seen": {"$lt": five_min_ago.isoformat()}},
                            {"last_seen": None},
                            {"last_seen": {"$exists": False}},
                        ]
                    },
                    {
                        "$or": [
                            {"forced_online_until": {"$exists": False}},
                            {"forced_online_until": None},
                            {"forced_online_until": {"$lt": until_iso}},
                        ]
                    },
                ],
            },
            {"$set": {"forced_online_until": until_iso}},
        )
        return {"message": f"Forced offline users online until {until_iso}", "until": until_iso, "updated": res.modified_count}

    @router.post("/admin/lock-player")
    async def admin_lock_player(target_username: str, lock_minutes: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        jail_until = datetime.now(timezone.utc) + timedelta(minutes=lock_minutes)
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"in_jail": True, "jail_until": jail_until.isoformat()}}
        )
        return {"message": f"Locked {target_username} for {lock_minutes} minutes"}

    @router.post("/admin/kill-player")
    async def admin_kill_player(target_username: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is already dead")
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {
                "is_dead": True,
                "dead_at": now_iso,
                "points_at_death": int(target.get("points", 0) or 0),
                "money": 0,
                "health": 0,
            }, "$inc": {"total_deaths": 1}}
        )
        return {"message": f"Killed {target_username}. Account is dead (cannot login); use Dead to Alive to revive."}

    @router.post("/admin/set-search-time")
    async def admin_set_search_time(target_username: str, search_minutes: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        if not username_pattern:
            raise HTTPException(status_code=404, detail="User not found")
        attacker = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not attacker:
            raise HTTPException(status_code=404, detail="User not found")
        if int(search_minutes) <= 0:
            await db.users.update_one({"id": attacker["id"]}, {"$unset": {"search_minutes_override": ""}})
            return {"message": f"Cleared {target_username}'s search time override (back to default)"}
        await db.users.update_one({"id": attacker["id"]}, {"$set": {"search_minutes_override": int(search_minutes)}})
        new_found_time = datetime.now(timezone.utc) + timedelta(minutes=int(search_minutes))
        await db.attacks.update_many(
            {"attacker_id": attacker["id"], "status": "searching"},
            {"$set": {"found_at": new_found_time.isoformat()}}
        )
        return {"message": f"Set {target_username}'s search time to {search_minutes} minutes (persistent)"}

    @router.post("/admin/set-all-search-time")
    async def admin_set_all_search_time(search_minutes: int = 5, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if search_minutes <= 0:
            raise HTTPException(status_code=400, detail="search_minutes must be positive")
        res = await db.users.update_many(
            {},
            {"$set": {"search_minutes_override": int(search_minutes)}}
        )
        await db.game_config.update_one(
            {"id": "main"},
            {"$set": {"default_search_minutes": int(search_minutes)}},
            upsert=True
        )
        new_found_time = datetime.now(timezone.utc) + timedelta(minutes=int(search_minutes))
        await db.attacks.update_many(
            {"status": "searching"},
            {"$set": {"found_at": new_found_time.isoformat()}}
        )
        return {"message": f"Set all users' search time to {search_minutes} minutes, persistent for everyone including new users ({res.modified_count} users updated)"}

    @router.post("/admin/clear-all-searches")
    async def admin_clear_all_searches(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        res = await db.attacks.delete_many({})
        return {"message": f"Cleared all searches ({res.deleted_count} deleted)"}

    @router.get("/admin/check")
    async def admin_check(current_user: dict = Depends(get_current_user)):
        is_admin = _is_admin(current_user)
        has_admin_email = (current_user.get("email") or "") in ADMIN_EMAILS
        return {"is_admin": is_admin, "has_admin_email": has_admin_email}

    @router.get("/admin/settings")
    async def admin_get_settings(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (doc.get("value") or "#a78bfa") if doc else "#a78bfa"
        if not isinstance(admin_online_color, str) or not admin_online_color.strip():
            admin_online_color = "#a78bfa"
        return {"admin_online_color": admin_online_color.strip()}

    @router.patch("/admin/settings")
    async def admin_patch_settings(body: AdminSettingsUpdate, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        updates = {}
        if body.admin_online_color is not None:
            val = (body.admin_online_color or "").strip() or "#a78bfa"
            if not val.startswith("#"):
                val = "#" + val
            updates["value"] = val
        if updates:
            await db.game_settings.update_one(
                {"key": "admin_online_color"},
                {"$set": updates},
                upsert=True,
            )
        doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (doc.get("value") or "#a78bfa") if doc else "#a78bfa"
        return {"admin_online_color": admin_online_color}

    @router.get("/admin/activity-log")
    async def admin_activity_log(
        limit: int = 100,
        username: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        limit = min(max(1, limit), 500)
        query = {}
        if username and username.strip():
            uname_pattern = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE)
            query["username"] = uname_pattern
        cursor = db.activity_log.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
        entries = await cursor.to_list(limit)
        return {"entries": entries, "count": len(entries)}

    @router.get("/admin/gambling-log")
    async def admin_gambling_log(
        limit: int = 100,
        username: Optional[str] = None,
        game_type: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        limit = min(max(1, limit), 500)
        query = {}
        if username and username.strip():
            uname_pattern = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE)
            query["username"] = uname_pattern
        if game_type and game_type.strip():
            query["game_type"] = game_type.strip().lower()
        cursor = db.gambling_log.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
        entries = await cursor.to_list(limit)
        return {"entries": entries, "count": len(entries)}

    @router.post("/admin/gambling-log/clear")
    async def admin_gambling_log_clear(
        days: int = 30,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if days < 1:
            days = 1
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        res = await db.gambling_log.delete_many({"created_at": {"$lt": cutoff}})
        return {"message": f"Cleared {res.deleted_count} gambling log entries older than {days} days", "deleted_count": res.deleted_count}

    @router.get("/admin/find-duplicates")
    async def admin_find_duplicates(username: str = None, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if username:
            pattern = re.compile(f".*{re.escape(username)}.*", re.IGNORECASE)
            users = await db.users.find(
                {"username": pattern},
                {"_id": 0, "id": 1, "username": 1, "email": 1, "total_kills": 1, "money": 1, "rank_points": 1, "current_state": 1, "created_at": 1, "is_dead": 1}
            ).to_list(50)
            return {"query": username, "count": len(users), "users": users}
        pipeline = [
            {"$group": {"_id": {"$toLower": "$username"}, "count": {"$sum": 1}, "users": {"$push": {"id": "$id", "username": "$username", "email": "$email", "total_kills": "$total_kills", "money": "$money", "created_at": "$created_at"}}}},
            {"$match": {"count": {"$gt": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 20}
        ]
        duplicates = await db.users.aggregate(pipeline).to_list(20)
        return {"duplicates": duplicates}

    @router.get("/admin/cheat-detection/same-ip")
    async def admin_cheat_same_ip(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        users = await db.users.find(
            {"is_dead": {"$ne": True}},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "login_ips": 1, "last_login_ip": 1, "created_at": 1},
        ).to_list(5000)
        ip_to_users = {}
        for u in users:
            summary = {"id": u["id"], "username": u.get("username"), "email": u.get("email"), "created_at": u.get("created_at")}
            reg_ip = (u.get("registration_ip") or "").strip()
            if reg_ip:
                ip_to_users.setdefault(reg_ip, []).append({**summary, "source": "registration"})
            for lip in (u.get("login_ips") or []):
                lip = (lip or "").strip()
                if lip and lip != reg_ip:
                    ip_to_users.setdefault(lip, []).append({**summary, "source": "login"})
        groups = [{"ip": ip, "count": len(accs), "accounts": accs} for ip, accs in ip_to_users.items() if len(accs) >= 2]
        groups.sort(key=lambda g: -g["count"])
        return {"groups": groups[:100], "total_groups": len(groups)}

    @router.get("/admin/cheat-detection/duplicate-suspects")
    async def admin_cheat_duplicate_suspects(
        username: str = Query(None, description="Optional: filter by username contains"),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        query = {"is_dead": {"$ne": True}}
        if username and username.strip():
            query["username"] = re.compile(re.escape(username.strip()), re.IGNORECASE)
        users = await db.users.find(
            query,
            {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "created_at": 1},
        ).to_list(2000)
        domain_to_users = {}
        for u in users:
            email = (u.get("email") or "").strip()
            if "@" in email:
                domain = email.split("@")[-1].lower()
                domain_to_users.setdefault(domain, []).append(u)
        domain_groups = [{"domain": d, "count": len(accs), "accounts": accs} for d, accs in domain_to_users.items() if len(accs) >= 2]
        domain_groups.sort(key=lambda g: -g["count"])
        base_to_users = {}
        for u in users:
            uname = (u.get("username") or "").strip()
            base = re.sub(r"\d+", "", uname).lower() or uname.lower()
            if len(base) >= 2:
                base_to_users.setdefault(base, []).append(u)
        name_groups = [{"base": b, "count": len(accs), "accounts": accs} for b, accs in base_to_users.items() if len(accs) >= 2]
        name_groups.sort(key=lambda g: -g["count"])
        return {
            "by_domain": domain_groups[:50],
            "by_similar_username": name_groups[:50],
        }

    @router.get("/admin/user-details/{user_id}")
    async def admin_user_details(user_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        dice_owned = await db.dice_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(10)
        return {"user": user, "dice_owned": dice_owned}

    @router.post("/admin/wipe-all-users")
    async def admin_wipe_all_users(confirm: WipeConfirmation, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if confirm.confirmation_text != "WIPE ALL DATA":
            raise HTTPException(
                status_code=400,
                detail='Confirmation required. Send {"confirmation_text": "WIPE ALL DATA"} to confirm database wipe.'
            )
        logging.warning(f"🚨 DATABASE WIPE initiated by {current_user['email']} ({current_user['username']})")
        deleted = {}
        deleted["users"] = (await db.users.delete_many({})).deleted_count
        deleted["family_members"] = (await db.family_members.delete_many({})).deleted_count
        deleted["families"] = (await db.families.delete_many({})).deleted_count
        deleted["family_wars"] = (await db.family_wars.delete_many({})).deleted_count
        deleted["family_war_stats"] = (await db.family_war_stats.delete_many({})).deleted_count
        deleted["family_racket_attacks"] = (await db.family_racket_attacks.delete_many({})).deleted_count
        deleted["bodyguards"] = (await db.bodyguards.delete_many({})).deleted_count
        deleted["bodyguard_invites"] = (await db.bodyguard_invites.delete_many({})).deleted_count
        deleted["user_cars"] = (await db.user_cars.delete_many({})).deleted_count
        deleted["user_properties"] = (await db.user_properties.delete_many({})).deleted_count
        deleted["user_weapons"] = (await db.user_weapons.delete_many({})).deleted_count
        deleted["attacks"] = (await db.attacks.delete_many({})).deleted_count
        deleted["notifications"] = (await db.notifications.delete_many({})).deleted_count
        deleted["extortions"] = (await db.extortions.delete_many({})).deleted_count
        deleted["sports_bets"] = (await db.sports_bets.delete_many({})).deleted_count
        deleted["blackjack_games"] = (await db.blackjack_games.delete_many({})).deleted_count
        deleted["dice_ownership"] = (await db.dice_ownership.delete_many({})).deleted_count
        deleted["dice_buy_back_offers"] = (await db.dice_buy_back_offers.delete_many({})).deleted_count
        deleted["interest_deposits"] = (await db.interest_deposits.delete_many({})).deleted_count
        deleted["password_resets"] = (await db.password_resets.delete_many({})).deleted_count
        deleted["money_transfers"] = (await db.money_transfers.delete_many({})).deleted_count
        deleted["bank_deposits"] = (await db.bank_deposits.delete_many({})).deleted_count
        total = sum(deleted.values())
        logging.warning(f"🚨 DATABASE WIPE completed by {current_user['email']}: {total} documents deleted")
        return {"message": f"⚠️ DATABASE WIPED: {total} documents deleted from the game", "details": deleted}

    @router.post("/admin/delete-user/{user_id}")
    async def admin_delete_single_user(user_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        deleted = {}
        username = user.get("username", "?")
        deleted["user"] = (await db.users.delete_one({"id": user_id})).deleted_count
        deleted["family_members"] = (await db.family_members.delete_many({"user_id": user_id})).deleted_count
        deleted["bodyguards"] = (await db.bodyguards.delete_many({"$or": [{"user_id": user_id}, {"bodyguard_user_id": user_id}]})).deleted_count
        deleted["bodyguard_invites"] = (await db.bodyguard_invites.delete_many({"$or": [{"from_user_id": user_id}, {"to_user_id": user_id}]})).deleted_count
        deleted["user_cars"] = (await db.user_cars.delete_many({"user_id": user_id})).deleted_count
        deleted["user_properties"] = (await db.user_properties.delete_many({"user_id": user_id})).deleted_count
        deleted["user_weapons"] = (await db.user_weapons.delete_many({"user_id": user_id})).deleted_count
        deleted["attacks"] = (await db.attacks.delete_many({"$or": [{"attacker_id": user_id}, {"target_id": user_id}]})).deleted_count
        deleted["notifications"] = (await db.notifications.delete_many({"user_id": user_id})).deleted_count
        deleted["extortions"] = (await db.extortions.delete_many({"$or": [{"extorter_id": user_id}, {"target_id": user_id}]})).deleted_count
        deleted["sports_bets"] = (await db.sports_bets.delete_many({"user_id": user_id})).deleted_count
        deleted["blackjack_games"] = (await db.blackjack_games.delete_many({"user_id": user_id})).deleted_count
        deleted["dice_ownership"] = (await db.dice_ownership.update_many({"owner_id": user_id}, {"$set": {"owner_id": None, "owner_username": None}})).modified_count
        deleted["dice_buy_back_offers"] = (await db.dice_buy_back_offers.delete_many({"$or": [{"from_owner_id": user_id}, {"to_user_id": user_id}]})).deleted_count
        deleted["interest_deposits"] = (await db.interest_deposits.delete_many({"user_id": user_id})).deleted_count
        deleted["family_war_stats"] = (await db.family_war_stats.delete_many({"user_id": user_id})).deleted_count
        total = sum(deleted.values())
        return {"message": f"Deleted user '{username}' and {total} related documents", "details": deleted}

    @router.get("/admin/events")
    async def admin_get_events(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = await get_events_enabled()
        all_for_testing = await get_all_events_for_testing()
        today_event = get_combined_event() if all_for_testing else (get_active_game_event() if enabled else None)
        return {"events_enabled": enabled, "all_events_for_testing": all_for_testing, "today_event": today_event}

    @router.post("/admin/events/toggle")
    async def admin_toggle_events(request: EventsToggleRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = request.enabled
        await db.game_config.update_one(
            {"id": "main"},
            {"$set": {"events_enabled": bool(enabled)}},
            upsert=True,
        )
        return {"message": "Daily events " + ("enabled" if enabled else "disabled"), "events_enabled": bool(enabled)}

    @router.post("/admin/events/all-for-testing")
    async def admin_all_events_for_testing(request: AllEventsForTestingRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = request.enabled
        await db.game_config.update_one(
            {"id": "main"},
            {"$set": {"all_events_for_testing": bool(enabled)}},
            upsert=True,
        )
        return {"message": "All events for testing " + ("enabled" if enabled else "disabled"), "all_events_for_testing": bool(enabled)}

    @router.post("/admin/seed-families")
    async def admin_seed_families(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        password_hash = get_password_hash(SEED_TEST_PASSWORD)
        now = datetime.now(timezone.utc).isoformat()
        created_users = []
        created_families = []
        for fam_cfg in SEED_FAMILIES_CONFIG:
            name, tag = fam_cfg["name"], fam_cfg["tag"]
            existing = await db.families.find_one({"$or": [{"name": name}, {"tag": tag}]})
            if existing:
                family_id_old = existing["id"]
                members = await db.family_members.find({"family_id": family_id_old}, {"_id": 0, "user_id": 1}).to_list(100)
                user_ids_old = [m["user_id"] for m in members]
                if user_ids_old:
                    await db.bodyguards.delete_many({"user_id": {"$in": user_ids_old}})
                    await db.users.delete_many({"is_bodyguard": True, "bodyguard_owner_id": {"$in": user_ids_old}})
                await db.family_members.delete_many({"family_id": family_id_old})
                if user_ids_old:
                    await db.users.delete_many({"id": {"$in": user_ids_old}})
                await db.families.delete_one({"id": family_id_old})
            family_id = str(uuid.uuid4())
            user_ids = []
            for i, role in enumerate(fam_cfg["members"]):
                user_id = str(uuid.uuid4())
                base = f"{tag.lower()}_{role}"
                username = f"{base}_{i}"
                email = f"{base}{i}@test.mafia"
                if await db.users.find_one({"$or": [{"email": email}, {"username": username}]}):
                    continue
                rank_points = SEED_RANK_POINTS_BY_ROLE.get(role, 0)
                rank_id, _ = get_rank_info(rank_points)
                user_doc = {
                    "id": user_id,
                    "email": email,
                    "username": username,
                    "password_hash": password_hash,
                    "rank": rank_id,
                    "money": 1000.0,
                    "points": 0,
                    "rank_points": rank_points,
                    "bodyguard_slots": 2,
                    "bullets": 0,
                    "avatar_url": None,
                    "jail_busts": 0,
                    "jail_bust_attempts": 0,
                    "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
                    "total_crimes": 0,
                    "crime_profit": 0,
                    "total_gta": 0,
                    "total_oc_heists": 0,
                    "oc_timer_reduced": False,
                    "current_state": "Chicago",
                    "swiss_balance": 0,
                    "swiss_limit": SWISS_BANK_LIMIT_START,
                    "total_kills": 0,
                    "total_deaths": 0,
                    "in_jail": False,
                    "jail_until": None,
                    "premium_rank_bar": False,
                    "custom_car_name": None,
                    "travels_this_hour": 0,
                    "travel_reset_time": now,
                    "extra_airmiles": 0,
                    "health": DEFAULT_HEALTH,
                    "armour_level": 0,
                    "armour_owned_level_max": 0,
                    "equipped_weapon_id": None,
                    "kill_inflation": 0.0,
                    "kill_inflation_updated_at": now,
                    "is_dead": False,
                    "dead_at": None,
                    "points_at_death": None,
                    "retrieval_used": False,
                    "last_seen": now,
                    "created_at": now,
                }
                await db.users.insert_one(user_doc)
                created_users.append({"username": username, "email": email, "role": role, "family": name})
                user_ids.append((user_id, role, username))
            boss_id = user_ids[0][0] if user_ids else None
            if not boss_id:
                continue
            first_racket_id = FAMILY_RACKETS[0]["id"]
            rackets = {first_racket_id: {"level": 1, "last_collected_at": None}}
            await db.families.insert_one({
                "id": family_id,
                "name": name,
                "tag": tag,
                "boss_id": boss_id,
                "treasury": SEED_TREASURY,
                "created_at": now,
                "rackets": rackets,
            })
            created_families.append({"name": name, "tag": tag})
            for user_id, role, _ in user_ids:
                await db.family_members.insert_one({
                    "id": str(uuid.uuid4()),
                    "family_id": family_id,
                    "user_id": user_id,
                    "role": role,
                    "joined_at": now,
                })
                await db.users.update_one(
                    {"id": user_id},
                    {"$set": {"family_id": family_id, "family_role": role}},
                )
            for user_id, role, owner_username in user_ids:
                owner = {"id": user_id, "current_state": "Chicago"}
                for slot in range(1, 3):
                    try:
                        robot_user_id, robot_username = await _create_robot_bodyguard_user(owner)
                        await db.bodyguards.insert_one({
                            "id": str(uuid.uuid4()),
                            "user_id": user_id,
                            "owner_username": owner_username,
                            "slot_number": slot,
                            "is_robot": True,
                            "robot_name": robot_username,
                            "bodyguard_user_id": robot_user_id,
                            "health": 100,
                            "armour_level": 0,
                            "hired_at": now,
                        })
                    except Exception as e:
                        logging.exception("Seed bodyguard for %s slot %s: %s", user_id, slot, e)
        return {
            "message": f"Seeded {len(created_families)} families with {len(created_users)} users (each with 2 robot bodyguards). Password for all: test1234",
            "families": created_families,
            "users": created_users,
        }
