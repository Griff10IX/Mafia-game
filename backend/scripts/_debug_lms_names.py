"""Print Odds + TheSportsDB names vs LMS GW2 fixtures."""
import asyncio
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, "/opt/mafia-app/backend")
load_dotenv("/opt/mafia-app/backend/.env")

from utils.last_man_standing import (  # noqa: E402
    _fetch_odds_epl_events,
    _fetch_thesportsdb_pl_results,
    teams_same,
)


async def main():
    odds = await _fetch_odds_epl_events()
    print("ODDS", len(odds))
    for ev in odds:
        scores = ev.get("scores")
        print(" o", ev.get("home_team"), "vs", ev.get("away_team"), "completed", ev.get("completed"), "scores", scores)
    tsdb = await _fetch_thesportsdb_pl_results()
    print("TSDB", len(tsdb))
    missing = [
        ("Chelsea", "Brighton and Hove Albion"),
        ("Leeds United", "Brentford"),
        ("Sunderland", "Fulham"),
        ("Manchester United", "Ipswich Town"),
        ("Aston Villa", "Arsenal"),
    ]
    for h, a in missing:
        o_hit = [ev for ev in odds if teams_same(h, ev.get("home_team") or "") and teams_same(a, ev.get("away_team") or "")]
        t_hit = [ev for ev in tsdb if teams_same(h, ev.get("home") or "") and teams_same(a, ev.get("away") or "")]
        print("MISS", h, a, "odds", len(o_hit), "tsdb", len(t_hit), t_hit[:1])


if __name__ == "__main__":
    asyncio.run(main())
