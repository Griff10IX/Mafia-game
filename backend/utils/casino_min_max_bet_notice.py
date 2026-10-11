"""Owners noticed below the casino max-bet floor are dropped once the notice deadline passes."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

SETTING_KEY = "casino_min_max_bet_notice"
GAME_LABELS = {
    "dice": "Dice",
    "roulette": "Roulette",
    "blackjack": "Blackjack",
    "horseracing": "Horse Racing",
    "videopoker": "Video Poker",
    "slots": "Slots",
}
QUICKTRADE_TYPES = {
    "dice": "casino_dice",
    "roulette": "casino_rlt",
    "blackjack": "casino_blackjack",
    "horseracing": "casino_horseracing",
    "videopoker": "casino_videopoker",
    "slots": "casino_slots",
}


def _parse(raw):
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def enforce_due(db, *, send_notification) -> int:
    notice = await db.game_settings.find_one({"key": SETTING_KEY}, {"_id": 0})
    if not notice or notice.get("status") != "pending":
        return 0
    deadline = _parse(notice.get("deadline"))
    if not deadline or datetime.now(timezone.utc) < deadline:
        return 0

    from server import CASINO_MIN_OWNER_MAX_BET, adjust_casino_buy_back_escrow
    from utils.admin_kill_asset_transfer import _casino_collections, _invalidate_casino_caches_for
    from utils.quicktrade_casino_cleanup import cancel_quicktrade_casino_listings_by_locations

    floor = int(notice.get("min_max_bet") or CASINO_MIN_OWNER_MAX_BET)
    colls = dict(_casino_collections(db))
    dropped = 0
    for t in notice.get("targets") or []:
        game_type, loc_field, loc, owner_id = t.get("game_type"), t.get("loc_field"), t.get("loc"), t.get("owner_id")
        coll = colls.get(game_type)
        if coll is None or not loc_field or not loc or not owner_id:
            continue
        before = await coll.find_one_and_update(
            {loc_field: loc, "owner_id": owner_id, "max_bet": {"$lt": floor}},
            {
                "$set": {
                    "owner_id": None,
                    "owner_username": None,
                    "buy_back_points_held": 0,
                    "buy_back_reward": 0,
                    "max_bet": CASINO_MIN_OWNER_MAX_BET,
                },
                "$unset": {"below_capo_acquired_at": ""},
            },
            projection={"_id": 0, "buy_back_points_held": 1},
        )
        if not before:
            continue
        dropped += 1
        held = int(before.get("buy_back_points_held") or 0)
        if held > 0:
            try:
                await adjust_casino_buy_back_escrow(
                    owner_id, held, 0,
                    event_type=f"casino_{game_type}",
                    meta={"reason": "min_max_bet_drop", loc_field: loc},
                )
            except Exception:
                logger.exception("min max bet drop escrow release owner=%s %s %s", owner_id, game_type, loc)
        pt = QUICKTRADE_TYPES.get(game_type)
        if pt:
            try:
                await cancel_quicktrade_casino_listings_by_locations(pt, loc, loc)
            except Exception:
                logger.exception("min max bet drop quicktrade cleanup %s %s", game_type, loc)
        await _invalidate_casino_caches_for([owner_id])
        try:
            await send_notification(
                owner_id,
                "Casino dropped",
                f"Your {GAME_LABELS.get(game_type, game_type)} in {loc} was dropped. "
                f"Its max bet was still under the new minimum of ${floor:,} after 24 hours.",
                "system",
            )
        except Exception:
            logger.exception("min max bet drop notify owner=%s", owner_id)

    await db.game_settings.update_one(
        {"key": SETTING_KEY, "status": "pending"},
        {"$set": {"status": "done", "enforced_at": datetime.now(timezone.utc).isoformat(), "dropped": dropped}},
    )
    logger.info("Casino min max bet enforcement dropped %s table(s)", dropped)
    return dropped


async def run_casino_min_max_bet_ticker(db) -> None:
    await asyncio.sleep(30)
    while True:
        try:
            from server import send_notification

            await enforce_due(db, send_notification=send_notification)
        except Exception:
            logger.exception("casino min max bet ticker")
        await asyncio.sleep(60)
