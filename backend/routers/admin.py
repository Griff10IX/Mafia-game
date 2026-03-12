# Admin: ghost mode, act-as-normal, change-rank, add-points, give-all, add-car,
# security (summary, flags, rate-limits, telegram, clear), hitlist reset,
# force-online, lock/kill player, search time, clear searches, check, activity/gambling log,
# find-duplicates, cheat-detection, user-details, wipe, delete-user, events, seed-families, create-test-users.
import logging
import random
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel

from disposable_email import is_disposable_email


class WipeConfirmation(BaseModel):
    confirmation_text: str  # Must be exactly "WIPE ALL DATA"


class NewReleaseConfirmation(BaseModel):
    confirmation_text: str  # Must be exactly "NEW RELEASE"


class EventsToggleRequest(BaseModel):
    enabled: bool


class AllEventsForTestingRequest(BaseModel):
    enabled: bool


class AdminSettingsUpdate(BaseModel):
    admin_online_color: Optional[str] = None
    mod_default_online_color: Optional[str] = None  # default colour for Mod on Users Online (mods can override on profile)
    require_email_verification: Optional[bool] = None
    stock_market_max_points: Optional[int] = None
    landing_banner_enabled: Optional[bool] = None


class TestUsersAutoRankRequest(BaseModel):
    enabled: bool


class GTAExclusivePoolRequest(BaseModel):
    """Release or retract the Al Capone exclusive (car20) into the GTA car pool. Only 1 in game at a time; when released, very rare drop."""
    released: bool


class AdminChangeEmailRequest(BaseModel):
    new_email: str


class AdminSetPasswordRequest(BaseModel):
    new_password: str


class DropUserCasinoRequest(BaseModel):
    user_id: str
    game_type: str  # dice, roulette, blackjack, horseracing, videopoker, slots
    location: str   # city for most, state for slots


class DropUserCasinosPropertiesRequest(BaseModel):
    user_id: str


class DropAllCasinosPropertiesConfirmation(BaseModel):
    confirmation_text: str  # "DROP ALL CASINOS PROPERTIES"


class ForumMuteRequest(BaseModel):
    target_username: str
    duration_hours: Optional[int] = None  # set one of duration_hours, duration_days, or permanent
    duration_days: Optional[int] = None
    permanent: bool = False
    reason: Optional[str] = None


class GameChatMuteRequest(BaseModel):
    target_username: str
    muted: bool  # True = mute, False = unmute
    muted_until: Optional[str] = None  # ISO datetime; if set, mute expires at this time (optional; omit for permanent)


