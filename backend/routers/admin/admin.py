# Admin: ghost mode, act-as-normal, change-rank, add-points, give-all, add-car,
# security (summary, flags, rate-limits, telegram, clear), hitlist reset,
# force-online, lock/kill player, search time, clear searches, check, activity/gambling log,
# find-duplicates, cheat-detection, user-details, wipe, delete-user, events, seed-families, create-test-users.
import asyncio
import logging
import os
import random
import re
import uuid
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple

import httpx
from fastapi import Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from middleware.security import is_proxy_or_vpn
from utils.disposable_email import is_disposable_email
from utils.cheat_detection_utils import (
    group_by_domain,
    group_by_similar_username_strip_digits,
    group_by_fuzzy_username,
    group_by_similar_email,
    group_by_same_day_same_ip,
    group_by_same_subnet,
    group_by_registration_ip_burst,
    group_by_referral_same_ip,
    user_ip_union,
    compute_dupe_risk_score,
)
from routers.kill.armoury import TOKEN_CONFIG

# Cloudflare API config for bot blocking toggle
CF_ZONE_ID = os.environ.get("CF_ZONE_ID", "")
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "")

# Mod-visible admin categories: which Admin Tool categories moderators can see (configurable by admin)
MOD_VISIBLE_CATEGORY_IDS_DEFAULT = ["admin-cheat", "admin-logs", "admin-staff", "admin-mod-tools"]
ADMIN_CATEGORY_IDS = {
    "admin-players", "admin-gameworld", "admin-security", "admin-cheat", "admin-analytics",
    "admin-logs", "admin-testing", "admin-quick", "admin-database", "admin-staff", "admin-mod-tools",
}


class WipeConfirmation(BaseModel):
    confirmation_text: str  # Must be exactly "WIPE ALL DATA"


class NewReleaseConfirmation(BaseModel):
    confirmation_text: str  # Must be exactly "NEW RELEASE"


class EventsToggleRequest(BaseModel):
    enabled: bool


class AllEventsForTestingRequest(BaseModel):
    enabled: bool


class ToggleEventRequest(BaseModel):
    event_id: str
    enabled: bool


class RandomEventRequest(BaseModel):
    """If event_ids is omitted or empty, pick from all events. Otherwise pick from the given ids only."""
    event_ids: Optional[List[str]] = None


class RedeemCodeRewards(BaseModel):
    money: Optional[int] = None
    points: Optional[int] = None
    respect_points: Optional[int] = None
    loot_box_pieces: Optional[int] = None
    cars: Optional[List[str]] = None
    tokens: Optional[Dict[str, int]] = None  # token_type -> amount


class RedeemCodeCreateRequest(BaseModel):
    code: str
    max_uses: Optional[int] = None  # null = unlimited
    rewards: RedeemCodeRewards = Field(default_factory=RedeemCodeRewards)


class RedeemCodePatchRequest(BaseModel):
    active: bool


class BetaSignupToggleRequest(BaseModel):
    enabled: bool


class AdminSettingsUpdate(BaseModel):
    admin_online_color: Optional[str] = None
    mod_default_online_color: Optional[str] = None  # default colour for Mod on Users Online (mods can override on profile)
    require_email_verification: Optional[bool] = None
    stock_market_max_points: Optional[int] = None
    landing_banner_enabled: Optional[bool] = None
    landing_banner_message: Optional[str] = None
    login_lock_until: Optional[str] = None  # ISO datetime - block logins until this date
    login_lock_message: Optional[str] = None  # Custom message shown on login page during lock
    preregister_landing_banner_enabled: Optional[bool] = None  # Slim banner on / login when login lock active (founding / ref info)
    preregister_landing_banner_preview_open: Optional[bool] = None  # Show same strip while logins are open (staff preview)
    preorder_points_release_date: Optional[str] = None  # ISO datetime - points held until this date
    store_points_auto_credit: Optional[bool] = None  # False = staff credits store points manually after payment
    store_points_manual_credit_eta: Optional[str] = None  # ISO datetime shown to users (informational)
    casino_global_max_bet: Optional[int] = None  # Max bet cap for all casinos (default 1B)
    casino_buyback_max_points: Optional[int] = None  # Max points for buy-back reward (default 15000)
    mp_poker_max_blind: Optional[int] = None  # Max MP poker small blind cap (default 2.5M)
    mod_visible_category_ids: Optional[List[str]] = None  # Admin Tool category ids visible to moderators


class TestUsersAutoRankRequest(BaseModel):
    enabled: bool


class GTAExclusivePoolRequest(BaseModel):
    """Release or retract the Al Capone exclusive (car20) into the GTA car pool. Only 1 in game at a time; when released, very rare drop."""
    released: bool
    drop_weight: Optional[float] = None


class GiveEveryoneExclusiveCarsRequest(BaseModel):
    """Give every user a car they don't already have. loot_exclusive = car21, al_capone = car20."""
    loot_exclusive: bool = False
    al_capone: bool = False


class AdminChangeEmailRequest(BaseModel):
    new_email: str


class AdminSetPasswordRequest(BaseModel):
    new_password: str


class AdminRevokeSessionRequest(BaseModel):
    target_username: str
    session_id: str


class AdminRevokeOldSessionsRequest(BaseModel):
    """Optional target_username: if set, only revoke old sessions for that user; otherwise all users."""
    target_username: Optional[str] = None


class DropUserCasinoRequest(BaseModel):
    user_id: str
    game_type: str  # dice, roulette, blackjack, horseracing, videopoker, slots
    location: str   # city for most, state for slots


class DropUserCasinosPropertiesRequest(BaseModel):
    user_id: str


class DropAllCasinosPropertiesConfirmation(BaseModel):
    confirmation_text: str  # "DROP ALL CASINOS PROPERTIES"


class DeleteFamilyRequest(BaseModel):
    family_id: str


class WipeAllFamiliesConfirmation(BaseModel):
    confirmation_text: str  # "WIPE ALL FAMILIES"


class AdminSetCasinoMaxBetRequest(BaseModel):
    game_type: str  # dice, roulette, blackjack, horseracing, videopoker, slots, or "all"
    location: Optional[str] = None  # city/state; if None, applies to all locations for that game type
    max_bet: int


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


