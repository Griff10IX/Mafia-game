# Auth: register, login, password reset, /auth/me
import asyncio
import logging
import random
import re
import traceback
import uuid

logger = logging.getLogger(__name__)
from datetime import datetime, timezone, timedelta

from typing import Optional

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, field_validator

from utils.disposable_email import is_disposable_email
from middleware.security import is_proxy_or_vpn


class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str
    referral_code: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_min_alphanumeric(cls, v: str) -> str:
        """New signups: password must contain at least 4 letters or numbers."""
        if not v:
            raise ValueError("Password is required")
        alnum_count = sum(1 for c in v if c.isalnum())
        if alnum_count < 4:
            raise ValueError("Password must contain at least 4 letters or numbers")
        return v


class UserLogin(BaseModel):
    email: str  # email or username (login with either)
    password: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


class VerifyEmailBody(BaseModel):
    token: str


class ResendVerificationBody(BaseModel):
    email: str  # email or username (same as login)


class AccountLockedCommentBody(BaseModel):
    comment: str

    @field_validator("comment", mode="before")
    @classmethod
    def trim_and_limit(cls, v):
        if v is None:
            return ""
        s = str(v).strip()
        if len(s) > 2000:
            raise ValueError("Comment must be at most 2000 characters")
        return s


class AccountLockedReplyBody(BaseModel):
    reply: str

    @field_validator("reply", mode="before")
    @classmethod
    def trim_and_limit(cls, v):
        if v is None:
            return ""
        s = str(v).strip()
        if len(s) > 2000:
            raise ValueError("Reply must be at most 2000 characters")
        return s


class RevokeSessionBody(BaseModel):
    session_id: str


class PreRegisterBody(BaseModel):
    email: EmailStr


# Pre-registration rewards (applied on first login after launch)
PREREGISTER_REWARDS = {
    "bonus_respect_points": 1000,
    "bonus_cash": 50000,
    "badge": "Founding Member",
    "auto_rank_trial_hours": 24,
    "founding_random_tokens": 5,
    # Shown on pre-register page; mirrors server founding_member_income_mult (1.025)
    "founding_passive_bonus_pct": 2.5,
    "founding_passive_blurb": (
        "Permanent +2.5% on crime payouts (cash, rank points & respect), GTA car sale value & rare-car luck, "
        "OC heist payouts, hitlist NPC rewards, property income, family racket collects, and mission rewards — "
        "as long as you have the Founding Member badge."
    ),
}

# Referred-user signup benefits (tokens are non-sellable on Quick Trade)
REFERRED_USER_RESPECT = 500
REFERRED_USER_TOKENS_PER_TYPE = 2
# Count fields for consumable tokens (must match TOKEN_CONFIG in armoury)
REFERRED_USER_TOKEN_COUNT_FIELDS = [
    "xp_crimes_tokens", "xp_gta_tokens", "melt_tokens", "oc_reduced_tokens",
    "booze_tokens", "racket_tokens", "travel_tokens", "properties_tokens", "jailbust_tokens",
]


