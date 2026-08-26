"""Season 4 close-out then start season 5.

Dry run:
  cd /opt/mafia-app/backend
  ./venv/bin/python scripts/run_game_pass_season5_closeout.py --dry-run

Live (snapshot → complete remaining VIP + missing strains → season 5 / 1 Oct):
  ./venv/bin/python scripts/run_game_pass_season5_closeout.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from server import db, send_notification, send_notification_to_all
from routers.kill.armoury import _try_grant_rank_xp_pass_micro_tier
from utils.game_pass_complete_remaining_vip import (
    aggregate_vip_increment_after_cursor_for_season,
    eligible_vip_users_filter,
    first_vip_completion_user_projection,
    get_season_completion_stamp,
    preview_complete_remaining_vip,
    set_season_completion_stamp,
)
from utils.game_pass_micro_rewards import MAX_MICRO_TIER, format_rewards_summary
from utils.game_pass_season import (
    GAME_PASS_SEASON_SETTINGS_KEY,
    get_game_pass_season_public,
    uk_midnight_first_of_month,
)
from utils.game_pass_season_closeout import persist_season_closeout_snapshot
from utils.game_pass_season_rp import (
    current_game_pass_season_id,
    reconcile_all_stale_game_pass_users,
)
from utils.point_provenance import log_points_event

NEW_SEASON_ID = "5"
NEW_SEASON_END_AT = uk_midnight_first_of_month(2026, 10).isoformat()


async def _complete_remaining(*, dry_run: bool) -> Dict[str, Any]:
    season_id = await current_game_pass_season_id(db)
    stamp = await get_season_completion_stamp(db, season_id)
    if not dry_run and stamp and stamp.get("live_completed_at"):
        return {
            "skipped": True,
            "reason": f"complete-remaining already live for season {season_id}",
            "stamp": stamp,
        }

    filt = eligible_vip_users_filter()
    proj = {**first_vip_completion_user_projection(), "game_pass_season_id": 1, "points": 1}
    live_updated = 0
    skipped_complete = 0
    skipped_no_op = 0
    dry_would_receive = 0
    dry_run_samples: List[Dict[str, Any]] = []
    run_id = str(uuid.uuid4())

    async for row in db.users.find(filt, proj):
        uid = str(row.get("id") or "")
        if not uid:
            continue
        last = int(row.get("rank_xp_pass_last_granted_micro_tier") or 0)
        if last >= MAX_MICRO_TIER:
            skipped_complete += 1
            continue
        free_last = int(row.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
        user_sid = str(row.get("game_pass_season_id") or "").strip() or season_id
        inc = aggregate_vip_increment_after_cursor_for_season(last, free_last, season_id=user_sid)
        un = row.get("username") or uid

        if dry_run:
            dry_would_receive += 1
            if len(dry_run_samples) < 25:
                dry_run_samples.append(
                    {
                        "username": un,
                        "last_granted_before": last,
                        "tiers_to_credit": MAX_MICRO_TIER - last,
                        "money": int(inc.get("money") or 0),
                        "points": int(inc.get("points") or 0),
                    }
                )
            continue

        points_delta = 0
        notify_totals: Dict[str, int] = {}
        strain_names: List[str] = []
        for t in range(last + 1, MAX_MICRO_TIER + 1):
            applied = await _try_grant_rank_xp_pass_micro_tier(
                db,
                user_id=uid,
                micro_tier=t,
                free_cash_last_micro_tier_granted=free_last,
                season_id=user_sid,
                grant_game_pass_strains=True,
            )
            if not applied:
                break
            points_delta += int(applied.get("points") or 0)
            sn = applied.get("_game_pass_strain_name")
            if sn:
                strain_names.append(str(sn))
            for k, v in applied.items():
                if str(k).startswith("_"):
                    continue
                iv = int(v or 0)
                if iv > 0:
                    notify_totals[k] = notify_totals.get(k, 0) + iv

        u_done = await db.users.find_one(
            {"id": uid},
            {"_id": 0, "rank_xp_pass_last_granted_micro_tier": 1},
        )
        if int((u_done or {}).get("rank_xp_pass_last_granted_micro_tier") or 0) < MAX_MICRO_TIER:
            skipped_no_op += 1
            continue

        live_updated += 1
        if points_delta != 0:
            before_pts = int(row.get("points") or 0)
            await log_points_event(
                db,
                user_id=uid,
                points=points_delta,
                event_type="game_pass_complete_remaining_vip",
                event_ref=run_id,
                meta={"admin": "season5_closeout_script", "run_id": run_id, "season_id": season_id},
                wallet_points_before=before_pts,
                wallet_points_after=before_pts + points_delta,
            )
        summary = format_rewards_summary(notify_totals).strip() if notify_totals else ""
        strain_bit = ""
        if strain_names:
            strain_bit = " Strains unlocked: " + ", ".join(dict.fromkeys(strain_names)) + "."
        body = (
            f"Season close-out: all remaining VIP Game Pass tier rewards through tier {MAX_MICRO_TIER} "
            f"have been credited (season {season_id})."
            + (f" {summary}" if summary else "")
            + strain_bit
        )
        await send_notification(uid, "Game Pass season complete", body, "reward")

    if not dry_run:
        await set_season_completion_stamp(
            db,
            season_id,
            {
                "live_completed_at": datetime.now(timezone.utc).isoformat(),
                "set_by": "season5_closeout_script",
                "run_id": run_id,
                "affected_user_count": live_updated,
                "skipped_already_complete": skipped_complete,
                "skipped_no_op": skipped_no_op,
                "dry_run": False,
            },
        )

    return {
        "dry_run": dry_run,
        "season_id": season_id,
        "run_id": run_id,
        "would_receive_grant": dry_would_receive if dry_run else None,
        "live_updated_count": live_updated if not dry_run else None,
        "skipped_already_complete": skipped_complete,
        "skipped_no_op": skipped_no_op if not dry_run else None,
        "dry_run_samples": dry_run_samples if dry_run else [],
    }


async def _start_season_5() -> Dict[str, Any]:
    prev = await get_game_pass_season_public(db)
    prev_sid = str(prev.get("game_pass_season_id") or "")
    now_iso = datetime.now(timezone.utc).isoformat()
    value = {
        "season_end_at": NEW_SEASON_END_AT,
        "season_id": NEW_SEASON_ID,
        "set_by": "season5_closeout_script",
        "set_at": now_iso,
        "previous_season_id": prev_sid,
        "previous_season_end_at": str(prev.get("game_pass_season_end_at") or ""),
    }
    await db.game_settings.update_one(
        {"key": GAME_PASS_SEASON_SETTINGS_KEY},
        {"$set": {"key": GAME_PASS_SEASON_SETTINGS_KEY, "value": value}},
        upsert=True,
    )
    players_reconciled = await reconcile_all_stale_game_pass_users(db)
    await send_notification_to_all(
        "New Game Pass season",
        (
            f"Game Pass season {NEW_SEASON_ID} is live. Previous VIP does not carry over — "
            "buy Game Pass again to unlock this season's VIP track. After you finish VIP, "
            "you can buy Prestige once this season and climb the same VIP track again."
        ),
        notification_type="system",
        exclude_npc=True,
    )
    public = await get_game_pass_season_public(db)
    return {
        "players_reconciled": players_reconciled,
        "season": public,
    }


async def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    season = await get_game_pass_season_public(db)
    preview = await preview_complete_remaining_vip(
        db, season_id=str(season.get("game_pass_season_id") or "")
    )
    print("=== current season ===")
    print(season)
    print("=== complete-remaining preview ===")
    print(preview)

    remaining = await _complete_remaining(dry_run=True)
    print("=== complete-remaining dry simulation ===")
    print({k: v for k, v in remaining.items() if k != "dry_run_samples"})
    print("sample:", remaining.get("dry_run_samples"))

    if args.dry_run:
        print("DRY RUN only — no snapshot, grants, or season roll.")
        return 0

    print("=== persist snapshot ===")
    snap = await persist_season_closeout_snapshot(db, set_by="season5_closeout_script")
    print(snap)

    print("=== complete remaining LIVE ===")
    live = await _complete_remaining(dry_run=False)
    print(live)

    print("=== start season 5 ===")
    rolled = await _start_season_5()
    print(rolled)
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
