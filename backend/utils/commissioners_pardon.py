"""Commissioner's Pardon + new loot exclusives (BAR / Brewster L8).

Loot drops gated by game_settings loot_new_exclusives_live (default off).
Perk: no sell/gift; PvP transfer_count max 2 then returns to pool; never revive-restored.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

WEAPON_LOOT_BAR_ID = "weapon_loot_bar"
WEAPON_LOOT_BAR_NAME = "Browning Automatic Rifle M1918A2"
LOOT_EXCLUSIVE_ARMOUR_LEVEL_V2 = 8
ARMOUR_LEVEL_8_NAME = "Brewster Body Shield (1917)"

PARDON_ITEM_ID = "commissioners_pardon"
PARDON_NAME = "Commissioner's Pardon"
PARDON_COLLECTION = "commissioners_pardon_ownership"
PARDON_MAX_TRANSFERS = 2
PARDON_WEEKLY_POINTS = 3500
PARDON_MONTHLY_SKIP_TOKENS = 5
PARDON_LADDER_MANUAL_TARGET = 75  # of 100
PARDON_SKIP_COUNT = 25
PARDON_NEAR_FINISH_FRAC = 0.75

GAME_SETTINGS_NEW_EXCLUSIVES_LIVE_KEY = "loot_new_exclusives_live"
LOOT_COUNTS_KEY_BAR = "weapon_bar"
LOOT_COUNTS_KEY_ARMOUR8 = "armour_v2"
LOOT_COUNTS_KEY_PARDON = "mission_perk"

NEW_EXCLUSIVE_CAP_BAR = 1
NEW_EXCLUSIVE_CAP_ARMOUR8 = 1
NEW_EXCLUSIVE_CAP_PARDON = 1

# Secret: first N lifetime opens cannot drop new exclusives; then this chance.
NEW_EXCLUSIVE_MIN_OPENS = 10
NEW_EXCLUSIVE_CHANCE = 0.05

BAR_ATTACK_BULLET_MULT = 0.70

PROFILE_WEAPON_FIELD = "profile_weapon_id"  # user field: show BAR on profile


async def new_exclusives_live(db) -> bool:
    doc = await db.game_settings.find_one(
        {"key": GAME_SETTINGS_NEW_EXCLUSIVES_LIVE_KEY},
        {"_id": 0, "value": 1},
    )
    return bool((doc or {}).get("value"))


async def set_new_exclusives_live(db, live: bool) -> bool:
    await db.game_settings.update_one(
        {"key": GAME_SETTINGS_NEW_EXCLUSIVES_LIVE_KEY},
        {"$set": {"value": bool(live), "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return bool(live)


def utc_week_key(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    iso = now.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def utc_month_key(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"{now.year}-{now.month:02d}"


async def user_has_bar(db, user_id: str) -> bool:
    uw = await db.user_weapons.find_one(
        {"user_id": user_id, "weapon_id": WEAPON_LOOT_BAR_ID, "quantity": {"$gte": 1}},
        {"_id": 1},
    )
    return uw is not None


async def user_has_armour_v2(user: Dict[str, Any]) -> bool:
    lv = LOOT_EXCLUSIVE_ARMOUR_LEVEL_V2
    return int(user.get("armour_level") or 0) >= lv or int(user.get("armour_owned_level_max") or 0) >= lv


async def count_live_bar(db) -> int:
    return int(await db.user_weapons.count_documents({"weapon_id": WEAPON_LOOT_BAR_ID, "quantity": {"$gte": 1}}))


async def count_live_armour_v2(db) -> int:
    lv = LOOT_EXCLUSIVE_ARMOUR_LEVEL_V2
    return int(
        await db.users.count_documents(
            {
                "$or": [
                    {"armour_level": {"$gte": lv}},
                    {"armour_owned_level_max": {"$gte": lv}},
                ]
            }
        )
    )


async def get_pardon_doc(db, *, owner_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if owner_id:
        return await db[PARDON_COLLECTION].find_one({"owner_id": owner_id}, {"_id": 0})
    return await db[PARDON_COLLECTION].find_one({"owner_id": {"$exists": True, "$nin": [None, ""]}}, {"_id": 0})


async def user_has_pardon(db, user_id: str) -> bool:
    doc = await get_pardon_doc(db, owner_id=user_id)
    return doc is not None


async def count_live_pardon(db) -> int:
    return int(await db[PARDON_COLLECTION].count_documents({"owner_id": {"$exists": True, "$nin": [None, ""]}}))


def _deterministic_skip_mission_ids(all_mission_ids: List[str], completed: Set[str], n: int) -> List[str]:
    """Pick up to n incomplete mission ids evenly spaced for auto-skip rewards."""
    remaining = [mid for mid in all_mission_ids if mid not in completed]
    if not remaining or n <= 0:
        return []
    if len(remaining) <= n:
        return list(remaining)
    # Evenly sample across remaining ladder
    out = []
    step = len(remaining) / float(n)
    for i in range(n):
        idx = min(len(remaining) - 1, int(i * step + step * 0.5))
        mid = remaining[idx]
        if mid not in out:
            out.append(mid)
    # Fill if collisions
    for mid in remaining:
        if len(out) >= n:
            break
        if mid not in out:
            out.append(mid)
    return out[:n]


async def grant_bar(db, user_id: str, *, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    if await user_has_bar(db, user_id):
        return {"ok": False, "detail": "User already owns the BAR"}
    if await count_live_bar(db) >= NEW_EXCLUSIVE_CAP_BAR:
        return {"ok": False, "detail": "BAR global cap reached"}
    await db.user_weapons.update_one(
        {"user_id": user_id, "weapon_id": WEAPON_LOOT_BAR_ID},
        {"$inc": {"quantity": 1}, "$set": {"acquired_at": now.isoformat()}},
        upsert=True,
    )
    return {"ok": True, "weapon_id": WEAPON_LOOT_BAR_ID, "name": WEAPON_LOOT_BAR_NAME}


async def grant_armour_v2(db, user_id: str) -> Dict[str, Any]:
    lv = LOOT_EXCLUSIVE_ARMOUR_LEVEL_V2
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "armour_level": 1, "armour_owned_level_max": 1})
    if not user:
        return {"ok": False, "detail": "User not found"}
    if await user_has_armour_v2(user):
        return {"ok": False, "detail": "User already owns Brewster armour"}
    if await count_live_armour_v2(db) >= NEW_EXCLUSIVE_CAP_ARMOUR8:
        return {"ok": False, "detail": "Brewster armour global cap reached"}
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"armour_level": lv, "armour_owned_level_max": lv}},
    )
    return {"ok": True, "level": lv, "name": ARMOUR_LEVEL_8_NAME}


async def _apply_pardon_on_grant_missions(db, user: Dict[str, Any]) -> Dict[str, Any]:
    """Near-finish current + schedule/auto-complete skip missions with full rewards."""
    from routers.account.missions import (
        _build_mission_completion_reward_update,
        _current_open_mission,
        _mission_completion_reward_mult,
        _run_mission_completion_side_effects,
        _user_completed_mission_ids,
        admin_apply_mission_progress,
        apply_season_rp_mirror_to_update,
        mission_ladder_missions,
        rank_points_in_update,
    )

    user_id = user.get("id") or ""
    completed = _user_completed_mission_ids(user)
    ladder = mission_ladder_missions()
    all_ids = [m["id"] for m in ladder]
    completed_count = len([mid for mid in all_ids if mid in completed])
    meta_out: Dict[str, Any] = {
        "completed_before": completed_count,
        "auto_completed": [],
        "skip_mission_ids": [],
        "near_finished": False,
    }

    # Refresh user after each mutation
    async def _fresh() -> Dict[str, Any]:
        return await db.users.find_one({"id": user_id}, {"_id": 0}) or user

    if completed_count >= PARDON_LADDER_MANUAL_TARGET:
        # Dump remaining with rewards via admin progress to 101
        try:
            await admin_apply_mission_progress(user_id, 101, grant_skipped_rewards=True)
            meta_out["auto_completed"] = [mid for mid in all_ids if mid not in completed]
        except Exception:
            logger.exception("pardon dump remaining missions failed user=%s", user_id)
        return meta_out

    skip_ids = _deterministic_skip_mission_ids(all_ids, completed, PARDON_SKIP_COUNT)
    meta_out["skip_mission_ids"] = skip_ids
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"pardon_auto_skip_mission_ids": skip_ids}},
    )

    # Near-finish current open mission (75% of remaining requirements count as filled).
    user = await _fresh()
    mission = _current_open_mission(user)
    if mission:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"pardon_near_finish_mission_id": mission["id"]}},
        )
        meta_out["near_finished"] = True
        meta_out["near_finish_mission_id"] = mission["id"]

    # Auto-complete any skip missions that are already the current open mission
    user = await _fresh()
    for _ in range(PARDON_SKIP_COUNT + 2):
        user = await _fresh()
        mission = _current_open_mission(user)
        if not mission:
            break
        mid = mission["id"]
        if mid not in skip_ids:
            break
        try:
            mult = _mission_completion_reward_mult(user)
            update, meta = _build_mission_completion_reward_update(
                user,
                mid,
                mission,
                mult,
                include_mission_completion_push=True,
                include_next_mission_baseline=True,
            )
            mission_update = apply_season_rp_mirror_to_update(update, user=user)
            result = await db.users.update_one(
                {"id": user_id, "mission_completions.mission_id": {"$ne": mid}},
                mission_update,
            )
            if result.modified_count == 0:
                break
            await _run_mission_completion_side_effects(
                user_id,
                user,
                mid,
                meta,
                rp_awarded=rank_points_in_update(mission_update),
            )
            meta_out["auto_completed"].append(mid)
        except Exception:
            logger.exception("pardon auto-skip complete failed user=%s mission=%s", user_id, mid)
            break

    return meta_out


async def _safe_apply_pardon_on_grant(db, user_id: str) -> Dict[str, Any]:
    user = await db.users.find_one({"id": user_id}, {"_id": 0}) or {"id": user_id}
    try:
        return await _apply_pardon_on_grant_missions(db, user)
    except Exception as e:
        logger.exception("pardon on-grant missions failed user=%s", user_id)
        return {"error": True, "detail": f"{type(e).__name__}: {e}"}


async def grant_pardon(db, user_id: str, *, now: Optional[datetime] = None, run_on_grant: bool = True) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    if await count_live_pardon(db) >= NEW_EXCLUSIVE_CAP_PARDON:
        existing = await get_pardon_doc(db)
        if existing and existing.get("owner_id") == user_id:
            # Same owner: still (re)apply mission effects if on-grant was skipped/failed earlier
            mission_meta = {}
            if run_on_grant:
                u = await db.users.find_one({"id": user_id}, {"_id": 0, "pardon_auto_skip_mission_ids": 1}) or {}
                if not (u.get("pardon_auto_skip_mission_ids") or []):
                    await db.users.update_one({"id": user_id}, {"$set": {"has_commissioners_pardon": True}})
                    mission_meta = await _safe_apply_pardon_on_grant(db, user_id)
            return {"ok": True, "already": True, "name": PARDON_NAME, "mission_meta": mission_meta}
        return {"ok": False, "detail": "Commissioner's Pardon already claimed"}
    if await user_has_pardon(db, user_id):
        mission_meta = {}
        if run_on_grant:
            u = await db.users.find_one({"id": user_id}, {"_id": 0, "pardon_auto_skip_mission_ids": 1}) or {}
            if not (u.get("pardon_auto_skip_mission_ids") or []):
                mission_meta = await _safe_apply_pardon_on_grant(db, user_id)
        return {"ok": True, "already": True, "name": PARDON_NAME, "mission_meta": mission_meta}

    doc = {
        "id": PARDON_ITEM_ID,
        "owner_id": user_id,
        "transfer_count": 0,
        "granted_at": now.isoformat(),
        "last_points_week": None,
        "last_skip_month": None,
    }
    await db[PARDON_COLLECTION].delete_many({})  # enforce single live instance
    await db[PARDON_COLLECTION].insert_one(doc)
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"has_commissioners_pardon": True}},
    )
    mission_meta = {}
    if run_on_grant:
        mission_meta = await _safe_apply_pardon_on_grant(db, user_id)
    return {"ok": True, "name": PARDON_NAME, "mission_meta": mission_meta}


async def reclaim_pardon_to_pool(db, *, reason: str = "reclaim") -> Optional[str]:
    """Clear ownership; returns previous owner_id if any."""
    doc = await db[PARDON_COLLECTION].find_one({})
    if not doc:
        return None
    owner_id = (doc.get("owner_id") or "").strip() or None
    await db[PARDON_COLLECTION].delete_many({})
    if owner_id:
        await db.users.update_one(
            {"id": owner_id},
            {
                "$unset": {
                    "has_commissioners_pardon": "",
                    "pardon_auto_skip_mission_ids": "",
                    "pardon_near_finish_mission_id": "",
                }
            },
        )
    logger.info("commissioners_pardon reclaimed reason=%s prev_owner=%s", reason, owner_id)
    return owner_id


async def handle_pardon_on_kill(
    db,
    *,
    victim_id: str,
    killer_id: str,
    send_notification=None,
) -> Dict[str, Any]:
    """Transfer up to PARDON_MAX_TRANSFERS, else return to loot pool."""
    doc = await get_pardon_doc(db, owner_id=victim_id)
    if not doc:
        return {"acted": False}
    tc = int(doc.get("transfer_count") or 0)
    killer_has = await user_has_pardon(db, killer_id)
    if tc >= PARDON_MAX_TRANSFERS or killer_has:
        await reclaim_pardon_to_pool(db, reason="kill_cap_or_killer_owns")
        if send_notification:
            try:
                await send_notification(
                    victim_id,
                    "Commissioner's Pardon",
                    "Your Commissioner's Pardon returned to the loot pool.",
                    "system",
                )
            except Exception:
                pass
        return {"acted": True, "result": "reclaimed_to_pool", "transfer_count": tc}

    new_tc = tc + 1
    await db[PARDON_COLLECTION].update_one(
        {"owner_id": victim_id},
        {
            "$set": {
                "owner_id": killer_id,
                "transfer_count": new_tc,
                "transferred_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    await db.users.update_one(
        {"id": victim_id},
        {"$unset": {"has_commissioners_pardon": "", "pardon_auto_skip_mission_ids": "", "pardon_near_finish_mission_id": ""}},
    )
    await db.users.update_one(
        {"id": killer_id},
        {"$set": {"has_commissioners_pardon": True}},
    )
    # Move skip list if present
    victim = await db.users.find_one({"id": victim_id}, {"_id": 0, "pardon_auto_skip_mission_ids": 1})
    # Killer does not inherit auto-skip schedule (plan: ownership moves only)
    if send_notification:
        try:
            await send_notification(
                killer_id,
                "Commissioner's Pardon",
                f"You took the Commissioner's Pardon (transfer {new_tc}/{PARDON_MAX_TRANSFERS}).",
                "system",
            )
        except Exception:
            pass
    return {"acted": True, "result": "transferred", "transfer_count": new_tc}


async def maybe_collect_pardon_periodic(db, user_id: str) -> Dict[str, Any]:
    """Weekly points + monthly mission skips while owned. Idempotent per week/month."""
    doc = await get_pardon_doc(db, owner_id=user_id)
    if not doc:
        return {"ok": False}
    now = datetime.now(timezone.utc)
    week = utc_week_key(now)
    month = utc_month_key(now)
    out: Dict[str, Any] = {"points": 0, "mission_skip_tokens": 0}
    sets: Dict[str, Any] = {}
    incs: Dict[str, int] = {}
    if doc.get("last_points_week") != week:
        incs["points"] = PARDON_WEEKLY_POINTS
        sets["last_points_week"] = week
        out["points"] = PARDON_WEEKLY_POINTS
    if doc.get("last_skip_month") != month:
        incs["mission_skip_tokens"] = PARDON_MONTHLY_SKIP_TOKENS
        sets["last_skip_month"] = month
        out["mission_skip_tokens"] = PARDON_MONTHLY_SKIP_TOKENS
    if not sets:
        return {"ok": True, **out, "already": True}
    await db[PARDON_COLLECTION].update_one({"owner_id": user_id}, {"$set": sets})
    if incs:
        await db.users.update_one({"id": user_id}, {"$inc": incs})
        if out.get("points"):
            try:
                from utils.point_provenance import log_points_event
                await log_points_event(
                    db,
                    user_id=user_id,
                    points=int(out["points"]),
                    event_type="commissioners_pardon_weekly",
                    meta={"week": week},
                )
            except Exception:
                logger.exception("pardon weekly points ledger failed user=%s", user_id)
    return {"ok": True, **out}


async def maybe_auto_complete_pardon_skip(db, user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """If current open mission is in pardon_auto_skip_mission_ids, complete with rewards."""
    user_id = user.get("id") or ""
    if not user_id or not user.get("has_commissioners_pardon"):
        return None
    skip_ids = set(user.get("pardon_auto_skip_mission_ids") or [])
    if not skip_ids:
        return None
    from routers.account.missions import (
        _build_mission_completion_reward_update,
        _current_open_mission,
        _mission_completion_reward_mult,
        _run_mission_completion_side_effects,
        apply_season_rp_mirror_to_update,
        rank_points_in_update,
    )

    mission = _current_open_mission(user)
    if not mission or mission["id"] not in skip_ids:
        return None
    mid = mission["id"]
    mult = _mission_completion_reward_mult(user)
    update, meta = _build_mission_completion_reward_update(
        user,
        mid,
        mission,
        mult,
        include_mission_completion_push=True,
        include_next_mission_baseline=True,
    )
    mission_update = apply_season_rp_mirror_to_update(update, user=user)
    result = await db.users.update_one(
        {"id": user_id, "mission_completions.mission_id": {"$ne": mid}},
        mission_update,
    )
    if result.modified_count == 0:
        return None
    await _run_mission_completion_side_effects(
        user_id,
        user,
        mid,
        meta,
        rp_awarded=rank_points_in_update(mission_update),
    )
    return {"completed": mid, "skipped_by_pardon": True}


def attack_bullet_mult_for_weapon(weapon_id: Optional[str]) -> float:
    wid = (weapon_id or "").strip()
    if wid == WEAPON_LOOT_BAR_ID:
        return BAR_ATTACK_BULLET_MULT
    if wid == "weapon_loot":
        return 0.75
    return 1.0


def pardon_not_tradable_detail() -> str:
    return (
        "Commissioner's Pardon cannot be sold or gifted. "
        "It only moves on kill (max 2 transfers) or returns to the loot pool."
    )
