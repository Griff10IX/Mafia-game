"""Hitman for Hire — pay points for a chance to kill a target's visible robot bodyguard."""
from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from utils.store_item_flags import (
    get_store_item_flags,
    require_store_item_allowed,
    _is_staff,
)
from utils.point_provenance import consume_points_fifo, log_points_event
from utils.civilian_protection import (
    CIVILIAN_PROTECTION_HITMAN_BLOCKED_DETAIL,
    is_civilian_protected,
)

logger = logging.getLogger(__name__)

HITMAN_FLAG = "hitman_for_hire"
HITMAN_TIERS = {
    "low": {"id": "low", "label": "Street shooter", "cost": 1000, "success_rate": 0.10},
    "mid": {"id": "mid", "label": "Made man", "cost": 2500, "success_rate": 0.25},
    "high": {"id": "high", "label": "Professional", "cost": 5000, "success_rate": 0.60},
}
HITMAN_DISCOUNT_RATE = 0.75  # pay 75% = 25% off
HITMAN_FREE_RETRY_CHANCE = 0.10
HITMAN_FREE_TOKEN_CHANCE = 0.25
HITMAN_VICTIM_COOLDOWN = timedelta(hours=24)
HITMAN_DISCOUNT_WINDOW = timedelta(hours=24)
HITMAN_PROTECTION_COST = 3000
HITMAN_PROTECTION_RESPECT_COST = 5000
HITMAN_PROTECTION_DAYS = 5
HITMAN_PROTECTION_DURATION = timedelta(days=HITMAN_PROTECTION_DAYS)
HITMAN_PROTECTION_REBUY_COOLDOWN = timedelta(hours=2)


def _srv():
    import server as srv
    return srv


def _db():
    return _srv().db


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today_utc(now: Optional[datetime] = None) -> str:
    return (now or _now()).strftime("%Y-%m-%d")


def _parse_iso(val) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    try:
        s = str(val).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _has_active_counter_discount(hirer: Optional[dict], target_id: str, now: Optional[datetime] = None) -> bool:
    """True if this hirer has an active 25% counter-offer vs target (from a failed hit they took)."""
    if not hirer or not target_id:
        return False
    now = now or _now()
    until = _parse_iso(hirer.get("hitman_discount_until"))
    return bool(
        hirer.get("hitman_discount_vs_user_id") == target_id
        and until
        and until > now
    )


def _tiers_payload() -> List[dict]:
    return [
        {
            "id": t["id"],
            "label": t["label"],
            "cost": t["cost"],
            "discount_cost": int(t["cost"] * HITMAN_DISCOUNT_RATE),
            "success_pct": int(round(t["success_rate"] * 100)),
        }
        for t in HITMAN_TIERS.values()
    ]


def _stats_from_user(u: dict) -> dict:
    return {
        "hires": int(u.get("hitman_hires") or 0),
        "points_spent": int(u.get("hitman_points_spent") or 0),
        "kills": int(u.get("hitman_kills") or 0),
    }


def _hirer_is_staff_for_street_stats(user: Optional[dict]) -> bool:
    """Staff testing must not inflate Street Ledger / public kill feeds."""
    if not user:
        return False
    if _is_staff(user):
        return True
    try:
        from server import _user_excluded_from_stat_leaderboards

        return bool(_user_excluded_from_stat_leaderboards(user))
    except Exception:
        return False


async def _staff_hirer_ids_for_street_stats() -> List[str]:
    """User ids that should never count toward Street Ledger (mods + admin emails)."""
    try:
        from server import honours_stat_excluded_user_ids

        return list(await honours_stat_excluded_user_ids(_db()))
    except Exception:
        logger.exception("hitman staff hirer ids")
        return []


