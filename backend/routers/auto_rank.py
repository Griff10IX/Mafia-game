# Auto Rank: background task that auto-commits crimes and GTA for users who bought it, sends results to Telegram
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

MIN_INTERVAL_SECONDS = 30
DEFAULT_INTERVAL_SECONDS = 2 * 60  # 2 minutes
GAME_CONFIG_ID = "auto_rank"
BUST_EVERY_5SEC_INTERVAL = 5
CRIMES_GTA_MIN_INTERVAL_WHEN_BUST_5SEC = 5 * 60  # 5 minutes


async def get_auto_rank_interval_seconds(db) -> int:
    """Return configured interval (seconds) between full cycles. Min MIN_INTERVAL_SECONDS."""
    doc = await db.game_config.find_one({"id": GAME_CONFIG_ID}, {"_id": 0, "interval_seconds": 1})
    raw = doc.get("interval_seconds") if doc else None
    try:
        val = int(raw) if raw is not None else DEFAULT_INTERVAL_SECONDS
    except (TypeError, ValueError):
        val = DEFAULT_INTERVAL_SECONDS
    return max(MIN_INTERVAL_SECONDS, val)


async def get_auto_rank_enabled(db) -> bool:
    """Return whether the Auto Rank loop is allowed to run (start/stop). Default True."""
    doc = await db.game_config.find_one({"id": GAME_CONFIG_ID}, {"_id": 0, "enabled": 1})
    if doc is None:
        return True
    return doc.get("enabled", True)


def _parse_iso(s):
    if not s:
        return None
    if hasattr(s, "year"):
        return s
    try:
        return datetime.fromisoformat(str(s).strip().replace("Z", "+00:00"))
    except Exception:
        return None


async def _run_bust_only_for_user(user_id: str, username: str, telegram_chat_id: str):
    """Try one jail bust (regardless of whether user is in jail), send result to Telegram. Used by the 5-sec bust loop."""
    import server as srv
    from routers.jail import _attempt_bust_impl
    from security import send_telegram_to_chat

    db = srv.db
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    bust_target_username = None
    npc = await db.jail_npcs.find_one({}, {"_id": 0, "username": 1})
    if npc:
        bust_target_username = npc.get("username")
    if not bust_target_username:
        jailed = await db.users.find_one(
            {"in_jail": True, "id": {"$ne": user_id}},
            {"_id": 0, "username": 1},
        )
        if jailed:
            bust_target_username = jailed.get("username")
    if not bust_target_username:
        return
    try:
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            return
        bust_result = await _attempt_bust_impl(user, bust_target_username)
        if bust_result.get("error"):
            return
        if bust_result.get("success"):
            rp = bust_result.get("rank_points_earned") or 0
            cash = bust_result.get("cash_reward") or 0
            parts = [f"Busted {bust_target_username}! +{rp} RP"]
            if cash:
                parts.append(f"${cash:,}")
            msg = f"**Auto Rank** — {username}\n\n**Bust** — " + ". ".join(parts) + "."
        else:
            msg = f"**Auto Rank** — {username}\n\n**Bust** — " + (bust_result.get("message") or "Failed.")
        await send_telegram_to_chat(telegram_chat_id, msg)
    except Exception as e:
        logger.exception("Auto rank bust-only for %s: %s", user_id, e)


