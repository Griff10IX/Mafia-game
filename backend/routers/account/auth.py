# Auth: register, login, password reset, /auth/me
import asyncio
import logging
import random
import re
import traceback
import uuid

logger = logging.getLogger(__name__)
from datetime import datetime, timezone, timedelta

from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from utils.ban_user_wipe import user_has_active_account_ban
from utils.disposable_email import is_disposable_email, is_registration_player_email_blocked
from utils.point_provenance import log_points_event
from utils.login_user_agent import auth_client_headers_blocked
from utils.staff_bot_client_alert import maybe_notify_staff_bot_client_blocked
from utils.referral_ids import normalize_referred_by_ids, user_has_referrers
from utils.login_turnstile_gate import login_turnstile_effective_config, require_turnstile_for_login
from middleware.security import is_proxy_or_vpn, get_ip_info as lookup_ip_info, flag_user_suspicious
from utils.proxy_detection import assess_ip_for_auth
from utils.geo_country import country_code_from_request_headers
from utils.game_pass_season import get_game_pass_season_public
from utils.redeem_code_lifecycle import reconcile_stale_dead_redeemers_on_code
from utils.username_rules import validate_username


class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str
    referral_code: Optional[str] = None

    @field_validator("username", mode="before")
    @classmethod
    def strip_username(cls, v):
        if v is None:
            return ""
        return str(v).strip()

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

    @model_validator(mode="after")
    def username_not_an_email(self):
        """Avoid logins / UI treating display name as email; blocks pasted addresses as username."""
        u = self.username or ""
        e = str(self.email).strip().lower()
        if not u:
            raise ValueError("Username is required")
        if "@" in u:
            raise ValueError(
                "Usernames cannot contain '@'. Use a character name — not your email address."
            )
        if u.lower() == e:
            raise ValueError("Username must be different from your email address.")
        _, err = validate_username(u, email=e)
        if err:
            raise ValueError(err)
        return self


class UserLogin(BaseModel):
    email: str  # email or username (login with either)
    password: str
    captcha_token: Optional[str] = None  # Cloudflare Turnstile when login_turnstile_enabled


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


class StaffPortalUnlockBody(BaseModel):
    password: str = ""
    client_device_id: Optional[str] = Field(
        default=None,
        max_length=80,
        description="Per-browser opaque id; embedded in portal JWT so the token only works on this client.",
    )


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
    referral_code: Optional[str] = None  # optional ?ref= referrer username; stored for full signup if client omits it later


