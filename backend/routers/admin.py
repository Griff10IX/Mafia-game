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


class EventsToggleRequest(BaseModel):
    enabled: bool


class AllEventsForTestingRequest(BaseModel):
    enabled: bool


class AdminSettingsUpdate(BaseModel):
    admin_online_color: Optional[str] = None
    require_email_verification: Optional[bool] = None


class TestUsersAutoRankRequest(BaseModel):
    enabled: bool


class AdminChangeEmailRequest(BaseModel):
    new_email: str


class AdminSetPasswordRequest(BaseModel):
    new_password: str


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
    async def admin_lock_player(target_username: str, lock_minutes: int = 0, current_user: dict = Depends(get_current_user)):
        """Lock account for investigation: user can only access /locked page and submit one comment until unlocked. lock_minutes ignored (kept for API compat)."""
        if not _is_admin(current_user):
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
        """Unlock an account that was locked for investigation."""
        if not _is_admin(current_user):
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
        """List users currently locked for investigation (username, comment, dates)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.users.find(
            {"account_locked": True},
            {"_id": 0, "username": 1, "account_locked_at": 1, "account_locked_until": 1, "account_locked_comment": 1, "account_locked_comment_at": 1, "account_locked_admin_message": 1, "account_locked_admin_message_at": 1, "account_locked_user_reply": 1, "account_locked_user_reply_at": 1},
        )
        users = await cursor.to_list(100)
        return {"locked": users}

    @router.post("/admin/test-lock-self")
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
        """Leave a message for a locked user; they see it on the locked page and can reply once."""
        if not _is_admin(current_user):
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
        try:
            from routers.families import maybe_promote_after_boss_death
            await maybe_promote_after_boss_death(target["id"])
        except Exception as e:
            logging.exception("Promote after boss death: %s", e)
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
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if not target.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is not dead")
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {
                "is_dead": False,
                "dead_at": None,
                "health": DEFAULT_HEALTH,
                "money": 1000,
            }}
        )
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
        """List current login lockouts (too many failed attempts). Shows email, failed count, locked until, and username if account exists."""
        if not _is_admin(current_user):
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
        """Clear login lockout for a user (by their current email), so they can try logging in again."""
        if not _is_admin(current_user):
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
        """Clear login lockout for an email (e.g. from the login-issues list). Use when you don't know the username."""
        if not _is_admin(current_user):
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
        req_doc = await db.game_settings.find_one({"key": "require_email_verification"}, {"_id": 0, "value": 1})
        require_email_verification = bool(req_doc.get("value") if req_doc else False)
        return {"admin_online_color": admin_online_color.strip(), "require_email_verification": require_email_verification}

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
        if body.require_email_verification is not None:
            await db.game_settings.update_one(
                {"key": "require_email_verification"},
                {"$set": {"value": body.require_email_verification}},
                upsert=True,
            )
        doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (doc.get("value") or "#a78bfa") if doc else "#a78bfa"
        req_doc = await db.game_settings.find_one({"key": "require_email_verification"}, {"_id": 0, "value": 1})
        require_email_verification = bool(req_doc.get("value") if req_doc else False)
        return {"admin_online_color": admin_online_color, "require_email_verification": require_email_verification}

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

    @router.get("/admin/user-registration")
    async def admin_user_registration(target_username: str, current_user: dict = Depends(get_current_user)):
        """Get a user's registration info (email, username, created_at, IPs) by username. Safe for admin view."""
        if not _is_admin(current_user):
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
        """Inspect a user document by email: returns keys and value types (no secrets). Use to compare a user who gets login 500 with a working one."""
        if not _is_admin(current_user):
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
            "keys": sorted(keys),
            "value_types": value_types,
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