async def _game_wide_stats() -> dict:
    """Aggregate Hitman for Hire activity from hitman_events (excludes staff testing)."""
    empty = {
        "hires": 0,
        "kills": 0,
        "fails": 0,
        "points_spent": 0,
        "unique_hirers": 0,
        "unique_victims": 0,
    }
    try:
        staff_ids = await _staff_hirer_ids_for_street_stats()
        match: Dict[str, Any] = {"staff_hire": {"$ne": True}}
        if staff_ids:
            match["hirer_id"] = {"$nin": staff_ids}
        rows = await _db().hitman_events.aggregate(
            [
                {"$match": match},
                {
                    "$facet": {
                        "totals": [
                            {
                                "$group": {
                                    "_id": None,
                                    "hires": {"$sum": 1},
                                    "kills": {"$sum": {"$cond": ["$success", 1, 0]}},
                                    "fails": {
                                        "$sum": {
                                            "$cond": [
                                                {"$eq": ["$success", True]},
                                                0,
                                                1,
                                            ]
                                        }
                                    },
                                    "points_spent": {"$sum": {"$ifNull": ["$cost", 0]}},
                                }
                            }
                        ],
                        "hirers": [
                            {"$group": {"_id": "$hirer_id"}},
                            {"$count": "n"},
                        ],
                        "victims": [
                            {"$match": {"success": True}},
                            {"$group": {"_id": "$target_id"}},
                            {"$count": "n"},
                        ],
                    }
                }
            ]
        ).to_list(1)
    except Exception:
        logger.exception("hitman game-wide stats")
        return empty
    if not rows:
        return empty
    facet = rows[0] or {}
    totals = (facet.get("totals") or [{}])[0] or {}
    hirers = (facet.get("hirers") or [{}])[0] or {}
    victims = (facet.get("victims") or [{}])[0] or {}
    return {
        "hires": int(totals.get("hires") or 0),
        "kills": int(totals.get("kills") or 0),
        "fails": int(totals.get("fails") or 0),
        "points_spent": int(totals.get("points_spent") or 0),
        "unique_hirers": int(hirers.get("n") or 0),
        "unique_victims": int(victims.get("n") or 0),
    }


async def _resolve_username(username: str) -> Optional[dict]:
    db = _db()
    uname = (username or "").strip()
    if not uname:
        return None
    return await db.users.find_one(
        {"username": _srv()._username_pattern(uname)},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "is_dead": 1,
            "is_npc": 1,
            "is_moderator": 1,
            "created_at": 1,
            "civilian_protection_revoked_at": 1,
            "civilian_protection_ends_at": 1,
            "hitman_victim_cooldown_until": 1,
            "hitman_protection_until": 1,
        },
    )


async def _visible_robot_bg(owner_id: str) -> Tuple[Optional[dict], List[dict], Optional[str]]:
    """Return (visible_bg, all_bgs, refuse_reason). Visible = max slot_number."""
    db = _db()
    bgs = await db.bodyguards.find(
        {"user_id": owner_id},
        {"_id": 0, "id": 1, "slot_number": 1, "is_robot": 1, "bodyguard_user_id": 1, "robot_name": 1, "hire_cost": 1},
    ).to_list(10)
    filled = [b for b in bgs if b.get("bodyguard_user_id") or b.get("is_robot")]
    if len(filled) < 2:
        return None, filled, "Target needs at least 2 bodyguards (cannot hit a lone Slot 1 guard)."
    visible = max(filled, key=lambda b: int(b.get("slot_number") or 0))
    if not visible.get("is_robot"):
        return None, filled, "Visible bodyguard is not a robot."
    return visible, filled, None


async def _hirer_success_today(hirer_id: str, target_id: str, today: str) -> bool:
    db = _db()
    doc = await db.hitman_events.find_one(
        {"hirer_id": hirer_id, "target_id": target_id, "day": today, "success": True},
        {"_id": 1},
    )
    return bool(doc)


