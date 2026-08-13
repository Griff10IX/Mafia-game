# Profile: user profile view, avatar, theme, change-password, telegram (for Auto Rank)
import asyncio
import base64
import logging
import os
import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional
from urllib.parse import urlencode, urlparse

from routers.casinos.slots import SLOTS_FEATURE_ENABLED

_VALID_TOAST_POSITIONS = frozenset(
    ("top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right", "custom")
)
_VALID_TOPBAR_STAT_IDS = frozenset(
    ("rank", "health", "bullets", "kills", "money", "points", "respect_points", "notifications", "property")
)
_CHIP_SCALE_MIN, _CHIP_SCALE_MAX = 20, 100


def _family_member_user_id_variants(user_id) -> list:
    """String/int variants for family_members.user_id (Mongo matches type strictly)."""
    out = []
    if user_id is None:
        return out
    s = str(user_id).strip()
    if s:
        out.append(s)
    if isinstance(user_id, int):
        out.append(user_id)
    elif isinstance(user_id, str) and user_id.isdigit():
        try:
            out.append(int(user_id))
        except ValueError:
            pass
    return list(dict.fromkeys(out))


def _theme_legacy_prefs(user: Dict[str, Any]) -> Dict[str, Any]:
    t = user.get("theme_preferences")
    return dict(t) if isinstance(t, dict) else {}


def _theme_bucket_prefs(user: Dict[str, Any], *, platform_pc: bool) -> Dict[str, Any]:
    key = "theme_preferences_pc" if platform_pc else "theme_preferences_mobile"
    raw = user.get(key)
    if isinstance(raw, dict):
        return dict(raw)
    return _theme_legacy_prefs(user)


def _theme_response_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    pc = _theme_bucket_prefs(user, platform_pc=True)
    mobile = _theme_bucket_prefs(user, platform_pc=False)
    return {
        "theme_preferences_pc": pc,
        "theme_preferences_mobile": mobile,
        "theme_preferences": pc,
    }


import httpx
from fastapi import Body, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from utils.profile_cosmetics import profile_cosmetic_public_fields
from utils.civilian_protection import (
    civilian_protection_status_payload,
    maybe_revoke_civilian_protection,
    require_protection_revoke_confirm,
)
from utils.gambling_self_ban import (
    GAMBLING_SELF_BAN_DURATIONS_HOURS,
    gambling_self_ban_status_payload,
    is_gambling_self_banned,
)
from utils.hitlist_resolution import resolve_user_hitlist_kill
from utils.bbcode_normalize import normalize_bbcode_media_typos
from utils.imgbb_resolve import rewrite_imgbb_urls_in_banner_text
from utils.default_player_avatar import resolve_player_avatar_url
from utils.notepad_color import (
    notepad_color_for_api_response as _notepad_color_for_api_response,
    normalize_notepad_color_for_set as _normalize_notepad_color_for_set,
)

logger = logging.getLogger(__name__)

SPOTIFY_ALLOWED_TYPES = {"track", "album", "playlist", "artist", "episode", "show"}
SPOTIFY_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")
SPOTIFY_OAUTH_SCOPE = "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state user-read-currently-playing"


async def ensure_profile_indexes(db):
    """
    Create indexes used by the profile endpoint so profile loads stay fast.
    Idempotent: safe to run on every startup.
    """
    try:
        # users: lookup by username (regex) and by id
        await db.users.create_index("username")
        await db.users.create_index("id", unique=True)
        # users: rank counts use filter is_dead, is_bodyguard + range on one field
        for field in ("total_kills", "total_crimes", "total_gta", "jail_busts", "rank_points", "lifetime_points_spent"):
            await db.users.create_index([
                ("is_dead", 1),
                ("is_bodyguard", 1),
                (field, -1),
            ])
        # families: lookup by id
        await db.families.create_index("id", unique=True)
        # casino ownership: list by owner_id (dice, roulette, blackjack, horseracing, videopoker)
        for coll_name in ("dice_ownership", "roulette_ownership", "blackjack_ownership", "horseracing_ownership", "videopoker_ownership", "slots_ownership"):
            await db[coll_name].create_index("owner_id")
        # notifications: count by user_id + type (profile inbox/sent aggregation)
        await db.notifications.create_index("user_id")
        await db.notifications.create_index([("user_id", 1), ("notification_type", 1)])
        logger.info("Profile indexes ensured.")
    except Exception as e:
        logger.warning("ensure_profile_indexes: %s", e)


