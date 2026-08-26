"""Game Pass £10 prestige: +50% of season VIP totals, then reset track to re-complete."""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from utils.game_pass_micro_rewards import (
    MAX_MICRO_TIER,
    TARGET_AUTO_RANK_2H_TOTAL,
    TARGET_BULLETS_TOTAL,
    TARGET_CASH_TOTAL,
    TARGET_CASH_TOTAL_V5,
    TARGET_LOOT_PIECES_TOTAL,
    TARGET_LOOT_PIECES_TOTAL_V5,
    TARGET_MISSION_SKIP_TOTAL_V5,
    TARGET_MOLOTOVS_TOTAL,
    TARGET_POINTS_TOTAL,
    TARGET_POINTS_TOTAL_V5,
    TARGET_RANDOM_TOKENS_TOTAL,
    TARGET_ROBOT_HIRE_TOTAL_V5,
    TARGET_V4_EXTRA_TOKEN_EACH,
    TARGET_XP_CRIMES_TOKENS_TOTAL,
    TARGET_XP_GTA_TOKENS_TOTAL,
    _RANDOM_TOKEN_KEYS,
    _V4_EXTRA_TOKEN_KEYS,
    _distribute_total,
    format_rewards_summary,
    season_reward_profile_key,
)

GAME_PASS_PRESTIGE_PACKAGE_ID = "game_pass_prestige_10"
GAME_PASS_PRESTIGE_BONUS_RATE = 0.50
# Prestige used to grant +15%; anyone who already applied at that rate gets a one-time top-up to 50%.
GAME_PASS_PRESTIGE_LEGACY_BONUS_RATE = 0.15
GAME_PASS_PRESTIGE_PRICE_GBP = 10.00
# Flat bonus on top of the 50% season VIP totals.
GAME_PASS_PRESTIGE_EXTRA_LOOT_PIECES = 500
# Max queued prestiges (buy early while climbing VIP; auto-apply at tier 100).
GAME_PASS_PRESTIGE_PENDING_CAP = 1
# One prestige per season: Free → VIP Game Pass → Prestige (same VIP track again). New season resets.
GAME_PASS_PRESTIGE_MAX_COUNT = 1

PRESTIGE_RATE_TOPUP_EVENT = "game_pass_prestige_rate_topup"
PRESTIGE_GRANT_EVENT = "game_pass_prestige"


def season_vip_reward_totals(season_id: Optional[str] = None) -> Dict[str, int]:
    """Published VIP season reward targets for the given season profile."""
    profile = season_reward_profile_key(season_id)
    if profile == "v5":
        points = TARGET_POINTS_TOTAL_V5
        loot = TARGET_LOOT_PIECES_TOTAL_V5
        cash = TARGET_CASH_TOTAL_V5
    elif profile == "v2":
        points = 25_000
        loot = 2_000
        cash = TARGET_CASH_TOTAL
    else:
        points = TARGET_POINTS_TOTAL
        loot = TARGET_LOOT_PIECES_TOTAL
        cash = TARGET_CASH_TOTAL
    out: Dict[str, int] = {
        "money": cash,
        "bullets": TARGET_BULLETS_TOTAL,
        "points": points,
        "loot_box_pieces": loot,
        "xp_crimes_tokens": TARGET_XP_CRIMES_TOKENS_TOTAL,
        "xp_gta_tokens": TARGET_XP_GTA_TOKENS_TOTAL,
        "auto_rank_2h_tokens": TARGET_AUTO_RANK_2H_TOTAL,
        **_distribute_total(TARGET_RANDOM_TOKENS_TOTAL, list(_RANDOM_TOKEN_KEYS)),
    }
    if profile != "v2":
        out["molotovs"] = TARGET_MOLOTOVS_TOTAL
    if profile in ("v4", "v5"):
        for k in _V4_EXTRA_TOKEN_KEYS:
            out[k] = TARGET_V4_EXTRA_TOKEN_EACH
    if profile == "v5":
        out["mission_skip_tokens"] = TARGET_MISSION_SKIP_TOTAL_V5
        out["robot_bodyguard_hire_tokens"] = TARGET_ROBOT_HIRE_TOTAL_V5
    return out


def prestige_bonus_rewards(season_id: Optional[str] = None) -> Dict[str, int]:
    """+50% of season VIP totals (ceil per key), plus a flat +500 loot pieces."""
    totals = season_vip_reward_totals(season_id)
    out: Dict[str, int] = {}
    for k, v in totals.items():
        amt = int(math.ceil(float(v) * GAME_PASS_PRESTIGE_BONUS_RATE))
        if amt > 0:
            out[k] = amt
    out["loot_box_pieces"] = int(out.get("loot_box_pieces") or 0) + GAME_PASS_PRESTIGE_EXTRA_LOOT_PIECES
    return out


