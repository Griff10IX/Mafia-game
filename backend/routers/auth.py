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
                "auto_rank_purchased": False,
                "auto_rank_enabled": False,
                "mission_completions": [],
                "unlocked_maps_up_to": "Chicago",
            }

            await db.users.insert_one(user_doc.copy())

            if not require_verification:
                token = create_access_token({"sub": user_id, "v": user_doc.get("token_version", 0), "email": user_doc.get("email") or ""})
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
            # Send verification email in background so registration responds immediately (avoids timeout when SMTP is slow/blocked)
            import threading
            from email_sender import send_verification_email

            def _send_in_background():
                try:
                    send_verification_email(user_doc["email"], user_doc["username"], verification_token)
                except Exception as e:
                    logging.warning("Background verification email failed: %s", e)

            threading.Thread(target=_send_in_background, daemon=True).start()
            # Log them in so they can browse; features are gated until verified
            token = create_access_token({"sub": user_id, "v": user_doc.get("token_version", 0), "email": user_doc.get("email") or ""})
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
        login_input = (user_data.email or "").strip()
        now = datetime.now(timezone.utc)
        try:
            return await _do_login(user_data, request, login_input, now)
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

    async def _do_login(user_data: UserLogin, request: Request, login_input: str, now: datetime):
        # Require non-empty email/username and password
        if not login_input:
            raise HTTPException(status_code=422, detail="Email or username is required.")
        if not (user_data.password or "").strip():
            raise HTTPException(status_code=422, detail="Password is required.")

        # Find user by email or username (case-insensitive)
        pattern = re.compile("^" + re.escape(login_input) + "$", re.IGNORECASE)
        user = await db.users.find_one({"$or": [{"email": pattern}, {"username": pattern}]}, {"_id": 0})
        if not user:
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
            raise HTTPException(
                status_code=401,
                detail="Wrong password. Use Forgot password to reset it. After 3 failed attempts this account is locked for 5 minutes.",
            )
        await db.login_lockouts.delete_one({"email": email_clean})
        # Allow login when unverified so user can browse; features are gated by require_email_verified
        if user.get("is_dead"):
            raise HTTPException(
                status_code=403,
                detail="This account is dead and cannot log in. Create a new account and use Dead > Alive to receive 95% (5% tax) of this account’s money and points.",
            )
        ip = _client_ip(request)
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
        token = create_access_token({"sub": user["id"], "v": user.get("token_version", 0), "email": user.get("email") or ""})
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

        import threading
        from email_sender import send_password_reset_email
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
        await db.users.update_one(
            {"id": record["user_id"]},
            {"$set": {"email_verified": True}, "$inc": {"bullets": 2000, "respect_points": 500}},
        )
        await db.email_verifications.delete_one({"token": body.token})
        user = await db.users.find_one({"id": record["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=400, detail="User not found.")
        token = create_access_token({"sub": user["id"], "v": user.get("token_version", 0), "email": user.get("email") or ""})
        user_response = {k: v for k, v in user.items() if k not in ("password_hash", "is_dead", "dead_at", "points_at_death", "retrieval_used")}
        return {
            "token": token,
            "user": user_response,
            "reward_bullets": 2000,
            "reward_respect_points": 500,
        }

    @router.post("/auth/resend-verification")
    async def resend_verification(body: ResendVerificationBody):
        """Send a new verification email if the account exists and is not verified. Accepts email or username. 2min cooldown."""
        raw = (body.email or "").strip()
        if not raw:
            return {"message": "If an account exists with that email, a new verification link has been sent."}
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
            if last_sent and (now_utc - last_sent) < timedelta(minutes=2):
                raise HTTPException(
                    status_code=429,
                    detail="Please wait 2 minutes before requesting another verification email.",
                )
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
        import threading
        from email_sender import send_verification_email
        def _resend_in_background():
            try:
                send_verification_email(user["email"], user["username"], verification_token)
            except Exception as e:
                logging.warning("Background resend verification email failed: %s", e)
        threading.Thread(target=_resend_in_background, daemon=True).start()
        await db.users.update_one({"id": user["id"]}, {"$set": {"last_verification_email_sent_at": now_utc}})
        return {
            "message": "If an account exists with that email, a new verification link has been sent.",
        }

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
            elif _is_moderator(current_user):
                rank_name = "Moderator"
            money_val = _safe_float(current_user.get("money"), 0.0)
            wealth_id, wealth_name = get_wealth_rank(money_val)
            wealth_range = get_wealth_rank_range(money_val)
            # Casino/property loaded separately via GET /user/casino-property to keep auth/me fast
            u = current_user
            admin_color_doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
            admin_online_color = (admin_color_doc.get("value") or "#a78bfa") if admin_color_doc else "#a78bfa"
            if not isinstance(admin_online_color, str) or not admin_online_color.strip():
                admin_online_color = "#a78bfa"
            admin_online_color = admin_online_color.strip()
            mod_online_color = None
            if _is_moderator(current_user):
                raw = (current_user.get("mod_online_color") or "").strip() or "#1e3a5f"
                mod_online_color = raw if raw.startswith("#") and len(raw) <= 9 else "#1e3a5f"
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
                theme_preferences=u.get("theme_preferences"),
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

    @router.get("/auth/ip-info")
    async def get_ip_info(request: Request, current_user: dict = Depends(get_current_user)):
        """Return current IP, accounts that have signed in from this IP, and IPs this user has signed in from (for IP rules page)."""
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
        return {
            "current_ip": current_ip,
            "accounts_from_current_ip": accounts_from_current_ip,
            "your_signin_ips": your_ips,
        }