class PageLockUpdate(BaseModel):
    path: str
    message: Optional[str] = None
    locked: bool
    unlock_at: Optional[str] = None  # ISO datetime; lock auto-expires when past


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
    send_notification = srv.send_notification
    _is_admin = srv._is_admin
    _is_moderator = srv._is_moderator
    _is_hdo = srv._is_hdo
    ADMIN_EMAILS = srv.ADMIN_EMAILS

    def _admin_or_mod(user: dict) -> bool:
        """True if user is admin or moderator (mods have limited tools: logs, account info, lock user; no wealth/rank)."""
        return _is_admin(user) or _is_moderator(user)

    def _can_forum_mute(user: dict) -> bool:
        """Admin, mod, or HDO can mute/unmute forum users."""
        return _is_admin(user) or _is_moderator(user) or _is_hdo(user)

    _username_pattern = srv._username_pattern
    RANKS = srv.RANKS
    STATES = srv.STATES
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
        """Toggle ghost mode (appear offline). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
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

    @router.post("/admin/add-loot-pieces")
    async def admin_add_loot_pieces(target_username: str, pieces: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if pieces < 0:
            raise HTTPException(status_code=400, detail="Pieces must be non-negative")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one(
            {"id": target["id"]},
            {"$inc": {"loot_box_pieces": pieces}},
        )
        return {"message": f"Added {pieces} loot box pieces to {target_username}"}

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

    GTA_EXCLUSIVE_POOL_CONFIG_ID = "gta_exclusive"

    @router.get("/admin/gta/exclusive-pool")
    async def admin_gta_exclusive_pool_get(current_user: dict = Depends(get_current_user)):
        """Get whether the Al Capone exclusive is released into the GTA car pool. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_config.find_one({"id": GTA_EXCLUSIVE_POOL_CONFIG_ID}, {"_id": 0, "released": 1})
        return {"released": bool(doc.get("released") if doc else False)}

    @router.post("/admin/gta/exclusive-pool")
    async def admin_gta_exclusive_pool_set(body: GTAExclusivePoolRequest, current_user: dict = Depends(get_current_user)):
        """Release or retract the Al Capone exclusive (car20) into the GTA car pool. When released, it can drop from GTA (very rare); only 1 in game at a time. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        await db.game_config.update_one(
            {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID},
            {"$set": {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID, "released": body.released}},
            upsert=True,
        )
        return {"message": f"Al Capone exclusive {'released into' if body.released else 'retracted from'} GTA car pool", "released": body.released}

    @router.post("/admin/slots/set-draw-in-minutes")
    async def admin_slots_set_draw_in_minutes(minutes: int = 1, current_user: dict = Depends(get_current_user)):
        """Set next_draw_at to now + minutes for all states (testing)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        next_at = (now + timedelta(minutes=max(1, min(minutes, 60 * 24)))).isoformat()
        for state in (STATES or []):
            await db.slots_ownership.update_one(
                {"state": state},
                {"$set": {"state": state, "next_draw_at": next_at}},
                upsert=True,
            )
        return {"message": f"Next slots draw set to {minutes} minute(s) from now (all states)"}

    @router.post("/admin/slots/reset-draw-default")
    async def admin_slots_reset_draw_default(current_user: dict = Depends(get_current_user)):
        """Reset next_draw_at to next 3h on the hour (00:00, 03:00, 06:00, … UTC) for all states."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.slots import get_next_slots_draw_on_the_hour_utc
        next_at = get_next_slots_draw_on_the_hour_utc()
        for state in (STATES or []):
            await db.slots_ownership.update_one(
                {"state": state},
                {"$set": {"state": state, "next_draw_at": next_at}},
                upsert=True,
            )
        return {"message": "Slots draw reset to default (every 3h on the hour) for all states"}

    @router.post("/admin/slots/clear-cooldowns")
    async def admin_slots_clear_cooldowns(current_user: dict = Depends(get_current_user)):
        """Clear slots_cooldown_until for all users so everyone can enter/win the draw again. For testing."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        # Unset for ALL users (no filter) so we clear the field regardless of how it was stored
        result = await db.users.update_many(
            {},
            {"$unset": {"slots_cooldown_until": ""}},
        )
        return {"message": f"Slots cooldown cleared for {result.modified_count} user(s). They are eligible for the next draw."}

    @router.post("/admin/cars/delete-all")
    async def admin_delete_all_cars(current_user: dict = Depends(get_current_user)):
        """Delete every user's cars (all documents in user_cars). For testing."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await db.user_cars.delete_many({})
        return {"message": f"Deleted {result.deleted_count} cars (everyone's garages cleared)", "deleted_count": result.deleted_count}

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
            "global_enabled": getattr(security_module, "GLOBAL_RATE_LIMITS_ENABLED", True),
            "note": "Min seconds between clicks per endpoint. Rate limits are in-memory; changes apply immediately."
        }

    @router.post("/admin/security/rate-limits/toggle")
    async def admin_toggle_rate_limit(
        endpoint: str,
        enabled: str = "true",
        current_user: dict = Depends(get_current_user)
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled_bool = str(enabled).lower() in ("true", "1", "yes")
        if endpoint not in security_module.RATE_LIMIT_CONFIG:
            raise HTTPException(status_code=404, detail=f"Endpoint '{endpoint}' not found in rate limit config")
        interval, _ = security_module.RATE_LIMIT_CONFIG[endpoint]
        security_module.RATE_LIMIT_CONFIG[endpoint] = (interval, enabled_bool)
        return {
            "message": f"Rate limit for '{endpoint}' {'enabled' if enabled_bool else 'disabled'}",
            "endpoint": endpoint,
            "min_interval_sec": interval,
            "enabled": enabled_bool
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

    @router.post("/admin/daily-rewards/reset-timer")
    async def admin_daily_rewards_reset_timer(
        target_username: Optional[str] = Query(None, description="Reset this user only; omit to reset all users"),
        current_user: dict = Depends(get_current_user),
    ):
        """Reset Daily Rewards timer (6h play window): clear rps_plays and any in-progress Noughts & Crosses game."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if target_username is not None and not (target_username or "").strip():
            raise HTTPException(status_code=400, detail="target_username cannot be empty")
        if target_username:
            username_pattern = _username_pattern(target_username.strip())
            target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
            if not target:
                raise HTTPException(status_code=404, detail="User not found")
            user_id = target["id"]
            u_res = await db.users.update_one({"id": user_id}, {"$set": {"rps_plays": []}})
            ttt_res = await db.daily_rewards_ttt.delete_many({"user_id": user_id})
            return {
                "message": f"Reset Daily Rewards timer for {target.get('username', target_username)}. Cleared plays and {ttt_res.deleted_count} in-progress game(s).",
                "modified_count": 1 if u_res.modified_count else 0,
                "ttt_deleted_count": ttt_res.deleted_count,
            }
        u_res = await db.users.update_many({}, {"$set": {"rps_plays": []}})
        ttt_res = await db.daily_rewards_ttt.delete_many({})
        return {
            "message": f"Reset Daily Rewards timer for all users. Cleared plays on {u_res.modified_count} accounts, removed {ttt_res.deleted_count} in-progress game(s).",
            "modified_count": u_res.modified_count,
            "ttt_deleted_count": ttt_res.deleted_count,
        }

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
    async def admin_lock_player(target_username: str, lock_minutes: int = 0, current_user: dict = Depends(get_current_user)):
        """Lock account for investigation: user can only access /locked page and submit one comment until unlocked. lock_minutes ignored (kept for API compat). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "account_locked": True,
                    "account_locked_at": now_iso,
                },
                "$unset": {
                    "account_locked_comment": "",
                    "account_locked_comment_at": "",
                },
            },
        )
        return {"message": f"Locked {target_username} for investigation. They can only access the locked page and submit one comment."}

    @router.post("/admin/unlock-account")
    async def admin_unlock_account(target_username: str, current_user: dict = Depends(get_current_user)):
        """Unlock an account that was locked for investigation. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {"account_locked": False},
                "$unset": {"account_locked_at": "", "account_locked_comment": "", "account_locked_comment_at": "", "account_locked_until": "", "account_locked_admin_message": "", "account_locked_admin_message_at": "", "account_locked_user_reply": "", "account_locked_user_reply_at": ""},
            },
        )
        return {"message": f"Unlocked {target_username}. They can access the app again."}

    @router.get("/admin/locked-accounts")
    async def admin_locked_accounts(current_user: dict = Depends(get_current_user)):
        """List users currently locked for investigation (username, comment, dates). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.users.find(
            {"account_locked": True},
            {"_id": 0, "username": 1, "account_locked_at": 1, "account_locked_until": 1, "account_locked_comment": 1, "account_locked_comment_at": 1, "account_locked_admin_message": 1, "account_locked_admin_message_at": 1, "account_locked_user_reply": 1, "account_locked_user_reply_at": 1},
        )
        users = await cursor.to_list(100)
        return {"locked": users}

    @router.get("/admin/users-online-live")
    async def admin_users_online_live(current_user: dict = Depends(get_current_user)):
        """List everyone actually online (last 5 min), with last click, last page, IP, and same-IP count. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        now = datetime.now(timezone.utc)
        five_min_ago = now - timedelta(minutes=5)
        cursor = db.users.find(
            {
                "is_dead": {"$ne": True},
                "is_bodyguard": {"$ne": True},
                "$or": [
                    {"last_seen": {"$gte": five_min_ago.isoformat()}},
                    {"forced_online_until": {"$gt": now.isoformat()}},
                    {"auto_rank_enabled": True},
                ],
            },
            {"_id": 0, "id": 1, "username": 1, "last_seen": 1, "last_path": 1, "last_request_ip": 1, "last_login_ip": 1, "email": 1, "is_moderator": 1, "admin_ghost_mode": 1},
        )
        raw = await cursor.to_list(200)
        users = []
        for u in raw:
            if (u.get("email") in ADMIN_EMAILS or u.get("is_moderator")) and u.get("admin_ghost_mode"):
                continue
            ip = (u.get("last_request_ip") or u.get("last_login_ip") or "").strip() or None
            users.append({
                "id": u.get("id"),
                "username": u.get("username"),
                "last_seen": u.get("last_seen"),
                "last_path": u.get("last_path"),
                "ip": ip,
            })
        ip_counts = {}
        for u in users:
            ip = u.get("ip")
            if ip:
                ip_counts[ip] = ip_counts.get(ip, 0) + 1
        for u in users:
            ip = u.get("ip")
            same = (ip_counts.get(ip, 0) - 1) if ip else 0
            u["same_ip_online_count"] = max(0, same)
        users.sort(key=lambda x: (x.get("last_seen") or ""), reverse=True)
        return {"users": users}
    async def admin_test_lock_self(current_user: dict = Depends(get_current_user)):
        """Lock the current admin for 60 seconds (test the locked page flow). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        until = now + timedelta(seconds=60)
        now_iso = now.isoformat()
        until_iso = until.isoformat()
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$set": {
                    "account_locked": True,
                    "account_locked_at": now_iso,
                    "account_locked_until": until_iso,
                },
                "$unset": {"account_locked_comment": "", "account_locked_comment_at": ""},
            },
        )
        return {"message": "You are locked for 60 seconds. You will be redirected to the locked page.", "account_locked_until": until_iso}

    class LockedAccountMessageBody(BaseModel):
        target_username: str
        message: str

    @router.post("/admin/locked-account-message")
    async def admin_locked_account_message(body: LockedAccountMessageBody, current_user: dict = Depends(get_current_user)):
        """Leave a message for a locked user; they see it on the locked page and can reply once. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(body.target_username)
        target = await db.users.find_one({"username": username_pattern, "account_locked": True}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found or not locked")
        msg = (body.message or "").strip()[:2000]
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"account_locked_admin_message": msg, "account_locked_admin_message_at": now_iso}},
        )
        return {"message": f"Message sent to {target.get('username', body.target_username)}.", "account_locked_admin_message_at": now_iso}

    @router.post("/admin/kill-player")
    async def admin_kill_player(target_username: str, current_user: dict = Depends(get_current_user)):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
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
                "money_at_death": int(target.get("money", 0) or 0),
                "money": 0,
                "health": 0,
            }, "$inc": {"total_deaths": 1}}
        )
        try:
            from routers.families import maybe_promote_after_boss_death
            await maybe_promote_after_boss_death(target["id"])
        except Exception as e:
            logging.exception("Promote after boss death: %s", e)
        try:
            from routers.quicktrade import cancel_offers_on_death
            await cancel_offers_on_death(target["id"])
        except Exception as e:
            logging.exception("Quick trade offers on death: %s", e)
        return {"message": f"Killed {target_username}. Account is dead (cannot login); use Dead to Alive to revive."}

    @router.post("/admin/give-auto-rank")
    async def admin_give_auto_rank(target_username: str, current_user: dict = Depends(get_current_user)):
        """Give a user auto rank: set auto_rank_purchased and auto_rank_enabled with default sub-options."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        updates = {
            "auto_rank_purchased": True,
            "auto_rank_enabled": True,
            "auto_rank_crimes": True,
            "auto_rank_gta": True,
            "auto_rank_bust_every_5_sec": False,
            "auto_rank_oc": False,
            "auto_rank_booze": False,
        }
        await db.users.update_one({"id": target["id"]}, {"$set": updates})
        return {"message": f"Auto rank given to {target.get('username', target_username)}", "username": target.get("username")}

    @router.post("/admin/remove-auto-rank")
    async def admin_remove_auto_rank(target_username: str, current_user: dict = Depends(get_current_user)):
        """Remove auto rank from a user: clear purchased, enabled, and related fields/stats."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        unset = {
            "auto_rank_stats_since": "",
            "auto_rank_total_busts": "",
            "auto_rank_total_crimes": "",
            "auto_rank_total_gtas": "",
            "auto_rank_total_cash": "",
            "auto_rank_best_cars": "",
            "auto_rank_total_booze_runs": "",
            "auto_rank_total_booze_profit": "",
        }
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "auto_rank_purchased": False,
                    "auto_rank_enabled": False,
                    "auto_rank_crimes": False,
                    "auto_rank_gta": False,
                    "auto_rank_bust_every_5_sec": False,
                    "auto_rank_oc": False,
                    "auto_rank_booze": False,
                },
                "$unset": unset,
            },
        )
        return {"message": f"Auto rank removed from {target.get('username', target_username)}", "username": target.get("username")}

    @router.post("/admin/revive-player")
    async def admin_revive_player(target_username: str, current_user: dict = Depends(get_current_user)):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if not target.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is not dead")
        current_state = target.get("current_state")
        if not current_state or current_state not in STATES:
            current_state = STATES[0]
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "is_dead": False,
                    "dead_at": None,
                    "health": DEFAULT_HEALTH,
                    "money": 1000,
                    "current_state": current_state,
                    "in_jail": False,
                },
                "$unset": {
                    "killed_by_username": "",
                    "killed_by_user_id": "",
                    "killed_by_family_name": "",
                    "points_at_death": "",
                    "money_at_death": "",
                    "traveling_to": "",
                    "travel_arrives_at": "",
                    "jail_until": "",
                },
            },
        )
        await db.attacks.delete_many({"attacker_id": target["id"]})
        return {"message": f"Revived {target_username}. They can log in again."}

    @router.post("/admin/change-email")
    async def admin_change_email(
        target_username: str,
        body: AdminChangeEmailRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Change a user's email. New email must not be disposable and must be unique."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        new_email = (body.new_email or "").strip().lower()
        if not new_email or "@" not in new_email:
            raise HTTPException(status_code=400, detail="Valid email required")
        if is_disposable_email(new_email):
            raise HTTPException(status_code=400, detail="Disposable email addresses are not allowed.")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        existing = await db.users.find_one(
            {"email": re.compile("^" + re.escape(new_email) + "$", re.IGNORECASE), "id": {"$ne": target["id"]}},
            {"_id": 0, "id": 1},
        )
        if existing:
            raise HTTPException(status_code=400, detail="That email is already in use by another account.")
        await db.users.update_one({"id": target["id"]}, {"$set": {"email": new_email}})
        await db.login_lockouts.delete_many({"email": (target.get("email") or "").strip().lower()})
        return {"message": f"Email updated for {target.get('username', target_username)}", "username": target.get("username")}

    @router.post("/admin/log-out-user")
    async def admin_log_out_user(target_username: str, current_user: dict = Depends(get_current_user)):
        """Invalidate all sessions for the user; they must log in again."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"id": target["id"]}, {"$inc": {"token_version": 1}})
        return {"message": f"{target.get('username', target_username)} has been logged out. All their sessions are invalid."}

    @router.post("/admin/set-password")
    async def admin_set_password(
        target_username: str,
        body: AdminSetPasswordRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Set a user's password (e.g. temporary password). They can change it after logging in."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not (body.new_password or "").strip() or len((body.new_password or "").strip()) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        new_hash = get_password_hash((body.new_password or "").strip())
        await db.users.update_one({"id": target["id"]}, {"$set": {"password_hash": new_hash}})
        await db.users.update_one({"id": target["id"]}, {"$inc": {"token_version": 1}})
        return {"message": f"Password set for {target.get('username', target_username)}. They have been logged out and must log in with the new password."}

    @router.get("/admin/profile-load-errors")
    async def admin_profile_load_errors(limit: int = Query(50, ge=1, le=200), current_user: dict = Depends(get_current_user)):
        """List recent profile load failures (auth/me 500) so admins can see what went wrong for which user."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        rows = await db.profile_load_errors.find(
            {},
            {"_id": 0, "id": 1, "user_id": 1, "username": 1, "error": 1, "traceback": 1, "created_at": 1},
        ).sort("created_at", -1).limit(limit).to_list(limit)
        return {"errors": rows, "count": len(rows)}

    @router.get("/admin/login-issues")
    async def admin_login_issues(limit: int = Query(100, ge=1, le=500), current_user: dict = Depends(get_current_user)):
        """List current login lockouts (too many failed attempts). Shows email, failed count, locked until, and username if account exists. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        cursor = db.login_lockouts.find({}, {"_id": 0, "email": 1, "failed_count": 1, "locked_until": 1, "updated_at": 1}).sort("updated_at", -1).limit(limit)
        rows = await cursor.to_list(limit)
        out = []
        for r in rows:
            email = (r.get("email") or "").strip().lower()
            locked_until = r.get("locked_until")
            if isinstance(locked_until, str):
                try:
                    locked_until = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
                except ValueError:
                    locked_until = None
            still_locked = locked_until and locked_until > now
            user = await db.users.find_one({"email": re.compile("^" + re.escape(email) + "$", re.IGNORECASE)}, {"_id": 0, "username": 1}) if email else None
            out.append({
                "email": email,
                "username": user.get("username") if user else None,
                "failed_count": r.get("failed_count", 0),
                "locked_until": r.get("locked_until"),
                "updated_at": r.get("updated_at"),
                "still_locked": still_locked,
            })
        return {"lockouts": out, "count": len(out)}

    @router.post("/admin/clear-login-lockout")
    async def admin_clear_login_lockout(target_username: str, current_user: dict = Depends(get_current_user)):
        """Clear login lockout for a user (by their current email), so they can try logging in again. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        email = (target.get("email") or "").strip().lower()
        if email:
            result = await db.login_lockouts.delete_many({"email": email})
            return {"message": f"Login lockout cleared for {target.get('username', target_username)}", "deleted_count": result.deleted_count}
        return {"message": f"No email on account; nothing to clear.", "username": target.get("username")}

    @router.post("/admin/clear-login-lockout-by-email")
    async def admin_clear_login_lockout_by_email(email: str, current_user: dict = Depends(get_current_user)):
        """Clear login lockout for an email (e.g. from the login-issues list). Use when you don't know the username. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        email_clean = (email or "").strip().lower()
        if not email_clean or "@" not in email_clean:
            raise HTTPException(status_code=400, detail="Valid email required")
        result = await db.login_lockouts.delete_many({"email": email_clean})
        return {"message": f"Login lockout cleared for {email_clean}", "deleted_count": result.deleted_count}

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

    @router.get("/admin/exclusive-loot")
    async def admin_exclusive_loot(current_user: dict = Depends(get_current_user)):
        """List users who own exclusive loot (cars, weapon, armour, property). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cars_catalog = {c["id"]: c for c in (CARS or [])}
        # Exclusive cars: car20 (exclusive), car21 (loot_exclusive)
        exclusive_car_ids = {c["id"] for c in (CARS or []) if c.get("rarity") in ("exclusive", "loot_exclusive")}
        users_by_id = {}
        async def _add_user(uid: str, category: str, item: str):
            if uid not in users_by_id:
                u = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "username": 1})
                users_by_id[uid] = {"username": (u or {}).get("username", "?"), "items": []}
            users_by_id[uid]["items"].append({"category": category, "item": item})
        # Cars
        cursor = db.user_cars.find({"car_id": {"$in": list(exclusive_car_ids)}}, {"_id": 0, "user_id": 1, "car_id": 1})
        async for uc in cursor:
            info = cars_catalog.get(uc.get("car_id"), {})
            name = info.get("name") or uc.get("car_id") or "?"
            await _add_user(uc["user_id"], "car", name)
        # Weapon (Colt Monitor / weapon_loot)
        cursor = db.user_weapons.find({"weapon_id": "weapon_loot", "quantity": {"$gte": 1}}, {"_id": 0, "user_id": 1})
        async for uw in cursor:
            await _add_user(uw["user_id"], "weapon", "Colt Monitor")
        # Armour level 6 (Steel Plate Vest 1922)
        cursor = db.users.find({"$or": [{"armour_level": 6}, {"armour_owned_level_max": {"$gte": 6}}]}, {"_id": 0, "id": 1, "username": 1})
        async for u in cursor:
            uid = u["id"]
            if uid not in users_by_id:
                users_by_id[uid] = {"username": u.get("username", "?"), "items": []}
            users_by_id[uid]["items"].append({"category": "armour", "item": "Steel Plate Vest 1922"})
        # Exclusive property (Speakeasy)
        cursor = db.exclusive_properties.find({"type": "speakeasy"}, {"_id": 0, "owner_id": 1})
        async for ep in cursor:
            await _add_user(ep["owner_id"], "property", "Speakeasy")
        out = sorted(users_by_id.values(), key=lambda x: (-len(x["items"]), x["username"].lower()))
        return {"owners": out}

    @router.get("/admin/check")
    async def admin_check(current_user: dict = Depends(get_current_user)):
        is_admin = _is_admin(current_user)
        is_moderator = _is_moderator(current_user)
        is_help_desk_operator = _is_hdo(current_user)
        has_admin_email = (current_user.get("email") or "") in ADMIN_EMAILS
        return {"is_admin": is_admin, "is_moderator": is_moderator, "is_help_desk_operator": is_help_desk_operator, "has_admin_email": has_admin_email}

    @router.get("/admin/moderators")
    async def admin_list_moderators(current_user: dict = Depends(get_current_user)):
        """List users who are moderators. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.users.find(
            {"is_moderator": True},
            {"_id": 0, "id": 1, "username": 1, "email": 1},
        )
        mods = await cursor.to_list(500)
        return {"moderators": mods}

    @router.post("/admin/promote-moderator")
    async def admin_promote_moderator(target_username: str, current_user: dict = Depends(get_current_user)):
        """Promote a user to moderator. Admin only. Moderators can view logs, account info, and lock users; they cannot give/take wealth or change rank."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1, "is_moderator": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("email") in ADMIN_EMAILS:
            raise HTTPException(status_code=400, detail="Admins are already full admins; no need to promote as moderator")
        if target.get("is_moderator"):
            return {"message": f"{target.get('username', target_username)} is already a moderator."}
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_moderator": True}})
        return {"message": f"Promoted {target.get('username', target_username)} to moderator."}

    @router.post("/admin/demote-moderator")
    async def admin_demote_moderator(target_username: str, current_user: dict = Depends(get_current_user)):
        """Remove moderator role from a user. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_moderator": False}})
        return {"message": f"Removed moderator role from {target.get('username', target_username)}."}

    @router.get("/admin/help-desk-operators")
    async def admin_list_hdos(current_user: dict = Depends(get_current_user)):
        """List Help Desk Operators. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.users.find(
            {"is_help_desk_operator": True},
            {"_id": 0, "id": 1, "username": 1, "email": 1},
        )
        hdos = await cursor.to_list(500)
        return {"help_desk_operators": hdos}

    @router.post("/admin/promote-hdo")
    async def admin_promote_hdo(target_username: str, current_user: dict = Depends(get_current_user)):
        """Promote a user to Help Desk Operator. Admin or moderator. HDOs can reply to and close help desk tickets."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "is_help_desk_operator": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("is_help_desk_operator"):
            return {"message": f"{target.get('username', target_username)} is already a Help Desk Operator."}
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_help_desk_operator": True}})
        return {"message": f"Promoted {target.get('username', target_username)} to Help Desk Operator."}

    @router.post("/admin/demote-hdo")
    async def admin_demote_hdo(target_username: str, current_user: dict = Depends(get_current_user)):
        """Remove Help Desk Operator role. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_help_desk_operator": False}})
        return {"message": f"Removed Help Desk Operator role from {target.get('username', target_username)}."}

    @router.get("/admin/forum-mutes")
    async def admin_list_forum_mutes(
        status_filter: Optional[str] = Query(None, description="active, pending_review, or None for all"),
        current_user: dict = Depends(get_current_user),
    ):
        """List forum mutes. Admin, mod, or HDO. Auto-expires mutes whose expires_at has passed so they disappear from active list."""
        if not _can_forum_mute(current_user):
            raise HTTPException(status_code=403, detail="Access required")
        now_iso = datetime.now(timezone.utc).isoformat()
        # Auto-expire: mark mutes that have passed their expiry so they disappear and user can post again
        await db.forum_mutes.update_many(
            {"status": "active", "expires_at": {"$ne": None, "$lt": now_iso}},
            {"$set": {"status": "expired", "expired_at": now_iso}},
        )
        query = {}
        if status_filter in ("active", "pending_review"):
            query["status"] = status_filter
        else:
            query["status"] = {"$in": ["active", "pending_review"]}
        cursor = db.forum_mutes.find(query, {"_id": 0}).sort("created_at", -1).limit(200)
        mutes = await cursor.to_list(200)
        return {"mutes": mutes}

    @router.post("/admin/forum-mute")
    async def admin_forum_mute(body: ForumMuteRequest, current_user: dict = Depends(get_current_user)):
        """Mute a user from the forum (stops them posting). HDO: hours/days or permanent (pending review). Admin/mod: same, permanent is active immediately."""
        if not _can_forum_mute(current_user):
            raise HTTPException(status_code=403, detail="Access required")
        username_pattern = _username_pattern(body.target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("email") in ADMIN_EMAILS:
            raise HTTPException(status_code=400, detail="Cannot mute admins")
        if _is_moderator(target) or _is_hdo(target):
            raise HTTPException(status_code=400, detail="Cannot mute staff")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        permanent = bool(body.permanent)
        hours = body.duration_hours
        days = body.duration_days
        if permanent:
            expires_at = None
            status = "pending_review" if _is_hdo(current_user) and not _admin_or_mod(current_user) else "active"
        else:
            total_hours = 0
            if hours is not None and hours > 0:
                total_hours += hours
            if days is not None and days > 0:
                total_hours += days * 24
            if total_hours <= 0:
                raise HTTPException(status_code=400, detail="Set duration_hours, duration_days, or permanent=True")
            expires_at = (now + timedelta(hours=total_hours)).isoformat()
            status = "active"
            # Human-readable duration for the notification
            if days and days > 0 and (hours or 0) == 0:
                duration_text = f"{int(days)} day(s)" if days else ""
            elif hours and hours > 0 and (days or 0) == 0:
                duration_text = f"{int(hours)} hour(s)" if hours else ""
            else:
                duration_text = f"{total_hours:.0f} hours"
        mute_id = str(uuid.uuid4())
        reason = (body.reason or "").strip() or None
        doc = {
            "id": mute_id,
            "user_id": target["id"],
            "username": target.get("username") or body.target_username,
            "muted_by_id": current_user["id"],
            "muted_by_username": current_user.get("username") or "?",
            "reason": reason,
            "expires_at": expires_at,
            "status": status,
            "created_at": now_iso,
        }
        await db.forum_mutes.insert_one(doc)
        # Notify muted user in inbox: reason, duration, and when they will be auto-unmuted (if applicable)
        title = "Forum mute"
        parts = []
        if reason:
            parts.append(f"Reason: {reason}")
        if permanent:
            if status == "pending_review":
                parts.append("Duration: Permanent (pending staff approval). You cannot post on the forum until a staff member unmutes you.")
            else:
                parts.append("Duration: Permanent. You cannot post on the forum until a staff member unmutes you.")
        else:
            try:
                exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                exp_str = exp_dt.strftime("%b %d, %Y at %I:%M %p UTC")
            except Exception:
                exp_str = expires_at
            parts.append(f"Duration: {duration_text}. You will be auto-unmuted on {exp_str}. You cannot post on the forum until then.")
        message = "\n\n".join(parts)
        try:
            await send_notification(target["id"], title, message, "system", category="system")
        except Exception as e:
            logging.exception("Forum mute inbox notification: %s", e)
        msg = f"Muted {target.get('username')} from forum"
        if status == "pending_review":
            msg += " (permanent — pending admin/mod review)"
        elif expires_at:
            msg += f" until {expires_at}"
        return {"message": msg, "mute": {**doc, "_id": 0}}

    @router.post("/admin/forum-unmute")
    async def admin_forum_unmute(target_username: str, current_user: dict = Depends(get_current_user)):
        """Remove forum mute. Admin, mod, or HDO. Keeps record in mute log (status=unmuted)."""
        if not _can_forum_mute(current_user):
            raise HTTPException(status_code=403, detail="Access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        now_iso = datetime.now(timezone.utc).isoformat()
        res = await db.forum_mutes.update_many(
            {"user_id": target["id"], "status": {"$in": ["active", "pending_review"]}},
            {"$set": {"status": "unmuted", "unmuted_at": now_iso}},
        )
        return {"message": f"Unmuted {target.get('username', target_username)} from forum", "updated": res.modified_count}

    @router.post("/admin/forum-mute-approve")
    async def admin_forum_mute_approve(mute_id: str, current_user: dict = Depends(get_current_user)):
        """Approve a permanent mute (pending_review -> active). Admin or mod only."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator required")
        mute = await db.forum_mutes.find_one({"id": mute_id}, {"_id": 0})
        if not mute:
            raise HTTPException(status_code=404, detail="Mute not found")
        if mute.get("status") != "pending_review":
            raise HTTPException(status_code=400, detail="Mute is not pending review")
        await db.forum_mutes.update_one({"id": mute_id}, {"$set": {"status": "active"}})
        try:
            await send_notification(
                mute["user_id"],
                "Forum mute (permanent approved)",
                "Your permanent forum mute has been approved. You cannot post on the forum until a staff member unmutes you.",
                "system",
                category="system",
            )
        except Exception as e:
            logging.exception("Forum mute approval inbox notification: %s", e)
        return {"message": "Permanent mute approved", "mute_id": mute_id}

    @router.get("/admin/forum-mutes-log")
    async def admin_forum_mutes_log(current_user: dict = Depends(get_current_user)):
        """Past forum mutes (expired or unmuted) with reason. Admin, mod, or HDO."""
        if not _can_forum_mute(current_user):
            raise HTTPException(status_code=403, detail="Access required")
        cursor = db.forum_mutes.find(
            {"status": {"$in": ["expired", "unmuted"]}},
            {"_id": 0, "id": 1, "username": 1, "user_id": 1, "reason": 1, "muted_by_username": 1, "created_at": 1, "expires_at": 1, "expired_at": 1, "unmuted_at": 1, "status": 1},
        ).sort("created_at", -1).limit(500)
        entries = await cursor.to_list(500)
        return {"log": entries}

    @router.post("/admin/game-chat-mute")
    async def admin_game_chat_mute(body: GameChatMuteRequest, current_user: dict = Depends(get_current_user)):
        """Mute or unmute a user from game chat. Admin or mod only. Muted users cannot send messages."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator required")
        username_pattern = _username_pattern(body.target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1, "is_moderator": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("email") in ADMIN_EMAILS:
            raise HTTPException(status_code=400, detail="Cannot mute admins")
        if _is_moderator(target):
            raise HTTPException(status_code=400, detail="Cannot mute moderators")
        if body.muted:
            set_payload = {"game_chat_muted": True}
            unset_payload = {}
            if (body.muted_until or "").strip():
                set_payload["game_chat_muted_until"] = body.muted_until.strip()
            else:
                unset_payload["game_chat_muted_until"] = ""
            await db.users.update_one(
                {"id": target["id"]},
                {"$set": set_payload, **({"$unset": unset_payload} if unset_payload else {})},
            )
            try:
                until_msg = f" until {body.muted_until}" if (body.muted_until or "").strip() else ". Contact staff if you think this is a mistake."
                await send_notification(
                    target["id"],
                    "Game chat mute",
                    f"You have been muted from game chat{until_msg}",
                    "system",
                    category="system",
                )
            except Exception as e:
                logging.exception("Game chat mute notification: %s", e)
            return {"message": f"Muted {target.get('username')} from game chat"}
        else:
            await db.users.update_one(
                {"id": target["id"]},
                {"$set": {"game_chat_muted": False}, "$unset": {"game_chat_muted_until": ""}},
            )
            try:
                await send_notification(
                    target["id"],
                    "Game chat unmute",
                    "You can post in game chat again.",
                    "system",
                    category="system",
                )
            except Exception as e:
                logging.exception("Game chat unmute notification: %s", e)
            return {"message": f"Unmuted {target.get('username')} from game chat"}

    @router.get("/admin/settings")
    async def admin_get_settings(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        MOD_DEFAULT = "#1e3a5f"
        doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (doc.get("value") or "#a78bfa") if doc else "#a78bfa"
        if not isinstance(admin_online_color, str) or not admin_online_color.strip():
            admin_online_color = "#a78bfa"
        mod_doc = await db.game_settings.find_one({"key": "mod_default_online_color"}, {"_id": 0, "value": 1})
        mod_default_online_color = (mod_doc.get("value") or MOD_DEFAULT) if mod_doc else MOD_DEFAULT
        if not isinstance(mod_default_online_color, str) or not mod_default_online_color.strip():
            mod_default_online_color = MOD_DEFAULT
        req_doc = await db.game_settings.find_one({"key": "require_email_verification"}, {"_id": 0, "value": 1})
        require_email_verification = bool(req_doc.get("value") if req_doc else True)  # default True when missing
        sm_doc = await db.game_settings.find_one({"key": "stock_market_max_points"}, {"_id": 0, "value": 1})
        stock_market_max_points = int(sm_doc["value"]) if sm_doc and sm_doc.get("value") is not None else 3000
        try:
            stock_market_max_points = max(1, int(stock_market_max_points))
        except (TypeError, ValueError):
            stock_market_max_points = 3000
        banner_doc = await db.game_settings.find_one({"key": "landing_banner_enabled"}, {"_id": 0, "value": 1})
        landing_banner_enabled = bool(banner_doc.get("value") if banner_doc else False)
        return {
            "admin_online_color": admin_online_color.strip(),
            "mod_default_online_color": mod_default_online_color.strip(),
            "require_email_verification": require_email_verification,
            "stock_market_max_points": stock_market_max_points,
            "landing_banner_enabled": landing_banner_enabled,
        }

    @router.patch("/admin/settings")
    async def admin_patch_settings(body: AdminSettingsUpdate, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if body.admin_online_color is not None:
            val = (body.admin_online_color or "").strip() or "#a78bfa"
            if not val.startswith("#"):
                val = "#" + val
            await db.game_settings.update_one(
                {"key": "admin_online_color"},
                {"$set": {"value": val}},
                upsert=True,
            )
        if body.mod_default_online_color is not None:
            mod_default = "#1e3a5f"
            val = (body.mod_default_online_color or "").strip() or mod_default
            if not val.startswith("#"):
                val = "#" + val
            if len(val) > 9:
                val = mod_default
            await db.game_settings.update_one(
                {"key": "mod_default_online_color"},
                {"$set": {"value": val}},
                upsert=True,
            )
        if body.require_email_verification is not None:
            await db.game_settings.update_one(
                {"key": "require_email_verification"},
                {"$set": {"value": body.require_email_verification}},
                upsert=True,
            )
        if body.stock_market_max_points is not None:
            val = max(1, int(body.stock_market_max_points))
            await db.game_settings.update_one(
                {"key": "stock_market_max_points"},
                {"$set": {"value": val}},
                upsert=True,
            )
        if body.landing_banner_enabled is not None:
            await db.game_settings.update_one(
                {"key": "landing_banner_enabled"},
                {"$set": {"value": body.landing_banner_enabled}},
                upsert=True,
            )
        MOD_DEFAULT = "#1e3a5f"
        doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (doc.get("value") or "#a78bfa") if doc else "#a78bfa"
        mod_doc = await db.game_settings.find_one({"key": "mod_default_online_color"}, {"_id": 0, "value": 1})
        mod_default_online_color = (mod_doc.get("value") or MOD_DEFAULT) if mod_doc else MOD_DEFAULT
        if not isinstance(mod_default_online_color, str) or not mod_default_online_color.strip():
            mod_default_online_color = MOD_DEFAULT
        req_doc = await db.game_settings.find_one({"key": "require_email_verification"}, {"_id": 0, "value": 1})
        require_email_verification = bool(req_doc.get("value") if req_doc else True)  # default True when missing
        sm_doc = await db.game_settings.find_one({"key": "stock_market_max_points"}, {"_id": 0, "value": 1})
        stock_market_max_points = int(sm_doc["value"]) if sm_doc and sm_doc.get("value") is not None else 3000
        stock_market_max_points = max(1, stock_market_max_points)
        banner_doc = await db.game_settings.find_one({"key": "landing_banner_enabled"}, {"_id": 0, "value": 1})
        landing_banner_enabled = bool(banner_doc.get("value") if banner_doc else False)
        return {
            "admin_online_color": admin_online_color,
            "mod_default_online_color": mod_default_online_color.strip() if isinstance(mod_default_online_color, str) else MOD_DEFAULT,
            "require_email_verification": require_email_verification,
            "stock_market_max_points": stock_market_max_points,
            "landing_banner_enabled": landing_banner_enabled,
        }

    PAGE_LOCKS_KEY = "page_locks"

    @router.get("/page-locks")
    async def get_page_locks_public():
        """Public: return which paths are locked and their message. Locks with unlock_at in the past are excluded."""
        from datetime import datetime, timezone
        doc = await db.game_settings.find_one({"key": PAGE_LOCKS_KEY}, {"_id": 0, "value": 1})
        raw = (doc.get("value") or {}).get("paths") if doc else {}
        if not isinstance(raw, dict):
            raw = {}
        now = datetime.now(timezone.utc)
        paths = {}
        for p, v in raw.items():
            if isinstance(v, dict):
                uat = v.get("unlock_at")
                if uat:
                    try:
                        until = datetime.fromisoformat(uat.replace("Z", "+00:00"))
                        if until.tzinfo is None:
                            until = until.replace(tzinfo=timezone.utc)
                        if now >= until:
                            continue
                    except Exception:
                        pass
                paths[p] = v.get("message", "Down for maintenance")
            elif isinstance(v, str):
                paths[p] = v
        return {"paths": paths}

    @router.get("/landing-banner")
    async def get_landing_banner_public():
        """Public: return whether the beta testing banner is enabled on the login page. No auth required."""
        doc = await db.game_settings.find_one({"key": "landing_banner_enabled"}, {"_id": 0, "value": 1})
        enabled = bool(doc.get("value") if doc else False)
        return {"enabled": enabled}

    @router.get("/admin/page-locks")
    async def admin_get_page_locks(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_settings.find_one({"key": PAGE_LOCKS_KEY}, {"_id": 0, "value": 1})
        raw = (doc.get("value") or {}).get("paths") if doc else {}
        if not isinstance(raw, dict):
            raw = {}
        paths = {}
        for p, v in raw.items():
            if isinstance(v, dict):
                paths[p] = {"message": v.get("message", "Down for maintenance"), "unlock_at": v.get("unlock_at")}
            else:
                paths[p] = {"message": (v or "Down for maintenance") if isinstance(v, str) else "Down for maintenance", "unlock_at": None}
        return {"paths": paths}

    @router.patch("/admin/page-locks")
    async def admin_patch_page_locks(body: PageLockUpdate, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        path = (body.path or "").strip().rstrip("/") or "/"
        if not path.startswith("/"):
            path = "/" + path
        doc = await db.game_settings.find_one({"key": PAGE_LOCKS_KEY}, {"_id": 0, "value": 1})
        value = (doc.get("value") or {}) if doc else {}
        raw = dict(value.get("paths") or {}) if isinstance(value.get("paths"), dict) else {}
        for k, v in list(raw.items()):
            if isinstance(v, str):
                raw[k] = {"message": v, "unlock_at": None}
        if body.locked:
            msg = (body.message or "").strip() or "Down for maintenance"
            uat = (body.unlock_at or "").strip() or None
            raw[path] = {"message": msg, "unlock_at": uat}
        else:
            raw.pop(path, None)
        await db.game_settings.update_one(
            {"key": PAGE_LOCKS_KEY},
            {"$set": {"value": {"paths": raw}}},
            upsert=True,
        )
        paths_out = {p: v.get("message", "Down for maintenance") if isinstance(v, dict) else v for p, v in raw.items()}
        return {"paths": paths_out}

    @router.get("/admin/activity-log")
    async def admin_activity_log(
        limit: int = 100,
        username: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
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
        if not _admin_or_mod(current_user):
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

    @router.get("/admin/crimes/analytics/summary")
    async def admin_crimes_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        limit: int = Query(100, ge=1, le=500),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Per-crime analytics summary for the last N days.
        Admin or moderator only. Uses compact crime_events documents.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        pipeline = [
            {"$match": {"at": {"$gte": since}}},
            {
                "$group": {
                    "_id": "$crime_id",
                    "crime_name": {"$last": "$crime_name"},
                    "crime_type": {"$last": "$crime_type"},
                    "attempts": {"$sum": 1},
                    "successes": {"$sum": {"$cond": ["$success", 1, 0]}},
                    "total_profit": {"$sum": "$profit"},
                    "last_at": {"$max": "$at"},
                }
            },
            {"$sort": {"attempts": -1}},
            {"$limit": int(limit)},
        ]
        cursor = db.crime_events.aggregate(pipeline)
        docs = await cursor.to_list(int(limit))
        total_attempts = sum(int(d.get("attempts", 0) or 0) for d in docs) or 1
        out = []
        for d in docs:
            attempts = int(d.get("attempts", 0) or 0)
            successes = int(d.get("successes", 0) or 0)
            total_profit = int(d.get("total_profit", 0) or 0)
            success_rate = successes / attempts if attempts > 0 else 0.0
            avg_profit = total_profit / attempts if attempts > 0 else 0.0
            usage_share = attempts / total_attempts if total_attempts > 0 else 0.0
            out.append(
                {
                    "crime_id": d.get("_id"),
                    "crime_name": d.get("crime_name") or d.get("_id"),
                    "crime_type": d.get("crime_type") or "normal",
                    "attempts": attempts,
                    "successes": successes,
                    "success_rate": success_rate,
                    "avg_profit": avg_profit,
                    "total_profit": total_profit,
                    "usage_share": usage_share,
                    "last_at": d.get("last_at"),
                }
            )
        return {"generated_at": now.isoformat(), "days": days, "items": out}

    @router.get("/admin/casinos/analytics/summary")
    async def admin_casinos_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Per-game casino analytics summary for the last N days.
        Admin or moderator only. Uses compact gambling_log documents.
        """
        from routers.stats import _gambling_profit_from_details

        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()

        cursor = db.gambling_log.find(
            {"created_at": {"$gte": since_iso}},
            {"_id": 0, "game_type": 1, "details": 1},
        )
        stats = {}
        async for row in cursor:
            gt = (row.get("game_type") or "").strip() or "unknown"
            details = row.get("details") or {}
            profit = _gambling_profit_from_details(gt, details)
            stake = int(details.get("stake") or details.get("bet") or 0)
            payout = int(details.get("payout") or 0)
            s = stats.setdefault(
                gt,
                {
                    "game_type": gt,
                    "attempts": 0,
                    "wins": 0,
                    "total_stake": 0,
                    "total_payout": 0,
                    "total_profit": 0,
                },
            )
            s["attempts"] += 1
            s["total_stake"] += stake
            s["total_payout"] += payout
            s["total_profit"] += profit
            if profit > 0:
                s["wins"] += 1

        items = []
        total_attempts = sum(v["attempts"] for v in stats.values()) or 1
        for gt, s in sorted(stats.items(), key=lambda kv: -kv[1]["attempts"]):
            attempts = s["attempts"]
            wins = s["wins"]
            total_profit = s["total_profit"]
            avg_profit = total_profit / attempts if attempts > 0 else 0.0
            win_rate = wins / attempts if attempts > 0 else 0.0
            usage_share = attempts / total_attempts if total_attempts > 0 else 0.0
            items.append(
                {
                    "game_type": gt,
                    "attempts": attempts,
                    "wins": wins,
                    "win_rate": win_rate,
                    "total_stake": s["total_stake"],
                    "total_payout": s["total_payout"],
                    "total_profit": total_profit,
                    "avg_profit": avg_profit,
                    "usage_share": usage_share,
                }
            )
        return {"generated_at": now.isoformat(), "days": days, "items": items}

    @router.get("/admin/trades/analytics/summary")
    async def admin_trades_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Quicktrade analytics summary for the last N days.
        Admin or moderator only. Uses compact trade_events documents.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()

        cursor = db.trade_events.find(
            {"at": {"$gte": since_iso}},
            {"_id": 0},
        )
        stats = {}
        async for e in cursor:
            ev_type = (e.get("type") or "").strip() or "unknown"
            direction = (e.get("direction") or "").strip() or "unknown"
            key = (ev_type, direction)
            s = stats.setdefault(
                key,
                {
                    "event_type": ev_type,
                    "direction": direction,
                    "count": 0,
                    "total_points": 0,
                    "total_money": 0,
                },
            )
            s["count"] += 1
            s["total_points"] += int(e.get("points") or 0)
            s["total_money"] += int(e.get("money") or 0)

        items = []
        total_events = sum(v["count"] for v in stats.values()) or 1
        for (_ev, _dir), s in sorted(stats.items(), key=lambda kv: -kv[1]["count"]):
            count = s["count"]
            usage_share = count / total_events if total_events > 0 else 0.0
            avg_points = s["total_points"] / count if count > 0 else 0.0
            avg_money = s["total_money"] / count if count > 0 else 0.0
            items.append(
                {
                    "event_type": s["event_type"],
                    "direction": s["direction"],
                    "count": count,
                    "total_points": s["total_points"],
                    "total_money": s["total_money"],
                    "avg_points": avg_points,
                    "avg_money": avg_money,
                    "usage_share": usage_share,
                }
            )
        return {"generated_at": now.isoformat(), "days": days, "items": items}

    @router.get("/admin/hitlist-bodyguards/analytics/summary")
    async def admin_hitlist_bodyguards_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Hitlist and bodyguard event analytics for the last N days.
        Admin or moderator only. Uses hitlist_bodyguard_events.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()

        cursor = db.hitlist_bodyguard_events.find(
            {"at": {"$gte": since_iso}},
            {"_id": 0},
        )
        by_type = {}
        async for e in cursor:
            ev_type = (e.get("type") or "").strip() or "unknown"
            s = by_type.setdefault(
                ev_type,
                {"event_type": ev_type, "count": 0, "total_cost_cash": 0, "total_cost_points": 0, "total_hire_cost": 0},
            )
            s["count"] += 1
            s["total_cost_cash"] += int(e.get("cost_cash") or 0)
            s["total_cost_points"] += int(e.get("cost_points") or 0)
            s["total_hire_cost"] += int(e.get("hire_cost") or e.get("cost") or 0)

        items = []
        total_events = sum(v["count"] for v in by_type.values()) or 1
        for ev_type, s in sorted(by_type.items(), key=lambda kv: -kv[1]["count"]):
            count = s["count"]
            usage_share = count / total_events if total_events > 0 else 0.0
            items.append(
                {
                    "event_type": s["event_type"],
                    "count": count,
                    "total_cost_cash": s["total_cost_cash"],
                    "total_cost_points": s["total_cost_points"],
                    "total_hire_cost": s["total_hire_cost"],
                    "usage_share": usage_share,
                }
            )
        return {"generated_at": now.isoformat(), "days": days, "items": items}

    @router.get("/admin/economy/analytics/summary")
    async def admin_economy_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Economy event analytics (car trades, property buys, loot drops, loot box opens, booze runs) for the last N days.
        Admin or moderator only. Uses economy_events.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()

        cursor = db.economy_events.find(
            {"at": {"$gte": since_iso}},
            {"_id": 0},
        )
        by_type = {}
        async for e in cursor:
            ev_type = (e.get("type") or "").strip() or "unknown"
            s = by_type.setdefault(
                ev_type,
                {
                    "event_type": ev_type,
                    "count": 0,
                    "total_price": 0,
                    "total_cost": 0,
                    "total_profit": 0,
                    "total_revenue": 0,
                    "total_pieces": 0,
                },
            )
            s["count"] += 1
            s["total_price"] += int(e.get("price") or 0)
            s["total_cost"] += int(e.get("cost") or 0)
            s["total_profit"] += int(e.get("profit") or 0)
            s["total_revenue"] += int(e.get("revenue") or 0)
            s["total_pieces"] += int(e.get("pieces") or 0)

        items = []
        total_events = sum(v["count"] for v in by_type.values()) or 1
        for ev_type, s in sorted(by_type.items(), key=lambda kv: -kv[1]["count"]):
            count = s["count"]
            usage_share = count / total_events if total_events > 0 else 0.0
            items.append(
                {
                    "event_type": s["event_type"],
                    "count": count,
                    "total_price": s["total_price"],
                    "total_cost": s["total_cost"],
                    "total_profit": s["total_profit"],
                    "total_revenue": s["total_revenue"],
                    "total_pieces": s["total_pieces"],
                    "usage_share": usage_share,
                }
            )
        return {"generated_at": now.isoformat(), "days": days, "items": items}

    @router.get("/admin/attacks/analytics/summary")
    async def admin_attacks_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        limit: int = Query(100, ge=1, le=500),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Per-weapon attack analytics summary for the last N days.
        Admin or moderator only. Uses compact attack_attempts documents.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()
        pipeline = [
            {"$match": {"created_at": {"$gte": since_iso}}},
            {
                "$group": {
                    "_id": {"weapon_name": "$weapon_name", "weapon_id": "$weapon_id"},
                    "weapon_name": {"$last": "$weapon_name"},
                    "weapon_id": {"$last": "$weapon_id"},
                    "attempts": {"$sum": 1},
                    "kills": {
                        "$sum": {
                            "$cond": [{"$eq": ["$outcome", "killed"]}, 1, 0],
                        }
                    },
                    "total_bullets_spent": {"$sum": {"$ifNull": ["$bullets_spent", "$bullets_used"]}},
                    "total_damage_done": {"$sum": {"$ifNull": ["$damage_done", 0]}},
                    "last_at": {"$max": "$created_at"},
                }
            },
            {"$sort": {"attempts": -1}},
            {"$limit": int(limit)},
        ]
        cursor = db.attack_attempts.aggregate(pipeline)
        docs = await cursor.to_list(int(limit))
        total_attempts = sum(int(d.get("attempts", 0) or 0) for d in docs) or 1
        total_kills = sum(int(d.get("kills", 0) or 0) for d in docs)
        total_bullets = sum(int(d.get("total_bullets_spent", 0) or 0) for d in docs)
        total_damage = sum(float(d.get("total_damage_done", 0.0) or 0.0) for d in docs)
        items = []
        for d in docs:
            attempts = int(d.get("attempts", 0) or 0)
            kills = int(d.get("kills", 0) or 0)
            total_b = int(d.get("total_bullets_spent", 0) or 0)
            total_dmg = float(d.get("total_damage_done", 0.0) or 0.0)
            kill_rate = kills / attempts if attempts > 0 else 0.0
            avg_bullets_per_attempt = total_b / attempts if attempts > 0 else 0.0
            avg_bullets_per_kill = total_b / kills if kills > 0 else 0.0
            avg_damage = total_dmg / attempts if attempts > 0 else 0.0
            usage_share = attempts / total_attempts if total_attempts > 0 else 0.0
            items.append(
                {
                    "weapon_id": d.get("weapon_id"),
                    "weapon_name": d.get("weapon_name") or (d.get("_id") or {}).get("weapon_name") or "Unknown",
                    "attempts": attempts,
                    "kills": kills,
                    "kill_rate": kill_rate,
                    "avg_bullets_per_attempt": avg_bullets_per_attempt,
                    "avg_bullets_per_kill": avg_bullets_per_kill,
                    "avg_damage": avg_damage,
                    "total_bullets_spent": total_b,
                    "total_damage_done": total_dmg,
                    "usage_share": usage_share,
                    "last_at": d.get("last_at"),
                }
            )
        global_stats = {
            "attempts": int(total_attempts),
            "kills": int(total_kills),
            "kill_rate": (total_kills / total_attempts) if total_attempts > 0 else 0.0,
            "avg_bullets_per_attempt": (total_bullets / total_attempts) if total_attempts > 0 else 0.0,
            "avg_damage_per_attempt": (total_damage / total_attempts) if total_attempts > 0 else 0.0,
        }
        return {
            "generated_at": now.isoformat(),
            "days": days,
            "items": items,
            "global": global_stats,
        }

    @router.get("/admin/attacks/user/{user_id}")
    async def admin_attacks_user_profile(
        user_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Per-user attack profile for admins/moderators.
        Aggregates stats for the user as attacker and as target, plus recent attack events.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        # Allow lookup by either user id or username (case-insensitive) so admins can paste a username
        # directly when inspecting attack logs.
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "current_state": 1},
        )
        if not user:
            key = (user_id or "").strip()
            if key:
                pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
                user = await db.users.find_one(
                    {"username": pattern},
                    {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "current_state": 1},
                )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user["id"]

        # Aggregate attacker summary
        attacker_pipeline = [
            {"$match": {"attacker_id": user_id}},
            {
                "$group": {
                    "_id": None,
                    "attempts": {"$sum": 1},
                    "kills": {
                        "$sum": {
                            "$cond": [{"$eq": ["$outcome", "killed"]}, 1, 0],
                        }
                    },
                    "total_bullets_spent": {"$sum": {"$ifNull": ["$bullets_spent", "$bullets_used"]}},
                    "total_damage_done": {"$sum": {"$ifNull": ["$damage_done", 0]}},
                }
            },
        ]
        attacker_cursor = db.attack_attempts.aggregate(attacker_pipeline)
        attacker_docs = await attacker_cursor.to_list(1)
        attacker_summary_raw = attacker_docs[0] if attacker_docs else {}
        attacker_attempts = int(attacker_summary_raw.get("attempts", 0) or 0)
        attacker_kills = int(attacker_summary_raw.get("kills", 0) or 0)
        attacker_bullets = int(attacker_summary_raw.get("total_bullets_spent", 0) or 0)
        attacker_damage = float(attacker_summary_raw.get("total_damage_done", 0.0) or 0.0)
        attacker_summary = {
            "attempts": attacker_attempts,
            "kills": attacker_kills,
            "kill_rate": (attacker_kills / attacker_attempts) if attacker_attempts > 0 else 0.0,
            "total_bullets_spent": attacker_bullets,
            "total_damage_done": attacker_damage,
            "avg_bullets_per_attempt": (attacker_bullets / attacker_attempts) if attacker_attempts > 0 else 0.0,
            "avg_damage_per_attempt": (attacker_damage / attacker_attempts) if attacker_attempts > 0 else 0.0,
        }

        # Aggregate target/victim summary
        target_pipeline = [
            {"$match": {"target_id": user_id}},
            {
                "$group": {
                    "_id": None,
                    "times_attacked": {"$sum": 1},
                    "times_killed": {
                        "$sum": {
                            "$cond": [{"$eq": ["$outcome", "killed"]}, 1, 0],
                        }
                    },
                }
            },
        ]
        target_cursor = db.attack_attempts.aggregate(target_pipeline)
        target_docs = await target_cursor.to_list(1)
        target_summary_raw = target_docs[0] if target_docs else {}
        target_attempts = int(target_summary_raw.get("times_attacked", 0) or 0)
        target_killed = int(target_summary_raw.get("times_killed", 0) or 0)
        target_summary = {
            "times_attacked": target_attempts,
            "times_killed": target_killed,
            "death_rate": (target_killed / target_attempts) if target_attempts > 0 else 0.0,
        }

        # Top weapons used by this user as attacker
        weapons_pipeline = [
            {"$match": {"attacker_id": user_id}},
            {
                "$group": {
                    "_id": {"weapon_name": "$weapon_name", "weapon_id": "$weapon_id"},
                    "weapon_name": {"$last": "$weapon_name"},
                    "weapon_id": {"$last": "$weapon_id"},
                    "attempts": {"$sum": 1},
                    "kills": {
                        "$sum": {
                            "$cond": [{"$eq": ["$outcome", "killed"]}, 1, 0],
                        }
                    },
                    "total_bullets_spent": {"$sum": {"$ifNull": ["$bullets_spent", "$bullets_used"]}},
                    "total_damage_done": {"$sum": {"$ifNull": ["$damage_done", 0]}},
                }
            },
            {"$sort": {"attempts": -1}},
            {"$limit": 10},
        ]
        weapons_cursor = db.attack_attempts.aggregate(weapons_pipeline)
        weapon_docs = await weapons_cursor.to_list(10)
        top_weapons = []
        for d in weapon_docs:
            attempts = int(d.get("attempts", 0) or 0)
            kills = int(d.get("kills", 0) or 0)
            total_b = int(d.get("total_bullets_spent", 0) or 0)
            total_dmg = float(d.get("total_damage_done", 0.0) or 0.0)
            top_weapons.append(
                {
                    "weapon_id": d.get("weapon_id"),
                    "weapon_name": d.get("weapon_name") or (d.get("_id") or {}).get("weapon_name") or "Unknown",
                    "attempts": attempts,
                    "kills": kills,
                    "kill_rate": (kills / attempts) if attempts > 0 else 0.0,
                    "avg_bullets_per_attempt": (total_b / attempts) if attempts > 0 else 0.0,
                    "avg_damage_per_attempt": (total_dmg / attempts) if attempts > 0 else 0.0,
                }
            )

        # Recent attacks as attacker and as target (most recent first)
        recent_attacker = (
            await db.attack_attempts.find(
                {"attacker_id": user_id},
                {"_id": 0},
            )
            .sort("created_at", -1)
            .to_list(50)
        )
        recent_target = (
            await db.attack_attempts.find(
                {"target_id": user_id},
                {"_id": 0},
            )
            .sort("created_at", -1)
            .to_list(50)
        )

        return {
            "user": user,
            "attacker_summary": attacker_summary,
            "target_summary": target_summary,
            "top_weapons": top_weapons,
            "recent_as_attacker": recent_attacker,
            "recent_as_target": recent_target,
        }

    @router.get("/admin/attacks/logs")
    async def admin_attacks_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=1000),
        since: Optional[str] = Query(None, description="ISO created_at; return only attempts after this (for live refresh)"),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return raw attack_attempts for a user (as attacker or target).
        Full post data: who shot whom, outcome, bodyguard, bullets, location, etc.
        Use since= to fetch only new entries (e.g. for live refresh).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        key = (username or "").strip()
        user = await db.users.find_one(
            {"id": key},
            {"_id": 0, "id": 1, "username": 1},
        )
        if not user:
            # Exact username first (uses index), then case-insensitive regex
            user = await db.users.find_one(
                {"username": key},
                {"_id": 0, "id": 1, "username": 1},
            )
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one(
                {"username": pattern},
                {"_id": 0, "id": 1, "username": 1},
            )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        q = {"$or": [{"attacker_id": uid}, {"target_id": uid}]}
        if since:
            q["created_at"] = {"$gt": since}
        effective_limit = min(limit, 100) if since else limit
        docs = (
            await db.attack_attempts.find(q, {"_id": 0})
            .sort("created_at", -1)
            .to_list(effective_limit)
        )
        return {"username": user.get("username"), "logs": docs}

    @router.get("/admin/crimes/logs")
    async def admin_crimes_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return raw crime_events for a user (full post data).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one(
            {"id": key},
            {"_id": 0, "id": 1, "username": 1},
        )
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one(
                {"username": pattern},
                {"_id": 0, "id": 1, "username": 1},
            )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        docs = (
            await db.crime_events.find(
                {"user_id": uid},
                {"_id": 0},
            )
            .sort("at", -1)
            .to_list(limit)
            )
        return {"username": user.get("username"), "logs": docs}

    @router.get("/admin/gta/logs")
    async def admin_gta_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return raw gta_events for a user (full post data: option, car, success, jailed, etc.).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        cursor = db.gta_events.find({"user_id": uid}, {"_id": 0}).sort("at", -1).limit(limit)
        docs = await cursor.to_list(limit)
        for d in docs:
            if isinstance(d.get("at"), datetime):
                d["at"] = d["at"].isoformat()
        return {"username": user.get("username"), "logs": docs}

    @router.get("/admin/jail/logs")
    async def admin_jail_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return raw bust_events for a user (full post data: target, success, profit, NPC vs player).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        cursor = db.bust_events.find({"user_id": uid}, {"_id": 0}).sort("at", -1).limit(limit)
        docs = await cursor.to_list(limit)
        for d in docs:
            if isinstance(d.get("at"), datetime):
                d["at"] = d["at"].isoformat()
        return {"username": user.get("username"), "logs": docs}

    @router.get("/admin/bank/logs")
    async def admin_bank_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(100, ge=1, le=500),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return bank activity for a user: money transfers (sent/received) and interest deposits.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        transfers_cursor = db.money_transfers.find(
            {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]},
            {"_id": 0},
        ).sort("created_at", -1).limit(limit)
        deposits_cursor = db.bank_deposits.find(
            {"user_id": uid},
            {"_id": 0},
        ).sort("created_at", -1).limit(limit)
        transfers = await transfers_cursor.to_list(limit)
        deposits = await deposits_cursor.to_list(limit)
        for t in transfers:
            t["direction"] = "sent" if t.get("from_user_id") == uid else "received"
        return {
            "username": user.get("username"),
            "transfers": transfers,
            "deposits": deposits,
        }

    @router.get("/admin/stock/logs")
    async def admin_stock_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return stock_transactions for a user (buys, sells, shorts, covers).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        cursor = db.stock_transactions.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).limit(limit)
        docs = await cursor.to_list(limit)
        return {"username": user.get("username"), "logs": docs}

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
        if not _admin_or_mod(current_user):
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

    @router.get("/admin/cheat-detection/login-attempts")
    async def admin_cheat_login_attempts(
        limit: int = Query(200, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Suspicious login attempts: wrong password or unknown account
        from an IP that already has at least one other alive account.
        Admin or moderator.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = (
            db.suspicious_logins.find({}, {"_id": 0})
            .sort("at", -1)
            .limit(limit)
        )
        events = await cursor.to_list(limit)
        return {"events": events}

    @router.get("/admin/cheat-detection/duplicate-suspects")
    async def admin_cheat_duplicate_suspects(
        username: str = Query(None, description="Optional: filter by username contains"),
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
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

    @router.get("/admin/cheat-detection/same-device-different-ips")
    async def admin_cheat_same_device_different_ips(current_user: dict = Depends(get_current_user)):
        """
        Find users who share the same browser/device (last_user_agent) but use different IPs.
        Possible same device / multi-account with VPN or different networks.
        Admin or moderator only.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        users = await db.users.find(
            {"is_dead": {"$ne": True}, "last_user_agent": {"$exists": True, "$ne": None, "$ne": ""}},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "login_ips": 1, "last_login_ip": 1, "last_request_ip": 1, "last_user_agent": 1},
        ).to_list(10000)
        # Group by exact last_user_agent
        ua_to_users = {}
        for u in users:
            ua = (u.get("last_user_agent") or "").strip()
            if not ua:
                continue
            ips = set()
            for key in ("registration_ip", "last_login_ip", "last_request_ip"):
                v = (u.get(key) or "").strip()
                if v:
                    ips.add(v)
            for lip in (u.get("login_ips") or []):
                lip = (lip or "").strip()
                if lip:
                    ips.add(lip)
            summary = {
                "id": u["id"],
                "username": u.get("username"),
                "email": u.get("email"),
                "ips": sorted(ips),
            }
            ua_to_users.setdefault(ua, []).append(summary)
        # Only groups with 2+ users and at least 2 distinct IPs across the group
        groups = []
        for ua, accs in ua_to_users.items():
            if len(accs) < 2:
                continue
            all_ips = set()
            for a in accs:
                all_ips.update(a["ips"])
            if len(all_ips) < 2:
                continue
            groups.append({
                "user_agent": ua[:120] + ("..." if len(ua) > 120 else ""),
                "user_agent_full": ua,
                "users": accs,
                "account_count": len(accs),
                "distinct_ip_count": len(all_ips),
            })
        groups.sort(key=lambda g: -g["account_count"])
        return {"groups": groups[:80], "total_groups": len(groups)}

    @router.get("/admin/users/search")
    async def admin_search_users(
        q: str = Query(..., min_length=1, max_length=100),
        limit: int = Query(50, ge=1, le=100),
        current_user: dict = Depends(get_current_user),
    ):
        """Search users by username or email (substring, case-insensitive). Admin or moderator. Returns id, username, email, is_dead, created_at."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        q_clean = (q or "").strip()
        if not q_clean:
            return {"users": []}
        pattern = re.compile(re.escape(q_clean), re.IGNORECASE)
        cursor = db.users.find(
            {"$or": [{"username": {"$regex": pattern}}, {"email": {"$regex": pattern}}]},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "created_at": 1},
        ).limit(limit)
        raw = await cursor.to_list(limit)
        users = [
            {"id": u.get("id"), "username": u.get("username"), "email": u.get("email"), "is_dead": bool(u.get("is_dead")), "created_at": u.get("created_at")}
            for u in raw
        ]
        return {"users": users}

    @router.get("/admin/users/list")
    async def admin_list_users(
        filter_type: str = Query("all", description="all | alive | dead | npc | non_npc"),
        sort: str = Query("username_asc", description="username_asc | username_desc | alive_first | dead_first | npc_first | non_npc_first | created_asc | created_desc"),
        limit: int = Query(500, ge=1, le=2000),
        skip: int = Query(0, ge=0),
        current_user: dict = Depends(get_current_user),
    ):
        """List all registered users. Admin only. Filter by alive/dead/npc/non_npc and sort."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        query = {}
        if filter_type == "alive":
            query["is_dead"] = {"$ne": True}
        elif filter_type == "dead":
            query["is_dead"] = True
        elif filter_type == "npc":
            query["is_bodyguard"] = True
        elif filter_type == "non_npc":
            query["$or"] = [{"is_bodyguard": {"$ne": True}}, {"is_bodyguard": {"$exists": False}}]
        # else "all" -> no filter

        sort_spec = []
        if sort == "username_asc":
            sort_spec = [("username", 1)]
        elif sort == "username_desc":
            sort_spec = [("username", -1)]
        elif sort == "alive_first":
            sort_spec = [("is_dead", 1), ("username", 1)]  # false first, then true
        elif sort == "dead_first":
            sort_spec = [("is_dead", -1), ("username", 1)]
        elif sort == "npc_first":
            sort_spec = [("is_bodyguard", -1), ("username", 1)]  # true first
        elif sort == "non_npc_first":
            sort_spec = [("is_bodyguard", 1), ("username", 1)]  # false first (asc)
        elif sort == "created_asc":
            sort_spec = [("created_at", 1)]
        elif sort == "created_desc":
            sort_spec = [("created_at", -1)]
        else:
            sort_spec = [("username", 1)]

        cursor = db.users.find(
            query,
            {"_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "is_bodyguard": 1, "created_at": 1, "email_verified": 1},
        ).sort(sort_spec).skip(skip).limit(limit)
        raw = await cursor.to_list(limit)
        total = await db.users.count_documents(query)
        users = [
            {
                "id": u.get("id"),
                "username": u.get("username"),
                "email": u.get("email"),
                "is_dead": bool(u.get("is_dead")),
                "is_bodyguard": bool(u.get("is_bodyguard")),
                "created_at": u.get("created_at"),
                "email_verified": bool(u.get("email_verified", True)),
            }
            for u in raw
        ]
        return {"users": users, "total": total, "count": len(users)}

    @router.get("/admin/user-registration")
    async def admin_user_registration(target_username: str, current_user: dict = Depends(get_current_user)):
        """Get a user's registration info (email, username, created_at, IPs) by username. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        user = await db.users.find_one(
            {"username": username_pattern},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "created_at": 1, "registration_ip": 1, "last_login_ip": 1, "login_ips": 1, "is_dead": 1},
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return {"user": user}

    @router.get("/admin/user-inspect")
    async def admin_user_inspect(email: str = Query(..., description="User's email (to diagnose login 500)"), current_user: dict = Depends(get_current_user)):
        """Inspect a user document by email: returns keys and value types (no secrets). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        import re
        email_clean = (email or "").strip().lower()
        if not email_clean:
            raise HTTPException(status_code=400, detail="email query param required")
        pattern = re.compile("^" + re.escape(email_clean) + "$", re.IGNORECASE)
        user = await db.users.find_one({"email": pattern}, {"_id": 0, "password_hash": 0})
        if not user:
            return {"found": False, "email": email_clean, "message": "No user with this email."}
        keys = list(user.keys())
        value_types = {}
        for k, v in user.items():
            if v is None:
                value_types[k] = "null"
            elif isinstance(v, datetime):
                value_types[k] = "datetime"
            elif isinstance(v, bool):
                value_types[k] = "bool"
            elif isinstance(v, (int, float)):
                value_types[k] = "number"
            elif isinstance(v, str):
                value_types[k] = "str"
            elif isinstance(v, list):
                value_types[k] = f"list(len={len(v)})"
            elif isinstance(v, dict):
                value_types[k] = "dict"
            else:
                value_types[k] = type(v).__name__
        has_id = "id" in user
        id_type = value_types.get("id", "missing")
        return {
            "found": True,
            "email": email_clean,
            "username": user.get("username"),
            "user_id": user.get("id"),
            "has_id": has_id,
            "id_type": id_type,
            "last_device_type": user.get("last_device_type"),
            "last_user_agent": user.get("last_user_agent"),
            "keys": sorted(keys),
            "value_types": value_types,
        }

    @router.get("/admin/user-details/{user_id}")
    async def admin_user_details(user_id: str, current_user: dict = Depends(get_current_user)):
        """View user document and all casino ownerships. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "password_hash": 0},
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        dice_owned = await db.dice_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        roulette_owned = await db.roulette_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        blackjack_owned = await db.blackjack_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        horseracing_owned = await db.horseracing_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        videopoker_owned = await db.videopoker_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        slots_owned = await db.slots_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        casinos_owned = []
        for d in dice_owned:
            casinos_owned.append({"game_type": "dice", "location": d.get("city") or "?"})
        for d in roulette_owned:
            casinos_owned.append({"game_type": "roulette", "location": d.get("city") or "?"})
        for d in blackjack_owned:
            casinos_owned.append({"game_type": "blackjack", "location": d.get("city") or "?"})
        for d in horseracing_owned:
            casinos_owned.append({"game_type": "horseracing", "location": d.get("city") or "?"})
        for d in videopoker_owned:
            casinos_owned.append({"game_type": "videopoker", "location": d.get("city") or "?"})
        for d in slots_owned:
            casinos_owned.append({"game_type": "slots", "location": d.get("state") or "?"})
        return {"user": user, "dice_owned": dice_owned, "casinos_owned": casinos_owned}

    @router.post("/admin/drop-user-casino")
    async def admin_drop_user_casino(body: DropUserCasinoRequest, current_user: dict = Depends(get_current_user)):
        """Remove one casino from a user (ownership becomes unowned). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        game_type = (body.game_type or "").strip().lower()
        location = (body.location or "").strip()
        if not location:
            raise HTTPException(status_code=400, detail="location is required")
        user_id = (body.user_id or "").strip()
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id is required")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        coll_map = {
            "dice": (db.dice_ownership, "city"),
            "roulette": (db.roulette_ownership, "city"),
            "blackjack": (db.blackjack_ownership, "city"),
            "horseracing": (db.horseracing_ownership, "city"),
            "videopoker": (db.videopoker_ownership, "city"),
            "slots": (db.slots_ownership, "state"),
        }
        if game_type not in coll_map:
            raise HTTPException(status_code=400, detail="Invalid game_type; use dice, roulette, blackjack, horseracing, videopoker, or slots")
        coll, loc_key = coll_map[game_type]
        res = await coll.update_one(
            {"owner_id": user_id, loc_key: location},
            {"$set": {"owner_id": None, "owner_username": None}},
        )
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail=f"No {game_type} casino in {location} owned by this user")
        return {"message": f"Dropped {game_type} casino ({location}) from user", "matched": res.matched_count, "modified": res.modified_count}

    _CASINO_PROPERTY_COLLECTIONS = [
        (db.dice_ownership, "dice_ownership"),
        (db.roulette_ownership, "roulette_ownership"),
        (db.blackjack_ownership, "blackjack_ownership"),
        (db.horseracing_ownership, "horseracing_ownership"),
        (db.videopoker_ownership, "videopoker_ownership"),
        (db.slots_ownership, "slots_ownership"),
        (db.airport_ownership, "airport_ownership"),
        (db.bullet_factory, "bullet_factory"),
    ]

    @router.post("/admin/drop-user-casinos-properties")
    async def admin_drop_user_casinos_properties(body: DropUserCasinosPropertiesRequest, current_user: dict = Depends(get_current_user)):
        """Drop all casinos and properties for a single user (ownership becomes unclaimed). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator required")
        user_id = (body.user_id or "").strip()
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id is required")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        unset = {"$set": {"owner_id": None, "owner_username": None}}
        result = {}
        for coll, name in _CASINO_PROPERTY_COLLECTIONS:
            res = await coll.update_many({"owner_id": user_id}, unset)
            result[name] = res.modified_count
        total = sum(result.values())
        logging.info(f"Admin drop user casinos/properties: user_id={user_id} by {current_user.get('email')}, modified={result}")
        return {"message": f"Dropped all casinos and properties for user", "user_id": user_id, "details": result, "total_modified": total}

    @router.post("/admin/drop-all-casinos-properties")
    async def admin_drop_all_casinos_properties(confirm: DropAllCasinosPropertiesConfirmation, current_user: dict = Depends(get_current_user)):
        """Drop all casinos and properties globally (every ownership becomes unclaimed). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if confirm.confirmation_text != "DROP ALL CASINOS PROPERTIES":
            raise HTTPException(
                status_code=400,
                detail='Confirmation required. Send {"confirmation_text": "DROP ALL CASINOS PROPERTIES"} to confirm.'
            )
        unset = {"$set": {"owner_id": None, "owner_username": None}}
        result = {}
        for coll, name in _CASINO_PROPERTY_COLLECTIONS:
            res = await coll.update_many({}, unset)
            result[name] = res.modified_count
        total = sum(result.values())
        logging.warning(f"Drop all casinos/properties by {current_user.get('email')} ({current_user.get('username')}), modified={result}")
        return {"message": f"Dropped all casinos and properties: {total} ownerships cleared", "details": result, "total_modified": total}

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
        deleted["slots_ownership"] = (await db.slots_ownership.delete_many({})).deleted_count
        deleted["slots_entries"] = (await db.slots_entries.delete_many({})).deleted_count
        deleted["slots_buy_back_offers"] = (await db.slots_buy_back_offers.delete_many({})).deleted_count
        deleted["interest_deposits"] = (await db.interest_deposits.delete_many({})).deleted_count
        deleted["password_resets"] = (await db.password_resets.delete_many({})).deleted_count
        deleted["money_transfers"] = (await db.money_transfers.delete_many({})).deleted_count
        deleted["bank_deposits"] = (await db.bank_deposits.delete_many({})).deleted_count
        total = sum(deleted.values())
        logging.warning(f"🚨 DATABASE WIPE completed by {current_user['email']}: {total} documents deleted")
        return {"message": f"⚠️ DATABASE WIPED: {total} documents deleted from the game", "details": deleted}

    @router.post("/admin/database-fresh")
    async def admin_database_fresh(confirm: NewReleaseConfirmation, current_user: dict = Depends(get_current_user)):
        """Wipe the entire database and re-seed game data so the game starts from the very beginning (new release)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if confirm.confirmation_text != "NEW RELEASE":
            raise HTTPException(
                status_code=400,
                detail='Confirmation required. Send {"confirmation_text": "NEW RELEASE"} to confirm full database reset.'
            )
        logging.warning(f"🚨 DATABASE FRESH / NEW RELEASE initiated by {current_user['email']} ({current_user['username']})")
        # All collections that hold game state or user data (wipe everything then re-seed config)
        collections_to_wipe = [
            "users", "family_members", "families", "family_wars", "family_war_stats", "family_racket_attacks",
            "family_crew_oc_applications", "bodyguards", "bodyguard_invites", "user_cars", "user_properties",
            "user_weapons", "attacks", "attack_attempts", "notifications", "extortions", "sports_bets", "sports_events",
            "blackjack_games", "blackjack_buy_back_offers", "blackjack_ownership", "dice_ownership", "dice_buy_back_offers",
            "roulette_ownership", "horseracing_ownership", "videopoker_ownership", "videopoker_games",
            "slots_ownership", "slots_entries", "slots_buy_back_offers", "interest_deposits", "password_resets",
            "money_transfers", "bank_deposits", "bullet_factory", "airport_ownership", "hitlist",
            "user_organised_crime", "oc_pending_heists", "oc_invites", "user_crimes", "jail_npcs", "bust_events",
            "test_npcs", "crimes", "weapons", "properties", "game_config", "game_settings",
            "forum_topics", "forum_comments", "forum_comment_likes", "trade_sell_offers", "trade_buy_offers",
            "dealer_stock", "user_gta", "gta_cooldowns", "safe_game", "safe_daily",
            "security_flags", "security_logs", "bans", "ip_bans", "activity_log", "gambling_log",
            "entertainer_games", "payment_transactions", "email_verifications", "login_lockouts",
            "war_kill_feed", "crime_earnings", "crime_events", "profile_load_errors",
        ]
        deleted = {}
        for coll_name in collections_to_wipe:
            try:
                res = await db[coll_name].delete_many({})
                deleted[coll_name] = res.deleted_count
            except Exception as e:
                logging.warning("database-fresh: skip %s: %s", coll_name, e)
                deleted[coll_name] = 0
        total = sum(deleted.values())
        # Re-seed game data (weapons, properties, crimes) and ensure indexes
        try:
            await srv.init_game_data()
            from ensure_indexes import ensure_all_indexes
            await ensure_all_indexes(db)
        except Exception as e:
            logging.exception("database-fresh: re-seed/indexes failed: %s", e)
            return {
                "message": f"Database wiped ({total} documents deleted) but re-seed failed: {e}",
                "details": deleted,
                "reseed_ok": False,
            }
        logging.warning(f"🚨 DATABASE FRESH completed by {current_user['email']}: {total} docs deleted, game data re-seeded")
        return {
            "message": f"Database reset complete. {total} documents deleted. Game data re-seeded. New release ready.",
            "details": deleted,
            "reseed_ok": True,
        }

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
        deleted["slots_ownership"] = (await db.slots_ownership.update_many({"owner_id": user_id}, {"$set": {"owner_id": None, "owner_username": None}})).modified_count
        await db.slots_entries.update_many({}, {"$pull": {"user_ids": user_id}})
        deleted["slots_buy_back_offers"] = (await db.slots_buy_back_offers.delete_many({"$or": [{"from_owner_id": user_id}, {"to_user_id": user_id}]})).deleted_count
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

    @router.post("/admin/create-test-users")
    async def admin_create_test_users(current_user: dict = Depends(get_current_user)):
        """Create 30 real (non-NPC) test users with random ranks, in crews, owning available casinos and properties. Password: test1234."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.dice import DICE_MAX_BET
        from routers.roulette import ROULETTE_MAX_BET
        from routers.blackjack import BLACKJACK_DEFAULT_MAX_BET
        from routers.horseracing import HORSERACING_MAX_BET
        from routers.video_poker import VIDEO_POKER_DEFAULT_MAX_BET
        from routers.airport import AIRPORT_SLOTS_PER_STATE, AIRPORT_COST

        COUNT = 30
        FAMILY_SIZE = 5
        NUM_FAMILIES = (COUNT + FAMILY_SIZE - 1) // FAMILY_SIZE
        ROLES = ["boss", "underboss", "consigliere", "capo", "soldier"]
        TEST_PASSWORD = "test1234"
        # Vary auto-rank sub-settings per user (all get auto_rank_enabled + auto_rank_purchased)
        AUTO_RANK_PRESETS = [
            {"auto_rank_crimes": True, "auto_rank_gta": False, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": False, "auto_rank_booze": False},
            {"auto_rank_crimes": False, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": False, "auto_rank_booze": False},
            {"auto_rank_crimes": True, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": False, "auto_rank_booze": False},
            {"auto_rank_crimes": True, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": True, "auto_rank_booze": False},
            {"auto_rank_crimes": True, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": False, "auto_rank_booze": True},
            {"auto_rank_crimes": True, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": True, "auto_rank_oc": False, "auto_rank_booze": False},
        ]
        password_hash = get_password_hash(TEST_PASSWORD)
        now_dt = datetime.now(timezone.utc)
        now = now_dt.isoformat()
        forced_online_until = (now_dt + timedelta(hours=1)).isoformat()
        created_users = []
        created_families = []
        user_pool = []  # list of (user_id, username) for assigning ownership
        user_index = [0]

        for f in range(NUM_FAMILIES):
            family_id = str(uuid.uuid4())
            name = f"TestCrew{f+1}"
            tag = f"T{f+1:02d}"
            members = []
            for i in range(FAMILY_SIZE):
                if len(created_users) >= COUNT:
                    break
                user_id = str(uuid.uuid4())
                role = ROLES[i % len(ROLES)]
                username = f"test_{tag}_{role}_{i}"
                email = f"test{tag}{i}@test.mafia"
                if await db.users.find_one({"$or": [{"email": email}, {"username": username}]}):
                    continue
                rank_id = random.randint(1, len(RANKS))
                rank_def = RANKS[rank_id - 1]
                req = int(rank_def["required_points"])
                if rank_id < len(RANKS):
                    next_req = int(RANKS[rank_id]["required_points"])
                    rank_points = random.randint(req, min(req + max(1, (next_req - req) // 2), next_req - 1))
                else:
                    rank_points = random.randint(req, req + 50000)
                preset = AUTO_RANK_PRESETS[user_index[0] % len(AUTO_RANK_PRESETS)]
                user_index[0] += 1
                user_doc = {
                    "id": user_id,
                    "email": email,
                    "username": username,
                    "password_hash": password_hash,
                    "rank": rank_id,
                    "money": 500_000.0,
                    "points": 100,
                    "rank_points": rank_points,
                    "bodyguard_slots": 0,
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
                    "current_state": random.choice(STATES) if STATES else "Chicago",
                    "swiss_balance": 0,
                    "swiss_limit": SWISS_BANK_LIMIT_START,
                    "total_kills": 0,
                    "total_deaths": 0,
                    "in_jail": False,
                    "jail_until": None,
                    "premium_rank_bar": False,
                    "has_silencer": False,
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
                    "forced_online_until": forced_online_until,
                    "auto_rank_purchased": True,
                    "auto_rank_enabled": True,
                    **preset,
                }
                await db.users.insert_one(user_doc)
                created_users.append({"username": username, "email": email, "rank": rank_id, "family": name})
                user_pool.append((user_id, username))
                members.append((user_id, role))
            if not members:
                continue
            first_racket_id = FAMILY_RACKETS[0]["id"]
            rackets = {first_racket_id: {"level": 1, "last_collected_at": None}}
            await db.families.insert_one({
                "id": family_id,
                "name": name,
                "tag": tag,
                "boss_id": members[0][0],
                "treasury": 50_000,
                "created_at": now,
                "rackets": rackets,
            })
            created_families.append({"name": name, "tag": tag})
            for user_id, role in members:
                await db.family_members.insert_one({
                    "id": str(uuid.uuid4()),
                    "family_id": family_id,
                    "user_id": user_id,
                    "role": role,
                    "joined_at": now,
                })
                await db.users.update_one({"id": user_id}, {"$set": {"family_id": family_id, "family_role": role}})

        # Assign unowned casino tables (each user at most one)
        casino_slots = []
        for city in (STATES or []):
            for game_type, coll, max_bet in [
                ("dice", db.dice_ownership, DICE_MAX_BET),
                ("roulette", db.roulette_ownership, ROULETTE_MAX_BET),
                ("blackjack", db.blackjack_ownership, BLACKJACK_DEFAULT_MAX_BET),
                ("horseracing", db.horseracing_ownership, HORSERACING_MAX_BET),
                ("videopoker", db.videopoker_ownership, VIDEO_POKER_DEFAULT_MAX_BET),
            ]:
                doc = await coll.find_one({"city": city}, {"_id": 0, "owner_id": 1})
                if not doc or not doc.get("owner_id"):
                    casino_slots.append((city, game_type, coll, max_bet))
        casino_assigned = set()
        for idx, (city, game_type, coll, max_bet) in enumerate(casino_slots):
            if idx >= len(user_pool):
                break
            user_id, username = user_pool[idx]
            if user_id in casino_assigned:
                continue
            if game_type == "dice":
                await coll.update_one(
                    {"city": city},
                    {"$set": {"owner_id": user_id, "owner_username": username, "max_bet": max_bet, "buy_back_reward": 0, "profit": 0}},
                    upsert=True,
                )
            elif game_type == "roulette":
                await coll.update_one(
                    {"city": city},
                    {"$set": {"owner_id": user_id, "owner_username": username, "max_bet": max_bet, "total_earnings": 0}},
                    upsert=True,
                )
            elif game_type in ("blackjack", "horseracing", "videopoker"):
                extra = {"buy_back_reward": 0} if game_type == "blackjack" else {}
                await coll.update_one(
                    {"city": city},
                    {"$set": {"owner_id": user_id, "owner_username": username, "max_bet": max_bet, "total_earnings": 0, "profit": 0, **extra}},
                    upsert=True,
                )
            casino_assigned.add(user_id)

        # Assign unowned airport slots (each user at most one property)
        property_assigned = set()
        for state in (STATES or []):
            for slot in range(1, AIRPORT_SLOTS_PER_STATE + 1):
                doc = await db.airport_ownership.find_one({"state": state, "slot": slot}, {"_id": 0, "owner_id": 1})
                if not doc:
                    await db.airport_ownership.insert_one({
                        "state": state, "slot": slot, "owner_id": None, "owner_username": None, "price_per_travel": AIRPORT_COST,
                    })
                    doc = {}
                if doc.get("owner_id"):
                    continue
                for user_id, username in user_pool:
                    if user_id in property_assigned:
                        continue
                    await db.airport_ownership.update_one(
                        {"state": state, "slot": slot},
                        {"$set": {"owner_id": user_id, "owner_username": username}},
                    )
                    property_assigned.add(user_id)
                    break

        # Assign unowned bullet factories
        for state in (STATES or []):
            doc = await db.bullet_factory.find_one({"state": state}, {"_id": 0, "owner_id": 1})
            if not doc:
                await db.bullet_factory.insert_one({
                    "state": state,
                    "owner_id": None,
                    "owner_username": None,
                    "last_collected_at": now,
                    "price_per_bullet": None,
                    "unowned_price": random.randint(2500, 4000),
                })
                doc = {}
            if doc.get("owner_id"):
                continue
            for user_id, username in user_pool:
                if user_id in property_assigned:
                    continue
                await db.bullet_factory.update_one(
                    {"state": state},
                    {"$set": {"owner_id": user_id, "owner_username": username}},
                )
                property_assigned.add(user_id)
                break

        return {
            "message": f"Created {len(created_users)} test users in {len(created_families)} crews. Assigned available casinos and properties. Password: test1234",
            "users": created_users,
            "families": created_families,
        }

    def _test_users_filter():
        """Users created by Create 30 test users: username test_* or email *@test.mafia."""
        return {
            "is_dead": {"$ne": True},
            "$or": [
                {"username": re.compile(r"^test_", re.IGNORECASE)},
                {"email": re.compile(r"@test\.mafia$", re.IGNORECASE)},
            ],
        }

    @router.post("/admin/test-users-auto-rank")
    async def admin_test_users_auto_rank(request: TestUsersAutoRankRequest, current_user: dict = Depends(get_current_user)):
        """Enable or disable auto-rank for all test users (username test_* or email *@test.mafia)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = request.enabled
        updates = {"auto_rank_enabled": enabled}
        if not enabled:
            updates["auto_rank_crimes"] = False
            updates["auto_rank_gta"] = False
            updates["auto_rank_bust_every_5_sec"] = False
            updates["auto_rank_oc"] = False
            updates["auto_rank_booze"] = False
            op = {"$set": updates, "$unset": {"auto_rank_stats_since": ""}}
        else:
            op = {"$set": updates}
        res = await db.users.update_many(_test_users_filter(), op)
        return {
            "message": f"Auto-rank {'enabled' if enabled else 'disabled'} for all test users.",
            "enabled": enabled,
            "updated_count": res.modified_count,
        }

    def _seeded_users_filter():
        """Users from Seed Families (Corleone, Baranco, Stracci): username corl_*, barn_*, strc_*."""
        return {
            "is_dead": {"$ne": True},
            "$or": [
                {"username": re.compile(r"^corl_", re.IGNORECASE)},
                {"username": re.compile(r"^barn_", re.IGNORECASE)},
                {"username": re.compile(r"^strc_", re.IGNORECASE)},
            ],
        }

    @router.post("/admin/seeded-users-auto-rank")
    async def admin_seeded_users_auto_rank(request: TestUsersAutoRankRequest, current_user: dict = Depends(get_current_user)):
        """Enable or disable auto-rank for all seeded family users (Corleone, Baranco, Stracci)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = request.enabled
        updates = {"auto_rank_enabled": enabled}
        if not enabled:
            updates["auto_rank_crimes"] = False
            updates["auto_rank_gta"] = False
            updates["auto_rank_bust_every_5_sec"] = False
            updates["auto_rank_oc"] = False
            updates["auto_rank_booze"] = False
            op = {"$set": updates, "$unset": {"auto_rank_stats_since": ""}}
        else:
            op = {"$set": updates}
        res = await db.users.update_many(_seeded_users_filter(), op)
        return {
            "message": f"Auto-rank {'enabled' if enabled else 'disabled'} for all seeded users.",
            "enabled": enabled,
            "updated_count": res.modified_count,
        }
