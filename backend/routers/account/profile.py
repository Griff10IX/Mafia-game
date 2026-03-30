# Profile: user profile view, avatar, theme, change-password, telegram (for Auto Rank)
import asyncio
import base64
import logging
import os
import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import urlencode, urlparse

_VALID_TOAST_POSITIONS = frozenset(
    ("top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right", "custom")
)
_VALID_TOPBAR_STAT_IDS = frozenset(
    ("rank", "health", "bullets", "kills", "money", "points", "respect_points", "notifications", "property")
)
_CHIP_SCALE_MIN, _CHIP_SCALE_MAX = 20, 100

import httpx
from fastapi import Body, Depends, HTTPException
from pydantic import BaseModel, Field

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
        # notifications: count by user_id
        await db.notifications.create_index("user_id")
        logger.info("Profile indexes ensured.")
    except Exception as e:
        logger.warning("ensure_profile_indexes: %s", e)


def register(router):
    """Register profile routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    _username_pattern = srv._username_pattern
    get_rank_info = srv.get_rank_info
    get_wealth_rank = srv.get_wealth_rank
    get_wealth_rank_range = srv.get_wealth_rank_range
    _user_owns_any_property = srv._user_owns_any_property
    _is_moderator = srv._is_moderator
    _is_admin = srv._is_admin
    MOD_ONLINE_COLOR_DEFAULT = "#1e3a5f"
    verify_password = srv.verify_password
    get_password_hash = srv.get_password_hash
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    AvatarUpdateRequest = srv.AvatarUpdateRequest
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

    async def _top_cars_for_profile(user_id: str, limit: int = 5, show_cars: bool = False, profile_car_ids: Optional[list] = None):
        """Return only the explicitly chosen cars for the profile (up to 5). Preserves selection order."""
        if not show_cars or not profile_car_ids:
            return []
        car_ids = [cid for cid in (profile_car_ids or []) if cid][:limit]
        if not car_ids:
            return []
        cars_catalog = {c["id"]: c for c in (CARS or [])}
        owned_map = {}
        cursor = db.user_cars.find({"user_id": user_id, "id": {"$in": car_ids}}, {"_id": 0, "id": 1, "car_id": 1})
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
                "name": info.get("name") or "?",
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

    @router.get("/users/{username}/profile-preview")
    async def get_user_profile_preview(username: str, current_user: dict = Depends(get_current_user)):
        """Minimal profile data for hover previews (e.g. Users Online). Only returns public-safe fields."""
        user = await _find_user_by_profile_username(
            username,
            {"_id": 0, "id": 1, "username": 1, "avatar_url": 1, "total_kills": 1, "jail_busts": 1, "family_id": 1},
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user.get("id")

        async def _hitlist_count():
            return await db.hitlist.count_documents(
                {"target_id": user_id, "target_type": {"$in": ["user", "bodyguards"]}}
            )

        async def _messages_received():
            return await db.notifications.count_documents(
                {"user_id": user_id, "notification_type": "user_message"}
            )

        async def _messages_sent():
            # One row per outgoing DM: the sender's "sent" copy only. Do not also count the
            # recipient's inbox row (user_message with sender_id=us) or sent is doubled.
            return await db.notifications.count_documents(
                {"user_id": user_id, "notification_type": "user_message_sent"}
            )

        async def _family():
            fid = user.get("family_id")
            if not fid:
                return None
            fam = await db.families.find_one({"id": str(fid)}, {"_id": 0, "name": 1, "tag": 1})
            if not fam:
                return None
            name = fam.get("name") or "?"
            tag = (fam.get("tag") or "").strip()
            return f"{name}" + (f" [{tag}]" if tag else "") if name else None

        async def _owns_casino():
            for coll_name in ("dice_ownership", "roulette_ownership", "blackjack_ownership", "horseracing_ownership", "slots_ownership", "videopoker_ownership"):
                if await db[coll_name].count_documents({"owner_id": user_id}, limit=1):
                    return True
            return False

        async def _property_type():
            if await db.airport_ownership.find_one({"owner_id": user_id}, {"_id": 1}):
                return "airport"
            if await db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 1}):
                return "armoury"
            return None

        (
            hitlist_count,
            messages_received,
            messages_sent,
            family_display,
            owns_casino,
            property_type,
        ) = await asyncio.gather(
            _hitlist_count(),
            _messages_received(),
            _messages_sent(),
            _family(),
            _owns_casino(),
            _property_type(),
        )

        return {
            "username": user.get("username"),
            "avatar_url": user.get("avatar_url"),
            "kills": int(user.get("total_kills") or 0),
            "jail_busts": int(user.get("jail_busts") or 0),
            "on_hitlist": hitlist_count > 0,
            "messages_sent": messages_sent,
            "messages_received": messages_received,
            "family": family_display,
            "owns_casino": owns_casino,
            "property_type": property_type,
        }

    @router.get("/users/{username}/profile")
    async def get_user_profile(username: str, current_user: dict = Depends(get_current_user)):
        """View a user's profile (requires auth)."""
        user = await _find_user_by_profile_username(username, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        _prestige_mult = float(user.get("prestige_rank_multiplier") or 1.0)
        rank_id, rank_name = get_rank_info(user.get("rank_points", 0), _prestige_mult)
        _game_rank_name = rank_name
        if user.get("email") in ADMIN_EMAILS:
            rank_name = "Admin"
        elif _is_moderator(user):
            rank_name = "Moderator"
        elif user.get("is_help_desk_operator"):
            rank_name = f"(HDO) {_game_rank_name}"
        _prestige_level = int(user.get("prestige_level") or 0)
        _prestige_name = PRESTIGE_CONFIGS.get(_prestige_level, {}).get("name", "") if _prestige_level > 0 else ""
        wealth_id, wealth_name = get_wealth_rank(user.get("money", 0))
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
        elif (user.get("email") in ADMIN_EMAILS or user.get("is_moderator")) and user.get("admin_ghost_mode"):
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

        async def _rank_for_field(field: str, value: int) -> int:
            if value is None:
                value = 0
            n_better = await db.users.count_documents({
                "is_dead": {"$ne": True},
                "is_bodyguard": {"$ne": True},
                field: {"$gt": value},
            })
            return n_better + 1

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
            if not user.get("family_id"):
                return (None, None)
            fam = await db.families.find_one({"id": user["family_id"]}, {"_id": 0, "name": 1, "tag": 1})
            if not fam:
                return (None, None)
            return (fam.get("name"), fam.get("tag"))

        async def _badge_stat_fields():
            """Stats only — used for ranking badges on profile (same for self and visitors)."""
            return await db.users.find_one(
                {"id": user_id},
                {
                    "_id": 0,
                    "total_crimes": 1,
                    "total_gta": 1,
                    "jail_busts": 1,
                    "total_kills": 1,
                    "total_oc_heists": 1,
                    "bullets_melted": 1,
                    "booze_runs_count": 1,
                    "hitlist_npc_kills": 1,
                },
            )

        (
            family_name_tag,
            kills_rank,
            crimes_rank,
            gta_rank,
            jail_rank,
            rank_points_rank,
            points_spent_rank,
            dice_casinos,
            roulette_casinos,
            blackjack_casinos,
            horseracing_casinos,
            slots_casinos,
            videopoker_casinos,
            property_,
            messages_received,
            messages_sent_count,
            top_cars,
            badge_stat_fields,
        ) = await asyncio.gather(
            _family_name_and_tag(),
            _rank_for_field("total_kills", int(user.get("total_kills") or 0)),
            _rank_for_field("total_crimes", int(user.get("total_crimes") or 0)),
            _rank_for_field("total_gta", int(user.get("total_gta") or 0)),
            _rank_for_field("jail_busts", int(user.get("jail_busts") or 0)),
            _rank_for_field("rank_points", int(user.get("rank_points") or 0)),
            _rank_for_field("lifetime_points_spent", int(user.get("lifetime_points_spent") or 0)),
            _casinos_for_type("dice", db.dice_ownership),
            _casinos_for_type("roulette", db.roulette_ownership),
            _casinos_for_type("blackjack", db.blackjack_ownership),
            _casinos_for_type("horseracing", db.horseracing_ownership),
            _casinos_for_type("slots", db.slots_ownership, "state"),
            _casinos_for_type("videopoker", db.videopoker_ownership),
            _user_owns_any_property(user_id),
            # Messages received: direct messages delivered to this user's inbox
            db.notifications.count_documents({"user_id": user_id, "notification_type": "user_message"}),
            # Messages sent: sender's outbox copy only (same as GET /notifications/sent)
            db.notifications.count_documents(
                {"user_id": user_id, "notification_type": "user_message_sent"}
            ),
            _top_cars_for_profile(
                user_id,
                5,
                user.get("profile_show_cars", False),
                user.get("profile_car_ids") or (
                    [user.get("profile_featured_car_id")] if user.get("profile_featured_car_id") else []
                ),
            ),
            _badge_stat_fields(),
        )

        family_name, family_tag = family_name_tag or (None, None)

        honours = [
            {"rank": rank_points_rank, "label": "Most Rank Points Earned"},
            {"rank": kills_rank, "label": "Most Kills"},
            {"rank": crimes_rank, "label": "Most Crimes Committed"},
            {"rank": gta_rank, "label": "Most GTAs Committed"},
            {"rank": jail_rank, "label": "Most Jail Busts"},
            {"rank": points_spent_rank, "label": "Most Points Spent"},
        ]
        from routers.game.achievements import compute_profile_badges
        achievement_badges = compute_profile_badges(badge_stat_fields or user)
        owned_casinos = dice_casinos + roulette_casinos + blackjack_casinos + horseracing_casinos + slots_casinos + videopoker_casinos

        if property_ and user_id != current_user.get("id") and property_.get("type") == "airport":
            property_ = {k: v for k, v in property_.items() if k != "total_earnings"}
        if isinstance(messages_sent_count, list):
            messages_sent = 0
        else:
            messages_sent = int(messages_sent_count or 0)

        # Own profile only if the requested profile is the current user (by id and by URL username)
        requested_username_norm = (username or "").strip().lower()
        current_username_norm = (current_user.get("username") or "").strip().lower()
        is_own_profile = (
            current_user.get("id") == user_id
            and requested_username_norm == current_username_norm
        )
        is_admin = current_user.get("email") in ADMIN_EMAILS
        # When viewing another player's profile, hide last_seen (privacy). Account created is public.
        # owned_casinos and property are always shown for the profile subject (public who owns what)
        created_at = user.get("created_at")
        if not is_own_profile:
            last_seen = None
            is_bodyguard_visible = False
        else:
            is_bodyguard_visible = bool(user.get("is_bodyguard"))

        out = {
            "id": user_id,
            "username": user["username"],
            "rank": rank_id,
            "rank_name": rank_name,
            "is_help_desk_operator": bool(user.get("is_help_desk_operator")),
            "prestige_level": _prestige_level,
            "prestige_name": _prestige_name,
            "wealth_rank": wealth_id,
            "wealth_rank_name": wealth_name,
            "wealth_rank_range": wealth_range,
            "hide_kills_on_profile": bool(user.get("hide_kills_on_profile", False)),
            "hide_jailbusts_on_profile": bool(user.get("hide_jailbusts_on_profile", False)),
            "kills": None if user.get("hide_kills_on_profile") else user.get("total_kills", 0),
            "jail_busts": None if user.get("hide_jailbusts_on_profile") else user.get("jail_busts", 0),
            "created_at": created_at,
            "avatar_url": user.get("avatar_url"),
            "is_dead": is_dead,
            "is_npc": bool(user.get("is_npc")),
            "is_bodyguard": is_bodyguard_visible,
            "online": online,
            "status": status,  # "online", "idle", "offline", or "dead"
            "last_seen": last_seen,
            "family_name": family_name,
            "family_tag": family_tag,
            "honours": honours,
            "owned_casinos": owned_casinos,
            "property": property_,
            "messages_sent": messages_sent,
            "messages_received": messages_received,
            "top_cars": top_cars or [],
            "show_cars_on_profile": user.get("profile_show_cars", False),
            "youtube_url": (user.get("profile_youtube_url") or "").strip() or None,
            "spotify_url": (user.get("profile_spotify_url") or "").strip() or None,
            "spotify_embed_url": (user.get("profile_spotify_embed_url") or "").strip() or None,
            "profile_banner_image_url": (user.get("profile_banner_image_url") or "").strip() or None,
            "profile_banner_text": (user.get("profile_banner_text") or "").strip() or None,
            "badges": user.get("badges") or [],
            "founding_member": bool(user.get("founding_member")),
            "achievement_badges": achievement_badges,
        }
        if not is_own_profile:
            for key in (
                "last_seen",
                "top_cars",
                "show_cars_on_profile",
                "youtube_url",
                "hide_kills_on_profile",
                "hide_jailbusts_on_profile",
            ):
                if key in ("top_cars",):
                    out[key] = []
                elif key in ("prestige_level",):
                    out[key] = 0
                elif key == "prestige_name":
                    out[key] = ""
                elif key in ("hide_kills_on_profile", "hide_jailbusts_on_profile"):
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
        # Hitlist banner: is this user on the hitlist? (public info: totals only)
        hitlist_entries = await db.hitlist.find(
            {"target_id": user_id, "target_type": {"$in": ["user", "bodyguards"]}},
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
        username_pattern = _username_pattern(username)
        if not username_pattern:
            raise HTTPException(status_code=400, detail="Invalid username")
        try:
            user = await db.users.find_one(
                {"username": username_pattern},
                {
                    "_id": 0,
                    "id": 1, "username": 1, "email": 1, "created_at": 1, "last_seen": 1,
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
        admin_emails_set = set(ADMIN_EMAILS) if ADMIN_EMAILS else set()
        if (user.get("email") or "") in admin_emails_set:
            rank_name = "Admin"
        elif user.get("is_moderator"):
            rank_name = "Moderator"
        elif user.get("is_help_desk_operator"):
            rank_name = f"(HDO) {rank_name}"
        family_name = None
        if user.get("family_id"):
            try:
                fam = await db.families.find_one({"id": str(user["family_id"])}, {"_id": 0, "name": 1})
                if fam:
                    family_name = fam.get("name")
            except Exception as e:
                logger.warning("staff-stats family lookup failed: %s", e)
        last_login_ip = user.get("last_login_ip")
        if last_login_ip is None and user.get("login_ips"):
            ips = user.get("login_ips") or []
            last_login_ip = ips[-1] if ips else None
        try:
            return {
                "id": _to_json_safe(user.get("id")) or str(user.get("id", "")),
                "username": str(user.get("username") or ""),
                "email": str(user.get("email") or ""),
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
    AVATAR_MAX_BYTES = 250_000

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
            raise HTTPException(status_code=400, detail="Avatar too large. Use a smaller image (max ~180KB).")

        # Security validation
        is_valid, error_msg = _validate_avatar_data_url(avatar)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)

        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$set": {"avatar_url": avatar}}
        )
        return {"message": "Avatar updated"}

    @router.get("/profile/theme")
    async def get_profile_theme(current_user: dict = Depends(get_current_user)):
        """Get current user's theme preferences (for cross-device sync). Returns defaults if never set."""
        prefs = current_user.get("theme_preferences") or {}
        return {"theme_preferences": prefs}

    @router.patch("/profile/theme")
    async def update_profile_theme(request: ThemePreferencesRequest, current_user: dict = Depends(get_current_user)):
        """Save theme preferences to DB so they sync across devices. Only provided keys are updated. Null = clear."""
        updates = request.model_dump(exclude_unset=True)
        if not updates:
            return {"message": "No theme updates", "theme_preferences": current_user.get("theme_preferences") or {}}
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
        new_prefs = {**(current_user.get("theme_preferences") or {}), **stored}
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"theme_preferences": new_prefs}},
        )
        return {"message": "Theme saved", "theme_preferences": new_prefs}

    DEFAULT_SECTION_ORDER = [
        "rank_progress", "rewards_objectives", "notifications_event",
        "bodyguards_properties", "auto_rank", "at_a_glance", "go_to",
    ]
    DEFAULT_AT_A_GLANCE_STATS = ["money", "rank", "wealth", "rp", "location", "kills"]

    @router.get("/profile/dashboard")
    async def get_profile_dashboard(current_user: dict = Depends(get_current_user)):
        """Get dashboard layout preferences. Returns defaults if never set."""
        prefs = current_user.get("dashboard_preferences") or {}
        return {
            "section_order": prefs.get("section_order") or DEFAULT_SECTION_ORDER,
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
                "section_order": prefs.get("section_order") or DEFAULT_SECTION_ORDER,
                "at_a_glance_visible": prefs.get("at_a_glance_visible", True),
                "at_a_glance_stats": prefs.get("at_a_glance_stats") or DEFAULT_AT_A_GLANCE_STATS,
            }
        valid_section_ids = {"rank_progress", "rewards_objectives", "notifications_event", "bodyguards_properties", "auto_rank", "at_a_glance", "go_to"}
        valid_stat_ids = {"money", "rank", "wealth", "rp", "location", "kills"}
        if "section_order" in updates:
            order = updates["section_order"]
            if not isinstance(order, list) or not all(isinstance(s, str) and s in valid_section_ids for s in order):
                raise HTTPException(status_code=400, detail="Invalid section_order")
            if set(order) != valid_section_ids:
                raise HTTPException(status_code=400, detail="section_order must contain all section IDs exactly once")
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
            "section_order": new_prefs.get("section_order") or DEFAULT_SECTION_ORDER,
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
    ):
        """Set or clear profile banner image URL and/or banner text (motto) shown on your profile."""
        uid = current_user["id"]
        updates = {}
        if banner_image_url is not None:
            raw = (banner_image_url or "").strip() or None
            if raw and len(raw) > 2000:
                raise HTTPException(status_code=400, detail="Banner image URL too long.")
            updates["profile_banner_image_url"] = raw
        if banner_text is not None:
            raw = (banner_text or "").strip() or None
            if raw and len(raw) > 10000:
                raise HTTPException(status_code=400, detail="Banner text too long.")
            updates["profile_banner_text"] = raw
        if not updates:
            doc = await db.users.find_one({"id": uid}, {"_id": 0, "profile_banner_image_url": 1, "profile_banner_text": 1})
            return {
                "message": "No banner changes",
                "profile_banner_image_url": (doc.get("profile_banner_image_url") or "").strip() or None,
                "profile_banner_text": (doc.get("profile_banner_text") or "").strip() or None,
            }
        await db.users.update_one({"id": uid}, {"$set": updates})
        doc = await db.users.find_one({"id": uid}, {"_id": 0, "profile_banner_image_url": 1, "profile_banner_text": 1})
        return {
            "message": "Profile banner updated",
            "profile_banner_image_url": (doc.get("profile_banner_image_url") or "").strip() or None,
            "profile_banner_text": (doc.get("profile_banner_text") or "").strip() or None,
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
    ):
        """Hide kills and/or jailbusts from your profile (for everyone including yourself)."""
        updates = {}
        if hide_kills_on_profile is not None:
            updates["hide_kills_on_profile"] = hide_kills_on_profile
        if hide_jailbusts_on_profile is not None:
            updates["hide_jailbusts_on_profile"] = hide_jailbusts_on_profile
        if not updates:
            return {
                "message": "No visibility changes",
                "hide_kills_on_profile": bool(current_user.get("hide_kills_on_profile", False)),
                "hide_jailbusts_on_profile": bool(current_user.get("hide_jailbusts_on_profile", False)),
            }
        await db.users.update_one({"id": current_user["id"]}, {"$set": updates})
        doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "hide_kills_on_profile": 1, "hide_jailbusts_on_profile": 1})
        return {
            "message": "Profile visibility updated",
            "hide_kills_on_profile": bool(doc.get("hide_kills_on_profile", False)),
            "hide_jailbusts_on_profile": bool(doc.get("hide_jailbusts_on_profile", False)),
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
        cursor = db.user_cars.find({"user_id": uid}, {"_id": 0, "id": 1, "car_id": 1})
        owned = await cursor.to_list(500)
        cars_catalog = {c["id"]: c for c in (CARS or [])}
        out = []
        for uc in owned:
            info = cars_catalog.get(uc.get("car_id")) if uc.get("car_id") else None
            if not info:
                continue
            out.append({
                "id": uc.get("id"),
                "name": info.get("name") or "?",
                "rarity": info.get("rarity") or "common",
                "value": int(info.get("value") or 0),
            })
        out.sort(key=lambda x: (-x["value"], x["name"], x["id"]))
        return {"cars": out}