def register(router):
    """Register auth routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_password_hash = srv.get_password_hash
    verify_password = srv.verify_password
    create_access_token = srv.create_access_token
    get_current_user = srv.get_current_user
    get_rank_info = srv.get_rank_info
    _is_moderator = srv._is_moderator
    get_wealth_rank = srv.get_wealth_rank
    get_wealth_rank_range = srv.get_wealth_rank_range
    _get_casino_property_profit = srv._get_casino_property_profit
    UserResponse = srv.UserResponse
    ARMOUR_SETS = getattr(srv, "ARMOUR_SETS", [])
    DEFAULT_HEALTH = srv.DEFAULT_HEALTH
    DEFAULT_GARAGE_BATCH_LIMIT = srv.DEFAULT_GARAGE_BATCH_LIMIT
    SWISS_BANK_LIMIT_START = srv.SWISS_BANK_LIMIT_START
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    send_notification = srv.send_notification
    RANKS = getattr(srv, "RANKS", [])
    PRESTIGE_CONFIGS = getattr(srv, "PRESTIGE_CONFIGS", {})
    CARS = getattr(srv, "CARS", [])

    def _client_ip(request: Request):
        # Cloudflare provides real IP in CF-Connecting-IP
        cf_ip = request.headers.get("cf-connecting-ip")
        if cf_ip:
            return cf_ip.strip()
        # Fallback to X-Forwarded-For (nginx or other proxies)
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host or ""
        return ""

    def _device_type_from_user_agent(ua: str) -> str:
        """Parse User-Agent to a simple device type: Mobile, Tablet, or Desktop."""
        if not (ua or "").strip():
            return "Unknown"
        u = (ua or "").strip()
        u_lower = u.lower()
        if "ipad" in u_lower or ("android" in u_lower and "mobile" not in u_lower) or "tablet" in u_lower or "playbook" in u_lower:
            return "Tablet"
        if "mobile" in u_lower or "android" in u_lower or "iphone" in u_lower or "ipod" in u_lower or "webos" in u_lower or "blackberry" in u_lower or "windows phone" in u_lower:
            return "Mobile"
        return "Desktop"

    async def _require_email_verification():
        doc = await db.game_settings.find_one({"key": "require_email_verification"}, {"_id": 0, "value": 1})
        # Default True when missing: email verification required unless explicitly disabled in admin
        if doc is None:
            return True
        return bool(doc.get("value"))

    async def _notify_admins_vpn_blocked(ip: str, context: str, details: str):
        """Send inbox notification to all admins when VPN/proxy block occurs."""
        admin_emails = list(ADMIN_EMAILS or [])
        if not admin_emails:
            return
        try:
            admins = await db.users.find({"email": {"$in": admin_emails}}, {"_id": 0, "id": 1}).to_list(100)
            title = "VPN/Proxy Blocked"
            msg = f"{context}: IP {ip}. {details}"
            for a in admins:
                if a.get("id"):
                    await send_notification(a["id"], title, msg, "system", category="admin")
        except Exception:
            logger.exception("Failed to notify admins of VPN block")

    @router.get("/auth/launch-status")
    async def get_launch_status():
        """Public endpoint to check if login is locked until launch date."""
        settings = await db.game_settings.find_one({"_id": "main"})
        lock_from = settings.get("login_lock_from") if settings else None
        lock_until = settings.get("login_lock_until") if settings else None
        lock_message = settings.get("login_lock_message") if settings else None
        banner_pref = settings.get("preregister_landing_banner_enabled") if settings else None
        if banner_pref is None:
            banner_pref = True
        preview_open = bool(settings.get("preregister_landing_banner_preview_open")) if settings else False
        preorder_release = settings.get("preorder_points_release_date") if settings else None
        now = datetime.now(timezone.utc)
        login_locked = False
        if lock_until:
            try:
                lock_until_dt = datetime.fromisoformat(lock_until.replace("Z", "+00:00"))
                started = True
                if lock_from:
                    lock_from_dt = datetime.fromisoformat(lock_from.replace("Z", "+00:00"))
                    started = now >= lock_from_dt
                login_locked = started and now < lock_until_dt
            except (ValueError, TypeError):
                pass
        preorder_active = False
        if preorder_release:
            try:
                preorder_dt = datetime.fromisoformat(preorder_release.replace("Z", "+00:00"))
                preorder_active = now < preorder_dt
            except (ValueError, TypeError):
                pass
        store_auto = settings.get("store_points_auto_credit") if settings else None
        if store_auto is None:
            store_auto = True
        manual_credit_eta = settings.get("store_points_manual_credit_eta") if settings else None
        show_strip = bool(banner_pref) and (login_locked or preview_open)
        return {
            "login_locked": login_locked,
            "lock_from": lock_from,
            "lock_until": lock_until,
            "lock_message": lock_message,
            "preregister_landing_banner_enabled": bool(banner_pref),
            "preregister_landing_banner_preview_open": preview_open,
            "show_preregister_banner": show_strip,
            "preorder_active": preorder_active,
            "preorder_release_date": preorder_release,
            "store_points_auto_credit": bool(store_auto),
            "manual_credit_eta": manual_credit_eta,
        }

    @router.get("/auth/check-username")
    async def check_username_availability(username: str):
        """
        Check whether a username is already taken (case-insensitive).

        Username cannot be reused by anyone (alive or dead); dead accounts keep their username in the game.
        """
        raw = (username or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="Username is required.")
        username_pattern = re.compile("^" + re.escape(raw) + "$", re.IGNORECASE)
        existing_username = await db.users.find_one(
            {"username": username_pattern},
            {"_id": 0, "id": 1, "is_dead": 1},
        )
        return {
            "username": raw,
            "is_taken": bool(existing_username),
        }

    @router.post("/auth/register")
    async def register_user(user_data: UserRegister, request: Request):
        try:
            require_verification = await _require_email_verification()
            email_clean = (user_data.email or "").strip().lower()
            if is_disposable_email(email_clean):
                raise HTTPException(
                    status_code=400,
                    detail="Disposable or temporary email addresses are not allowed.",
                )
            client_ip = _client_ip(request)
            main_settings = await db.game_settings.find_one({"_id": "main"}, {"_id": 0, "block_proxy_vpn_login": 1})
            block_proxy_vpn_login = bool(main_settings.get("block_proxy_vpn_login", True)) if main_settings else True
            if block_proxy_vpn_login and client_ip and await is_proxy_or_vpn(client_ip):
                await _notify_admins_vpn_blocked(
                    client_ip,
                    "Registration blocked",
                    f"Attempted email: {email_clean[:3]}***, username: {user_data.username.strip()[:20]}",
                )
                raise HTTPException(
                    status_code=400,
                    detail="Registration from proxy or VPN is not allowed.",
                )
            # Allow up to 2 accounts per device/network (e.g. family); block only if 2 already exist (admins exempt)
            if client_ip:
                admin_emails_list = list(ADMIN_EMAILS) if ADMIN_EMAILS else []
                alive_same_ip_count = await db.users.count_documents(
                    {
                        "is_dead": {"$ne": True},
                        "email": {"$nin": admin_emails_list},
                        "$or": [
                            {"registration_ip": client_ip},
                            {"login_ips": client_ip},
                        ],
                    },
                )
                if alive_same_ip_count >= 2:
                    raise HTTPException(
                        status_code=400,
                        detail="Maximum 2 accounts per device or network. Log in to one of your existing accounts.",
                    )

            email_pattern = re.compile("^" + re.escape(user_data.email.strip()) + "$", re.IGNORECASE)
            username_pattern = re.compile("^" + re.escape(user_data.username.strip()) + "$", re.IGNORECASE)
            # Username cannot be reused by anyone (alive or dead); dead accounts keep their username in the game
            existing_username = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "is_dead": 1})
            if existing_username:
                raise HTTPException(status_code=400, detail="Username already registered.")
            # Email: block if taken by an alive account; if taken only by a dead account, free it so this registration can use it
            existing_email = await db.users.find_one({"email": email_pattern}, {"_id": 0, "id": 1, "is_dead": 1})
            if existing_email:
                if not existing_email.get("is_dead"):
                    raise HTTPException(status_code=400, detail="Email already registered.")
                await db.users.update_one(
                    {"id": existing_email["id"]},
                    {"$set": {"email": f"dead_{existing_email['id']}@deleted"}},
                )

            user_id = str(uuid.uuid4())
            user_doc = {
                "id": user_id,
                "email": str(user_data.email.strip().lower()),
                "username": str(user_data.username.strip()),
                "password_hash": get_password_hash(user_data.password),
                "rank": 1,
                "money": 1000.0,
                "points": 0,
                "rank_points": 0,
                "bodyguard_slots": 0,
                "bullets": 0,
                "avatar_url": None,
                "jail_busts": 0,
                "jail_bust_attempts": 0,
                "jail_busts_npc": 0,
                "snitch_count": 0,
                "cars_melted": 0,
                "bullets_purchased_from_armoury": 0,
                "uncommon_cars_scrapped": 0,
                "uncommon_cars_stolen": 0,
                "total_interest_deposited": 0,
                "tribute_bullets": 0,
                "tribute_loot_box_pieces": 0,
                "loot_box_pieces": 0,
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
                "has_silencer": False,
                "custom_car_name": None,
                "travels_this_hour": 0,
                "travel_reset_time": datetime.now(timezone.utc).isoformat(),
                "extra_airmiles": 0,
                "health": DEFAULT_HEALTH,
                "armour_level": 0,
                "armour_owned_level_max": 0,
                "equipped_weapon_id": None,
                "kill_inflation": 0.0,
                "kill_inflation_updated_at": datetime.now(timezone.utc).isoformat(),
                "is_dead": False,
                "dead_at": None,
                "points_at_death": None,
                "retrieval_used": False,
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "registration_ip": _client_ip(request),
                "login_ips": [_client_ip(request)] if _client_ip(request) else [],
                "email_verified": not require_verification,
                "rules_accepted": False,
                "rules_accepted_at": None,
                # Rank-XP pass (£4.99): entitlement is unactivated until used in Armoury.
                "rank_xp_pass_tokens": 0,
                "rank_xp_pass_bonus_until": None,
                "rank_xp_pass_token_expires_at": None,
                "rank_xp_pass_tier_snapshot": None,
                "rank_xp_pass_pending_tier_snapshot": None,
                "rank_xp_pass_last_granted_micro_tier": 0,
                "rank_xp_pass_rewards_granted": False,
                "auto_rank_purchased": False,
                "auto_rank_enabled": False,
                "mission_completions": [],
                "unlocked_maps_up_to": "Chicago",
                "theme_preferences": {
                    "sidebarLayout": "categorized_classic",
                    "mobileNavStyle": "bottom",
                    "mobileStatsDisplay": "touch_ball",
                    "fontId": "clean",
                },
                "founding_member": False,
                "founding_rewards_claimed": False,
                "badges": [],
            }

            # Check if registering during pre-launch (founding member)
            settings = await db.game_settings.find_one({"_id": "main"})
            lock_until = settings.get("login_lock_until") if settings else None
            lock_from = settings.get("login_lock_from") if settings else None
            is_founding = False
            if lock_until:
                try:
                    lock_dt = datetime.fromisoformat(lock_until.replace("Z", "+00:00"))
                    reg_now = datetime.now(timezone.utc)
                    started = True
                    if lock_from:
                        from_dt = datetime.fromisoformat(lock_from.replace("Z", "+00:00"))
                        started = reg_now >= from_dt
                    if started and reg_now < lock_dt:
                        is_founding = True
                except (ValueError, TypeError):
                    pass
            
            # Check if email was pre-registered and mark as founding member
            email_prereg = await db.preregistrations.find_one({"email": user_doc["email"]})
            if email_prereg:
                is_founding = True
                await db.preregistrations.update_one(
                    {"email": user_doc["email"]},
                    {"$set": {"converted": True, "converted_at": datetime.now(timezone.utc).isoformat()}}
                )
            
            # If founding member, set flag and add badge immediately
            if is_founding:
                user_doc["founding_member"] = True
                user_doc["badges"] = [PREREGISTER_REWARDS.get("badge", "Founding Member")]

            # Check if beta signup mode is enabled - give bonus resources, Godfather rank, prestige 1, exclusive car, loot exclusive car & weapon
            game_config = await db.game_config.find_one({"id": "main"}, {"_id": 0, "beta_signup_enabled": 1})
            beta_signup_gifts = bool(game_config and game_config.get("beta_signup_enabled"))
            if beta_signup_gifts:
                user_doc["points"] = 15000
                user_doc["money"] = 1000000000  # $1 billion
                # Godfather rank and prestige 1 for beta signups
                if RANKS:
                    gf = RANKS[-1]
                    user_doc["rank"] = gf["id"]
                    user_doc["rank_points"] = int(gf.get("required_points") or 0)
                if 1 in PRESTIGE_CONFIGS:
                    user_doc["prestige_level"] = 1
                    user_doc["prestige_rank_multiplier"] = float(PRESTIGE_CONFIGS[1].get("threshold_mult") or 1.0)
                # Give all consumable tokens (5 of each)
                user_doc["xp_crimes_tokens"] = 5
                user_doc["xp_gta_tokens"] = 5
                user_doc["melt_tokens"] = 5
                user_doc["oc_reduced_tokens"] = 5
                user_doc["booze_tokens"] = 5
                user_doc["racket_tokens"] = 5
                user_doc["travel_tokens"] = 5
                user_doc["properties_tokens"] = 5
                user_doc["jailbust_tokens"] = 5

            # Referral: resolve referral_code (username) to referrer id; avoid self-referral
            referral_code = (user_data.referral_code or "").strip()
            if referral_code:
                referrer = await db.users.find_one(
                    {
                        "username": {"$regex": "^" + re.escape(referral_code) + "$", "$options": "i"},
                        "is_dead": {"$ne": True},
                    },
                    {"_id": 0, "id": 1, "username": 1, "email": 1},
                )
                if referrer:
                    new_username_lower = (user_data.username or "").strip().lower()
                    ref_username_lower = (referrer.get("username") or "").strip().lower()
                    ref_email_lower = (referrer.get("email") or "").strip().lower()
                    if ref_username_lower != new_username_lower and ref_email_lower != email_clean:
                        user_doc["referred_by"] = referrer["id"]
                        # Referred-user benefits: premium rank bar, respect, tokens (non-sellable on Quick Trade)
                        user_doc["premium_rank_bar"] = True
                        user_doc["respect_points"] = int(user_doc.get("respect_points") or 0) + REFERRED_USER_RESPECT
                        referral_tokens = {}
                        for count_field in REFERRED_USER_TOKEN_COUNT_FIELDS:
                            n = REFERRED_USER_TOKENS_PER_TYPE
                            user_doc[count_field] = int(user_doc.get(count_field) or 0) + n
                            referral_tokens[count_field] = n
                        user_doc["referral_tokens"] = referral_tokens

            await db.users.insert_one(user_doc.copy())

            # Beta signup: grant Al Capone car (car20), loot-exclusive car (car21), and loot-exclusive weapon (weapon_loot)
            if beta_signup_gifts:
                now_iso = datetime.now(timezone.utc).isoformat()
                for car_id in ("car20", "car21"):
                    car_info = next((c for c in CARS if c.get("id") == car_id), None)
                    if car_info:
                        await db.user_cars.insert_one({
                            "id": str(uuid.uuid4()),
                            "user_id": user_id,
                            "car_id": car_id,
                            "car_name": car_info.get("name", car_id),
                            "acquired_at": now_iso,
                            "damage_percent": 0,
                        })
                await db.user_weapons.update_one(
                    {"user_id": user_id, "weapon_id": "weapon_loot"},
                    {"$inc": {"quantity": 1}, "$set": {"acquired_at": now_iso}},
                    upsert=True,
                )
                await db.users.update_one({"id": user_id}, {"$set": {"equipped_weapon_id": "weapon_loot"}})
                try:
                    from routers.kill.armoury import _invalidate_weapons_cache
                    _invalidate_weapons_cache(user_id)
                except Exception:
                    pass

            # Check if login is locked (pre-registration mode) - don't auto-login
            settings = await db.game_settings.find_one({"_id": "main"})
            login_lock_until = settings.get("login_lock_until") if settings else None
            login_lock_from = settings.get("login_lock_from") if settings else None
            login_is_locked = False
            if login_lock_until:
                try:
                    lock_dt = datetime.fromisoformat(login_lock_until.replace("Z", "+00:00"))
                    reg_now = datetime.now(timezone.utc)
                    started = True
                    if login_lock_from:
                        from_dt = datetime.fromisoformat(login_lock_from.replace("Z", "+00:00"))
                        started = reg_now >= from_dt
                    login_is_locked = started and reg_now < lock_dt
                except (ValueError, TypeError):
                    pass
            
            if login_is_locked:
                # Pre-registration: account created but can't login yet
                # Don't send verification emails while login is locked.
                # Users can request a verification resend after launch.
                return {
                    "token": None,
                    "user": None,
                    "message": "Account created! You're now a Founding Member. You'll be able to log in when the game launches.",
                    "preregistered": True,
                    "founding_member": True,
                    "username": user_doc["username"],
                }

            if not require_verification:
                ip = _client_ip(request) or ""
                ua = (request.headers.get("User-Agent") or "").strip()
                device_type = _device_type_from_user_agent(ua) if ua else "Unknown"
                now_iso = datetime.now(timezone.utc).isoformat()
                session_id = str(uuid.uuid4())
                session_entry = {
                    "id": session_id,
                    "ip": ip,
                    "device_type": device_type,
                    "created_at": now_iso,
                    "last_used_at": now_iso,
                }
                await db.users.update_one(
                    {"id": user_id},
                    {"$push": {"sessions": {"$each": [session_entry], "$position": 0, "$slice": 10}}},
                )
                token = create_access_token({
                    "sub": user_id,
                    "v": user_doc.get("token_version", 0),
                    "email": user_doc.get("email") or "",
                    "session_id": session_id,
                    "username": user_doc.get("username") or "",
                })
                user_response = {
                    "id": user_doc["id"],
                    "email": user_doc["email"],
                    "username": user_doc["username"],
                    "rank": user_doc["rank"],
                    "money": user_doc["money"],
                    "points": user_doc["points"],
                    "bodyguard_slots": user_doc["bodyguard_slots"],
                    "current_state": user_doc["current_state"],
                    "total_kills": user_doc["total_kills"],
                    "total_deaths": user_doc["total_deaths"],
                    "created_at": user_doc["created_at"],
                    "rules_accepted": bool(user_doc.get("rules_accepted", False)),
                }
                return {"token": token, "user": user_response}

            # Email verification: create token and send link
            verification_token = str(uuid.uuid4())
            expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
            await db.email_verifications.insert_one({
                "token": verification_token,
                "user_id": user_id,
                "email": user_doc["email"],
                "username": user_doc["username"],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "expires_at": expires_at.isoformat(),
            })
            # Send verification email in background so registration responds immediately (avoids timeout when SMTP is slow/blocked)
            import threading
            from utils.email_sender import send_verification_email

            def _send_in_background():
                try:
                    send_verification_email(user_doc["email"], user_doc["username"], verification_token)
                except Exception as e:
                    logging.warning("Background verification email failed: %s", e)

            threading.Thread(target=_send_in_background, daemon=True).start()
            # Log them in so they can browse; features are gated until verified
            ip = _client_ip(request) or ""
            ua = (request.headers.get("User-Agent") or "").strip()
            device_type = _device_type_from_user_agent(ua) if ua else "Unknown"
            now_iso = datetime.now(timezone.utc).isoformat()
            session_id = str(uuid.uuid4())
            session_entry = {
                "id": session_id,
                "ip": ip,
                "device_type": device_type,
                "created_at": now_iso,
                "last_used_at": now_iso,
            }
            await db.users.update_one(
                {"id": user_id},
                {"$push": {"sessions": {"$each": [session_entry], "$position": 0, "$slice": 10}}},
            )
            token = create_access_token({
                "sub": user_id,
                "v": user_doc.get("token_version", 0),
                "email": user_doc.get("email") or "",
                "session_id": session_id,
                "username": user_doc.get("username") or "",
            })
            user_response = {
                "id": user_doc["id"],
                "email": user_doc["email"],
                "username": user_doc["username"],
                "rank": user_doc["rank"],
                "money": user_doc["money"],
                "points": user_doc["points"],
                "bodyguard_slots": user_doc["bodyguard_slots"],
                "current_state": user_doc["current_state"],
                "total_kills": user_doc["total_kills"],
                "total_deaths": user_doc["total_deaths"],
                "created_at": user_doc["created_at"],
                "email_verified": False,
                "rules_accepted": bool(user_doc.get("rules_accepted", False)),
            }
            return {
                "token": token,
                "user": user_response,
                "message": "Please check your email to verify your account. You can browse until then.",
                "verify_required": True,
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("Registration error: %s", e)
            raise HTTPException(status_code=500, detail="Registration failed. Please try again.")

    LOGIN_MAX_ATTEMPTS = 3
    LOGIN_LOCKOUT_MINUTES = 5

    def _login_response_user(user: dict) -> dict:
        """Build a JSON-safe user dict for login response. Skips sensitive keys and serializes datetimes so one bad field cannot 500."""
        # Theme/dashboard sync via GET /profile/theme and /profile/dashboard — omit here to slim login JSON.
        skip = {
            "password_hash", "is_dead", "dead_at", "points_at_death", "retrieval_used",
            "theme_preferences", "dashboard_preferences",
        }
        out = {}
        for k, v in user.items():
            if k in skip:
                continue
            try:
                if v is None or isinstance(v, (bool, int, float, str)):
                    out[k] = v
                elif isinstance(v, datetime):
                    out[k] = v.isoformat() if v.tzinfo else v.replace(tzinfo=timezone.utc).isoformat()
                elif isinstance(v, list):
                    out[k] = v  # assume list of primitives or dicts; FastAPI can encode
                elif isinstance(v, dict):
                    out[k] = v
                else:
                    out[k] = str(v)
            except Exception:
                logging.warning("Login response: skipping non-serializable key=%s type=%s", k, type(v).__name__)
        out["rules_accepted"] = bool(user.get("rules_accepted", False))
        return out

    @router.post("/auth/accept-rules")
    async def accept_rules(current_user: dict = Depends(get_current_user)):
        """One-time rules acceptance gate for gameplay access."""
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"rules_accepted": True, "rules_accepted_at": now_iso}},
        )
        return {"ok": True, "rules_accepted": True, "rules_accepted_at": now_iso}

    @router.post("/auth/track-login-page-view")
    async def track_login_page_view(request: Request):
        """Record a visit to the login page (public, no auth). One document per IP — duplicate
        visits from the same IP only update last_seen; they are not counted as extra visitors."""
        ip = _client_ip(request)
        if not ip:
            return {"ok": True}
        now = datetime.now(timezone.utc)
        try:
            await db.login_page_visits.update_one(
                {"ip": ip},
                {
                    "$setOnInsert": {"first_seen": now},
                    "$set": {"last_seen": now},
                    "$inc": {"view_count": 1},
                },
                upsert=True,
            )
        except Exception as e:
            logging.warning("track_login_page_view: %s", e)
        return {"ok": True}

    @router.post("/auth/login")
    async def login(user_data: UserLogin, request: Request):
        login_input = (user_data.email or "").strip()
        now = datetime.now(timezone.utc)
        try:
            return await _do_login(user_data, request, login_input, now, staff_route=False)
        except HTTPException:
            raise
        except Exception as e:
            logging.exception(
                "Login 500 for login=%s exception=%s: %s",
                login_input or "(empty)",
                type(e).__name__,
                e,
            )
            raise HTTPException(status_code=500, detail="Login failed. Please try again or contact support.")

    @router.post("/auth/login-staff")
    async def login_staff(user_data: UserLogin, request: Request):
        """Secret staff-only login. Admins and mods must use this; they get 'Wrong password' on normal /auth/login."""
        login_input = (user_data.email or "").strip()
        now = datetime.now(timezone.utc)
        try:
            return await _do_login(user_data, request, login_input, now, staff_route=True)
        except HTTPException:
            raise
        except Exception as e:
            logging.exception("Login-staff 500 for login=%s: %s", login_input or "(empty)", e)
            raise HTTPException(status_code=500, detail="Login failed. Please try again.")

    async def _do_login(user_data: UserLogin, request: Request, login_input: str, now: datetime, staff_route: bool = False):
        # Require non-empty email/username and password
        if not login_input:
            raise HTTPException(status_code=422, detail="Email or username is required.")
        if not (user_data.password or "").strip():
            raise HTTPException(status_code=422, detail="Password is required.")

        # Check for login lock (skip for staff route - admins can still log in)
        settings = None
        if not staff_route:
            settings = await db.game_settings.find_one({"_id": "main"})
            lock_until_str = settings.get("login_lock_until") if settings else None
            lock_from_str = settings.get("login_lock_from") if settings else None
            if lock_until_str:
                try:
                    lock_until_dt = datetime.fromisoformat(lock_until_str.replace("Z", "+00:00"))
                    started = True
                    if lock_from_str:
                        lock_from_dt = datetime.fromisoformat(lock_from_str.replace("Z", "+00:00"))
                        started = now >= lock_from_dt
                    if started and now < lock_until_dt:
                        raise HTTPException(status_code=423, detail="Login is not available until launch. Please check back later.")
                except HTTPException:
                    raise
                except (ValueError, TypeError):
                    pass

        ip = _client_ip(request)
        block_proxy_vpn_login = bool(settings.get("block_proxy_vpn_login", True)) if settings else True

        # Block VPN/proxy on login (staff can bypass)
        if not staff_route and block_proxy_vpn_login and ip and await is_proxy_or_vpn(ip):
            await _notify_admins_vpn_blocked(
                ip,
                "Login blocked",
                f"Attempted login: {login_input[:30]}",
            )
            raise HTTPException(
                status_code=403,
                detail="Login from proxy or VPN is not allowed. Please disconnect your VPN to use the game.",
            )

        # Find user by email or username (case-insensitive)
        pattern = re.compile("^" + re.escape(login_input) + "$", re.IGNORECASE)
        user = await db.users.find_one({"$or": [{"email": pattern}, {"username": pattern}]}, {"_id": 0})
        if not user:
            # Unknown account: if this IP already has an alive account, record a suspicious attempt
            if ip:
                try:
                    alive_same_ip = await db.users.count_documents(
                        {
                            "is_dead": {"$ne": True},
                            "$or": [
                                {"registration_ip": ip},
                                {"login_ips": ip},
                            ],
                        }
                    )
                    if alive_same_ip >= 1:
                        await db.suspicious_logins.insert_one(
                            {
                                "at": now.isoformat(),
                                "ip": ip,
                                "login_input": login_input,
                                "reason": "no_account_same_ip_alive",
                                "same_ip_alive_count": alive_same_ip,
                            }
                        )
                except Exception:
                    logging.exception("Record suspicious login (no account) failed")
            raise HTTPException(
                status_code=401,
                detail="No account found with that email or username. Please register or check your input.",
            )
        email_clean = (user.get("email") or "").strip().lower()
        if not email_clean:
            raise HTTPException(status_code=401, detail="No account found with that email or username.")

        # Check lockout (by account email)
        lockout = await db.login_lockouts.find_one({"email": email_clean}, {"_id": 0, "locked_until": 1, "failed_count": 1})
        if lockout:
            locked_until = lockout.get("locked_until")
            if isinstance(locked_until, str):
                locked_until = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
            if locked_until and locked_until > now:
                wait_sec = int((locked_until - now).total_seconds())
                wait_min = (wait_sec + 59) // 60
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many failed login attempts. This account is temporarily locked. Try again in {wait_min} minute(s), or use Forgot password.",
                )

        try:
            password_ok = verify_password(user_data.password, user.get("password_hash") or "")
        except Exception:
            password_ok = False
        if not password_ok:
            locked_until = None
            doc = await db.login_lockouts.find_one({"email": email_clean}, {"_id": 0, "failed_count": 1})
            count = (doc.get("failed_count") or 0) + 1
            if count >= LOGIN_MAX_ATTEMPTS:
                locked_until = now + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
            await db.login_lockouts.update_one(
                {"email": email_clean},
                {"$set": {"email": email_clean, "failed_count": count, "locked_until": locked_until.isoformat() if locked_until else None, "updated_at": now.isoformat()}},
                upsert=True,
            )
            # Wrong password: if this IP has another alive account (not this user), record as suspicious
            if ip:
                try:
                    alive_same_ip_other = await db.users.count_documents(
                        {
                            "is_dead": {"$ne": True},
                            "id": {"$ne": user["id"]},
                            "$or": [
                                {"registration_ip": ip},
                                {"login_ips": ip},
                            ],
                        }
                    )
                    if alive_same_ip_other >= 1:
                        await db.suspicious_logins.insert_one(
                            {
                                "at": now.isoformat(),
                                "ip": ip,
                                "login_input": login_input,
                                "user_id": user["id"],
                                "username": user.get("username"),
                                "email": email_clean,
                                "reason": "wrong_password_same_ip_other_alive",
                                "same_ip_other_alive_count": alive_same_ip_other,
                            }
                        )
                except Exception:
                    logging.exception("Record suspicious login (wrong password) failed")
            raise HTTPException(
                status_code=401,
                detail="Wrong password. Use Forgot password to reset it. After 3 failed attempts this account is locked for 5 minutes.",
            )
        # On normal login, block admin/mod — they must use the secret staff login page
        if not staff_route and ((user.get("email") or "") in (ADMIN_EMAILS or set()) or bool(user.get("is_moderator"))):
            raise HTTPException(
                status_code=401,
                detail="Wrong password. Use Forgot password to reset it. After 3 failed attempts this account is locked for 5 minutes.",
            )
        await db.login_lockouts.delete_one({"email": email_clean})
        # Allow login even when dead so the frontend can render the death screen.
        # Gameplay endpoints remain blocked by get_current_user for dead accounts.
        ua = (request.headers.get("User-Agent") or "").strip()[:500]
        device_type = _device_type_from_user_agent(request.headers.get("User-Agent") or "")
        set_fields = {}
        if ip:
            set_fields["last_login_ip"] = ip
        if ua:
            set_fields["last_user_agent"] = ua
        if device_type:
            set_fields["last_device_type"] = device_type
        if set_fields:
            update_op = {"$set": set_fields}
            if ip:
                update_op["$addToSet"] = {"login_ips": ip}
            await db.users.update_one({"id": user["id"]}, update_op)
        if ip:
            doc = await db.users.find_one({"id": user["id"]}, {"_id": 0, "login_ips": 1})
            ips = doc.get("login_ips") or []
            if len(ips) > 20:
                await db.users.update_one({"id": user["id"]}, {"$set": {"login_ips": ips[-20:]}})
        # Create session for this login (per-IP device/last-used and "log out other sessions")
        now_iso = datetime.now(timezone.utc).isoformat()
        session_id = str(uuid.uuid4())
        session_entry = {
            "id": session_id,
            "ip": ip or "",
            "device_type": device_type or "Unknown",
            "created_at": now_iso,
            "last_used_at": now_iso,
        }
        await db.users.update_one(
            {"id": user["id"]},
            {"$push": {"sessions": {"$each": [session_entry], "$position": 0, "$slice": 10}}},
        )
        token = create_access_token({
            "sub": user["id"],
            "v": user.get("token_version", 0),
            "email": user.get("email") or "",
            "session_id": session_id,
            "username": user.get("username") or "",
        })
        
        # Release any pending preorder points if release date has passed
        try:
            settings = await db.game_settings.find_one({"_id": "main"})
            preorder_release_str = settings.get("preorder_points_release_date") if settings else None
            if preorder_release_str:
                preorder_release = datetime.fromisoformat(preorder_release_str.replace("Z", "+00:00"))
                if now >= preorder_release:
                    from routers.money.payments import _credit_preorder_points
                    pending_txns = await db.payment_transactions.find(
                        {"user_id": user["id"], "payment_status": "preorder_pending"}
                    ).to_list(100)
                    for txn in pending_txns:
                        await _credit_preorder_points(db, txn)
        except Exception as e:
            logging.warning("Failed to release preorder points on login: %s", e)
        
        # Apply founding member rewards on first login after launch (staff get them immediately)
        founding_rewards_applied = False
        try:
            if user.get("founding_member") and not user.get("founding_rewards_claimed"):
                launch_happened = True
                if not staff_route:
                    settings = settings or await db.game_settings.find_one({"_id": "main"})
                    lock_until_str = settings.get("login_lock_until") if settings else None
                    if lock_until_str:
                        try:
                            lock_dt = datetime.fromisoformat(lock_until_str.replace("Z", "+00:00"))
                            launch_happened = now >= lock_dt
                        except (ValueError, TypeError):
                            pass
                
                if launch_happened:
                    # Apply rewards
                    badge_name = PREREGISTER_REWARDS.get("badge", "Founding Member")
                    trial_hours = PREREGISTER_REWARDS.get("auto_rank_trial_hours", 24)
                    trial_until = (now + timedelta(hours=trial_hours)).isoformat()
                    num_tokens = PREREGISTER_REWARDS.get("founding_random_tokens", 5)
                    token_inc = {}
                    picked = random.choices(REFERRED_USER_TOKEN_COUNT_FIELDS, k=num_tokens)
                    for field in picked:
                        token_inc[field] = token_inc.get(field, 0) + 1
                    respect_bonus = int(PREREGISTER_REWARDS.get("bonus_respect_points", 0) or 0)
                    reward_update = {
                        "$inc": {
                            "respect_points": respect_bonus,
                            "money": PREREGISTER_REWARDS.get("bonus_cash", 50000),
                            **token_inc,
                        },
                        "$set": {
                            "founding_rewards_claimed": True,
                            "founding_rewards_claimed_at": now.isoformat(),
                            "auto_rank_purchased": True,
                            "auto_rank_trial": True,
                            "auto_rank_trial_until": trial_until,
                            "founding_tokens": token_inc,
                        },
                        "$addToSet": {
                            "badges": badge_name,
                        }
                    }
                    await db.users.update_one({"id": user["id"]}, reward_update)
                    if respect_bonus > 0:
                        await srv.log_respect_earned(user["id"], respect_bonus, "founding_member")
                    founding_rewards_applied = True
                    logging.info("Applied founding member rewards to user %s", user["id"])
        except Exception as e:
            logging.warning("Failed to apply founding member rewards: %s", e)
        
        user_safe = _login_response_user(user)
        if founding_rewards_applied:
            user_safe["founding_rewards_just_applied"] = True
            user_safe["founding_rewards"] = PREREGISTER_REWARDS
        return {"token": token, "user": user_safe}

    @router.post("/auth/password-reset/request")
    async def request_password_reset(data: PasswordResetRequest):
        email_pattern = re.compile("^" + re.escape(data.email.strip()) + "$", re.IGNORECASE)
        user = await db.users.find_one({"email": email_pattern}, {"_id": 0, "id": 1, "email": 1, "username": 1})

        if not user:
            return {
                "message": "If an account exists with that email, a password reset link has been sent.",
                "token": None
            }

        reset_token = str(uuid.uuid4())
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

        await db.password_resets.update_many(
            {"user_id": user["id"], "used": False},
            {"$set": {"used": True}}
        )
        await db.password_resets.insert_one({
            "token": reset_token,
            "user_id": user["id"],
            "email": user["email"],
            "username": user["username"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expires_at.isoformat(),
            "used": False
        })

        import threading
        from utils.email_sender import send_password_reset_email
        def _send_reset_in_background():
            try:
                send_password_reset_email(user["email"], user["username"], reset_token)
            except Exception as e:
                logging.warning("Background password reset email failed: %s", e)
        threading.Thread(target=_send_reset_in_background, daemon=True).start()

        return {
            "message": "If an account exists with that email, a password reset link has been sent.",
            "expires_in_minutes": 60
        }

    @router.post("/auth/password-reset/confirm")
    async def confirm_password_reset(data: PasswordResetConfirm):
        reset_record = await db.password_resets.find_one({"token": data.token}, {"_id": 0})

        if not reset_record:
            raise HTTPException(status_code=400, detail="Invalid or expired reset token")

        if reset_record.get("used"):
            raise HTTPException(status_code=400, detail="This reset token has already been used")

        expires_at = datetime.fromisoformat(reset_record["expires_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=400, detail="Reset token has expired")

        if len(data.new_password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

        new_password_hash = get_password_hash(data.new_password)
        await db.users.update_one(
            {"id": reset_record["user_id"]},
            {"$set": {"password_hash": new_password_hash, "sessions": []}, "$inc": {"token_version": 1}}
        )

        await db.password_resets.update_many(
            {"user_id": reset_record["user_id"]},
            {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}}
        )

        return {"message": "Password has been reset successfully. You can now login with your new password."}

    @router.post("/auth/verify-email")
    async def verify_email(body: VerifyEmailBody, request: Request):
        """Verify email with token from link; marks user verified and returns JWT + user."""
        record = await db.email_verifications.find_one_and_delete({"token": body.token})
        if not record:
            raise HTTPException(status_code=400, detail="Invalid or expired verification link.")
        expires_at = datetime.fromisoformat(record["expires_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=400, detail="Verification link has expired. Request a new one.")
        await db.users.update_one(
            {"id": record["user_id"]},
            {"$set": {"email_verified": True}, "$inc": {"bullets": 2000, "respect_points": 500}},
        )
        await srv.log_respect_earned(record["user_id"], 500, "email_verify")
        user = await db.users.find_one({"id": record["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=400, detail="User not found.")
        user_response = {k: v for k, v in user.items() if k not in ("password_hash", "is_dead", "dead_at", "points_at_death", "retrieval_used")}

        # If login is currently locked (pre-launch), do NOT issue a JWT/session on verification link click.
        # This prevents "click-to-login" while the game is closed.
        settings = await db.game_settings.find_one({"_id": "main"})
        now = datetime.now(timezone.utc)
        login_lock_until = settings.get("login_lock_until") if settings else None
        login_lock_from = settings.get("login_lock_from") if settings else None
        login_is_locked = False
        if login_lock_until:
            try:
                lock_dt = datetime.fromisoformat(login_lock_until.replace("Z", "+00:00"))
                started = True
                if login_lock_from:
                    from_dt = datetime.fromisoformat(login_lock_from.replace("Z", "+00:00"))
                    started = now >= from_dt
                login_is_locked = started and now < lock_dt
            except (ValueError, TypeError):
                pass

        if login_is_locked:
            return {
                "token": None,
                "user": user_response,
                "reward_bullets": 2000,
                "reward_respect_points": 500,
                "detail": "Email verified. Login is not available until launch.",
            }

        ip = _client_ip(request) or ""
        ua = (request.headers.get("User-Agent") or "").strip()
        device_type = _device_type_from_user_agent(ua) if ua else "Unknown"
        now_iso = now.isoformat()
        session_id = str(uuid.uuid4())
        session_entry = {
            "id": session_id,
            "ip": ip,
            "device_type": device_type,
            "created_at": now_iso,
            "last_used_at": now_iso,
        }
        await db.users.update_one(
            {"id": user["id"]},
            {"$push": {"sessions": {"$each": [session_entry], "$position": 0, "$slice": 10}}},
        )
        token = create_access_token({
            "sub": user["id"],
            "v": user.get("token_version", 0),
            "email": user.get("email") or "",
            "session_id": session_id,
            "username": user.get("username") or "",
        })
        return {
            "token": token,
            "user": user_response,
            "reward_bullets": 2000,
            "reward_respect_points": 500,
        }

    @router.post("/auth/resend-verification")
    async def resend_verification(body: ResendVerificationBody):
        """Send a new verification email if the account exists and is not verified. Accepts email or username. 2min cooldown."""
        # Don't send verification emails while login is locked (pre-launch).
        settings = await db.game_settings.find_one({"_id": "main"})
        now = datetime.now(timezone.utc)
        login_lock_until = settings.get("login_lock_until") if settings else None
        login_lock_from = settings.get("login_lock_from") if settings else None
        login_is_locked = False
        if login_lock_until:
            try:
                lock_dt = datetime.fromisoformat(login_lock_until.replace("Z", "+00:00"))
                started = True
                if login_lock_from:
                    from_dt = datetime.fromisoformat(login_lock_from.replace("Z", "+00:00"))
                    started = now >= from_dt
                login_is_locked = started and now < lock_dt
            except (ValueError, TypeError):
                pass
        if login_is_locked:
            return {"message": "Verification emails are disabled until launch."}

        raw = (body.email or "").strip()
        if not raw:
            return {"message": "If an account exists with that email, a new verification link has been sent."}
        try:
            pattern = re.compile("^" + re.escape(raw) + "$", re.IGNORECASE)
            user = await db.users.find_one(
                {"$or": [{"email": pattern}, {"username": pattern}]},
                {"_id": 0, "id": 1, "email": 1, "username": 1, "email_verified": 1, "last_verification_email_sent_at": 1},
            )
            if not user:
                return {"message": "If an account exists with that email, a new verification link has been sent."}
            if user.get("email_verified") is True:
                return {"message": "That account is already verified. You can log in."}
            # 2-minute cooldown per account
            now_utc = datetime.now(timezone.utc)
            last_sent = user.get("last_verification_email_sent_at")
            if last_sent:
                if isinstance(last_sent, str):
                    try:
                        last_sent = datetime.fromisoformat(last_sent.replace("Z", "+00:00"))
                    except (ValueError, TypeError):
                        last_sent = None
                if last_sent is not None:
                    if last_sent.tzinfo is None:
                        last_sent = last_sent.replace(tzinfo=timezone.utc)
                    if (now_utc - last_sent) < timedelta(minutes=2):
                        raise HTTPException(
                            status_code=429,
                            detail="Please wait 2 minutes before requesting another verification email.",
                        )
            await db.email_verifications.delete_many({"user_id": user["id"]})
            verification_token = str(uuid.uuid4())
            expires_at = now_utc + timedelta(hours=24)
            await db.email_verifications.insert_one({
                "token": verification_token,
                "user_id": user["id"],
                "email": user["email"],
                "username": user["username"],
                "created_at": now_utc.isoformat(),
                "expires_at": expires_at.isoformat(),
            })
            import threading
            from utils.email_sender import send_verification_email
            def _resend_in_background():
                try:
                    send_verification_email(user["email"], user["username"], verification_token)
                except Exception as e:
                    logging.exception("Background resend verification email failed for %s: %s", user.get("email"), e)
            threading.Thread(target=_resend_in_background, daemon=True).start()
            await db.users.update_one({"id": user["id"]}, {"$set": {"last_verification_email_sent_at": now_utc.isoformat()}})
            return {
                "message": "If an account exists with that email, a new verification link has been sent.",
            }
        except HTTPException:
            raise
        except Exception as e:
            logging.exception("resend-verification failed for input=%s: %s", raw, e)
            raise HTTPException(status_code=500, detail="Failed to resend verification email. Please try again.")

    def _safe_int(val, default=0):
        if val is None:
            return default
        try:
            return int(val)
        except (TypeError, ValueError):
            return default

    def _safe_float(val, default=0.0):
        if val is None:
            return default
        try:
            return float(val)
        except (TypeError, ValueError):
            return default

    @router.get(
        "/auth/me",
        response_model=UserResponse,
        response_model_exclude={"theme_preferences", "dashboard_preferences"},
    )
    async def get_me(request: Request, current_user: dict = Depends(get_current_user)):
        user_id = current_user.get("id") or "unknown"
        username = current_user.get("username") or user_id
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            path = (request.headers.get("x-current-path") or "").strip() or None
            client_ip = _client_ip(request) or None
            update = {"last_seen": now_iso}
            if path is not None:
                update["last_path"] = path[:500]
            if client_ip:
                update["last_request_ip"] = client_ip
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$set": update}
            )
            
            # Wake up auto-rank if user was idle (no activity for 3+ hours)
            if current_user.get("auto_rank_idle"):
                from routers.account.auto_rank import wake_auto_rank_if_idle
                await wake_auto_rank_if_idle(db, current_user["id"])

            rank_id, rank_name = get_rank_info(_safe_int(current_user.get("rank_points"), 0))
            if current_user.get("email") in ADMIN_EMAILS:
                rank_name = "Admin"
            elif _is_moderator(current_user):
                rank_name = "Moderator"
            money_val = _safe_float(current_user.get("money"), 0.0)
            wealth_id, wealth_name = get_wealth_rank(money_val)
            wealth_range = get_wealth_rank_range(money_val)
            # Casino/property loaded separately via GET /user/casino-property to keep auth/me fast
            u = current_user
            equipped_weapon_id = u.get("equipped_weapon_id")
            family_id = u.get("family_id")
            referred_by = u.get("referred_by")
            _noop = lambda: asyncio.sleep(0, result=None)
            admin_color_doc, weapon_doc, fam, bodyguard_count, ref_user = await asyncio.gather(
                db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1}),
                db.weapons.find_one({"id": equipped_weapon_id}, {"_id": 0, "name": 1}) if equipped_weapon_id else _noop(),
                db.families.find_one({"id": family_id}, {"_id": 0, "name": 1}) if family_id else _noop(),
                db.bodyguards.count_documents({
                    "user_id": u["id"],
                    "$or": [
                        {"bodyguard_user_id": {"$exists": True, "$ne": None}},
                        {"is_robot": True},
                    ],
                }),
                db.users.find_one({"id": referred_by}, {"_id": 0, "username": 1}) if referred_by else _noop(),
            )
            admin_online_color = (admin_color_doc.get("value") or "#a78bfa") if admin_color_doc else "#a78bfa"
            if not isinstance(admin_online_color, str) or not admin_online_color.strip():
                admin_online_color = "#a78bfa"
            admin_online_color = admin_online_color.strip()
            mod_online_color = None
            if _is_moderator(current_user):
                raw = (current_user.get("mod_online_color") or "").strip() or "#1e3a5f"
                mod_online_color = raw if raw.startswith("#") and len(raw) <= 9 else "#1e3a5f"
            # Resolve gun_name, armour_name, gang_name for sidebar
            gun_name = None
            if equipped_weapon_id and weapon_doc:
                gun_name = weapon_doc.get("name") or equipped_weapon_id
            armour_name = None
            alvl = _safe_int(u.get("armour_level"), 0)
            if alvl >= 6:
                armour_name = "Steel Plate Bulletproof Vest (1922)"
            elif alvl > 0:
                armour = next((a for a in ARMOUR_SETS if a.get("level") == alvl), None)
                armour_name = armour.get("name") if armour else f"Level {alvl}"
            location = str(u.get("current_state") or "").strip() or None
            gang_name = None
            family_name = None
            if fam:
                gang_name = fam.get("name")
                family_name = fam.get("name")
            referred_by_username = None
            if ref_user:
                referred_by_username = ref_user.get("username") or None
            return UserResponse(
                id=str(u["id"]),
                email=str(u.get("email") or ""),
                username=str(u.get("username") or ""),
                rank=rank_id,
                rank_name=rank_name,
                wealth_rank=wealth_id,
                wealth_rank_name=wealth_name,
                wealth_rank_range=wealth_range,
                money=money_val,
                points=_safe_int(u.get("points"), 0),
                rank_points=_safe_int(u.get("rank_points"), 0),
                bodyguard_slots=_safe_int(u.get("bodyguard_slots"), 1),
                bodyguard_count=bodyguard_count,
                bullets=_safe_int(u.get("bullets"), 0),
                molotovs=_safe_int(u.get("molotovs"), 0),
                health=_safe_int(u.get("health"), DEFAULT_HEALTH),
                armour_level=_safe_int(u.get("armour_level"), 0),
                current_state=str(u.get("current_state") or ""),
                total_kills=_safe_int(u.get("total_kills"), 0),
                total_deaths=_safe_int(u.get("total_deaths"), 0),
                in_jail=bool(u.get("in_jail", False)),
                jail_until=u.get("jail_until"),
                premium_rank_bar=bool(u.get("premium_rank_bar", False)),
                has_silencer=bool(u.get("has_silencer", False)),
                gun_name=gun_name,
                armour_name=armour_name,
                location=location,
                gang_name=gang_name,
                anti_snitch=bool(u.get("anti_snitch", False)),
                auto_rank_purchased=bool(u.get("auto_rank_purchased", False)),
                auto_rank_enabled=bool(u.get("auto_rank_enabled", False)),
                custom_car_name=u.get("custom_car_name"),
                travels_this_hour=_safe_int(u.get("travels_this_hour"), 0),
                extra_airmiles=_safe_int(u.get("extra_airmiles"), 0),
                garage_batch_limit=_safe_int(u.get("garage_batch_limit"), DEFAULT_GARAGE_BATCH_LIMIT),
                total_crimes=_safe_int(u.get("total_crimes"), 0),
                crime_profit=_safe_int(u.get("crime_profit"), 0),
                created_at=str(u.get("created_at") or datetime.now(timezone.utc).isoformat()),
                swiss_balance=_safe_int(u.get("swiss_balance"), 0),
                swiss_limit=_safe_int(u.get("swiss_limit"), SWISS_BANK_LIMIT_START),
                oc_timer_reduced=bool(u.get("oc_timer_reduced", False)),
                crew_oc_timer_reduced=bool(u.get("crew_oc_timer_reduced", False)),
                admin_ghost_mode=bool(u.get("admin_ghost_mode", False)),
                admin_acting_as_normal=bool(u.get("admin_acting_as_normal", False)),
                casino_profit=0,
                property_profit=0,
                has_casino_or_property=False,
                account_locked=bool(u.get("account_locked", False)),
                account_locked_at=u.get("account_locked_at"),
                account_locked_until=u.get("account_locked_until"),
                account_locked_comment=u.get("account_locked_comment"),
                can_submit_comment=bool(u.get("account_locked", False)) and not u.get("account_locked_comment"),
                email_verified=bool(u.get("email_verified", True)),
                respect_points=_safe_int(u.get("respect_points"), 0),
                loot_box_pieces=_safe_int(u.get("loot_box_pieces"), 0),
                profile_autoplay_video=bool(u.get("profile_autoplay_video", True)),
                admin_online_color=admin_online_color,
                mod_online_color=mod_online_color,
                is_help_desk_operator=bool(u.get("is_help_desk_operator", False)),
                is_dead=bool(u.get("is_dead", False)),
                dead_at=u.get("dead_at"),
                money_at_death=_safe_int(u.get("money_at_death"), 0),
                points_at_death=_safe_int(u.get("points_at_death"), 0),
                killed_by_username=u.get("killed_by_username"),
                killed_by_family_name=u.get("killed_by_family_name"),
                killer_revealed=bool(u.get("killer_revealed", False)),
                family_name=family_name,
                # Active consumable token expiry times
                xp_crimes_until=u.get("xp_crimes_until"),
                xp_gta_until=u.get("xp_gta_until"),
                melt_until=u.get("melt_until"),
                oc_reduced_until=u.get("oc_reduced_until"),
                booze_until=u.get("booze_until"),
                racket_until=u.get("racket_until"),
                travel_until=u.get("travel_until"),
                properties_until=u.get("properties_until"),
                jailbust_bonus_until=u.get("jailbust_bonus_until"),
                rank_xp_pass_bonus_until=u.get("rank_xp_pass_bonus_until"),
                xp_crimes_tokens=_safe_int(u.get("xp_crimes_tokens"), 0),
                xp_gta_tokens=_safe_int(u.get("xp_gta_tokens"), 0),
                melt_tokens=_safe_int(u.get("melt_tokens"), 0),
                oc_reduced_tokens=_safe_int(u.get("oc_reduced_tokens"), 0),
                booze_tokens=_safe_int(u.get("booze_tokens"), 0),
                racket_tokens=_safe_int(u.get("racket_tokens"), 0),
                travel_tokens=_safe_int(u.get("travel_tokens"), 0),
                properties_tokens=_safe_int(u.get("properties_tokens"), 0),
                jailbust_tokens=_safe_int(u.get("jailbust_tokens"), 0),
                rank_xp_pass_tokens=_safe_int(u.get("rank_xp_pass_tokens"), 0),
                rank_xp_pass_token_expires_at=u.get("rank_xp_pass_token_expires_at"),
                rank_xp_pass_tier_snapshot=_safe_int(u.get("rank_xp_pass_tier_snapshot"), 0) if u.get("rank_xp_pass_tier_snapshot") is not None else None,
                rank_xp_pass_last_granted_micro_tier=_safe_int(u.get("rank_xp_pass_last_granted_micro_tier"), 0),
                rank_xp_pass_rewards_granted=bool(u.get("rank_xp_pass_rewards_granted", False)),
                shooting_range_bonus_plays=_safe_int(u.get("shooting_range_bonus_plays"), 0),
                censor_profanity=bool(u.get("censor_profanity", False)),
                referred_by=referred_by,
                referred_by_username=referred_by_username,
                rules_accepted=bool(u.get("rules_accepted", False)),
                rules_accepted_at=u.get("rules_accepted_at"),
            )
        except HTTPException:
            raise
        except Exception as e:
            logging.exception(
                "auth/me 500 for user_id=%s username=%s: %s",
                user_id,
                username,
                e,
            )
            try:
                await db.profile_load_errors.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "username": username,
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                pass
            raise HTTPException(
                status_code=500,
                detail="Profile could not be loaded for your account. The issue has been logged; please try again or contact support.",
            )

    @router.get("/account-locked")
    async def get_account_locked(current_user: dict = Depends(get_current_user)):
        """Locked page data: only for locked users; others get account_locked false."""
        locked = bool(current_user.get("account_locked", False))
        can_submit = locked and not current_user.get("account_locked_comment")
        has_admin_message = bool(current_user.get("account_locked_admin_message"))
        can_submit_reply = locked and has_admin_message and not current_user.get("account_locked_user_reply")
        return {
            "account_locked": locked,
            "can_submit_comment": can_submit,
            "comment": current_user.get("account_locked_comment"),
            "comment_at": current_user.get("account_locked_comment_at"),
            "account_locked_until": current_user.get("account_locked_until"),
            "admin_message": current_user.get("account_locked_admin_message"),
            "admin_message_at": current_user.get("account_locked_admin_message_at"),
            "user_reply": current_user.get("account_locked_user_reply"),
            "user_reply_at": current_user.get("account_locked_user_reply_at"),
            "can_submit_reply": can_submit_reply,
        }

    @router.post("/account-locked")
    async def post_account_locked(body: AccountLockedCommentBody, current_user: dict = Depends(get_current_user)):
        """Submit the one allowed comment while account is locked. Only once per lock."""
        if not current_user.get("account_locked"):
            raise HTTPException(status_code=400, detail="Your account is not locked.")
        if current_user.get("account_locked_comment"):
            raise HTTPException(status_code=400, detail="You have already submitted your comment.")
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"account_locked_comment": body.comment, "account_locked_comment_at": now_iso}},
        )
        return {"message": "Your comment has been recorded.", "comment_at": now_iso}

    @router.post("/account-locked-reply")
    async def post_account_locked_reply(body: AccountLockedReplyBody, current_user: dict = Depends(get_current_user)):
        """Reply once to staff message while locked. Only when staff has left a message and user has not replied yet."""
        if not current_user.get("account_locked"):
            raise HTTPException(status_code=400, detail="Your account is not locked.")
        if not current_user.get("account_locked_admin_message"):
            raise HTTPException(status_code=400, detail="No message from staff to reply to.")
        if current_user.get("account_locked_user_reply"):
            raise HTTPException(status_code=400, detail="You have already replied.")
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"account_locked_user_reply": body.reply, "account_locked_user_reply_at": now_iso}},
        )
        return {"message": "Your reply has been recorded.", "user_reply_at": now_iso}

    @router.get("/account/referral")
    async def get_referral(current_user: dict = Depends(get_current_user)):
        """Referral page: link, referred-by, signup bonus if applicable, and earnings breakdown by source."""
        user_id = current_user.get("id")
        username = (current_user.get("username") or "").strip()
        referred_by = current_user.get("referred_by")
        referred_by_username = None
        if referred_by:
            ref_user = await db.users.find_one({"id": referred_by}, {"_id": 0, "username": 1})
            if ref_user:
                referred_by_username = ref_user.get("username") or None
        earnings = {
            "melt_bullets": int(current_user.get("referral_earnings_melt_bullets") or 0),
            "crime_profit": int(current_user.get("referral_earnings_crime") or 0),
            "oc_profit": int(current_user.get("referral_earnings_oc") or 0),
            "garage_scrap": int(current_user.get("referral_earnings_garage_scrap") or 0),
            "booze_profit": int(current_user.get("referral_earnings_booze") or 0),
        }
        signup_bonus = None
        if referred_by_username:
            signup_bonus = "Premium rank bar, 500 respect points, and 18 tokens (use them; they can't be sold on Quick Trade). Plus 2% higher crime payouts and a slight GTA rare car boost."
        redeem_stats = {
            "total_money": int(current_user.get("redeem_stats_total_money") or 0),
            "total_points": int(current_user.get("redeem_stats_total_points") or 0),
            "total_respect_points": int(current_user.get("redeem_stats_total_respect_points") or 0),
            "total_loot_box_pieces": int(current_user.get("redeem_stats_total_loot_box_pieces") or 0),
            "total_cars": int(current_user.get("redeem_stats_total_cars") or 0),
            "total_tokens": int(current_user.get("redeem_stats_total_tokens") or 0),
        }
        return {
            "username": username,
            "referred_by_username": referred_by_username,
            "signup_bonus": signup_bonus,
            "earnings": earnings,
            "redeem_stats": redeem_stats,
        }

    class RedeemRequestBody(BaseModel):
        code: str

    @router.post("/account/redeem")
    async def redeem_code(body: RedeemRequestBody, current_user: dict = Depends(get_current_user)):
        """Redeem a code. One redemption per user per code; respects max_uses."""
        from routers.kill.armoury import TOKEN_CONFIG
        code_normalized = (body.code or "").strip().upper()
        if not code_normalized:
            raise HTTPException(status_code=400, detail="Code is required")
        user_id = current_user.get("id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Not authenticated")
        doc = await db.redeem_codes.find_one({"code": code_normalized, "active": True})
        if not doc:
            raise HTTPException(status_code=400, detail="Invalid or inactive code")
        used_by = doc.get("used_by") or []
        if user_id in used_by:
            raise HTTPException(status_code=400, detail="You have already used this code.")
        max_uses = doc.get("max_uses")
        used_count = int(doc.get("used_count", 0))
        if max_uses is not None and used_count >= max_uses:
            raise HTTPException(status_code=400, detail="This code has reached its redemption limit.")

        claim_filter = {
            "code": code_normalized,
            "active": True,
            "used_by": {"$nin": [user_id]},
        }
        if max_uses is not None:
            claim_filter["used_count"] = {"$lt": int(max_uses)}
        claimed = await db.redeem_codes.find_one_and_update(
            claim_filter,
            {"$inc": {"used_count": 1}, "$push": {"used_by": user_id}},
        )
        if not claimed:
            raise HTTPException(status_code=400, detail="Code already used or limit reached.")
        new_used = int(claimed.get("used_count", 0)) + 1

        rewards = doc.get("rewards") or {}
        inc = {}
        if rewards.get("money"):
            inc["money"] = int(rewards["money"])
        if rewards.get("points"):
            inc["points"] = int(rewards["points"])
        if rewards.get("respect_points"):
            inc["respect_points"] = int(rewards["respect_points"])
        if rewards.get("loot_box_pieces"):
            inc["loot_box_pieces"] = int(rewards["loot_box_pieces"])
        for token_type, amount in (rewards.get("tokens") or {}).items():
            cfg = TOKEN_CONFIG.get(token_type)
            if cfg and amount:
                inc[cfg["count_field"]] = int(amount)
        inc["redeem_stats_total_money"] = int(rewards.get("money") or 0)
        inc["redeem_stats_total_points"] = int(rewards.get("points") or 0)
        inc["redeem_stats_total_respect_points"] = int(rewards.get("respect_points") or 0)
        inc["redeem_stats_total_loot_box_pieces"] = int(rewards.get("loot_box_pieces") or 0)
        inc["redeem_stats_total_cars"] = len(rewards.get("cars") or [])
        inc["redeem_stats_total_tokens"] = sum(int(a) for a in (rewards.get("tokens") or {}).values())
        if inc:
            await db.users.update_one({"id": user_id}, {"$inc": inc})
        for car_id in (rewards.get("cars") or []):
            car_info = next((c for c in CARS if c.get("id") == car_id), None)
            if car_info:
                await db.user_cars.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "car_id": car_id,
                    "car_name": car_info.get("name", car_id),
                    "acquired_at": datetime.now(timezone.utc).isoformat(),
                })
        max_uses_val = doc.get("max_uses")
        topic_id = doc.get("forum_topic_id")
        if topic_id and max_uses_val is not None and new_used >= int(max_uses_val):
            from routers.social.forum import remove_redeem_code_forum_topic

            await remove_redeem_code_forum_topic(topic_id)
            await db.redeem_codes.update_one({"code": code_normalized}, {"$unset": {"forum_topic_id": ""}})
        granted = []
        if inc.get("money"):
            granted.append(f"${inc['money']:,} cash")
        if inc.get("points"):
            granted.append(f"{inc['points']:,} points")
        if inc.get("respect_points"):
            granted.append(f"{inc['respect_points']:,} respect")
        if inc.get("loot_box_pieces"):
            granted.append(f"{inc['loot_box_pieces']} loot pieces")
        for token_type, amount in (rewards.get("tokens") or {}).items():
            if amount:
                granted.append(f"{amount} {token_type.replace('_', ' ')} token(s)")
        for car_id in (rewards.get("cars") or []):
            car_info = next((c for c in CARS if c.get("id") == car_id), None)
            if car_info:
                granted.append(car_info.get("name", car_id))
        return {"message": "Code redeemed successfully", "granted": granted}

    @router.get("/user/casino-property")
    async def get_casino_property(current_user: dict = Depends(get_current_user)):
        """Lightweight endpoint for casino/property profit and menu flag. Called after first paint so auth/me stays fast."""
        casino_cash, property_pts, has_casino, has_property, _lifetime = await _get_casino_property_profit(current_user["id"])
        return {
            "casino_profit": int(casino_cash) if casino_cash is not None else 0,
            "property_profit": int(property_pts) if property_pts is not None else 0,
            "has_casino_or_property": has_casino or has_property,
        }

    @router.get("/auth/ip-info")
    async def get_ip_info(request: Request, current_user: dict = Depends(get_current_user)):
        """Return current IP, accounts from this IP, IPs/sessions with device and last-used (for IP & Devices page)."""
        current_ip = _client_ip(request) or ""
        accounts_from_current_ip = []
        if current_ip:
            cursor = db.users.find(
                {"$or": [{"registration_ip": current_ip}, {"login_ips": current_ip}]},
                {"_id": 0, "username": 1},
            )
            seen = set()
            async for u in cursor:
                un = (u.get("username") or "").strip()
                if un and un not in seen:
                    seen.add(un)
                    accounts_from_current_ip.append(un)
        your_ips = []
        reg_ip = (current_user.get("registration_ip") or "").strip()
        if reg_ip:
            your_ips.append(reg_ip)
        for ip in (current_user.get("login_ips") or []):
            ip = (ip or "").strip()
            if ip and ip not in your_ips:
                your_ips.append(ip)
        ua = (request.headers.get("User-Agent") or "").strip()
        current_device_type = _device_type_from_user_agent(ua) if ua else None
        last_device_type = (current_user.get("last_device_type") or "").strip() or None
        current_session_id = current_user.get("_session_id")
        sessions_raw = current_user.get("sessions") or []
        sessions = [
            {
                "id": s.get("id"),
                "ip": (s.get("ip") or "").strip(),
                "device_type": (s.get("device_type") or "Unknown").strip(),
                "created_at": s.get("created_at"),
                "last_used_at": s.get("last_used_at"),
                "is_current": s.get("id") == current_session_id,
            }
            for s in sessions_raw
            if s.get("id")
        ]
        return {
            "current_ip": current_ip,
            "accounts_from_current_ip": accounts_from_current_ip,
            "your_signin_ips": your_ips,
            "current_device_type": current_device_type,
            "last_device_type": last_device_type,
            "sessions": sessions,
        }

    @router.post("/auth/sessions/revoke")
    async def revoke_session(body: RevokeSessionBody, current_user: dict = Depends(get_current_user)):
        """Revoke another session (log out that device). Cannot revoke the current session."""
        session_id = (body.session_id or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id required")
        current_session_id = current_user.get("_session_id")
        if session_id == current_session_id:
            raise HTTPException(status_code=400, detail="Cannot revoke current session")
        result = await db.users.update_one(
            {"id": current_user["id"]},
            {"$pull": {"sessions": {"id": session_id}}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Session not found or already revoked")
        return {"message": "Session revoked"}

    # ─── PRE-REGISTRATION SYSTEM ─────────────────────────────────────────────
    @router.post("/auth/preregister")
    async def preregister_email(body: PreRegisterBody, request: Request):
        """Email-only pre-registration for launch notifications and founding member rewards."""
        email_clean = (body.email or "").strip().lower()
        if is_disposable_email(email_clean):
            raise HTTPException(status_code=400, detail="Disposable email addresses are not allowed.")
        
        # Check if already pre-registered or has an account
        existing_prereg = await db.preregistrations.find_one({"email": email_clean})
        if existing_prereg:
            return {"message": "You're already on the list!", "already_registered": True}
        
        existing_user = await db.users.find_one({"email": {"$regex": f"^{re.escape(email_clean)}$", "$options": "i"}})
        if existing_user:
            return {"message": "You already have an account! You'll receive founding member rewards.", "already_registered": True}
        
        # Store pre-registration
        doc = {
            "email": email_clean,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ip": _client_ip(request),
            "converted": False,
        }
        await db.preregistrations.insert_one(doc)
        
        return {
            "message": (
                "You're in! We'll email you when the game launches. "
                "Create a full account to earn the Founding Member badge, launch-day respect & cash, and a permanent +2.5% bonus on core payouts."
            ),
            "rewards": PREREGISTER_REWARDS,
        }

    @router.get("/auth/preregister/stats")
    async def get_preregister_stats():
        """Public stats for pre-registration page."""
        total_preregistered = await db.preregistrations.count_documents({})
        total_accounts = await db.users.count_documents({"is_dead": {"$ne": True}})
        settings = await db.game_settings.find_one({"_id": "main"})
        lock_until = settings.get("login_lock_until") if settings else None
        
        return {
            "total_interested": total_preregistered + total_accounts,
            "preregistered_emails": total_preregistered,
            "registered_accounts": total_accounts,
            "launch_date": lock_until,
            "rewards": PREREGISTER_REWARDS,
        }

    @router.get("/auth/preregister/rewards")
    async def get_preregister_rewards():
        """Get the current pre-registration rewards."""
        return {"rewards": PREREGISTER_REWARDS}