async def _remove_robot_bodyguard_slot(owner_id: str, bg: dict, hirer_id: str) -> None:
    """Delete filled robot BG slot, dec owner slots, renumber — no witnesses / war hooks."""
    db = _db()
    guard_uid = bg.get("bodyguard_user_id")
    delete_criteria = {"id": bg["id"]} if bg.get("id") else {"user_id": owner_id, "slot_number": bg.get("slot_number")}
    await db.bodyguards.delete_one(delete_criteria)

    from routers.kill.attack import _bodyguard_owner_slot_dec_update

    guard_snap = {"is_npc": True, "is_bodyguard": True}
    await db.users.update_one({"id": owner_id}, _bodyguard_owner_slot_dec_update(guard_snap, hirer_id, owner_id))
    await db.users.update_one({"id": owner_id, "bodyguard_slots": {"$lt": 0}}, {"$set": {"bodyguard_slots": 0}})

    if guard_uid:
        try:
            guard = await db.users.find_one({"id": guard_uid}, {"_id": 0, "username": 1})
            fav_names = [
                (bg.get("robot_name") or "").strip(),
                ((guard or {}).get("username") or "").strip(),
            ]
            await db.users.update_one(
                {"id": guard_uid, "is_npc": True},
                {"$set": {"is_dead": True, "is_bodyguard": False}, "$unset": {"bodyguard_owner_id": ""}},
            )
            try:
                await db.attacks.delete_many({"target_id": guard_uid})
            except Exception:
                logger.exception("hitman: delete searches for robot %s", guard_uid)
            try:
                from routers.kill.attack import clear_kill_favorites_for_usernames
                await clear_kill_favorites_for_usernames(fav_names)
            except Exception:
                logger.exception("hitman: clear kill favorites for robot %s", guard_uid)
        except Exception:
            logger.exception("hitman: mark robot dead %s", guard_uid)

    remaining = await db.bodyguards.find(
        {"user_id": owner_id}, {"_id": 0, "id": 1, "slot_number": 1}
    ).sort("slot_number", 1).to_list(10)
    for i, b in enumerate(remaining, 1):
        if int(b.get("slot_number") or 0) != i:
            upd = {"id": b["id"]} if b.get("id") else {"user_id": owner_id, "slot_number": b.get("slot_number")}
            await db.bodyguards.update_one(upd, {"$set": {"slot_number": i}})

    try:
        await db.hitlist_bodyguard_events.insert_one({
            "at": _now(),
            "type": "hitman_kill",
            "owner_id": owner_id,
            "guard_user_id": guard_uid,
            "guard_username": bg.get("robot_name") or "",
            "killer_id": hirer_id,
            "hire_cost": int(bg.get("hire_cost") or 0),
            "via": "hitman_for_hire",
        })
    except Exception:
        logger.exception("hitman_kill audit event")


async def _log_hitman_kill_attempt(
    *,
    hirer_id: str,
    hirer_username: str,
    owner_id: str,
    owner_username: str,
    bg: dict,
    staff_hire: bool = False,
) -> None:
    """Write attack_attempts so Last 15 Kills shows the robot victim with Killer = Hired Hitman."""
    if staff_hire:
        return
    db = _db()
    guard_uid = bg.get("bodyguard_user_id")
    guard_name = (bg.get("robot_name") or "").strip()
    if guard_uid and not guard_name:
        try:
            guard = await db.users.find_one({"id": guard_uid}, {"_id": 0, "username": 1})
            if guard:
                guard_name = (guard.get("username") or "").strip()
        except Exception:
            logger.exception("hitman: load robot for attempt log")
    if not guard_name:
        guard_name = "Robot bodyguard"
    doc: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "attacker_id": hirer_id,
        "attacker_username": hirer_username or "?",
        "target_id": guard_uid,
        "target_username": guard_name,
        "outcome": "killed",
        "make_public": False,
        "is_bodyguard_kill": True,
        "is_hitman_kill": True,
        "is_npc_kill": True,
        "target_is_npc": True,
        "bodyguard_owner_id": owner_id,
        "bodyguard_owner_username": owner_username or "",
        "player_message": "Hitman for Hire killed the visible robot bodyguard.",
        "created_at": _now(),
        "via": "hitman_for_hire",
        "bullets_used": 0,
        "molotovs_used": 0,
    }
    try:
        await db.attack_attempts.insert_one(doc)
    except Exception:
        logger.exception("hitman attack_attempts insert")