# Pre-registration rewards (applied on first login after launch)
PREREGISTER_REWARDS = {
    "bonus_respect_points": 1000,
    "bonus_cash": 50000,
    "badge": "Founding Member",
    "auto_rank_trial_hours": 24,
    "founding_random_tokens": 5,
    # Shown on pre-register page; mirrors server founding_member_income_mult (1.15)
    "founding_passive_bonus_pct": 15,
    "founding_passive_blurb": (
        "Permanent +15% on crime payouts (cash, rank points & respect), GTA car sale value & rare-car luck, "
        "OC heist payouts, hitlist NPC rewards, property income, family racket collects, and mission rewards — "
        "while this character has the Founding Member badge. Also in Store → Upgrades for 5,000 pts (account-only; lost on death)."
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


def _referral_referee_topup_increment(referee: dict) -> Tuple[Dict[str, int], Dict[str, int]]:
    """Top-up referee to match normal referred signup: each token type + referral_tokens record, + respect if no prior referral grant recorded.
    Returns ($inc dict for user fields, full referral_tokens dict for $set)."""
    rt = referee.get("referral_tokens")
    rt = dict(rt) if isinstance(rt, dict) else {}
    inc: Dict[str, int] = {}
    new_rt: Dict[str, int] = {}
    for f in REFERRED_USER_TOKEN_COUNT_FIELDS:
        need = REFERRED_USER_TOKENS_PER_TYPE
        got = int(rt[f]) if f in rt and rt[f] is not None else 0
        if got < need:
            inc[f] = inc.get(f, 0) + (need - got)
        new_rt[f] = max(got, need)
    had_any_referral_grant = any(int(rt.get(x, 0) or 0) > 0 for x in REFERRED_USER_TOKEN_COUNT_FIELDS)
    if not had_any_referral_grant:
        inc["respect_points"] = inc.get("respect_points", 0) + REFERRED_USER_RESPECT
    return inc, new_rt


async def try_heal_referral_from_prereg(db, user: dict, *, dry_run: bool = False) -> Optional[Dict[str, Any]]:
    """If user has no referred_by but preregistrations has referral_code for this email, set referred_by and
    the same signup perks as a normal referred registration. Returns a detail dict on success/would-heal, else None."""
    user_id = str(user.get("id") or "").strip()
    if not user_id or user.get("is_dead"):
        return None
    if user_has_referrers(user.get("referred_by")):
        return None
    email_clean = (user.get("email") or "").strip().lower()
    if not email_clean:
        return None
    prereg = await db.preregistrations.find_one({"email": email_clean})
    if not prereg:
        return None
    referral_code = (prereg.get("referral_code") or "").strip()
    if not referral_code:
        return None
    referrer = await db.users.find_one(
        {
            "username": {"$regex": "^" + re.escape(referral_code) + "$", "$options": "i"},
            "is_dead": {"$ne": True},
        },
        {"_id": 0, "id": 1, "username": 1, "email": 1},
    )
    if not referrer:
        return None
    new_username_lower = (user.get("username") or "").strip().lower()
    ref_username_lower = (referrer.get("username") or "").strip().lower()
    ref_email_lower = (referrer.get("email") or "").strip().lower()
    if ref_username_lower == new_username_lower or ref_email_lower == email_clean:
        return None

    now_iso = datetime.now(timezone.utc).isoformat()

    filt = {
        "id": user_id,
        "$or": [
            {"referred_by": {"$exists": False}},
            {"referred_by": None},
            {"referred_by": ""},
            {"referred_by": []},
        ],
    }
    detail = {
        "referee_id": user_id,
        "referee_username": user.get("username"),
        "referee_email": email_clean,
        "referrer_id": referrer["id"],
        "referrer_username": referrer.get("username"),
        "dry_run": dry_run,
    }
    if dry_run:
        doc = await db.users.find_one(filt, {"_id": 0, "id": 1})
        if not doc:
            return None
        return detail

    u_rt = await db.users.find_one({"id": user_id}, {"_id": 0, "referral_tokens": 1})
    merge_user = {**user, **(u_rt or {})}
    inc_bonus, new_rt = _referral_referee_topup_increment(merge_user)
    set_bonus = {
        "premium_rank_bar": True,
        "referral_tokens": new_rt,
        "referral_prereg_heal_at": now_iso,
    }
    set_fields = {"referred_by": [referrer["id"]], **set_bonus}
    update_op: Dict[str, Any] = {"$set": set_fields}
    if inc_bonus:
        update_op["$inc"] = inc_bonus
    res = await db.users.update_one(filt, update_op)
    if res.modified_count:
        logger.info(
            "referral prereg heal: user_id=%s referrer_id=%s email=%s",
            user_id,
            referrer["id"],
            email_clean,
        )
        return {**detail, "dry_run": False}
    return None


async def apply_manual_referral_link(
    db,
    *,
    referee_username: str,
    referrer_username: str,
    force: bool = False,
    grant_referee_signup_bonuses: bool = True,
    grant_referrer_welcome_respect: int = REFERRED_USER_RESPECT,
) -> Dict[str, Any]:
    """Admin: append referrer to referee's referred_by list, or replace the whole list if force=true.
    Welcome respect applies when this referrer was not already linked."""
    ref_u = (referee_username or "").strip()
    rer_u = (referrer_username or "").strip()
    if not ref_u or not rer_u:
        raise ValueError("referee_username and referrer_username are required")
    referee = await db.users.find_one(
        {"username": {"$regex": "^" + re.escape(ref_u) + "$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "referred_by": 1, "referral_tokens": 1},
    )
    referrer = await db.users.find_one(
        {"username": {"$regex": "^" + re.escape(rer_u) + "$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1},
    )
    if not referee:
        raise ValueError("Referee (new player) not found")
    if not referrer:
        raise ValueError("Referrer not found")
    if referee.get("is_dead") or referrer.get("is_dead"):
        raise ValueError("Cannot link dead accounts")
    rid = str(referee.get("id") or "").strip()
    zid = str(referrer.get("id") or "").strip()
    if not rid or not zid or rid == zid:
        raise ValueError("Invalid users or cannot refer yourself")
    em_r = (referee.get("email") or "").strip().lower()
    em_z = (referrer.get("email") or "").strip().lower()
    if em_r and em_z and em_r == em_z:
        raise ValueError("Referee and referrer cannot share the same email")
    un_r = (referee.get("username") or "").strip().lower()
    un_z = (referrer.get("username") or "").strip().lower()
    if un_r == un_z:
        raise ValueError("Cannot refer yourself")

    existing_ids = normalize_referred_by_ids(referee.get("referred_by"))
    if force:
        new_referred_by = [zid]
    else:
        if zid in existing_ids:
            raise ValueError("This referrer is already linked to this referee.")
        new_referred_by = existing_ids + [zid]
    was_new_link_for_this_referrer = zid not in existing_ids

    now_iso = datetime.now(timezone.utc).isoformat()

    set_doc: Dict[str, Any] = {
        "referred_by": new_referred_by,
        "referral_manual_assign_at": now_iso,
    }
    inc_doc: Dict[str, Any] = {}
    referee_bonuses_applied = False

    if grant_referee_signup_bonuses:
        inc_top, new_rt = _referral_referee_topup_increment(referee)
        set_doc["premium_rank_bar"] = True
        set_doc["referral_tokens"] = new_rt
        set_doc["referral_manual_bonus_at"] = now_iso
        inc_doc.update(inc_top)
        referee_bonuses_applied = grant_referee_signup_bonuses

    update_referee: Dict[str, Any] = {"$set": set_doc}
    if inc_doc:
        update_referee["$inc"] = inc_doc
    await db.users.update_one({"id": rid}, update_referee)

    referrer_bonus_applied = False
    if grant_referrer_welcome_respect > 0 and was_new_link_for_this_referrer:
        r2 = await db.users.update_one(
            {"id": zid},
            {"$inc": {"respect_points": int(grant_referrer_welcome_respect)}},
        )
        referrer_bonus_applied = r2.modified_count > 0

    return {
        "referee_id": rid,
        "referee_username": referee.get("username"),
        "referrer_id": zid,
        "referrer_username": referrer.get("username"),
        "replaced_existing_referrer": force and bool(existing_ids),
        "referee_signup_bonuses_applied": referee_bonuses_applied,
        "referrer_welcome_respect_applied": referrer_bonus_applied,
        "referrer_welcome_respect_amount": grant_referrer_welcome_respect if referrer_bonus_applied else 0,
    }


async def apply_manual_referral_remove(
    db,
    *,
    referee_username: str,
    referrer_username: Optional[str] = None,
) -> Dict[str, Any]:
    """Admin: remove referrer(s) from a referee's referred_by list.
    If referrer_username is omitted or blank, clear the entire list.
    Does not remove tokens, respect, or lifetime referral_earnings on the referrer."""
    ref_u = (referee_username or "").strip()
    if not ref_u:
        raise ValueError("referee_username is required")
    referee = await db.users.find_one(
        {"username": {"$regex": "^" + re.escape(ref_u) + "$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "referred_by": 1},
    )
    if not referee:
        raise ValueError("Referee not found")
    if referee.get("is_dead"):
        raise ValueError("Cannot modify referral link on a dead account")
    rid = str(referee.get("id") or "").strip()
    if not rid:
        raise ValueError("Invalid referee record")

    existing_ids = normalize_referred_by_ids(referee.get("referred_by"))
    if not existing_ids:
        raise ValueError("This referee has no referral links to remove")

    rer_u = (referrer_username or "").strip()
    if not rer_u:
        new_list: List[str] = []
        removed_ids = list(existing_ids)
    else:
        referrer = await db.users.find_one(
            {"username": {"$regex": "^" + re.escape(rer_u) + "$", "$options": "i"}},
            {"_id": 0, "id": 1, "username": 1, "is_dead": 1},
        )
        if not referrer:
            raise ValueError("Referrer username not found")
        if referrer.get("is_dead"):
            raise ValueError("Cannot reference a dead account as referrer")
        zid = str(referrer.get("id") or "").strip()
        if not zid:
            raise ValueError("Invalid referrer record")
        if zid not in existing_ids:
            raise ValueError("That referrer is not on this referee's list")
        new_list = [x for x in existing_ids if x != zid]
        removed_ids = [zid]

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": rid},
        {"$set": {"referred_by": new_list, "referral_manual_remove_at": now_iso}},
    )

    return {
        "referee_id": rid,
        "referee_username": referee.get("username"),
        "cleared_all": not rer_u,
        "removed_referrer_ids": removed_ids,
        "referred_by_remaining": new_list,
    }


def register(router):
    """Register auth routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_password_hash = srv.get_password_hash
    verify_password = srv.verify_password
    create_access_token = srv.create_access_token
    get_current_user = srv.get_current_user
    get_rank_info = srv.get_rank_info
    _is_admin = srv._is_admin
    _is_moderator = srv._is_moderator
    _is_entertainer = srv._is_entertainer
    _is_hdo = srv._is_hdo
    from utils.staff_mod_protection import admin_mod_preview_active, admin_mod_preview_seconds_remaining
    get_wealth_rank = srv.get_wealth_rank
    get_wealth_rank_range = srv.get_wealth_rank_range
    _get_casino_property_profit = srv._get_casino_property_profit
    UserResponse = srv.UserResponse
    ARMOUR_SETS = getattr(srv, "ARMOUR_SETS", [])
    DEFAULT_HEALTH = srv.DEFAULT_HEALTH
    DEFAULT_GARAGE_BATCH_LIMIT = srv.DEFAULT_GARAGE_BATCH_LIMIT
    SWISS_BANK_LIMIT_START = srv.SWISS_BANK_LIMIT_START
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    user_has_admin_list_email = srv.user_has_admin_list_email
    require_staff_issued_if_staff_capable = srv.require_staff_issued_if_staff_capable
    DUPE_DETECTION_EXEMPT_EMAILS = getattr(srv, "DUPE_DETECTION_EXEMPT_EMAILS", []) or []
    send_notification = srv.send_notification
    _get_staff_user_ids = srv._get_staff_user_ids
    effective_player_kill_count = srv.effective_player_kill_count
    RANKS = getattr(srv, "RANKS", [])
    PRESTIGE_CONFIGS = getattr(srv, "PRESTIGE_CONFIGS", {})
    CARS = getattr(srv, "CARS", [])

    from utils.staff_flags_payload import build_staff_flags_payload
    from utils.ip_normalize import normalize_ip_string as _normalize_ip

    def _client_ip(request: Request):
        # Cloudflare provides real IP in CF-Connecting-IP
        cf_ip = request.headers.get("cf-connecting-ip")
        if cf_ip:
            ip = _normalize_ip(cf_ip)
            if ip:
                return ip
        # Fallback to X-Forwarded-For (nginx or other proxies)
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = _normalize_ip(forwarded)
            if ip:
                return ip
        if request.client:
            return _normalize_ip(request.client.host or "")
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
        """Send inbox notification to all admins when VPN/proxy block occurs, with provider info."""
        admin_emails = list(ADMIN_EMAILS or [])
        if not admin_emails:
            return
        try:
            ip_info = await lookup_ip_info(ip)
            provider_parts = []
            if ip_info.get("isp"):
                provider_parts.append(f"ISP: {ip_info['isp']}")
            if ip_info.get("org") and ip_info.get("org") != ip_info.get("isp"):
                provider_parts.append(f"Org: {ip_info['org']}")
            if ip_info.get("as"):
                provider_parts.append(f"AS: {ip_info['as']}")
            location_parts = [p for p in [ip_info.get("city"), ip_info.get("country")] if p]
            if location_parts:
                provider_parts.append(f"Location: {', '.join(location_parts)}")
            if ip_info.get("hosting"):
                provider_parts.append("Type: Hosting/Datacenter")
            elif ip_info.get("proxy"):
                provider_parts.append("Type: Proxy")

            admins = await db.users.find({"email": {"$in": admin_emails}}, {"_id": 0, "id": 1}).to_list(100)
            title = "VPN/Proxy Blocked"
            msg = f"{context}: IP {ip}. {details}"
            if provider_parts:
                msg += "\n" + " | ".join(provider_parts)
            for a in admins:
                if a.get("id"):
                    await send_notification(a["id"], title, msg, "system", category="admin")
        except Exception:
            logger.exception("Failed to notify admins of VPN block")

    @router.get("/auth/staff-flags")
    async def get_staff_flags(current_user: dict = Depends(get_current_user)):
        """Staff/mod/HDO/entertainer flags for signed-in users; not under /admin (general UI). Admin Tools use GET /admin/check."""
        return await build_staff_flags_payload(db, current_user)

    @router.get("/auth/launch-status")
    async def get_launch_status():
        """Post-launch stub (no DB). Clients use /payments/pending-points for store credit flags."""
        return {
            "login_locked": False,
            "lock_from": None,
            "lock_until": None,
            "lock_message": None,
            "preregister_landing_banner_enabled": False,
            "preregister_landing_banner_preview_open": False,
            "show_preregister_banner": False,
            "preorder_active": False,
            "preorder_release_date": None,
            "store_points_auto_credit": True,
            "manual_credit_eta": None,
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
        if "@" in raw:
            raise HTTPException(
                status_code=400,
                detail="Usernames cannot contain '@'. Choose a display name, not an email address.",
            )
        _, err = validate_username(raw)
        if err:
            raise HTTPException(status_code=400, detail=err)
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
            if is_registration_player_email_blocked(email_clean):
                raise HTTPException(
                    status_code=400,
                    detail="Use a personal email (Gmail, Outlook, etc.). You cannot register using this site's email domain.",
                )
            client_ip = _client_ip(request)
            main_settings = await db.game_settings.find_one({"_id": "main"}, {"_id": 0})
            block_proxy_vpn_login = bool(main_settings.get("block_proxy_vpn_login", True)) if main_settings else True
            blocked_cli, cli_reason = auth_client_headers_blocked(request.headers, main_settings)
            if blocked_cli:
                logging.warning(
                    "Registration blocked: client probe reason=%s ip=%s email=%s",
                    cli_reason,
                    client_ip,
                    (email_clean or "")[:48],
                )
                await maybe_notify_staff_bot_client_blocked(
                    db=db,
                    request=request,
                    internal_reason=cli_reason,
                    source="auth_register",
                    context_note=(
                        f"Registration attempt — email: {(email_clean or '')[:96]}\n"
                        f"Username: {(user_data.username or '').strip()[:40]}"
                    ),
                )
                raise HTTPException(
                    status_code=403,
                    detail="Registration must use the official game app or a normal web browser.",
                )
            reg_ip_rep: Dict[str, Any] = {}
            if block_proxy_vpn_login and client_ip:
                reg_ip_rep = await assess_ip_for_auth(db, client_ip, purpose="signup", check_getipintel=True)
                if reg_ip_rep.get("block_auth"):
                    kw = ", ".join(reg_ip_rep.get("provider_keywords") or []) or "—"
                    await _notify_admins_vpn_blocked(
                        client_ip,
                        "Registration blocked (proxy/VPN)",
                        (
                            f"Attempted email: {email_clean}, username: {user_data.username.strip()}\n"
                            f"Verdict: {reg_ip_rep.get('verdict')} · risk: {reg_ip_rep.get('risk_score')} · "
                            f"subnet accounts: {reg_ip_rep.get('subnet_alive_accounts', 0)}\n"
                            f"Keywords: {kw} · reasons: {', '.join(reg_ip_rep.get('reasons') or [])}"
                        ),
                    )
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Registration from a proxy, VPN, or paid proxy service (including services like ProxyRoyal) "
                            "is not allowed. Use your normal home or mobile connection."
                        ),
                    )
            # Allow up to 2 accounts per device/network (e.g. family); block only if 2 already exist (admins + dupe-exempt exempt)
            if client_ip:
                admin_emails_list = list(ADMIN_EMAILS) if ADMIN_EMAILS else []
                skip_ip_cap_emails = list(admin_emails_list)
                for _e in DUPE_DETECTION_EXEMPT_EMAILS or []:
                    _el = (_e or "").strip().lower()
                    if _el and _el not in skip_ip_cap_emails:
                        skip_ip_cap_emails.append(_el)
                alive_same_ip_count = await db.users.count_documents(
                    {
                        "is_dead": {"$ne": True},
                        "email": {"$nin": skip_ip_cap_emails},
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
            freed_email_from_dead_user_id = None
            existing_email = await db.users.find_one({"email": email_pattern}, {"_id": 0, "id": 1, "is_dead": 1, "email": 1})
            if existing_email:
                if not existing_email.get("is_dead"):
                    raise HTTPException(status_code=400, detail="Email already registered.")
                from utils.staff_email_history import record_email_freed_from_dead_account

                freed_email_from_dead_user_id = existing_email["id"]
                await record_email_freed_from_dead_account(
                    db,
                    freed_email_from_dead_user_id,
                    user_data.email.strip(),
                )

            user_id = str(uuid.uuid4())
            _default_theme_prefs = {
                "colourId": "sky",
                "textureId": "modern-soft",
                "themeVariant": "modern",
                "sidebarLayout": "categorized_classic",
                "mobileNavStyle": "bottom",
                "mobileStatsDisplay": "right_sidebar",
                "fontId": "clean",
            }
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
                "property_portfolio_kill_income_boost_percent": 0,
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
                "total_kills_excludes_npc_v1": True,
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
                "registration_ip": client_ip,
                "registration_ip_reputation": reg_ip_rep if reg_ip_rep else None,
                "login_ips": [client_ip] if client_ip else [],
                "login_history": (
                    [
                        {
                            "at": datetime.now(timezone.utc).isoformat(),
                            "ip": client_ip or "",
                            "device_type": _device_type_from_user_agent(request.headers.get("User-Agent") or "") or "",
                            "ua_short": (request.headers.get("User-Agent") or "").strip()[:120],
                            "source": "register",
                        }
                    ]
                    if client_ip
                    else []
                ),
                "email_verified": not require_verification,
                "rules_accepted": False,
                "rules_accepted_at": None,
                "tutorial_status": "pending",
                "tutorial_step": None,
                "tutorial_crime_done": False,
                "tutorial_gta_done": False,
                "tutorial_theme_done": False,
                "tutorial_rewards_granted": False,
                "tutorial_ineligible_reason": None,
                "loot_box_free_rare_opens": 0,
                # Rank-XP pass (£9.99): entitlement is unactivated until used in Armoury.
                "rank_xp_pass_tokens": 0,
                "rank_xp_pass_bonus_until": None,
                "rank_xp_pass_token_expires_at": None,
                "rank_xp_pass_tier_snapshot": None,
                "rank_xp_pass_pending_tier_snapshot": None,
                "rank_xp_pass_last_granted_micro_tier": 0,
                "game_pass_season_id": None,
                "rank_xp_pass_season_rp": 0,
                "rank_xp_pass_rewards_granted": False,
                "auto_rank_purchased": False,
                "auto_rank_enabled": False,
                "mission_completions": [],
                "unlocked_maps_up_to": "Chicago",
                "theme_preferences": _default_theme_prefs,
                "theme_preferences_pc": dict(_default_theme_prefs),
                "theme_preferences_mobile": dict(_default_theme_prefs),
                "founding_member": False,
                "founding_rewards_claimed": False,
                "badges": [],
            }

            # Check if registering during pre-launch (founding member)
            settings = main_settings
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

            # Tutorial rewards are once per email + IP — alts auto-skip (no coach / no rewards).
            # Global flag defaults OFF until Admin enables it for all new players.
            try:
                from utils.tutorial import (
                    email_or_ip_already_claimed,
                    is_tutorial_globally_enabled,
                    TUTORIAL_STATUS_PENDING,
                    TUTORIAL_STATUS_SKIPPED,
                )

                tutorial_on = await is_tutorial_globally_enabled(db)
                claimed, reason = await email_or_ip_already_claimed(
                    db,
                    email=user_doc.get("email"),
                    ip=user_doc.get("registration_ip"),
                )
                if not tutorial_on:
                    user_doc["tutorial_status"] = TUTORIAL_STATUS_SKIPPED
                    user_doc["tutorial_ineligible_reason"] = "disabled"
                elif claimed:
                    user_doc["tutorial_status"] = TUTORIAL_STATUS_SKIPPED
                    user_doc["tutorial_ineligible_reason"] = reason
                else:
                    user_doc["tutorial_status"] = TUTORIAL_STATUS_PENDING
            except Exception:
                logging.exception("tutorial eligibility at register failed")
                user_doc["tutorial_status"] = "skipped"
                user_doc["tutorial_ineligible_reason"] = "disabled"

            # Check if beta signup mode is enabled - give bonus resources, Godfather rank, prestige 1, exclusive car, loot exclusive car & weapon
            game_config = await db.game_config.find_one({"id": "main"}, {"_id": 0, "beta_signup_enabled": 1})
            beta_signup_gifts = bool(game_config and game_config.get("beta_signup_enabled"))
            if beta_signup_gifts:
                user_doc["points"] = 15000
                user_doc["money"] = 1000000000  # $1 billion
                # Godfather rank and prestige 1 for beta signups
                base_gf = 0
                if RANKS:
                    gf = RANKS[-1]
                    user_doc["rank"] = gf["id"]
                    base_gf = int(gf.get("required_points") or 0)
                    user_doc["rank_points"] = base_gf
                if 1 in PRESTIGE_CONFIGS:
                    user_doc["prestige_level"] = 1
                    m = float(srv.get_rank_threshold_mult(1))
                    user_doc["prestige_rank_multiplier"] = m
                    if base_gf:
                        user_doc["rank_points"] = int(base_gf * m)
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
            if not referral_code and email_prereg:
                referral_code = (email_prereg.get("referral_code") or "").strip()
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
                        user_doc["referred_by"] = [referrer["id"]]
                        # Referred-user benefits: premium rank bar, respect, tokens (non-sellable on Quick Trade)
                        user_doc["premium_rank_bar"] = True
                        user_doc["respect_points"] = int(user_doc.get("respect_points") or 0) + REFERRED_USER_RESPECT
                        referral_tokens = {}
                        for count_field in REFERRED_USER_TOKEN_COUNT_FIELDS:
                            n = REFERRED_USER_TOKENS_PER_TYPE
                            user_doc[count_field] = int(user_doc.get(count_field) or 0) + n
                            referral_tokens[count_field] = n
                        user_doc["referral_tokens"] = referral_tokens

            from utils.bank_economy_settings import get_bank_economy_config

            _bank_cfg = await get_bank_economy_config(
                db,
                swiss_fallback=int(SWISS_BANK_LIMIT_START),
                interest_max_fallback=50_000_000,
                interest_options_fallback=list(getattr(srv, "BANK_INTEREST_OPTIONS", []) or []),
            )
            user_doc["swiss_limit"] = int(_bank_cfg["swiss_limit_start"])

            if freed_email_from_dead_user_id:
                user_doc["registration_freed_email_from_user_id"] = freed_email_from_dead_user_id

            await db.users.insert_one(user_doc.copy())
            try:
                if user_doc.get("email_verified"):
                    from utils.auto_rank_email_entitlement import sync_auto_rank_email_entitlement_to_user

                    await sync_auto_rank_email_entitlement_to_user(db, user_id, user_doc.get("email"))
            except Exception:
                pass
            if reg_ip_rep and reg_ip_rep.get("verdict") in ("suspicious", "likely_proxy_service"):
                try:
                    await flag_user_suspicious(
                        db,
                        user_id,
                        user_data.username.strip(),
                        "proxy_residential_suspected",
                        f"Registration IP {client_ip}: {reg_ip_rep.get('verdict')}",
                        {"ip_reputation": reg_ip_rep},
                    )
                except Exception:
                    pass

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
                await srv.log_activity(user_id, user_doc["username"], "account_register", {"ip": _client_ip(request) or ""})
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
                    "session_id": session_id,
                    "username": user_doc.get("username") or "",
                    "staff_issued": False,
                })
                user_response = {
                    "id": user_doc["id"],
                    "username": user_doc["username"],
                    "rank": user_doc["rank"],
                    "money": user_doc["money"],
                    "points": user_doc["points"],
                    "bodyguard_slots": user_doc["bodyguard_slots"],
                    "current_state": user_doc["current_state"],
                    "total_kills": effective_player_kill_count(user_doc),
                    "total_deaths": user_doc["total_deaths"],
                    "created_at": user_doc["created_at"],
                    "rules_accepted": bool(user_doc.get("rules_accepted", False)),
                }
                await srv.log_activity(user_id, user_doc["username"], "account_register", {"ip": ip})
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
                "session_id": session_id,
                "username": user_doc.get("username") or "",
                "staff_issued": False,
            })
            user_response = {
                "id": user_doc["id"],
                "username": user_doc["username"],
                "rank": user_doc["rank"],
                "money": user_doc["money"],
                "points": user_doc["points"],
                "bodyguard_slots": user_doc["bodyguard_slots"],
                "current_state": user_doc["current_state"],
                "total_kills": effective_player_kill_count(user_doc),
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
            "email",
            "theme_preferences",
            "theme_preferences_pc",
            "theme_preferences_mobile",
            "dashboard_preferences",
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
    async def accept_rules(request: Request, current_user: dict = Depends(get_current_user)):
        """One-time rules acceptance gate for gameplay access."""
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"rules_accepted": True, "rules_accepted_at": now_iso}},
        )
        tutorial_payload = {
            "tutorial_status": current_user.get("tutorial_status"),
            "tutorial_step": current_user.get("tutorial_step"),
            "eligible": False,
        }
        try:
            from utils.tutorial import resolve_tutorial_eligibility

            def _client_ip_local() -> str:
                try:
                    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
                    if forwarded:
                        return forwarded
                    if request.client and request.client.host:
                        return str(request.client.host)
                except Exception:
                    pass
                return ""

            fresh = await db.users.find_one({"id": current_user["id"]}, {"_id": 0}) or {
                **current_user,
                "rules_accepted": True,
            }
            info = await resolve_tutorial_eligibility(db, fresh, request_ip=_client_ip_local())
            tutorial_payload = {
                "tutorial_status": info.get("tutorial_status"),
                "tutorial_step": info.get("tutorial_step"),
                "eligible": bool(info.get("eligible")),
                "tutorial_ineligible_reason": info.get("tutorial_ineligible_reason"),
            }
        except Exception:
            logging.exception("tutorial eligibility on accept-rules failed")
        return {
            "ok": True,
            "rules_accepted": True,
            "rules_accepted_at": now_iso,
            **tutorial_payload,
        }

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

    @router.get("/auth/login-turnstile-config")
    async def login_turnstile_config():
        """Public: whether login requires Turnstile and the site key (if fully configured)."""
        main = await db.game_settings.find_one(
            {"_id": "main"},
            {"_id": 0, "login_turnstile_enabled": 1, "minigame_turnstile_site_key": 1},
        )
        enabled, site_key = login_turnstile_effective_config(main)
        return {"enabled": enabled, "site_key": site_key if enabled else None}

    @router.post("/auth/login")
    async def login(user_data: UserLogin, request: Request):
        login_input = (user_data.email or "").strip()
        now = datetime.now(timezone.utc)
        try:
            return await _do_login(user_data, request, login_input, now, staff_route=False)
        except HTTPException:
            raise
        except Exception as e:
            err_ref = f"L-{uuid.uuid4().hex[:8]}"
            logging.exception(
                "Login 500 ref=%s login=%s exception=%s: %s",
                err_ref,
                login_input or "(empty)",
                type(e).__name__,
                e,
            )
            raise HTTPException(status_code=500, detail=f"Login failed. Please try again or contact support. Ref: {err_ref}")

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
            err_ref = f"S-{uuid.uuid4().hex[:8]}"
            logging.exception("Login-staff 500 ref=%s login=%s: %s", err_ref, login_input or "(empty)", e)
            raise HTTPException(status_code=500, detail=f"Login failed. Please try again. Ref: {err_ref}")

    @router.post("/auth/staff-portal-unlock")
    async def staff_portal_unlock(body: StaffPortalUnlockBody, request: Request, current_user: dict = Depends(get_current_user)):
        from utils.staff_portal import (
            create_staff_portal_token,
            staff_portal_password_configured,
            staff_portal_password_matches,
            staff_portal_session_minutes,
        )

        if not staff_portal_password_configured():
            raise HTTPException(status_code=400, detail="Staff portal is not enabled on this server.")
        if not (_is_admin(current_user) or _is_moderator(current_user) or user_has_admin_list_email(current_user)):
            raise HTTPException(status_code=403, detail="Staff access required")
        require_staff_issued_if_staff_capable(current_user)
        if not staff_portal_password_matches(body.password or ""):
            try:
                from utils.staff_access_audit import record_staff_auth_gate_event
                await record_staff_auth_gate_event(
                    db,
                    kind="staff_portal_wrong_password",
                    path_label="POST /api/auth/staff-portal-unlock",
                    user_id=str(current_user.get("id") or "").strip() or None,
                    username=str(current_user.get("username") or "").strip() or None,
                    email=str(current_user.get("email") or "").strip() or None,
                    client_ip=_client_ip(request),
                    send_notification=send_notification,
                    get_notify_user_ids=_get_staff_user_ids,
                    detail="Wrong staff portal password entered.",
                    title="Staff portal wrong password",
                )
            except Exception:
                logging.exception("staff_portal_wrong_password audit notify failed")
            raise HTTPException(status_code=403, detail="Invalid staff portal password")
        uid = str(current_user.get("id") or "").strip()
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid session")
        return {
            "staff_portal_token": create_staff_portal_token(uid, body.client_device_id),
            "expires_in_seconds": staff_portal_session_minutes() * 60,
        }

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

        if not staff_route:
            await require_turnstile_for_login(db, request=request, captcha_token=user_data.captcha_token)

        ip = _client_ip(request)
        block_proxy_vpn_login = bool(settings.get("block_proxy_vpn_login", True)) if settings else True

        # Block VPN/proxy / commercial proxy networks on login (staff can bypass)
        login_ip_rep: Dict[str, Any] = {}
        if not staff_route and block_proxy_vpn_login and ip:
            login_ip_rep = await assess_ip_for_auth(db, ip, purpose="login", check_getipintel=True)
            if login_ip_rep.get("block_auth"):
                kw = ", ".join(login_ip_rep.get("provider_keywords") or []) or "—"
                await _notify_admins_vpn_blocked(
                    ip,
                    "Login blocked (proxy/VPN)",
                    (
                        f"Attempted login: {login_input[:30]}\n"
                        f"Verdict: {login_ip_rep.get('verdict')} · risk: {login_ip_rep.get('risk_score')} · "
                        f"subnet accounts: {login_ip_rep.get('subnet_alive_accounts', 0)}\n"
                        f"Keywords: {kw} · reasons: {', '.join(login_ip_rep.get('reasons') or [])}"
                    ),
                )
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Login from a proxy, VPN, or paid proxy service is not allowed. "
                        "Disconnect the proxy/VPN and use your normal connection."
                    ),
                )

        # UA + Sec-Fetch heuristics (staff may use curl; toggle via main.block_script_user_agent_login)
        if not staff_route:
            blocked_cli, cli_reason = auth_client_headers_blocked(request.headers, settings)
            if blocked_cli:
                logging.warning(
                    "Login blocked: client probe reason=%s ip=%s login=%s",
                    cli_reason,
                    ip,
                    (login_input or "")[:40],
                )
                await maybe_notify_staff_bot_client_blocked(
                    db=db,
                    request=request,
                    internal_reason=cli_reason,
                    source="auth_login",
                    context_note=f"Login attempt (identifier): {(login_input or '')[:80]}",
                )
                raise HTTPException(
                    status_code=403,
                    detail="Login must use the official game app or a normal web browser.",
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
        user_id = str(user.get("id") or "").strip()
        if not user_id:
            raise HTTPException(status_code=500, detail="Account data is incomplete. Please contact support.")

        # Check lockout (by account email)
        lockout = await db.login_lockouts.find_one({"email": email_clean}, {"_id": 0, "locked_until": 1, "failed_count": 1})
        if lockout:
            locked_until_raw = lockout.get("locked_until")
            locked_until = None
            if isinstance(locked_until_raw, datetime):
                locked_until = locked_until_raw if locked_until_raw.tzinfo else locked_until_raw.replace(tzinfo=timezone.utc)
            elif isinstance(locked_until_raw, str):
                try:
                    locked_until = datetime.fromisoformat(locked_until_raw.replace("Z", "+00:00"))
                    if locked_until.tzinfo is None:
                        locked_until = locked_until.replace(tzinfo=timezone.utc)
                except Exception:
                    locked_until = None
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
            count = ((doc or {}).get("failed_count") or 0) + 1
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
                                "user_id": user_id,
                                "username": user.get("username"),
                                "email": email_clean,
                                "reason": "wrong_password_same_ip_other_alive",
                                "same_ip_other_alive_count": alive_same_ip_other,
                            }
                        )
                except Exception:
                    logging.exception("Record suspicious login (wrong password) failed")
            if staff_route and (user_has_admin_list_email(user) or _is_moderator(user)):
                try:
                    from utils.staff_access_audit import record_staff_auth_gate_event

                    await record_staff_auth_gate_event(
                        db,
                        kind="staff_login_wrong_password",
                        path_label="POST /api/auth/login-staff",
                        user_id=user_id,
                        username=str(user.get("username") or "") or None,
                        email=email_clean or None,
                        client_ip=ip,
                        send_notification=send_notification,
                        get_notify_user_ids=_get_staff_user_ids,
                        detail="Wrong password on staff login for an admin- or moderator-capable account.",
                    )
                except Exception:
                    logging.exception("record_staff_auth_gate_event staff_login_wrong_password failed")
            raise HTTPException(
                status_code=401,
                detail="Wrong password. Use Forgot password to reset it. After 3 failed attempts this account is locked for 5 minutes.",
            )
        if await user_has_active_account_ban(db, user_id):
            raise HTTPException(status_code=403, detail="This account has been banned from the game.")
        # On normal login, block admin/mod — they must use the secret staff login page
        if not staff_route and (user_has_admin_list_email(user) or _is_moderator(user)):
            try:
                from utils.staff_access_audit import record_staff_auth_gate_event

                await record_staff_auth_gate_event(
                    db,
                    kind="admin_mod_normal_login_url",
                    path_label="POST /api/auth/login",
                    user_id=user_id,
                    username=str(user.get("username") or "") or None,
                    email=email_clean or None,
                    client_ip=ip,
                    send_notification=send_notification,
                    get_notify_user_ids=_get_staff_user_ids,
                    detail="Valid credentials but blocked: admins/mods must use POST /auth/login-staff. User saw a generic wrong-password response.",
                )
            except Exception:
                logging.exception("record_staff_auth_gate_event admin_mod_normal_login_url failed")
            raise HTTPException(
                status_code=401,
                detail="Wrong password. Use Forgot password to reset it. After 3 failed attempts this account is locked for 5 minutes.",
            )
        await db.login_lockouts.delete_one({"email": email_clean})
        # Fresh session: clear stale endpoint RL hard lockout so login is not stuck behind old rate_limit_hard_until
        await db.users.update_one({"id": user_id}, {"$unset": {"rate_limit_hard_until": ""}})
        # One-time backfill: referred_by from preregistrations.referral_code if signup missed ?ref=
        if not staff_route:
            try:
                if await try_heal_referral_from_prereg(db, user):
                    user = await db.users.find_one({"id": user_id}, {"_id": 0})
                    if not user:
                        raise HTTPException(status_code=500, detail="Account data is incomplete after referral heal. Please contact support.")
            except HTTPException:
                raise
            except Exception as e:
                logging.warning("referral prereg heal on login failed: %s", e)
        # Allow login even when dead so the frontend can render the death screen.
        # Gameplay endpoints remain blocked by get_current_user for dead accounts.
        ua = (request.headers.get("User-Agent") or "").strip()[:500]
        device_type = _device_type_from_user_agent(request.headers.get("User-Agent") or "")
        set_fields = {}
        if ip and not isinstance(user.get("login_ips"), list):
            await db.users.update_one({"id": user_id}, {"$set": {"login_ips": []}})
        if not isinstance(user.get("sessions"), list):
            await db.users.update_one({"id": user_id}, {"$set": {"sessions": []}})
        if ip:
            set_fields["last_login_ip"] = ip
        if login_ip_rep:
            set_fields["last_login_ip_reputation"] = login_ip_rep
        if ua:
            set_fields["last_user_agent"] = ua
        if device_type:
            set_fields["last_device_type"] = device_type
        if set_fields:
            update_op = {"$set": set_fields}
            if ip:
                update_op["$addToSet"] = {"login_ips": ip}
            await db.users.update_one({"id": user_id}, update_op)
        if ip:
            doc = await db.users.find_one({"id": user_id}, {"_id": 0, "login_ips": 1})
            ips = doc.get("login_ips") if isinstance((doc or {}).get("login_ips"), list) else []
            if len(ips) > 20:
                await db.users.update_one({"id": user_id}, {"$set": {"login_ips": ips[-20:]}})
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
        try:
            await db.users.update_one(
                {"id": user_id},
                {"$push": {"sessions": {"$each": [session_entry], "$position": 0, "$slice": 10}}},
            )
        except Exception:
            # Legacy/bad data safeguard: if sessions became non-array, reset and retry once.
            await db.users.update_one({"id": user_id}, {"$set": {"sessions": []}})
            await db.users.update_one(
                {"id": user_id},
                {"$push": {"sessions": {"$each": [session_entry], "$position": 0, "$slice": 10}}},
            )
        if ip:
            hist_entry = {
                "at": now_iso,
                "ip": ip,
                "device_type": device_type or "",
                "ua_short": ua[:120] if ua else "",
                "source": "staff_login" if staff_route else "login",
            }
            try:
                await db.users.update_one(
                    {"id": user_id},
                    {"$push": {"login_history": {"$each": [hist_entry], "$position": 0, "$slice": 200}}},
                )
            except Exception:
                logging.exception("login_history push failed user_id=%s", user_id)
        token = create_access_token({
            "sub": user_id,
            "v": int(user.get("token_version") or 0),
            "session_id": session_id,
            "username": str(user.get("username") or ""),
            "staff_issued": bool(staff_route),
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
                        {"user_id": user_id, "payment_status": "preorder_pending"}
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
                    await db.users.update_one({"id": user_id}, reward_update)
                    if respect_bonus > 0:
                        await srv.log_respect_earned(user_id, respect_bonus, "founding_member")
                    founding_rewards_applied = True
                    logging.info("Applied founding member rewards to user %s", user_id)
        except Exception as e:
            logging.warning("Failed to apply founding member rewards: %s", e)
        
        user_safe = _login_response_user(user)
        if founding_rewards_applied:
            user_safe["founding_rewards_just_applied"] = True
            user_safe["founding_rewards"] = PREREGISTER_REWARDS
        await srv.log_activity(user_id, user.get("username", "?"), "account_login", {"ip": _client_ip(request) or ""})
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
        user_response = {k: v for k, v in user.items() if k not in ("password_hash", "email", "is_dead", "dead_at", "points_at_death", "retrieval_used")}

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
            "session_id": session_id,
            "username": user.get("username") or "",
            "staff_issued": False,
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

    from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_PRESENCE, PAGE_KEY_CASINO_PROPERTY

    async def _presence_sustained_rl_user(current_user: dict = Depends(get_current_user)):
        await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_PRESENCE)

    async def _casino_property_sustained_rl_user(current_user: dict = Depends(get_current_user)):
        await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_CASINO_PROPERTY)

    _casino_property_rl_u = [Depends(_casino_property_sustained_rl_user)]

    @router.get(
        "/auth/me",
        response_model=UserResponse,
        response_model_exclude={"email", "theme_preferences", "dashboard_preferences"},
        dependencies=[Depends(_presence_sustained_rl_user)],
    )
    async def get_me(request: Request, current_user: dict = Depends(get_current_user)):
        from utils.profile_cosmetics import profile_cosmetic_active

        user_id = current_user.get("id") or "unknown"
        username = current_user.get("username") or user_id
        try:
            now_dt = datetime.now(timezone.utc)
            now_iso = now_dt.isoformat()
            path = (request.headers.get("x-current-path") or "").strip() or None
            client_ip = _client_ip(request) or None
            stored_path = (current_user.get("last_path") or "").strip() or None
            path_changed = path is not None and path != stored_path
            should_write_presence = path_changed
            if not should_write_presence:
                last_seen_raw = current_user.get("last_seen")
                if last_seen_raw:
                    try:
                        last_dt = datetime.fromisoformat(str(last_seen_raw).replace("Z", "+00:00"))
                        if last_dt.tzinfo is None:
                            last_dt = last_dt.replace(tzinfo=timezone.utc)
                        should_write_presence = (now_dt - last_dt).total_seconds() >= 30
                    except (TypeError, ValueError):
                        should_write_presence = True
                else:
                    should_write_presence = True
            if should_write_presence:
                update = {"last_seen": now_iso}
                if path is not None:
                    update["last_path"] = path[:500]
                if client_ip:
                    update["last_request_ip"] = client_ip
                cc = country_code_from_request_headers(request)
                if cc:
                    update["last_seen_country"] = cc
                await db.users.update_one(
                    {"id": current_user["id"]},
                    {"$set": update}
                )
                try:
                    from utils.referral_weekly_points import (
                        process_referral_weekly_points,
                        record_referral_activity_day,
                    )

                    if await record_referral_activity_day(db, current_user["id"], user=current_user):
                        await process_referral_weekly_points(db, current_user["id"])
                except Exception:
                    pass
            
            # Wake up auto-rank if user was idle (no activity for 3+ hours)
            if current_user.get("auto_rank_idle"):
                from routers.account.auto_rank import wake_auto_rank_if_idle
                await wake_auto_rank_if_idle(db, current_user["id"])

            if float(current_user.get("kill_inflation") or 0) > 0:
                await srv._apply_kill_inflation_decay(current_user["id"])

            if current_user.get("email_verified") and (current_user.get("email") or "").strip():
                try:
                    from utils.auto_rank_email_entitlement import sync_auto_rank_email_entitlement_to_user

                    await sync_auto_rank_email_entitlement_to_user(
                        db,
                        current_user["id"],
                        current_user.get("email"),
                    )
                except Exception:
                    pass

            ar_flags = await db.users.find_one(
                {"id": current_user["id"]},
                {"_id": 0, "auto_rank_email_entitlement": 1, "auto_rank_permanent": 1, "auto_rank_purchased": 1, "auto_rank_trial": 1},
            )
            if ar_flags:
                current_user = {**current_user, **ar_flags}

            _rp = _safe_int(current_user.get("rank_points"), 0)
            _prestige_m = float(current_user.get("prestige_rank_multiplier") or 1.0)
            rank_id, rank_name = get_rank_info(_rp, _prestige_m)
            if user_has_admin_list_email(current_user):
                rank_name = "Admin"
            elif _is_moderator(current_user):
                rank_name = "Moderator"
            elif current_user.get("is_help_desk_operator"):
                rank_name = f"(HDO) {rank_name}"
            elif _is_entertainer(current_user):
                rank_name = f"(Entertainer) {rank_name}"
            money_val = _safe_float(current_user.get("money"), 0.0)
            wealth_id, wealth_name, wealth_color = get_wealth_rank(money_val)
            wealth_range = get_wealth_rank_range(money_val)
            from utils.robot_bg_auto_search import robot_bg_auto_search_active

            def _bodyguard_find_time_active(user_doc: dict) -> bool:
                until_raw = user_doc.get("bodyguard_find_time_until")
                if not until_raw:
                    return False
                try:
                    until_dt = datetime.fromisoformat(str(until_raw).replace("Z", "+00:00"))
                    if until_dt.tzinfo is None:
                        until_dt = until_dt.replace(tzinfo=timezone.utc)
                    return until_dt > datetime.now(timezone.utc)
                except Exception:
                    return False

            def _timed_perk_active(until_raw) -> bool:
                if not until_raw:
                    return False
                try:
                    until_dt = datetime.fromisoformat(str(until_raw).replace("Z", "+00:00"))
                    if until_dt.tzinfo is None:
                        until_dt = until_dt.replace(tzinfo=timezone.utc)
                    return until_dt > datetime.now(timezone.utc)
                except Exception:
                    return False
            # Casino/property loaded separately via GET /user/casino-property to keep auth/me fast
            u = current_user
            equipped_weapon_id = u.get("equipped_weapon_id")
            family_id = u.get("family_id")
            ref_ids = normalize_referred_by_ids(u.get("referred_by"))
            _noop = lambda: asyncio.sleep(0, result=None)

            async def _witness_nav_green_count():
                uid = str(u["id"])
                mq = {"status": "active", "seller_id": {"$ne": uid}}
                cleared = u.get("witness_market_nav_cleared_at")
                if cleared:
                    mq["created_at"] = {"$gt": cleared}
                return await db.witness_statement_listings.count_documents(mq)

            async def _owned_premium_weapon_flags():
                rows = await db.user_weapons.find(
                    {"user_id": u["id"], "weapon_id": {"$in": ["weapon10", "weapon11"]}, "quantity": {"$gte": 1}},
                    {"_id": 0, "weapon_id": 1},
                ).to_list(2)
                ids = {str(r.get("weapon_id") or "") for r in rows}
                return ("weapon10" in ids, "weapon11" in ids)

            async def _vip_pass_car_info():
                from utils.game_pass_vip_car import (
                    count_store_limited_vip_pass_cars,
                    count_user_vip_pass_cars,
                    get_vip_pass_car_purchase_limit,
                )

                count = await count_user_vip_pass_cars(db, u["id"])
                in_game = await count_store_limited_vip_pass_cars(db)
                limit = await get_vip_pass_car_purchase_limit(db)
                return count, in_game, limit

            admin_color_doc, weapon_doc, fam, bodyguard_count, witness_nav_green_n, gp_season_pub, premium_weapon_flags, vip_pass_car_info = await asyncio.gather(
                db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1}),
                db.weapons.find_one({"id": equipped_weapon_id}, {"_id": 0, "name": 1}) if equipped_weapon_id else _noop(),
                db.families.find_one(
                    {"id": family_id, "wiped": {"$ne": True}},
                    {"_id": 0, "name": 1},
                ) if family_id else _noop(),
                db.bodyguards.count_documents({
                    "user_id": u["id"],
                    "$or": [
                        {"bodyguard_user_id": {"$exists": True, "$ne": None}},
                        {"is_robot": True},
                    ],
                }),
                _witness_nav_green_count(),
                get_game_pass_season_public(db),
                _owned_premium_weapon_flags(),
                _vip_pass_car_info(),
            )
            owns_weapon10, owns_weapon11 = premium_weapon_flags
            vip_pass_car_count, vip_pass_car_in_game, vip_pass_car_purchase_limit = vip_pass_car_info
            owns_vip_pass_car = vip_pass_car_count > 0
            gp_current_sid = str((gp_season_pub or {}).get("game_pass_season_id") or "1")
            witness_nav_red = _safe_int(u.get("witness_nav_red"), 0)
            witness_nav_green = min(_safe_int(witness_nav_green_n, 0), 999)
            ref_users = []
            if ref_ids:
                ref_users = await db.users.find(
                    {"id": {"$in": ref_ids}},
                    {"_id": 0, "id": 1, "username": 1},
                ).to_list(50)
            id_to_ref_name = {str(x["id"]): (x.get("username") or "?") for x in ref_users}
            admin_online_color = (admin_color_doc.get("value") or "#a78bfa") if admin_color_doc else "#a78bfa"
            if not isinstance(admin_online_color, str) or not admin_online_color.strip():
                admin_online_color = "#a78bfa"
            admin_online_color = admin_online_color.strip()
            mod_online_color = None
            entertainer_online_color = None
            hdo_online_color = None
            if _is_moderator(current_user):
                raw = (current_user.get("mod_online_color") or "").strip() or "#1e3a5f"
                mod_online_color = raw if raw.startswith("#") and len(raw) <= 9 else "#1e3a5f"
            if _is_entertainer(current_user):
                from utils.entertainer_service import ENTERTAINER_ONLINE_COLOR_DEFAULT as _ent_col_def

                raw_e = (current_user.get("entertainer_online_color") or "").strip() or _ent_col_def
                entertainer_online_color = raw_e if raw_e.startswith("#") and len(raw_e) <= 9 else _ent_col_def
            if _is_hdo(current_user):
                _hdo_def = "#166534"
                raw_h = (current_user.get("hdo_online_color") or "").strip() or _hdo_def
                hdo_online_color = raw_h if raw_h.startswith("#") and len(raw_h) <= 9 else _hdo_def
            # Resolve gun_name, armour_name, gang_name for sidebar
            gun_name = None
            if equipped_weapon_id and weapon_doc:
                gun_name = weapon_doc.get("name") or equipped_weapon_id
            armour_name = None
            alvl = _safe_int(u.get("armour_level"), 0)
            owned_armour_max = _safe_int(u.get("armour_owned_level_max"), alvl)
            if alvl >= 7:
                armour_name = "Steel Plate Bulletproof Vest (1922)"
            elif alvl == 6:
                armour_name = "Elite Composite Battledress"
            elif alvl > 0:
                armour = next((a for a in ARMOUR_SETS if a.get("level") == alvl), None)
                armour_name = armour.get("name") if armour else f"Level {alvl}"
            location = str(u.get("current_state") or "").strip() or None
            gang_name = None
            family_name = None
            if fam:
                gang_name = fam.get("name")
                family_name = fam.get("name")
            elif family_id:
                await db.users.update_one(
                    {"id": u["id"], "family_id": family_id},
                    {"$set": {"family_id": None, "family_role": None}},
                )
                u["family_id"] = None
                u["family_role"] = None
            referred_by_username = None
            referred_by_legacy = None
            if ref_ids:
                referred_by_username = ", ".join(id_to_ref_name.get(i, "?") for i in ref_ids)
                referred_by_legacy = ref_ids[0]
            return UserResponse(
                id=str(u["id"]),
                email="",
                username=str(u.get("username") or ""),
                rank=rank_id,
                rank_name=rank_name,
                wealth_rank=wealth_id,
                wealth_rank_name=wealth_name,
                wealth_rank_color=wealth_color,
                wealth_rank_range=wealth_range,
                money=money_val,
                points=_safe_int(u.get("points"), 0),
                rank_points=_safe_int(u.get("rank_points"), 0),
                prestige_level=_safe_int(u.get("prestige_level"), 0),
                bodyguard_slots=_safe_int(u.get("bodyguard_slots"), 1),
                bodyguard_count=bodyguard_count,
                bullets=_safe_int(u.get("bullets"), 0),
                molotovs=_safe_int(u.get("molotovs"), 0),
                witness_statements=_safe_int(u.get("witness_statements"), 0),
                witness_nav_red=witness_nav_red,
                witness_nav_green=witness_nav_green,
                health=_safe_int(u.get("health"), DEFAULT_HEALTH),
                armour_level=_safe_int(u.get("armour_level"), 0),
                armour_owned_level_max=owned_armour_max,
                owns_weapon10=bool(owns_weapon10),
                owns_weapon11=bool(owns_weapon11),
                owns_vip_pass_car=bool(owns_vip_pass_car),
                vip_pass_car_count=int(vip_pass_car_count or 0),
                vip_pass_car_in_game=int(vip_pass_car_in_game or 0),
                vip_pass_car_purchase_limit=int(vip_pass_car_purchase_limit or 5),
                current_state=str(u.get("current_state") or ""),
                total_kills=effective_player_kill_count(u),
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
                founding_member=bool(u.get("founding_member", False)),
                auto_rank_purchased=bool(u.get("auto_rank_purchased", False)),
                auto_rank_permanent=bool(u.get("auto_rank_permanent", False)),
                auto_rank_email_entitlement=bool(u.get("auto_rank_email_entitlement", False)),
                auto_rank_trial=bool(u.get("auto_rank_trial", False)),
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
                admin_preview_as_mod=bool(admin_mod_preview_active(u)),
                admin_preview_as_mod_seconds_remaining=admin_mod_preview_seconds_remaining(u),
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
                hdo_online_color=hdo_online_color,
                is_entertainer=bool(u.get("is_entertainer", False)),
                entertainer_online_color=entertainer_online_color,
                entertainer_fund_cash=_safe_float(u.get("entertainer_fund_cash"), 0.0),
                entertainer_fund_points=_safe_int(u.get("entertainer_fund_points"), 0),
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
                auto_collect_12h_tokens=_safe_int(u.get("auto_collect_12h_tokens"), 0),
                auto_collect_24h_tokens=_safe_int(u.get("auto_collect_24h_tokens"), 0),
                jail_bailout_tokens=_safe_int(u.get("jail_bailout_tokens"), 0),
                cooldown_skip_crime_tokens=_safe_int(u.get("cooldown_skip_crime_tokens"), 0),
                cooldown_skip_gta_tokens=_safe_int(u.get("cooldown_skip_gta_tokens"), 0),
                cooldown_skip_booze_tokens=_safe_int(u.get("cooldown_skip_booze_tokens"), 0),
                cooldown_skip_properties_tokens=_safe_int(u.get("cooldown_skip_properties_tokens"), 0),
                auto_collect_until=u.get("auto_collect_until"),
                custom_profile_badge=bool(u.get("custom_profile_badge")),
                custom_profile_badge_url=(u.get("custom_profile_badge_url") or None) if u.get("custom_profile_badge") else None,
                profile_cosmetic_active=profile_cosmetic_active(u),
                profile_name_glow_color=u.get("profile_name_glow_color") if profile_cosmetic_active(u) else None,
                profile_border_style=u.get("profile_border_style") if profile_cosmetic_active(u) else None,
                profile_cosmetic_until=u.get("profile_cosmetic_until"),
                profile_cosmetic_permanent=bool(u.get("profile_cosmetic_permanent")),
                crew_oc_auto_apply_tokens=_safe_int(u.get("crew_oc_auto_apply_tokens"), 0),
                crew_oc_auto_apply_until=u.get("crew_oc_auto_apply_until"),
                crew_oc_auto_apply_max_fee=(
                    _safe_int(u.get("crew_oc_auto_apply_max_fee"), 0)
                    if u.get("crew_oc_auto_apply_max_fee") is not None
                    else None
                ),
                rank_xp_pass_tokens=_safe_int(u.get("rank_xp_pass_tokens"), 0),
                rank_xp_pass_token_expires_at=u.get("rank_xp_pass_token_expires_at"),
                rank_xp_pass_tier_snapshot=_safe_int(u.get("rank_xp_pass_tier_snapshot"), 0) if u.get("rank_xp_pass_tier_snapshot") is not None else None,
                rank_xp_pass_pending_tier_snapshot=(
                    _safe_int(u.get("rank_xp_pass_pending_tier_snapshot"), 0)
                    if u.get("rank_xp_pass_pending_tier_snapshot") is not None
                    else None
                ),
                rank_xp_pass_last_granted_micro_tier=_safe_int(u.get("rank_xp_pass_last_granted_micro_tier"), 0),
                game_pass_season_id=(
                    None
                    if u.get("game_pass_season_id") is None or str(u.get("game_pass_season_id")).strip() == ""
                    else str(u.get("game_pass_season_id")).strip()
                ),
                rank_xp_pass_season_rp=_safe_int(u.get("rank_xp_pass_season_rp"), 0),
                game_pass_current_season_id=gp_current_sid,
                rank_xp_pass_prestige_carry_rp=_safe_int(u.get("rank_xp_pass_prestige_carry_rp"), 0),
                rank_xp_pass_rewards_granted=bool(u.get("rank_xp_pass_rewards_granted", False)),
                game_pass_prestige_count=_safe_int(u.get("game_pass_prestige_count"), 0),
                shooting_range_bonus_plays=_safe_int(u.get("shooting_range_bonus_plays"), 0),
                hitlist_npc_bonus_slots=_safe_int(u.get("hitlist_npc_bonus_slots"), 0),
                robot_bg_auto_search_until=u.get("robot_bg_auto_search_until"),
                robot_bg_auto_search_active=robot_bg_auto_search_active(u),
                bodyguard_find_time_until=u.get("bodyguard_find_time_until"),
                bodyguard_find_time_active=_bodyguard_find_time_active(u),
                slow_kill_inflation_until=u.get("slow_kill_inflation_until"),
                slow_kill_inflation_active=_timed_perk_active(u.get("slow_kill_inflation_until")),
                slow_bodyguard_hire_inflation_until=u.get("slow_bodyguard_hire_inflation_until"),
                slow_bodyguard_hire_inflation_active=_timed_perk_active(u.get("slow_bodyguard_hire_inflation_until")),
                censor_profanity=bool(u.get("censor_profanity", False)),
                referred_by=referred_by_legacy,
                referred_by_username=referred_by_username,
                referred_by_ids=list(ref_ids),
                referral_earnings_crime=_safe_int(u.get("referral_earnings_crime"), 0),
                referral_earnings_oc=_safe_int(u.get("referral_earnings_oc"), 0),
                referral_earnings_booze=_safe_int(u.get("referral_earnings_booze"), 0),
                referral_earnings_garage_scrap=_safe_int(u.get("referral_earnings_garage_scrap"), 0),
                referral_earnings_melt_bullets=_safe_int(u.get("referral_earnings_melt_bullets"), 0),
                rules_accepted=bool(u.get("rules_accepted", False)),
                rules_accepted_at=u.get("rules_accepted_at"),
                tutorial_status=u.get("tutorial_status"),
                tutorial_step=u.get("tutorial_step"),
                tutorial_crime_done=bool(u.get("tutorial_crime_done", False)),
                tutorial_gta_done=bool(u.get("tutorial_gta_done", False)),
                tutorial_theme_done=bool(u.get("tutorial_theme_done", False)),
                tutorial_rewards_granted=bool(u.get("tutorial_rewards_granted", False)),
                tutorial_ineligible_reason=u.get("tutorial_ineligible_reason"),
                loot_box_free_rare_opens=_safe_int(u.get("loot_box_free_rare_opens"), 0),
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
        from utils.referral_weekly_points import process_referral_weekly_points

        user_id = current_user.get("id")
        weekly_stats = await process_referral_weekly_points(db, user_id)
        u = await db.users.find_one(
            {"id": user_id},
            {
                "_id": 0,
                "username": 1,
                "referred_by": 1,
                "referral_earnings_melt_bullets": 1,
                "referral_earnings_crime": 1,
                "referral_earnings_oc": 1,
                "referral_earnings_garage_scrap": 1,
                "referral_earnings_booze": 1,
                "referral_earnings_weekly_points": 1,
            },
        ) or current_user
        username = (u.get("username") or current_user.get("username") or "").strip()
        ref_ids = normalize_referred_by_ids(u.get("referred_by") or current_user.get("referred_by"))
        referred_by_username = None
        referred_by_usernames_list: List[str] = []
        if ref_ids:
            ref_users = await db.users.find(
                {"id": {"$in": ref_ids}},
                {"_id": 0, "id": 1, "username": 1},
            ).to_list(50)
            id_to_name = {str(x["id"]): (x.get("username") or "?") for x in ref_users}
            referred_by_usernames_list = [id_to_name.get(i, "?") for i in ref_ids]
            referred_by_username = ", ".join(referred_by_usernames_list)
        earnings = {
            "melt_bullets": int(u.get("referral_earnings_melt_bullets") or 0),
            "crime_profit": int(u.get("referral_earnings_crime") or 0),
            "oc_profit": int(u.get("referral_earnings_oc") or 0),
            "garage_scrap": int(u.get("referral_earnings_garage_scrap") or 0),
            "booze_profit": int(u.get("referral_earnings_booze") or 0),
            "weekly_points": int(u.get("referral_earnings_weekly_points") or 0),
        }
        signup_bonus = None
        if referred_by_username:
            signup_bonus = "Premium rank bar, 500 respect points, and 18 tokens (use them; they can't be sold on Quick Trade). Plus 10% higher crime payouts and a 10% GTA rare car boost."
        redeem_stats = {
            "total_money": int(current_user.get("redeem_stats_total_money") or 0),
            "total_points": int(current_user.get("redeem_stats_total_points") or 0),
            "total_respect_points": int(current_user.get("redeem_stats_total_respect_points") or 0),
            "total_loot_box_pieces": int(current_user.get("redeem_stats_total_loot_box_pieces") or 0),
            "total_bullets": int(current_user.get("redeem_stats_total_bullets") or 0),
            "total_cars": int(current_user.get("redeem_stats_total_cars") or 0),
            "total_tokens": int(current_user.get("redeem_stats_total_tokens") or 0),
        }
        return {
            "username": username,
            "referred_by_username": referred_by_username,
            "referred_by_usernames": referred_by_usernames_list,
            "signup_bonus": signup_bonus,
            "earnings": earnings,
            "weekly_points": weekly_stats,
            "redeem_stats": redeem_stats,
        }

    class RedeemRequestBody(BaseModel):
        code: str

    @router.post("/account/redeem")
    async def redeem_code(body: RedeemRequestBody, current_user: dict = Depends(get_current_user)):
        """Redeem a code. One redemption per user id per code; respects max_uses.

        Support: if a *new* user id cannot redeem after the old character died, check redeem_codes.used_by / used_count
        (reconcile runs on each attempt). If the *same* character (same users.id) revived, redeemed_codes still blocks — by design.
        """
        from routers.kill.armoury import TOKEN_CONFIG
        code_normalized = (body.code or "").strip().upper()
        if not code_normalized:
            raise HTTPException(status_code=400, detail="Code is required")
        user_id = current_user.get("id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Not authenticated")
        if code_normalized in (current_user.get("redeemed_codes") or []):
            raise HTTPException(status_code=400, detail="This character has already redeemed this code.")
        await reconcile_stale_dead_redeemers_on_code(db, code_normalized)
        doc = await db.redeem_codes.find_one({"code": code_normalized, "active": True})
        if not doc:
            raise HTTPException(status_code=400, detail="Invalid or inactive code")
        used_by = doc.get("used_by") or []
        if user_id in used_by:
            raise HTTPException(status_code=400, detail="This character is already recorded for this redeem code.")
        max_uses = doc.get("max_uses")
        used_count = int(doc.get("used_count", 0))
        if max_uses is not None and used_count >= max_uses:
            raise HTTPException(status_code=400, detail="This code has no redemptions left.")

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
            raise HTTPException(status_code=400, detail="Could not claim this code (try again).")
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
        if rewards.get("bullets"):
            inc["bullets"] = int(rewards["bullets"])
        for token_type, amount in (rewards.get("tokens") or {}).items():
            if token_type == "rank_xp_pass":
                continue
            cfg = TOKEN_CONFIG.get(token_type)
            if cfg and amount:
                inc[cfg["count_field"]] = int(amount)
        inc["redeem_stats_total_money"] = int(rewards.get("money") or 0)
        inc["redeem_stats_total_points"] = int(rewards.get("points") or 0)
        inc["redeem_stats_total_respect_points"] = int(rewards.get("respect_points") or 0)
        inc["redeem_stats_total_loot_box_pieces"] = int(rewards.get("loot_box_pieces") or 0)
        inc["redeem_stats_total_bullets"] = int(rewards.get("bullets") or 0)
        inc["redeem_stats_total_cars"] = len(rewards.get("cars") or [])
        inc["redeem_stats_total_tokens"] = sum(
            int(a)
            for tt, a in (rewards.get("tokens") or {}).items()
            if tt != "rank_xp_pass"
        )
        if inc:
            await db.users.update_one(
                {"id": user_id},
                {"$inc": inc, "$addToSet": {"redeemed_codes": code_normalized}},
            )
        else:
            await db.users.update_one({"id": user_id}, {"$addToSet": {"redeemed_codes": code_normalized}})
        if inc.get("points", 0) > 0:
            await log_points_event(db, user_id=user_id, points=inc["points"], event_type="redeem_code", event_ref=code_normalized, meta={"code": code_normalized})
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
        if inc.get("bullets"):
            granted.append(f"{inc['bullets']:,} bullets")
        for token_type, amount in (rewards.get("tokens") or {}).items():
            if token_type == "rank_xp_pass":
                continue
            if amount:
                granted.append(f"{amount} {token_type.replace('_', ' ')} token(s)")
        for car_id in (rewards.get("cars") or []):
            car_info = next((c for c in CARS if c.get("id") == car_id), None)
            if car_info:
                granted.append(car_info.get("name", car_id))
        return {"message": "Code redeemed successfully", "granted": granted}

    @router.get("/user/casino-property", dependencies=_casino_property_rl_u)
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
        current_email = (current_user.get("email") or "").strip().lower()
        current_is_dupe_exempt = bool(current_email and current_email in (DUPE_DETECTION_EXEMPT_EMAILS or []))
        if current_ip:
            if not current_is_dupe_exempt:
                ip_query: Dict[str, Any] = {"$or": [{"registration_ip": current_ip}, {"login_ips": current_ip}]}
                exempt_emails = [e.strip().lower() for e in (DUPE_DETECTION_EXEMPT_EMAILS or []) if str(e or "").strip()]
                if exempt_emails:
                    ip_query["$nor"] = [{"email": re.compile("^" + re.escape(e) + "$", re.IGNORECASE)} for e in exempt_emails]
                cursor = db.users.find(
                    ip_query,
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
        if is_registration_player_email_blocked(email_clean):
            raise HTTPException(
                status_code=400,
                detail="Use a personal email. You cannot use this site's domain for pre-registration.",
            )

        main_settings = await db.game_settings.find_one({"_id": "main"}, {"_id": 0})
        blocked_cli, cli_reason = auth_client_headers_blocked(request.headers, main_settings)
        if blocked_cli:
            logging.warning(
                "Preregister blocked: client probe reason=%s ip=%s email=%s",
                cli_reason,
                _client_ip(request),
                (email_clean or "")[:48],
            )
            await maybe_notify_staff_bot_client_blocked(
                db=db,
                request=request,
                internal_reason=cli_reason,
                source="auth_preregister",
                context_note=f"Pre-register attempt — email: {(email_clean or '')[:96]}",
            )
            raise HTTPException(
                status_code=403,
                detail="This action must be done from the official game site in a normal web browser.",
            )

        # Check if already pre-registered or has an account
        existing_prereg = await db.preregistrations.find_one({"email": email_clean})
        if existing_prereg:
            return {"message": "You're already on the list!", "already_registered": True}
        
        existing_user = await db.users.find_one({"email": {"$regex": f"^{re.escape(email_clean)}$", "$options": "i"}})
        if existing_user:
            return {"message": "You already have an account! You'll receive founding member rewards.", "already_registered": True}
        
        # Store pre-registration (optional referral_code for full signup merge when client omits ?ref=)
        ref_raw = (body.referral_code or "").strip()
        if len(ref_raw) > 80:
            ref_raw = ref_raw[:80]
        doc = {
            "email": email_clean,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ip": _client_ip(request),
            "converted": False,
        }
        if ref_raw:
            doc["referral_code"] = ref_raw
        await db.preregistrations.insert_one(doc)
        
        return {
            "message": (
                "You're in! We'll email you when the game launches. "
                "Create a full account to earn the Founding Member badge, launch-day respect & cash, and a permanent +15% bonus on core payouts."
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
