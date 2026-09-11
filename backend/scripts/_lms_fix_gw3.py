"""Fix LMS GW3: correct FT scores, restore lives, pay wins, leave unfinished open."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import httpx

BACKEND = Path("/opt/mafia-app/backend")
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv

load_dotenv(str(BACKEND / ".env"))

SID = "80e9cec9-da12-4021-a719-e0403dad5c21"
GW = 3
THESPORTSDB_PL_ID = 4328


async def fetch_tsdb_ft(gw: int) -> list:
    from utils.last_man_standing import _fixture_result_from_scores, team_canon

    now_month = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).month
    y = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).year
    seasons = [f"{y}-{y + 1}", f"{y - 1}-{y}"] if now_month >= 7 else [f"{y - 1}-{y}", f"{y}-{y + 1}"]
    out = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        for season in seasons:
            r = await client.get(
                "https://www.thesportsdb.com/api/v1/json/123/eventsround.php",
                params={"id": THESPORTSDB_PL_ID, "r": int(gw), "s": season},
            )
            if r.status_code != 200:
                continue
            events = (r.json() or {}).get("events") or []
            if not events:
                continue
            for e in events:
                ht = (e.get("strHomeTeam") or "").strip()
                at = (e.get("strAwayTeam") or "").strip()
                if not ht or not at:
                    continue
                status = (e.get("strStatus") or "").strip().lower()
                postponed = (e.get("strPostponed") or "").strip().lower()
                if postponed in ("yes", "true") or "postponed" in status:
                    out.append({"home": ht, "away": at, "result": "postponed", "status": status})
                    continue
                if status not in ("ft", "full time", "fulltime", "match finished", "aet", "pen"):
                    out.append({
                        "home": ht,
                        "away": at,
                        "home_score": e.get("intHomeScore"),
                        "away_score": e.get("intAwayScore"),
                        "result": None,
                        "status": status,
                        "live": True,
                    })
                    continue
                try:
                    hs = int(e.get("intHomeScore"))
                    aws = int(e.get("intAwayScore"))
                except (TypeError, ValueError):
                    continue
                out.append({
                    "home": ht,
                    "away": at,
                    "home_score": hs,
                    "away_score": aws,
                    "result": _fixture_result_from_scores(hs, aws),
                    "status": status,
                })
            break
    return out


async def main():
    from server import db, send_notification
    from utils.last_man_standing import (
        COL_ENTRIES,
        COL_GAMEWEEKS,
        COL_PICKS,
        COL_WEEKLY,
        _pay_weekly,
        _pick_won,
        entry_lives,
        get_gameweek,
        get_season,
        lives_after_wrong_pick,
        now_iso,
        teams_same,
    )

    season = await get_season(db, SID)
    gw_doc = await get_gameweek(db, SID, GW)
    picks = await db[COL_PICKS].find({"season_id": SID, "gw": GW}, {"_id": 0}).to_list(500)
    print(f"GW3 was status={gw_doc.get('status')} picks={len(picks)}")

    # 1) Reverse prior settlement
    for p in picks:
        key = p.get("account_key")
        entry = await db[COL_ENTRIES].find_one({"season_id": SID, "account_key": key}, {"_id": 0})
        if not entry:
            continue
        lives = entry_lives(entry, season)
        set_e = {}
        if p.get("life_consumed"):
            set_e["lives"] = lives + 1
            if entry.get("status") == "out" and int(entry.get("eliminated_gw") or 0) == GW:
                set_e["status"] = "alive"
                set_e["eliminated_gw"] = None
            print(f"  RESTORE life {entry.get('username')}: {lives} -> {lives + 1} (was {p.get('team_name')} {p.get('outcome')})")
        if set_e:
            await db[COL_ENTRIES].update_one({"season_id": SID, "account_key": key}, {"$set": set_e})
        await db[COL_PICKS].update_one(
            {"season_id": SID, "gw": GW, "account_key": key},
            {"$unset": {"outcome": "", "correct": "", "life_consumed": "", "survived_with_life": ""}},
        )

    weekly_del = await db[COL_WEEKLY].delete_many({"season_id": SID, "gw": GW})
    print(f"cleared weekly audits={weekly_del.deleted_count}")

    # 2) Apply FT scores; clear non-FT
    tsdb = await fetch_tsdb_ft(GW)
    print("TSDB:")
    for ev in tsdb:
        print(f"  {ev}")

    new_fx = []
    for f in list(gw_doc.get("fixtures") or []):
        nxt = dict(f)
        hit = None
        for ev in tsdb:
            if teams_same(nxt.get("home") or "", ev.get("home") or "") and teams_same(
                nxt.get("away") or "", ev.get("away") or ""
            ):
                hit = ev
                break
        if hit and hit.get("live"):
            # unfinished — wipe premature final result
            nxt.pop("result", None)
            try:
                nxt["home_score"] = int(hit["home_score"]) if hit.get("home_score") is not None else None
                nxt["away_score"] = int(hit["away_score"]) if hit.get("away_score") is not None else None
            except (TypeError, ValueError):
                pass
            print(f"  UNRESOLVED (live {hit.get('status')}): {nxt.get('home')} vs {nxt.get('away')}")
        elif hit and hit.get("result") == "postponed":
            nxt["result"] = "postponed"
            nxt["home_score"] = None
            nxt["away_score"] = None
            print(f"  POSTPONED: {nxt.get('home')} vs {nxt.get('away')}")
        elif hit and hit.get("result") in ("home", "away", "draw"):
            old = (nxt.get("home_score"), nxt.get("away_score"), nxt.get("result"))
            nxt["home_score"] = hit["home_score"]
            nxt["away_score"] = hit["away_score"]
            nxt["result"] = hit["result"]
            print(f"  SET {nxt.get('home')} {old} -> {(nxt['home_score'], nxt['away_score'], nxt['result'])} {nxt.get('away')}")
        else:
            print(f"  NO MATCH keep/clear: {nxt.get('home')} vs {nxt.get('away')}")
            nxt.pop("result", None)
        new_fx.append(nxt)

    await db[COL_GAMEWEEKS].update_one(
        {"season_id": SID, "gw": GW},
        {
            "$set": {
                "fixtures": new_fx,
                "status": "locked",
                "results_synced_at": now_iso(),
            },
            "$unset": {"settled_at": "", "settle_started_at": "", "eliminated": "", "alive_after": ""},
        },
    )

    fx_by_team = {}
    for f in new_fx:
        fx_by_team[f.get("home_team_id")] = f
        fx_by_team[f.get("away_team_id")] = f

    # 3) Re-apply outcomes for picks whose fixture is resolved
    print("\n=== RE-APPLY PICKS ===")
    for p in picks:
        key = p.get("account_key")
        entry = await db[COL_ENTRIES].find_one({"season_id": SID, "account_key": key}, {"_id": 0})
        if not entry:
            continue
        fx = fx_by_team.get(p.get("team_id"))
        outcome = _pick_won(fx, p.get("team_id")) if fx else None
        if outcome is None:
            print(f"  WAIT {entry.get('username')} {p.get('team_name')} — fixture unresolved")
            continue
        if outcome == "postponed":
            await db[COL_PICKS].update_one(
                {"season_id": SID, "gw": GW, "account_key": key},
                {"$set": {"outcome": "postponed", "correct": False}},
            )
            print(f"  POSTPONED {entry.get('username')} {p.get('team_name')}")
            continue
        if outcome == "win":
            streak = int(entry.get("correct_streak") or 0) + 1
            points, streak, first = await _pay_weekly(db, season, GW, entry, streak)
            await db[COL_ENTRIES].update_one(
                {"season_id": SID, "account_key": key},
                {"$set": {"status": "alive", "eliminated_gw": None, "correct_streak": streak}},
            )
            await db[COL_PICKS].update_one(
                {"season_id": SID, "gw": GW, "account_key": key},
                {"$set": {"outcome": "win", "correct": True}, "$unset": {"life_consumed": "", "survived_with_life": ""}},
            )
            try:
                await send_notification(
                    entry.get("user_id"),
                    "LMS result corrected",
                    f"GW{GW} {p.get('team_name')} win restored. +{points} pts, streak {streak}.",
                    "system",
                )
            except Exception:
                pass
            print(f"  WIN {entry.get('username')} {p.get('team_name')} streak={streak} paid={points} first={first}")
        else:
            current_lives = entry_lives(entry, season)
            left, still_alive = lives_after_wrong_pick(current_lives)
            pick_set = {"outcome": outcome, "correct": False, "life_consumed": True, "survived_with_life": still_alive}
            await db[COL_PICKS].update_one(
                {"season_id": SID, "gw": GW, "account_key": key},
                {"$set": pick_set},
            )
            if still_alive:
                await db[COL_ENTRIES].update_one(
                    {"season_id": SID, "account_key": key},
                    {"$set": {"status": "alive", "eliminated_gw": None, "correct_streak": 0, "lives": left}},
                )
                print(f"  LOSE {entry.get('username')} {p.get('team_name')} lives {current_lives}->{left}")
            else:
                await db[COL_ENTRIES].update_one(
                    {"season_id": SID, "account_key": key},
                    {"$set": {"status": "out", "eliminated_gw": GW, "correct_streak": 0, "lives": 0}},
                )
                print(f"  OUT {entry.get('username')} {p.get('team_name')}")

    # 4) Mark settled only if all fixtures resolved
    from utils.last_man_standing import _gw_all_resolved

    fresh = await get_gameweek(db, SID, GW)
    if _gw_all_resolved(fresh.get("fixtures") or []):
        await db[COL_GAMEWEEKS].update_one(
            {"season_id": SID, "gw": GW},
            {"$set": {"status": "settled", "settled_at": now_iso()}},
        )
        print("GW3 marked settled")
    else:
        print("GW3 left LOCKED — waiting for unfinished fixtures")

    print("\n=== FINAL ===")
    for p in picks:
        e = await db[COL_ENTRIES].find_one(
            {"season_id": SID, "account_key": p.get("account_key")},
            {"_id": 0, "username": 1, "lives": 1, "status": 1, "correct_streak": 1},
        )
        np = await db[COL_PICKS].find_one(
            {"season_id": SID, "gw": GW, "account_key": p.get("account_key")},
            {"_id": 0, "team_name": 1, "outcome": 1, "correct": 1, "life_consumed": 1},
        )
        print(f"  {e} | {np}")


asyncio.run(main())