def prestige_bonus_rewards_at_rate(rate: float, season_id: Optional[str] = None, *, include_extra_loot: bool = True) -> Dict[str, int]:
    """Season VIP totals × rate (ceil per key). Extra loot only for full prestige apply, not rate top-ups."""
    totals = season_vip_reward_totals(season_id)
    out: Dict[str, int] = {}
    for k, v in totals.items():
        amt = int(math.ceil(float(v) * float(rate)))
        if amt > 0:
            out[k] = amt
    if include_extra_loot:
        out["loot_box_pieces"] = int(out.get("loot_box_pieces") or 0) + GAME_PASS_PRESTIGE_EXTRA_LOOT_PIECES
    return out


def prestige_rate_topup_rewards(season_id: Optional[str] = None) -> Dict[str, int]:
    """Difference between current 50% and legacy 15% season VIP totals (no second +500 loot)."""
    at_new = prestige_bonus_rewards_at_rate(
        GAME_PASS_PRESTIGE_BONUS_RATE, season_id, include_extra_loot=False
    )
    at_old = prestige_bonus_rewards_at_rate(
        GAME_PASS_PRESTIGE_LEGACY_BONUS_RATE, season_id, include_extra_loot=False
    )
    out: Dict[str, int] = {}
    keys = set(at_new) | set(at_old)
    for k in keys:
        diff = int(at_new.get(k) or 0) - int(at_old.get(k) or 0)
        if diff > 0:
            out[k] = diff
    return out


def _bonus_rate_is_legacy(rate: Any) -> bool:
    """True if a stored prestige grant was below the current 50% rate."""
    if rate is None:
        return True
    try:
        return float(rate) + 1e-9 < float(GAME_PASS_PRESTIGE_BONUS_RATE)
    except (TypeError, ValueError):
        return True


async def _count_legacy_prestige_grants(db, user_id: str) -> int:
    """How many prestige applies for this user were credited at the old (sub-50%) rate."""
    if not user_id:
        return 0
    n = 0
    saw_any = False
    async for ev in db.point_ledger_events.find(
        {"user_id": user_id, "event_type": PRESTIGE_GRANT_EVENT},
        {"_id": 0, "meta": 1},
    ):
        saw_any = True
        rate = (ev.get("meta") or {}).get("bonus_rate")
        if _bonus_rate_is_legacy(rate):
            n += 1
    if saw_any:
        return n
    # Ledger missing (rare): treat each prestige_count as a legacy grant needing top-up.
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "game_pass_prestige_count": 1},
    )
    return max(0, int((user or {}).get("game_pass_prestige_count") or 0))


async def _count_prestige_rate_topups(db, user_id: str) -> int:
    if not user_id:
        return 0
    from_events = await db.point_ledger_events.count_documents(
        {"user_id": user_id, "event_type": PRESTIGE_RATE_TOPUP_EVENT}
    )
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "game_pass_prestige_rate_topup_count": 1},
    )
    from_user = int((user or {}).get("game_pass_prestige_rate_topup_count") or 0)
    return max(int(from_events or 0), from_user)


