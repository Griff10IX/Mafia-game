"""Auto-collect ticker: store pass collects family rackets; the Property Auto Collect perk handles properties."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

AUTO_COLLECT_TICKER_SECONDS = 300


async def try_auto_collect_property(db, user_id: str, property_id: str) -> Optional[dict]:
    from routers.money.properties import (
        PROPERTY_AUTO_COLLECT_INCOME_FRACTION,
        collect_property_income_impl,
    )

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return None
    try:
        return await collect_property_income_impl(
            property_id,
            user,
            income_fraction=PROPERTY_AUTO_COLLECT_INCOME_FRACTION,
        )
    except HTTPException:
        return None
    except Exception as e:
        logger.debug("auto_collect property %s for %s: %s", property_id, user_id, e)
        return None


async def try_auto_collect_family_racket(db, user_id: str, racket_id: str) -> Optional[dict]:
    from routers.game.families import families_racket_collect

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user or not user.get("family_id"):
        return None
    try:
        return await families_racket_collect(racket_id, user)
    except HTTPException:
        return None
    except Exception as e:
        logger.debug("auto_collect racket %s for %s: %s", racket_id, user_id, e)
        return None


async def run_auto_collect_for_user(
    db,
    user_id: str,
    family_id: Optional[str],
    *,
    collect_properties: bool = True,
    collect_rackets: bool = True,
    pay_upkeep: bool = False,
    clear_heat: bool = False,
    route_property_cash_to_vault: bool = False,
) -> Dict[str, Any]:
    """Attempt all eligible property/racket collects (and optionally upkeep + heat) for one user."""
    out: Dict[str, Any] = {"properties": [], "rackets": [], "upkeep": None, "heat": None}
    prop_cash = 0.0
    racket_cash = 0
    vault_cash = 0
    if collect_properties:
        prop_ids = await db.user_properties.distinct("property_id", {"user_id": user_id})
        for pid in prop_ids:
            res = await try_auto_collect_property(db, user_id, pid)
            if res:
                amt = float(res.get("amount") or 0)
                prop_cash += amt
                out["properties"].append({"property_id": pid, "message": res.get("message"), "amount": amt})
        # Property Auto Collect perk: deposit collected income into the racket vault instead of the
        # wallet (the collect call above already credited user.money; move it over atomically).
        if route_property_cash_to_vault and prop_cash > 0:
            vault_amt = int(prop_cash)
            try:
                biz = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0, "id": 1})
                if biz and vault_amt > 0:
                    moved = await db.users.update_one(
                        {"id": user_id, "money": {"$gte": vault_amt}},
                        {"$inc": {"money": -vault_amt}},
                    )
                    if moved.modified_count:
                        await db.illegal_businesses.update_one(
                            {"id": biz["id"]},
                            {"$inc": {"vault": vault_amt, "vault_lifetime_earned": vault_amt}},
                        )
                        out["property_cash_to_vault"] = vault_amt
                        vault_cash = vault_amt
            except Exception as e:
                logger.warning("auto_collect vault routing for %s: %s", user_id, e)

    if collect_rackets and family_id:
        fam = await db.families.find_one({"id": family_id}, {"_id": 0, "rackets": 1})
        rackets = (fam or {}).get("rackets") or {}
        for racket_id, state in rackets.items():
            if int((state or {}).get("level") or 0) <= 0:
                continue
            res = await try_auto_collect_family_racket(db, user_id, racket_id)
            if res:
                racket_cash += int(res.get("amount") or 0)
                out["rackets"].append({"racket_id": racket_id, "amount": res.get("amount")})

    upkeep_paid = 0
    heat_paid = 0
    if pay_upkeep or clear_heat:
        from routers.money.properties import auto_clear_properties_heat, auto_pay_property_upkeep

        u = await db.users.find_one(
            {"id": user_id},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "property_upkeep_paid_until": 1,
                "properties_heat": 1,
                "properties_heat_last_at": 1,
            },
        )
        if u:
            if pay_upkeep:
                try:
                    res = await auto_pay_property_upkeep(u)
                    if res:
                        upkeep_paid = int(res.get("amount") or 0)
                        out["upkeep"] = res
                except Exception as e:
                    logger.debug("auto_collect upkeep for %s: %s", user_id, e)
            if clear_heat:
                try:
                    res = await auto_clear_properties_heat(u)
                    if res:
                        heat_paid = int(res.get("amount") or 0)
                        out["heat"] = res
                except Exception as e:
                    logger.debug("auto_collect heat for %s: %s", user_id, e)

    # Lifetime pass stats so My Inventory can show what the pass has earned.
    collects = len(out["properties"]) + len(out["rackets"])
    if collects or upkeep_paid or heat_paid:
        now_iso = datetime.now(timezone.utc).isoformat()
        inc: Dict[str, int] = {}
        set_doc: Dict[str, Any] = {}
        if collects:
            inc["auto_collect_stats.property_cash"] = int(prop_cash)
            inc["auto_collect_stats.racket_cash"] = int(racket_cash)
            inc["auto_collect_stats.collects"] = collects
            if vault_cash:
                # Portion of property_cash the perk banked into the racket vault (not the wallet).
                inc["auto_collect_stats.vault_cash"] = int(vault_cash)
            set_doc["auto_collect_stats.last_collected_at"] = now_iso
            set_doc["auto_collect_stats.last_cash"] = int(prop_cash) + int(racket_cash)
        if upkeep_paid:
            inc["auto_collect_stats.upkeep_paid"] = upkeep_paid
        if heat_paid:
            inc["auto_collect_stats.heat_bribes_paid"] = heat_paid
        update: Dict[str, Any] = {}
        if inc:
            update["$inc"] = inc
        if set_doc:
            update["$set"] = set_doc
        try:
            await db.users.update_one({"id": user_id}, update)
        except Exception as e:
            logger.debug("auto_collect stats update for %s: %s", user_id, e)
    return out


async def run_auto_collect_tick(db) -> Dict[str, Any]:
    from utils.store_item_flags import get_store_item_flags, store_item_allowed, store_item_enabled

    flags = await get_store_item_flags(db)
    flag_live = store_item_enabled(flags, "auto_collect")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    cursor = db.users.find(
        {
            "$or": [
                {"auto_collect_until": {"$gt": now_iso}},
                {"property_auto_collect_until": {"$gt": now_iso}},
            ],
            "is_dead": {"$ne": True},
        },
        {
            "_id": 0,
            "id": 1,
            "family_id": 1,
            "email": 1,
            "is_admin": 1,
            "is_moderator": 1,
            "auto_collect_until": 1,
            "property_auto_collect_until": 1,
            "property_auto_collect_enabled": 1,
        },
    ).limit(250)

    users = await cursor.to_list(250)
    # Record the tick time so the UI can show when the next collect check runs.
    try:
        await db.game_settings.update_one(
            {"_id": "main"},
            {"$set": {"auto_collect_last_tick_at": now_iso}},
            upsert=True,
        )
    except Exception:
        pass
    total_props = 0
    total_rackets = 0
    total_upkeep = 0
    total_heat = 0
    processed = 0
    for u in users:
        uid = u.get("id")
        if not uid:
            continue
        # Store auto-collect pass (family rackets only); flag gating applies to the pass only.
        has_pass = str(u.get("auto_collect_until") or "") > now_iso
        if has_pass and not flag_live and not store_item_allowed(flags, "auto_collect", u):
            has_pass = False
        # Property Auto Collect perk (Business-progress unlock): properties + upkeep + heat, honours the toggle.
        has_perk = (
            str(u.get("property_auto_collect_until") or "") > now_iso
            and bool(u.get("property_auto_collect_enabled"))
        )
        if not has_pass and not has_perk:
            continue
        processed += 1
        try:
            res = await run_auto_collect_for_user(
                db,
                uid,
                u.get("family_id"),
                # Properties are only auto-collected by the Property Auto Collect perk;
                # the store pass is rackets-only (properties have their own perk).
                collect_properties=has_perk,
                collect_rackets=has_pass,
                pay_upkeep=has_perk,
                clear_heat=has_perk,
                # Perk-collected property income banks into the racket vault, not the wallet.
                route_property_cash_to_vault=has_perk,
            )
            total_props += len(res.get("properties") or [])
            total_rackets += len(res.get("rackets") or [])
            if res.get("upkeep"):
                total_upkeep += 1
            if res.get("heat"):
                total_heat += 1
        except Exception as e:
            logger.exception("auto_collect user %s: %s", uid, e)

    return {
        "users": processed,
        "candidates": len(users),
        "flag_live": flag_live,
        "properties_collected": total_props,
        "rackets_collected": total_rackets,
        "upkeep_paid": total_upkeep,
        "heat_cleared": total_heat,
    }


async def run_auto_collect_ticker(db):
    while True:
        try:
            await run_auto_collect_tick(db)
        except Exception as e:
            logger.exception("Auto-collect ticker: %s", e)
        await asyncio.sleep(AUTO_COLLECT_TICKER_SECONDS)
