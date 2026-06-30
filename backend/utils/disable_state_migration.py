"""
Admin migration: remove a city from active play (e.g. Atlantic City).

Preview counts + live run: relinquish properties, relocate users/hitlist NPCs/robots, patch hunts/rackets, scrub booze, sync robots. Global events/hot-cold use STATES at runtime (no DB migration).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from pymongo import UpdateOne

DISABLE_STATE_CONFIRM_PHRASE = "DISABLE ATLANTIC CITY"
DISABLE_STATE_SETTINGS_KEY = "disabled_states"


def _norm_state(name: str) -> str:
    return (name or "").strip()


def _fallback_city(active_states: List[str]) -> str:
    return active_states[0] if active_states else "Chicago"


async def _count_robots_in_state(db, state: str) -> int:
    return await db.users.count_documents(
        {
            "current_state": state,
            "is_npc": True,
            "is_bodyguard": True,
        }
    )


async def _count_players_in_state(db, state: str) -> int:
    return await db.users.count_documents(
        {
            "current_state": state,
            "$or": [{"is_npc": {"$ne": True}}, {"is_npc": {"$exists": False}}],
        }
    )


async def _count_hitlist_npcs_in_state(db, state: str) -> int:
    """Practice hitlist NPCs (is_npc, not bodyguard robots) sitting in this city."""
    return await db.users.count_documents(
        {
            "current_state": state,
            "is_npc": True,
            "$or": [{"is_bodyguard": {"$ne": True}}, {"is_bodyguard": {"$exists": False}}],
        }
    )


async def _count_illegal_businesses_in_state(db, state: str) -> int:
    return await db.illegal_businesses.count_documents({"state": state})


async def _count_users_unlocked_maps_in_state(db, state: str) -> int:
    return await db.users.count_documents({"unlocked_maps_up_to": state})


def _mission_defs_referencing_state(state: str) -> List[str]:
    """Mission config ids with in_state == state (should be empty for disabled cities)."""
    try:
        from routers.account.missions import MISSIONS

        return [
            str(m.get("id") or "")
            for m in MISSIONS
            if (m.get("requirements") or {}).get("in_state") == state
        ]
    except Exception:
        return []


def _global_events_preview(active_states: List[str], disabled_state: str) -> Dict[str, Any]:
    """
    Daily game events + hot/cold climate are computed from STATES (no DB city fields).
    Preview confirms disabled city is excluded from rotation after deploy.
    """
    active = list(active_states or [])
    out: Dict[str, Any] = {
        "game_events_have_city_fields": False,
        "booze_rotation_cities": len(active),
    }
    try:
        from utils.location_climate import get_location_climate

        climate = get_location_climate()
        by_city = dict(climate.get("by_city") or {})
        hot = climate.get("hot")
        cold = climate.get("cold")
        out["location_climate"] = {
            "hot": hot,
            "cold": cold,
            "by_city": by_city,
            "period_ends_at": climate.get("period_ends_at"),
        }
        out["climate_cities_match_active_states"] = set(by_city.keys()) == set(active)
        out["disabled_state_in_climate"] = disabled_state in by_city or hot == disabled_state or cold == disabled_state
        out["hot_cold_in_active_states"] = (
            (hot is None and cold is None)
            or (hot in active and cold in active and hot != cold)
        )
    except Exception as exc:
        out["location_climate_error"] = str(exc)
    return out


def _systems_audit_preview(active_states: List[str], disabled_state: str) -> Dict[str, str]:
    """Per-system notes: what uses STATES at runtime vs what the live migration patches."""
    n = len(active_states or [])
    return {
        "travel_airports": f"Destinations from STATES ({n} cities); travel to {disabled_state} rejected after deploy",
        "states_casinos_page": f"Built from STATES; {disabled_state} rows kept dormant after relinquish",
        "booze_run_auto_rank": f"Price matrix and routes use STATES ({n} cities); buy-location scrubbed",
        "crimes_gta_jail": "Hot/cold climate shuffles STATES; invalid city = neutral multipliers",
        "casinos_all_types": "Play/actions require city in STATES; QT casino listings cancelled on relinquish",
        "armoury_keno": "Actions validate state in STATES",
        "daily_game_events": "Global multipliers only — no city field",
        "hot_cold_climate": "Computed from STATES each period — no DB",
        "missions": "Single Start ladder; no steps require disabled city",
        "ibm_illegal_business": "business.state patched to fallback on migration",
        "family_rackets_oc": "Not tied to a travel city",
        "hitlist_kill_hunts": "NPC users relocated; attack location fields patched",
        "bodyguards": "New robot spawns use random.choice(STATES)",
        "quicktrade": "Active listings in disabled city cancelled on migration",
        "state_heads_takeover": "Head cleared; pending_state_takeover to disabled city cleared",
        "properties_garage_sports": "Garage/sports QT are global (not per travel city)",
        "minigames_sports_mp_poker": "Not tied to travel cities",
        "lottery_worldcup_gamepass": "Not tied to travel cities",
        "analytics_logs": "Historical rows may still mention old city (cosmetic only)",
    }


async def _count_families_pending_takeover(db, state: str) -> int:
    return await db.families.count_documents({"pending_state_takeover": state})


async def _attack_counts(db, state: str) -> Dict[str, int]:
    base = {
        "$or": [
            {"location_state": state},
            {"planned_location_state": state},
        ]
    }
    total = await db.attacks.count_documents(base)
    searching = await db.attacks.count_documents({**base, "status": "searching"})
    found = await db.attacks.count_documents({**base, "status": "found"})
    return {"total": total, "searching": searching, "found": found}


async def _owned_properties_preview(db, state: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    casino_specs = [
        ("dice", "dice_ownership", "city"),
        ("roulette", "roulette_ownership", "city"),
        ("blackjack", "blackjack_ownership", "city"),
        ("horseracing", "horseracing_ownership", "city"),
        ("videopoker", "videopoker_ownership", "city"),
        ("slots", "slots_ownership", "state"),
    ]
    for kind, coll_name, loc_key in casino_specs:
        coll = getattr(db, coll_name)
        async for doc in coll.find({loc_key: state, "owner_id": {"$exists": True, "$nin": [None, ""]}}):
            rows.append(
                {
                    "kind": kind,
                    "location": doc.get(loc_key) or state,
                    "owner_id": doc.get("owner_id"),
                    "owner_username": doc.get("owner_username"),
                    "buy_back_reward": int(doc.get("buy_back_reward") or 0),
                }
            )
    async for doc in db.airport_ownership.find({"state": state, "owner_id": {"$exists": True, "$nin": [None, ""]}}):
        rows.append(
            {
                "kind": "airport",
                "location": f"{state} slot {doc.get('slot')}",
                "owner_id": doc.get("owner_id"),
                "owner_username": doc.get("owner_username"),
                "slot": doc.get("slot"),
            }
        )
    bf = await db.bullet_factory.find_one({"state": state, "owner_id": {"$exists": True, "$nin": [None, ""]}})
    if bf and bf.get("owner_id"):
        rows.append(
            {
                "kind": "armoury",
                "location": state,
                "owner_id": bf.get("owner_id"),
                "owner_username": bf.get("owner_username"),
            }
        )
    return rows


async def _quicktrade_count(db, state: str) -> int:
    try:
        return await db.properties.count_documents(
            {
                "for_sale": True,
                "location": {"$regex": f"^{re.escape(state)}$", "$options": "i"},
            }
        )
    except Exception:
        return 0


async def _head_family_preview(db, state: str) -> Optional[Dict[str, Any]]:
    doc = await db.game_settings.find_one({"key": "state_heads"}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value") or {}
    fid = None
    for k, v in raw.items():
        if str(k).strip().lower() == state.strip().lower():
            fid = (v or "").strip() or None
            break
    if not fid:
        fam = await db.families.find_one(
            {"head_of_state": {"$regex": f"^{re.escape(state)}$", "$options": "i"}},
            {"_id": 0, "id": 1, "name": 1, "tag": 1},
        )
        if fam:
            return {"family_id": fam.get("id"), "name": fam.get("name"), "tag": fam.get("tag"), "source": "families.head_of_state"}
        return None
    fam = await db.families.find_one({"id": fid}, {"_id": 0, "id": 1, "name": 1, "tag": 1})
    return {
        "family_id": fid,
        "name": (fam or {}).get("name"),
        "tag": (fam or {}).get("tag"),
        "source": "game_settings.state_heads",
    }


async def get_disable_state_record(db) -> List[str]:
    doc = await db.game_settings.find_one({"key": DISABLE_STATE_SETTINGS_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    if isinstance(raw, list):
        return [str(x) for x in raw if x]
    if isinstance(raw, dict):
        return [str(k) for k, v in raw.items() if v]
    return []


async def preview_disable_state(db, state: str, active_states: List[str]) -> Dict[str, Any]:
    state = _norm_state(state)
    owned = await _owned_properties_preview(db, state)
    return {
        "state": state,
        "active_states": list(active_states or []),
        "fallback_relocate_to": _fallback_city(active_states),
        "users_in_state": await _count_players_in_state(db, state),
        "hitlist_npcs_in_state": await _count_hitlist_npcs_in_state(db, state),
        "robot_bodyguards_in_state": await _count_robots_in_state(db, state),
        "traveling_to_state": await db.users.count_documents({"traveling_to": state}),
        "attacks": await _attack_counts(db, state),
        "owned_properties": owned,
        "owned_property_count": len(owned),
        "quick_trade_listings": await _quicktrade_count(db, state),
        "illegal_businesses_in_state": await _count_illegal_businesses_in_state(db, state),
        "users_unlocked_maps_up_to_state": await _count_users_unlocked_maps_in_state(db, state),
        "mission_defs_requiring_state": _mission_defs_referencing_state(state),
        "global_events": _global_events_preview(active_states, state),
        "systems_audit": _systems_audit_preview(active_states, state),
        "families_pending_state_takeover": await _count_families_pending_takeover(db, state),
        "head_family": await _head_family_preview(db, state),
        "already_disabled": state in await get_disable_state_record(db),
    }


async def _relinquish_casino_row(
    db,
    *,
    coll,
    loc_key: str,
    location: str,
    offers_coll: str,
    points_event_type: str,
    qt_type: str,
    doc: dict,
    stats: Dict[str, Any],
) -> None:
    from server import CASINO_MIN_OWNER_MAX_BET, refund_and_delete_buy_back_offers_matching, refund_casino_buy_back_escrow_points

    owner_id = str(doc.get("owner_id") or "")
    if not owner_id:
        return
    loc = str(doc.get(loc_key) or location)
    held = int(doc.get("buy_back_points_held") or 0)
    try:
        await refund_and_delete_buy_back_offers_matching(
            offers_coll,
            {loc_key: loc},
            points_event_type=points_event_type,
            meta_base={loc_key: loc, "reason": "disable_state_migration"},
        )
    except Exception:
        stats["errors"].append(f"buy_back_offers:{offers_coll}:{loc}")
    try:
        await refund_casino_buy_back_escrow_points(
            owner_id,
            held,
            event_type=points_event_type,
            meta={loc_key: loc, "reason": "disable_state_migration"},
        )
    except Exception:
        stats["errors"].append(f"escrow_refund:{owner_id}:{loc}")
    await coll.update_one(
        {loc_key: loc},
        {
            "$set": {
                "owner_id": None,
                "owner_username": None,
                "max_bet": CASINO_MIN_OWNER_MAX_BET,
                "buy_back_reward": 0,
                "buy_back_points_held": 0,
            },
            "$unset": {"below_capo_acquired_at": ""},
        },
    )
    try:
        from utils.quicktrade_casino_cleanup import cancel_quicktrade_casino_listings_by_locations

        await cancel_quicktrade_casino_listings_by_locations(qt_type, loc, loc)
    except Exception:
        stats["errors"].append(f"qt_cancel:{qt_type}:{loc}")
    stats["properties_relinquished"] += 1
    try:
        from server import send_notification

        await send_notification(
            owner_id,
            "Property relinquished",
            f"Your {qt_type.replace('casino_', '').replace('_', ' ')} in {loc} was relinquished (city no longer active). Escrowed buy-back points were refunded.",
            "system",
            category="system",
        )
    except Exception:
        pass


async def _relinquish_properties_in_state(db, state: str, stats: Dict[str, Any]) -> None:
    casino_specs: List[Tuple[str, Any, str, str, str, str]] = [
        ("dice", db.dice_ownership, "city", "dice_buy_back_offers", "casino_dice", "casino_dice"),
        ("roulette", db.roulette_ownership, "city", "roulette_buy_back_offers", "casino_rlt", "casino_roulette"),
        ("blackjack", db.blackjack_ownership, "city", "blackjack_buy_back_offers", "casino_blackjack", "casino_blackjack"),
        ("horseracing", db.horseracing_ownership, "city", "horseracing_buy_back_offers", "casino_horseracing", "casino_horseracing"),
        ("videopoker", db.videopoker_ownership, "city", "videopoker_buy_back_offers", "casino_videopoker", "casino_videopoker"),
    ]
    for _kind, coll, loc_key, offers, evt, qt in casino_specs:
        async for doc in coll.find({loc_key: state, "owner_id": {"$exists": True, "$nin": [None, ""]}}):
            await _relinquish_casino_row(
                db,
                coll=coll,
                loc_key=loc_key,
                location=state,
                offers_coll=offers,
                points_event_type=evt,
                qt_type=qt,
                doc=doc,
                stats=stats,
            )

    try:
        from routers.casinos.slots import SLOTS_FEATURE_ENABLED
    except Exception:
        SLOTS_FEATURE_ENABLED = False
    if SLOTS_FEATURE_ENABLED:
        async for doc in db.slots_ownership.find({"state": state, "owner_id": {"$exists": True, "$nin": [None, ""]}}):
            await _relinquish_casino_row(
                db,
                coll=db.slots_ownership,
                loc_key="state",
                location=state,
                offers_coll="slots_buy_back_offers",
                points_event_type="casino_slots",
                qt_type="casino_slots",
                doc=doc,
                stats=stats,
            )

    async for doc in db.airport_ownership.find({"state": state, "owner_id": {"$exists": True, "$nin": [None, ""]}}):
        owner_id = str(doc.get("owner_id") or "")
        await db.airport_ownership.update_one(
            {"state": state, "slot": doc.get("slot")},
            {"$set": {"owner_id": None, "owner_username": None}, "$unset": {"below_capo_acquired_at": ""}},
        )
        stats["properties_relinquished"] += 1
        if owner_id:
            try:
                from server import send_notification

                await send_notification(
                    owner_id,
                    "Airport slot relinquished",
                    f"Your airport slot in {state} was relinquished (city no longer active).",
                    "system",
                    category="system",
                )
            except Exception:
                pass

    bf = await db.bullet_factory.find_one({"state": state, "owner_id": {"$exists": True, "$nin": [None, ""]}})
    if bf and bf.get("owner_id"):
        owner_id = str(bf.get("owner_id"))
        await db.bullet_factory.update_one(
            {"state": state},
            {
                "$set": {"owner_id": None, "owner_username": None},
                "$unset": {"armour_sell_price_money": "", "weapon_sell_price_money": "", "below_capo_acquired_at": ""},
            },
        )
        stats["properties_relinquished"] += 1
        try:
            from server import send_notification

            await send_notification(
                owner_id,
                "Armoury relinquished",
                f"Your armoury in {state} was relinquished (city no longer active).",
                "system",
                category="system",
            )
        except Exception:
            pass


async def _clear_state_heads(db, state: str, stats: Dict[str, Any]) -> None:
    doc = await db.game_settings.find_one({"key": "state_heads"}, {"_id": 0, "value": 1})
    val = dict((doc or {}).get("value") or {})
    old_fids: List[str] = []
    for k in list(val.keys()):
        if str(k).strip().lower() == state.strip().lower():
            fid = (val.pop(k) or "").strip()
            if fid:
                old_fids.append(fid)
    if val != (doc or {}).get("value"):
        await db.game_settings.update_one(
            {"key": "state_heads"},
            {"$set": {"key": "state_heads", "value": val}},
            upsert=True,
        )
        stats["state_heads_cleared"] = True
    for fid in old_fids:
        await db.families.update_one({"id": fid}, {"$set": {"head_of_state": None}})
    res = await db.families.update_many(
        {"head_of_state": {"$regex": f"^{re.escape(state)}$", "$options": "i"}},
        {"$set": {"head_of_state": None}},
    )
    if res.modified_count:
        stats["families_head_cleared"] = int(res.modified_count)


async def _relocate_users(db, state: str, fallback: str, stats: Dict[str, Any]) -> None:
    res_travel = await db.users.update_many(
        {"traveling_to": state},
        {"$set": {"current_state": fallback}, "$unset": {"traveling_to": "", "travel_arrives_at": ""}},
    )
    stats["travel_to_state_cancelled"] = int(res_travel.modified_count)
    res_loc = await db.users.update_many(
        {"current_state": state},
        {"$set": {"current_state": fallback}},
    )
    stats["users_relocated"] = int(res_loc.modified_count)


async def _patch_attacks(db, state: str, fallback: str, active_states: List[str], stats: Dict[str, Any]) -> None:
    patched = 0
    async for attack in db.attacks.find(
        {
            "$or": [
                {"location_state": state},
                {"planned_location_state": state},
            ]
        },
        {"_id": 0, "id": 1, "target_id": 1, "location_state": 1, "planned_location_state": 1, "status": 1},
    ):
        target_id = str(attack.get("target_id") or "")
        new_loc = fallback
        if target_id:
            tu = await db.users.find_one({"id": target_id}, {"_id": 0, "current_state": 1})
            cs = (tu or {}).get("current_state")
            if cs and cs in active_states:
                new_loc = cs
        updates: Dict[str, Any] = {}
        if attack.get("location_state") == state:
            updates["location_state"] = new_loc
        if attack.get("planned_location_state") == state:
            updates["planned_location_state"] = new_loc
        if updates:
            await db.attacks.update_one({"id": attack["id"]}, {"$set": updates})
            patched += 1
    stats["attacks_patched"] = patched


async def _scrub_booze_buy_locations(db, state: str, stats: Dict[str, Any]) -> None:
    scrubbed = 0
    async for user in db.users.find(
        {"booze_buy_location": {"$exists": True, "$ne": {}}},
        {"_id": 0, "id": 1, "booze_buy_location": 1},
    ):
        bbl = user.get("booze_buy_location") or {}
        if not isinstance(bbl, dict):
            continue
        to_unset = {f"booze_buy_location.{k}": "" for k, v in bbl.items() if v == state}
        if to_unset:
            await db.users.update_one({"id": user["id"]}, {"$unset": to_unset})
            scrubbed += 1
    stats["booze_buy_location_scrubbed"] = scrubbed


async def _patch_illegal_business_states(db, state: str, fallback: str, stats: Dict[str, Any]) -> None:
    """Racket/IBM missions track crimes_in_state against illegal_businesses.state."""
    res = await db.illegal_businesses.update_many({"state": state}, {"$set": {"state": fallback}})
    stats["illegal_businesses_relocated"] = int(res.modified_count)


async def _scrub_legacy_user_state_refs(db, state: str, fallback: str, stats: Dict[str, Any]) -> None:
    res = await db.users.update_many(
        {"unlocked_maps_up_to": state},
        {"$set": {"unlocked_maps_up_to": fallback}},
    )
    stats["unlocked_maps_up_to_scrubbed"] = int(res.modified_count)


async def _clear_pending_state_takeovers(db, state: str, stats: Dict[str, Any]) -> None:
    res = await db.families.update_many(
        {"pending_state_takeover": state},
        {"$unset": {"pending_state_takeover": "", "pending_state_takeover_at": ""}},
    )
    stats["pending_state_takeovers_cleared"] = int(res.modified_count)


async def _cancel_quicktrade_listings_in_state(db, state: str, stats: Dict[str, Any]) -> None:
    """Remove active Quick Trade rows tagged to the disabled city (casino rows may already be gone)."""
    try:
        from routers.money import quicktrade as _qt

        res = await db.properties.delete_many(
            {
                "for_sale": True,
                "location": {"$regex": f"^{re.escape(state)}$", "$options": "i"},
            }
        )
        if res.deleted_count:
            _qt._invalidate_trade_caches()
        stats["quick_trade_listings_cancelled"] = int(res.deleted_count)
    except Exception:
        stats["errors"].append("quick_trade_cancel")


async def _sync_robot_bodyguards(db, active_states: List[str], stats: Dict[str, Any]) -> None:
    updated = 0
    bulk: List[UpdateOne] = []
    async for robot in db.users.find(
        {
            "is_npc": True,
            "is_bodyguard": True,
            "bodyguard_owner_id": {"$exists": True, "$nin": [None, ""]},
        },
        {"_id": 0, "id": 1, "current_state": 1, "bodyguard_owner_id": 1},
    ):
        owner_id = str(robot.get("bodyguard_owner_id") or "")
        owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "current_state": 1})
        if not owner:
            continue
        own_st = owner.get("current_state")
        if own_st not in active_states:
            continue
        if robot.get("current_state") == own_st:
            continue
        updated += 1
        bulk.append(UpdateOne({"id": robot["id"]}, {"$set": {"current_state": own_st}}))
        if len(bulk) >= 500:
            await db.users.bulk_write(bulk, ordered=False)
            bulk = []
    if bulk:
        await db.users.bulk_write(bulk, ordered=False)
    stats["robot_bodyguards_synced"] = updated


async def run_disable_state(
    db,
    *,
    state: str,
    active_states: List[str],
    dry_run: bool,
    admin_username: str,
) -> Dict[str, Any]:
    state = _norm_state(state)
    fallback = _fallback_city(active_states)
    stats: Dict[str, Any] = {
        "dry_run": dry_run,
        "state": state,
        "fallback_relocate_to": fallback,
        "properties_relinquished": 0,
        "errors": [],
    }
    preview = await preview_disable_state(db, state, active_states)
    if dry_run:
        return {"message": f"Dry run: would migrate away from {state}", "preview": preview, **stats}

    await _relinquish_properties_in_state(db, state, stats)
    await _clear_state_heads(db, state, stats)
    await _relocate_users(db, state, fallback, stats)
    await _patch_attacks(db, state, fallback, active_states, stats)
    await _scrub_booze_buy_locations(db, state, stats)
    await _patch_illegal_business_states(db, state, fallback, stats)
    await _scrub_legacy_user_state_refs(db, state, fallback, stats)
    await _clear_pending_state_takeovers(db, state, stats)
    await _cancel_quicktrade_listings_in_state(db, state, stats)
    await _sync_robot_bodyguards(db, active_states, stats)

    now_iso = datetime.now(timezone.utc).isoformat()
    disabled = await get_disable_state_record(db)
    if state not in disabled:
        disabled.append(state)
    await db.game_settings.update_one(
        {"key": DISABLE_STATE_SETTINGS_KEY},
        {
            "$set": {
                "key": DISABLE_STATE_SETTINGS_KEY,
                "value": disabled,
                f"audit.{state}": {
                    "completed_at": now_iso,
                    "by": admin_username,
                    "stats": {k: v for k, v in stats.items() if k != "errors"},
                },
            }
        },
        upsert=True,
    )
    stats["message"] = f"Disabled {state} from active play; users relocated to {fallback}."
    stats["preview_after"] = await preview_disable_state(db, state, active_states)
    return stats
