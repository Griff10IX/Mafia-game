# Auth: register, login, password reset, /auth/me
import logging
import re
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr


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

            token = create_access_token({"sub": user_id})

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

    @router.post("/auth/login")
    async def login(user_data: UserLogin, request: Request):
        email_pattern = re.compile("^" + re.escape(user_data.email.strip()) + "$", re.IGNORECASE)
        user = await db.users.find_one({"email": email_pattern}, {"_id": 0})
        if not user or not verify_password(user_data.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if user.get("is_dead"):
            raise HTTPException(
                status_code=403,
                detail="This account is dead and cannot be used. Create a new account. You may retrieve a portion of your points via Dead > Alive."
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
        token = create_access_token({"sub": user["id"]})
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

    @router.get("/auth/me")
    async def get_me(current_user: dict = Depends(get_current_user)):
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"last_seen": datetime.now(timezone.utc).isoformat()}}
        )

        rank_id, rank_name = get_rank_info(current_user.get("rank_points", 0))
        if current_user.get("email") in ADMIN_EMAILS:
            rank_name = "Admin"
        wealth_id, wealth_name = get_wealth_rank(current_user.get("money", 0))
        wealth_range = get_wealth_rank_range(current_user.get("money", 0))
        casino_cash, property_pts, has_casino, has_property = await _get_casino_property_profit(current_user["id"])
        return UserResponse(
            id=current_user["id"],
            email=current_user["email"],
            username=current_user["username"],
            rank=rank_id,
            rank_name=rank_name,
            wealth_rank=wealth_id,
            wealth_rank_name=wealth_name,
            wealth_rank_range=wealth_range,
            money=current_user["money"],
            points=current_user["points"],
            rank_points=current_user.get("rank_points", 0),
            bodyguard_slots=current_user["bodyguard_slots"],
            bullets=current_user.get("bullets", 0),
            health=current_user.get("health", DEFAULT_HEALTH),
            armour_level=current_user.get("armour_level", 0),
            current_state=current_user["current_state"],
            total_kills=current_user["total_kills"],
            total_deaths=current_user["total_deaths"],
            in_jail=current_user.get("in_jail", False),
            jail_until=current_user.get("jail_until"),
            premium_rank_bar=current_user.get("premium_rank_bar", False),
            has_silencer=current_user.get("has_silencer", False),
            custom_car_name=current_user.get("custom_car_name"),
            travels_this_hour=current_user.get("travels_this_hour", 0),
            extra_airmiles=current_user.get("extra_airmiles", 0),
            garage_batch_limit=current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT),
            total_crimes=current_user.get("total_crimes", 0),
            crime_profit=int(current_user.get("crime_profit", 0) or 0),
            created_at=current_user["created_at"],
            swiss_balance=int(current_user.get("swiss_balance", 0) or 0),
            swiss_limit=int(current_user.get("swiss_limit", SWISS_BANK_LIMIT_START) or SWISS_BANK_LIMIT_START),
            oc_timer_reduced=bool(current_user.get("oc_timer_reduced", False)),
            crew_oc_timer_reduced=bool(current_user.get("crew_oc_timer_reduced", False)),
            admin_ghost_mode=bool(current_user.get("admin_ghost_mode", False)),
            admin_acting_as_normal=bool(current_user.get("admin_acting_as_normal", False)),
            casino_profit=casino_cash,
            property_profit=property_pts,
            has_casino_or_property=has_casino or has_property,
            theme_preferences=current_user.get("theme_preferences"),
        )