async def ensure_game_pass_prestige_rate_topup(
    db,
    user_id: str,
    *,
    send_notification=None,
    season_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    One-time make-good: users who prestiged at +15% get the difference to +50%.
    Idempotent — safe to call on Game Pass page load.
    """
    if not user_id:
        return None

    legacy_n = await _count_legacy_prestige_grants(db, user_id)
    if legacy_n < 1:
        return None
    already = await _count_prestige_rate_topups(db, user_id)
    needed = legacy_n - already
    if needed < 1:
        return None

    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "username": 1, "game_pass_season_id": 1, "points": 1},
    )
    if not user:
        return None

    sid = season_id or str(user.get("game_pass_season_id") or "").strip() or None
    topup = prestige_rate_topup_rewards(sid)
    if not topup:
        return None

    total_granted: Dict[str, int] = {}
    applied = 0
    for _ in range(needed):
        # Claim one top-up slot atomically so parallel page loads cannot double-pay.
        claim = await db.users.update_one(
            {
                "id": user_id,
                "$expr": {
                    "$lt": [
                        {"$ifNull": ["$game_pass_prestige_rate_topup_count", 0]},
                        legacy_n,
                    ]
                },
            },
            {"$inc": {"game_pass_prestige_rate_topup_count": 1}},
        )
        if claim.modified_count == 0:
            break

        inc = {k: int(v) for k, v in topup.items() if int(v or 0) > 0}
        if inc:
            await db.users.update_one({"id": user_id}, {"$inc": inc})
            for k, v in inc.items():
                total_granted[k] = int(total_granted.get(k) or 0) + int(v)

        points_bonus = int(topup.get("points") or 0)
        try:
            await db.point_ledger_events.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "event_type": PRESTIGE_RATE_TOPUP_EVENT,
                    "user_id": user_id,
                    "points": points_bonus,
                    "lot_id": None,
                    "origin_ref": GAME_PASS_PRESTIGE_PACKAGE_ID,
                    "root_purchase_ref": None,
                    "meta": {
                        "from_rate": GAME_PASS_PRESTIGE_LEGACY_BONUS_RATE,
                        "to_rate": GAME_PASS_PRESTIGE_BONUS_RATE,
                        "season_id": sid,
                        "bonus_rewards": dict(topup),
                    },
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )
        except Exception:
            pass

        applied += 1

    if applied < 1:
        return None

    summary = format_rewards_summary(total_granted) if total_granted else ""
    notify = send_notification
    if notify is None:
        try:
            import server as srv

            notify = srv.send_notification
        except Exception:
            notify = None
    if notify:
        try:
            await notify(
                user_id,
                "Game Pass Prestige topped up",
                (
                    f"Good news — Game Pass Prestige was raised from "
                    f"+{int(round(GAME_PASS_PRESTIGE_LEGACY_BONUS_RATE * 100))}% to "
                    f"+{int(round(GAME_PASS_PRESTIGE_BONUS_RATE * 100))}% of season VIP rewards.\n\n"
                    f"Because you already prestiged at the old rate, we've credited you the difference"
                    f"{f' ({summary})' if summary else ''}.\n\n"
                    f"Check your cash, points, bullets, tokens, and loot pieces — nothing else to claim."
                ),
                "reward",
                category="system",
                always_deliver=True,
                message_link_to="/game-pass",
                message_link_label="Open Game Pass",
            )
        except Exception:
            import logging

            logging.getLogger(__name__).exception(
                "game pass prestige rate top-up inbox notify failed user=%s", user_id
            )

    return {
        "ok": True,
        "topups_applied": applied,
        "bonus_rewards": total_granted,
        "bonus_summary": summary,
        "from_rate": GAME_PASS_PRESTIGE_LEGACY_BONUS_RATE,
        "to_rate": GAME_PASS_PRESTIGE_BONUS_RATE,
    }


def _token_unactivated_valid(user: dict, now: Optional[datetime] = None) -> bool:
    if int(user.get("rank_xp_pass_tokens") or 0) < 1:
        return False
    exp = user.get("rank_xp_pass_token_expires_at")
    if not exp:
        return True
    try:
        until = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        return until > (now or datetime.now(timezone.utc))
    except Exception:
        return True


def prestige_apply_eligibility_error(user: Optional[dict]) -> Optional[str]:
    """Error if prestige cannot be applied right now (VIP track not finished)."""
    if not user:
        return "Not logged in"
    if user.get("rank_xp_pass_rewards_granted") is not True:
        return "Activate and complete VIP Game Pass before prestiging."
    if int(user.get("rank_xp_pass_last_granted_micro_tier") or 0) < MAX_MICRO_TIER:
        return "Complete all VIP Game Pass tiers (1–100) before prestiging."
    return None


def prestige_eligibility_error(user: Optional[dict]) -> Optional[str]:
    """Backward-compatible name: apply eligibility (immediate prestige)."""
    return prestige_apply_eligibility_error(user)


def prestige_purchase_eligibility_error(user: Optional[dict]) -> Optional[str]:
    """
    Error if prestige cannot be bought / queued.

    Can buy before finishing VIP — queues until VIP tiers 1–100 finish (after you buy/activate
    Game Pass and complete the track). One prestige per season (same VIP track again after apply).
    """
    if not user:
        return "Not logged in"
    if int(user.get("game_pass_prestige_count") or 0) >= GAME_PASS_PRESTIGE_MAX_COUNT:
        return "You have already prestiged Game Pass this season."
    pending = int(user.get("game_pass_prestige_pending") or 0)
    if pending >= GAME_PASS_PRESTIGE_PENDING_CAP:
        return "You already have a Game Pass Prestige queued — it will apply automatically when you finish VIP tiers 1–100."
    return None


def prestige_status_payload(user: Optional[dict], season_id: Optional[str] = None) -> Dict[str, Any]:
    sid = season_id
    if user and not sid:
        sid = str(user.get("game_pass_season_id") or "").strip() or None
    bonus = prestige_bonus_rewards(sid)
    apply_err = prestige_apply_eligibility_error(user)
    purchase_err = prestige_purchase_eligibility_error(user)
    pending = int((user or {}).get("game_pass_prestige_pending") or 0)
    prestige_count = int((user or {}).get("game_pass_prestige_count") or 0)
    can_apply_now = apply_err is None and prestige_count < GAME_PASS_PRESTIGE_MAX_COUNT
    can_purchase = purchase_err is None
    if prestige_count >= GAME_PASS_PRESTIGE_MAX_COUNT:
        apply_unavailable = "You have already prestiged Game Pass this season."
    elif apply_err:
        apply_unavailable = apply_err
    else:
        apply_unavailable = None
    return {
        "package_id": GAME_PASS_PRESTIGE_PACKAGE_ID,
        "price_gbp": GAME_PASS_PRESTIGE_PRICE_GBP,
        "bonus_rate": GAME_PASS_PRESTIGE_BONUS_RATE,
        "bonus_percent": int(round(GAME_PASS_PRESTIGE_BONUS_RATE * 100)),
        # available = can buy (queue or apply). ready_to_apply = track complete.
        "available": can_purchase,
        "unavailable_reason": purchase_err,
        "ready_to_apply": can_apply_now,
        "apply_unavailable_reason": apply_unavailable,
        "prestige_pending": pending,
        "prestige_pending_cap": GAME_PASS_PRESTIGE_PENDING_CAP,
        "prestige_max_count": GAME_PASS_PRESTIGE_MAX_COUNT,
        "prestige_count": prestige_count,
        "bonus_rewards": bonus,
        "bonus_summary": format_rewards_summary(bonus) if bonus else "",
    }


async def queue_game_pass_prestige(db, user_id: str) -> Dict[str, Any]:
    """Increment pending prestige queue (buy early). Cap enforced atomically. One prestige max."""
    from fastapi import HTTPException

    result = await db.users.update_one(
        {
            "id": user_id,
            "$and": [
                {
                    "$or": [
                        {"game_pass_prestige_count": {"$lt": GAME_PASS_PRESTIGE_MAX_COUNT}},
                        {"game_pass_prestige_count": {"$exists": False}},
                    ]
                },
                {
                    "$or": [
                        {"game_pass_prestige_pending": {"$lt": GAME_PASS_PRESTIGE_PENDING_CAP}},
                        {"game_pass_prestige_pending": {"$exists": False}},
                    ]
                },
            ],
        },
        {"$inc": {"game_pass_prestige_pending": 1}},
    )
    if result.modified_count == 0:
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "game_pass_prestige_count": 1, "game_pass_prestige_pending": 1},
        )
        if int((user or {}).get("game_pass_prestige_count") or 0) >= GAME_PASS_PRESTIGE_MAX_COUNT:
            raise HTTPException(
                status_code=400,
                detail="You have already prestiged Game Pass this season.",
            )
        raise HTTPException(
            status_code=400,
            detail="You already have a Game Pass Prestige queued — it will apply automatically when you finish VIP tiers 1–100.",
        )
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "game_pass_prestige_pending": 1})
    pending = int((user or {}).get("game_pass_prestige_pending") or 0)
    try:
        import server as srv

        await srv.send_notification(
            user_id,
            "Game Pass Prestige queued",
            (
                "Your £10 Prestige is ready. When you finish VIP Game Pass tiers 1–100, "
                "it will apply automatically (+50% season VIP rewards + loot pieces, then reset the track)."
            ),
            "reward",
        )
    except Exception:
        pass
    return {"ok": True, "queued": True, "prestige_pending": pending}


async def try_consume_pending_game_pass_prestige(
    db,
    user_id: str,
    *,
    season_end_at: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    If a prestige is queued and VIP track is complete, consume one pending and apply.
    Safe to call often; returns None when nothing applied.
    """
    user = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "rank_xp_pass_rewards_granted": 1,
            "rank_xp_pass_last_granted_micro_tier": 1,
            "game_pass_prestige_pending": 1,
        },
    )
    if not user or int(user.get("game_pass_prestige_pending") or 0) < 1:
        return None
    if prestige_apply_eligibility_error(user):
        return None

    claimed = await db.users.update_one(
        {
            "id": user_id,
            "game_pass_prestige_pending": {"$gte": 1},
            "rank_xp_pass_rewards_granted": True,
            "rank_xp_pass_last_granted_micro_tier": {"$gte": MAX_MICRO_TIER},
        },
        {"$inc": {"game_pass_prestige_pending": -1}},
    )
    if claimed.modified_count == 0:
        return None

    import server as srv

    try:
        return await execute_game_pass_prestige(
            db,
            user_id=user_id,
            send_notification=srv.send_notification,
            season_end_at=season_end_at,
        )
    except Exception:
        # Restore the pending slot if apply failed after consume.
        await db.users.update_one({"id": user_id}, {"$inc": {"game_pass_prestige_pending": 1}})
        raise


