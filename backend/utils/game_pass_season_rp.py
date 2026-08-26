"""
Game Pass season-isolated RP: mirror positive rank_points gains into rank_xp_pass_season_rp
and reconcile users when game_pass_season_id changes (resets progress, clears VIP token fields).
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from utils.game_pass_micro_rewards import vip_game_pass_entitlement_active
from utils.game_pass_season import get_game_pass_season_public

VIP_RANK_POINTS_BONUS_MULT = 1.10

_RECONCILE_UNSET_FIELDS = {
    "rank_xp_pass_token_expires_at": "",
    "rank_xp_pass_bonus_until": "",
}


async def current_game_pass_season_id(db) -> str:
    season = await get_game_pass_season_public(db)
    return str(season.get("game_pass_season_id") or "1")


def scale_rank_points_for_vip(base_rp: int, user: Optional[Dict[str, Any]]) -> int:
    """+10% rank points while active VIP Game Pass; +5% more if Sour Diesel GP strain owned."""
    try:
        rp = int(base_rp or 0)
    except (TypeError, ValueError):
        return 0
    if rp <= 0 or not user:
        return rp
    if vip_game_pass_entitlement_active(user):
        rp = int(round(rp * VIP_RANK_POINTS_BONUS_MULT))
    try:
        from utils.game_pass_weed_strains import scale_rank_points_for_game_pass_strain

        rp = scale_rank_points_for_game_pass_strain(rp, user)
    except Exception:
        pass
    return rp


def rank_points_in_update(update: Optional[Dict[str, Any]]) -> int:
    if not update:
        return 0
    return int((update.get("$inc") or {}).get("rank_points") or 0)


def apply_season_rp_mirror_to_inc(
    inc: Optional[Dict[str, Any]],
    *,
    user: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Scale positive rank_points for VIP, then mirror into rank_xp_pass_season_rp."""
    if not inc:
        return inc
    rp = int(inc.get("rank_points") or 0)
    if rp <= 0:
        return inc
    scaled = scale_rank_points_for_vip(rp, user)
    out = dict(inc)
    out["rank_points"] = scaled
    out["rank_xp_pass_season_rp"] = int(out.get("rank_xp_pass_season_rp") or 0) + scaled
    return out


def apply_season_rp_mirror_to_update(
    update: Dict[str, Any],
    *,
    user: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return a shallow-copied update dict with VIP RP scaling and mirrored season RP inside $inc."""
    if not update or "$inc" not in update:
        return update
    new_inc = apply_season_rp_mirror_to_inc(update.get("$inc") or {}, user=user)
    if new_inc == update.get("$inc"):
        return update
    out = dict(update)
    out["$inc"] = new_inc
    return out


def _reconcile_set_fields(current_sid: str) -> Dict[str, Any]:
    return {
        "game_pass_season_id": current_sid,
        "rank_xp_pass_season_rp": 0,
        "rank_xp_pass_last_granted_micro_tier": 0,
        "rank_xp_pass_free_last_micro_tier_granted": 0,
        "rank_xp_pass_pending_tier_snapshot": None,
        "rank_xp_pass_tier_snapshot": None,
        "rank_xp_pass_tokens": 0,
        "rank_xp_pass_rewards_granted": False,
        "game_pass_prestige_count": 0,
        "game_pass_prestige_pending": 0,
    }


async def reconcile_user_game_pass_season_if_stale(db, *, user_id: str) -> bool:
    """
    If user's game_pass_season_id != current season_id, reset season RP and pass cursors.

    Returns True if a DB update was applied (caller may want to reload user).
    """
    current_sid = await current_game_pass_season_id(db)
    filt: Dict[str, Any] = {
        "id": user_id,
        "$or": [
            {"game_pass_season_id": {"$ne": current_sid}},
            {"game_pass_season_id": {"$exists": False}},
        ],
    }
    res = await db.users.update_one(
        filt,
        {"$set": _reconcile_set_fields(current_sid), "$unset": _RECONCILE_UNSET_FIELDS},
    )
    return bool(res.modified_count)


async def reconcile_stale_game_pass_users_for_filter(db, extra_match: Dict[str, Any]) -> int:
    """
    Bulk-reconcile users who match `extra_match` and are not on the current game_pass_season_id.

    Used by admin Game Pass lists so prior-season VIP/tier rows are cleared before the query runs.
    Clears VIP claim/tokens so the previous season's pass does not carry into the new one.
    """
    current_sid = await current_game_pass_season_id(db)
    stale: Dict[str, Any] = {
        "$or": [
            {"game_pass_season_id": {"$ne": current_sid}},
            {"game_pass_season_id": {"$exists": False}},
        ],
    }
    filt: Dict[str, Any] = {"$and": [extra_match, stale]} if extra_match else stale
    res = await db.users.update_many(
        filt,
        {"$set": _reconcile_set_fields(current_sid), "$unset": _RECONCILE_UNSET_FIELDS},
    )
    return int(res.modified_count or 0)


async def reconcile_all_stale_game_pass_users(db) -> int:
    """Wipe season RP / VIP entitlement for every player not on the current season_id."""
    return await reconcile_stale_game_pass_users_for_filter(db, {})


async def force_reconcile_all_users_to_season(db, season_id: str) -> int:
    """Reset every user's Game Pass season fields to ``season_id`` (forces VIP rebuy)."""
    sid = str(season_id or "").strip() or "1"
    res = await db.users.update_many(
        {},
        {"$set": _reconcile_set_fields(sid), "$unset": _RECONCILE_UNSET_FIELDS},
    )
    return int(res.modified_count or 0)


async def reconcile_user_game_pass_season_if_stale_after_load(db, user: Dict[str, Any]) -> bool:
    """Skip DB round-trip when in-memory user is already on the current season."""
    uid = str(user.get("id") or "")
    if not uid:
        return False
    prev = user.get("game_pass_season_id")
    current_sid = await current_game_pass_season_id(db)
    prev_s = str(prev).strip() if prev is not None else ""
    cur_s = str(current_sid).strip()
    if prev_s and prev_s == cur_s:
        return False
    return await reconcile_user_game_pass_season_if_stale(db, user_id=uid)
