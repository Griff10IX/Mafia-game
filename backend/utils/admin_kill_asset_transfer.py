"""When staff kills a player via admin, transfer casinos / major properties / portfolio rows to the acting staff member."""

import importlib
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _casino_collections(db) -> List[Tuple[str, Any]]:
    return [
        ("dice", db.dice_ownership),
        ("roulette", db.roulette_ownership),
        ("blackjack", db.blackjack_ownership),
        ("horseracing", db.horseracing_ownership),
        ("videopoker", db.videopoker_ownership),
        ("slots", db.slots_ownership),
    ]


async def _clear_victim_casino_buyback_escrow(db, victim_id: str) -> None:
    from server import adjust_casino_buy_back_escrow

    for _gt, coll in _casino_collections(db):
        async for doc in coll.find({"owner_id": victim_id}, {"_id": 1, "buy_back_points_held": 1}):
            held = int(doc.get("buy_back_points_held") or 0)
            if held > 0:
                try:
                    await adjust_casino_buy_back_escrow(
                        victim_id,
                        held,
                        0,
                        event_type="admin_kill_buyback_release",
                        meta={"reason": "admin_kill_transfer", "collection": coll.name},
                    )
                except Exception:
                    logger.exception("admin_kill buyback release victim=%s coll=%s", victim_id, coll.name)
            try:
                await coll.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"buy_back_points_held": 0, "buy_back_reward": 0}},
                )
            except Exception:
                logger.exception("admin_kill buyback zero doc victim=%s", victim_id)


async def _invalidate_casino_caches_for(user_ids: List[str]) -> None:
    casino_modules = (
        "routers.casinos.dice",
        "routers.casinos.roulette",
        "routers.casinos.blackjack",
        "routers.casinos.horseracing",
        "routers.casinos.video_poker",
        "routers.casinos.slots",
    )
    for uid in user_ids:
        if not uid:
            continue
        for mod_path in casino_modules:
            try:
                mod = importlib.import_module(mod_path)
                inv = getattr(mod, "_invalidate_ownership_cache", None)
                if callable(inv):
                    inv(uid)
            except Exception:
                pass