async def execute_game_pass_prestige(
    db,
    *,
    user_id: str,
    send_notification,
    season_end_at: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Credit +50% season VIP totals, reset season RP + VIP grant cursor, keep VIP claimed,
    and extend token expiry through season end so re-grants keep working.
    """
    from fastapi import HTTPException

    user = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "game_pass_season_id": 1,
            "rank_xp_pass_rewards_granted": 1,
            "rank_xp_pass_last_granted_micro_tier": 1,
            "game_pass_prestige_count": 1,
            "points": 1,
        },
    )
    err = prestige_apply_eligibility_error(user)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if int((user or {}).get("game_pass_prestige_count") or 0) >= GAME_PASS_PRESTIGE_MAX_COUNT:
        raise HTTPException(
            status_code=400,
            detail="You have already prestiged Game Pass this season.",
        )

    season_id = str((user or {}).get("game_pass_season_id") or "").strip() or None
    bonus = prestige_bonus_rewards(season_id)
    if not bonus:
        raise HTTPException(status_code=500, detail="Prestige bonus rewards unavailable")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    entitlement_until = None
    if season_end_at:
        try:
            entitlement_until = datetime.fromisoformat(str(season_end_at).replace("Z", "+00:00"))
            if entitlement_until.tzinfo is None:
                entitlement_until = entitlement_until.replace(tzinfo=timezone.utc)
        except Exception:
            entitlement_until = None
    if entitlement_until is None or entitlement_until <= now:
        entitlement_until = now + timedelta(days=30)

    points_bonus = int(bonus.get("points") or 0)
    inc = {k: int(v) for k, v in bonus.items() if int(v or 0) > 0}
    set_doc: Dict[str, Any] = {
        "rank_xp_pass_season_rp": 0,
        "rank_xp_pass_last_granted_micro_tier": 0,
        "rank_xp_pass_tier_snapshot": 0,
        "rank_xp_pass_rewards_granted": True,
        "rank_xp_pass_token_expires_at": entitlement_until.isoformat(),
        "game_pass_prestiged_at": now_iso,
    }

    result = await db.users.update_one(
        {
            "id": user_id,
            "rank_xp_pass_rewards_granted": True,
            "rank_xp_pass_last_granted_micro_tier": {"$gte": MAX_MICRO_TIER},
            "$or": [
                {"game_pass_prestige_count": {"$lt": GAME_PASS_PRESTIGE_MAX_COUNT}},
                {"game_pass_prestige_count": {"$exists": False}},
            ],
        },
        {
            "$inc": {**inc, "game_pass_prestige_count": 1},
            "$set": set_doc,
        },
    )
    if result.modified_count == 0:
        raise HTTPException(
            status_code=400,
            detail="Game Pass prestige already applied or VIP track is no longer complete.",
        )

    if points_bonus > 0:
        try:
            from utils.point_provenance import log_points_event

            await log_points_event(
                db,
                user_id=user_id,
                points=points_bonus,
                event_type="game_pass_prestige",
                event_ref=GAME_PASS_PRESTIGE_PACKAGE_ID,
                meta={"bonus_rate": GAME_PASS_PRESTIGE_BONUS_RATE, "season_id": season_id},
            )
        except Exception:
            pass

    summary = format_rewards_summary(bonus)
    try:
        await send_notification(
            user_id,
            "Game Pass Prestiged",
            (
                f"You received +{int(round(GAME_PASS_PRESTIGE_BONUS_RATE * 100))}% of this season's VIP rewards "
                f"plus {GAME_PASS_PRESTIGE_EXTRA_LOOT_PIECES:,} loot pieces ({summary}). "
                f"Your Game Pass track reset to tier 1 — climb again to earn full VIP rewards."
            ),
            "reward",
        )
    except Exception:
        pass

    new_count = int((user or {}).get("game_pass_prestige_count") or 0) + 1
    return {
        "ok": True,
        "bonus_rewards": bonus,
        "bonus_summary": summary,
        "prestige_count": new_count,
        "token_expires_at": entitlement_until.isoformat(),
        "season_id": season_id,
        "queued": False,
    }