# Up to MAX_FAMILIES seed configs; each created only if no family with that name/tag exists.
SEED_FAMILIES_CONFIG = [
    {"name": "Corleone", "tag": "CORL"},
    {"name": "Baranco", "tag": "BARN"},
    {"name": "Stracci", "tag": "STRC"},
    {"name": "Tattaglia", "tag": "TATT"},
    {"name": "Cuneo", "tag": "CUNO"},
    {"name": "Bruno", "tag": "BRUN"},
    {"name": "Molinaro", "tag": "MOLI"},
    {"name": "Zaluchi", "tag": "ZALU"},
    {"name": "Falcone", "tag": "FALC"},
    {"name": "Mariposa", "tag": "MARI"},
]
SEED_RANK_POINTS_BY_ROLE = {"boss": 24000, "underboss": 12000, "consigliere": 6000, "capo": 3000, "soldier": 1000, "associate": 500}
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
    import middleware.security as security_module
    from routers.game.families import FAMILY_RACKETS, MAX_FAMILIES
    from routers.kill.bodyguards import _create_robot_bodyguard_user
    from routers.social.forum import create_redeem_code_forum_topic, remove_redeem_code_forum_topic

    db = srv.db
    get_current_user = srv.get_current_user
    send_notification = srv.send_notification
    send_notification_to_all = srv.send_notification_to_all
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
    get_disabled_event_ids = srv.get_disabled_event_ids
    get_active_game_event_async = srv.get_active_game_event_async
    get_override_event_id = srv.get_override_event_id
    GAME_EVENTS = srv.GAME_EVENTS

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

    @router.post("/admin/set-founding-member")
    async def admin_set_founding_member(
        target_username: str,
        is_founding: bool = True,
        current_user: dict = Depends(get_current_user)
    ):
        """Set or remove founding member status for a user. When true, adds the badge; when false, removes it."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "badges": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        
        badge_name = "Founding Member"
        if is_founding:
            await db.users.update_one(
                {"id": target["id"]},
                {
                    "$set": {"founding_member": True},
                    "$addToSet": {"badges": badge_name}
                }
            )
            return {"message": f"Set {target['username']} as Founding Member with badge"}
        else:
            await db.users.update_one(
                {"id": target["id"]},
                {
                    "$set": {"founding_member": False},
                    "$pull": {"badges": badge_name}
                }
            )
            return {"message": f"Removed Founding Member status from {target['username']}"}

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

    # Token types and their count fields
    ADMIN_TOKEN_TYPES = {
        "xp_crimes": "xp_crimes_tokens",
        "xp_gta": "xp_gta_tokens",
        "melt": "melt_tokens",
        "oc_reduced": "oc_reduced_tokens",
        "booze": "booze_tokens",
        "racket": "racket_tokens",
        "travel": "travel_tokens",
        "properties": "properties_tokens",
        "jailbust_bonus": "jailbust_tokens",
    }

    @router.get("/admin/token-types")
    async def admin_get_token_types(current_user: dict = Depends(get_current_user)):
        """Get list of available token types."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return {"token_types": list(ADMIN_TOKEN_TYPES.keys())}

    @router.post("/admin/add-tokens")
    async def admin_add_tokens(
        target_username: str,
        token_type: str,
        amount: int,
        current_user: dict = Depends(get_current_user)
    ):
        """Add tokens to a user. token_type: xp_crimes, xp_gta, melt, oc_reduced, booze, racket, travel, properties, jailbust_bonus"""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if token_type not in ADMIN_TOKEN_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid token type. Valid types: {list(ADMIN_TOKEN_TYPES.keys())}")
        if amount < 1:
            raise HTTPException(status_code=400, detail="Amount must be at least 1")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        field = ADMIN_TOKEN_TYPES[token_type]
        await db.users.update_one(
            {"id": target["id"]},
            {"$inc": {field: amount}}
        )
        token_label = token_type.replace("_", " ").title()
        return {"message": f"Added {amount} {token_label} token(s) to {target['username']}"}

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
    GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT = 0.000006
    GTA_EXCLUSIVE_DROP_WEIGHT_MIN = 0.0000001
    GTA_EXCLUSIVE_DROP_WEIGHT_MAX = 0.05

    @router.get("/admin/gta/exclusive-pool")
    async def admin_gta_exclusive_pool_get(current_user: dict = Depends(get_current_user)):
        """Get whether the Al Capone exclusive is released into the GTA car pool. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_config.find_one({"id": GTA_EXCLUSIVE_POOL_CONFIG_ID}, {"_id": 0, "released": 1, "drop_weight": 1})
        drop_weight = float((doc or {}).get("drop_weight") or GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT)
        drop_weight = max(GTA_EXCLUSIVE_DROP_WEIGHT_MIN, min(GTA_EXCLUSIVE_DROP_WEIGHT_MAX, drop_weight))
        approx_one_in = int(round(1.0 / drop_weight)) if drop_weight > 0 else 0
        return {
            "released": bool(doc.get("released") if doc else False),
            "drop_weight": drop_weight,
            "approx_one_in": approx_one_in,
            "min_drop_weight": GTA_EXCLUSIVE_DROP_WEIGHT_MIN,
            "max_drop_weight": GTA_EXCLUSIVE_DROP_WEIGHT_MAX,
        }

    @router.post("/admin/gta/exclusive-pool")
    async def admin_gta_exclusive_pool_set(body: GTAExclusivePoolRequest, current_user: dict = Depends(get_current_user)):
        """Release or retract the Al Capone exclusive (car20) into the GTA car pool. When released, it can drop from GTA (very rare); only 1 in game at a time. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        updates = {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID, "released": body.released}
        if body.drop_weight is not None:
            dw = float(body.drop_weight)
            if dw < GTA_EXCLUSIVE_DROP_WEIGHT_MIN or dw > GTA_EXCLUSIVE_DROP_WEIGHT_MAX:
                raise HTTPException(
                    status_code=400,
                    detail=f"drop_weight must be between {GTA_EXCLUSIVE_DROP_WEIGHT_MIN} and {GTA_EXCLUSIVE_DROP_WEIGHT_MAX}",
                )
            updates["drop_weight"] = dw
        await db.game_config.update_one(
            {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID},
            {"$set": updates},
            upsert=True,
        )
        cfg = await db.game_config.find_one({"id": GTA_EXCLUSIVE_POOL_CONFIG_ID}, {"_id": 0, "drop_weight": 1})
        drop_weight = float((cfg or {}).get("drop_weight") or GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT)
        drop_weight = max(GTA_EXCLUSIVE_DROP_WEIGHT_MIN, min(GTA_EXCLUSIVE_DROP_WEIGHT_MAX, drop_weight))
        approx_one_in = int(round(1.0 / drop_weight)) if drop_weight > 0 else 0
        if body.released:
            await send_notification_to_all(
                "GTA exclusive in pool",
                "The Al Capone exclusive car is now in the GTA car pool. It can drop from GTAs (very rare); only one exists in the game at a time.",
                "system",
                category="gta_exclusive",
            )
        return {
            "message": f"Al Capone exclusive {'released into' if body.released else 'retracted from'} GTA car pool",
            "released": body.released,
            "drop_weight": drop_weight,
            "approx_one_in": approx_one_in,
        }

    @router.post("/admin/give-everyone-exclusive-cars")
    async def admin_give_everyone_exclusive_cars(body: GiveEveryoneExclusiveCarsRequest, current_user: dict = Depends(get_current_user)):
        """Give every user the selected exclusive car(s) if they don't already have them. loot_exclusive = car21, al_capone = car20. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not body.loot_exclusive and not body.al_capone:
            raise HTTPException(status_code=400, detail="Select at least one: loot_exclusive or al_capone")
        now_iso = datetime.now(timezone.utc).isoformat()
        cars_to_give = []
        if body.loot_exclusive:
            c = next((x for x in CARS if x.get("id") == "car21"), None)
            if c:
                cars_to_give.append(("car21", c["name"]))
        if body.al_capone:
            c = next((x for x in CARS if x.get("id") == "car20"), None)
            if c:
                cars_to_give.append(("car20", c["name"]))
        if not cars_to_give:
            raise HTTPException(status_code=400, detail="Exclusive car(s) not found in catalog")
        users = await db.users.find({}, {"_id": 0, "id": 1}).to_list(100_000)
        given = {car_id: 0 for car_id, _ in cars_to_give}
        skipped = {car_id: 0 for car_id, _ in cars_to_give}
        for u in users:
            user_id = u.get("id")
            if not user_id:
                continue
            for car_id, car_name in cars_to_give:
                existing = await db.user_cars.find_one({"user_id": user_id, "car_id": car_id}, {"_id": 1})
                if existing:
                    skipped[car_id] += 1
                else:
                    await db.user_cars.insert_one({
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "car_id": car_id,
                        "car_name": car_name,
                        "acquired_at": now_iso,
                    })
                    given[car_id] += 1
        msg_parts = []
        if body.loot_exclusive:
            msg_parts.append(f"Loot exclusive (car21): {given['car21']} given, {skipped['car21']} already had")
        if body.al_capone:
            msg_parts.append(f"Al Capone (car20): {given['car20']} given, {skipped['car20']} already had")
        return {
            "message": "; ".join(msg_parts),
            "given": given,
            "skipped": skipped,
            "total_users": len(users),
        }

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
        from routers.casinos.slots import get_next_slots_draw_on_the_hour_utc
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

    @router.get("/admin/stats/login-page-unique-visitors")
    async def admin_login_page_unique_visitors(current_user: dict = Depends(get_current_user)):
        """Return count of unique visitors to the login page (by IP)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        try:
            n = await db.login_page_visits.count_documents({})
        except Exception:
            n = 0
        return {"unique_visitors": n}

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

    @router.get("/admin/rate-limit-log")
    async def admin_rate_limit_log(
        limit: int = 100,
        username: str = None,
        current_user: dict = Depends(get_current_user)
    ):
        """Get rate limit violations log with detailed info about why users got rate limited."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        query = {"flag_type": "endpoint_rate_limit", "resolved": {"$ne": True}}
        if username:
            query["username"] = {"$regex": f"^{re.escape(username)}", "$options": "i"}
        flags = await db.security_flags.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
        by_user = {}
        for f in flags:
            uid = f.get("user_id")
            if uid not in by_user:
                by_user[uid] = {"username": f.get("username"), "count": 0, "endpoints": {}, "first_at": None, "last_at": None}
            by_user[uid]["count"] += 1
            ep = f.get("details", {}).get("path") or "unknown"
            by_user[uid]["endpoints"][ep] = by_user[uid]["endpoints"].get(ep, 0) + 1
            ts = f.get("created_at")
            if ts:
                if not by_user[uid]["first_at"] or ts < by_user[uid]["first_at"]:
                    by_user[uid]["first_at"] = ts
                if not by_user[uid]["last_at"] or ts > by_user[uid]["last_at"]:
                    by_user[uid]["last_at"] = ts
        user_summary = sorted(by_user.values(), key=lambda x: x["count"], reverse=True)
        return {
            "entries": flags,
            "count": len(flags),
            "by_user": user_summary[:50],
            "unique_users": len(by_user),
        }

    @router.post("/admin/rate-limit-log/clear-user")
    async def admin_clear_rate_limit_log_user(user_id: str, current_user: dict = Depends(get_current_user)):
        """Clear rate limit flags for a specific user."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        result = await db.security_flags.delete_many({"user_id": user_id, "flag_type": "endpoint_rate_limit"})
        return {"message": f"Cleared {result.deleted_count} rate limit flag(s) for user", "deleted": result.deleted_count}

    @router.post("/admin/rate-limit-log/clear-all")
    async def admin_clear_rate_limit_log_all(current_user: dict = Depends(get_current_user)):
        """Clear all rate limit flags."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await db.security_flags.delete_many({"flag_type": "endpoint_rate_limit"})
        return {"message": f"Cleared {result.deleted_count} rate limit flag(s)", "deleted": result.deleted_count}

    @router.get("/admin/security/rate-limits")
    async def admin_get_rate_limits(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        try:
            import middleware.security_middleware as sm_module
            middleware_enabled = getattr(sm_module, "SECURITY_MIDDLEWARE_ENABLED", False)
        except ImportError:
            middleware_enabled = False
        rl_ms = {}
        for ep, (interval_sec, enabled) in security_module.RATE_LIMIT_CONFIG.items():
            rl_ms[ep] = (round(interval_sec * 1000, 1), enabled)
        return {
            "rate_limits": rl_ms,
            "global_enabled": getattr(security_module, "GLOBAL_RATE_LIMITS_ENABLED", False),
            "security_middleware_enabled": middleware_enabled,
            "note": "Values are in milliseconds. All security middleware is OFF by default."
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
            "min_interval_ms": round(interval * 1000, 1),
            "enabled": enabled_bool
        }

    @router.post("/admin/security/rate-limits/update")
    async def admin_update_rate_limit(
        endpoint: str,
        min_interval_ms: float,
        current_user: dict = Depends(get_current_user)
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if endpoint not in security_module.RATE_LIMIT_CONFIG:
            raise HTTPException(status_code=404, detail=f"Endpoint '{endpoint}' not found in rate limit config")
        if min_interval_ms < 0 or min_interval_ms > 60000:
            raise HTTPException(status_code=400, detail="Min interval must be between 0 and 60000 ms")
        min_interval_sec = min_interval_ms / 1000.0
        _, enabled = security_module.RATE_LIMIT_CONFIG[endpoint]
        security_module.RATE_LIMIT_CONFIG[endpoint] = (min_interval_sec, enabled)
        label = f"{min_interval_ms}ms" if min_interval_ms < 1000 else f"{min_interval_sec}s"
        return {
            "message": f"Rate limit for '{endpoint}' updated to {label} between clicks",
            "endpoint": endpoint,
            "min_interval_ms": min_interval_ms,
            "min_interval_sec": min_interval_sec,
            "enabled": enabled
        }

    @router.post("/admin/security/rate-limits/disable-all")
    async def admin_disable_all_rate_limits(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        security_module.GLOBAL_RATE_LIMITS_ENABLED = False
        try:
            import middleware.security_middleware as sm_module
            sm_module.SECURITY_MIDDLEWARE_ENABLED = False
        except ImportError:
            pass
        count = 0
        for endpoint in security_module.RATE_LIMIT_CONFIG:
            interval, _ = security_module.RATE_LIMIT_CONFIG[endpoint]
            security_module.RATE_LIMIT_CONFIG[endpoint] = (interval, False)
            count += 1
        return {
            "message": f"Disabled ALL rate limiting + security middleware (global toggle OFF + {count} endpoints disabled)",
            "global_enabled": False,
            "count": count
        }

    @router.post("/admin/security/rate-limits/enable-all")
    async def admin_enable_all_rate_limits(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        security_module.GLOBAL_RATE_LIMITS_ENABLED = True
        try:
            import middleware.security_middleware as sm_module
            sm_module.SECURITY_MIDDLEWARE_ENABLED = True
        except ImportError:
            pass
        count = 0
        for endpoint in security_module.RATE_LIMIT_CONFIG:
            interval, _ = security_module.RATE_LIMIT_CONFIG[endpoint]
            security_module.RATE_LIMIT_CONFIG[endpoint] = (interval, True)
            count += 1
        return {
            "message": f"Enabled ALL rate limiting + security middleware (global toggle ON + {count} endpoints enabled)",
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

    @router.post("/admin/security/rate-limits/set-all-interval")
    async def admin_set_all_rate_limit_intervals(
        min_interval_ms: float,
        current_user: dict = Depends(get_current_user)
    ):
        """Set all rate limit intervals to the same value at once."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if min_interval_ms < 0 or min_interval_ms > 60000:
            raise HTTPException(status_code=400, detail="Min interval must be between 0 and 60000 ms")
        min_interval_sec = min_interval_ms / 1000.0
        count = 0
        for endpoint in security_module.RATE_LIMIT_CONFIG:
            _, enabled = security_module.RATE_LIMIT_CONFIG[endpoint]
            security_module.RATE_LIMIT_CONFIG[endpoint] = (min_interval_sec, enabled)
            count += 1
        label = f"{min_interval_ms}ms" if min_interval_ms < 1000 else f"{min_interval_sec}s"
        return {
            "message": f"Set all {count} endpoints to {label} between clicks",
            "min_interval_ms": min_interval_ms,
            "min_interval_sec": min_interval_sec,
            "count": count
        }

    @router.post("/admin/security/middleware-toggle")
    async def admin_toggle_security_middleware(
        enabled: bool,
        current_user: dict = Depends(get_current_user)
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        try:
            import middleware.security_middleware as sm_module
            sm_module.SECURITY_MIDDLEWARE_ENABLED = enabled
            return {
                "message": f"Security middleware {'ENABLED' if enabled else 'DISABLED'}",
                "security_middleware_enabled": enabled
            }
        except ImportError:
            raise HTTPException(status_code=500, detail="security_middleware module not found")

    @router.get("/admin/security/cheat-detection-config")
    async def admin_get_cheat_detection_config(current_user: dict = Depends(get_current_user)):
        """Get cheat detection toggles and thresholds (duplicate request, negative balance, impossible gain)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return {
            "detect_duplicate_requests": getattr(security_module, "DETECT_DUPLICATE_REQUESTS", False),
            "duplicate_request_window_ms": getattr(security_module, "DUPLICATE_REQUEST_WINDOW_MS", 300),
            "detect_negative_balance": getattr(security_module, "DETECT_NEGATIVE_BALANCE", False),
            "detect_impossible_gain": getattr(security_module, "DETECT_IMPOSSIBLE_GAIN", 50_000_000),
        }

    @router.post("/admin/security/cheat-detection-config")
    async def admin_set_cheat_detection_config(
        detect_duplicate_requests: Optional[bool] = None,
        duplicate_request_window_ms: Optional[int] = None,
        detect_negative_balance: Optional[bool] = None,
        detect_impossible_gain: Optional[int] = None,
        current_user: dict = Depends(get_current_user)
    ):
        """Configure cheat detection toggles and thresholds."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        changes = []
        if detect_duplicate_requests is not None:
            security_module.DETECT_DUPLICATE_REQUESTS = detect_duplicate_requests
            changes.append(f"detect_duplicate_requests={detect_duplicate_requests}")
        if duplicate_request_window_ms is not None:
            if duplicate_request_window_ms < 100 or duplicate_request_window_ms > 1000:
                raise HTTPException(status_code=400, detail="duplicate_request_window_ms must be between 100 and 1000")
            security_module.DUPLICATE_REQUEST_WINDOW_MS = duplicate_request_window_ms
            changes.append(f"duplicate_request_window_ms={duplicate_request_window_ms}")
        if detect_negative_balance is not None:
            security_module.DETECT_NEGATIVE_BALANCE = detect_negative_balance
            changes.append(f"detect_negative_balance={detect_negative_balance}")
        if detect_impossible_gain is not None:
            if detect_impossible_gain < 1_000_000 or detect_impossible_gain > 1_000_000_000_000:
                raise HTTPException(status_code=400, detail="detect_impossible_gain must be between 1M and 1T")
            security_module.DETECT_IMPOSSIBLE_GAIN = detect_impossible_gain
            changes.append(f"detect_impossible_gain={detect_impossible_gain}")
        if not changes:
            return {"message": "No changes made"}
        return {
            "message": f"Cheat detection config updated: {', '.join(changes)}",
            "detect_duplicate_requests": security_module.DETECT_DUPLICATE_REQUESTS,
            "duplicate_request_window_ms": security_module.DUPLICATE_REQUEST_WINDOW_MS,
            "detect_negative_balance": security_module.DETECT_NEGATIVE_BALANCE,
            "detect_impossible_gain": security_module.DETECT_IMPOSSIBLE_GAIN,
        }

    @router.get("/admin/security/spam-config")
    async def admin_get_spam_config(current_user: dict = Depends(get_current_user)):
        """Get current spam/burst detection configuration."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return {
            "max_requests_per_second": security_module.MAX_REQUESTS_PER_SECOND,
            "burst_window_seconds": security_module.BURST_WINDOW_SECONDS,
            "burst_max_requests": security_module.BURST_MAX_REQUESTS,
        }

    @router.post("/admin/security/spam-config")
    async def admin_set_spam_config(
        max_requests_per_second: int = None,
        burst_window_seconds: float = None,
        burst_max_requests: int = None,
        current_user: dict = Depends(get_current_user)
    ):
        """Configure spam/burst detection thresholds."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        changes = []
        if max_requests_per_second is not None:
            if max_requests_per_second < 1 or max_requests_per_second > 100:
                raise HTTPException(status_code=400, detail="max_requests_per_second must be between 1 and 100")
            security_module.MAX_REQUESTS_PER_SECOND = max_requests_per_second
            changes.append(f"max_requests_per_second={max_requests_per_second}")
        if burst_window_seconds is not None:
            if burst_window_seconds < 0.1 or burst_window_seconds > 5.0:
                raise HTTPException(status_code=400, detail="burst_window_seconds must be between 0.1 and 5.0")
            security_module.BURST_WINDOW_SECONDS = burst_window_seconds
            changes.append(f"burst_window_seconds={burst_window_seconds}")
        if burst_max_requests is not None:
            if burst_max_requests < 1 or burst_max_requests > 50:
                raise HTTPException(status_code=400, detail="burst_max_requests must be between 1 and 50")
            security_module.BURST_MAX_REQUESTS = burst_max_requests
            changes.append(f"burst_max_requests={burst_max_requests}")
        if not changes:
            return {"message": "No changes made"}
        return {
            "message": f"Spam config updated: {', '.join(changes)}",
            "max_requests_per_second": security_module.MAX_REQUESTS_PER_SECOND,
            "burst_window_seconds": security_module.BURST_WINDOW_SECONDS,
            "burst_max_requests": security_module.BURST_MAX_REQUESTS,
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

    @router.post("/admin/force-online-user")
    async def admin_force_online_user(target_username: str, hours: int = 1, current_user: dict = Depends(get_current_user)):
        """Force a specific user to appear online for a number of hours. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        hours = max(1, min(hours, 24))  # Clamp between 1 and 24 hours
        now = datetime.now(timezone.utc)
        until = now + timedelta(hours=hours)
        until_iso = until.isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"forced_online_until": until_iso}},
        )
        return {"message": f"Forced {target['username']} online until {until_iso}", "until": until_iso, "username": target["username"]}

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
        """Unlock an account that was locked for investigation. Admin or moderator. Also clears login lockout (failed attempts) so they can log in again."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {"account_locked": False},
                "$unset": {"account_locked_at": "", "account_locked_comment": "", "account_locked_comment_at": "", "account_locked_until": "", "account_locked_admin_message": "", "account_locked_admin_message_at": "", "account_locked_user_reply": "", "account_locked_user_reply_at": ""},
            },
        )
        email_clean = (target.get("email") or "").strip().lower()
        if email_clean:
            await db.login_lockouts.delete_one({"email": email_clean})
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
        # Store token counts at death for Dead > Alive restoration
        tokens_at_death = {}
        for token_type, cfg in TOKEN_CONFIG.items():
            count_field = cfg["count_field"]
            tokens_at_death[count_field] = int(target.get(count_field, 0) or 0)
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {
                "is_dead": True,
                "dead_at": now_iso,
                "points_at_death": int(target.get("points", 0) or 0),
                "money_at_death": int(target.get("money", 0) or 0),
                "tokens_at_death": tokens_at_death,
                "money": 0,
                "health": 0,
            }, "$inc": {"total_deaths": 1}}
        )
        try:
            from routers.game.families import maybe_promote_after_boss_death, _invalidate_list_cache
            await maybe_promote_after_boss_death(target["id"])
            _invalidate_list_cache()
        except Exception as e:
            logging.exception("Promote after boss death: %s", e)
        try:
            from routers.money.quicktrade import cancel_offers_on_death
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
            "auto_rank_telegram_notify": True,
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
                    "tokens_at_death": "",
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

    @router.get("/admin/user-sessions")
    async def admin_get_user_sessions(
        target_username: str = Query(..., description="Username to list sessions for"),
        current_user: dict = Depends(get_current_user),
    ):
        """List sessions (IP, device, last used) for a user. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one(
            {"username": username_pattern},
            {"_id": 0, "id": 1, "username": 1, "sessions": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        sessions_raw = target.get("sessions") or []
        sessions = [
            {
                "id": s.get("id"),
                "ip": (s.get("ip") or "").strip(),
                "device_type": (s.get("device_type") or "Unknown").strip(),
                "created_at": s.get("created_at"),
                "last_used_at": s.get("last_used_at"),
            }
            for s in sessions_raw
            if s.get("id")
        ]
        return {"username": target.get("username"), "sessions": sessions}

    @router.post("/admin/sessions/revoke")
    async def admin_revoke_session(
        body: AdminRevokeSessionRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Revoke one session for a user (by username and session_id). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        session_id = (body.session_id or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id required")
        username_pattern = _username_pattern(body.target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        result = await db.users.update_one(
            {"id": target["id"]},
            {"$pull": {"sessions": {"id": session_id}}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Session not found or already revoked")
        return {"message": f"Session revoked for {target.get('username', body.target_username)}."}

    def _session_datetime(session: dict) -> Optional[datetime]:
        """Parse last_used_at or created_at from a session entry; return None if unparseable."""
        for key in ("last_used_at", "created_at"):
            val = session.get(key)
            if not val:
                continue
            try:
                if isinstance(val, str):
                    dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                else:
                    dt = val
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except (ValueError, TypeError):
                continue
        return None

    @router.get("/admin/sessions/stats")
    async def admin_sessions_stats(current_user: dict = Depends(get_current_user)):
        """Return total active sessions and number of users with at least one session. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        pipeline = [
            {"$match": {"sessions": {"$exists": True, "$ne": []}}},
            {"$project": {"count": {"$size": "$sessions"}}},
            {"$group": {"_id": None, "total_sessions": {"$sum": "$count"}, "users_with_sessions": {"$sum": 1}}},
        ]
        cursor = db.users.aggregate(pipeline)
        row = await cursor.to_list(length=1)
        if not row:
            return {"total_sessions": 0, "users_with_sessions": 0}
        return {"total_sessions": row[0]["total_sessions"], "users_with_sessions": row[0]["users_with_sessions"]}

    @router.post("/admin/sessions/revoke-old")
    async def admin_revoke_old_sessions(
        body: AdminRevokeOldSessionsRequest = Body(default=None),
        current_user: dict = Depends(get_current_user),
    ):
        """Revoke all sessions older than 24 hours. Optionally limit to target_username. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        body = body or AdminRevokeOldSessionsRequest()
        target_username = (body.target_username or "").strip() or None

        if target_username:
            username_pattern = _username_pattern(target_username)
            target = await db.users.find_one(
                {"username": username_pattern},
                {"_id": 0, "id": 1, "username": 1, "sessions": 1},
            )
            if not target:
                raise HTTPException(status_code=404, detail="User not found")
            sessions_raw = target.get("sessions") or []
            keep = [
                s for s in sessions_raw
                if s.get("id") and (_session_datetime(s) is not None and _session_datetime(s) >= cutoff)
            ]
            removed = len(sessions_raw) - len(keep)
            if removed > 0:
                await db.users.update_one({"id": target["id"]}, {"$set": {"sessions": keep}})
            return {
                "message": f"Revoked {removed} session(s) older than 24h for {target.get('username', target_username)}.",
                "revoked_count": removed,
                "users_affected": 1 if removed > 0 else 0,
            }

        revoked_total = 0
        users_affected = 0
        async for user in db.users.find({"sessions": {"$exists": True, "$ne": []}}, {"_id": 0, "id": 1, "sessions": 1}):
            sessions_raw = user.get("sessions") or []
            keep = [
                s for s in sessions_raw
                if s.get("id") and (_session_datetime(s) is not None and _session_datetime(s) >= cutoff)
            ]
            removed = len(sessions_raw) - len(keep)
            if removed > 0:
                await db.users.update_one({"id": user["id"]}, {"$set": {"sessions": keep}})
                revoked_total += removed
                users_affected += 1
        return {
            "message": f"Revoked {revoked_total} session(s) older than 24h across {users_affected} user(s).",
            "revoked_count": revoked_total,
            "users_affected": users_affected,
        }

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
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"password_hash": new_hash, "sessions": []}, "$inc": {"token_version": 1}}
        )
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
        out = {"is_admin": is_admin, "is_moderator": is_moderator, "is_help_desk_operator": is_help_desk_operator, "has_admin_email": has_admin_email}
        if is_moderator:
            doc = await db.game_settings.find_one({"key": "mod_visible_category_ids"}, {"_id": 0, "value": 1})
            raw = doc.get("value") if doc else None
            if isinstance(raw, list) and raw and all(isinstance(x, str) and x in ADMIN_CATEGORY_IDS for x in raw):
                out["mod_visible_category_ids"] = raw
            else:
                out["mod_visible_category_ids"] = MOD_VISIBLE_CATEGORY_IDS_DEFAULT
        return out

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
        msg_doc = await db.game_settings.find_one({"key": "landing_banner_message"}, {"_id": 0, "value": 1})
        landing_banner_message = (msg_doc.get("value") or "") if msg_doc and msg_doc.get("value") is not None else ""
        main_doc = await db.game_settings.find_one({"_id": "main"})
        login_lock_until = main_doc.get("login_lock_until") if main_doc else None
        login_lock_message = main_doc.get("login_lock_message") if main_doc else None
        preregister_landing_banner_enabled = main_doc.get("preregister_landing_banner_enabled") if main_doc else None
        if preregister_landing_banner_enabled is None:
            preregister_landing_banner_enabled = True
        preregister_landing_banner_preview_open = bool(main_doc.get("preregister_landing_banner_preview_open")) if main_doc else False
        preorder_points_release_date = main_doc.get("preorder_points_release_date") if main_doc else None
        store_points_auto_credit = main_doc.get("store_points_auto_credit") if main_doc else None
        if store_points_auto_credit is None:
            store_points_auto_credit = True
        store_points_manual_credit_eta = main_doc.get("store_points_manual_credit_eta") if main_doc else None
        casino_global_max_bet = int(main_doc.get("casino_global_max_bet") or 1_000_000_000) if main_doc else 1_000_000_000
        casino_buyback_max_points = int(main_doc.get("casino_buyback_max_points") or 15_000) if main_doc else 15_000
        mp_poker_max_blind = int(main_doc.get("mp_poker_max_blind") or 2_500_000) if main_doc else 2_500_000
        mod_cat_doc = await db.game_settings.find_one({"key": "mod_visible_category_ids"}, {"_id": 0, "value": 1})
        raw_mod_cats = mod_cat_doc.get("value") if mod_cat_doc else None
        if isinstance(raw_mod_cats, list) and raw_mod_cats and all(isinstance(x, str) and x in ADMIN_CATEGORY_IDS for x in raw_mod_cats):
            mod_visible_category_ids = raw_mod_cats
        else:
            mod_visible_category_ids = MOD_VISIBLE_CATEGORY_IDS_DEFAULT
        return {
            "admin_online_color": admin_online_color.strip(),
            "mod_default_online_color": mod_default_online_color.strip(),
            "require_email_verification": require_email_verification,
            "stock_market_max_points": stock_market_max_points,
            "landing_banner_enabled": landing_banner_enabled,
            "landing_banner_message": landing_banner_message,
            "login_lock_until": login_lock_until,
            "login_lock_message": login_lock_message,
            "preregister_landing_banner_enabled": bool(preregister_landing_banner_enabled),
            "preregister_landing_banner_preview_open": preregister_landing_banner_preview_open,
            "preorder_points_release_date": preorder_points_release_date,
            "store_points_auto_credit": bool(store_points_auto_credit),
            "store_points_manual_credit_eta": store_points_manual_credit_eta,
            "casino_global_max_bet": casino_global_max_bet,
            "casino_buyback_max_points": casino_buyback_max_points,
            "mp_poker_max_blind": mp_poker_max_blind,
            "mod_visible_category_ids": mod_visible_category_ids,
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
        if body.landing_banner_message is not None:
            await db.game_settings.update_one(
                {"key": "landing_banner_message"},
                {"$set": {"value": body.landing_banner_message}},
                upsert=True,
            )
        if body.login_lock_until is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"login_lock_until": body.login_lock_until if body.login_lock_until else None}},
                upsert=True,
            )
        if body.login_lock_message is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"login_lock_message": body.login_lock_message if body.login_lock_message else None}},
                upsert=True,
            )
        if body.preregister_landing_banner_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"preregister_landing_banner_enabled": bool(body.preregister_landing_banner_enabled)}},
                upsert=True,
            )
        if body.preregister_landing_banner_preview_open is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"preregister_landing_banner_preview_open": bool(body.preregister_landing_banner_preview_open)}},
                upsert=True,
            )
        if body.preorder_points_release_date is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"preorder_points_release_date": body.preorder_points_release_date if body.preorder_points_release_date else None}},
                upsert=True,
            )
        if body.store_points_auto_credit is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"store_points_auto_credit": bool(body.store_points_auto_credit)}},
                upsert=True,
            )
        if body.store_points_manual_credit_eta is not None:
            eta = (body.store_points_manual_credit_eta or "").strip() or None
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"store_points_manual_credit_eta": eta}},
                upsert=True,
            )
        if body.casino_global_max_bet is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"casino_global_max_bet": max(1_000_000, int(body.casino_global_max_bet))}},
                upsert=True,
            )
        if body.casino_buyback_max_points is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"casino_buyback_max_points": max(0, int(body.casino_buyback_max_points))}},
                upsert=True,
            )
        if body.mp_poker_max_blind is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"mp_poker_max_blind": max(1_000, int(body.mp_poker_max_blind))}},
                upsert=True,
            )
        if body.mod_visible_category_ids is not None:
            ids = list(body.mod_visible_category_ids) if isinstance(body.mod_visible_category_ids, list) else []
            if not all(isinstance(x, str) and x in ADMIN_CATEGORY_IDS for x in ids):
                raise HTTPException(status_code=400, detail="mod_visible_category_ids must be a list of valid admin category ids")
            await db.game_settings.update_one(
                {"key": "mod_visible_category_ids"},
                {"$set": {"value": ids}},
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
        msg_doc = await db.game_settings.find_one({"key": "landing_banner_message"}, {"_id": 0, "value": 1})
        landing_banner_message = (msg_doc.get("value") or "") if msg_doc and msg_doc.get("value") is not None else ""
        main_doc = await db.game_settings.find_one({"_id": "main"})
        login_lock_until = main_doc.get("login_lock_until") if main_doc else None
        login_lock_message = main_doc.get("login_lock_message") if main_doc else None
        preregister_landing_banner_enabled = main_doc.get("preregister_landing_banner_enabled")
        if preregister_landing_banner_enabled is None:
            preregister_landing_banner_enabled = True
        preregister_landing_banner_preview_open = bool(main_doc.get("preregister_landing_banner_preview_open")) if main_doc else False
        preorder_points_release_date = main_doc.get("preorder_points_release_date") if main_doc else None
        store_points_auto_credit = main_doc.get("store_points_auto_credit") if main_doc else None
        if store_points_auto_credit is None:
            store_points_auto_credit = True
        store_points_manual_credit_eta = main_doc.get("store_points_manual_credit_eta") if main_doc else None
        casino_global_max_bet = int(main_doc.get("casino_global_max_bet") or 1_000_000_000) if main_doc else 1_000_000_000
        casino_buyback_max_points = int(main_doc.get("casino_buyback_max_points") or 15_000) if main_doc else 15_000
        mp_poker_max_blind = int(main_doc.get("mp_poker_max_blind") or 2_500_000) if main_doc else 2_500_000
        return {
            "admin_online_color": admin_online_color,
            "mod_default_online_color": mod_default_online_color.strip() if isinstance(mod_default_online_color, str) else MOD_DEFAULT,
            "require_email_verification": require_email_verification,
            "stock_market_max_points": stock_market_max_points,
            "landing_banner_enabled": landing_banner_enabled,
            "landing_banner_message": landing_banner_message,
            "login_lock_until": login_lock_until,
            "login_lock_message": login_lock_message,
            "preregister_landing_banner_enabled": bool(preregister_landing_banner_enabled),
            "preregister_landing_banner_preview_open": preregister_landing_banner_preview_open,
            "preorder_points_release_date": preorder_points_release_date,
            "store_points_auto_credit": bool(store_points_auto_credit),
            "store_points_manual_credit_eta": store_points_manual_credit_eta,
            "casino_global_max_bet": casino_global_max_bet,
            "casino_buyback_max_points": casino_buyback_max_points,
            "mp_poker_max_blind": mp_poker_max_blind,
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

    DEFAULT_LANDING_BANNER_MESSAGE = (
        "Beta round end: March 24 6pm. Full game release March 28th 6pm. "
        "This beta lets you try the game and features before launch."
    )

    @router.get("/landing-banner")
    async def get_landing_banner_public():
        """Public: return whether the beta banner is enabled and its message. No auth required."""
        doc = await db.game_settings.find_one({"key": "landing_banner_enabled"}, {"_id": 0, "value": 1})
        enabled = bool(doc.get("value") if doc else False)
        msg_doc = await db.game_settings.find_one({"key": "landing_banner_message"}, {"_id": 0, "value": 1})
        message = (msg_doc.get("value") or "").strip() if msg_doc and msg_doc.get("value") is not None else ""
        if enabled and not message:
            message = DEFAULT_LANDING_BANNER_MESSAGE
        return {"enabled": enabled, "message": message}

    @router.get("/admin/page-locks")
    async def admin_get_page_locks(current_user: dict = Depends(get_current_user)):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
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
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
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
        from routers.game.stats import _gambling_profit_from_details

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

    @router.get("/admin/casinos/gambling-anomalies")
    async def admin_gambling_anomalies(
        days: int = Query(7, ge=1, le=90),
        min_plays: int = Query(20, ge=5, le=500),
        std_threshold: float = Query(3.0, ge=2.0, le=5.0),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Flag users with gambling profit far above expected (>N std dev).
        Uses gambling_log; useful for cheat detection (e.g. manipulated RNG).
        Admin or moderator only.
        """
        from routers.game.stats import _gambling_profit_from_details

        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()

        cursor = db.gambling_log.find(
            {"created_at": {"$gte": since_iso}},
            {"_id": 0, "user_id": 1, "username": 1, "game_type": 1, "details": 1},
        )
        by_user: dict = {}
        async for row in cursor:
            uid = (row.get("user_id") or "").strip()
            if not uid:
                continue
            details = row.get("details") or {}
            profit = _gambling_profit_from_details((row.get("game_type") or "").strip(), details)
            if uid not in by_user:
                by_user[uid] = {"user_id": uid, "username": row.get("username", ""), "plays": 0, "total_profit": 0}
            by_user[uid]["plays"] += 1
            by_user[uid]["total_profit"] += profit

        eligible = [u for u in by_user.values() if u["plays"] >= min_plays]
        if len(eligible) < 3:
            return {"generated_at": now.isoformat(), "days": days, "anomalies": [], "note": "Not enough users with min_plays"}
        profits = [u["total_profit"] for u in eligible]
        mean_p = sum(profits) / len(profits)
        var = sum((p - mean_p) ** 2 for p in profits) / len(profits)
        std_p = (var ** 0.5) if var > 0 else 0
        threshold = mean_p + std_threshold * std_p if std_p > 0 else mean_p
        anomalies = [
            {**u, "z_score": round((u["total_profit"] - mean_p) / std_p, 2) if std_p > 0 else 0}
            for u in eligible
            if u["total_profit"] > threshold
        ]
        anomalies.sort(key=lambda x: -x["total_profit"])
        return {
            "generated_at": now.isoformat(),
            "days": days,
            "min_plays": min_plays,
            "std_threshold": std_threshold,
            "mean_profit": round(mean_p, 2),
            "std_profit": round(std_p, 2),
            "anomalies": anomalies[:50],
        }

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
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
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
            {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "login_ips": 1, "last_login_ip": 1, "last_request_ip": 1, "created_at": 1},
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
            req_ip = (u.get("last_request_ip") or "").strip()
            if req_ip and req_ip != reg_ip and req_ip not in (u.get("login_ips") or []):
                ip_to_users.setdefault(req_ip, []).append({**summary, "source": "request"})
        groups = []
        for ip, accs in ip_to_users.items():
            if len(accs) < 2:
                continue
            sources = set(a.get("source") for a in accs)
            if "registration" in sources and ("login" in sources or "request" in sources):
                label = "registration_and_activity"
                risk = "high"
            elif "registration" in sources:
                label = "registration_only"
                risk = "medium"
            else:
                label = "activity_only"
                risk = "low"
            groups.append({"ip": ip, "count": len(accs), "accounts": accs, "label": label, "risk": risk})
        groups.sort(key=lambda g: (0 if g["risk"] == "high" else 1 if g["risk"] == "medium" else 2, -g["count"]))
        return {"groups": groups[:100], "total_groups": len(groups)}

    @router.get("/admin/cheat-detection/login-attempts")
    async def admin_cheat_login_attempts(
        limit: int = Query(200, ge=1, le=1000),
        since: Optional[str] = Query(None, description="ISO date or datetime; only events at or after this time"),
        ip: Optional[str] = Query(None, description="Filter by attempt IP"),
        username: Optional[str] = Query(None, description="Filter by username or login_input contains"),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Suspicious login attempts: wrong password or unknown account
        from an IP that already has at least one other alive account.
        Admin or moderator.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        q = {}
        if since and since.strip():
            q["at"] = {"$gte": since.strip()}
        if ip and ip.strip():
            q["ip"] = ip.strip()
        if username and username.strip():
            pattern = re.compile(re.escape(username.strip()), re.IGNORECASE)
            q["$or"] = [
                {"username": pattern},
                {"login_input": pattern},
            ]
        cursor = (
            db.suspicious_logins.find(q, {"_id": 0})
            .sort("at", -1)
            .limit(limit)
        )
        events = await cursor.to_list(limit)
        return {"events": events}

    @router.get("/admin/cheat-detection/duplicate-suspects")
    async def admin_cheat_duplicate_suspects(
        username: str = Query(None, description="Optional: filter by username contains"),
        limit_domain: int = Query(50, ge=1, le=200),
        limit_username: int = Query(50, ge=1, le=200),
        include_fuzzy: bool = Query(True, description="Include fuzzy username matching"),
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
        domain_groups = group_by_domain(users)
        name_groups = group_by_similar_username_strip_digits(users)
        similar_email_groups = group_by_similar_email(users)
        same_day_ip_groups = group_by_same_day_same_ip(users)
        fuzzy_groups = group_by_fuzzy_username(users) if include_fuzzy else []
        for g in domain_groups:
            g["risk_score"] = compute_dupe_risk_score("domain", g["count"])
        for g in name_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_username", g["count"])
        for g in similar_email_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_email", g["count"])
        for g in same_day_ip_groups:
            g["risk_score"] = compute_dupe_risk_score("same_day_ip", g["count"])
        for g in fuzzy_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_username", g["count"])
        return {
            "by_domain": domain_groups[:limit_domain],
            "by_similar_username": name_groups[:limit_username],
            "by_similar_email": similar_email_groups[:limit_domain],
            "by_same_day_same_ip": same_day_ip_groups[:30],
            "by_fuzzy_username": fuzzy_groups[:30],
        }

    @router.get("/admin/cheat-detection/dupe-check-intelligent")
    async def admin_cheat_dupe_check_intelligent(
        username: str = Query(None, description="Optional: filter by username contains"),
        check_vpn: bool = Query(True, description="Check shared IPs for VPN/proxy (rate-limited)"),
        max_vpn_checks: int = Query(50, ge=0, le=100),
        include_dead_ip: bool = Query(True, description="Alive vs dead accounts sharing an IP"),
        include_dead_fingerprint: bool = Query(True, description="Alive vs dead sharing device_fingerprint"),
        suspicious_days: int = Query(30, ge=1, le=365, description="Window for suspicious_logins aggregation"),
        suspicious_limit: int = Query(3000, ge=100, le=8000, description="Max suspicious_logins docs to scan"),
        transfer_days: int = Query(14, ge=1, le=90, description="Window for heavy money_transfers"),
        transfer_min_count: int = Query(3, ge=2, le=50, description="Min transfers per ordered pair"),
        transfer_limit: int = Query(50, ge=1, le=150),
        registration_burst_hours: float = Query(2.0, ge=0.5, le=24, description="Registration burst time bucket (hours)"),
        include_session_ips: bool = Query(True, description="Include JWT session IPs in IP union"),
        include_prereg_cross: bool = Query(True, description="Prereg IP overlapping other accounts"),
        include_security_flags: bool = Query(True, description="Unresolved security_flags for batch users"),
        include_password_resets: bool = Query(True, description="Frequent password reset requests"),
        flags_days: int = Query(30, ge=1, le=365),
        password_reset_days: int = Query(7, ge=1, le=90),
        password_reset_min: int = Query(3, ge=2, le=30),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Single report: same IP (full IP history), same user-agent, device fingerprint,
        same subnet, domain/similar-username/fuzzy-username/similar-email/same-day-same-IP,
        risk scores, optional VPN/proxy flags, alive/dead overlap, suspicious-login hotspots,
        registration bursts, referral+IP, heavy transfers, and optional wave-2 signals.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        def _all_ips(u: dict) -> Tuple[List[str], dict]:
            return user_ip_union(u, include_session_ips=include_session_ips)

        query = {"is_dead": {"$ne": True}}
        if username and username.strip():
            query["username"] = re.compile(re.escape(username.strip()), re.IGNORECASE)
        proj = {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "registration_ip": 1,
            "login_ips": 1,
            "last_login_ip": 1,
            "last_request_ip": 1,
            "last_user_agent": 1,
            "device_fingerprint": 1,
            "created_at": 1,
            "referred_by": 1,
        }
        if include_session_ips:
            proj["sessions"] = 1
        users = await db.users.find(query, proj).to_list(5000)

        ip_to_accounts = {}
        for u in users:
            ips, sources = _all_ips(u)
            if not ips:
                continue
            summary = {
                "id": u["id"],
                "username": u.get("username"),
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                "all_ips": ips,
                "sources": sources,
            }
            for ip in ips:
                if sources.get("registration") == ip:
                    role = "registration"
                elif ip in (sources.get("login_ips") or []):
                    role = "login"
                elif ip in (sources.get("session_ips") or []):
                    role = "session"
                else:
                    role = "request"
                ip_to_accounts.setdefault(ip, []).append({**summary, "role_at_this_ip": role})
        same_ip_groups = []
        seen_ip = set()
        for ip, accs in ip_to_accounts.items():
            if len(accs) < 2 or ip in seen_ip:
                continue
            seen_ip.add(ip)
            by_user = {}
            for a in accs:
                uid = a.get("id")
                if uid not in by_user:
                    by_user[uid] = {
                        "id": a["id"],
                        "username": a["username"],
                        "email": a["email"],
                        "created_at": a["created_at"],
                        "all_ips": a["all_ips"],
                        "sources": a["sources"],
                        "role_at_this_ip": a.get("role_at_this_ip"),
                    }
            has_reg = any(a.get("sources", {}).get("registration") == ip for a in accs) and len(by_user) >= 2
            risk = "high" if has_reg else "medium"
            risk_score = compute_dupe_risk_score("same_ip", len(by_user), has_registration_ip=has_reg)
            same_ip_groups.append({
                "ip": ip,
                "count": len(by_user),
                "accounts": list(by_user.values()),
                "risk": risk,
                "risk_score": risk_score,
            })
        same_ip_groups.sort(key=lambda g: (-g["risk_score"], -g["count"]))

        same_subnet_groups = group_by_same_subnet(users, include_session_ips=include_session_ips)

        fp_to_users = {}
        for u in users:
            fp = (u.get("device_fingerprint") or "").strip()
            if not fp:
                continue
            ips, _ = _all_ips(u)
            fp_to_users.setdefault(fp, []).append({
                "id": u["id"],
                "username": u.get("username"),
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                "all_ips": ips,
            })
        same_fingerprint_groups = []
        for fp, accs in fp_to_users.items():
            if len(accs) < 2:
                continue
            all_ips = set()
            for a in accs:
                all_ips.update(a.get("all_ips") or [])
            same_fingerprint_groups.append({
                "device_fingerprint": fp[:32] + ("..." if len(fp) > 32 else ""),
                "account_count": len(accs),
                "distinct_ip_count": len(all_ips),
                "accounts": accs,
                "risk_score": compute_dupe_risk_score("same_ua", len(accs), has_same_device=True),
            })
        same_fingerprint_groups.sort(key=lambda g: (-g["risk_score"], -g["account_count"]))

        ua_to_users = {}
        ua_raw_sample = {}
        for u in users:
            ua_raw = (u.get("last_user_agent") or "").strip()
            if not ua_raw:
                continue
            ua_norm = re.sub(r"/\d+[\d.]*", "", ua_raw) or ua_raw
            if ua_norm not in ua_raw_sample:
                ua_raw_sample[ua_norm] = ua_raw
            ips, _ = _all_ips(u)
            ua_to_users.setdefault(ua_norm, []).append({
                "id": u["id"],
                "username": u.get("username"),
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                "all_ips": ips,
            })
        same_ua_groups = []
        for ua_norm, accs in ua_to_users.items():
            if len(accs) < 2:
                continue
            all_ips = set()
            for a in accs:
                all_ips.update(a.get("all_ips") or [])
            if len(all_ips) < 2:
                continue
            sample_raw = ua_raw_sample.get(ua_norm, ua_norm)
            risk_score = compute_dupe_risk_score("same_ua", len(accs), has_same_device=True)
            same_ua_groups.append({
                "user_agent": ua_norm[:120] + ("..." if len(ua_norm) > 120 else ""),
                "user_agent_full": sample_raw[:200] + ("..." if len(sample_raw) > 200 else ""),
                "account_count": len(accs),
                "distinct_ip_count": len(all_ips),
                "accounts": accs,
                "risk_score": risk_score,
            })
        same_ua_groups.sort(key=lambda g: (-g["risk_score"], -g["account_count"]))

        domain_groups = group_by_domain(users)
        name_groups = group_by_similar_username_strip_digits(users)
        fuzzy_groups = group_by_fuzzy_username(users)
        similar_email_groups = group_by_similar_email(users)
        same_day_ip_groups = group_by_same_day_same_ip(users)
        for g in domain_groups:
            g["risk_score"] = compute_dupe_risk_score("domain", g["count"])
        for g in name_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_username", g["count"])
        for g in fuzzy_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_username", g["count"])
        for g in similar_email_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_email", g["count"])
        for g in same_day_ip_groups:
            g["risk_score"] = compute_dupe_risk_score("same_day_ip", g["count"])

        registration_burst_groups = group_by_registration_ip_burst(users, max_hours=registration_burst_hours)
        for g in registration_burst_groups:
            g["risk_score"] = compute_dupe_risk_score("registration_burst", g["count"])
        referral_same_ip_groups = group_by_referral_same_ip(users)
        id_to_user = {u["id"]: u for u in users}
        need_ref_ids = {g["referred_by"] for g in referral_same_ip_groups if g.get("referred_by") and g["referred_by"] not in id_to_user}
        ref_username_map: Dict[str, str] = {}
        if need_ref_ids:
            ref_docs = await db.users.find(
                {"id": {"$in": list(need_ref_ids)}},
                {"_id": 0, "id": 1, "username": 1},
            ).to_list(len(need_ref_ids))
            ref_username_map = {r["id"]: (r.get("username") or "") for r in ref_docs}
        for g in referral_same_ip_groups:
            rid = g.get("referred_by")
            g["referred_by_username"] = (id_to_user.get(rid) or {}).get("username") or ref_username_map.get(rid) or None
            g["risk_score"] = compute_dupe_risk_score("referral_same_ip", g["count"])

        ip_vpn: Dict[str, bool] = {}
        if check_vpn and same_ip_groups:
            unique_ips = set()
            for g in same_ip_groups:
                unique_ips.add(g["ip"])
            to_check = list(unique_ips)[:max_vpn_checks]
            for ip in to_check:
                try:
                    ip_vpn[ip] = await is_proxy_or_vpn(ip)
                except Exception:
                    ip_vpn[ip] = False
                await asyncio.sleep(0.15)
        for g in same_ip_groups:
            g["ip_vpn"] = ip_vpn.get(g["ip"], False)
            if g.get("ip_vpn"):
                g["risk_score"] = min(100, g["risk_score"] + 10)

        # Proxy/VPN users: users whose IPs are detected as VPN/proxy (beyond same_ip_groups)
        proxy_users_list: List[dict] = []
        if check_vpn:
            all_unique_ips = set()
            for u in users:
                ips, _ = _all_ips(u)
                all_unique_ips.update(ips)
            ips_to_check = [ip for ip in all_unique_ips if ip not in ip_vpn][:max_vpn_checks]
            for ip in ips_to_check:
                try:
                    ip_vpn[ip] = await is_proxy_or_vpn(ip)
                except Exception:
                    ip_vpn[ip] = False
                await asyncio.sleep(0.15)
            vpn_ips = {ip for ip, v in ip_vpn.items() if v}
            seen_proxy_ids = set()
            for u in users:
                ips, sources = _all_ips(u)
                vpn_used = [ip for ip in ips if ip in vpn_ips]
                if vpn_used and u.get("id") not in seen_proxy_ids:
                    seen_proxy_ids.add(u["id"])
                    proxy_users_list.append({
                        "id": u["id"],
                        "username": u.get("username"),
                        "email": u.get("email"),
                        "created_at": u.get("created_at"),
                        "vpn_ips": vpn_used,
                        "registration_from_vpn": bool(sources.get("registration") and sources["registration"] in vpn_ips),
                    })
        proxy_users_list.sort(key=lambda x: (-int(x.get("registration_from_vpn", False)), x.get("created_at") or ""))

        now_utc = datetime.now(timezone.utc)
        user_ids = [u["id"] for u in users]
        living_ip_set: Set[str] = set()
        for u in users:
            ips, _ = _all_ips(u)
            living_ip_set.update(ips)

        alive_dead_ip_groups: List[dict] = []
        if include_dead_ip and living_ip_set:
            dead_pair_seen: Set[Tuple[str, str]] = set()
            dead_by_ip: Dict[str, List[dict]] = defaultdict(list)
            ip_list = sorted(living_ip_set)
            for i in range(0, len(ip_list), 400):
                chunk = ip_list[i : i + 400]
                dead_docs = await db.users.find(
                    {
                        "is_dead": True,
                        "$or": [{"registration_ip": {"$in": chunk}}, {"login_ips": {"$in": chunk}}],
                    },
                    {"_id": 0, "id": 1, "username": 1, "registration_ip": 1, "login_ips": 1, "dead_at": 1, "created_at": 1},
                ).to_list(2500)
                for d in dead_docs:
                    d_ips: Set[str] = set()
                    ri = (d.get("registration_ip") or "").strip()
                    if ri:
                        d_ips.add(ri)
                    for x in d.get("login_ips") or []:
                        xs = (x or "").strip()
                        if xs:
                            d_ips.add(xs)
                    for ip in d_ips:
                        if ip not in living_ip_set:
                            continue
                        key = (ip, d["id"])
                        if key in dead_pair_seen:
                            continue
                        dead_pair_seen.add(key)
                        dead_by_ip[ip].append({
                            "id": d["id"],
                            "username": d.get("username"),
                            "dead_at": d.get("dead_at"),
                            "created_at": d.get("created_at"),
                        })
            for ip, dead_accs in dead_by_ip.items():
                raw_alive = ip_to_accounts.get(ip) or []
                by_aid = {}
                for a in raw_alive:
                    uid = a.get("id")
                    if uid and uid not in by_aid:
                        by_aid[uid] = {
                            "id": a["id"],
                            "username": a["username"],
                            "email": a["email"],
                            "created_at": a["created_at"],
                            "all_ips": a["all_ips"],
                            "role_at_this_ip": a.get("role_at_this_ip"),
                        }
                alive_accs = list(by_aid.values())
                if len(alive_accs) < 1 or len(dead_accs) < 1:
                    continue
                n = len(alive_accs) + len(dead_accs)
                alive_dead_ip_groups.append({
                    "ip": ip,
                    "alive_accounts": alive_accs,
                    "dead_accounts": dead_accs[:25],
                    "alive_count": len(alive_accs),
                    "dead_count": len(dead_accs),
                    "risk_score": compute_dupe_risk_score("dead_ip_overlap", n),
                })
            alive_dead_ip_groups.sort(key=lambda g: (-g["risk_score"], -g["alive_count"], -g["dead_count"]))

        susp_cut = (now_utc - timedelta(days=suspicious_days)).isoformat()
        sl_docs = await db.suspicious_logins.find(
            {"at": {"$gte": susp_cut}},
            {"_id": 0, "ip": 1, "at": 1, "reason": 1, "login_input": 1, "username": 1, "user_id": 1},
        ).sort("at", -1).limit(suspicious_limit).to_list(suspicious_limit)
        high_reasons = frozenset({"no_account_same_ip_alive", "wrong_password_same_ip_other_alive"})
        ip_events: Dict[str, List[dict]] = defaultdict(list)
        for doc in sl_docs:
            sip = (doc.get("ip") or "").strip()
            if sip:
                ip_events[sip].append(doc)
        suspicious_ip_correlations: List[dict] = []
        for sip, events in ip_events.items():
            if len(events) < 2 and not any(e.get("reason") in high_reasons for e in events):
                continue
            raw_alive = ip_to_accounts.get(sip) or []
            by_aid = {}
            for a in raw_alive:
                uid = a.get("id")
                if uid and uid not in by_aid:
                    by_aid[uid] = {
                        "id": a["id"],
                        "username": a["username"],
                        "email": a["email"],
                        "created_at": a["created_at"],
                        "all_ips": a["all_ips"],
                        "role_at_this_ip": a.get("role_at_this_ip"),
                    }
            alive_accs = list(by_aid.values())
            if not alive_accs:
                continue
            sample = events[:8]
            suspicious_ip_correlations.append({
                "ip": sip,
                "event_count": len(events),
                "sample_events": [
                    {"at": e.get("at"), "reason": e.get("reason"), "login_input": e.get("login_input"), "username": e.get("username")}
                    for e in sample
                ],
                "correlated_alive_accounts": alive_accs[:12],
                "risk_score": compute_dupe_risk_score("suspicious_ip", len(events)),
            })
        suspicious_ip_correlations.sort(key=lambda g: (-g["risk_score"], -g["event_count"]))

        transfer_cut = (now_utc - timedelta(days=transfer_days)).isoformat()
        xfer_pipe = [
            {"$match": {"created_at": {"$gte": transfer_cut}}},
            {"$group": {"_id": {"from": "$from_user_id", "to": "$to_user_id"}, "transfer_count": {"$sum": 1}}},
            {"$match": {"transfer_count": {"$gte": transfer_min_count}}},
            {"$sort": {"transfer_count": -1}},
            {"$limit": transfer_limit},
        ]
        xfer_agg = await db.money_transfers.aggregate(xfer_pipe).to_list(transfer_limit)
        uid_ips: Dict[str, Set[str]] = {}
        for u in users:
            ips, _ = _all_ips(u)
            uid_ips[u["id"]] = set(ips)
        heavy_transfer_pairs: List[dict] = []
        for row in xfer_agg:
            ids = row.get("_id") or {}
            fid = ids.get("from")
            tid = ids.get("to")
            if not fid or not tid or fid == tid:
                continue
            cnt = int(row.get("transfer_count") or 0)
            s1 = uid_ips.get(fid, set())
            s2 = uid_ips.get(tid, set())
            overlap = sorted(s1 & s2)[:15]
            u1 = id_to_user.get(fid) or {}
            u2 = id_to_user.get(tid) or {}
            heavy_transfer_pairs.append({
                "from_user_id": fid,
                "to_user_id": tid,
                "from_username": u1.get("username"),
                "to_username": u2.get("username"),
                "transfer_count": cnt,
                "shared_ips": overlap,
                "shared_ip_count": len(s1 & s2),
                "risk_score": compute_dupe_risk_score("heavy_transfers", cnt),
            })

        prereg_ip_cross_accounts: List[dict] = []
        if include_prereg_cross and users:
            emails_lower = []
            for u in users:
                em = (u.get("email") or "").strip().lower()
                if em:
                    emails_lower.append(em)
            emails_lower = list(dict.fromkeys(emails_lower))
            if emails_lower:
                email_prereg_ip: Dict[str, str] = {}
                for j in range(0, len(emails_lower), 400):
                    ch = emails_lower[j : j + 400]
                    prs = await db.preregistrations.find(
                        {"email": {"$in": ch}},
                        {"_id": 0, "email": 1, "ip": 1, "created_at": 1},
                    ).to_list(800)
                    for pr in prs:
                        e = (pr.get("email") or "").strip().lower()
                        p = (pr.get("ip") or "").strip()
                        if e and p:
                            email_prereg_ip[e] = p
                ip_to_uids: Dict[str, Set[str]] = defaultdict(set)
                for u in users:
                    uid = u["id"]
                    ips, _ = _all_ips(u)
                    for ip in ips:
                        ip_to_uids[ip].add(uid)
                for u in users:
                    em = (u.get("email") or "").strip().lower()
                    if not em or em not in email_prereg_ip:
                        continue
                    pr_ip = email_prereg_ip[em]
                    others = ip_to_uids.get(pr_ip, set()) - {u["id"]}
                    if others:
                        olist = list(others)[:15]
                        prereg_ip_cross_accounts.append({
                            "user_id": u["id"],
                            "username": u.get("username"),
                            "email": em,
                            "prereg_ip": pr_ip,
                            "other_user_ids": olist,
                            "risk_score": compute_dupe_risk_score("prereg_ip_cross", 1 + len(olist)),
                        })
                prereg_ip_cross_accounts.sort(key=lambda g: (-g["risk_score"], g.get("username") or ""))

        alive_dead_fingerprint_groups: List[dict] = []
        if include_dead_fingerprint:
            living_fp_set: Set[str] = set()
            fp_to_living: Dict[str, List[dict]] = defaultdict(list)
            for u in users:
                fp = (u.get("device_fingerprint") or "").strip()
                if not fp:
                    continue
                living_fp_set.add(fp)
                ips, _ = _all_ips(u)
                fp_to_living[fp].append({
                    "id": u["id"],
                    "username": u.get("username"),
                    "email": u.get("email"),
                    "created_at": u.get("created_at"),
                    "all_ips": sorted(ips),
                })
            fp_list = sorted(living_fp_set)
            dead_fp_seen: Set[Tuple[str, str]] = set()
            dead_by_fp: Dict[str, List[dict]] = defaultdict(list)
            for i in range(0, len(fp_list), 200):
                chunk = fp_list[i : i + 200]
                ddocs = await db.users.find(
                    {"is_dead": True, "device_fingerprint": {"$in": chunk}},
                    {"_id": 0, "id": 1, "username": 1, "device_fingerprint": 1, "dead_at": 1, "created_at": 1},
                ).to_list(1500)
                for d in ddocs:
                    fp = (d.get("device_fingerprint") or "").strip()
                    if fp not in living_fp_set:
                        continue
                    key = (fp, d["id"])
                    if key in dead_fp_seen:
                        continue
                    dead_fp_seen.add(key)
                    dead_by_fp[fp].append({
                        "id": d["id"],
                        "username": d.get("username"),
                        "dead_at": d.get("dead_at"),
                        "created_at": d.get("created_at"),
                        "device_fingerprint": fp[:24] + ("..." if len(fp) > 24 else ""),
                    })
            for fp, dead_accs in dead_by_fp.items():
                live_accs = fp_to_living.get(fp) or []
                if len(live_accs) < 1 or len(dead_accs) < 1:
                    continue
                n = len(live_accs) + len(dead_accs)
                alive_dead_fingerprint_groups.append({
                    "device_fingerprint": fp[:32] + ("..." if len(fp) > 32 else ""),
                    "alive_accounts": live_accs[:15],
                    "dead_accounts": dead_accs[:20],
                    "risk_score": compute_dupe_risk_score("dead_fingerprint_overlap", n, has_same_device=True),
                })
            alive_dead_fingerprint_groups.sort(key=lambda g: (-g["risk_score"], -len(g["alive_accounts"])))

        users_with_security_flags: List[dict] = []
        if include_security_flags and user_ids:
            fc = (now_utc - timedelta(days=flags_days)).isoformat()
            fl_docs = await db.security_flags.find(
                {"user_id": {"$in": user_ids}, "created_at": {"$gte": fc}, "resolved": {"$ne": True}},
                {"_id": 0, "user_id": 1, "flag_type": 1, "reason": 1, "created_at": 1},
            ).limit(8000).to_list(8000)
            by_uid: Dict[str, List[dict]] = defaultdict(list)
            for f in fl_docs:
                uid = f.get("user_id")
                if uid:
                    by_uid[uid].append({
                        "flag_type": f.get("flag_type"),
                        "reason": f.get("reason"),
                        "created_at": f.get("created_at"),
                    })
            for uid, items in by_uid.items():
                u0 = id_to_user.get(uid) or {}
                users_with_security_flags.append({
                    "user_id": uid,
                    "username": u0.get("username"),
                    "flag_count": len(items),
                    "flags": items[:12],
                    "risk_score": compute_dupe_risk_score("security_flag_user", len(items)),
                })
            users_with_security_flags.sort(key=lambda g: (-g["risk_score"], -g["flag_count"]))

        password_reset_heavy_users: List[dict] = []
        if include_password_resets and user_ids:
            pr_cut = (now_utc - timedelta(days=password_reset_days)).isoformat()
            pr_docs = await db.password_resets.find(
                {"user_id": {"$in": user_ids}, "created_at": {"$gte": pr_cut}},
                {"_id": 0, "user_id": 1},
            ).limit(20000).to_list(20000)
            pr_count: Dict[str, int] = defaultdict(int)
            for p in pr_docs:
                uid = p.get("user_id")
                if uid:
                    pr_count[uid] += 1
            for uid, c in pr_count.items():
                if c < password_reset_min:
                    continue
                u0 = id_to_user.get(uid) or {}
                password_reset_heavy_users.append({
                    "user_id": uid,
                    "username": u0.get("username"),
                    "reset_count": c,
                    "risk_score": compute_dupe_risk_score("password_reset_heavy", c),
                })
            password_reset_heavy_users.sort(key=lambda g: (-g["risk_score"], -g["reset_count"]))

        return {
            "same_ip_groups": same_ip_groups[:80],
            "total_same_ip_groups": len(same_ip_groups),
            "same_subnet_groups": same_subnet_groups[:40],
            "total_same_subnet_groups": len(same_subnet_groups),
            "same_fingerprint_groups": same_fingerprint_groups[:30],
            "total_same_fingerprint_groups": len(same_fingerprint_groups),
            "same_user_agent_groups": same_ua_groups[:50],
            "total_same_ua_groups": len(same_ua_groups),
            "by_domain": domain_groups[:50],
            "by_similar_username": name_groups[:50],
            "by_fuzzy_username": fuzzy_groups[:30],
            "by_similar_email": similar_email_groups[:50],
            "by_same_day_same_ip": same_day_ip_groups[:30],
            "ip_vpn": ip_vpn,
            "proxy_users": proxy_users_list[:100],
            "total_proxy_users": len(proxy_users_list),
            "ip_union_includes_sessions": include_session_ips,
            "alive_dead_ip_groups": alive_dead_ip_groups[:40],
            "total_alive_dead_ip_groups": len(alive_dead_ip_groups),
            "suspicious_ip_correlations": suspicious_ip_correlations[:45],
            "total_suspicious_ip_correlations": len(suspicious_ip_correlations),
            "registration_burst_groups": registration_burst_groups[:35],
            "total_registration_burst_groups": len(registration_burst_groups),
            "referral_same_ip_groups": referral_same_ip_groups[:40],
            "total_referral_same_ip_groups": len(referral_same_ip_groups),
            "heavy_transfer_pairs": heavy_transfer_pairs[:transfer_limit],
            "total_heavy_transfer_pairs": len(heavy_transfer_pairs),
            "prereg_ip_cross_accounts": prereg_ip_cross_accounts[:80],
            "total_prereg_ip_cross_accounts": len(prereg_ip_cross_accounts),
            "alive_dead_fingerprint_groups": alive_dead_fingerprint_groups[:35],
            "total_alive_dead_fingerprint_groups": len(alive_dead_fingerprint_groups),
            "users_with_security_flags": users_with_security_flags[:80],
            "total_users_with_security_flags": len(users_with_security_flags),
            "password_reset_heavy_users": password_reset_heavy_users[:60],
            "total_password_reset_heavy_users": len(password_reset_heavy_users),
        }

    def _normalize_user_agent(ua: str) -> str:
        """Strip version numbers (e.g. /121.0.0.0) so same browser different version groups together."""
        if not ua or not ua.strip():
            return ua or ""
        return re.sub(r"/\d+[\d.]*", "", ua.strip())

    @router.get("/admin/cheat-detection/same-device-different-ips")
    async def admin_cheat_same_device_different_ips(current_user: dict = Depends(get_current_user)):
        """
        Find users who share the same browser/device (last_user_agent or device_fingerprint) but use different IPs.
        UA is normalized (version numbers stripped). Also includes device_fingerprint groups.
        Admin or moderator only.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        users = await db.users.find(
            {"is_dead": {"$ne": True}},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "login_ips": 1, "last_login_ip": 1, "last_request_ip": 1, "last_user_agent": 1, "device_fingerprint": 1},
        ).to_list(10000)

        def _get_ips(u):
            ips = set()
            for key in ("registration_ip", "last_login_ip", "last_request_ip"):
                v = (u.get(key) or "").strip()
                if v:
                    ips.add(v)
            for lip in (u.get("login_ips") or []):
                lip = (lip or "").strip()
                if lip:
                    ips.add(lip)
            return sorted(ips)

        ua_to_users = {}
        ua_raw_sample = {}
        for u in users:
            ua_raw = (u.get("last_user_agent") or "").strip()
            if not ua_raw:
                continue
            ua_norm = _normalize_user_agent(ua_raw)
            if not ua_norm:
                continue
            if ua_norm not in ua_raw_sample:
                ua_raw_sample[ua_norm] = ua_raw
            summary = {"id": u["id"], "username": u.get("username"), "email": u.get("email"), "ips": _get_ips(u)}
            ua_to_users.setdefault(ua_norm, []).append(summary)
        groups = []
        for ua_norm, accs in ua_to_users.items():
            if len(accs) < 2:
                continue
            all_ips = set()
            for a in accs:
                all_ips.update(a["ips"])
            if len(all_ips) < 2:
                continue
            sample_raw = ua_raw_sample.get(ua_norm, ua_norm)
            risk_score = compute_dupe_risk_score("same_ua", len(accs), has_same_device=True)
            groups.append({
                "user_agent": ua_norm[:120] + ("..." if len(ua_norm) > 120 else ""),
                "user_agent_full": sample_raw[:200] + ("..." if len(sample_raw) > 200 else ""),
                "users": accs,
                "account_count": len(accs),
                "distinct_ip_count": len(all_ips),
                "risk_score": risk_score,
                "device_type": "user_agent",
            })
        fp_to_users = {}
        for u in users:
            fp = (u.get("device_fingerprint") or "").strip()
            if not fp:
                continue
            summary = {"id": u["id"], "username": u.get("username"), "email": u.get("email"), "ips": _get_ips(u)}
            fp_to_users.setdefault(fp, []).append(summary)
        for fp, accs in fp_to_users.items():
            if len(accs) < 2:
                continue
            all_ips = set()
            for a in accs:
                all_ips.update(a["ips"])
            if len(all_ips) < 2:
                continue
            risk_score = compute_dupe_risk_score("same_ua", len(accs), has_same_device=True)
            groups.append({
                "user_agent": f"Fingerprint:{fp[:24]}...",
                "user_agent_full": fp[:64] + ("..." if len(fp) > 64 else ""),
                "users": accs,
                "account_count": len(accs),
                "distinct_ip_count": len(all_ips),
                "risk_score": risk_score,
                "device_type": "fingerprint",
            })
        groups.sort(key=lambda g: (-g["risk_score"], -g["account_count"]))
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
            query["$or"] = [{"is_npc": True}, {"is_bodyguard": True}]
        elif filter_type == "non_npc":
            query["$and"] = [
                {"$or": [{"is_npc": {"$ne": True}}, {"is_npc": {"$exists": False}}]},
                {"$or": [{"is_bodyguard": {"$ne": True}}, {"is_bodyguard": {"$exists": False}}]},
            ]
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
            {"_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "is_bodyguard": 1, "is_npc": 1, "created_at": 1, "email_verified": 1},
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
                "is_npc": bool(u.get("is_npc")),
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

    @router.post("/admin/set-casino-max-bet")
    async def admin_set_casino_max_bet(body: AdminSetCasinoMaxBetRequest, current_user: dict = Depends(get_current_user)):
        """Set max bet for a casino game type. Admin only.
        game_type: dice, roulette, blackjack, horseracing, videopoker, slots, or 'all'
        location: specific city/state, or None/empty to apply to all locations
        max_bet: the new max bet value
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        game_type = (body.game_type or "").strip().lower()
        location = (body.location or "").strip() if body.location else None
        max_bet = body.max_bet
        if max_bet < 1:
            raise HTTPException(status_code=400, detail="max_bet must be at least 1")
        coll_map = {
            "dice": (db.dice_ownership, "city"),
            "roulette": (db.roulette_ownership, "city"),
            "blackjack": (db.blackjack_ownership, "city"),
            "horseracing": (db.horseracing_ownership, "city"),
            "videopoker": (db.videopoker_ownership, "city"),
            "slots": (db.slots_ownership, "state"),
        }
        results = {}
        
        async def upsert_all_locations(coll, loc_key, gtype):
            """Upsert max_bet for all cities/states so unclaimed casinos also get updated."""
            count = 0
            for loc in (STATES or []):
                res = await coll.update_one(
                    {loc_key: loc},
                    {"$set": {"max_bet": max_bet}},
                    upsert=True
                )
                if res.modified_count or res.upserted_id:
                    count += 1
            return count
        
        if game_type == "all":
            for gtype, (coll, loc_key) in coll_map.items():
                if location:
                    res = await coll.update_one({loc_key: location}, {"$set": {"max_bet": max_bet}}, upsert=True)
                    results[gtype] = 1 if (res.modified_count or res.upserted_id) else 0
                else:
                    results[gtype] = await upsert_all_locations(coll, loc_key, gtype)
            total = sum(results.values())
            logging.info(f"Admin set casino max bet (all games): max_bet={max_bet}, location={location or 'all'}, by {current_user.get('email')}, modified={results}")
            return {"message": f"Set max bet to ${max_bet:,} for all casino types", "location": location or "all", "max_bet": max_bet, "details": results, "total_modified": total}
        if game_type not in coll_map:
            raise HTTPException(status_code=400, detail="Invalid game_type; use dice, roulette, blackjack, horseracing, videopoker, slots, or 'all'")
        coll, loc_key = coll_map[game_type]
        if location:
            res = await coll.update_one({loc_key: location}, {"$set": {"max_bet": max_bet}}, upsert=True)
            count = 1 if (res.modified_count or res.upserted_id) else 0
        else:
            count = await upsert_all_locations(coll, loc_key, game_type)
        logging.info(f"Admin set casino max bet: game_type={game_type}, max_bet={max_bet}, location={location or 'all'}, by {current_user.get('email')}, modified={count}")
        return {"message": f"Set max bet to ${max_bet:,} for {game_type}", "game_type": game_type, "location": location or "all", "max_bet": max_bet, "modified": count}

    @router.get("/admin/casino-max-bets")
    async def admin_get_casino_max_bets(current_user: dict = Depends(get_current_user)):
        """Get current max bets for all casino types by location. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        coll_map = {
            "dice": (db.dice_ownership, "city"),
            "roulette": (db.roulette_ownership, "city"),
            "blackjack": (db.blackjack_ownership, "city"),
            "horseracing": (db.horseracing_ownership, "city"),
            "videopoker": (db.videopoker_ownership, "city"),
            "slots": (db.slots_ownership, "state"),
        }
        result = {}
        for gtype, (coll, loc_key) in coll_map.items():
            docs = await coll.find({}, {"_id": 0, loc_key: 1, "max_bet": 1, "owner_username": 1}).to_list(100)
            result[gtype] = [{"location": d.get(loc_key), "max_bet": d.get("max_bet"), "owner": d.get("owner_username")} for d in docs]
        return result

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
        # Wipe every collection in this database (except system.* and optional PRESERVE_COLLECTIONS), then re-seed.
        _preserve_raw = (os.environ.get("PRESERVE_COLLECTIONS") or "").strip()
        preserve_set = {x.strip() for x in _preserve_raw.split(",") if x.strip()}
        skipped_system = []
        skipped_preserved = []
        deleted = {}
        try:
            all_names = await db.list_collection_names()
        except Exception as e:
            logging.exception("database-fresh: list_collection_names failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Could not list database collections: {e}") from e
        for coll_name in sorted(all_names):
            if coll_name.startswith("system."):
                skipped_system.append(coll_name)
                continue
            if coll_name in preserve_set:
                skipped_preserved.append(coll_name)
                logging.warning("database-fresh: preserving collection %s (PRESERVE_COLLECTIONS)", coll_name)
                continue
            try:
                res = await db[coll_name].delete_many({})
                deleted[coll_name] = res.deleted_count
                logging.info(
                    "database-fresh: wiped collection=%s deleted_count=%s",
                    coll_name,
                    res.deleted_count,
                )
            except Exception as e:
                logging.warning("database-fresh: skip %s: %s", coll_name, e)
                deleted[coll_name] = 0
        total = sum(deleted.values())
        wipe_meta = {
            "skipped_system_collections": skipped_system,
            "skipped_preserved_collections": skipped_preserved,
        }
        logging.warning(
            "database-fresh: wipe phase done collections=%s total_docs_deleted=%s preserved=%s system_skipped=%s",
            len(deleted),
            total,
            len(skipped_preserved),
            len(skipped_system),
        )
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
                "wipe_meta": wipe_meta,
                "reseed_ok": False,
            }
        logging.warning(f"🚨 DATABASE FRESH completed by {current_user['email']}: {total} docs deleted, game data re-seeded")
        return {
            "message": f"Database reset complete. {total} documents deleted. Game data re-seeded. New release ready.",
            "details": deleted,
            "wipe_meta": wipe_meta,
            "reseed_ok": True,
        }

    @router.post("/admin/delete-user/{user_id}")
    async def admin_delete_single_user(user_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (user_id or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="User ID or username required")
        user = await db.users.find_one({"id": raw}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            username_pattern = re.compile("^" + re.escape(raw) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        resolved_id = user["id"]
        deleted = {}
        username = user.get("username", "?")
        deleted["user"] = (await db.users.delete_one({"id": resolved_id})).deleted_count
        deleted["family_members"] = (await db.family_members.delete_many({"user_id": resolved_id})).deleted_count
        deleted["bodyguards"] = (await db.bodyguards.delete_many({"$or": [{"user_id": resolved_id}, {"bodyguard_user_id": resolved_id}]})).deleted_count
        deleted["bodyguard_invites"] = (await db.bodyguard_invites.delete_many({"$or": [{"from_user_id": resolved_id}, {"to_user_id": resolved_id}]})).deleted_count
        deleted["user_cars"] = (await db.user_cars.delete_many({"user_id": resolved_id})).deleted_count
        deleted["user_properties"] = (await db.user_properties.delete_many({"user_id": resolved_id})).deleted_count
        deleted["user_weapons"] = (await db.user_weapons.delete_many({"user_id": resolved_id})).deleted_count
        deleted["attacks"] = (await db.attacks.delete_many({"$or": [{"attacker_id": resolved_id}, {"target_id": resolved_id}]})).deleted_count
        deleted["notifications"] = (await db.notifications.delete_many({"user_id": resolved_id})).deleted_count
        deleted["extortions"] = (await db.extortions.delete_many({"$or": [{"extorter_id": resolved_id}, {"target_id": resolved_id}]})).deleted_count
        deleted["sports_bets"] = (await db.sports_bets.delete_many({"user_id": resolved_id})).deleted_count
        deleted["blackjack_games"] = (await db.blackjack_games.delete_many({"user_id": resolved_id})).deleted_count
        deleted["dice_ownership"] = (await db.dice_ownership.update_many({"owner_id": resolved_id}, {"$set": {"owner_id": None, "owner_username": None}})).modified_count
        deleted["dice_buy_back_offers"] = (await db.dice_buy_back_offers.delete_many({"$or": [{"from_owner_id": resolved_id}, {"to_user_id": resolved_id}]})).deleted_count
        deleted["slots_ownership"] = (await db.slots_ownership.update_many({"owner_id": resolved_id}, {"$set": {"owner_id": None, "owner_username": None}})).modified_count
        await db.slots_entries.update_many({}, {"$pull": {"user_ids": resolved_id}})
        deleted["slots_buy_back_offers"] = (await db.slots_buy_back_offers.delete_many({"$or": [{"from_owner_id": resolved_id}, {"to_user_id": resolved_id}]})).deleted_count
        deleted["interest_deposits"] = (await db.interest_deposits.delete_many({"user_id": resolved_id})).deleted_count
        deleted["family_war_stats"] = (await db.family_war_stats.delete_many({"user_id": resolved_id})).deleted_count
        total = sum(deleted.values())
        return {"message": f"Deleted user '{username}' and {total} related documents", "details": deleted}

    @router.get("/admin/families-list")
    async def admin_families_list(current_user: dict = Depends(get_current_user)):
        """List all families (including wiped) for admin dropdown. Returns id, name, tag, wiped."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        fams = await db.families.find({}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "wiped": 1}).sort("name", 1).to_list(50)
        return {"families": [{"id": f["id"], "name": f.get("name", "?"), "tag": f.get("tag", "?"), "wiped": bool(f.get("wiped"))} for f in fams]}

    @router.post("/admin/delete-family")
    async def admin_delete_family(request: DeleteFamilyRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        family_id = (request.family_id or "").strip()
        if not family_id:
            raise HTTPException(status_code=400, detail="Family ID required")
        fam = await db.families.find_one({"id": family_id}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "head_of_state": 1})
        if not fam:
            raise HTTPException(status_code=404, detail="Family not found")
        set_state_head = srv.set_state_head
        head_state = (fam.get("head_of_state") or "").strip()
        if head_state:
            await set_state_head(head_state, None)
        member_ids = [m["user_id"] for m in await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(500)]
        await db.users.update_many({"id": {"$in": member_ids}}, {"$set": {"family_id": None, "family_role": None}})
        deleted = {}
        deleted["family_members"] = (await db.family_members.delete_many({"family_id": family_id})).deleted_count
        deleted["family_wars"] = (await db.family_wars.delete_many({"$or": [{"family_a_id": family_id}, {"family_b_id": family_id}]})).deleted_count
        deleted["family_war_stats"] = (await db.family_war_stats.delete_many({"family_id": family_id})).deleted_count
        deleted["family_racket_attacks"] = (await db.family_racket_attacks.delete_many({"$or": [{"attacker_family_id": family_id}, {"target_family_id": family_id}]})).deleted_count
        deleted["family_crew_oc_applications"] = (await db.family_crew_oc_applications.delete_many({"family_id": family_id})).deleted_count
        deleted["family_join_applications"] = (await db.family_join_applications.delete_many({"family_id": family_id})).deleted_count
        deleted["families"] = (await db.families.delete_one({"id": family_id})).deleted_count
        try:
            from routers.game.families import _invalidate_list_cache
            _invalidate_list_cache()
        except Exception:
            pass
        total = sum(deleted.values())
        return {"message": f"Deleted family '{fam.get('name', '?')}' [{fam.get('tag', '?')}] and {total} related documents", "details": deleted}

    @router.post("/admin/wipe-all-families")
    async def admin_wipe_all_families(confirm: WipeAllFamiliesConfirmation, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if confirm.confirmation_text != "WIPE ALL FAMILIES":
            raise HTTPException(
                status_code=400,
                detail='Confirmation required. Send {"confirmation_text": "WIPE ALL FAMILIES"} to confirm.',
            )
        logging.warning(f"🚨 WIPE ALL FAMILIES initiated by {current_user['email']} ({current_user['username']})")
        set_state_head = srv.set_state_head
        for state in (STATES or []):
            await set_state_head(state, None)
        await db.users.update_many({}, {"$set": {"family_id": None, "family_role": None}})
        deleted = {}
        deleted["family_members"] = (await db.family_members.delete_many({})).deleted_count
        deleted["family_wars"] = (await db.family_wars.delete_many({})).deleted_count
        deleted["family_war_stats"] = (await db.family_war_stats.delete_many({})).deleted_count
        deleted["family_racket_attacks"] = (await db.family_racket_attacks.delete_many({})).deleted_count
        deleted["family_crew_oc_applications"] = (await db.family_crew_oc_applications.delete_many({})).deleted_count
        deleted["family_join_applications"] = (await db.family_join_applications.delete_many({})).deleted_count
        deleted["families"] = (await db.families.delete_many({})).deleted_count
        try:
            from routers.game.families import _invalidate_list_cache
            _invalidate_list_cache()
        except Exception:
            pass
        total = sum(deleted.values())
        logging.warning(f"🚨 WIPE ALL FAMILIES completed by {current_user['email']}: {total} documents deleted")
        return {"message": f"All families wiped ({total} documents deleted) and users cleared from crews", "details": deleted}

    @router.get("/admin/events")
    async def admin_get_events(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = await get_events_enabled()
        all_for_testing = await get_all_events_for_testing()
        today_event = get_combined_event() if all_for_testing else (await get_active_game_event_async() if enabled else None)
        disabled_ids = await get_disabled_event_ids()
        override_event_id = await get_override_event_id()
        events = [
            {"id": ev["id"], "name": ev["name"], "message": ev.get("message", ""), "enabled": ev["id"] not in disabled_ids}
            for ev in GAME_EVENTS
        ]
        return {"events_enabled": enabled, "all_events_for_testing": all_for_testing, "today_event": today_event, "events": events, "override_event_id": override_event_id}

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

    @router.post("/admin/events/toggle-event")
    async def admin_toggle_event(request: ToggleEventRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        event_id = (request.event_id or "").strip()
        if not event_id:
            raise HTTPException(status_code=400, detail="event_id required")
        valid_ids = {ev["id"] for ev in GAME_EVENTS}
        if event_id not in valid_ids:
            raise HTTPException(status_code=400, detail="Unknown event_id")
        enabled = request.enabled
        if enabled:
            await db.game_config.update_one(
                {"id": "main"},
                {"$pull": {"disabled_event_ids": event_id}},
                upsert=True,
            )
        else:
            await db.game_config.update_one(
                {"id": "main"},
                {"$addToSet": {"disabled_event_ids": event_id}},
                upsert=True,
            )
        disabled_ids = await get_disabled_event_ids()
        return {"message": f"Event '{event_id}' " + ("enabled" if enabled else "disabled"), "disabled_event_ids": disabled_ids}

    @router.post("/admin/events/random-event")
    async def admin_random_event(request: RandomEventRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        valid_ids = {ev["id"] for ev in GAME_EVENTS}
        pool = request.event_ids if request.event_ids else []
        if not pool:
            pool = list(valid_ids)
        else:
            pool = [str(x).strip() for x in pool if str(x).strip() in valid_ids]
        if not pool:
            raise HTTPException(status_code=400, detail="No valid events to choose from")
        chosen_id = random.choice(pool)
        await db.game_config.update_one(
            {"id": "main"},
            {"$set": {"override_event_id": chosen_id}},
            upsert=True,
        )
        chosen = next((ev for ev in GAME_EVENTS if ev["id"] == chosen_id), None)
        return {"message": f"Random event set: {chosen['name'] if chosen else chosen_id}", "event": chosen.copy() if chosen else {"id": chosen_id}, "override_event_id": chosen_id}

    @router.post("/admin/events/clear-override")
    async def admin_clear_event_override(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        await db.game_config.update_one(
            {"id": "main"},
            {"$unset": {"override_event_id": ""}},
        )
        return {"message": "Event override cleared; daily rotation applies again", "override_event_id": None}

    def _redeem_forum_reward_lines(reward_dict: dict) -> List[str]:
        lines: List[str] = []
        if reward_dict.get("money"):
            lines.append(f"${int(reward_dict['money']):,} cash")
        if reward_dict.get("points"):
            lines.append(f"{int(reward_dict['points']):,} points")
        if reward_dict.get("respect_points"):
            lines.append(f"{int(reward_dict['respect_points']):,} respect")
        if reward_dict.get("loot_box_pieces"):
            lines.append(f"{int(reward_dict['loot_box_pieces'])} loot box pieces")
        for car_id in reward_dict.get("cars") or []:
            car_info = next((c for c in CARS if c.get("id") == car_id), None)
            lines.append(car_info.get("name", car_id) if car_info else str(car_id))
        for token_type, amount in (reward_dict.get("tokens") or {}).items():
            if amount:
                lines.append(f"{int(amount)} {str(token_type).replace('_', ' ')} token(s)")
        return lines

    @router.get("/admin/redeem-codes")
    async def admin_get_redeem_codes(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.redeem_codes.find({}, {"_id": 0, "used_by": 0})
        codes = []
        async for doc in cursor:
            codes.append({
                "code": doc.get("code", ""),
                "rewards": doc.get("rewards", {}),
                "max_uses": doc.get("max_uses"),
                "used_count": int(doc.get("used_count", 0)),
                "active": bool(doc.get("active", True)),
            })
        return {"codes": codes}

    @router.post("/admin/redeem-codes")
    async def admin_create_redeem_code(request: RedeemCodeCreateRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw_code = (request.code or "").strip()
        if not raw_code:
            raise HTTPException(status_code=400, detail="Code is required")
        code_normalized = raw_code.upper()
        existing = await db.redeem_codes.find_one({"code": code_normalized}, {"_id": 1})
        if existing:
            raise HTTPException(status_code=400, detail="A redeem code with this value already exists")
        rewards = request.rewards or RedeemCodeRewards()
        reward_dict = {}
        if (rewards.money or 0) > 0:
            reward_dict["money"] = int(rewards.money)
        if (rewards.points or 0) > 0:
            reward_dict["points"] = int(rewards.points)
        if (rewards.respect_points or 0) > 0:
            reward_dict["respect_points"] = int(rewards.respect_points)
        if (rewards.loot_box_pieces or 0) > 0:
            reward_dict["loot_box_pieces"] = int(rewards.loot_box_pieces)
        if rewards.cars:
            valid_car_ids = {c["id"] for c in CARS}
            car_list = [str(cid).strip() for cid in rewards.cars if str(cid).strip() in valid_car_ids]
            if car_list:
                reward_dict["cars"] = car_list
        if rewards.tokens:
            token_dict = {}
            for tt, amt in rewards.tokens.items():
                if tt not in ADMIN_TOKEN_TYPES or not (amt and int(amt) > 0):
                    continue
                token_dict[str(tt)] = int(amt)
            if token_dict:
                reward_dict["tokens"] = token_dict
        if not reward_dict:
            raise HTTPException(status_code=400, detail="At least one reward is required")
        max_uses = None
        if request.max_uses is not None and request.max_uses > 0:
            max_uses = int(request.max_uses)
        doc = {
            "code": code_normalized,
            "rewards": reward_dict,
            "max_uses": max_uses,
            "used_count": 0,
            "used_by": [],
            "active": True,
        }
        await db.redeem_codes.insert_one(doc)
        try:
            topic_id = await create_redeem_code_forum_topic(
                code_normalized,
                _redeem_forum_reward_lines(reward_dict),
                max_uses,
            )
            await db.redeem_codes.update_one({"code": code_normalized}, {"$set": {"forum_topic_id": topic_id}})
        except Exception:
            await db.redeem_codes.delete_one({"code": code_normalized})
            raise HTTPException(status_code=500, detail="Redeem code was not saved: forum topic creation failed.")
        return {"message": "Redeem code created", "code": code_normalized, "forum_topic_id": topic_id}

    @router.patch("/admin/redeem-codes/{code}")
    async def admin_patch_redeem_code(
        code: str,
        request: RedeemCodePatchRequest,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        code_normalized = (code or "").strip().upper()
        doc = await db.redeem_codes.find_one({"code": code_normalized}, {"_id": 0, "forum_topic_id": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Redeem code not found")
        if request.active is False:
            await remove_redeem_code_forum_topic(doc.get("forum_topic_id"))
            await db.redeem_codes.update_one(
                {"code": code_normalized},
                {"$set": {"active": False}, "$unset": {"forum_topic_id": ""}},
            )
            return {"message": "Redeem code deactivated; forum topic removed", "code": code_normalized, "active": False}
        await db.redeem_codes.update_one({"code": code_normalized}, {"$set": {"active": True}})
        return {"message": "Redeem code activated (no forum topic recreated)", "code": code_normalized, "active": True}

    @router.delete("/admin/redeem-codes/{code}")
    async def admin_delete_redeem_code(code: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        code_normalized = (code or "").strip().upper()
        doc = await db.redeem_codes.find_one({"code": code_normalized}, {"_id": 0, "forum_topic_id": 1})
        if doc:
            await remove_redeem_code_forum_topic(doc.get("forum_topic_id"))
        result = await db.redeem_codes.delete_one({"code": code_normalized})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Redeem code not found")
        return {"message": "Redeem code deleted", "code": code_normalized}

    @router.get("/admin/beta-signup")
    async def admin_get_beta_signup(current_user: dict = Depends(get_current_user)):
        """Get beta signup mode status."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_config.find_one({"id": "main"}, {"_id": 0, "beta_signup_enabled": 1})
        return {"beta_signup_enabled": bool(doc.get("beta_signup_enabled", False)) if doc else False}

    @router.post("/admin/beta-signup/toggle")
    async def admin_toggle_beta_signup(request: BetaSignupToggleRequest, current_user: dict = Depends(get_current_user)):
        """Toggle beta signup mode. When enabled, new signups get 15k points, $1B cash, 15k respect."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = request.enabled
        await db.game_config.update_one(
            {"id": "main"},
            {"$set": {"beta_signup_enabled": bool(enabled)}},
            upsert=True,
        )
        return {"message": "Beta signup " + ("enabled" if enabled else "disabled"), "beta_signup_enabled": bool(enabled)}

    def _seed_family_roles(size: int):
        """Return role list for 10-15 members: boss, underboss, consigliere, 2 capos, rest soldiers."""
        roles = ["boss", "underboss", "consigliere", "capo", "capo"]
        n = max(0, min(10, (size - 5)))
        roles.extend(["soldier"] * n)
        return roles

    @router.post("/admin/seed-families")
    async def admin_seed_families(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        import random
        from routers.game.families import cleanup_dead_families, _invalidate_list_cache
        await cleanup_dead_families()
        _invalidate_list_cache()
        password_hash = get_password_hash(SEED_TEST_PASSWORD)
        now = datetime.now(timezone.utc).isoformat()
        created_users = []
        created_families = []
        current_count = await db.families.count_documents({"wiped": {"$ne": True}})
        for fam_cfg in SEED_FAMILIES_CONFIG:
            if current_count >= MAX_FAMILIES:
                break
            name, tag = fam_cfg["name"], fam_cfg["tag"]
            existing = await db.families.find_one({"$or": [{"name": name}, {"tag": tag}]})
            if existing:
                continue
            member_count = random.randint(10, 15)
            roles = _seed_family_roles(member_count)
            family_id = str(uuid.uuid4())
            user_ids = []
            for i, role in enumerate(roles):
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
            current_count += 1
            created_families.append({"name": name, "tag": tag, "member_count": len(user_ids)})
            for uid, role, _ in user_ids:
                await db.family_members.insert_one({
                    "id": str(uuid.uuid4()),
                    "family_id": family_id,
                    "user_id": uid,
                    "role": role,
                    "joined_at": now,
                })
                await db.users.update_one(
                    {"id": uid},
                    {"$set": {"family_id": family_id, "family_role": role}},
                )
            for uid, role, owner_username in user_ids:
                owner = {"id": uid, "current_state": "Chicago"}
                for slot in range(1, 3):
                    try:
                        robot_user_id, robot_username = await _create_robot_bodyguard_user(owner)
                        await db.bodyguards.insert_one({
                            "id": str(uuid.uuid4()),
                            "user_id": uid,
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
                        logging.exception("Seed bodyguard for %s slot %s: %s", uid, slot, e)
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
        from routers.casinos.dice import DICE_MAX_BET
        from routers.casinos.roulette import ROULETTE_MAX_BET
        from routers.casinos.blackjack import BLACKJACK_DEFAULT_MAX_BET
        from routers.casinos.horseracing import HORSERACING_MAX_BET
        from routers.casinos.video_poker import VIDEO_POKER_DEFAULT_MAX_BET
        from routers.admin.airport import AIRPORT_SLOTS_PER_STATE, AIRPORT_COST

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

    # ──────────────────────────────────────────────────────────────────────────────
    # Cloudflare Bot Blocking Toggle
    # ──────────────────────────────────────────────────────────────────────────────

    async def _cf_get_rule_status(rule_name: str) -> dict:
        """Helper to get Cloudflare firewall rule status by name."""
        if not CF_ZONE_ID or not CF_API_TOKEN:
            return {"enabled": None, "error": "Cloudflare not configured (CF_ZONE_ID / CF_API_TOKEN missing)"}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"https://api.cloudflare.com/client/v4/zones/{CF_ZONE_ID}/firewall/rules",
                    headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
                )
                data = resp.json()
                if not data.get("success"):
                    return {"enabled": None, "error": data.get("errors", "Unknown error")}
                rules = data.get("result", [])
                for rule in rules:
                    if rule_name.lower() in (rule.get("description") or "").lower():
                        return {"enabled": not rule.get("paused", False), "rule_id": rule.get("id")}
                return {"enabled": None, "error": f"Rule '{rule_name}' not found"}
        except Exception as e:
            logging.exception("Cloudflare API error")
            return {"enabled": None, "error": str(e)}

    async def _cf_toggle_rule(rule_name: str, enabled: bool) -> dict:
        """Helper to toggle a Cloudflare firewall rule by name."""
        if not CF_ZONE_ID or not CF_API_TOKEN:
            raise HTTPException(status_code=500, detail="Cloudflare not configured (CF_ZONE_ID / CF_API_TOKEN missing)")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"https://api.cloudflare.com/client/v4/zones/{CF_ZONE_ID}/firewall/rules",
                    headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
                )
                data = resp.json()
                if not data.get("success"):
                    raise HTTPException(status_code=500, detail=f"Cloudflare error: {data.get('errors')}")
                rules = data.get("result", [])
                rule_id = None
                for rule in rules:
                    if rule_name.lower() in (rule.get("description") or "").lower():
                        rule_id = rule.get("id")
                        break
                if not rule_id:
                    raise HTTPException(status_code=404, detail=f"Rule '{rule_name}' not found in Cloudflare")
                update_resp = await client.patch(
                    f"https://api.cloudflare.com/client/v4/zones/{CF_ZONE_ID}/firewall/rules/{rule_id}",
                    headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
                    json={"paused": not enabled},
                )
                update_data = update_resp.json()
                if not update_data.get("success"):
                    raise HTTPException(status_code=500, detail=f"Cloudflare update error: {update_data.get('errors')}")
                return {"enabled": enabled}
        except HTTPException:
            raise
        except Exception as e:
            logging.exception("Cloudflare API error")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/admin/cloudflare/bot-block-status")
    async def admin_cloudflare_bot_block_status(current_user: dict = Depends(get_current_user)):
        """Get current status of the 'Block All Bots' rule in Cloudflare."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return await _cf_get_rule_status("Block All Bots")

    @router.post("/admin/cloudflare/bot-block-toggle")
    async def admin_cloudflare_bot_block_toggle(enabled: bool, current_user: dict = Depends(get_current_user)):
        """Enable or disable the 'Block All Bots' Cloudflare firewall rule."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await _cf_toggle_rule("Block All Bots", enabled)
        return {"message": f"Bot blocking {'enabled' if enabled else 'disabled'}", **result}

    @router.get("/admin/cloudflare/automation-block-status")
    async def admin_cloudflare_automation_block_status(current_user: dict = Depends(get_current_user)):
        """Get current status of the 'Block Automation Scripts' rule in Cloudflare."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return await _cf_get_rule_status("Block Automation")

    @router.post("/admin/cloudflare/automation-block-toggle")
    async def admin_cloudflare_automation_block_toggle(enabled: bool, current_user: dict = Depends(get_current_user)):
        """Enable or disable the 'Block Automation Scripts' Cloudflare firewall rule."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await _cf_toggle_rule("Block Automation", enabled)
        return {"message": f"Automation script blocking {'enabled' if enabled else 'disabled'}", **result}

    # ──────────────────────────────────────────────────────────────────────────────
    # New Admin Tools
    # ──────────────────────────────────────────────────────────────────────────────

    @router.get("/admin/economy/overview")
    async def admin_economy_overview(current_user: dict = Depends(get_current_user)):
        """Economy snapshot: total money, points, average wealth, top 5 richest."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        pipeline = [
            {"$match": {"is_dead": {"$ne": True}}},
            {"$group": {
                "_id": None,
                "total_money": {"$sum": {"$ifNull": ["$money", 0]}},
                "total_bank": {"$sum": {"$ifNull": ["$bank_balance", 0]}},
                "total_points": {"$sum": {"$ifNull": ["$points", 0]}},
                "avg_money": {"$avg": {"$ifNull": ["$money", 0]}},
                "player_count": {"$sum": 1},
            }},
        ]
        agg = await db.users.aggregate(pipeline).to_list(1)
        stats = agg[0] if agg else {}
        top5 = await db.users.find(
            {"is_dead": {"$ne": True}},
            {"_id": 0, "username": 1, "money": 1, "bank_balance": 1, "points": 1},
        ).sort("money", -1).limit(5).to_list(5)
        top5_points = await db.users.find(
            {"is_dead": {"$ne": True}},
            {"_id": 0, "username": 1, "points": 1},
        ).sort("points", -1).limit(5).to_list(5)
        player_count = stats.get("player_count", 1) or 1
        return {
            "total_money": stats.get("total_money", 0),
            "total_bank": stats.get("total_bank", 0),
            "total_points": stats.get("total_points", 0),
            "avg_money": round(stats.get("avg_money", 0)),
            "avg_points": round(stats.get("total_points", 0) / player_count),
            "player_count": stats.get("player_count", 0),
            "top5_richest": [
                {"username": u.get("username", "?"), "money": u.get("money", 0), "bank": u.get("bank_balance", 0), "points": u.get("points", 0)}
                for u in (top5 or [])
            ],
            "top5_points": [
                {"username": u.get("username", "?"), "points": u.get("points", 0)}
                for u in (top5_points or [])
            ],
        }

    @router.get("/admin/players/activity-summary")
    async def admin_players_activity_summary(current_user: dict = Depends(get_current_user)):
        """What online players are doing: count per feature area (last 5 min)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        online = await db.users.find(
            {"last_action_at": {"$gte": cutoff}, "is_dead": {"$ne": True}},
            {"_id": 0, "last_action_page": 1},
        ).to_list(500)
        counts = {}
        for u in (online or []):
            page = u.get("last_action_page") or "unknown"
            counts[page] = counts.get(page, 0) + 1
        sorted_counts = sorted(counts.items(), key=lambda x: x[1], reverse=True)
        return {"total_online": len(online), "by_page": [{"page": p, "count": c} for p, c in sorted_counts]}

    @router.get("/admin/players/compare")
    async def admin_players_compare(
        user1: str = Query(..., description="Username 1"),
        user2: str = Query(..., description="Username 2"),
        current_user: dict = Depends(get_current_user),
    ):
        """Side-by-side comparison of two players for alt investigation."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or mod access required")
        fields = {
            "_id": 0, "id": 1, "username": 1, "email": 1, "money": 1, "bank_balance": 1,
            "points": 1, "rank_points": 1, "health": 1, "created_at": 1, "last_login": 1,
            "last_action_at": 1, "registration_ip": 1, "last_login_ip": 1,
            "device_fingerprint": 1, "user_agent": 1, "is_dead": 1, "prestige": 1,
        }
        u1 = await db.users.find_one({"username": re.compile(f"^{re.escape(user1)}$", re.IGNORECASE)}, fields)
        u2 = await db.users.find_one({"username": re.compile(f"^{re.escape(user2)}$", re.IGNORECASE)}, fields)
        if not u1:
            raise HTTPException(status_code=404, detail=f"User '{user1}' not found")
        if not u2:
            raise HTTPException(status_code=404, detail=f"User '{user2}' not found")
        same_ip = bool(
            u1.get("registration_ip") and u2.get("registration_ip")
            and u1["registration_ip"] == u2["registration_ip"]
        )
        same_device = bool(
            u1.get("device_fingerprint") and u2.get("device_fingerprint")
            and u1["device_fingerprint"] == u2["device_fingerprint"]
        )
        return {"user1": u1, "user2": u2, "same_ip": same_ip, "same_device": same_device}

    @router.get("/admin/system/health")
    async def admin_system_health(current_user: dict = Depends(get_current_user)):
        """System health: DB stats, document counts, server info."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        try:
            user_count = await db.users.count_documents({})
            alive_count = await db.users.count_documents({"is_dead": {"$ne": True}})
            car_count = await db.user_cars.count_documents({})
            family_count = await db.families.count_documents({})
            flag_count = await db.security_flags.count_documents({"resolved": {"$ne": True}})
            cutoff_5m = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            online_count = await db.users.count_documents({"last_action_at": {"$gte": cutoff_5m}, "is_dead": {"$ne": True}})
            return {
                "status": "healthy",
                "users_total": user_count,
                "users_alive": alive_count,
                "users_online": online_count,
                "cars": car_count,
                "families": family_count,
                "unresolved_flags": flag_count,
                "server_time": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            return {"status": "degraded", "error": str(e)}

    class MaintenanceBannerRequest(BaseModel):
        enabled: bool
        message: Optional[str] = None
        starts_at: Optional[str] = None
        duration_minutes: Optional[int] = None

    @router.get("/admin/maintenance-banner")
    async def admin_get_maintenance_banner(current_user: dict = Depends(get_current_user)):
        """Get current maintenance banner state."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_settings.find_one({"key": "maintenance_banner"}, {"_id": 0})
        if not doc:
            return {"enabled": False}
        return doc.get("value", {"enabled": False})

    @router.post("/admin/maintenance-banner")
    async def admin_set_maintenance_banner(req: MaintenanceBannerRequest, current_user: dict = Depends(get_current_user)):
        """Set or clear the maintenance banner."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        value = {
            "enabled": req.enabled,
            "message": req.message or "Scheduled maintenance in progress.",
            "starts_at": req.starts_at,
            "duration_minutes": req.duration_minutes,
            "set_by": current_user.get("username", "?"),
            "set_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.game_settings.update_one(
            {"key": "maintenance_banner"},
            {"$set": {"key": "maintenance_banner", "value": value}},
            upsert=True,
        )
        return {"message": f"Maintenance banner {'enabled' if req.enabled else 'disabled'}", **value}

    class BulkUserActionRequest(BaseModel):
        usernames: list
        action: str  # give_points, give_money, lock, unlock, reset_daily_rewards
        value: Optional[int] = None

    @router.post("/admin/bulk-action")
    async def admin_bulk_user_action(req: BulkUserActionRequest, current_user: dict = Depends(get_current_user)):
        """Apply an action to multiple users at once."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not req.usernames or len(req.usernames) > 50:
            raise HTTPException(status_code=400, detail="Provide 1-50 usernames")
        usernames_lower = [u.strip().lower() for u in req.usernames if u.strip()]
        user_filter = {"username": {"$in": [re.compile(f"^{re.escape(u)}$", re.IGNORECASE) for u in usernames_lower]}}
        affected = 0
        if req.action == "give_points" and req.value:
            r = await db.users.update_many(user_filter, {"$inc": {"points": req.value}})
            affected = r.modified_count
        elif req.action == "give_money" and req.value:
            r = await db.users.update_many(user_filter, {"$inc": {"money": req.value}})
            affected = r.modified_count
        elif req.action == "lock":
            r = await db.users.update_many(user_filter, {"$set": {"locked": True, "locked_at": datetime.now(timezone.utc).isoformat(), "locked_reason": "Bulk lock by admin"}})
            affected = r.modified_count
        elif req.action == "unlock":
            r = await db.users.update_many(user_filter, {"$set": {"locked": False}, "$unset": {"locked_at": "", "locked_reason": ""}})
            affected = r.modified_count
        elif req.action == "reset_daily_rewards":
            r = await db.users.update_many(user_filter, {"$set": {"rps_plays": []}})
            ttt = await db.daily_rewards_ttt.delete_many({"user_id": {"$in": usernames_lower}})
            affected = r.modified_count
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")
        return {"message": f"Bulk '{req.action}' applied to {affected} user(s)", "affected": affected}

    # ─────────────────────────────────────────────────────────────────────────────
    # State Heads Admin (manage which family controls each state)
    # ─────────────────────────────────────────────────────────────────────────────

    @router.get("/admin/state-heads")
    async def admin_get_state_heads(current_user: dict = Depends(get_current_user)):
        """Get all state heads and detect families that are head of multiple states."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        get_state_heads = srv.get_state_heads
        heads = await get_state_heads()

        # Get family names for each head
        family_ids = [fid for fid in heads.values() if fid]
        families = {}
        if family_ids:
            fam_docs = await db.families.find({"id": {"$in": family_ids}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "head_of_state": 1}).to_list(len(family_ids))
            families = {f["id"]: f for f in fam_docs}

        # Build result with family info
        result = {}
        family_state_count = {}
        for state, fid in heads.items():
            if fid:
                fam = families.get(fid, {})
                result[state] = {
                    "family_id": fid,
                    "family_name": fam.get("name", "?"),
                    "family_tag": fam.get("tag", "?"),
                    "family_head_of_state_field": fam.get("head_of_state"),
                }
                family_state_count[fid] = family_state_count.get(fid, 0) + 1
            else:
                result[state] = None

        # Detect duplicates (families that are head of multiple states)
        duplicates = {fid: count for fid, count in family_state_count.items() if count > 1}
        duplicate_families = []
        for fid, count in duplicates.items():
            fam = families.get(fid, {})
            states_headed = [s for s, f in heads.items() if f == fid]
            duplicate_families.append({
                "family_id": fid,
                "family_name": fam.get("name", "?"),
                "states_headed": states_headed,
                "count": count,
            })

        return {
            "state_heads": result,
            "duplicates": duplicate_families,
            "has_duplicates": len(duplicate_families) > 0,
        }

    class ClearStateHeadRequest(BaseModel):
        state: str

    @router.post("/admin/state-heads/clear")
    async def admin_clear_state_head(req: ClearStateHeadRequest, current_user: dict = Depends(get_current_user)):
        """Clear the head family from a specific state."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        state = (req.state or "").strip()
        if state not in STATES:
            raise HTTPException(status_code=400, detail=f"Invalid state. Valid: {', '.join(STATES)}")

        set_state_head = srv.set_state_head
        get_state_heads = srv.get_state_heads

        heads = await get_state_heads()
        old_fid = heads.get(state)
        if not old_fid:
            return {"message": f"{state} has no head family", "state": state, "cleared": False}

        old_fam = await db.families.find_one({"id": old_fid}, {"_id": 0, "name": 1})
        await set_state_head(state, None)

        return {
            "message": f"Cleared {(old_fam or {}).get('name', old_fid)} from {state}",
            "state": state,
            "cleared_family_id": old_fid,
            "cleared_family_name": (old_fam or {}).get("name", "?"),
            "cleared": True,
        }

    @router.post("/admin/rackets/reset-cooldown")
    async def admin_reset_racket_cooldown(
        family_id: str,
        racket_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Reset a family racket's cooldown so it can be collected immediately. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.game.families import FAMILY_RACKETS
        valid_racket_ids = [r["id"] for r in FAMILY_RACKETS]
        if racket_id not in valid_racket_ids:
            raise HTTPException(status_code=400, detail=f"Invalid racket_id. Valid: {', '.join(valid_racket_ids)}")
        fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "rackets": 1})
        if not fam:
            raise HTTPException(status_code=404, detail="Family not found")
        rackets = (fam.get("rackets") or {}).copy()
        state = rackets.get(racket_id) or {}
        if state.get("level", 0) <= 0:
            raise HTTPException(status_code=400, detail="Racket not active (level 0)")
        # Set last_collected_at to 48h ago so cooldown has passed for any racket
        from datetime import datetime, timezone, timedelta
        past_time = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        rackets[racket_id] = {**state, "last_collected_at": past_time}
        await db.families.update_one({"id": family_id}, {"$set": {"rackets": rackets}})
        racket_name = next((r["name"] for r in FAMILY_RACKETS if r["id"] == racket_id), racket_id)
        return {
            "message": f"Reset {racket_name} cooldown for {(fam.get('name') or family_id)}. Racket can be collected now.",
            "family_id": family_id,
            "family_name": fam.get("name"),
            "racket_id": racket_id,
            "racket_name": racket_name,
        }

    # ─────────────────────────────────────────────────────────────────────────────
    # Mini Games Weekly Leaderboard Admin
    # ─────────────────────────────────────────────────────────────────────────────
    from routers.minigames.minigame_leaderboard import MINIGAME_LB_CONFIG_ID, DEFAULT_REWARDS, run_minigame_weekly_payout

    @router.get("/admin/minigame-leaderboard/config")
    async def get_minigame_lb_config(current_user: dict = Depends(get_current_user)):
        """Get mini games weekly leaderboard reward configuration."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cfg = await db.game_config.find_one({"id": MINIGAME_LB_CONFIG_ID}, {"_id": 0})
        rewards = (cfg or {}).get("rewards") or DEFAULT_REWARDS
        rewards_out = {}
        for k, v in rewards.items():
            rewards_out[str(k)] = v
        return {
            "config_id": MINIGAME_LB_CONFIG_ID,
            "rewards": rewards_out,
            "last_payout_week_start": (cfg or {}).get("last_payout_week_start"),
        }

    class MinigameLBRewardsUpdate(BaseModel):
        rewards: dict

    @router.post("/admin/minigame-leaderboard/config")
    async def update_minigame_lb_config(body: MinigameLBRewardsUpdate, current_user: dict = Depends(get_current_user)):
        """Update mini games weekly leaderboard rewards. rewards = {1: {cash, respect, loot_pieces, bullets}, ...}"""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        rewards = body.rewards or {}
        clean_rewards = {}
        for rank in range(1, 6):
            r = rewards.get(rank) or rewards.get(str(rank)) or DEFAULT_REWARDS.get(rank, {})
            clean_rewards[rank] = {
                "cash": int(r.get("cash") or 0),
                "respect": int(r.get("respect") or 0),
                "loot_pieces": int(r.get("loot_pieces") or 0),
                "bullets": int(r.get("bullets") or 0),
            }
        await db.game_config.update_one(
            {"id": MINIGAME_LB_CONFIG_ID},
            {"$set": {"rewards": clean_rewards}},
            upsert=True,
        )
        return {"message": "Mini games leaderboard rewards updated", "rewards": clean_rewards}

    @router.post("/admin/minigame-leaderboard/test-payout")
    async def test_minigame_lb_payout(current_user: dict = Depends(get_current_user)):
        """Test mini games weekly payout (no actual rewards given)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        await run_minigame_weekly_payout(db, test_run=True)
        return {"message": "Test payout completed (no rewards given). Check logs for details."}

    @router.get("/admin/minigame-leaderboard/history")
    async def get_minigame_lb_payout_history(current_user: dict = Depends(get_current_user)):
        """Get past mini games payout history."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cursor = db.minigame_payout_history.find({}, {"_id": 0}).sort("paid_at", -1).limit(10)
        history = await cursor.to_list(10)
        return {"history": history}

    # ─────────────────────────────────────────────────────────────────────────────
    # Lifetime Objectives Testing (Admin Only)
    # ─────────────────────────────────────────────────────────────────────────────
    from routers.account.objectives import OBJECTIVE_TYPES_LIFETIME

    @router.post("/admin/test-lifetime-objectives-almost-complete")
    async def admin_test_lifetime_objectives_almost_complete(current_user: dict = Depends(get_current_user)):
        """Populate admin's account to be almost complete on lifetime objectives (5 crimes away).
        Sets all lifetime objective progress fields to target - 5 (crimes) or target (others).
        This is for testing the admin notification when a user is close to completing."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")

        user_id = current_user["id"]

        # Build update doc: set all lifetime stats to near-completion values
        update_set = {
            "objectives_lifetime_close_notified": False,  # Reset so notification triggers again
            "objectives_lifetime_claimed": False,  # Reset so they can test claiming
        }
        update_inc = {}

        # Set direct user fields for lifetime objectives
        # crimes is set to target - 5, all others to target
        for obj in OBJECTIVE_TYPES_LIFETIME:
            key = obj["progress_key"]
            target = obj["target"]
            if obj["id"] == "crimes":
                update_set["total_crimes"] = target - 5  # 5 crimes away from completion
            elif key == "total_gta":
                update_set["total_gta"] = target
            elif key == "total_oc_heists":
                update_set["total_oc_heists"] = target
            elif key == "jail_busts":
                update_set["jail_busts"] = target
            elif key == "bullets_melted":
                update_set["bullets_melted"] = target
            elif key == "crime_profit":
                update_set["crime_profit"] = target
            elif key == "booze_runs_count":
                update_set["booze_runs_count"] = target
            elif key == "hitlist_npc_kills":
                update_set["hitlist_npc_kills"] = target

        # For lifetime_respect_earned (aggregate) - insert respect events
        # Delete existing and insert new to reach target
        respect_target = 15000
        await db.respect_events.delete_many({"user_id": user_id})
        await db.respect_events.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "amount": respect_target,
            "reason": "Admin test - lifetime objectives",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        # For minigame_plays (aggregate) - insert minigame play records
        minigame_target = 1000
        await db.minigame_plays.delete_many({"user_id": user_id})
        for i in range(minigame_target):
            await db.minigame_plays.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "game": "test",
                "score": 0,
                "played_at": datetime.now(timezone.utc).isoformat(),
            })

        await db.users.update_one({"id": user_id}, {"$set": update_set})

        return {
            "message": "Lifetime objectives set to almost complete (5 crimes away). Visit objectives page to trigger admin notification.",
            "total_crimes_set_to": update_set.get("total_crimes"),
            "all_other_objectives": "completed",
        }
