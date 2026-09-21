"""Season 5 close-out then start Season 6.

Dry run:
  cd /opt/mafia-app/backend && ./venv/bin/python scripts/run_game_pass_season6_closeout.py --dry-run

Live:
  ./venv/bin/python scripts/run_game_pass_season6_closeout.py --apply
  # GhostFace preview only:
  ./venv/bin/python scripts/run_game_pass_season6_closeout.py --ghostface-preview
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
    complete_remaining_vip_users_filter,
    first_vip_completion_user_projection,
    get_season_completion_stamp,
    preview_complete_remaining_vip,
    send_ghostface_complete_remaining_preview,
    set_season_completion_stamp,
)
from utils.game_pass_micro_rewards import MAX_MICRO_TIER, format_rewards_summary
from utils.game_pass_season import (
    GAME_PASS_SEASON_SETTINGS_KEY,
    get_game_pass_season_public,
    normalize_game_pass_season_end_at,
)
from utils.game_pass_season_closeout import persist_season_closeout_snapshot
from utils.game_pass_season_rp import (
    current_game_pass_season_id,
    force_reconcile_all_users_to_season,
)
from utils.point_provenance import log_points_event

NEW_SEASON_ID = "6"
# 1 Nov 2026 00:00 Europe/London
NEW_SEASON_END_AT = normalize_game_pass_season_end_at("2026-11-01T00:00:00+00:00")


async def _complete_remaining(*, dry_run: bool) -> Dict[str, Any]:
    season_id = await current_game_pass_season_id(db)
    stamp = await get_season_completion_stamp(db, season_id)
    if stamp and stamp.get("live_completed_at"):
        print(
            f"note: prior complete-remaining stamp exists for season {season_id} "
            f"({stamp.get('live_completed_at')}); still granting anyone below tier {MAX_MICRO_TIER}."
        )

    filt = complete_remaining_vip_users_filter()
    proj = {**first_vip_completion_user_projection(), "game_pass_season_id": 1, "points": 1, "is_dead": 1}
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
        un = row.get("username") or uid

        if dry_run:
            dry_would_receive += 1
            if len(dry_run_samples) < 50:
                dry_run_samples.append(
                    {
                        "username": un,
                        "dead": bool(row.get("is_dead")),
                        "last": last,
                        "tiers": MAX_MICRO_TIER - last,
                    }
                )
            continue

        points_delta = 0
        notify_totals: Dict[str, int] = {}
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
                meta={"run_id": run_id, "season_id": season_id, "script": "season6_closeout"},
                wallet_points_before=before_pts,
                wallet_points_after=before_pts + points_delta,
            )
        summary = format_rewards_summary(notify_totals).strip() if notify_totals else ""
        body = (
            f"Season close-out: all remaining VIP Game Pass tier rewards through tier {MAX_MICRO_TIER} "
            f"have been credited (season {season_id})."
            + (f" {summary}" if summary else "")
        )
        await send_notification(uid, "Game Pass season complete", body, "reward", tier_micro=MAX_MICRO_TIER)

    if not dry_run:
        await set_season_completion_stamp(
            db,
            season_id,
            {
                "live_completed_at": datetime.now(timezone.utc).isoformat(),
                "set_by": "run_game_pass_season6_closeout",
                "updated": live_updated,
                "run_id": run_id,
            },
        )

    return {
        "season_id": season_id,
        "dry_run": dry_run,
        "live_updated": live_updated,
        "dry_would_receive": dry_would_receive,
        "skipped_complete": skipped_complete,
        "skipped_no_op": skipped_no_op,
        "samples": dry_run_samples,
    }


async def _roll_season_6() -> Dict[str, Any]:
    prev = await get_game_pass_season_public(db)
    prev_sid = str(prev.get("game_pass_season_id") or "")
    value = {
        "season_end_at": NEW_SEASON_END_AT,
        "season_id": NEW_SEASON_ID,
        "set_by": "run_game_pass_season6_closeout",
        "set_at": datetime.now(timezone.utc).isoformat(),
        "previous_season_id": prev_sid,
        "previous_season_end_at": str(prev.get("game_pass_season_end_at") or ""),
    }
    await db.game_settings.update_one(
        {"key": GAME_PASS_SEASON_SETTINGS_KEY},
        {"$set": {"key": GAME_PASS_SEASON_SETTINGS_KEY, "value": value}},
        upsert=True,
    )
    cleared = await force_reconcile_all_users_to_season(db, NEW_SEASON_ID)
    try:
        await send_notification_to_all(
            "New Game Pass season",
            (
                f"Game Pass season {NEW_SEASON_ID} is live through 1 Nov 2026 (UK). "
                "Your previous Game Pass (£15 VIP) and Prestige (£10) do not carry over — "
                "buy Game Pass again for this season. After you finish VIP, you can buy Prestige once "
                "this season. While VIP is active you earn +25% rank points from crimes, GTA, OC, "
                "Crew OC, jail busts, missions, and more."
            ),
            notification_type="system",
            exclude_npc=True,
        )
    except Exception as e:
        print("broadcast failed:", e)
    return {"cleared": cleared, "season": await get_game_pass_season_public(db)}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--ghostface-preview", action="store_true")
    ap.add_argument("--skip-roll", action="store_true", help="Complete-remaining only (no season 6 roll)")
    args = ap.parse_args()
    if not (args.dry_run or args.apply or args.ghostface_preview):
        ap.error("pass --dry-run, --apply, and/or --ghostface-preview")

    if args.ghostface_preview:
        sid = await current_game_pass_season_id(db)
        preview = await preview_complete_remaining_vip(db, season_id=sid)
        print("preview:", preview)
        gf = await send_ghostface_complete_remaining_preview(
            db, send_notification=send_notification, season_id=sid, preview=preview
        )
        print("ghostface:", gf)

    if args.dry_run or args.apply:
        if args.apply:
            await persist_season_closeout_snapshot(db, note="pre_season6_closeout")
        result = await _complete_remaining(dry_run=bool(args.dry_run and not args.apply))
        print("complete_remaining:", result)
        if args.apply and not args.skip_roll:
            roll = await _roll_season_6()
            print("season6_roll:", roll)


if __name__ == "__main__":
    asyncio.run(main())
