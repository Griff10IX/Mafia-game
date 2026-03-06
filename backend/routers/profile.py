# Profile: user profile view, avatar, theme, change-password, telegram (for Auto Rank)
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Body, Depends, HTTPException

logger = logging.getLogger(__name__)


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
    verify_password = srv.verify_password
    get_password_hash = srv.get_password_hash
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    MOD_ONLINE_COLOR_DEFAULT = "#1e3a5f"
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    AvatarUpdateRequest = srv.AvatarUpdateRequest
    ThemePreferencesRequest = srv.ThemePreferencesRequest
    ChangePasswordRequest = srv.ChangePasswordRequest
    CARS = srv.CARS

    async def _top_cars_for_profile(user_id: str, limit: int = 5, show_cars: bool = False, featured_car_id: Optional[str] = None):
        """Return up to 5 cars for profile. If show_cars is False, return []. If featured_car_id set, put that first then fill by value (max 5)."""
        if not show_cars:
            return []
        cursor = db.user_cars.find({"user_id": user_id}, {"_id": 0, "id": 1, "car_id": 1})
        owned = await cursor.to_list(500)
        cars_catalog = {c["id"]: c for c in (CARS or [])}
        with_value = []
        featured = None
        for uc in owned:
            info = cars_catalog.get(uc.get("car_id")) if uc.get("car_id") else None
            if not info:
                continue
            entry = {
                "id": uc.get("id"),
                "name": info.get("name") or "?",
                "value": int(info.get("value") or 0),
                "rarity": info.get("rarity") or "common",
            }
            if uc.get("id") == featured_car_id:
                featured = entry
            else:
                with_value.append(entry)
        with_value.sort(key=lambda x: -x["value"])
        if featured:
            result = [featured] + [c for c in with_value if c["id"] != featured.get("id")][: limit - 1]
        else:
            result = with_value[:limit]
        return result

    @router.get("/users/{username}/profile")
    async def get_user_profile(username: str, current_user: dict = Depends(get_current_user)):
        """View a user's profile (requires auth)."""
        username_pattern = _username_pattern(username)
        user = await db.users.find_one({"username": username_pattern}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        _prestige_mult = float(user.get("prestige_rank_multiplier") or 1.0)
        rank_id, rank_name = get_rank_info(user.get("rank_points", 0), _prestige_mult)
        if user.get("email") in ADMIN_EMAILS:
            rank_name = "Admin"
        _prestige_level = int(user.get("prestige_level") or 0)
        _prestige_name = PRESTIGE_CONFIGS.get(_prestige_level, {}).get("name", "") if _prestige_level > 0 else ""
        wealth_id, wealth_name = get_wealth_rank(user.get("money", 0))
        is_dead = bool(user.get("is_dead"))
        online = False
        last_seen = user.get("last_seen")
        if (not is_dead) and last_seen:
            try:
                ls = datetime.fromisoformat(last_seen)
                if ls.tzinfo is None:
                    ls = ls.replace(tzinfo=timezone.utc)
                online = ls >= (datetime.now(timezone.utc) - timedelta(minutes=5))
            except Exception:
                online = False
        if (not is_dead) and (not online):
            forced_until = user.get("forced_online_until")
            if forced_until:
                try:
                    fu = datetime.fromisoformat(forced_until)
                    if fu.tzinfo is None:
                        fu = fu.replace(tzinfo=timezone.utc)
                    online = datetime.now(timezone.utc) < fu
                except Exception:
                    pass
        # When Auto Rank is enabled, count as online; when disabled, normal rules (last 5 min / forced) already applied above
        if (not is_dead) and (not online) and user.get("auto_rank_enabled"):
            online = True
        if user.get("email") in ADMIN_EMAILS and user.get("admin_ghost_mode"):
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
            property_,
            messages_received,
            top_cars,
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
            _user_owns_any_property(user_id),
            db.notifications.count_documents({"user_id": user_id}),
            _top_cars_for_profile(user_id, 5, user.get("profile_show_cars", False), user.get("profile_featured_car_id")),
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
        owned_casinos = dice_casinos + roulette_casinos + blackjack_casinos + horseracing_casinos + slots_casinos

        if property_ and user_id != current_user.get("id") and property_.get("type") == "airport":
            property_ = {k: v for k, v in property_.items() if k != "total_earnings"}
        messages_sent = 0

        # Own profile only if the requested profile is the current user (by id and by URL username)
        requested_username_norm = (username or "").strip().lower()
        current_username_norm = (current_user.get("username") or "").strip().lower()
        is_own_profile = (
            current_user.get("id") == user_id
            and requested_username_norm == current_username_norm
        )
        is_admin = current_user.get("email") in ADMIN_EMAILS
        # When viewing another player's profile, expose only minimal public info (no stats, wealth, honours, etc.)
        if not is_own_profile:
            last_seen = None
            created_at = None
            owned_casinos = []
            is_bodyguard_visible = False
        else:
            created_at = user.get("created_at")
            is_bodyguard_visible = bool(user.get("is_bodyguard"))

        out = {
            "id": user_id,
            "username": user["username"],
            "rank": rank_id,
            "rank_name": rank_name,
            "prestige_level": _prestige_level,
            "prestige_name": _prestige_name,
            "wealth_rank": wealth_id,
            "wealth_rank_name": wealth_name,
            "wealth_rank_range": wealth_range,
            "kills": user.get("total_kills", 0),
            "jail_busts": user.get("jail_busts", 0),
            "created_at": created_at,
            "avatar_url": user.get("avatar_url"),
            "is_dead": is_dead,
            "is_npc": bool(user.get("is_npc")),
            "is_bodyguard": is_bodyguard_visible,
            "online": online,
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
        }
        if not is_own_profile:
            for key in (
                "prestige_level", "prestige_name",
                "created_at", "last_seen", "honours", "owned_casinos", "property",
                "messages_sent", "messages_received", "top_cars", "show_cars_on_profile", "youtube_url",
            ):
                if key == "honours":
                    out[key] = []
                elif key in ("owned_casinos", "top_cars"):
                    out[key] = []
                elif key in ("prestige_level", "messages_sent", "messages_received"):
                    out[key] = 0
                elif key == "prestige_name":
                    out[key] = ""
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
        return out

    @router.post("/profile/avatar")
    async def update_avatar(request: AvatarUpdateRequest, current_user: dict = Depends(get_current_user)):
        """Update your avatar (stored as a data URL)."""
        avatar = (request.avatar_data or "").strip()
        if not avatar.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="Avatar must be an image data URL (data:image/...)")
        if len(avatar) > 250_000:
            raise HTTPException(status_code=400, detail="Avatar too large. Use a smaller image.")

        await db.users.update_one(
            {"id": current_user["id"]},
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
            "custom_themes": "customThemes",
        }
        stored = {key_map.get(k, k): v for k, v in updates.items()}
        new_prefs = {**(current_user.get("theme_preferences") or {}), **stored}
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"theme_preferences": new_prefs}},
        )
        return {"message": "Theme saved", "theme_preferences": new_prefs}

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
            {"$set": {"password_hash": get_password_hash(request.new_password)}}
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
        updates = {}
        if telegram_chat_id is not None:
            updates["telegram_chat_id"] = (telegram_chat_id or "").strip() or None
        if telegram_bot_token is not None:
            updates["telegram_bot_token"] = (telegram_bot_token or "").strip() or None
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
        return {"message": "Mod online colour updated", "mod_online_color": raw}

    @router.get("/profile/cars-preferences")
    async def get_profile_cars_preferences(current_user: dict = Depends(get_current_user)):
        """Get profile cars preferences: show on profile and featured car id."""
        return {
            "show_cars_on_profile": current_user.get("profile_show_cars", False),
            "featured_car_id": current_user.get("profile_featured_car_id"),
        }

    @router.patch("/profile/cars-preferences")
    async def update_profile_cars_preferences(
        current_user: dict = Depends(get_current_user),
        show_cars_on_profile: Optional[bool] = Body(None, embed=True),
        featured_car_id: Optional[str] = Body(None, embed=True),
    ):
        """Update profile cars: show/hide cars on profile, set featured car (one to highlight). Max 5 cars shown; featured is first if set."""
        uid = current_user["id"]
        updates = {}
        if show_cars_on_profile is not None:
            updates["profile_show_cars"] = show_cars_on_profile
        if featured_car_id is not None:
            fid = (featured_car_id or "").strip() or None
            if fid:
                owned = await db.user_cars.find_one({"id": fid, "user_id": uid}, {"_id": 0, "id": 1})
                if not owned:
                    raise HTTPException(status_code=400, detail="You do not own that car")
            updates["profile_featured_car_id"] = fid
        if not updates:
            return {"message": "No changes", "show_cars_on_profile": current_user.get("profile_show_cars", False), "featured_car_id": current_user.get("profile_featured_car_id")}
        await db.users.update_one({"id": uid}, {"$set": updates})
        new_show = updates.get("profile_show_cars") if "profile_show_cars" in updates else current_user.get("profile_show_cars", False)
        new_featured = updates.get("profile_featured_car_id") if "profile_featured_car_id" in updates else current_user.get("profile_featured_car_id")
        return {"message": "Profile cars preferences updated", "show_cars_on_profile": new_show, "featured_car_id": new_featured}

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
