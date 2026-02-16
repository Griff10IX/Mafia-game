# Auto Rank: background task that auto-commits crimes and GTA for users who bought it, sends results to Telegram
import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

AUTO_RANK_INTERVAL_SECONDS = 2 * 60  # Run every 2 minutes


def _parse_iso(s):
    if not s:
        return None
    if hasattr(s, "year"):
        return s
    try:
        return datetime.fromisoformat(str(s).strip().replace("Z", "+00:00"))
    except Exception:
        return None


async def _run_auto_rank_for_user(user_id: str, username: str, telegram_chat_id: str):
    """Commit all crimes that are off cooldown, then one GTA (if off cooldown); send summary to Telegram."""
    import server as srv
    from routers.crimes import _commit_crime_impl
    from routers.gta import _attempt_gta_impl, GTA_OPTIONS
    from security import send_telegram_to_chat

    db = srv.db
    get_rank_info = srv.get_rank_info

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    if user.get("in_jail"):
        await send_telegram_to_chat(
            telegram_chat_id,
            f"**Auto Rank** — {username}\n\nYou're in jail. No auto actions this run.",
        )
        return

    now = datetime.now(timezone.utc)
    lines = [f"**Auto Rank** — {username}", ""]

    # --- Crimes: commit ALL that are off cooldown and rank-eligible (loop until none left) ---
    crimes = await db.crimes.find({}, {"_id": 0, "id": 1, "name": 1, "min_rank": 1}).to_list(50)
    crime_count = 0
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
            crime_count += 1
            if out.success:
                r = out.reward if out.reward is not None else 0
                lines.append(f"**Crime** — Success: ${r:,} + RP. {out.message}")
            else:
                lines.append(f"**Crime** — Failed. {out.message}")
        except Exception as e:
            logger.exception("Auto rank crime for %s: %s", user_id, e)
            lines.append(f"**Crime** — Error: {e!s}")
            break
    if crime_count == 0:
        lines.append("**Crimes** — None off cooldown.")

    # Refresh user after crimes (money/rank may have changed; might be in_jail)
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        lines.append("")
        await send_telegram_to_chat(telegram_chat_id, "\n".join(lines))
        return
    if user.get("in_jail"):
        lines.append("")
        lines.append("(You're now in jail — no GTA this run.)")
        await send_telegram_to_chat(telegram_chat_id, "\n".join(lines))
        return

    # --- GTA: if global cooldown passed, pick first option rank-eligible and attempt ---
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
    await send_telegram_to_chat(telegram_chat_id, "\n".join(lines))


async def run_auto_rank_cycle():
    """One cycle: find all auto_rank users with telegram_chat_id; for each, commit all crimes (off cooldown) + one GTA, send to Telegram."""
    import server as srv
    db = srv.db
    cursor = db.users.find(
        {"auto_rank_enabled": True, "telegram_chat_id": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1},
    )
    users = await cursor.to_list(500)
    for u in users:
        chat_id = (u.get("telegram_chat_id") or "").strip()
        if not chat_id:
            continue
        try:
            await _run_auto_rank_for_user(u["id"], u.get("username", "?"), chat_id)
        except Exception as e:
            logger.exception("Auto rank for user %s: %s", u.get("id"), e)
        await asyncio.sleep(0.5)  # Slight stagger between users


async def run_auto_rank_loop():
    """Background loop: run auto rank cycle every AUTO_RANK_INTERVAL_SECONDS."""
    await asyncio.sleep(60)  # Delay first run 1 min after startup
    while True:
        try:
            await run_auto_rank_cycle()
        except Exception as e:
            logger.exception("Auto rank cycle failed: %s", e)
        await asyncio.sleep(AUTO_RANK_INTERVAL_SECONDS)