async def _run_auto_rank_for_user(user_id: str, username: str, telegram_chat_id: str):
    """Commit all crimes that are off cooldown, then one GTA (if off cooldown); send summary to Telegram. When bust_every_5_sec, skip bust here and only run crimes+GTA every 5+ mins."""
    import server as srv
    from routers.crimes import _commit_crime_impl
    from routers.gta import _attempt_gta_impl, GTA_OPTIONS
    from security import send_telegram_to_chat

    db = srv.db
    get_rank_info = srv.get_rank_info
    now = datetime.now(timezone.utc)
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return

    bust_every_5 = user.get("auto_rank_bust_every_5_sec", False)
    if bust_every_5:
        last_at = _parse_iso(user.get("auto_rank_last_crimes_gta_at"))
        if last_at and (now - last_at).total_seconds() < CRIMES_GTA_MIN_INTERVAL_WHEN_BUST_5SEC:
            return
        if user.get("in_jail"):
            return

    if not bust_every_5 and user.get("in_jail"):
        await send_telegram_to_chat(
            telegram_chat_id,
            f"**Auto Rank** — {username}\n\nYou're in jail. No auto actions this run.",
        )
        return

    await send_telegram_to_chat(
        telegram_chat_id,
        f"**Auto Rank** — {username}\n\nSending results…",
    )

    lines = [f"**Auto Rank** — {username}", ""]

    # --- Jail bust: one attempt per cycle (skip when bust_every_5_sec; they get busts in the 5-sec loop) ---
    if not bust_every_5:
        bust_target_username = None
        npc = await db.jail_npcs.find_one({}, {"_id": 0, "username": 1})
        if npc:
            bust_target_username = npc.get("username")
        if not bust_target_username:
            jailed = await db.users.find_one(
                {"in_jail": True, "id": {"$ne": user_id}},
                {"_id": 0, "username": 1},
            )
            if jailed:
                bust_target_username = jailed.get("username")
        if bust_target_username:
            from routers.jail import _attempt_bust_impl
            try:
                bust_result = await _attempt_bust_impl(user, bust_target_username)
                if not bust_result.get("error"):
                    if bust_result.get("success"):
                        rp = bust_result.get("rank_points_earned") or 0
                        cash = bust_result.get("cash_reward") or 0
                        parts = [f"Busted {bust_target_username}! +{rp} RP"]
                        if cash:
                            parts.append(f"${cash:,}")
                        lines.append("**Bust** — " + ". ".join(parts) + ".")
                    else:
                        lines.append("**Bust** — " + (bust_result.get("message") or "Failed. Got caught."))
            except Exception as e:
                logger.exception("Auto rank bust for %s: %s", user_id, e)
                lines.append("**Bust** — Error.")

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        lines.append("")
        await send_telegram_to_chat(telegram_chat_id, "\n".join(lines))
        return
    if user.get("in_jail"):
        if "**Bust**" not in "\n".join(lines):
            lines.append("(You're in jail — no crimes/GTA this run.)")
        lines.append("")
        await send_telegram_to_chat(telegram_chat_id, "\n".join(lines))
        return

    run_crimes = user.get("auto_rank_crimes", True)
    run_gta = user.get("auto_rank_gta", True)

    # --- Crimes: commit ALL that are off cooldown and rank-eligible (loop until none left) ---
    if not run_crimes:
        lines.append("**Crimes** — Disabled.")
    else:
        crimes = await db.crimes.find({}, {"_id": 0, "id": 1, "name": 1, "min_rank": 1}).to_list(50)
        crime_success_count = 0
        crime_fail_count = 0
        crime_total_cash = 0
        crime_total_rp = 0  # 3 RP per successful crime
        while True:
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not user or user.get("in_jail"):
                break
            user_crimes = await db.user_crimes.find({"user_id": user_id}, {"_id": 0, "crime_id": 1, "cooldown_until": 1}).to_list(100)
            cooldown_by_crime = {uc["crime_id"]: _parse_iso(uc.get("cooldown_until")) for uc in user_crimes}
            rank_id, _ = get_rank_info(int(user.get("rank_points") or 0))
            available = [
                c for c in crimes
                if c["min_rank"] <= rank_id
                and (cooldown_by_crime.get(c["id"]) is None or cooldown_by_crime.get(c["id"]) <= now)
            ]
            if not available:
                break
            c = available[0]
            try:
                out = await _commit_crime_impl(c["id"], user)
                if out.success:
                    crime_success_count += 1
                    crime_total_cash += out.reward if out.reward is not None else 0
                    crime_total_rp += 3
                else:
                    crime_fail_count += 1
            except Exception as e:
                logger.exception("Auto rank crime for %s: %s", user_id, e)
                crime_fail_count += 1
                break
        if crime_success_count == 0 and crime_fail_count == 0:
            lines.append("**Crimes** — None off cooldown.")
        else:
            parts = [f"Committed {crime_success_count + crime_fail_count} crime(s)"]
            if crime_success_count:
                parts.append(f"earned ${crime_total_cash:,} and {crime_total_rp} RP")
            if crime_fail_count:
                parts.append(f"{crime_fail_count} failed")
            lines.append("**Crimes** — " + ". ".join(parts) + ".")

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        lines.append("")
        await send_telegram_to_chat(telegram_chat_id, "\n".join(lines))
        return
    if user.get("in_jail"):
        lines.append("")
        lines.append("(You're in jail — no GTA this run.)")
        if bust_every_5:
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"auto_rank_last_crimes_gta_at": now.isoformat()}},
            )
        await send_telegram_to_chat(telegram_chat_id, "\n".join(lines))
        return

    if not run_gta:
        lines.append("**GTA** — Disabled.")
    else:
        gta_done = False
        cooldown_doc = await db.gta_cooldowns.find_one({"user_id": user_id}, {"_id": 0, "cooldown_until": 1})
        if cooldown_doc:
            until = _parse_iso(cooldown_doc.get("cooldown_until"))
            if until and until > now:
                lines.append("**GTA** — On cooldown.")
                await send_telegram_to_chat(telegram_chat_id, "\n".join(lines))
                return

        rank_id, _ = get_rank_info(int(user.get("rank_points") or 0))
        for opt in GTA_OPTIONS:
            if rank_id < opt["min_rank"]:
                continue
            try:
                out = await _attempt_gta_impl(opt["id"], user)
                gta_done = True
                if out.success:
                    car_name = out.car.get("name", "Car") if out.car else "Car"
                    lines.append(f"**GTA** — Success: {car_name}! +{out.rank_points_earned} RP.")
                else:
                    lines.append(f"**GTA** — {out.message}")
                break
            except Exception as e:
                logger.exception("Auto rank GTA for %s: %s", user_id, e)
                lines.append(f"**GTA** — Error: {e!s}")
                break
        if not gta_done:
            lines.append("**GTA** — None available (rank or cooldown).")

    lines.append("")
    if bust_every_5:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"auto_rank_last_crimes_gta_at": now.isoformat()}},
        )
    await send_telegram_to_chat(telegram_chat_id, "\n".join(lines))