def register(router):
    """Register profile routes. Dependencies from server to avoid circular imports."""
    import server as srv

    WAR_RAT_BADGE_UNSET = {"war_rat_badge_until": "", "war_rat_family_id": "", "war_rat_war_ids": ""}

    db = srv.db
    effective_player_kill_count = srv.effective_player_kill_count
    mongodb_effective_kill_count_expr = srv.mongodb_effective_kill_count_expr
    mongodb_lifetime_rank_points_expr = srv.mongodb_lifetime_rank_points_expr
    expand_user_ids_for_mongo_nin = srv.expand_user_ids_for_mongo_nin
    get_current_user = srv.get_current_user
    get_current_user_verified = srv.get_current_user_verified
    _username_pattern = srv._username_pattern
    get_rank_info = srv.get_rank_info
    get_wealth_rank = srv.get_wealth_rank
    get_wealth_rank_range = srv.get_wealth_rank_range
    _user_owns_any_property = srv._user_owns_any_property
    _user_owns_garage_dealership = srv._user_owns_garage_dealership
    _user_owns_sports_betting_book = srv._user_owns_sports_betting_book
    _is_moderator = srv._is_moderator
    _is_entertainer = srv._is_entertainer
    _is_hdo = srv._is_hdo
    _is_admin = srv._is_admin
    require_staff_issued_if_staff_capable = srv.require_staff_issued_if_staff_capable
    MOD_ONLINE_COLOR_DEFAULT = "#1e3a5f"
    verify_password = srv.verify_password
    get_password_hash = srv.get_password_hash
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    _user_excluded_from_stat_leaderboards = srv._user_excluded_from_stat_leaderboards
    stat_leaderboard_users_match = srv.stat_leaderboard_users_match
    user_has_admin_list_email = srv.user_has_admin_list_email
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    AvatarUpdateRequest = srv.AvatarUpdateRequest
    CustomBadgeUpdateRequest = srv.CustomBadgeUpdateRequest
    ThemePreferencesRequest = srv.ThemePreferencesRequest
    ChangePasswordRequest = srv.ChangePasswordRequest
    DashboardPreferencesRequest = srv.DashboardPreferencesRequest
    CARS = srv.CARS

    class SpotifyEmbedUpdateBody(BaseModel):
        spotify_url: Optional[str] = None

    class SpotifyOAuthCallbackBody(BaseModel):
        code: str
        state: str

    class SpotifyPlayBody(BaseModel):
        uri: Optional[str] = None
        device_id: Optional[str] = None
        position_ms: Optional[int] = None

    class SpotifyTransferBody(BaseModel):
        device_id: str
        play: Optional[bool] = True

    class SpotifyVolumeBody(BaseModel):
        volume_percent: int = Field(..., ge=0, le=100)

    def _spotify_env():
        return (
            (os.environ.get("SPOTIFY_CLIENT_ID") or "").strip(),
            (os.environ.get("SPOTIFY_CLIENT_SECRET") or "").strip(),
            (os.environ.get("SPOTIFY_REDIRECT_URI") or "").strip(),
        )

    async def _spotify_feature_allowed(current_user: dict) -> bool:
        if _is_admin(current_user):
            return True
        main_doc = await db.game_settings.find_one({"_id": "main"}, {"_id": 0, "spotify_feature_enabled": 1})
        return bool(main_doc.get("spotify_feature_enabled", False)) if main_doc else False

    def _spotify_normalize_url_or_uri(raw: str):
        """
        Normalize Spotify URL/URI into canonical forms.
        Returns tuple: (uri, embed_url, public_url, content_type, spotify_id)
        """
        s = (raw or "").strip()
        if not s:
            raise HTTPException(status_code=400, detail="Spotify URL/URI is required.")

        content_type = None
        spotify_id = None

        if s.lower().startswith("spotify:"):
            parts = s.split(":")
            if len(parts) == 3:
                content_type = (parts[1] or "").strip().lower()
                spotify_id = (parts[2] or "").strip()
        else:
            try:
                parsed = urlparse(s)
            except Exception:
                parsed = None
            if parsed and "spotify.com" in (parsed.netloc or "").lower():
                segs = [seg for seg in (parsed.path or "").split("/") if seg]
                if segs and segs[0].lower().startswith("intl-"):
                    segs = segs[1:]
                if len(segs) >= 2:
                    content_type = (segs[0] or "").strip().lower()
                    spotify_id = (segs[1] or "").strip()

        if content_type not in SPOTIFY_ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail=f"Unsupported Spotify type. Allowed: {sorted(SPOTIFY_ALLOWED_TYPES)}")
        if not spotify_id or not SPOTIFY_ID_RE.match(spotify_id):
            raise HTTPException(status_code=400, detail="Invalid Spotify ID.")

        uri = f"spotify:{content_type}:{spotify_id}"
        public_url = f"https://open.spotify.com/{content_type}/{spotify_id}"
        embed_url = f"https://open.spotify.com/embed/{content_type}/{spotify_id}"
        return uri, embed_url, public_url, content_type, spotify_id

    def _spotify_auth_header(client_id: str, client_secret: str) -> str:
        raw = f"{client_id}:{client_secret}".encode("utf-8")
        return "Basic " + base64.b64encode(raw).decode("ascii")

    async def _spotify_exchange_code_for_tokens(code: str):
        client_id, client_secret, redirect_uri = _spotify_env()
        if not client_id or not client_secret or not redirect_uri:
            raise HTTPException(status_code=503, detail="Spotify OAuth is not configured on the server.")
        headers = {
            "Authorization": _spotify_auth_header(client_id, client_secret),
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post("https://accounts.spotify.com/api/token", data=data, headers=headers)
        if r.status_code >= 400:
            detail = None
            try:
                detail = r.json()
            except Exception:
                detail = r.text
            raise HTTPException(status_code=400, detail=f"Spotify token exchange failed: {detail}")
        return r.json() if r.content else {}

    async def _spotify_refresh_access_token(refresh_token: str):
        client_id, client_secret, _redirect_uri = _spotify_env()
        if not client_id or not client_secret:
            raise HTTPException(status_code=503, detail="Spotify OAuth is not configured on the server.")
        headers = {
            "Authorization": _spotify_auth_header(client_id, client_secret),
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post("https://accounts.spotify.com/api/token", data=data, headers=headers)
        if r.status_code >= 400:
            detail = None
            try:
                detail = r.json()
            except Exception:
                detail = r.text
            raise HTTPException(status_code=400, detail=f"Spotify token refresh failed: {detail}")
        return r.json() if r.content else {}

    async def _spotify_valid_access_token(user_id: str):
        doc = await db.users.find_one(
            {"id": user_id},
            {
                "_id": 0,
                "spotify_connected": 1,
                "spotify_access_token": 1,
                "spotify_access_token_expires_at": 1,
                "spotify_refresh_token": 1,
            },
        )
        if not doc or not doc.get("spotify_connected"):
            raise HTTPException(status_code=400, detail="Spotify is not connected.")

        now = datetime.now(timezone.utc)
        token = (doc.get("spotify_access_token") or "").strip()
        exp_raw = doc.get("spotify_access_token_expires_at")
        exp_dt = None
        if exp_raw:
            try:
                exp_dt = datetime.fromisoformat(str(exp_raw).replace("Z", "+00:00"))
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            except Exception:
                exp_dt = None

        if token and exp_dt and exp_dt > (now + timedelta(seconds=30)):
            return token

        refresh_token = (doc.get("spotify_refresh_token") or "").strip()
        if not refresh_token:
            raise HTTPException(status_code=400, detail="Spotify refresh token is missing. Please reconnect Spotify.")

        refreshed = await _spotify_refresh_access_token(refresh_token)
        new_access = (refreshed.get("access_token") or "").strip()
        if not new_access:
            raise HTTPException(status_code=400, detail="Failed to refresh Spotify access token. Please reconnect Spotify.")
        expires_in = int(refreshed.get("expires_in") or 3600)
        new_refresh = (refreshed.get("refresh_token") or "").strip() or refresh_token
        new_exp = (now + timedelta(seconds=max(60, expires_in))).isoformat()
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "spotify_access_token": new_access,
                    "spotify_access_token_expires_at": new_exp,
                    "spotify_refresh_token": new_refresh,
                    "spotify_connected": True,
                }
            },
        )
        return new_access

    def _profile_car_display_name(uc: dict, info: Optional[dict]) -> str:
        if uc.get("car_id") == "car_custom":
            custom = (uc.get("custom_name") or "").strip()
            if custom:
                return custom
        return (info or {}).get("name") or "?"

    async def _top_cars_for_profile(user_id: str, limit: int = 5, show_cars: bool = False, profile_car_ids: Optional[list] = None):
        """Return only the explicitly chosen cars for the profile (up to 5). Preserves selection order."""
        if not show_cars or not profile_car_ids:
            return []
        car_ids = [cid for cid in (profile_car_ids or []) if cid][:limit]
        if not car_ids:
            return []
        cars_catalog = {c["id"]: c for c in (CARS or [])}
        owned_map = {}
        cursor = db.user_cars.find(
            {"user_id": user_id, "id": {"$in": car_ids}},
            {"_id": 0, "id": 1, "car_id": 1, "custom_name": 1},
        )
        async for uc in cursor:
            owned_map[uc["id"]] = uc
        result = []
        for cid in car_ids:
            uc = owned_map.get(cid)
            if not uc:
                continue
            info = cars_catalog.get(uc.get("car_id")) if uc.get("car_id") else None
            if not info:
                continue
            result.append({
                "id": uc.get("id"),
                "name": _profile_car_display_name(uc, info),
                "value": int(info.get("value") or 0),
                "rarity": info.get("rarity") or "common",
            })
        return result

    async def _find_user_by_profile_username(username: str, projection: dict):
        """Resolve user by username; supports hitlist NPC names with `#` in them.

        If the URL was broken at `#` (browser fragment), the path may be only `Name (NPC)` while
        the DB username is `Name (NPC) #af473e1c`. When exactly one NPC matches that prefix+suffix, use it.
        """
        username_pattern = _username_pattern(username)
        user = await db.users.find_one({"username": username_pattern}, projection)
        if user:
            return user
        raw = (username or "").strip()
        if "(NPC)" in raw and "#" not in raw:
            try:
                rx = re.compile("^" + re.escape(raw) + r" #[0-9a-f]{8}$", re.IGNORECASE)
            except re.error:
                return None
            cand = await db.users.find({"is_npc": True, "username": rx}, projection).to_list(12)
            if len(cand) == 1:
                return cand[0]
        return None

    async def _war_rat_badge_active(user: dict) -> bool:
        """Rat badge stays while the specific war(s) active when the user left are still ongoing."""
        uid = user.get("id")
        war_ids = [str(w).strip() for w in (user.get("war_rat_war_ids") or []) if str(w or "").strip()]
        family_id = str(user.get("war_rat_family_id") or "").strip()
        active_query = {"status": {"$in": ["active", "truce_offered"]}}
        if war_ids:
            active_query["id"] = {"$in": war_ids}
        elif family_id:
            active_query["$or"] = [{"family_a_id": family_id}, {"family_b_id": family_id}]
        else:
            # Legacy records only had a timer. If this user has war stats, recover the
            # specific active war so the badge follows the war instead of the old timer.
            if uid and user.get("war_rat_badge_until"):
                legacy_stats = await db.family_war_stats.find(
                    {"user_id": uid},
                    {"_id": 0, "war_id": 1, "family_id": 1},
                ).sort("war_id", -1).limit(20).to_list(20)
                legacy_war_ids = [str(s.get("war_id") or "").strip() for s in legacy_stats if str(s.get("war_id") or "").strip()]
                if legacy_war_ids:
                    legacy_war = await db.family_wars.find_one(
                        {"id": {"$in": legacy_war_ids}, "status": {"$in": ["active", "truce_offered"]}},
                        {"_id": 0, "id": 1, "family_a_id": 1, "family_b_id": 1},
                    )
                    if legacy_war:
                        stat_family = next((str(s.get("family_id") or "").strip() for s in legacy_stats if s.get("war_id") == legacy_war.get("id")), "")
                        await db.users.update_one(
                            {"id": uid},
                            {
                                "$set": {
                                    "war_rat_war_ids": [legacy_war["id"]],
                                    "war_rat_family_id": stat_family,
                                }
                            },
                        )
                        return True
                    await db.users.update_one(
                        {"id": uid},
                        {"$unset": WAR_RAT_BADGE_UNSET},
                    )
                    return False

            # Last fallback for records too old to tie back to a war.
            wr_until = user.get("war_rat_badge_until")
            if not wr_until:
                return False
            try:
                wdt = datetime.fromisoformat(str(wr_until).replace("Z", "+00:00"))
                if wdt.tzinfo is None:
                    wdt = wdt.replace(tzinfo=timezone.utc)
                return datetime.now(timezone.utc) < wdt
            except Exception:
                return False

        active = await db.family_wars.count_documents(active_query, limit=1)
        if active:
            return True
        if uid:
            await db.users.update_one(
                {"id": uid},
                {"$unset": WAR_RAT_BADGE_UNSET},
            )
        return False

    async def _build_profile_honours(user: dict, is_dead: bool) -> list:
        """Honour ranks (expensive DB work); callable from full profile or GET .../profile/honours."""
        if _user_excluded_from_stat_leaderboards(user):
            return []

        uid = user.get("id")
        fresh = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0}) if uid else None
        u = {**user, **(fresh or {})}
        if bool(u.get("hide_leaderboard_username")):
            return []

        base_q = await stat_leaderboard_users_match(dead=is_dead, database=db)

        async def _rank_for_field(field: str, value: int, *, subject_dead: bool) -> int:
            if value is None:
                value = 0
            q = {**base_q, field: {"$gt": value}}
            n_better = await db.users.count_documents(q)
            return n_better + 1

        async def _rank_for_effective_kills(effective_value: int, *, subject_dead: bool) -> int:
            """Same ordering as GET /leaderboards/top all-time kills (effective kills, not raw total_kills)."""
            if effective_value is None:
                effective_value = 0
            q = dict(base_q)
            ev = int(effective_value)
            pipeline = [
                {"$match": q},
                {"$addFields": {"_lb_eff_kills": mongodb_effective_kill_count_expr()}},
                {"$match": {"_lb_eff_kills": {"$gt": ev}}},
                {"$count": "n"},
            ]
            cur = await db.users.aggregate(pipeline).to_list(1)
            n_better = int(cur[0].get("n", 0)) if cur else 0
            return n_better + 1

        async def _rank_for_total_rank_points_lifetime(total_value: int, *, subject_dead: bool) -> int:
            """Same pipeline fields as leaderboard rank_points board: _lb_total_rp then $gt; pool matches /leaderboards/top."""
            if total_value is None:
                total_value = 0
            q = dict(base_q)
            tv = int(total_value)
            pipeline = [
                {"$match": q},
                {"$addFields": {"_lb_total_rp": mongodb_lifetime_rank_points_expr()}},
                {
                    "$match": {
                        "_lb_total_rp": {"$gt": tv},
                        "id": {"$nin": expand_user_ids_for_mongo_nin([uid])},
                    }
                },
                {"$count": "n"},
            ]
            cur = await db.users.aggregate(pipeline).to_list(1)
            n_better = int(cur[0].get("n", 0)) if cur else 0
            return n_better + 1

        eff_kills = effective_player_kill_count(u)
        kills_rank, crimes_rank, gta_rank, jail_rank, rank_points_rank, points_spent_rank = await asyncio.gather(
            _rank_for_effective_kills(eff_kills, subject_dead=is_dead),
            _rank_for_field("total_crimes", int(u.get("total_crimes") or 0), subject_dead=is_dead),
            _rank_for_field("total_gta", int(u.get("total_gta") or 0), subject_dead=is_dead),
            _rank_for_field("jail_busts", int(u.get("jail_busts") or 0), subject_dead=is_dead),
            _rank_for_total_rank_points_lifetime(
                int(u.get("rank_points") or 0) + int(u.get("rank_xp_pass_prestige_carry_rp") or 0),
                subject_dead=is_dead,
            ),
            _rank_for_field("lifetime_points_spent", int(u.get("lifetime_points_spent") or 0), subject_dead=is_dead),
        )
        return [
            {"rank": rank_points_rank, "label": "Most Rank Points Earned", "board": "rank_points"},
            {"rank": kills_rank, "label": "Most Kills", "board": "kills"},
            {"rank": crimes_rank, "label": "Most Crimes Committed", "board": "crimes"},
            {"rank": gta_rank, "label": "Most GTAs Committed", "board": "gta"},
            {"rank": jail_rank, "label": "Most Jail Busts", "board": "jail_busts"},
            {"rank": points_spent_rank, "label": "Most Points Spent", "board": "points_spent"},
        ]

    @router.get("/users/{username}/profile/honours")
    async def get_user_profile_honours(username: str, current_user: dict = Depends(get_current_user)):
        """Honour ranks only (same numbers as full profile); use with GET .../profile?include_honours=0 for faster first paint."""
        user = await _find_user_by_profile_username(username, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        is_dead = bool(user.get("is_dead"))
        return {"honours": await _build_profile_honours(user, is_dead)}

    @router.get("/users/{username}/profile-preview")
    async def get_user_profile_preview(username: str, current_user: dict = Depends(get_current_user)):
        """Minimal profile data for hover previews (e.g. Users Online). Only returns public-safe fields."""
        user = await _find_user_by_profile_username(
            username,
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "avatar_url": 1,
                "total_kills": 1,
                "hitlist_npc_kills": 1,
                "robot_bodyguard_kills": 1,
                "total_kills_excludes_npc_v1": 1,
                "jail_busts": 1,
                "hide_kills_on_profile": 1,
                "hide_jailbusts_on_profile": 1,
                "rank_points": 1,
                "prestige_rank_multiplier": 1,
                "prestige_level": 1,
                "money": 1,
                "founding_member": 1,
                "modkill_wipe": 1,
                "family_id": 1,
                "war_rat_badge_until": 1,
                "war_rat_family_id": 1,
                "war_rat_war_ids": 1,
                "is_moderator": 1,
                "is_help_desk_operator": 1,
                "is_entertainer": 1,
                "email": 1,
                # Needed by profile_cosmetic_public_fields (glow/border/custom badge in the hover card)
                "badges": 1,
                "custom_profile_badge": 1,
                "custom_profile_badge_url": 1,
                "profile_cosmetic_permanent": 1,
                "profile_cosmetic_until": 1,
                "profile_name_glow_color": 1,
                "profile_border_style": 1,
            },
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user.get("id")

        async def _hitlist_on():
            doc = await db.hitlist.find_one(
                {"target_id": user_id, "target_type": {"$in": ["user", "bodyguards"]}},
                {"_id": 1},
            )
            return doc is not None

        async def _message_counts():
            pipeline = [
                {
                    "$match": {
                        "user_id": user_id,
                        "notification_type": {"$in": ["user_message", "user_message_sent"]},
                    }
                },
                {"$group": {"_id": "$notification_type", "n": {"$sum": 1}}},
            ]
            received, sent = 0, 0
            async for doc in db.notifications.aggregate(pipeline):
                tid = doc.get("_id")
                n = int(doc.get("n") or 0)
                if tid == "user_message":
                    received = n
                elif tid == "user_message_sent":
                    sent = n
            return received, sent

        async def _family():
            # Prefer denormalized family_id — no membership heal writes on hover path.
            fid = str(user.get("family_id") or "").strip()
            if not fid:
                variants = _family_member_user_id_variants(user_id)
                member = await db.family_members.find_one(
                    {"user_id": {"$in": variants}} if variants else {"user_id": user_id},
                    {"_id": 0, "family_id": 1},
                )
                fid = str((member or {}).get("family_id") or "").strip()
            if not fid:
                return (None, None, None)
            fam = await db.families.find_one(
                {"id": fid},
                {"_id": 0, "name": 1, "tag": 1, "emblem_preset_id": 1, "avatar_url": 1, "wiped": 1},
            )
            if not fam or fam.get("wiped"):
                return (None, None, None)
            name = fam.get("name") or "?"
            tag = (fam.get("tag") or "").strip()
            display = f"{name}" + (f" [{tag}]" if tag else "") if name else None
            pid = fam.get("emblem_preset_id")
            avatar = None if pid else fam.get("avatar_url")
            return (display, pid, avatar)

        async def _owns_casino():
            colls = (
                "dice_ownership",
                "roulette_ownership",
                "blackjack_ownership",
                "horseracing_ownership",
                "slots_ownership",
                "videopoker_ownership",
            )
            docs = await asyncio.gather(
                *[db[c].find_one({"owner_id": user_id}, {"_id": 1}) for c in colls]
            )
            return any(docs)

        async def _property_type():
            airport, armoury = await asyncio.gather(
                db.airport_ownership.find_one({"owner_id": user_id}, {"_id": 1}),
                db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 1}),
            )
            if airport:
                return "airport"
            if armoury:
                return "armoury"
            return None

        (
            on_hitlist,
            message_counts,
            family_data,
            owns_casino,
            property_type,
            show_war_rat,
        ) = await asyncio.gather(
            _hitlist_on(),
            _message_counts(),
            _family(),
            _owns_casino(),
            _property_type(),
            _war_rat_badge_active(user),
        )
        messages_received, messages_sent = message_counts or (0, 0)
        family_display, family_emblem_preset_id, family_emblem_avatar_url = family_data or (None, None, None)

        _prestige_mult = float(user.get("prestige_rank_multiplier") or 1.0)
        _rp = int(user.get("rank_points") or 0)
        rank_id, rank_name = get_rank_info(_rp, _prestige_mult)
        _game_rank_name = rank_name
        if user_has_admin_list_email(user):
            rank_name = "Admin"
        elif _is_moderator(user):
            rank_name = "Moderator"
        elif user.get("is_help_desk_operator"):
            rank_name = f"(HDO) {_game_rank_name}"
        elif _is_entertainer(user):
            rank_name = f"(Entertainer) {_game_rank_name}"
        _prestige_level = int(user.get("prestige_level") or 0)
        _prestige_name = PRESTIGE_CONFIGS.get(_prestige_level, {}).get("name", "") if _prestige_level > 0 else ""
        _, wealth_name, wealth_color = get_wealth_rank(user.get("money", 0))
        hide_kills = bool(user.get("hide_kills_on_profile"))
        hide_jail = bool(user.get("hide_jailbusts_on_profile"))

        return {
            "username": user.get("username"),
            "avatar_url": resolve_player_avatar_url(user),
            "kills": None if hide_kills else effective_player_kill_count(user),
            "jail_busts": None if hide_jail else int(user.get("jail_busts") or 0),
            "on_hitlist": bool(on_hitlist),
            "messages_sent": messages_sent,
            "messages_received": messages_received,
            "family": family_display,
            "family_emblem_preset_id": family_emblem_preset_id,
            "family_emblem_avatar_url": family_emblem_avatar_url,
            "owns_casino": owns_casino,
            "property_type": property_type,
            "show_war_rat_badge": show_war_rat,
            "rank_name": rank_name,
            "rank": rank_id,
            "wealth_rank_name": wealth_name,
            "wealth_rank_color": wealth_color,
            "prestige_level": _prestige_level,
            "prestige_name": _prestige_name or None,
            "founding_member": bool(user.get("founding_member")),
            "modkill_wipe": bool(user.get("modkill_wipe")),
            **profile_cosmetic_public_fields(user),
        }

    @router.get("/users/{username}/profile")
    async def get_user_profile(
        username: str,
        include_honours: bool = Query(True),
        current_user: dict = Depends(get_current_user),
    ):
        """View a user's profile (requires auth). Pass include_honours=0 with GET .../profile/honours for faster parallel loads."""
        user = await _find_user_by_profile_username(username, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        _prestige_mult = float(user.get("prestige_rank_multiplier") or 1.0)
        rank_id, rank_name = get_rank_info(user.get("rank_points", 0), _prestige_mult)
        _game_rank_name = rank_name
        if user_has_admin_list_email(user):
            rank_name = "Admin"
        elif _is_moderator(user):
            rank_name = "Moderator"
        elif user.get("is_help_desk_operator"):
            rank_name = f"(HDO) {_game_rank_name}"
        elif _is_entertainer(user):
            rank_name = f"(Entertainer) {_game_rank_name}"
        _prestige_level = int(user.get("prestige_level") or 0)
        _prestige_name = PRESTIGE_CONFIGS.get(_prestige_level, {}).get("name", "") if _prestige_level > 0 else ""
        wealth_id, wealth_name, wealth_color = get_wealth_rank(user.get("money", 0))
        is_dead = bool(user.get("is_dead"))
        now_utc = datetime.now(timezone.utc)
        five_min_ago = now_utc - timedelta(minutes=5)
        ten_min_ago = now_utc - timedelta(minutes=10)
        
        # Determine status: "online", "idle", "offline", or "dead"
        status = "offline"
        online = False  # Keep for backward compatibility
        last_seen = user.get("last_seen")
        last_seen_dt = None
        if last_seen:
            try:
                last_seen_dt = datetime.fromisoformat(last_seen)
                if last_seen_dt.tzinfo is None:
                    last_seen_dt = last_seen_dt.replace(tzinfo=timezone.utc)
            except Exception:
                last_seen_dt = None
        
        # Check forced_online_until
        forced_online = False
        forced_until = user.get("forced_online_until")
        if forced_until:
            try:
                fu = datetime.fromisoformat(forced_until)
                if fu.tzinfo is None:
                    fu = fu.replace(tzinfo=timezone.utc)
                forced_online = now_utc < fu
            except Exception:
                pass
        
        if is_dead:
            status = "dead"
            online = False
        elif (user_has_admin_list_email(user) or user.get("is_moderator")) and user.get("admin_ghost_mode"):
            # Admin ghost mode - always offline
            status = "offline"
            online = False
        elif last_seen_dt and last_seen_dt >= five_min_ago:
            # Active within last 5 minutes - ONLINE
            status = "online"
            online = True
        elif forced_online:
            # Forced online by admin - ONLINE
            status = "online"
            online = True
        elif last_seen_dt and last_seen_dt >= ten_min_ago:
            # Active 5-10 minutes ago - IDLE
            status = "idle"
            online = False
        elif user.get("auto_rank_enabled") and not user.get("auto_rank_idle"):
            # Auto-rank enabled but not idle and user is offline - show as IDLE (bot keeping them in game)
            status = "idle"
            online = False
        else:
            # More than 10 minutes or auto_rank_idle - OFFLINE
            status = "offline"
            online = False
        wealth_range = get_wealth_rank_range(user.get("money", 0))
        user_id = user["id"]

        if include_honours:
            honours = await _build_profile_honours(user, is_dead)
        else:
            honours = []

        async def _casinos_for_type(game_type: str, coll, location_key: str = "city"):
            out = []
            cursor = coll.find(
                {"owner_id": user_id},
                {"_id": 0, "city": 1, "state": 1, "max_bet": 1, "buy_back_reward": 1, "expires_at": 1},
            )
            async for d in cursor:
                if game_type == "slots" and d.get("expires_at"):
                    try:
                        t = datetime.fromisoformat(d["expires_at"].replace("Z", "+00:00"))
                        if t.tzinfo is None:
                            t = t.replace(tzinfo=timezone.utc)
                        if datetime.now(timezone.utc) >= t:
                            continue
                    except Exception:
                        continue
                loc = d.get(location_key) or d.get("city") or "?"
                item = {"type": game_type, "city": loc, "max_bet": int(d.get("max_bet") or 0)}
                if d.get("buy_back_reward") is not None:
                    item["buy_back_reward"] = int(d.get("buy_back_reward") or 0)
                out.append(item)
            return out

        async def _family_name_and_tag():
            variants = _family_member_user_id_variants(user_id)
            memberships = await db.family_members.find(
                {"user_id": {"$in": variants}} if variants else {"user_id": user_id},
                {"_id": 0, "family_id": 1},
            ).to_list(100)
            member_fids = list(dict.fromkeys(
                str(m.get("family_id") or "").strip()
                for m in memberships
                if str(m.get("family_id") or "").strip()
            ))
            stored_fid = str(user.get("family_id") or "").strip()

            # Wiped crews retain family_members rows for their In Memoriam roster.
            # Only an active crew belongs on a live player profile. Prefer the
            # users.family_id row when valid, then recover from another active
            # membership if a historical wiped row was returned first.
            family_candidates = []
            if stored_fid and stored_fid in member_fids:
                family_candidates.append(stored_fid)
            family_candidates.extend(fid for fid in member_fids if fid not in family_candidates)

            fam = None
            for candidate_fid in family_candidates:
                fam = await db.families.find_one(
                    {"id": candidate_fid, "wiped": {"$ne": True}},
                    {"_id": 0, "id": 1, "name": 1, "tag": 1, "emblem_preset_id": 1, "avatar_url": 1},
                )
                if fam:
                    break

            # Self-heal stale active-family fields while preserving historical
            # family_members rows used by wiped crew memorial pages.
            if not fam:
                if user.get("family_id"):
                    await db.users.update_one(
                        {"id": {"$in": variants}} if len(variants) > 1 else {"id": user_id},
                        {"$set": {"family_id": None, "family_role": None}},
                    )
                return (None, None, None, None, None)
            fid = str(fam.get("id") or "").strip()
            if str(user.get("family_id") or "").strip() != str(fid).strip():
                await db.users.update_one(
                    {"id": {"$in": variants}} if len(variants) > 1 else {"id": user_id},
                    {"$set": {"family_id": str(fid)}},
                )
            pid = fam.get("emblem_preset_id")
            return (
                fid,
                fam.get("name"),
                fam.get("tag"),
                pid,
                None if pid else fam.get("avatar_url"),
            )

        async def _inbox_sent_message_counts():
            pipeline = [
                {
                    "$match": {
                        "user_id": user_id,
                        "notification_type": {"$in": ["user_message", "user_message_sent"]},
                    }
                },
                {"$group": {"_id": "$notification_type", "n": {"$sum": 1}}},
            ]
            received, sent = 0, 0
            async for doc in db.notifications.aggregate(pipeline):
                tid = doc.get("_id")
                n = int(doc.get("n") or 0)
                if tid == "user_message":
                    received = n
                elif tid == "user_message_sent":
                    sent = n
            return received, sent

        async def _empty_casino_list():
            return []

        (
            family_name_tag,
            dice_casinos,
            roulette_casinos,
            blackjack_casinos,
            horseracing_casinos,
            slots_casinos,
            videopoker_casinos,
            property_,
            garage_dealership,
            sports_betting,
            message_counts,
            top_cars,
            show_war_rat,
        ) = await asyncio.gather(
            _family_name_and_tag(),
            _casinos_for_type("dice", db.dice_ownership),
            _casinos_for_type("roulette", db.roulette_ownership),
            _casinos_for_type("blackjack", db.blackjack_ownership),
            _casinos_for_type("horseracing", db.horseracing_ownership),
            _casinos_for_type("slots", db.slots_ownership, "state") if SLOTS_FEATURE_ENABLED else _empty_casino_list(),
            _casinos_for_type("videopoker", db.videopoker_ownership),
            _user_owns_any_property(user_id),
            _user_owns_garage_dealership(user_id),
            _user_owns_sports_betting_book(user_id),
            _inbox_sent_message_counts(),
            _top_cars_for_profile(
                user_id,
                5,
                user.get("profile_show_cars", False),
                user.get("profile_car_ids") or (
                    [user.get("profile_featured_car_id")] if user.get("profile_featured_car_id") else []
                ),
            ),
            _war_rat_badge_active(user),
        )
        messages_received, messages_sent_count = message_counts

        (
            family_id,
            family_name,
            family_tag,
            family_emblem_preset_id,
            family_emblem_avatar_url,
        ) = family_name_tag or (None, None, None, None, None)

        from routers.game.achievements import compute_profile_badges
        achievement_badges = compute_profile_badges(user)
        owned_casinos = dice_casinos + roulette_casinos + blackjack_casinos + horseracing_casinos + slots_casinos + videopoker_casinos

        if property_ and user_id != current_user.get("id") and property_.get("type") == "airport":
            property_ = {k: v for k, v in property_.items() if k != "total_earnings"}
        if garage_dealership and user_id != current_user.get("id"):
            garage_dealership = {"type": "garage_dealership"}
        if sports_betting and user_id != current_user.get("id"):
            sports_betting = {"type": "sports_betting"}
        messages_sent = int(messages_sent_count or 0)

        # Own profile only if the requested profile is the current user (by id and by URL username)
        requested_username_norm = (username or "").strip().lower()
        current_username_norm = (current_user.get("username") or "").strip().lower()
        is_own_profile = (
            current_user.get("id") == user_id
            and requested_username_norm == current_username_norm
        )
        is_admin = user_has_admin_list_email(current_user)
        # When viewing another player's profile, hide last_seen (privacy). Account created is public.
        # owned_casinos and property are always shown for the profile subject (public who owns what)
        created_at = user.get("created_at")
        if not is_own_profile:
            last_seen = None
            # Hide human bodyguard contracts from other players; robot NPCs can expose
            # is_bodyguard so the client can show the robot dossier avatar.
            is_bodyguard_visible = bool(user.get("is_bodyguard") and user.get("is_npc"))
        else:
            is_bodyguard_visible = bool(user.get("is_bodyguard"))

        _raw_cc = (user.get("last_seen_country") or "").strip().upper()
        _profile_cc = _raw_cc if len(_raw_cc) == 2 and _raw_cc.isalpha() else None
        _show_country_flag = bool(user.get("show_country_flag_on_profile", False))

        avatar_url = resolve_player_avatar_url({**user, "id": user_id})

        out = {
            "id": user_id,
            "username": user["username"],
            "rank": rank_id,
            "rank_name": rank_name,
            "is_help_desk_operator": bool(user.get("is_help_desk_operator")),
            "is_entertainer": bool(user.get("is_entertainer")),
            "prestige_level": _prestige_level,
            "prestige_name": _prestige_name,
            "wealth_rank": wealth_id,
            "wealth_rank_name": wealth_name,
            "wealth_rank_color": wealth_color,
            "wealth_rank_range": wealth_range,
            "profile_country_code": _profile_cc if _show_country_flag and _profile_cc else None,
            "hide_kills_on_profile": bool(user.get("hide_kills_on_profile", False)),
            "hide_jailbusts_on_profile": bool(user.get("hide_jailbusts_on_profile", False)),
            "hide_leaderboard_username": bool(user.get("hide_leaderboard_username", False)),
            "kills": None if user.get("hide_kills_on_profile") else effective_player_kill_count(user),
            "jail_busts": None if user.get("hide_jailbusts_on_profile") else user.get("jail_busts", 0),
            "created_at": created_at,
            "avatar_url": avatar_url,
            "is_dead": is_dead,
            "is_npc": bool(user.get("is_npc")),
            "is_bodyguard": is_bodyguard_visible,
            "online": online,
            "status": status,  # "online", "idle", "offline", or "dead"
            "last_seen": last_seen,
            "family_id": family_id,
            "family_name": family_name,
            "family_tag": family_tag,
            "family_emblem_preset_id": family_emblem_preset_id,
            "family_emblem_avatar_url": family_emblem_avatar_url,
            "honours": honours,
            "owned_casinos": owned_casinos,
            "property": property_,
            "garage_dealership": garage_dealership,
            "sports_betting": sports_betting,
            "messages_sent": messages_sent,
            "messages_received": messages_received,
            "top_cars": top_cars or [],
            "show_cars_on_profile": user.get("profile_show_cars", False),
            "youtube_url": (user.get("profile_youtube_url") or "").strip() or None,
            "spotify_url": (user.get("profile_spotify_url") or "").strip() or None,
            "spotify_embed_url": (user.get("profile_spotify_embed_url") or "").strip() or None,
            "profile_banner_image_url": (user.get("profile_banner_image_url") or "").strip() or None,
            "profile_banner_text": (user.get("profile_banner_text") or "").strip() or None,
            "profile_notepad_color": _notepad_color_for_api_response(user.get("profile_notepad_color")),
            "badges": user.get("badges") or [],
            "founding_member": bool(user.get("founding_member")),
            "modkill_wipe": bool(user.get("modkill_wipe")),
            **profile_cosmetic_public_fields(user),
            "achievement_badges": achievement_badges,
        }
        wr_until = user.get("war_rat_badge_until")
        out["war_rat_badge_until"] = wr_until if show_war_rat else None
        out["show_war_rat_badge"] = show_war_rat
        if show_war_rat:
            b = list(out.get("badges") or [])
            if "Rat" not in b:
                b.append("Rat")
            out["badges"] = b
        if is_own_profile:
            out["show_country_flag_on_profile"] = _show_country_flag
            out["last_seen_country"] = _profile_cc
        if not is_own_profile:
            for key in (
                "last_seen",
                "top_cars",
                "show_cars_on_profile",
                "youtube_url",
                "hide_kills_on_profile",
                "hide_jailbusts_on_profile",
                "hide_leaderboard_username",
            ):
                if key in ("top_cars",):
                    out[key] = []
                elif key in ("prestige_level",):
                    out[key] = 0
                elif key == "prestige_name":
                    out[key] = ""
                elif key in (
                    "hide_kills_on_profile",
                    "hide_jailbusts_on_profile",
                    "hide_leaderboard_username",
                ):
                    out[key] = False  # don't expose other users' hide prefs
                else:
                    out[key] = None
        # Only include admin_stats when viewing your own profile (never for other users, so it never appears in Network)
        if is_admin and is_own_profile:
            today_utc = datetime.now(timezone.utc).date().isoformat()
            booze_today = user.get("booze_profit_today", 0) if user.get("booze_profit_today_date") == today_utc else 0
            out["admin_stats"] = {
                "money": int(user.get("money") or 0),
                "points": int(user.get("points") or 0),
                "respect_points": int(user.get("respect_points") or 0),
                "bullets": int(user.get("bullets") or 0),
                "booze_profit_today": booze_today,
                "booze_profit_total": int(user.get("booze_profit_total") or 0),
                "rank_points": int(user.get("rank_points") or 0),
                "current_state": user.get("current_state") or "—",
                "in_jail": bool(user.get("in_jail")),
            }
        # Only include admin_online_color when viewing own profile (frontend uses auth/me when viewing others)
        if is_own_profile:
            admin_color_doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
            admin_online_color = (admin_color_doc.get("value") or "#a78bfa") if admin_color_doc else "#a78bfa"
            if not isinstance(admin_online_color, str) or not admin_online_color.strip():
                admin_online_color = "#a78bfa"
            out["admin_online_color"] = admin_online_color.strip()
        # Include mod_online_color when the viewed user is a moderator (for badge styling on profile)
        if _is_moderator(user):
            raw = (user.get("mod_online_color") or "").strip() or MOD_ONLINE_COLOR_DEFAULT
            out["mod_online_color"] = raw if raw.startswith("#") and len(raw) <= 9 else MOD_ONLINE_COLOR_DEFAULT
        if _is_entertainer(user):
            from utils.entertainer_service import ENTERTAINER_ONLINE_COLOR_DEFAULT as _ENT_COL

            raw_e = (user.get("entertainer_online_color") or "").strip() or _ENT_COL
            out["entertainer_online_color"] = raw_e if raw_e.startswith("#") and len(raw_e) <= 9 else _ENT_COL
        if _is_hdo(user):
            _hdo_def = "#166534"
            raw_h = (user.get("hdo_online_color") or "").strip() or _hdo_def
            out["hdo_online_color"] = raw_h if raw_h.startswith("#") and len(raw_h) <= 9 else _hdo_def
        # Hitlist banner: dead accounts cannot keep active user/bodyguard contracts.
        hitlist_query = {"target_id": user_id, "target_type": {"$in": ["user", "bodyguards"]}}
        if user.get("is_dead"):
            killer_id = (user.get("killed_by_user_id") or "").strip()
            if killer_id:
                await resolve_user_hitlist_kill(
                    db,
                    killer_id=killer_id,
                    killer_username=(user.get("killed_by_username") or "Unknown"),
                    victim_id=user_id,
                    victim_username=(user.get("username") or "Unknown"),
                )
            else:
                await db.hitlist.delete_many(hitlist_query)
            hitlist_entries = []
        else:
            hitlist_entries = await db.hitlist.find(
                hitlist_query,
                {"_id": 0, "reward_type": 1, "reward_amount": 1},
            ).to_list(100)
        hitlist_cash = sum(int(e.get("reward_amount") or 0) for e in hitlist_entries if e.get("reward_type") == "cash")
        hitlist_points = sum(int(e.get("reward_amount") or 0) for e in hitlist_entries if e.get("reward_type") == "points")
        out["hitlist_on"] = len(hitlist_entries) > 0
        out["hitlist_total_cash"] = hitlist_cash
        out["hitlist_total_points"] = hitlist_points
        out["hitlist_count"] = len(hitlist_entries)
        return out

    def _safe_int(v, default=0):
        try:
            if v is None:
                return default
            return int(float(v))
        except (ValueError, TypeError):
            return default

    def _safe_float(v, default=1.0):
        try:
            if v is None:
                return default
            return float(v)
        except (ValueError, TypeError):
            return default

    def _to_json_safe(v):
        """Ensure value is JSON-serializable (datetime, ObjectId, etc.)."""
        if v is None:
            return None
        if isinstance(v, (bool, int, float, str)):
            return v
        try:
            if hasattr(v, "isoformat"):  # datetime
                return v.isoformat() if v.tzinfo else v.replace(tzinfo=timezone.utc).isoformat()
        except Exception:
            pass
        return str(v)

    @router.get("/users/{username}/staff-stats")
    async def get_user_staff_stats(username: str, current_user: dict = Depends(get_current_user)):
        """Extended stats for a user. Admin or moderator only. Used in profile page 'User info' dropdown."""
        if not _is_admin(current_user) and not _is_moderator(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        require_staff_issued_if_staff_capable(current_user)
        username_pattern = _username_pattern(username)
        if not username_pattern:
            raise HTTPException(status_code=400, detail="Invalid username")
        try:
            user = await db.users.find_one(
                {"username": username_pattern},
                {
                    "_id": 0,
                    "id": 1, "username": 1, "email": 1, "email_before_freed": 1, "email_freed_at": 1,
                    "created_at": 1, "last_seen": 1, "dead_at": 1,
                    "money": 1, "points": 1, "rank_points": 1, "bullets": 1, "armour_level": 1,
                    "total_kills": 1, "total_deaths": 1, "total_crimes": 1, "total_gta": 1, "jail_busts": 1,
                    "current_state": 1, "in_jail": 1, "is_dead": 1, "family_id": 1,
                    "prestige_level": 1, "prestige_rank_multiplier": 1,
                    "account_locked": 1, "account_locked_at": 1,
                    "registration_ip": 1, "last_login_ip": 1, "login_ips": 1,
                    "is_moderator": 1, "is_help_desk_operator": 1,
                },
            )
        except Exception as e:
            logger.exception("staff-stats find_one failed: %s", e)
            raise HTTPException(status_code=500, detail="Error loading user data. Please try again.")
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        try:
            rank_id, rank_name = get_rank_info(
                _safe_int(user.get("rank_points")),
                _safe_float(user.get("prestige_rank_multiplier"), 1.0),
            )
        except Exception as e:
            logger.warning("staff-stats get_rank_info failed: %s", e)
            rank_id, rank_name = 1, "Street Punk"
        if user_has_admin_list_email(user):
            rank_name = "Admin"
        elif user.get("is_moderator"):
            rank_name = "Moderator"
        elif user.get("is_help_desk_operator"):
            rank_name = f"(HDO) {rank_name}"
        family_name = None
        if user.get("family_id"):
            try:
                uid = user.get("id")
                variants = _family_member_user_id_variants(uid)
                member = await db.family_members.find_one(
                    {"user_id": {"$in": variants}} if variants else {"user_id": uid},
                    {"_id": 0, "family_id": 1},
                )
                fid = (member or {}).get("family_id")
                if not fid:
                    await db.users.update_one(
                        {"id": {"$in": variants}} if len(variants) > 1 else {"id": uid},
                        {"$set": {"family_id": None, "family_role": None}},
                    )
                    fid = None
                fam = await db.families.find_one({"id": str(fid)}, {"_id": 0, "name": 1}) if fid else None
                if fam:
                    family_name = fam.get("name")
            except Exception as e:
                logger.warning("staff-stats family lookup failed: %s", e)
        last_login_ip = user.get("last_login_ip")
        if last_login_ip is None and user.get("login_ips"):
            ips = user.get("login_ips") or []
            last_login_ip = ips[-1] if ips else None
        try:
            from utils.staff_email_history import resolve_staff_email_context

            staff_email = await resolve_staff_email_context(db, user)
            return {
                "id": _to_json_safe(user.get("id")) or str(user.get("id", "")),
                "username": str(user.get("username") or ""),
                "email": str(user.get("email") or ""),
                "staff_email": staff_email,
                "created_at": _to_json_safe(user.get("created_at")),
                "last_seen": _to_json_safe(user.get("last_seen")),
                "money": _safe_int(user.get("money")),
                "points": _safe_int(user.get("points")),
                "rank_points": _safe_int(user.get("rank_points")),
                "rank_id": rank_id,
                "rank_name": str(rank_name or ""),
                "bullets": _safe_int(user.get("bullets")),
                "armour_level": _safe_int(user.get("armour_level")),
                "total_kills": _safe_int(user.get("total_kills")),
                "total_deaths": _safe_int(user.get("total_deaths")),
                "total_crimes": _safe_int(user.get("total_crimes")),
                "total_gta": _safe_int(user.get("total_gta")),
                "jail_busts": _safe_int(user.get("jail_busts")),
                "current_state": str(user.get("current_state") or "—")[:100],
                "in_jail": bool(user.get("in_jail")),
                "is_dead": bool(user.get("is_dead")),
                "family_name": str(family_name) if family_name else None,
                "prestige_level": _safe_int(user.get("prestige_level")),
                "account_locked": bool(user.get("account_locked")),
                "account_locked_at": _to_json_safe(user.get("account_locked_at")),
                "registration_ip": str(user.get("registration_ip")) if user.get("registration_ip") else None,
                "last_login_ip": str(last_login_ip) if last_login_ip else None,
            }
        except Exception as e:
            logger.exception("staff-stats build response failed: %s", e)
            raise HTTPException(status_code=500, detail="Error loading user data. Please try again.")

    # Allowed image MIME types for avatars (NO SVG - can contain XSS)
    AVATAR_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
    AVATAR_MAX_BYTES = int(1.2 * 1024 * 1024)  # data URL string length (~1.2 MiB)
    # Raw multipart body stays under typical nginx default client_max_body_size (1m) including boundaries.
    AVATAR_RAW_UPLOAD_MAX_BYTES = (1024 * 1024) - 65_536

    def _sniff_image_mime_from_bytes(data: bytes) -> Optional[str]:
        if len(data) < 12:
            return None
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
            return "image/gif"
        if data.startswith(b"RIFF") and b"WEBP" in data[:12]:
            return "image/webp"
        return None

    def _validate_avatar_data_url(data_url: str) -> tuple[bool, str]:
        """
        Validate avatar data URL for security.
        Returns (is_valid, error_message).
        """
        import base64
        import re

        if not data_url:
            return False, "No data provided"

        # Must start with data:image/
        if not data_url.startswith("data:image/"):
            return False, "Avatar must be an image data URL"

        # Parse the data URL: data:image/TYPE;base64,DATA
        match = re.match(r"^data:(image/[a-zA-Z0-9+-]+);base64,(.+)$", data_url)
        if not match:
            return False, "Invalid data URL format. Must be base64 encoded."

        mime_type = match.group(1).lower()
        base64_data = match.group(2)

        # Block SVG (can contain JavaScript/XSS attacks)
        if "svg" in mime_type:
            return False, "SVG images are not allowed for security reasons"

        # Whitelist allowed MIME types
        if mime_type not in AVATAR_ALLOWED_TYPES:
            return False, f"Invalid image type. Allowed: JPEG, PNG, GIF, WEBP"

        # Validate base64 string (only valid base64 characters)
        if not re.match(r"^[A-Za-z0-9+/=]+$", base64_data):
            return False, "Invalid base64 encoding"

        # Try to decode base64 to ensure it's valid
        try:
            decoded = base64.b64decode(base64_data)
        except Exception:
            return False, "Failed to decode base64 data"

        # Verify magic bytes match claimed MIME type
        magic_bytes = {
            "image/jpeg": [b"\xff\xd8\xff"],
            "image/png": [b"\x89PNG\r\n\x1a\n"],
            "image/gif": [b"GIF87a", b"GIF89a"],
            "image/webp": [b"RIFF"],  # RIFF header, followed by WEBP
        }

        valid_magic = False
        for magic in magic_bytes.get(mime_type, []):
            if decoded.startswith(magic):
                valid_magic = True
                break

        if not valid_magic:
            return False, "Image data does not match declared type"

        # Additional check for WEBP (must have WEBP after RIFF)
        if mime_type == "image/webp" and b"WEBP" not in decoded[:12]:
            return False, "Invalid WEBP image data"

        return True, ""

    @router.post("/profile/avatar")
    async def update_avatar(request: AvatarUpdateRequest, current_user: dict = Depends(get_current_user)):
        """Update your avatar (stored as a data URL)."""
        avatar = (request.avatar_data or "").strip()

        # Handle removal
        if not avatar:
            await db.users.update_one(
                {"id": current_user.get("id") or ""},
                {"$set": {"avatar_url": None}},
            )
            return {"message": "Avatar removed"}

        # Size check first (before expensive validation)
        if len(avatar) > AVATAR_MAX_BYTES:
            raise HTTPException(status_code=400, detail="Avatar too large. Use a smaller image (max ~1.2MB).")

        # Security validation
        is_valid, error_msg = _validate_avatar_data_url(avatar)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)

        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$set": {"avatar_url": avatar}}
        )
        return {"message": "Avatar updated"}

    @router.post("/profile/avatar/file")
    async def update_avatar_file(
        file: UploadFile = File(...),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Upload avatar as raw image bytes (multipart). Prefer this for GIFs: JSON+base64 inflates the
        body past typical nginx client_max_body_size (1m) and returns 413 before the API runs.
        Stored value is still a validated data URL on the user document.
        """
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="No file uploaded")
        if len(raw) > AVATAR_RAW_UPLOAD_MAX_BYTES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"File too large for this upload method (max about {AVATAR_RAW_UPLOAD_MAX_BYTES // 1024}KB raw). "
                    "Try a smaller image, or ask the host to raise nginx client_max_body_size."
                ),
            )
        mime = _sniff_image_mime_from_bytes(raw)
        if mime is None or mime not in AVATAR_ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail="Invalid image type. Use JPEG, PNG, GIF, or WEBP.")
        if mime != "image/gif":
            raise HTTPException(
                status_code=400,
                detail="This upload path is only for GIF avatars. Use the normal image upload for JPEG, PNG, or WEBP.",
            )
        b64 = base64.b64encode(raw).decode("ascii")
        avatar = f"data:{mime};base64,{b64}"
        if len(avatar) > AVATAR_MAX_BYTES:
            raise HTTPException(status_code=400, detail="Avatar too large after encoding. Use a smaller GIF (max ~1.2MB).")
        is_valid, error_msg = _validate_avatar_data_url(avatar)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$set": {"avatar_url": avatar}},
        )
        return {"message": "Avatar updated"}

    @router.post("/profile/custom-badge")
    async def update_custom_badge(request: CustomBadgeUpdateRequest, current_user: dict = Depends(get_current_user)):
        """Upload or clear custom profile badge image. Requires purchased custom_profile_badge entitlement."""
        from utils.profile_cosmetics import (
            CUSTOM_BADGE_MAX_DATA_URL_BYTES,
            user_has_custom_profile_badge,
        )

        if not user_has_custom_profile_badge(current_user):
            raise HTTPException(
                status_code=403,
                detail="Buy the Custom Profile Badge from the Points Store first.",
            )
        badge = (request.badge_data or "").strip()
        if not badge:
            await db.users.update_one(
                {"id": current_user.get("id") or ""},
                {"$set": {"custom_profile_badge_url": None}},
            )
            return {"message": "Custom badge image removed", "custom_profile_badge_url": None}

        if len(badge) > CUSTOM_BADGE_MAX_DATA_URL_BYTES:
            raise HTTPException(
                status_code=400,
                detail="Badge image too large. Use a small PNG/JPEG/WEBP/GIF (under ~250KB).",
            )
        is_valid, error_msg = _validate_avatar_data_url(badge)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$set": {"custom_profile_badge_url": badge}},
        )
        return {"message": "Custom badge updated", "custom_profile_badge_url": badge}

    class ProfileGlowUpdateRequest(BaseModel):
        preset_id: str = "violet"

    @router.patch("/profile/glow")
    async def update_profile_glow(request: ProfileGlowUpdateRequest, current_user: dict = Depends(get_current_user)):
        """Free colour change for permanent Name Glow + Border owners (no points)."""
        from utils.profile_cosmetics import sanitize_glow_preset

        if not current_user.get("profile_cosmetic_permanent"):
            raise HTTPException(
                status_code=403,
                detail="Buy permanent Name Glow + Border from the Points Store first. Timed glows pick colour when purchased.",
            )
        preset = sanitize_glow_preset(request.preset_id)
        await db.users.update_one(
            {"id": current_user.get("id") or "", "profile_cosmetic_permanent": True},
            {
                "$set": {
                    "profile_name_glow_color": preset["color"],
                    "profile_border_style": preset["border"],
                }
            },
        )
        return {
            "message": "Glow colour updated",
            "profile_name_glow_color": preset["color"],
            "profile_border_style": preset["border"],
            "profile_cosmetic_permanent": True,
            "profile_cosmetic_active": True,
        }

    @router.get("/profile/theme")
    async def get_profile_theme(current_user: dict = Depends(get_current_user)):
        """Get current user's theme preferences (PC vs mobile stored separately; legacy theme_preferences is fallback)."""
        return _theme_response_payload(current_user)

    @router.patch("/profile/theme")
    async def update_profile_theme(request: ThemePreferencesRequest, current_user: dict = Depends(get_current_user)):
        """Save theme preferences to DB so they sync across devices. Only provided keys are updated. Null = clear."""
        updates = request.model_dump(exclude_unset=True)
        theme_platform_raw = updates.pop("theme_platform", None)
        if theme_platform_raw is None:
            platform = "pc"
        else:
            platform = str(theme_platform_raw).strip().lower()
            if platform not in ("pc", "mobile"):
                raise HTTPException(status_code=400, detail="theme_platform must be 'pc' or 'mobile'")
        if not updates:
            return {"message": "No theme updates", **_theme_response_payload(current_user)}
        key_map = {
            "colour_id": "colourId",
            "texture_id": "textureId",
            "button_colour_id": "buttonColourId",
            "accent_line_colour_id": "accentLineColourId",
            "font_id": "fontId",
            "button_style_id": "buttonStyleId",
            "writing_colour_id": "writingColourId",
            "muted_writing_colour_id": "mutedWritingColourId",
            "toast_text_colour_id": "toastTextColourId",
            "text_style_id": "textStyleId",
            "theme_variant": "themeVariant",
            "custom_themes": "customThemes",
            "sidebar_layout": "sidebarLayout",
            "mobile_nav_style": "mobileNavStyle",
            "mobile_stats_display": "mobileStatsDisplay",
            "mobile_layout_id": "mobileLayoutId",
            "game_chat_visible": "gameChatVisible",
            "button_shape_id": "buttonShapeId",
            "top_bar_gap": "topBarGap",
            "top_bar_size": "topBarSize",
            "top_bar_chip_width_scale": "topBarChipWidthScale",
            "top_bar_chip_height_scale": "topBarChipHeightScale",
            "sidebar_show_dividers": "sidebarShowDividers",
            "bottom_nav_show_dividers": "bottomNavShowDividers",
            "sidebar_divider_style": "sidebarDividerStyle",
            "sidebar_spacing": "sidebarSpacing",
            "toast_position": "toastPosition",
            "toast_close_button": "toastCloseButton",
            "kill_toast_style": "killToastStyle",
            "toast_custom_x": "toastCustomX",
            "toast_custom_y": "toastCustomY",
            "top_bar_stat_order": "topBarStatOrder",
            "notification_ball_position": "notificationBallPosition",
        }
        stored = {key_map.get(k, k): v for k, v in updates.items()}
        tbg = stored.get("topBarGap")
        if tbg is not None and tbg not in ("compact", "normal", "spread"):
            raise HTTPException(status_code=400, detail="Invalid top_bar_gap")
        tbs = stored.get("topBarSize")
        if tbs is not None and tbs not in ("small", "medium", "large"):
            raise HTTPException(status_code=400, detail="Invalid top_bar_size")
        for chip_key in ("topBarChipWidthScale", "topBarChipHeightScale"):
            cv = stored.get(chip_key)
            if cv is not None and (not isinstance(cv, int) or cv < _CHIP_SCALE_MIN or cv > _CHIP_SCALE_MAX):
                raise HTTPException(status_code=400, detail=f"Invalid {chip_key}")
        sds = stored.get("sidebarDividerStyle")
        if sds is not None and sds not in ("solid", "dotted", "dashed"):
            raise HTTPException(status_code=400, detail="Invalid sidebar_divider_style")
        ssp = stored.get("sidebarSpacing")
        if ssp is not None and ssp not in ("compact", "normal", "relaxed"):
            raise HTTPException(status_code=400, detail="Invalid sidebar_spacing")
        tp = stored.get("toastPosition")
        if tp is not None and tp not in _VALID_TOAST_POSITIONS:
            raise HTTPException(status_code=400, detail="Invalid toast_position")
        kts = stored.get("killToastStyle")
        if kts is not None and kts not in ("banner", "popup"):
            raise HTTPException(status_code=400, detail="Invalid kill_toast_style")
        tcx, tcy = stored.get("toastCustomX"), stored.get("toastCustomY")
        if tcx is not None and not isinstance(tcx, int):
            raise HTTPException(status_code=400, detail="Invalid toast_custom_x")
        if tcy is not None and not isinstance(tcy, int):
            raise HTTPException(status_code=400, detail="Invalid toast_custom_y")
        tso = stored.get("topBarStatOrder")
        if tso is not None:
            if not isinstance(tso, list) or not tso or not all(isinstance(s, str) and s in _VALID_TOPBAR_STAT_IDS for s in tso):
                raise HTTPException(status_code=400, detail="Invalid top_bar_stat_order")
            if len(tso) != len(set(tso)):
                raise HTTPException(status_code=400, detail="Invalid top_bar_stat_order")
        nbp = stored.get("notificationBallPosition")
        if nbp is not None:
            if not isinstance(nbp, dict):
                raise HTTPException(status_code=400, detail="Invalid notification_ball_position")
            nx, ny = nbp.get("x"), nbp.get("y")
            if not isinstance(nx, int) or not isinstance(ny, int):
                raise HTTPException(status_code=400, detail="Invalid notification_ball_position")
            if nx < 0 or ny < 0 or nx > 32000 or ny > 32000:
                raise HTTPException(status_code=400, detail="Invalid notification_ball_position")
        mns = stored.get("mobileNavStyle")
        if mns is not None and mns not in ("bottom", "sidebar"):
            raise HTTPException(status_code=400, detail="Invalid mobile_nav_style")
        msd = stored.get("mobileStatsDisplay")
        if msd is not None and msd not in ("top_bar", "touch_ball", "right_sidebar"):
            raise HTTPException(status_code=400, detail="Invalid mobile_stats_display")
        mld = stored.get("mobileLayoutId")
        if mld is not None and mld not in ("classic", "pocket_deck"):
            raise HTTPException(status_code=400, detail="Invalid mobile_layout_id")
        field = "theme_preferences_pc" if platform == "pc" else "theme_preferences_mobile"
        base = _theme_bucket_prefs(current_user, platform_pc=(platform == "pc"))
        new_prefs = {**base, **stored}
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {field: new_prefs}},
        )
        merged_user = dict(current_user)
        merged_user[field] = new_prefs
        return {"message": "Theme saved", "theme_platform": platform, **_theme_response_payload(merged_user)}

    DEFAULT_SECTION_ORDER = [
        "command_status",
        "daily_ops",
        "intel_assets",
        "auto_rank",
        "routes",
    ]
    DEFAULT_AT_A_GLANCE_STATS = ["money", "health", "bullets", "location", "rank", "kills"]
    VALID_SECTION_IDS = set(DEFAULT_SECTION_ORDER)
    LEGACY_SECTION_MAP = {
        "rank_progress": "command_status",
        "at_a_glance": "command_status",
        "rewards_objectives": "daily_ops",
        "notifications_event": "intel_assets",
        "bodyguards_properties": "intel_assets",
        "auto_rank": "auto_rank",
        "go_to": "routes",
        "command_status": "command_status",
        "daily_ops": "daily_ops",
        "intel_assets": "intel_assets",
        "routes": "routes",
    }

    def _normalize_dashboard_section_order(order):
        """Map legacy section IDs → current set; preserve first-seen order; append missing defaults."""
        seen = set()
        out = []
        for raw in order or []:
            if not isinstance(raw, str):
                continue
            mapped = LEGACY_SECTION_MAP.get(raw) or (raw if raw in VALID_SECTION_IDS else None)
            if not mapped or mapped in seen:
                continue
            seen.add(mapped)
            out.append(mapped)
        for sid in DEFAULT_SECTION_ORDER:
            if sid not in seen:
                out.append(sid)
        return out

    @router.get("/profile/dashboard")
    async def get_profile_dashboard(current_user: dict = Depends(get_current_user)):
        """Get dashboard layout preferences. Returns defaults if never set."""
        prefs = current_user.get("dashboard_preferences") or {}
        return {
            "section_order": _normalize_dashboard_section_order(prefs.get("section_order")),
            "at_a_glance_visible": prefs.get("at_a_glance_visible", True),
            "at_a_glance_stats": prefs.get("at_a_glance_stats") or DEFAULT_AT_A_GLANCE_STATS,
        }

    @router.patch("/profile/dashboard")
    async def update_profile_dashboard(request: DashboardPreferencesRequest, current_user: dict = Depends(get_current_user)):
        """Save dashboard preferences to DB so they sync across devices. Only provided keys are updated."""
        updates = request.model_dump(exclude_unset=True)
        if not updates:
            prefs = current_user.get("dashboard_preferences") or {}
            return {
                "message": "No dashboard updates",
                "section_order": _normalize_dashboard_section_order(prefs.get("section_order")),
                "at_a_glance_visible": prefs.get("at_a_glance_visible", True),
                "at_a_glance_stats": prefs.get("at_a_glance_stats") or DEFAULT_AT_A_GLANCE_STATS,
            }
        valid_stat_ids = {"money", "rank", "wealth", "rp", "location", "kills", "health", "bullets"}
        if "section_order" in updates:
            order = updates["section_order"]
            if not isinstance(order, list) or not all(isinstance(s, str) for s in order):
                raise HTTPException(status_code=400, detail="Invalid section_order")
            # Accept legacy or new IDs; normalize before save.
            normalized = _normalize_dashboard_section_order(order)
            if set(normalized) != VALID_SECTION_IDS:
                raise HTTPException(status_code=400, detail="section_order must contain all section IDs exactly once")
            updates["section_order"] = normalized
        if "at_a_glance_stats" in updates:
            stats = updates["at_a_glance_stats"]
            if not isinstance(stats, list) or not all(isinstance(s, str) and s in valid_stat_ids for s in stats):
                raise HTTPException(status_code=400, detail="Invalid at_a_glance_stats")
        new_prefs = {**(current_user.get("dashboard_preferences") or {}), **updates}
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"dashboard_preferences": new_prefs}},
        )
        return {
            "message": "Dashboard preferences saved",
            "section_order": _normalize_dashboard_section_order(new_prefs.get("section_order")),
            "at_a_glance_visible": new_prefs.get("at_a_glance_visible", True),
            "at_a_glance_stats": new_prefs.get("at_a_glance_stats") or DEFAULT_AT_A_GLANCE_STATS,
        }

    @router.post("/profile/change-password")
    async def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
        """Change password for the logged-in user. Requires current password."""
        if len(request.new_password) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "password_hash": 1})
        if not user or not verify_password(request.current_password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"password_hash": get_password_hash(request.new_password), "sessions": []}, "$inc": {"token_version": 1}}
        )
        return {"message": "Password changed successfully"}

    @router.get("/profile/telegram")
    async def get_profile_telegram(current_user: dict = Depends(get_current_user)):
        """Get Telegram chat ID and optional bot token (for Auto Rank). Chat ID from @userinfobot; bot token from @BotFather if you use your own bot."""
        return {
            "telegram_chat_id": current_user.get("telegram_chat_id"),
            "telegram_bot_token": current_user.get("telegram_bot_token"),
        }

    @router.patch("/profile/telegram")
    async def update_profile_telegram(
        current_user: dict = Depends(get_current_user),
        telegram_chat_id: Optional[str] = Body(None, embed=True),
        telegram_bot_token: Optional[str] = Body(None, embed=True),
    ):
        """Set or clear Telegram chat ID and/or bot token. Chat ID from @userinfobot. Bot token from @BotFather (optional; if set, your bot is used for Auto Rank notifications)."""
        from middleware.security import is_valid_telegram_bot_token
        updates = {}
        if telegram_chat_id is not None:
            updates["telegram_chat_id"] = (telegram_chat_id or "").strip() or None
        if telegram_bot_token is not None:
            val = (telegram_bot_token or "").strip() or None
            if val and not is_valid_telegram_bot_token(val):
                raise HTTPException(status_code=400, detail="Invalid bot token. Use only the token from @BotFather (format: 123456789:ABCdef...), not the full message.")
            updates["telegram_bot_token"] = val
        if not updates:
            doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "telegram_chat_id": 1, "telegram_bot_token": 1})
            return {"message": "Telegram settings unchanged", "telegram_chat_id": doc.get("telegram_chat_id"), "telegram_bot_token": doc.get("telegram_bot_token")}
        await db.users.update_one({"id": current_user["id"]}, {"$set": updates})
        doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "telegram_chat_id": 1, "telegram_bot_token": 1})
        return {"message": "Telegram settings updated", "telegram_chat_id": doc.get("telegram_chat_id"), "telegram_bot_token": doc.get("telegram_bot_token")}

    @router.get("/profile/youtube")
    async def get_profile_youtube(current_user: dict = Depends(get_current_user)):
        """Get profile YouTube URL for embed."""
        return {"youtube_url": (current_user.get("profile_youtube_url") or "").strip() or None}

    @router.patch("/profile/youtube")
    async def update_profile_youtube(
        current_user: dict = Depends(get_current_user),
        youtube_url: Optional[str] = Body(None, embed=True),
    ):
        """Set or clear the YouTube video URL shown on your profile (auto-plays when present)."""
        uid = current_user["id"]
        val = (youtube_url or "").strip() or None
        await db.users.update_one({"id": uid}, {"$set": {"profile_youtube_url": val}})
        return {"message": "YouTube URL updated", "youtube_url": val}

    @router.get("/profile/spotify/status")
    async def get_profile_spotify_status(current_user: dict = Depends(get_current_user)):
        allowed = await _spotify_feature_allowed(current_user)
        client_id, client_secret, redirect_uri = _spotify_env()
        oauth_configured = bool(client_id and client_secret and redirect_uri)
        return {
            "feature_enabled": allowed,
            "oauth_configured": oauth_configured,
            "spotify_connected": bool(current_user.get("spotify_connected")),
            "spotify_display_name": (current_user.get("spotify_display_name") or "").strip() or None,
            "spotify_user_id": (current_user.get("spotify_user_id") or "").strip() or None,
            "spotify_access_token_expires_at": current_user.get("spotify_access_token_expires_at"),
            "spotify_url": (current_user.get("profile_spotify_url") or "").strip() or None,
            "spotify_embed_url": (current_user.get("profile_spotify_embed_url") or "").strip() or None,
        }

    @router.patch("/profile/spotify/embed")
    async def update_profile_spotify_embed(body: SpotifyEmbedUpdateBody, current_user: dict = Depends(get_current_user)):
        if not await _spotify_feature_allowed(current_user):
            raise HTTPException(status_code=403, detail="Spotify feature is currently disabled.")
        uid = current_user["id"]
        raw = (body.spotify_url or "").strip()
        if not raw:
            await db.users.update_one(
                {"id": uid},
                {"$set": {"profile_spotify_url": None, "profile_spotify_uri": None, "profile_spotify_embed_url": None}},
            )
            return {"message": "Spotify embed cleared", "spotify_url": None, "spotify_embed_url": None, "spotify_uri": None}

        uri, embed_url, public_url, _typ, _sid = _spotify_normalize_url_or_uri(raw)
        await db.users.update_one(
            {"id": uid},
            {"$set": {"profile_spotify_url": public_url, "profile_spotify_uri": uri, "profile_spotify_embed_url": embed_url}},
        )
        return {
            "message": "Spotify embed updated",
            "spotify_url": public_url,
            "spotify_embed_url": embed_url,
            "spotify_uri": uri,
        }

    @router.get("/profile/spotify/connect-url")
    async def get_profile_spotify_connect_url(current_user: dict = Depends(get_current_user)):
        if not await _spotify_feature_allowed(current_user):
            raise HTTPException(status_code=403, detail="Spotify feature is currently disabled.")
        client_id, client_secret, redirect_uri = _spotify_env()
        if not client_id or not client_secret or not redirect_uri:
            raise HTTPException(status_code=503, detail="Spotify OAuth is not configured on the server.")
        state = secrets.token_urlsafe(24)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"spotify_oauth_state": state, "spotify_oauth_state_created_at": datetime.now(timezone.utc).isoformat()}},
        )
        query = urlencode(
            {
                "response_type": "code",
                "client_id": client_id,
                "scope": SPOTIFY_OAUTH_SCOPE,
                "redirect_uri": redirect_uri,
                "state": state,
            }
        )
        return {"url": f"https://accounts.spotify.com/authorize?{query}"}

    @router.post("/profile/spotify/oauth-callback")
    async def spotify_oauth_callback(body: SpotifyOAuthCallbackBody, current_user: dict = Depends(get_current_user)):
        if not await _spotify_feature_allowed(current_user):
            raise HTTPException(status_code=403, detail="Spotify feature is currently disabled.")
        expected_state = (current_user.get("spotify_oauth_state") or "").strip()
        if not expected_state or expected_state != (body.state or "").strip():
            raise HTTPException(status_code=400, detail="Invalid Spotify OAuth state.")
        issued_at = current_user.get("spotify_oauth_state_created_at")
        if issued_at:
            try:
                issued_dt = datetime.fromisoformat(str(issued_at).replace("Z", "+00:00"))
                if issued_dt.tzinfo is None:
                    issued_dt = issued_dt.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - issued_dt > timedelta(minutes=15):
                    raise HTTPException(status_code=400, detail="Spotify OAuth state expired. Please reconnect.")
            except HTTPException:
                raise
            except Exception:
                pass

        tok = await _spotify_exchange_code_for_tokens(body.code)
        access_token = (tok.get("access_token") or "").strip()
        if not access_token:
            raise HTTPException(status_code=400, detail="Spotify did not return an access token.")
        refresh_token = (tok.get("refresh_token") or "").strip()
        expires_in = int(tok.get("expires_in") or 3600)

        profile_user_id = None
        profile_display_name = None
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                me_res = await client.get(
                    "https://api.spotify.com/v1/me",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            if me_res.status_code < 400:
                me_data = me_res.json() if me_res.content else {}
                profile_user_id = (me_data.get("id") or "").strip() or None
                profile_display_name = (me_data.get("display_name") or "").strip() or None
        except Exception:
            pass

        updates = {
            "spotify_connected": True,
            "spotify_access_token": access_token,
            "spotify_access_token_expires_at": (datetime.now(timezone.utc) + timedelta(seconds=max(60, expires_in))).isoformat(),
            "spotify_oauth_state": None,
            "spotify_oauth_state_created_at": None,
        }
        if refresh_token:
            updates["spotify_refresh_token"] = refresh_token
        if profile_user_id is not None:
            updates["spotify_user_id"] = profile_user_id
        if profile_display_name is not None:
            updates["spotify_display_name"] = profile_display_name

        await db.users.update_one({"id": current_user["id"]}, {"$set": updates})
        return {
            "message": "Spotify connected",
            "spotify_connected": True,
            "spotify_display_name": profile_display_name,
            "spotify_user_id": profile_user_id,
        }

    @router.post("/profile/spotify/disconnect")
    async def disconnect_spotify(current_user: dict = Depends(get_current_user)):
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$set": {
                    "spotify_connected": False,
                    "spotify_oauth_state": None,
                    "spotify_oauth_state_created_at": None,
                },
                "$unset": {
                    "spotify_access_token": "",
                    "spotify_refresh_token": "",
                    "spotify_access_token_expires_at": "",
                    "spotify_user_id": "",
                    "spotify_display_name": "",
                },
            },
        )
        return {"message": "Spotify disconnected", "spotify_connected": False}

    @router.get("/profile/spotify/sdk-token")
    async def get_spotify_sdk_token(current_user: dict = Depends(get_current_user)):
        if not await _spotify_feature_allowed(current_user):
            raise HTTPException(status_code=403, detail="Spotify feature is currently disabled.")
        token = await _spotify_valid_access_token(current_user["id"])
        return {"access_token": token}

    async def _spotify_player_request(current_user: dict, method: str, path: str, *, params=None, payload=None, allow_empty=True):
        if not await _spotify_feature_allowed(current_user):
            raise HTTPException(status_code=403, detail="Spotify feature is currently disabled.")
        token = await _spotify_valid_access_token(current_user["id"])
        headers = {"Authorization": f"Bearer {token}"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        url = f"https://api.spotify.com/v1{path}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.request(method.upper(), url, headers=headers, params=params, json=payload)
        if r.status_code in (200, 201):
            return r.json() if r.content else {}
        if r.status_code in (202, 204):
            return {}
        detail = None
        try:
            detail = r.json()
        except Exception:
            detail = r.text
        if r.status_code == 403:
            raise HTTPException(
                status_code=403,
                detail="Spotify Premium is required for in-game playback controls.",
            )
        if r.status_code == 404:
            raise HTTPException(
                status_code=404,
                detail="No active Spotify playback device found. Open Spotify or connect the web player first.",
            )
        if allow_empty and r.status_code == 400:
            raise HTTPException(status_code=400, detail=f"Spotify rejected the request: {detail}")
        raise HTTPException(status_code=400, detail=f"Spotify request failed: {detail}")

    @router.get("/profile/spotify/player/state")
    async def get_spotify_player_state(current_user: dict = Depends(get_current_user)):
        player_state = await _spotify_player_request(current_user, "GET", "/me/player")
        devices = await _spotify_player_request(current_user, "GET", "/me/player/devices")
        return {"player": player_state or None, "devices": devices.get("devices") if isinstance(devices, dict) else []}

    @router.post("/profile/spotify/player/transfer")
    async def spotify_transfer_playback(body: SpotifyTransferBody, current_user: dict = Depends(get_current_user)):
        device_id = (body.device_id or "").strip()
        if not device_id:
            raise HTTPException(status_code=400, detail="device_id is required.")
        await _spotify_player_request(
            current_user,
            "PUT",
            "/me/player",
            payload={"device_ids": [device_id], "play": bool(body.play)},
        )
        return {"message": "Playback transferred"}

    @router.post("/profile/spotify/player/play")
    async def spotify_play(body: SpotifyPlayBody, current_user: dict = Depends(get_current_user)):
        payload = {}
        if body.uri:
            raw_uri = (body.uri or "").strip()
            if raw_uri.lower().startswith("spotify:"):
                uri = raw_uri
            else:
                uri, _embed_url, _public_url, content_type, _sid = _spotify_normalize_url_or_uri(raw_uri)
                if content_type == "track":
                    payload["uris"] = [uri]
                else:
                    payload["context_uri"] = uri
            if raw_uri.lower().startswith("spotify:"):
                try:
                    typ = raw_uri.split(":")[1].strip().lower()
                except Exception:
                    typ = ""
                if typ == "track":
                    payload["uris"] = [raw_uri]
                else:
                    payload["context_uri"] = raw_uri
        if body.position_ms is not None:
            payload["position_ms"] = max(0, int(body.position_ms))
        params = {"device_id": body.device_id} if body.device_id else None
        await _spotify_player_request(
            current_user,
            "PUT",
            "/me/player/play",
            params=params,
            payload=payload or {},
        )
        return {"message": "Playback started"}

    @router.post("/profile/spotify/player/pause")
    async def spotify_pause(current_user: dict = Depends(get_current_user)):
        await _spotify_player_request(current_user, "PUT", "/me/player/pause")
        return {"message": "Playback paused"}

    @router.post("/profile/spotify/player/next")
    async def spotify_next(current_user: dict = Depends(get_current_user)):
        await _spotify_player_request(current_user, "POST", "/me/player/next")
        return {"message": "Skipped to next track"}

    @router.post("/profile/spotify/player/previous")
    async def spotify_previous(current_user: dict = Depends(get_current_user)):
        await _spotify_player_request(current_user, "POST", "/me/player/previous")
        return {"message": "Went to previous track"}

    @router.patch("/profile/spotify/player/volume")
    async def spotify_volume(body: SpotifyVolumeBody, current_user: dict = Depends(get_current_user)):
        await _spotify_player_request(
            current_user,
            "PUT",
            "/me/player/volume",
            params={"volume_percent": int(body.volume_percent)},
        )
        return {"message": "Volume updated", "volume_percent": int(body.volume_percent)}

    @router.patch("/profile/banner")
    async def update_profile_banner(
        current_user: dict = Depends(get_current_user),
        banner_image_url: Optional[str] = Body(None, embed=True),
        banner_text: Optional[str] = Body(None, embed=True),
        notepad_color: Optional[str] = Body(None, embed=True),
    ):
        """Set or clear profile banner image URL, banner text, and/or profile notepad background colour (hex)."""
        uid = current_user["id"]
        updates = {}
        if banner_image_url is not None:
            raw = (banner_image_url or "").strip() or None
            if raw and len(raw) > 2000:
                raise HTTPException(status_code=400, detail="Banner image URL too long.")
            updates["profile_banner_image_url"] = raw
        if banner_text is not None:
            raw = (banner_text or "").strip() or None
            if raw:
                raw = normalize_bbcode_media_typos(raw)
                # Turn ImgBB page URLs (ibb.co/…) into direct i.ibb.co links inside [img] tags
                raw = await rewrite_imgbb_urls_in_banner_text(raw)
            if raw and len(raw) > 10000:
                raise HTTPException(status_code=400, detail="Banner text too long.")
            updates["profile_banner_text"] = raw
        if notepad_color is not None:
            updates["profile_notepad_color"] = _normalize_notepad_color_for_set(notepad_color)
        if not updates:
            doc = await db.users.find_one(
                {"id": uid},
                {"_id": 0, "profile_banner_image_url": 1, "profile_banner_text": 1, "profile_notepad_color": 1},
            )
            return {
                "message": "No banner changes",
                "profile_banner_image_url": (doc.get("profile_banner_image_url") or "").strip() or None,
                "profile_banner_text": (doc.get("profile_banner_text") or "").strip() or None,
                "profile_notepad_color": _notepad_color_for_api_response(doc.get("profile_notepad_color")),
            }
        await db.users.update_one({"id": uid}, {"$set": updates})
        doc = await db.users.find_one(
            {"id": uid},
            {"_id": 0, "profile_banner_image_url": 1, "profile_banner_text": 1, "profile_notepad_color": 1},
        )
        return {
            "message": "Profile banner updated",
            "profile_banner_image_url": (doc.get("profile_banner_image_url") or "").strip() or None,
            "profile_banner_text": (doc.get("profile_banner_text") or "").strip() or None,
            "profile_notepad_color": _notepad_color_for_api_response(doc.get("profile_notepad_color")),
        }

    @router.get("/profile/video-autoplay")
    async def get_profile_video_autoplay(current_user: dict = Depends(get_current_user)):
        """Get whether the current user wants profile videos to autoplay when viewing others' profiles."""
        return {"profile_autoplay_video": bool(current_user.get("profile_autoplay_video", True))}

    @router.patch("/profile/video-autoplay")
    async def update_profile_video_autoplay(
        current_user: dict = Depends(get_current_user),
        profile_autoplay_video: Optional[bool] = Body(None, embed=True),
    ):
        """Turn autoplay on/off for profile videos (when you view someone else's profile)."""
        if profile_autoplay_video is None:
            return {"message": "No change", "profile_autoplay_video": bool(current_user.get("profile_autoplay_video", True))}
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"profile_autoplay_video": profile_autoplay_video}})
        return {"message": "Autoplay preference updated", "profile_autoplay_video": profile_autoplay_video}

    @router.patch("/profile/visibility")
    async def update_profile_visibility(
        current_user: dict = Depends(get_current_user),
        hide_kills_on_profile: Optional[bool] = Body(None, embed=True),
        hide_jailbusts_on_profile: Optional[bool] = Body(None, embed=True),
        show_country_flag_on_profile: Optional[bool] = Body(None, embed=True),
        hide_leaderboard_username: Optional[bool] = Body(None, embed=True),
    ):
        """Hide kills/jailbusts on profile; optionally hide username on leaderboards (and profile honours)."""
        updates = {}
        if hide_kills_on_profile is not None:
            updates["hide_kills_on_profile"] = hide_kills_on_profile
        if hide_jailbusts_on_profile is not None:
            updates["hide_jailbusts_on_profile"] = hide_jailbusts_on_profile
        if show_country_flag_on_profile is not None:
            updates["show_country_flag_on_profile"] = show_country_flag_on_profile
        if hide_leaderboard_username is not None:
            updates["hide_leaderboard_username"] = bool(hide_leaderboard_username)
        if not updates:
            return {
                "message": "No visibility changes",
                "hide_kills_on_profile": bool(current_user.get("hide_kills_on_profile", False)),
                "hide_jailbusts_on_profile": bool(current_user.get("hide_jailbusts_on_profile", False)),
                "show_country_flag_on_profile": bool(current_user.get("show_country_flag_on_profile", False)),
                "hide_leaderboard_username": bool(current_user.get("hide_leaderboard_username", False)),
            }
        await db.users.update_one({"id": current_user["id"]}, {"$set": updates})
        if "hide_leaderboard_username" in updates:
            try:
                from routers.game.leaderboard import invalidate_leaderboard_cache

                invalidate_leaderboard_cache()
            except Exception:
                pass
        doc = await db.users.find_one(
            {"id": current_user["id"]},
            {
                "_id": 0,
                "hide_kills_on_profile": 1,
                "hide_jailbusts_on_profile": 1,
                "show_country_flag_on_profile": 1,
                "hide_leaderboard_username": 1,
            },
        )
        return {
            "message": "Profile visibility updated",
            "hide_kills_on_profile": bool(doc.get("hide_kills_on_profile", False)),
            "hide_jailbusts_on_profile": bool(doc.get("hide_jailbusts_on_profile", False)),
            "show_country_flag_on_profile": bool(doc.get("show_country_flag_on_profile", False)),
            "hide_leaderboard_username": bool(doc.get("hide_leaderboard_username", False)),
        }

    @router.get("/profile/censor-profanity")
    async def get_censor_profanity(current_user: dict = Depends(get_current_user)):
        """Get user's profanity filter preference."""
        return {"censor_profanity": bool(current_user.get("censor_profanity", False))}

    @router.patch("/profile/censor-profanity")
    async def update_censor_profanity(
        current_user: dict = Depends(get_current_user),
        censor_profanity: Optional[bool] = Body(None, embed=True),
    ):
        """Enable/disable profanity filter. When enabled, swear words are replaced with ***."""
        if censor_profanity is None:
            return {"message": "No change", "censor_profanity": bool(current_user.get("censor_profanity", False))}
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"censor_profanity": censor_profanity}})
        return {"message": "Profanity filter updated", "censor_profanity": censor_profanity}

    @router.patch("/profile/mod-online-color")
    async def update_mod_online_color(
        current_user: dict = Depends(get_current_user),
        color: Optional[str] = Body(None, embed=True),
    ):
        """Moderators only: set your colour on the Users Online list. Default dark blue (#1e3a5f)."""
        if not _is_moderator(current_user):
            raise HTTPException(status_code=403, detail="Moderators only")
        raw = (color or "").strip() or MOD_ONLINE_COLOR_DEFAULT
        if not (raw.startswith("#") and len(raw) in (4, 7) and all(c in "0123456789AaBbCcDdEeFf" for c in raw[1:])):
            raw = MOD_ONLINE_COLOR_DEFAULT
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"mod_online_color": raw}})
        # Also update the global Mod role colour so ROLE COLOURS (Admin / Users Online) stay in sync
        await db.game_settings.update_one(
            {"key": "mod_default_online_color"},
            {"$set": {"value": raw}},
            upsert=True,
        )
        return {"message": "Mod online colour updated", "mod_online_color": raw}

    @router.patch("/profile/entertainer-online-color")
    async def update_entertainer_online_color(
        current_user: dict = Depends(get_current_user),
        color: Optional[str] = Body(None, embed=True),
    ):
        """Entertainers only: set your colour on the Users Online list."""
        if not _is_entertainer(current_user):
            raise HTTPException(status_code=403, detail="Entertainers only")
        from utils.entertainer_service import ENTERTAINER_ONLINE_COLOR_DEFAULT as _ENT_DEF

        raw = (color or "").strip() or _ENT_DEF
        if not (raw.startswith("#") and len(raw) in (4, 7) and all(c in "0123456789AaBbCcDdEeFf" for c in raw[1:])):
            raw = _ENT_DEF
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"entertainer_online_color": raw}})
        return {"message": "Entertainer online colour updated", "entertainer_online_color": raw}

    HDO_ONLINE_COLOR_DEFAULT = "#166534"

    @router.patch("/profile/hdo-online-color")
    async def update_hdo_online_color(
        current_user: dict = Depends(get_current_user),
        color: Optional[str] = Body(None, embed=True),
    ):
        """Help Desk Operators only: set your colour on the Users Online list."""
        if not _is_hdo(current_user):
            raise HTTPException(status_code=403, detail="Help Desk Operators only")
        raw = (color or "").strip() or HDO_ONLINE_COLOR_DEFAULT
        if not (raw.startswith("#") and len(raw) in (4, 7) and all(c in "0123456789AaBbCcDdEeFf" for c in raw[1:])):
            raw = HDO_ONLINE_COLOR_DEFAULT
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"hdo_online_color": raw}})
        return {"message": "HDO online colour updated", "hdo_online_color": raw}

    @router.get("/profile/cars-preferences")
    async def get_profile_cars_preferences(current_user: dict = Depends(get_current_user)):
        """Get profile cars preferences: show on profile and selected car ids (up to 5)."""
        # Migrate legacy single featured_car_id to list if needed
        car_ids = current_user.get("profile_car_ids") or []
        if not car_ids and current_user.get("profile_featured_car_id"):
            car_ids = [current_user["profile_featured_car_id"]]
        return {
            "show_cars_on_profile": current_user.get("profile_show_cars", False),
            "profile_car_ids": car_ids,
        }

    @router.patch("/profile/cars-preferences")
    async def update_profile_cars_preferences(
        current_user: dict = Depends(get_current_user),
        show_cars_on_profile: Optional[bool] = Body(None, embed=True),
        profile_car_ids: Optional[list] = Body(None, embed=True),
        featured_car_id: Optional[str] = Body(None, embed=True),  # legacy single-car support
    ):
        """Update profile cars: show/hide, set up to 5 car ids. featured_car_id is legacy (adds to list)."""
        uid = current_user["id"]
        updates = {}
        if show_cars_on_profile is not None:
            updates["profile_show_cars"] = show_cars_on_profile
        if profile_car_ids is not None:
            # Validate ownership and cap at 5
            valid_ids = []
            for cid in profile_car_ids[:5]:
                cid = (cid or "").strip()
                if not cid:
                    continue
                owned = await db.user_cars.find_one({"id": cid, "user_id": uid}, {"_id": 0, "id": 1})
                if owned:
                    valid_ids.append(cid)
            updates["profile_car_ids"] = valid_ids
            updates["profile_show_cars"] = bool(valid_ids)
        elif featured_car_id is not None:
            # Legacy: single car add/remove
            fid = (featured_car_id or "").strip() or None
            existing = current_user.get("profile_car_ids") or ([current_user["profile_featured_car_id"]] if current_user.get("profile_featured_car_id") else [])
            if fid:
                owned = await db.user_cars.find_one({"id": fid, "user_id": uid}, {"_id": 0, "id": 1})
                if not owned:
                    raise HTTPException(status_code=400, detail="You do not own that car")
                if fid not in existing:
                    existing = (existing + [fid])[:5]
                new_ids = existing
            else:
                new_ids = []
            updates["profile_car_ids"] = new_ids
            updates["profile_show_cars"] = bool(new_ids)
        if not updates:
            car_ids = current_user.get("profile_car_ids") or ([current_user["profile_featured_car_id"]] if current_user.get("profile_featured_car_id") else [])
            return {"message": "No changes", "show_cars_on_profile": current_user.get("profile_show_cars", False), "profile_car_ids": car_ids}
        await db.users.update_one({"id": uid}, {"$set": updates})
        new_show = updates.get("profile_show_cars", current_user.get("profile_show_cars", False))
        new_ids = updates.get("profile_car_ids", current_user.get("profile_car_ids") or [])
        return {"message": "Profile cars preferences updated", "show_cars_on_profile": new_show, "profile_car_ids": new_ids}

    @router.get("/profile/my-cars")
    async def get_profile_my_cars(current_user: dict = Depends(get_current_user)):
        """List current user's cars (id, name, rarity, value) for profile featured-car picker. Best cars first (by value desc)."""
        uid = current_user["id"]
        cursor = db.user_cars.find({"user_id": uid}, {"_id": 0, "id": 1, "car_id": 1, "custom_name": 1})
        owned = await cursor.to_list(500)
        cars_catalog = {c["id"]: c for c in (CARS or [])}
        out = []
        for uc in owned:
            info = cars_catalog.get(uc.get("car_id")) if uc.get("car_id") else None
            if not info:
                continue
            out.append({
                "id": uc.get("id"),
                "name": _profile_car_display_name(uc, info),
                "rarity": info.get("rarity") or "common",
                "value": int(info.get("value") or 0),
            })
        out.sort(key=lambda x: (-x["value"], x["name"], x["id"]))
        return {"cars": out}

    @router.get("/account/civilian-protection")
    async def get_civilian_protection_status(current_user: dict = Depends(get_current_user)):
        u = await db.users.find_one(
            {"id": current_user["id"]},
            {
                "_id": 0,
                "created_at": 1,
                "civilian_protection_revoked_at": 1,
                "civilian_protection_revoke_reason": 1,
                "civilian_protection_ends_at": 1,
                "civilian_protection_shorten_reason": 1,
                "is_moderator": 1,
                "email": 1,
            },
        )
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        merged = {**current_user, **u}
        return civilian_protection_status_payload(merged)

    @router.post("/account/civilian-protection/terminate")
    async def terminate_civilian_protection(
        req: Request,
        current_user: dict = Depends(get_current_user_verified),
    ):
        require_protection_revoke_confirm(current_user, reason="manual", request=req)
        await maybe_revoke_civilian_protection(db, current_user["id"], "manual")
        u = await db.users.find_one(
            {"id": current_user["id"]},
            {
                "_id": 0,
                "created_at": 1,
                "civilian_protection_revoked_at": 1,
                "civilian_protection_revoke_reason": 1,
                "civilian_protection_ends_at": 1,
                "civilian_protection_shorten_reason": 1,
                "is_moderator": 1,
                "email": 1,
            },
        )
        merged = {**current_user, **(u or {})}
        return civilian_protection_status_payload(merged)

    class GamblingSelfBanBody(BaseModel):
        duration_hours: int = Field(..., description="12, 24, 48, or 72")

    @router.get("/account/gambling-self-ban")
    async def get_gambling_self_ban(current_user: dict = Depends(get_current_user)):
        u = await db.users.find_one(
            {"id": current_user["id"]},
            {"_id": 0, "gambling_self_ban_until": 1},
        )
        merged = {**current_user, **(u or {})}
        return gambling_self_ban_status_payload(merged)

    @router.post("/account/gambling-self-ban")
    async def post_gambling_self_ban(
        body: GamblingSelfBanBody,
        current_user: dict = Depends(get_current_user_verified),
    ):
        hours = int(body.duration_hours)
        if hours not in GAMBLING_SELF_BAN_DURATIONS_HOURS:
            raise HTTPException(
                status_code=400,
                detail="Choose 12 hours, 1 day, 2 days, or 3 days.",
            )
        u = await db.users.find_one(
            {"id": current_user["id"]},
            {"_id": 0, "gambling_self_ban_until": 1},
        )
        merged = {**current_user, **(u or {})}
        if is_gambling_self_banned(merged):
            raise HTTPException(
                status_code=400,
                detail="You already have an active gambling self-exclusion. It cannot be changed or removed.",
            )
        now = datetime.now(timezone.utc)
        until = now + timedelta(hours=hours)
        until_iso = until.isoformat()
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$set": {
                    "gambling_self_ban_until": until_iso,
                    "gambling_self_ban_started_at": now.isoformat(),
                    "gambling_self_ban_duration_hours": hours,
                }
            },
        )
        return gambling_self_ban_status_payload({**merged, "gambling_self_ban_until": until_iso}, now)
