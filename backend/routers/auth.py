# Auth: register, login, password reset, /auth/me
import logging
import re
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from disposable_email import is_disposable_email
from security import is_proxy_or_vpn


class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


def register(router):
    """Register auth routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_password_hash = srv.get_password_hash
    verify_password = srv.verify_password
    create_access_token = srv.create_access_token
    get_current_user = srv.get_current_user
    get_rank_info = srv.get_rank_info
    get_wealth_rank = srv.get_wealth_rank
    get_wealth_rank_range = srv.get_wealth_rank_range
    _get_casino_property_profit = srv._get_casino_property_profit
    UserResponse = srv.UserResponse
    DEFAULT_HEALTH = srv.DEFAULT_HEALTH
    DEFAULT_GARAGE_BATCH_LIMIT = srv.DEFAULT_GARAGE_BATCH_LIMIT
    SWISS_BANK_LIMIT_START = srv.SWISS_BANK_LIMIT_START
    ADMIN_EMAILS = srv.ADMIN_EMAILS

    def _client_ip(request: Request):
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host or ""
        return ""

    @router.post("/auth/register")
    async def register_user(user_data: UserRegister, request: Request):
        try:
            email_clean = (user_data.email or "").strip().lower()
            if is_disposable_email(email_clean):
                raise HTTPException(
                    status_code=400,
                    detail="Disposable or temporary email addresses are not allowed.",
                )
            client_ip = _client_ip(request)
            if client_ip and await is_proxy_or_vpn(client_ip):
                raise HTTPException(
                    status_code=400,
                    detail="Registration from proxy or VPN is not allowed.",
                )
            # Block if an alive account already exists on this IP
            if client_ip:
                alive_same_ip = await db.users.find_one(
                    {
                        "is_dead": {"$ne": True},
                        "$or": [
                            {"registration_ip": client_ip},
                            {"login_ips": client_ip},
                        ],
                    },
                    {"_id": 0, "username": 1},
                )
                if alive_same_ip:
                    raise HTTPException(
                        status_code=400,
                        detail="An account from this device or network is already registered. Log in to that account.",
                    )

            email_pattern = re.compile("^" + re.escape(user_data.email.strip()) + "$", re.IGNORECASE)
            username_pattern = re.compile("^" + re.escape(user_data.username.strip()) + "$", re.IGNORECASE)
            existing = await db.users.find_one({"$or": [{"email": email_pattern}, {"username": username_pattern}]}, {"_id": 0})
            if existing:
                if existing.get("is_dead"):
                    await db.users.update_one(
                        {"id": existing["id"]},
                        {"$set": {
                            "email": f"dead_{existing['id']}@deleted",
                            "username": f"dead_{existing['id'][:8]}",
                        }}
                    )
                else:
                    raise HTTPException(status_code=400, detail="Email or username already registered")

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
            }

            result = await db.users.insert_one(user_doc.copy())

            token = create_access_token({"sub": user_id, "v": user_doc.get("token_version", 0)})

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
                "created_at": user_doc["created_at"]
            }

            return {"token": token, "user": user_response}
        except HTTPException:
            raise
        except Exception as e:
            logging.error(f"Registration error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

    LOGIN_MAX_ATTEMPTS = 3
    LOGIN_LOCKOUT_MINUTES = 5

    @router.post("/auth/login")
    async def login(user_data: UserLogin, request: Request):
        email_clean = user_data.email.strip().lower()
        now = datetime.now(timezone.utc)

        # Require non-empty email and password
        if not email_clean:
            raise HTTPException(status_code=422, detail="Email is required.")
        if not (user_data.password or "").strip():
            raise HTTPException(status_code=422, detail="Password is required.")

        # Check lockout (too many failed attempts)
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
                    detail=f"Too many failed login attempts. This email is temporarily locked. Try again in {wait_min} minute(s), or use Forgot password.",
                )

        email_pattern = re.compile("^" + re.escape(user_data.email.strip()) + "$", re.IGNORECASE)
        user = await db.users.find_one({"email": email_pattern}, {"_id": 0})
        if not user or not verify_password(user_data.password, user["password_hash"]):
            # Record failed attempt and optionally lock out
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
            raise HTTPException(
                status_code=401,
                detail="Invalid email or password. Use Forgot password if you need to reset. After 3 failed attempts this email is locked for 5 minutes.",
            )
        # Success: clear lockout for this email
        await db.login_lockouts.delete_one({"email": email_clean})
        if user.get("is_dead"):
            raise HTTPException(
                status_code=403,
                detail="This account is dead and cannot log in. Create a new account; you may retrieve a portion of your points via Dead to Alive.",
            )
        ip = _client_ip(request)
        if ip:
            await db.users.update_one(
                {"id": user["id"]},
                {"$set": {"last_login_ip": ip}, "$addToSet": {"login_ips": ip}},
            )
            doc = await db.users.find_one({"id": user["id"]}, {"_id": 0, "login_ips": 1})
            ips = doc.get("login_ips") or []
            if len(ips) > 20:
                await db.users.update_one({"id": user["id"]}, {"$set": {"login_ips": ips[-20:]}})
        token = create_access_token({"sub": user["id"], "v": user.get("token_version", 0)})
        return {"token": token, "user": {k: v for k, v in user.items() if k not in ("password_hash", "is_dead", "dead_at", "points_at_death", "retrieval_used")}}

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

        await db.password_resets.insert_one({
            "token": reset_token,
            "user_id": user["id"],
            "email": user["email"],
            "username": user["username"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expires_at.isoformat(),
            "used": False
        })

        return {
            "message": "If an account exists with that email, a password reset link has been sent.",
            "token": reset_token,
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
            {"$set": {"password_hash": new_password_hash}}
        )

        await db.password_resets.update_one(
            {"token": data.token},
            {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}}
        )

        return {"message": "Password has been reset successfully. You can now login with your new password."}

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

    @router.get("/auth/me")
    async def get_me(current_user: dict = Depends(get_current_user)):
        user_id = current_user.get("id") or "unknown"
        username = current_user.get("username") or user_id
        try:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$set": {"last_seen": datetime.now(timezone.utc).isoformat()}}
            )

            rank_id, rank_name = get_rank_info(_safe_int(current_user.get("rank_points"), 0))
            if current_user.get("email") in ADMIN_EMAILS:
                rank_name = "Admin"
            money_val = _safe_float(current_user.get("money"), 0.0)
            wealth_id, wealth_name = get_wealth_rank(money_val)
            wealth_range = get_wealth_rank_range(money_val)
            casino_cash, property_pts, has_casino, has_property = await _get_casino_property_profit(current_user["id"])
            u = current_user
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
                bullets=_safe_int(u.get("bullets"), 0),
                health=_safe_int(u.get("health"), DEFAULT_HEALTH),
                armour_level=_safe_int(u.get("armour_level"), 0),
                current_state=str(u.get("current_state") or ""),
                total_kills=_safe_int(u.get("total_kills"), 0),
                total_deaths=_safe_int(u.get("total_deaths"), 0),
                in_jail=bool(u.get("in_jail", False)),
                jail_until=u.get("jail_until"),
                premium_rank_bar=bool(u.get("premium_rank_bar", False)),
                has_silencer=bool(u.get("has_silencer", False)),
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
                casino_profit=int(casino_cash) if casino_cash is not None else 0,
                property_profit=int(property_pts) if property_pts is not None else 0,
                has_casino_or_property=has_casino or has_property,
                theme_preferences=u.get("theme_preferences"),
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
            raise HTTPException(
                status_code=500,
                detail="Profile could not be loaded for your account. The issue has been logged; please try again or contact support.",
            )