async def _charge_points(user_id: str, cost: int, *, event_type: str = "hitman_hire") -> None:
    if cost <= 0:
        return
    db = _db()
    before = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1})
    bal_before = int((before or {}).get("points") or 0)
    result = await db.users.update_one(
        {"id": user_id, "points": {"$gte": cost}},
        {"$inc": {"points": -cost, "lifetime_points_spent": cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    try:
        await consume_points_fifo(
            db,
            user_id=user_id,
            points=cost,
            event_type=event_type,
            assume_balance_already_decremented_by=cost,
            meta={"cost": cost},
        )
        await log_points_event(
            db,
            user_id=user_id,
            points=-cost,
            event_type=event_type,
            meta={"cost": cost},
            wallet_points_before=bal_before,
            wallet_points_after=bal_before - cost,
        )
    except Exception:
        logger.exception("hitman points provenance %s", user_id)


async def _charge_respect(user_id: str, cost: int, *, event_type: str = "hitman_protection") -> None:
    if cost <= 0:
        return
    db = _db()
    result = await db.users.update_one(
        {"id": user_id, "respect_points": {"$gte": cost}},
        {"$inc": {"respect_points": -cost, "lifetime_respect_points_spent": cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient respect")
    try:
        await _srv().log_respect_delta(user_id, -cost, event_type)
    except Exception:
        logger.exception("hitman respect provenance %s", user_id)


class HireBody(BaseModel):
    target_username: str = Field(..., min_length=1, max_length=40)
    tier: str = Field(..., pattern="^(low|mid|high)$")


class BuyProtectionBody(BaseModel):
    pay_with: str = Field("points", pattern="^(points|respect)$")


async def _hitman_status_impl(current_user: dict):
    db = _db()
    flags = await get_store_item_flags(db)
    enabled = bool(flags.get(HITMAN_FLAG))
    if not enabled:
        return {
            "enabled": False,
            "available": False,
        }
    u = await db.users.find_one(
        {"id": current_user["id"]},
        {
            "_id": 0,
            "hitman_hires": 1,
            "hitman_points_spent": 1,
            "hitman_kills": 1,
            "hitman_free_tokens": 1,
            "hitman_discount_vs_user_id": 1,
            "hitman_discount_until": 1,
            "hitman_protection_until": 1,
            "points": 1,
            "respect_points": 1,
        },
    ) or {}
    my_discount = None
    until = _parse_iso(u.get("hitman_discount_until"))
    vs_id = u.get("hitman_discount_vs_user_id")
    if vs_id and until and until > _now():
        vs = await db.users.find_one({"id": vs_id}, {"_id": 0, "username": 1, "id": 1})
        if vs:
            my_discount = {
                "vs_user_id": vs["id"],
                "vs_username": vs.get("username") or "?",
                "expires_at": until.isoformat(),
            }
    protection_until = _parse_iso(u.get("hitman_protection_until"))
    now = _now()
    protection_active = bool(protection_until and protection_until > now)
    rebuy_cooldown_until = None
    if protection_until and not protection_active:
        cd_end = protection_until + HITMAN_PROTECTION_REBUY_COOLDOWN
        if cd_end > now:
            rebuy_cooldown_until = cd_end
    game_stats = await _game_wide_stats()
    return {
        "enabled": True,
        "available": True,
        "tiers": _tiers_payload(),
        "free_tokens": int(u.get("hitman_free_tokens") or 0),
        "points": int(u.get("points") or 0),
        "respect_points": int(u.get("respect_points") or 0),
        "stats": _stats_from_user(u),
        "game_stats": game_stats,
        "my_discount": my_discount,
        "protection_cost": HITMAN_PROTECTION_COST,
        "protection_respect_cost": HITMAN_PROTECTION_RESPECT_COST,
        "protection_days": HITMAN_PROTECTION_DAYS,
        "protection_rebuy_cooldown_hours": int(HITMAN_PROTECTION_REBUY_COOLDOWN.total_seconds() // 3600),
        "protection_until": protection_until.isoformat() if protection_active else None,
        "protection_active": protection_active,
        "protection_rebuy_cooldown_until": rebuy_cooldown_until.isoformat() if rebuy_cooldown_until else None,
        "protection_can_buy": (not protection_active) and (rebuy_cooldown_until is None),
    }


async def _hitman_lookup_impl(username: str, current_user: dict):
    db = _db()
    await require_store_item_allowed(db, HITMAN_FLAG, current_user)
    target = await _resolve_username(username)
    if not target:
        return {"ok": False, "hireable": False, "reason": "Player not found."}
    if target.get("id") == current_user["id"]:
        return {"ok": False, "hireable": False, "reason": "You cannot hire a hitman against yourself."}
    if target.get("is_dead"):
        return {"ok": False, "hireable": False, "reason": "That player is dead."}
    if target.get("is_npc"):
        return {"ok": False, "hireable": False, "reason": "Cannot target NPCs."}

    if is_civilian_protected(target):
        return {
            "ok": True,
            "hireable": False,
            "civilian_protected": True,
            "username": target.get("username"),
            "reason": CIVILIAN_PROTECTION_HITMAN_BLOCKED_DETAIL,
        }

    hirer_disc = await db.users.find_one(
        {"id": current_user["id"]},
        {"_id": 0, "hitman_discount_vs_user_id": 1, "hitman_discount_until": 1},
    ) or {}
    counter_bypass = _has_active_counter_discount(hirer_disc, target["id"])

    now_lookup = _now()
    prot = _parse_iso(target.get("hitman_protection_until"))
    prot_active = bool(prot and prot > now_lookup)
    if prot_active and not counter_bypass:
        return {
            "ok": True,
            "hireable": False,
            "protected": True,
            "protection_until": prot.isoformat(),
            "username": target.get("username"),
            "reason": "This player has anti-hitman protection.",
        }

    cd = _parse_iso(target.get("hitman_victim_cooldown_until"))
    if cd and cd > now_lookup:
        return {
            "ok": True,
            "hireable": False,
            "on_cooldown": True,
            "cooldown_until": cd.isoformat(),
            "username": target.get("username"),
            "reason": "A hitman recently struck this target — try again later.",
        }

    today = _today_utc(now_lookup)
    if await _hirer_success_today(current_user["id"], target["id"], today):
        return {
            "ok": True,
            "hireable": False,
            "username": target.get("username"),
            "reason": "You already landed a hitman kill on this player today.",
        }

    visible, filled, reason = await _visible_robot_bg(target["id"])
    if reason:
        return {
            "ok": True,
            "hireable": False,
            "username": target.get("username"),
            "reason": reason,
        }
    out = {
        "ok": True,
        "hireable": True,
        "username": target.get("username"),
        "reason": None,
    }
    if counter_bypass and prot_active:
        out["counter_bypass_protection"] = True
        out["protection_until"] = prot.isoformat()
        out["reason"] = "Counter-contract: their anti-hitman protection does not block you."
    return out


async def _hitman_hire_impl(body: HireBody, current_user: dict):
    db = _db()
    await require_store_item_allowed(db, HITMAN_FLAG, current_user)
    tier = HITMAN_TIERS.get((body.tier or "").strip().lower())
    if not tier:
        raise HTTPException(status_code=400, detail="Invalid tier")

    target = await _resolve_username(body.target_username)
    if not target:
        raise HTTPException(status_code=404, detail="Player not found")
    if target.get("id") == current_user["id"]:
        raise HTTPException(status_code=400, detail="You cannot hire a hitman against yourself")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="That player is dead")
    if target.get("is_npc"):
        raise HTTPException(status_code=400, detail="Cannot target NPCs")
    if is_civilian_protected(target):
        raise HTTPException(status_code=403, detail=CIVILIAN_PROTECTION_HITMAN_BLOCKED_DETAIL)

    now = _now()
    hirer_id = current_user["id"]
    hirer_pre = await db.users.find_one(
        {"id": hirer_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "points": 1,
            "hitman_free_tokens": 1,
            "hitman_discount_vs_user_id": 1,
            "hitman_discount_until": 1,
            "hitman_hires": 1,
            "hitman_points_spent": 1,
            "hitman_kills": 1,
            "hitman_protection_until": 1,
        },
    ) or {}
    has_discount = _has_active_counter_discount(hirer_pre, target["id"], now)

    prot = _parse_iso(target.get("hitman_protection_until"))
    if prot and prot > now and not has_discount:
        raise HTTPException(status_code=400, detail="This player has anti-hitman protection")

    cd = _parse_iso(target.get("hitman_victim_cooldown_until"))
    if cd and cd > now:
        raise HTTPException(status_code=400, detail="A hitman recently struck this target — try again later")

    today = _today_utc(now)
    if await _hirer_success_today(hirer_id, target["id"], today):
        raise HTTPException(status_code=400, detail="You already landed a hitman kill on this player today")

    visible, _filled, reason = await _visible_robot_bg(target["id"])
    if reason or not visible:
        raise HTTPException(status_code=400, detail=reason or "No valid robot bodyguard")

    hirer = hirer_pre
    free_tokens = int(hirer.get("hitman_free_tokens") or 0)
    free_token_spent = False
    charged = 0
    base_cost = int(tier["cost"])
    # Hiring drops your own shield (ends now → 2h rebuy cooldown still applies).
    hirer_prot = _parse_iso(hirer.get("hitman_protection_until"))
    protection_cleared = bool(hirer_prot and hirer_prot > now)

    if free_tokens >= 1:
        tok_update: Dict[str, Any] = {"$inc": {"hitman_free_tokens": -1, "hitman_hires": 1}}
        unset_fields: Dict[str, str] = {}
        if has_discount:
            unset_fields["hitman_discount_vs_user_id"] = ""
            unset_fields["hitman_discount_until"] = ""
        if unset_fields:
            tok_update["$unset"] = unset_fields
        if protection_cleared:
            tok_update["$set"] = {"hitman_protection_until": now.isoformat()}
        tok = await db.users.update_one(
            {"id": hirer_id, "hitman_free_tokens": {"$gte": 1}},
            tok_update,
        )
        if tok.modified_count == 0:
            raise HTTPException(status_code=400, detail="Could not use free hitman token")
        free_token_spent = True
        charged = 0
    else:
        charged = int(base_cost * HITMAN_DISCOUNT_RATE) if has_discount else base_cost
        await _charge_points(hirer_id, charged)
        paid_update: Dict[str, Any] = {"$inc": {"hitman_hires": 1, "hitman_points_spent": charged}}
        unset_fields = {}
        if has_discount:
            unset_fields["hitman_discount_vs_user_id"] = ""
            unset_fields["hitman_discount_until"] = ""
        if unset_fields:
            paid_update["$unset"] = unset_fields
        if protection_cleared:
            paid_update["$set"] = {"hitman_protection_until": now.isoformat()}
        await db.users.update_one({"id": hirer_id}, paid_update)

    success = random.random() < float(tier["success_rate"])
    free_retry_used = False
    if not success and random.random() < HITMAN_FREE_RETRY_CHANCE:
        free_retry_used = True
        success = random.random() < float(tier["success_rate"])

    free_token_earned = False
    message = ""
    staff_hire = _hirer_is_staff_for_street_stats(current_user) or _hirer_is_staff_for_street_stats(hirer)

    if success:
        await _remove_robot_bodyguard_slot(target["id"], visible, hirer_id)
        try:
            await _log_hitman_kill_attempt(
                hirer_id=hirer_id,
                hirer_username=hirer.get("username") or current_user.get("username") or "",
                owner_id=target["id"],
                owner_username=target.get("username") or "",
                bg=visible,
                staff_hire=staff_hire,
            )
        except Exception:
            logger.exception("hitman kill attempt log")
        victim_until = (now + HITMAN_VICTIM_COOLDOWN).isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"hitman_victim_cooldown_until": victim_until}},
        )
        await db.users.update_one({"id": hirer_id}, {"$inc": {"hitman_kills": 1}})

        if random.random() < HITMAN_FREE_TOKEN_CHANCE:
            await db.users.update_one({"id": hirer_id}, {"$inc": {"hitman_free_tokens": 1}})
            free_token_earned = True

        try:
            await _srv().send_notification(
                target["id"],
                "Hitman strike",
                "A hitman was hired against you. Your robot bodyguard was killed. The contractor's identity remains unknown.",
                "attack",
                category="attacks",
                always_deliver=True,
            )
        except Exception:
            logger.exception("hitman owner notify")

        message = "The hitman finished the job. The visible robot bodyguard is gone."
        if free_retry_used:
            message = "First attempt failed — free second try landed the kill. " + message
        if free_token_earned:
            message += " You earned a free hitman token."
    else:
        disc_until = (now + HITMAN_DISCOUNT_WINDOW).isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "hitman_discount_vs_user_id": hirer_id,
                    "hitman_discount_until": disc_until,
                }
            },
        )
        hirer_name = hirer.get("username") or current_user.get("username") or "someone"
        try:
            await _srv().send_notification(
                target["id"],
                "Hitman for Hire — discount",
                f"A hitman failed a contract. You can hire any Hitman tier against {hirer_name} at 25% off for 24 hours. Open Hitman for Hire.",
                "system",
                category="system",
                always_deliver=True,
                message_link_to="/kill/hitman",
                message_link_label="Open Hitman for Hire",
            )
        except Exception:
            logger.exception("hitman discount notify")

        message = "The hitman missed. You still paid — the target got a 25% off counter-offer against you for 24h."
        if free_retry_used:
            message = "First attempt failed; free second try also missed. " + message

    event = {
        "id": str(uuid.uuid4()),
        "at": now.isoformat(),
        "day": today,
        "hirer_id": hirer_id,
        "hirer_username": hirer.get("username") or current_user.get("username") or "",
        "target_id": target["id"],
        "target_username": target.get("username") or "",
        "tier": tier["id"],
        "cost": charged,
        "success": success,
        "free_retry_used": free_retry_used,
        "free_token_spent": free_token_spent,
        "free_token_earned": free_token_earned,
        "guard_user_id": visible.get("bodyguard_user_id"),
        "robot_name": (visible.get("robot_name") or "").strip() or None,
        "slot_number": visible.get("slot_number"),
        "staff_hire": bool(staff_hire),
    }
    try:
        await db.hitman_events.insert_one(event)
    except Exception:
        logger.exception("hitman_events insert")

    try:
        await _srv().log_activity(
            hirer_id,
            hirer.get("username") or "?",
            "hitman_hire",
            {"target": target.get("username"), "tier": tier["id"], "success": success, "cost": charged},
        )
    except Exception:
        pass

    fresh = await db.users.find_one(
        {"id": hirer_id},
        {"_id": 0, "hitman_hires": 1, "hitman_points_spent": 1, "hitman_kills": 1, "hitman_free_tokens": 1, "points": 1},
    ) or {}

    return {
        "success": success,
        "free_retry_used": free_retry_used,
        "free_token_earned": free_token_earned,
        "free_token_spent": free_token_spent,
        "cost": charged,
        "message": message,
        "stats": _stats_from_user(fresh),
        "free_tokens": int(fresh.get("hitman_free_tokens") or 0),
        "points": int(fresh.get("points") or 0),
    }


