# Auth: register, login, password reset, /auth/me
import logging
import re
import traceback
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, field_validator

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


class VerifyEmailBody(BaseModel):
    token: str


class ResendVerificationBody(BaseModel):
    email: EmailStr


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

    async def _require_email_verification():
        doc = await db.game_settings.find_one({"key": "require_email_verification"}, {"_id": 0, "value": 1})
        return bool(doc.get("value") if doc else False)

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
                "email_verified": not require_verification,
                "auto_rank_purchased": False,
                "auto_rank_enabled": False,
                "mission_completions": [],
                "unlocked_maps_up_to": "Chicago",
            }

            await db.users.insert_one(user_doc.copy())

            if not require_verification:
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
                    "created_at": user_doc["created_at"],
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
            email_sent = False
            try:
                from email_sender import send_verification_email, verification_link
                email_sent = send_verification_email(user_doc["email"], user_doc["username"], verification_token)
            except Exception as e:
                logging.warning("Failed to send verification email: %s", e)
            out = {
                "message": "Please check your email to verify your account. Then you can log in." if email_sent
                else "Verification email could not be sent (RESEND_API_KEY not set or mail failed). Use the link below to verify.",
                "verify_required": True,
            }
            if not email_sent:
                from email_sender import verification_link
                out["verification_link"] = verification_link(verification_token)
            return out
        except HTTPException:
            raise
        except Exception as e:
            logging.error(f"Registration error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

    LOGIN_MAX_ATTEMPTS = 3
    LOGIN_LOCKOUT_MINUTES = 5

    def _login_response_user(user: dict) -> dict:
        """Build a JSON-safe user dict for login response. Skips sensitive keys and serializes datetimes so one bad field cannot 500."""
        skip = {"password_hash", "is_dead", "dead_at", "points_at_death", "retrieval_used"}
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
        return out

    @router.post("/auth/login")
    async def login(user_data: UserLogin, request: Request):
        email_clean = (user_data.email or "").strip().lower()
        now = datetime.now(timezone.utc)
        try:
            return await _do_login(user_data, request, email_clean, now)
        except HTTPException:
            raise
        except Exception as e:
            logging.exception(
                "Login 500 for email=%s exception=%s: %s",
                email_clean or "(empty)",
                type(e).__name__,
                e,
            )
            raise HTTPException(status_code=500, detail="Login failed. Please try again or contact support.")

    async def _do_login(user_data: UserLogin, request: Request, email_clean: str, now: datetime):
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
        if not user:
            raise HTTPException(
                status_code=401,
                detail="No account found with that email. Please register or check the email address.",
            )
        try:
            password_ok = verify_password(user_data.password, user.get("password_hash") or "")
        except Exception:
            password_ok = False
        if not password_ok:
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
                detail="Wrong password. Use Forgot password to reset it. After 3 failed attempts this email is locked for 5 minutes.",
            )
        # Success: clear lockout for this email
        await db.login_lockouts.delete_one({"email": email_clean})
        require_verification = await _require_email_verification()
        if require_verification and user.get("email_verified") is False:
            raise HTTPException(
                status_code=403,
                detail="Please verify your email first. Check your inbox or request a new verification link.",
            )
        if user.get("is_dead"):
            raise HTTPException(
                status_code=403,
                detail="This account is dead and cannot log in. Create a new account and use Dead > Alive to transfer 5% of this account’s money and points.",
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
        user_safe = _login_response_user(user)
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

        await db.password_resets.insert_one({
            "token": reset_token,
            "user_id": user["id"],
            "email": user["email"],
            "username": user["username"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expires_at.isoformat(),
            "used": False
        })

        try:
            from email_sender import send_password_reset_email
            send_password_reset_email(user["email"], user["username"], reset_token)
        except Exception as e:
            logging.warning("Failed to send password reset email: %s", e)

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
            {"$set": {"password_hash": new_password_hash}}
        )

        await db.password_resets.update_one(
            {"token": data.token},
            {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}}
        )

        return {"message": "Password has been reset successfully. You can now login with your new password."}

    @router.post("/auth/verify-email")
    async def verify_email(body: VerifyEmailBody):
        """Verify email with token from link; marks user verified and returns JWT + user."""
        record = await db.email_verifications.find_one({"token": body.token}, {"_id": 0})
        if not record:
            raise HTTPException(status_code=400, detail="Invalid or expired verification link.")
        expires_at = datetime.fromisoformat(record["expires_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires_at:
            await db.email_verifications.delete_one({"token": body.token})
            raise HTTPException(status_code=400, detail="Verification link has expired. Request a new one.")
        await db.users.update_one({"id": record["user_id"]}, {"$set": {"email_verified": True}})
        await db.email_verifications.delete_one({"token": body.token})
        user = await db.users.find_one({"id": record["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=400, detail="User not found.")
        token = create_access_token({"sub": user["id"], "v": user.get("token_version", 0)})
        user_response = {k: v for k, v in user.items() if k not in ("password_hash", "is_dead", "dead_at", "points_at_death", "retrieval_used")}
        return {"token": token, "user": user_response}

    @router.post("/auth/resend-verification")
    async def resend_verification(body: ResendVerificationBody):
        """Send a new verification email if the account exists and is not verified."""
        email_clean = (body.email or "").strip().lower()
        email_pattern = re.compile("^" + re.escape(email_clean) + "$", re.IGNORECASE)
        user = await db.users.find_one({"email": email_pattern}, {"_id": 0, "id": 1, "email": 1, "username": 1, "email_verified": 1})
        if not user:
            return {"message": "If an account exists with that email, a new verification link has been sent."}
        if user.get("email_verified") is True:
            return {"message": "That account is already verified. You can log in."}
        # Delete any old verification for this user
        await db.email_verifications.delete_many({"user_id": user["id"]})
        verification_token = str(uuid.uuid4())
        expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
        await db.email_verifications.insert_one({
            "token": verification_token,
            "user_id": user["id"],
            "email": user["email"],
            "username": user["username"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expires_at.isoformat(),
        })
        email_sent = False
        try:
            from email_sender import send_verification_email, verification_link
            email_sent = send_verification_email(user["email"], user["username"], verification_token)
        except Exception as e:
            logging.warning("Failed to send verification email: %s", e)
        out = {"message": "If an account exists with that email, a new verification link has been sent." if email_sent
            else "Verification email could not be sent. Use the link below to verify."}
        if not email_sent:
            from email_sender import verification_link
            out["verification_link"] = verification_link(verification_token)
        return out

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
            # Casino/property loaded separately via GET /user/casino-property to keep auth/me fast
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
                casino_profit=0,
                property_profit=0,
                has_casino_or_property=False,
                theme_preferences=u.get("theme_preferences"),
                account_locked=bool(u.get("account_locked", False)),
                account_locked_at=u.get("account_locked_at"),
                account_locked_until=u.get("account_locked_until"),
                account_locked_comment=u.get("account_locked_comment"),
                can_submit_comment=bool(u.get("account_locked", False)) and not u.get("account_locked_comment"),
                email_verified=bool(u.get("email_verified", True)),
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

    @router.get("/user/casino-property")
    async def get_casino_property(current_user: dict = Depends(get_current_user)):
        """Lightweight endpoint for casino/property profit and menu flag. Called after first paint so auth/me stays fast."""
        casino_cash, property_pts, has_casino, has_property = await _get_casino_property_profit(current_user["id"])
        return {
            "casino_profit": int(casino_cash) if casino_cash is not None else 0,
            "property_profit": int(property_pts) if property_pts is not None else 0,
            "has_casino_or_property": has_casino or has_property,
        }
