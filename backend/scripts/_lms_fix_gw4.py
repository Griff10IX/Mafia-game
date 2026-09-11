"""Undo false GW4 settle (used 2025 fixtures). Restore lives + load real 2026 GW4."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND = Path("/opt/mafia-app/backend")
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv

load_dotenv(str(BACKEND / ".env"))

SID = "80e9cec9-da12-4021-a719-e0403dad5c21"
GW = 4

# Post-GW3 correct state before the bogus GW4 settle
RESTORE = {
    "Highlights": {"lives": 2, "correct_streak": 1, "status": "alive"},
    "Schizophrenic": {"lives": 2, "correct_streak": 1, "status": "alive"},
    "Rabbit": {"lives": 1, "correct_streak": 1, "status": "alive"},
    "Meraxes": {"lives": 1, "correct_streak": 0, "status": "alive"},
}


async def main():
    from server import db, send_notification
    from utils.last_man_standing import (
        COL_ENTRIES,
        COL_GAMEWEEKS,
        COL_PICKS,
        COL_SEASONS,
        COL_WEEKLY,
        _deadline_from_fixtures,
        _thesportsdb_round_fixtures,
        now_iso,
    )

    gw_doc = await db[COL_GAMEWEEKS].find_one({"season_id": SID, "gw": GW}, {"_id": 0})
    print(f"GW4 was status={gw_doc.get('status')} deadline={gw_doc.get('pick_deadline')}")
    print(f"  first kickoff was {(gw_doc.get('fixtures') or [{}])[0].get('kickoff')}")

    # 1) Restore alive entries harmed by GW4
    for username, state in RESTORE.items():
        entry = await db[COL_ENTRIES].find_one({"season_id": SID, "username": username}, {"_id": 0})
        if not entry:
            print(f"  MISSING entry {username}")
            continue
        before = {
            "lives": entry.get("lives"),
            "status": entry.get("status"),
            "streak": entry.get("correct_streak"),
            "elim": entry.get("eliminated_gw"),
        }
        await db[COL_ENTRIES].update_one(
            {"season_id": SID, "username": username},
            {
                "$set": {
                    "lives": state["lives"],
                    "correct_streak": state["correct_streak"],
                    "status": state["status"],
                    "eliminated_gw": None,
                }
            },
        )
        print(f"  RESTORE {username}: {before} -> {state}")
        try:
            await send_notification(
                entry.get("user_id"),
                "LMS GW4 corrected",
                "GW4 was settled with last season's fixtures by mistake. You're back in — picks reopen for this weekend.",
                "system",
            )
        except Exception:
            pass

    # 2) Clear GW4 pick outcomes (keep team choices — still valid in 2026 GW4)
    picks = await db[COL_PICKS].find({"season_id": SID, "gw": GW}, {"_id": 0}).to_list(50)
    for p in picks:
        await db[COL_PICKS].update_one(
            {"season_id": SID, "gw": GW, "account_key": p.get("account_key")},
            {"$unset": {"outcome": "", "correct": "", "life_consumed": "", "survived_with_life": ""}},
        )
        print(f"  cleared pick outcome {p.get('username')} -> {p.get('team_name')}")

    weekly_del = await db[COL_WEEKLY].delete_many({"season_id": SID, "gw": GW})
    print(f"cleared weekly audits={weekly_del.deleted_count}")

    # 3) Load real 2026-27 GW4 fixtures (NS only)
    fixtures = await _thesportsdb_round_fixtures(GW)
    print(f"new fixtures={len(fixtures)}")
    for f in fixtures:
        print(f"  {f.get('kickoff')} {f.get('home')} vs {f.get('away')} result={f.get('result')}")
    if len(fixtures) < 8:
        raise SystemExit("refusing to apply — expected ~10 current-season fixtures")

    deadline = _deadline_from_fixtures(fixtures)
    await db[COL_GAMEWEEKS].update_one(
        {"season_id": SID, "gw": GW},
        {
            "$set": {
                "fixtures": fixtures,
                "status": "picks_open",
                "pick_deadline": deadline,
                "source": "tsdb-gw4-2026-fix",
                "synced_at": now_iso(),
            },
            "$unset": {
                "settled_at": "",
                "settle_started_at": "",
                "settle_alive_keys": "",
                "eliminated": "",
                "alive_after": "",
                "results_synced_at": "",
            },
        },
    )

    # 4) Season pointer back to GW4; GW5 should not be open yet
    await db[COL_SEASONS].update_one(
        {"id": SID},
        {"$set": {"current_gameweek": 4}},
    )
    await db[COL_GAMEWEEKS].update_one(
        {"season_id": SID, "gw": 5, "status": "picks_open"},
        {"$set": {"status": "upcoming"}},
    )

    print("\n=== FINAL ENTRIES ===")
    async for e in db[COL_ENTRIES].find(
        {"season_id": SID},
        {"_id": 0, "username": 1, "lives": 1, "status": 1, "correct_streak": 1, "eliminated_gw": 1},
    ).sort("username", 1):
        print(e)

    g4 = await db[COL_GAMEWEEKS].find_one(
        {"season_id": SID, "gw": GW},
        {"_id": 0, "status": 1, "pick_deadline": 1},
    )
    season = await db[COL_SEASONS].find_one({"id": SID}, {"_id": 0, "current_gameweek": 1})
    print("GW4", g4)
    print("season", season)


asyncio.run(main())