async def run_auto_rank_due_users():
    """Find users whose auto_rank_next_run_at is due (or unset), run each once, set their next_run_at = now + interval. Per-user cycles so everyone gets the interval they expect."""
    import server as srv
    db = srv.db
    now = datetime.now(timezone.utc)
    interval = await get_auto_rank_interval_seconds(db)
    cursor = db.users.find(
        {
            "auto_rank_enabled": True,
            "telegram_chat_id": {"$exists": True, "$nin": [None, ""]},
            "$or": [
                {"auto_rank_next_run_at": {"$exists": False}},
                {"auto_rank_next_run_at": None},
                {"auto_rank_next_run_at": {"$lte": now.isoformat()}},
            ],
        },
        {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1},
    )
    users = await cursor.to_list(500)
    next_run = (now.timestamp() + interval)
    next_run_iso = datetime.fromtimestamp(next_run, tz=timezone.utc).isoformat()
    for u in users:
        chat_id = (u.get("telegram_chat_id") or "").strip()
        if not chat_id:
            continue
        try:
            await _run_auto_rank_for_user(u["id"], u.get("username", "?"), chat_id)
        except Exception as e:
            logger.exception("Auto rank for user %s: %s", u.get("id"), e)
        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {"auto_rank_next_run_at": next_run_iso}},
        )
        await asyncio.sleep(0.5)


async def run_bust_5sec_loop():
    """Background loop: every 5 sec, for users with auto_rank_bust_every_5_sec, try one jail bust (regardless of jail). Respects global enabled."""
    import server as srv
    db = srv.db
    await asyncio.sleep(15)  # Start shortly after main loop
    while True:
        if not await get_auto_rank_enabled(db):
            await asyncio.sleep(10)
            continue
        try:
            cursor = db.users.find(
                {
                    "auto_rank_enabled": True,
                    "auto_rank_bust_every_5_sec": True,
                    "telegram_chat_id": {"$exists": True, "$nin": [None, ""]},
                },
                {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1},
            )
            users = await cursor.to_list(500)
            for u in users:
                chat_id = (u.get("telegram_chat_id") or "").strip()
                if not chat_id:
                    continue
                try:
                    await _run_bust_only_for_user(u["id"], u.get("username", "?"), chat_id)
                except Exception as e:
                    logger.exception("Auto rank bust 5sec for user %s: %s", u.get("id"), e)
                await asyncio.sleep(0.3)
        except Exception as e:
            logger.exception("Bust 5sec cycle failed: %s", e)
        await asyncio.sleep(BUST_EVERY_5SEC_INTERVAL)


LOOP_WAKE_SECONDS = 15  # How often we check who's due for a run

async def run_auto_rank_loop():
    """Background loop: wake every LOOP_WAKE_SECONDS, process any user whose next_run_at is due. Each user has their own cycle (next run = now + interval)."""
    import server as srv
    db = srv.db
    await asyncio.sleep(60)  # Delay first run 1 min after startup
    while True:
        if not await get_auto_rank_enabled(db):
            await asyncio.sleep(10)
            continue
        try:
            await run_auto_rank_due_users()
        except Exception as e:
            logger.exception("Auto rank due-users run failed: %s", e)
        await asyncio.sleep(LOOP_WAKE_SECONDS)