async def transfer_staff_kill_seizures(db, victim_id: str, admin_user: dict) -> Dict[str, Any]:
    """
    Transfer victim's portfolio (user_properties), exclusive speakeasy, one casino (incl. slots),
    airport and bullet factory when rules allow — aligned with PVP kill + slots coverage.
    Call while victim is still alive (wallet valid for buy-back escrow release).
    """
    from server import (
        CAPO_RANK_ID,
        _user_owns_any_casino,
        _user_owns_any_property,
        _user_owns_garage_dealership,
        _user_owns_sports_betting_book,
        get_rank_info,
        raise_if_dead_casino_transfer_target,
        user_prestige_rank_mult,
    )

    raise_if_dead_casino_transfer_target(admin_user)
    admin_id = str(admin_user.get("id") or "").strip()
    if not admin_id or admin_id == victim_id:
        return {"skipped": True, "reason": "invalid_admin_or_self"}
    admin_username = (admin_user.get("username") or "").strip() or "?"

    receiver_rank_id, _ = get_rank_info(int(admin_user.get("rank_points") or 0), user_prestige_rank_mult(admin_user))

    summary: Dict[str, Any] = {
        "portfolio_rows_moved": 0,
        "exclusive_transferred": False,
        "casino_transferred": None,
        "airport_transferred": False,
        "bullet_factory_transferred": False,
        "garage_dealership_transferred": False,
        "sports_betting_transferred": False,
    }

    await _clear_victim_casino_buyback_escrow(db, victim_id)

    casino_colls = _casino_collections(db)
    qt_type_map = {
        "dice": "casino_dice",
        "roulette": "casino_rlt",
        "blackjack": "casino_blackjack",
        "horseracing": "casino_horseracing",
        "videopoker": "casino_videopoker",
    }
    victim_casino_qt: Optional[Tuple[str, str]] = None
    for game_type, coll in casino_colls:
        d = await coll.find_one({"owner_id": victim_id}, {"_id": 0, "city": 1, "state": 1})
        if d:
            loc = d.get("city") or d.get("state")
            pt = qt_type_map.get(game_type)
            if loc and pt:
                victim_casino_qt = (pt, str(loc))
            break

    killer_owns_casino = await _user_owns_any_casino(admin_id)
    casino_set: Dict[str, Any] = {"owner_id": admin_id, "owner_username": admin_username}
    if receiver_rank_id < CAPO_RANK_ID:
        casino_set["below_capo_acquired_at"] = datetime.now(timezone.utc)

    transferred_one = False
    transferred_casino_type = None
    for game_type, coll in casino_colls:
        if killer_owns_casino:
            await coll.update_many(
                {"owner_id": victim_id},
                {"$set": {"owner_id": None, "owner_username": None}},
            )
        elif not transferred_one:
            res = await coll.update_one({"owner_id": victim_id}, {"$set": dict(casino_set)})
            if res.modified_count:
                transferred_one = True
                transferred_casino_type = game_type
    if not killer_owns_casino and transferred_one:
        for _game_type, coll in casino_colls:
            await coll.update_many(
                {"owner_id": victim_id},
                {"$set": {"owner_id": None, "owner_username": None}},
            )

    if transferred_casino_type:
        summary["casino_transferred"] = transferred_casino_type

    if victim_casino_qt:
        pt, loc = victim_casino_qt
        try:
            from utils.quicktrade_casino_cleanup import cancel_quicktrade_casino_listings_by_locations

            await cancel_quicktrade_casino_listings_by_locations(pt, loc, loc)
        except Exception:
            logger.exception("admin_kill quicktrade cleanup loc=%s", loc)

    killer_owns_property = await _user_owns_any_property(admin_id)
    victim_airport = await db.airport_ownership.find_one({"owner_id": victim_id}, {"_id": 0, "state": 1, "slot": 1})
    if victim_airport:
        if killer_owns_property:
            await db.airport_ownership.update_many(
                {"owner_id": victim_id},
                {"$set": {"owner_id": None, "owner_username": None}},
            )
        else:
            airport_set = {"owner_id": admin_id, "owner_username": admin_username}
            if receiver_rank_id < CAPO_RANK_ID:
                airport_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
            res = await db.airport_ownership.update_one({"owner_id": victim_id}, {"$set": airport_set})
            if res.modified_count:
                summary["airport_transferred"] = True
            await db.airport_ownership.update_many(
                {"owner_id": victim_id},
                {"$set": {"owner_id": None, "owner_username": None}},
            )

    killer_owns_property_now = await _user_owns_any_property(admin_id)
    victim_bf = await db.bullet_factory.find_one({"owner_id": victim_id}, {"_id": 0, "state": 1})
    if victim_bf:
        if killer_owns_property_now:
            await db.bullet_factory.update_many(
                {"owner_id": victim_id},
                {"$set": {"owner_id": None, "owner_username": None}},
            )
        else:
            bf_set = {"owner_id": admin_id, "owner_username": admin_username}
            if receiver_rank_id < CAPO_RANK_ID:
                bf_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
            res = await db.bullet_factory.update_one({"owner_id": victim_id}, {"$set": bf_set})
            if res.modified_count:
                summary["bullet_factory_transferred"] = True
            await db.bullet_factory.update_many(
                {"owner_id": victim_id},
                {"$set": {"owner_id": None, "owner_username": None}},
            )

    killer_owns_dealership = await _user_owns_garage_dealership(admin_id)
    victim_dealership = await db.garage_dealership.find_one({"owner_id": victim_id}, {"_id": 0})
    if victim_dealership:
        from utils.garage_dealership import cancel_garage_dealership_quicktrade_listings, dealership_auto_stock_defaults

        try:
            await cancel_garage_dealership_quicktrade_listings(db)
        except Exception:
            logger.exception("admin_kill quicktrade cleanup garage_dealership")
        if killer_owns_dealership:
            await db.garage_dealership.update_many(
                {"owner_id": victim_id},
                {"$set": {"owner_id": None, "owner_username": None}},
            )
        else:
            dealership_set = {"owner_id": admin_id, "owner_username": admin_username, **dealership_auto_stock_defaults()}
            admin_had_property = await _user_owns_any_property(admin_id)
            if admin_had_property:
                dealership_set["stack_conflict_acquired_at"] = datetime.now(timezone.utc)
            elif receiver_rank_id < CAPO_RANK_ID:
                dealership_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
            res = await db.garage_dealership.update_one({"owner_id": victim_id}, {"$set": dealership_set})
            if res.modified_count:
                summary["garage_dealership_transferred"] = True

    killer_owns_sports_book = await _user_owns_sports_betting_book(admin_id)
    victim_sports_book = await db.sports_betting_ownership.find_one({"owner_id": victim_id}, {"_id": 0})
    if victim_sports_book:
        from utils.sports_betting_ownership import cancel_sports_betting_quicktrade_listings

        try:
            await cancel_sports_betting_quicktrade_listings(db)
        except Exception:
            logger.exception("admin_kill quicktrade cleanup sports_betting")
        if killer_owns_sports_book:
            await db.sports_betting_ownership.update_many(
                {"owner_id": victim_id},
                {"$set": {"owner_id": None, "owner_username": None}},
            )
        else:
            sports_book_set = {"owner_id": admin_id, "owner_username": admin_username}
            admin_had_property = await _user_owns_any_property(admin_id)
            if admin_had_property:
                sports_book_set["stack_conflict_acquired_at"] = datetime.now(timezone.utc)
            elif receiver_rank_id < CAPO_RANK_ID:
                sports_book_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
            res = await db.sports_betting_ownership.update_one({"owner_id": victim_id}, {"$set": sports_book_set})
            if res.modified_count:
                summary["sports_betting_transferred"] = True

    victim_ep = await db.exclusive_properties.find_one({"owner_id": victim_id}, {"_id": 1})
    if victim_ep:
        killer_ep = await db.exclusive_properties.find_one({"owner_id": admin_id}, {"_id": 1})
        if killer_ep:
            await db.exclusive_properties.update_one({"owner_id": victim_id}, {"$set": {"owner_id": None}})
        else:
            await db.exclusive_properties.update_one({"owner_id": victim_id}, {"$set": {"owner_id": admin_id}})
            summary["exclusive_transferred"] = True

    pr = await db.user_properties.update_many({"user_id": victim_id}, {"$set": {"user_id": admin_id}})
    summary["portfolio_rows_moved"] = int(pr.modified_count or 0)

    await _invalidate_casino_caches_for([victim_id, admin_id])

    return summary
