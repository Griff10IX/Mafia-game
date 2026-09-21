"""Grant GhostFace Season 6 Game Pass VIP, activate, and complete all tiers + themes.

  cd /opt/mafia-app/backend && ./venv/bin/python scripts/grant_ghostface_season6_game_pass.py
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from server import db, send_notification
from routers.kill.armoury import _try_grant_rank_xp_pass_micro_tier
from utils.game_pass_complete_remaining_vip import GHOSTFACE_USERNAME
from utils.game_pass_micro_rewards import MAX_MICRO_TIER, MAX_THRESHOLD_RP
from utils.game_pass_season_rp import current_game_pass_season_id


async def main() -> None:
    season_id = await current_game_pass_season_id(db)
    gf = await db.users.find_one(
        {"username": GHOSTFACE_USERNAME},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "rank_xp_pass_free_last_micro_tier_granted": 1,
            "rank_xp_pass_last_granted_micro_tier": 1,
            "points": 1,
        },
    )
    if not gf or not gf.get("id"):
        raise SystemExit(f"{GHOSTFACE_USERNAME} not found")
    uid = str(gf["id"])
    expires = (datetime.now(timezone.utc) + timedelta(days=45)).isoformat()
    await db.users.update_one(
        {"id": uid},
        {
            "$set": {
                "game_pass_season_id": str(season_id),
                "rank_xp_pass_tokens": 0,
                "rank_xp_pass_token_expires_at": expires,
                "rank_xp_pass_rewards_granted": True,
                "rank_xp_pass_season_rp": int(MAX_THRESHOLD_RP),
                "rank_xp_pass_pending_tier_snapshot": None,
                "rank_xp_pass_tier_snapshot": None,
                "rank_xp_pass_bonus_until": expires,
            }
        },
    )
    free_last = int(gf.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
    # Reset VIP cursor then grant 1..100 so themes/strains/perks apply.
    await db.users.update_one(
        {"id": uid},
        {"$set": {"rank_xp_pass_last_granted_micro_tier": 0}},
    )
    granted = 0
    themes = []
    for t in range(1, MAX_MICRO_TIER + 1):
        applied = await _try_grant_rank_xp_pass_micro_tier(
            db,
            user_id=uid,
            micro_tier=t,
            free_cash_last_micro_tier_granted=free_last,
            season_id=str(season_id),
            grant_game_pass_strains=True,
        )
        if not applied:
            break
        granted += 1
        if applied.get("_game_pass_theme_name"):
            themes.append(str(applied["_game_pass_theme_name"]))

    # Also unlock free-track Season 6 themes (5).
    from utils.game_pass_micro_rewards import season_reward_profile_key
    from utils.game_pass_s6_themes import (
        GP_S6_FREE_THEME_BY_TIER,
        game_pass_s6_theme_display_name,
    )
    from utils.profile_background_themes import grant_ur_theme_to_user

    pk = season_reward_profile_key(str(season_id))
    for tid in GP_S6_FREE_THEME_BY_TIER.values():
        await grant_ur_theme_to_user(db, uid, tid, count_toward_pool=False)
        themes.append(game_pass_s6_theme_display_name(tid))
    await db.users.update_one(
        {"id": uid},
        {"$set": {"rank_xp_pass_free_last_micro_tier_granted": MAX_MICRO_TIER}},
    )
    _ = pk
    u = await db.users.find_one(
        {"id": uid},
        {
            "_id": 0,
            "rank_xp_pass_last_granted_micro_tier": 1,
            "rank_xp_pass_rewards_granted": 1,
            "profile_background_themes_owned": 1,
        },
    )
    await send_notification(
        uid,
        "Game Pass Season 6 — staff grant",
        (
            f"You were granted Season {season_id} VIP Game Pass and completed through tier {MAX_MICRO_TIER}. "
            f"Tiers applied this run: {granted}. Themes unlocked: {', '.join(dict.fromkeys(themes)) or 'n/a'}."
        ),
        "reward",
        tier_micro=MAX_MICRO_TIER,
        staff_grant=True,
    )
    print(
        {
            "username": GHOSTFACE_USERNAME,
            "user_id": uid,
            "season_id": season_id,
            "tiers_granted": granted,
            "cursor": (u or {}).get("rank_xp_pass_last_granted_micro_tier"),
            "vip": (u or {}).get("rank_xp_pass_rewards_granted"),
            "themes_owned_count": len((u or {}).get("profile_background_themes_owned") or []),
            "theme_names": list(dict.fromkeys(themes)),
        }
    )


if __name__ == "__main__":
    asyncio.run(main())