def register(router):
    """Register auto-rank routes: /me for any user (preferences), interval/start/stop for admin."""
    import server as srv
    from fastapi import Depends, HTTPException
    from pydantic import BaseModel

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin

    class IntervalBody(BaseModel):
        interval_seconds: Optional[int] = None

    class MePreferencesBody(BaseModel):
        auto_rank_enabled: Optional[bool] = None
        auto_rank_crimes: Optional[bool] = None
        auto_rank_gta: Optional[bool] = None
        auto_rank_bust_every_5_sec: Optional[bool] = None

    @router.get("/auto-rank/me")
    async def get_my_preferences(current_user: dict = Depends(get_current_user)):
        """Get current user's Auto Rank preferences. Any authenticated user."""
        chat_id = (current_user.get("telegram_chat_id") or "").strip()
        return {
            "auto_rank_enabled": current_user.get("auto_rank_enabled", False),
            "auto_rank_crimes": current_user.get("auto_rank_crimes", True),
            "auto_rank_gta": current_user.get("auto_rank_gta", True),
            "auto_rank_bust_every_5_sec": current_user.get("auto_rank_bust_every_5_sec", False),
            "auto_rank_purchased": current_user.get("auto_rank_purchased", False) or current_user.get("auto_rank_enabled", False),
            "telegram_chat_id_set": bool(chat_id),
        }

    @router.patch("/auto-rank/me")
    async def patch_my_preferences(
        body: MePreferencesBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Update current user's Auto Rank preferences. Enable only if purchased (or already had it)."""
        user_id = current_user["id"]
        updates = {}
        if body.auto_rank_enabled is not None:
            can_enable = current_user.get("auto_rank_purchased") or current_user.get("auto_rank_enabled")
            if body.auto_rank_enabled and not can_enable:
                raise HTTPException(status_code=400, detail="Buy Auto Rank from the Store first (and set Telegram in Profile).")
            updates["auto_rank_enabled"] = body.auto_rank_enabled
        if body.auto_rank_crimes is not None:
            updates["auto_rank_crimes"] = body.auto_rank_crimes
        if body.auto_rank_gta is not None:
            updates["auto_rank_gta"] = body.auto_rank_gta
        if body.auto_rank_bust_every_5_sec is not None:
            updates["auto_rank_bust_every_5_sec"] = body.auto_rank_bust_every_5_sec
        if not updates:
            return {"message": "No changes", "auto_rank_enabled": current_user.get("auto_rank_enabled"), "auto_rank_crimes": current_user.get("auto_rank_crimes"), "auto_rank_gta": current_user.get("auto_rank_gta"), "auto_rank_bust_every_5_sec": current_user.get("auto_rank_bust_every_5_sec", False)}
        await db.users.update_one({"id": user_id}, {"$set": updates})
        updated = await db.users.find_one({"id": user_id}, {"_id": 0, "auto_rank_enabled": 1, "auto_rank_crimes": 1, "auto_rank_gta": 1, "auto_rank_bust_every_5_sec": 1})
        return {
            "message": "Preferences saved",
            "auto_rank_enabled": updated.get("auto_rank_enabled", False),
            "auto_rank_crimes": updated.get("auto_rank_crimes", True),
            "auto_rank_gta": updated.get("auto_rank_gta", True),
            "auto_rank_bust_every_5_sec": updated.get("auto_rank_bust_every_5_sec", False),
        }

    @router.get("/auto-rank/interval")
    async def get_interval(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        interval = await get_auto_rank_interval_seconds(db)
        enabled = await get_auto_rank_enabled(db)
        return {"interval_seconds": interval, "min_interval_seconds": MIN_INTERVAL_SECONDS, "enabled": enabled}

    @router.post("/auto-rank/start")
    async def start_auto_rank(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        await db.game_config.update_one(
            {"id": GAME_CONFIG_ID},
            {"$set": {"enabled": True}},
            upsert=True,
        )
        return {"enabled": True, "message": "Auto Rank started."}

    @router.post("/auto-rank/stop")
    async def stop_auto_rank(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        await db.game_config.update_one(
            {"id": GAME_CONFIG_ID},
            {"$set": {"enabled": False}},
            upsert=True,
        )
        return {"enabled": False, "message": "Auto Rank stopped. Current cycle will finish, then no new cycles until started."}

    @router.patch("/auto-rank/interval")
    async def set_interval(
        body: IntervalBody,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        raw = body.interval_seconds
        try:
            val = int(raw) if raw is not None else DEFAULT_INTERVAL_SECONDS
        except (TypeError, ValueError):
            val = DEFAULT_INTERVAL_SECONDS
        interval = max(MIN_INTERVAL_SECONDS, val)
        await db.game_config.update_one(
            {"id": GAME_CONFIG_ID},
            {"$set": {"interval_seconds": interval}},
            upsert=True,
        )
        return {"interval_seconds": interval, "message": f"Auto Rank will run every {interval} seconds after each cycle."}