async def _hitman_buy_protection_impl(body: BuyProtectionBody, current_user: dict):
    db = _db()
    await require_store_item_allowed(db, HITMAN_FLAG, current_user)
    uid = current_user["id"]
    pay_with = (body.pay_with or "points").strip().lower()
    if pay_with not in ("points", "respect"):
        raise HTTPException(status_code=400, detail="pay_with must be 'points' or 'respect'")
    u = await db.users.find_one(
        {"id": uid},
        {"_id": 0, "hitman_protection_until": 1, "points": 1, "respect_points": 1},
    ) or {}
    now = _now()
    existing = _parse_iso(u.get("hitman_protection_until"))
    if existing and existing > now:
        raise HTTPException(
            status_code=400,
            detail=f"Anti-hitman protection already active until {existing.isoformat()} (cannot stack).",
        )
    if existing:
        rebuy_ok_at = existing + HITMAN_PROTECTION_REBUY_COOLDOWN
        if rebuy_ok_at > now:
            raise HTTPException(
                status_code=400,
                detail=f"Protection rebuy cooldown — available again at {rebuy_ok_at.isoformat()}.",
            )
    if pay_with == "respect":
        cost = HITMAN_PROTECTION_RESPECT_COST
        await _charge_respect(uid, cost, event_type="hitman_protection")
    else:
        cost = HITMAN_PROTECTION_COST
        await _charge_points(uid, cost, event_type="hitman_protection")
    until = now + HITMAN_PROTECTION_DURATION
    await db.users.update_one(
        {"id": uid},
        {"$set": {"hitman_protection_until": until.isoformat()}},
    )
    try:
        await _srv().log_activity(
            uid,
            current_user.get("username") or "?",
            "hitman_protection",
            {"cost": cost, "pay_with": pay_with, "until": until.isoformat()},
        )
    except Exception:
        pass
    fresh = await db.users.find_one(
        {"id": uid},
        {"_id": 0, "points": 1, "respect_points": 1, "hitman_protection_until": 1},
    ) or {}
    return {
        "message": f"Anti-hitman protection active for {HITMAN_PROTECTION_DAYS} days.",
        "protection_until": until.isoformat(),
        "protection_active": True,
        "points": int(fresh.get("points") or 0),
        "respect_points": int(fresh.get("respect_points") or 0),
        "cost": cost,
        "pay_with": pay_with,
    }


def register(router):
    get_current_user = _srv().get_current_user

    async def hitman_status(current_user: dict = Depends(get_current_user)):
        return await _hitman_status_impl(current_user)

    async def hitman_lookup(
        username: str = Query(..., min_length=1),
        current_user: dict = Depends(get_current_user),
    ):
        return await _hitman_lookup_impl(username, current_user)

    async def hitman_hire(body: HireBody, current_user: dict = Depends(get_current_user)):
        return await _hitman_hire_impl(body, current_user)

    async def hitman_buy_protection(
        body: BuyProtectionBody,
        current_user: dict = Depends(get_current_user),
    ):
        return await _hitman_buy_protection_impl(body, current_user)

    router.add_api_route("/hitman/status", hitman_status, methods=["GET"])
    router.add_api_route("/hitman/lookup", hitman_lookup, methods=["GET"])
    router.add_api_route("/hitman/hire", hitman_hire, methods=["POST"])
    router.add_api_route("/hitman/buy-protection", hitman_buy_protection, methods=["POST"])
