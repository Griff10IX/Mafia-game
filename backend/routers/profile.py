# Profile: user profile view, avatar, theme, change-password, telegram (for Auto Rank)
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Body, Depends, HTTPException


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
    verify_password = srv.verify_password
    get_password_hash = srv.get_password_hash
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    AvatarUpdateRequest = srv.AvatarUpdateRequest
    ThemePreferencesRequest = srv.ThemePreferencesRequest
    ChangePasswordRequest = srv.ChangePasswordRequest

    @router.get("/users/{username}/profile")
    async def get_user_profile(username: str, current_user: dict = Depends(get_current_user)):
        """View a user's profile (requires auth)."""
        username_pattern = _username_pattern(username)
        user = await db.users.find_one({"username": username_pattern}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        rank_id, rank_name = get_rank_info(user.get("rank_points", 0))
        if user.get("email") in ADMIN_EMAILS:
            rank_name = "Admin"
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

        async def _casinos_for_type(game_type: str, coll):
            out = []
            cursor = coll.find(
                {"owner_id": user_id},
                {"_id": 0, "city": 1, "max_bet": 1, "buy_back_reward": 1},
            )
            async for d in cursor:
                item = {"type": game_type, "city": d.get("city", "?"), "max_bet": int(d.get("max_bet") or 0)}
                if d.get("buy_back_reward") is not None:
                    item["buy_back_reward"] = int(d.get("buy_back_reward") or 0)
                out.append(item)
            return out

        async def _family_name():
            if not user.get("family_id"):
                return None
            fam = await db.families.find_one({"id": user["family_id"]}, {"_id": 0, "name": 1})
            return fam.get("name") if fam else None

        (
            family_name,
            kills_rank,
            crimes_rank,
            gta_rank,
            jail_rank,
            rank_points_rank,
            dice_casinos,
            roulette_casinos,
            blackjack_casinos,
            horseracing_casinos,
            property_,
            messages_received,
        ) = await asyncio.gather(
            _family_name(),
            _rank_for_field("total_kills", int(user.get("total_kills") or 0)),
            _rank_for_field("total_crimes", int(user.get("total_crimes") or 0)),
            _rank_for_field("total_gta", int(user.get("total_gta") or 0)),
            _rank_for_field("jail_busts", int(user.get("jail_busts") or 0)),
            _rank_for_field("rank_points", int(user.get("rank_points") or 0)),
            _casinos_for_type("dice", db.dice_ownership),
            _casinos_for_type("roulette", db.roulette_ownership),
            _casinos_for_type("blackjack", db.blackjack_ownership),
            _casinos_for_type("horseracing", db.horseracing_ownership),
            _user_owns_any_property(user_id),
            db.notifications.count_documents({"user_id": user_id}),
        )

        honours = [
            {"rank": rank_points_rank, "label": "Most Rank Points Earned"},
            {"rank": kills_rank, "label": "Most Kills"},
            {"rank": crimes_rank, "label": "Most Crimes Committed"},
            {"rank": gta_rank, "label": "Most GTAs Committed"},
            {"rank": jail_rank, "label": "Most Jail Busts"},
        ]
        owned_casinos = dice_casinos + roulette_casinos + blackjack_casinos + horseracing_casinos

        if property_ and user_id != current_user.get("id") and property_.get("type") == "airport":
            property_ = {k: v for k, v in property_.items() if k != "total_earnings"}
        messages_sent = 0

        out = {
            "id": user_id,
            "username": user["username"],
            "rank": rank_id,
            "rank_name": rank_name,
            "wealth_rank": wealth_id,
            "wealth_rank_name": wealth_name,
            "wealth_rank_range": wealth_range,
            "kills": user.get("total_kills", 0),
            "jail_busts": user.get("jail_busts", 0),
            "created_at": user.get("created_at"),
            "avatar_url": user.get("avatar_url"),
            "is_dead": is_dead,
            "is_npc": bool(user.get("is_npc")),
            "is_bodyguard": bool(user.get("is_bodyguard")),
            "online": online,
            "last_seen": last_seen,
            "family_name": family_name,
            "honours": honours,
            "owned_casinos": owned_casinos,
            "property": property_,
            "messages_sent": messages_sent,
            "messages_received": messages_received,
        }
        if current_user.get("email") in ADMIN_EMAILS:
            today_utc = datetime.now(timezone.utc).date().isoformat()
            booze_today = user.get("booze_profit_today", 0) if user.get("booze_profit_today_date") == today_utc else 0
            out["admin_stats"] = {
                "money": int(user.get("money") or 0),
                "points": int(user.get("points") or 0),
                "bullets": int(user.get("bullets") or 0),
                "booze_profit_today": booze_today,
                "booze_profit_total": int(user.get("booze_profit_total") or 0),
                "rank_points": int(user.get("rank_points") or 0),
                "current_state": user.get("current_state") or "—",
                "in_jail": bool(user.get("in_jail")),
            }
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
