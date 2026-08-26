"""Snapshot the live Game Pass season (config + VIP progress) before an early close."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from utils.game_pass_first_vip_completion import eligible_vip_users_filter
from utils.game_pass_micro_rewards import (
    MAX_MICRO_TIER,
    TARGET_AUTO_RANK_2H_TOTAL,
    TARGET_BULLETS_TOTAL,
    TARGET_CASH_TOTAL,
    TARGET_LOOT_PIECES_TOTAL,
    TARGET_MOLOTOVS_TOTAL,
    TARGET_POINTS_TOTAL,
    TARGET_V4_EXTRA_TOKEN_EACH,
    TARGET_XP_CRIMES_TOKENS_TOTAL,
    TARGET_XP_GTA_TOKENS_TOTAL,
    rewards_for_micro_tier,
    season_reward_profile_key,
)
from utils.game_pass_prestige import prestige_bonus_rewards, season_vip_reward_totals
from utils.game_pass_season import GAME_PASS_SEASON_SETTINGS_KEY, get_game_pass_season_public
from utils.game_pass_weed_strains import GAME_PASS_STRAIN_BY_TIER, GAME_PASS_STRAIN_IDS

GAME_PASS_CLOSEOUT_SNAPSHOT_KEY = "game_pass_season_closeout_snapshot"


def _season_target_payload(season_id: str) -> Dict[str, Any]:
    profile = season_reward_profile_key(season_id)
    return {
        "reward_profile": profile,
        "vip_totals": season_vip_reward_totals(season_id),
        "prestige_bonus": prestige_bonus_rewards(season_id),
        "legacy_v3_v4_targets": {
            "cash": TARGET_CASH_TOTAL,
            "points": TARGET_POINTS_TOTAL,
            "loot": TARGET_LOOT_PIECES_TOTAL,
            "molotovs": TARGET_MOLOTOVS_TOTAL,
            "bullets": TARGET_BULLETS_TOTAL,
            "auto_rank_2h": TARGET_AUTO_RANK_2H_TOTAL,
            "xp_crimes": TARGET_XP_CRIMES_TOKENS_TOTAL,
            "xp_gta": TARGET_XP_GTA_TOKENS_TOTAL,
            "extra_store_token_each": TARGET_V4_EXTRA_TOKEN_EACH,
        },
        "strain_tiers": {str(k): v for k, v in GAME_PASS_STRAIN_BY_TIER.items()},
    }


async def build_season_closeout_snapshot(db) -> Dict[str, Any]:
    season = await get_game_pass_season_public(db)
    season_id = str(season.get("game_pass_season_id") or "")
    settings_doc = await db.game_settings.find_one(
        {"key": GAME_PASS_SEASON_SETTINGS_KEY},
        {"_id": 0, "value": 1},
    )
    filt = eligible_vip_users_filter()
    proj = {
        "_id": 0,
        "id": 1,
        "username": 1,
        "is_dead": 1,
        "game_pass_season_id": 1,
        "rank_xp_pass_last_granted_micro_tier": 1,
        "rank_xp_pass_free_last_micro_tier_granted": 1,
        "rank_xp_pass_rewards_granted": 1,
        "game_pass_prestige_count": 1,
        "game_pass_prestige_pending": 1,
        "game_pass_weed_strain_ids": 1,
        "points": 1,
        "money": 1,
        "bullets": 1,
        "loot_box_pieces": 1,
    }
    vip_users: List[Dict[str, Any]] = []
    incomplete = 0
    complete = 0
    prestige_used = 0
    prestige_pending = 0
    async for row in db.users.find(filt, proj).sort("username", 1):
        last = int(row.get("rank_xp_pass_last_granted_micro_tier") or 0)
        pending = int(row.get("game_pass_prestige_pending") or 0)
        pcount = int(row.get("game_pass_prestige_count") or 0)
        if last >= MAX_MICRO_TIER:
            complete += 1
        else:
            incomplete += 1
        if pcount >= 1:
            prestige_used += 1
        if pending >= 1:
            prestige_pending += 1
        strains = [s for s in (row.get("game_pass_weed_strain_ids") or []) if s in GAME_PASS_STRAIN_IDS]
        vip_users.append(
            {
                "id": row.get("id"),
                "username": row.get("username"),
                "is_dead": bool(row.get("is_dead")),
                "game_pass_season_id": str(row.get("game_pass_season_id") or ""),
                "last_granted_micro_tier": last,
                "free_last_micro_tier": int(row.get("rank_xp_pass_free_last_micro_tier_granted") or 0),
                "prestige_count": pcount,
                "prestige_pending": pending,
                "strain_ids": strains,
                "points": int(row.get("points") or 0),
                "money": int(row.get("money") or 0),
                "bullets": int(row.get("bullets") or 0),
                "loot_box_pieces": int(row.get("loot_box_pieces") or 0),
            }
        )

    tier_table = {str(t): rewards_for_micro_tier(t, season_id=season_id) for t in range(1, MAX_MICRO_TIER + 1)}
    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "season": season,
        "season_settings_raw": (settings_doc or {}).get("value"),
        "targets": _season_target_payload(season_id),
        "counts": {
            "vip_claimed_alive_non_npc": len(vip_users),
            "vip_complete_tier_100": complete,
            "vip_incomplete": incomplete,
            "prestige_used": prestige_used,
            "prestige_pending": prestige_pending,
        },
        "vip_users": vip_users,
        "micro_tier_rewards": tier_table,
    }


async def persist_season_closeout_snapshot(db, *, set_by: str) -> Dict[str, Any]:
    snap = await build_season_closeout_snapshot(db)
    snap["set_by"] = set_by
    season_id = str((snap.get("season") or {}).get("game_pass_season_id") or "")
    await db.game_settings.update_one(
        {"key": GAME_PASS_CLOSEOUT_SNAPSHOT_KEY},
        {
            "$set": {
                "key": GAME_PASS_CLOSEOUT_SNAPSHOT_KEY,
                "value": snap,
                "season_id": season_id,
            }
        },
        upsert=True,
    )
    return {
        "ok": True,
        "season_id": season_id,
        "captured_at": snap.get("captured_at"),
        "counts": snap.get("counts"),
        "set_by": set_by,
        "settings_key": GAME_PASS_CLOSEOUT_SNAPSHOT_KEY,
    }


async def get_persisted_closeout_snapshot_meta(db) -> Optional[Dict[str, Any]]:
    doc = await db.game_settings.find_one(
        {"key": GAME_PASS_CLOSEOUT_SNAPSHOT_KEY},
        {"_id": 0, "season_id": 1, "value.captured_at": 1, "value.counts": 1, "value.set_by": 1},
    )
    if not doc:
        return None
    val = doc.get("value") if isinstance(doc.get("value"), dict) else {}
    return {
        "season_id": doc.get("season_id"),
        "captured_at": val.get("captured_at"),
        "counts": val.get("counts"),
        "set_by": val.get("set_by"),
        "settings_key": GAME_PASS_CLOSEOUT_SNAPSHOT_KEY,
    }
