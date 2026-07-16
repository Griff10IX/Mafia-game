"""Game Pass £10 prestige: +15% of season VIP totals, then reset track to re-complete."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from utils.game_pass_micro_rewards import (
    MAX_MICRO_TIER,
    TARGET_AUTO_RANK_2H_TOTAL,
    TARGET_BULLETS_TOTAL,
    TARGET_CASH_TOTAL,
    TARGET_LOOT_PIECES_TOTAL,
    TARGET_MOLOTOVS_TOTAL,
    TARGET_POINTS_TOTAL,
    TARGET_RANDOM_TOKENS_TOTAL,
    TARGET_XP_CRIMES_TOKENS_TOTAL,
    TARGET_XP_GTA_TOKENS_TOTAL,
    _RANDOM_TOKEN_KEYS,
    _distribute_total,
    format_rewards_summary,
    season_reward_profile_key,
)

GAME_PASS_PRESTIGE_PACKAGE_ID = "game_pass_prestige_10"
GAME_PASS_PRESTIGE_BONUS_RATE = 0.15
GAME_PASS_PRESTIGE_PRICE_GBP = 10.00
# Flat bonus on top of the 15% season VIP totals.
GAME_PASS_PRESTIGE_EXTRA_LOOT_PIECES = 500


def season_vip_reward_totals(season_id: Optional[str] = None) -> Dict[str, int]:
    """Published VIP season reward targets for the given season profile."""
    profile = season_reward_profile_key(season_id)
    points = 25_000 if profile == "v2" else TARGET_POINTS_TOTAL
    loot = 2_000 if profile == "v2" else TARGET_LOOT_PIECES_TOTAL
    out: Dict[str, int] = {
        "money": TARGET_CASH_TOTAL,
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
    return out


def prestige_bonus_rewards(season_id: Optional[str] = None) -> Dict[str, int]:
    """+15% of season VIP totals (ceil per key), plus a flat +500 loot pieces."""
    totals = season_vip_reward_totals(season_id)
    out: Dict[str, int] = {}
    for k, v in totals.items():
        amt = int(math.ceil(float(v) * GAME_PASS_PRESTIGE_BONUS_RATE))
        if amt > 0:
            out[k] = amt
    out["loot_box_pieces"] = int(out.get("loot_box_pieces") or 0) + GAME_PASS_PRESTIGE_EXTRA_LOOT_PIECES
    return out


def prestige_eligibility_error(user: Optional[dict]) -> Optional[str]:
    if not user:
        return "Not logged in"
    if user.get("rank_xp_pass_rewards_granted") is not True:
        return "Activate and complete VIP Game Pass before prestiging."
    if int(user.get("rank_xp_pass_last_granted_micro_tier") or 0) < MAX_MICRO_TIER:
        return "Complete all VIP Game Pass tiers (1–100) before prestiging."
    return None


def prestige_status_payload(user: Optional[dict], season_id: Optional[str] = None) -> Dict[str, Any]:
    sid = season_id
    if user and not sid:
        sid = str(user.get("game_pass_season_id") or "").strip() or None
    bonus = prestige_bonus_rewards(sid)
    err = prestige_eligibility_error(user)
    return {
        "package_id": GAME_PASS_PRESTIGE_PACKAGE_ID,
        "price_gbp": GAME_PASS_PRESTIGE_PRICE_GBP,
        "bonus_rate": GAME_PASS_PRESTIGE_BONUS_RATE,
        "bonus_percent": int(round(GAME_PASS_PRESTIGE_BONUS_RATE * 100)),
        "available": err is None,
        "unavailable_reason": err,
        "prestige_count": int((user or {}).get("game_pass_prestige_count") or 0),
        "bonus_rewards": bonus,
        "bonus_summary": format_rewards_summary(bonus) if bonus else "",
    }


async def execute_game_pass_prestige(
    db,
    *,
    user_id: str,
    send_notification,
    season_end_at: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Credit +15% season VIP totals, reset season RP + VIP grant cursor, keep VIP claimed,
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
    err = prestige_eligibility_error(user)
    if err:
        raise HTTPException(status_code=400, detail=err)

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
        "rank_xp_pass_rewards_granted": True,
        "rank_xp_pass_token_expires_at": entitlement_until.isoformat(),
        "game_pass_prestiged_at": now_iso,
    }

    result = await db.users.update_one(
        {
            "id": user_id,
            "rank_xp_pass_rewards_granted": True,
            "rank_xp_pass_last_granted_micro_tier": {"$gte": MAX_MICRO_TIER},
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
    }
