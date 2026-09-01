"""Premier League Last Man Standing: seasons, picks, settle, identity, payouts."""
from __future__ import annotations

import logging
import os
import re
import unicodedata
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from utils.point_provenance import log_points_event
from utils.tutorial import normalize_email

logger = logging.getLogger(__name__)

LMS_SEED_POT = 150_000
LMS_ENTRY_FEE = 5_000
LMS_WEEKLY_CORRECT = 1_000
LMS_WEEKLY_STREAK = 250
LMS_START_LIVES = 2
LMS_EXTRA_LIFE_COST = 2_500
LMS_GW1_FIXTURE_COUNT = 10
LMS_GW1_TEAM_COUNT = 20
LMS_MAX_GW = 38
LMS_SPORT_KEY = "soccer_epl"

COL_SEASONS = "lms_seasons"
COL_GAMEWEEKS = "lms_gameweeks"
COL_ENTRIES = "lms_entries"
COL_PICKS = "lms_picks"
COL_WEEKLY = "lms_weekly_payouts"
COL_POT = "lms_pot_payouts"

_POSTPONED_STATUSES = frozenset({"POSTPONED", "CANCELLED", "CANCELED", "SUSPENDED", "ABANDONED"})
_FINISHED_STATUSES = frozenset({"FINISHED", "AWARDED"})


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def parse_dt(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        dt = raw
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def name_norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def slug_team(name: str) -> str:
    s = unicodedata.normalize("NFKD", str(name or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = re.sub(r"\b(fc|afc|cfc)\b", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "team"


_TEAM_ALIASES = {
    "mancity": "manchestercity",
    "manutd": "manchesterunited",
    "manunited": "manchesterunited",
    "spurs": "tottenhamhotspur",
    "tottenham": "tottenhamhotspur",
    "wolves": "wolverhamptonwanderers",
    "newcastle": "newcastleunited",
    "leeds": "leedsunited",
    "nottforest": "nottinghamforest",
    "nottingham": "nottinghamforest",
    "bournemouth": "bournemouth",
    "afcbournemouth": "bournemouth",
    "brighton": "brightonhovealbion",
    "brightonhovealbion": "brightonhovealbion",
    "brightonandhovealbion": "brightonhovealbion",
}


def team_canon(name: str) -> str:
    n = name_norm(name)
    n = n.replace("and", "")
    if n in _TEAM_ALIASES:
        return _TEAM_ALIASES[n]
    n2 = n
    for junk in ("afc", "cfc", "fc"):
        n2 = n2.replace(junk, "")
    return _TEAM_ALIASES.get(n2, n2)


def teams_same(a: str, b: str) -> bool:
    return bool(a) and bool(b) and team_canon(a) == team_canon(b)


def account_key_from_user(user: Optional[dict]) -> str:
    return normalize_email((user or {}).get("email"))


def gw1_completeness(fixtures: List[dict]) -> Tuple[bool, int, int]:
    fx = [f for f in (fixtures or []) if f]
    teams = set()
    for f in fx:
        hid = (f.get("home_team_id") or "").strip()
        aid = (f.get("away_team_id") or "").strip()
        if hid:
            teams.add(hid)
        if aid:
            teams.add(aid)
    n_fx = len(fx)
    n_teams = len(teams)
    ok = n_fx == LMS_GW1_FIXTURE_COUNT and n_teams == LMS_GW1_TEAM_COUNT
    return ok, n_fx, n_teams


def lives_after_wrong_pick(lives: int) -> Tuple[int, bool]:
    """Return (lives_left, still_alive) after a wrong/missed pick."""
    left = max(0, int(lives) - 1)
    return left, left > 0


def entry_lives(entry: Optional[dict], season: Optional[dict] = None) -> int:
    if entry is not None and entry.get("lives") is not None:
        return max(0, int(entry.get("lives") or 0))
    return int((season or {}).get("starting_lives") or LMS_START_LIVES)


def split_pot(pot: int, winner_count: int) -> List[int]:
    n = max(1, int(winner_count))
    p = max(0, int(pot))
    base = p // n
    rem = p - base * n
    out = [base] * n
    if rem:
        out[0] += rem
    return out


def is_lms_staff_user(user: Optional[dict]) -> bool:
    """Admins and mods may play LMS but take none of the prizes."""
    if not user:
        return False
    try:
        from server import _admin_or_mod

        return bool(_admin_or_mod(user))
    except Exception:
        return bool(user.get("is_moderator") or user.get("is_admin"))


def entry_prize_ineligible(entry: Optional[dict]) -> bool:
    if not entry:
        return False
    if entry.get("staff_entry") or entry.get("prize_eligible") is False:
        return True
    return False


async def filter_prize_eligible(db, entries: List[dict]) -> List[dict]:
    rows = [e for e in (entries or []) if e]
    pending = [e for e in rows if not entry_prize_ineligible(e)]
    skipped_ids = {e.get("user_id") for e in rows if entry_prize_ineligible(e)}
    uids = list({e.get("user_id") for e in pending if e.get("user_id")} - skipped_ids)
    staff_now = set()
    if uids:
        cursor = db.users.find(
            {"id": {"$in": uids}},
            {"_id": 0, "id": 1, "email": 1, "is_moderator": 1, "is_admin": 1, "admin_acting_as_normal": 1, "admin_preview_as_mod": 1},
        )
        async for u in cursor:
            if is_lms_staff_user(u):
                staff_now.add(u.get("id"))
    out = []
    for e in rows:
        if entry_prize_ineligible(e):
            continue
        if e.get("user_id") in staff_now:
            continue
        out.append(e)
    return out


def _public_season(doc: dict) -> dict:
    if not doc:
        return {}
    out = {k: v for k, v in doc.items() if k != "_id"}
    return out


async def ensure_lms_indexes(db) -> None:
    await db[COL_SEASONS].create_index("id", unique=True)
    await db[COL_SEASONS].create_index([("status", 1), ("created_at", -1)])
    await db[COL_GAMEWEEKS].create_index([("season_id", 1), ("gw", 1)], unique=True)
    await db[COL_GAMEWEEKS].create_index([("season_id", 1), ("status", 1)])
    await db[COL_ENTRIES].create_index([("season_id", 1), ("account_key", 1)], unique=True)
    await db[COL_ENTRIES].create_index([("season_id", 1), ("user_id", 1)])
    await db[COL_ENTRIES].create_index([("season_id", 1), ("status", 1)])
    await db[COL_PICKS].create_index([("season_id", 1), ("gw", 1), ("account_key", 1)], unique=True)
    await db[COL_WEEKLY].create_index([("season_id", 1), ("gw", 1), ("account_key", 1)], unique=True)
    await db[COL_POT].create_index([("season_id", 1), ("account_key", 1)], unique=True)


async def current_season(db) -> Optional[dict]:
    rows = await db[COL_SEASONS].find(
        {"status": {"$in": ["open", "active", "settling"]}},
        {"_id": 0},
    ).sort("created_at", -1).limit(1).to_list(1)
    if rows:
        return rows[0]
    rows = await db[COL_SEASONS].find({}, {"_id": 0}).sort("created_at", -1).limit(1).to_list(1)
    return rows[0] if rows else None


async def get_season(db, season_id: str) -> Optional[dict]:
    return await db[COL_SEASONS].find_one({"id": season_id}, {"_id": 0})


async def get_gameweek(db, season_id: str, gw: int) -> Optional[dict]:
    return await db[COL_GAMEWEEKS].find_one({"season_id": season_id, "gw": int(gw)}, {"_id": 0})


async def transfer_lms_entry_to_user(db, to_user: dict, *, season_id: Optional[str] = None) -> int:
    """Move LMS seats for this email onto to_user. Returns number of seasons migrated."""
    key = account_key_from_user(to_user)
    uid = (to_user or {}).get("id") or ""
    uname = (to_user or {}).get("username") or ""
    if not key or not uid:
        return 0
    filt: Dict[str, Any] = {"account_key": key, "user_id": {"$ne": uid}}
    if season_id:
        filt["season_id"] = season_id
    else:
        seasons = await db[COL_SEASONS].find(
            {"status": {"$in": ["open", "active", "settling"]}},
            {"_id": 0, "id": 1},
        ).to_list(20)
        ids = [s["id"] for s in seasons if s.get("id")]
        if ids:
            filt["season_id"] = {"$in": ids}
    entries = await db[COL_ENTRIES].find(filt, {"_id": 0, "season_id": 1, "id": 1}).to_list(50)
    n = 0
    for e in entries:
        sid = e.get("season_id")
        res = await db[COL_ENTRIES].update_one(
            {"season_id": sid, "account_key": key},
            {"$set": {"user_id": uid, "username": uname, "migrated_at": now_iso()}},
        )
        if res.modified_count:
            await db[COL_PICKS].update_many(
                {"season_id": sid, "account_key": key},
                {"$set": {"user_id": uid, "username": uname}},
            )
            n += 1
    return n


async def on_lms_owner_death(db, user_id: str) -> int:
    """Keep the email seat; attach it to another living character on the same email if one exists."""
    uid = (user_id or "").strip()
    if not uid:
        return 0
    dead = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "email": 1})
    key = account_key_from_user(dead or {})
    if not key:
        return 0
    living = await db.users.find_one(
        {"email": key, "id": {"$ne": uid}, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1, "email": 1, "username": 1},
    )
    if not living:
        return 0
    return await transfer_lms_entry_to_user(db, living)


async def _credit_points(db, user_id: str, amount: int, event_type: str, *, event_ref: str, meta: dict) -> None:
    amt = int(amount)
    if amt <= 0 or not user_id:
        return
    await db.users.update_one({"id": user_id}, {"$inc": {"points": amt}})
    await log_points_event(db, user_id=user_id, points=amt, event_type=event_type, event_ref=event_ref, meta=meta)


async def _refund_points(db, user_id: str, amount: int, event_ref: str, meta: dict) -> None:
    await _credit_points(db, user_id, amount, "lms_refund", event_ref=event_ref, meta=meta)


def _fixture_result_from_scores(home: int, away: int) -> str:
    if home > away:
        return "home"
    if away > home:
        return "away"
    return "draw"


def _apply_fd_status(fx: dict, status: str, home_score: Any, away_score: Any) -> dict:
    st = (status or "").upper()
    out = dict(fx)
    out["fd_status"] = st
    if st in _POSTPONED_STATUSES:
        out["result"] = "postponed"
        return out
    if st in _FINISHED_STATUSES:
        try:
            hs = int(home_score)
            aws = int(away_score)
        except (TypeError, ValueError):
            return out
        out["home_score"] = hs
        out["away_score"] = aws
        out["result"] = _fixture_result_from_scores(hs, aws)
    return out


async def _fetch_football_data_pl_matches() -> List[dict]:
    token = (os.environ.get("FOOTBALL_DATA_ORG_TOKEN") or "").strip()
    if not token:
        return []
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(
                "https://api.football-data.org/v4/competitions/PL/matches",
                headers={"X-Auth-Token": token},
            )
        if r.status_code != 200:
            logger.warning("football-data PL matches HTTP %s", r.status_code)
            return []
        data = r.json() or {}
        return list(data.get("matches") or [])
    except Exception as ex:
        logger.warning("football-data PL matches failed: %s", ex)
        return []


def _team_from_fd(team: dict) -> Tuple[str, str]:
    tid = team.get("id")
    name = (team.get("shortName") or team.get("name") or "").strip()
    if tid is not None:
        return f"fd:{int(tid)}", name or f"Team {tid}"
    return slug_team(name), name


def _fixtures_from_fd_matches(matches: List[dict], gw: int) -> List[dict]:
    out = []
    for m in matches or []:
        try:
            md = int(m.get("matchday") or 0)
        except (TypeError, ValueError):
            md = 0
        if md != int(gw):
            continue
        home = m.get("homeTeam") or {}
        away = m.get("awayTeam") or {}
        hid, hname = _team_from_fd(home)
        aid, aname = _team_from_fd(away)
        kickoff = (m.get("utcDate") or "").strip()
        if not hid or not aid or not kickoff:
            continue
        fx = {
            "external_event_id": str(m.get("id") or ""),
            "home_team_id": hid,
            "away_team_id": aid,
            "home": hname,
            "away": aname,
            "kickoff": kickoff,
            "result": None,
        }
        score = (m.get("score") or {}).get("fullTime") or {}
        fx = _apply_fd_status(fx, m.get("status") or "", score.get("home"), score.get("away"))
        out.append(fx)
    out.sort(key=lambda f: f.get("kickoff") or "")
    return out


async def _fetch_odds_epl_events() -> List[dict]:
    key = (os.environ.get("THE_ODDS_API_KEY") or "").strip()
    if not key:
        return []
    events: List[dict] = []
    try:
        async with httpx.AsyncClient(timeout=18.0) as client:
            r = await client.get(
                "https://api.the-odds-api.com/v4/sports/soccer_epl/odds",
                params={"apiKey": key, "regions": "uk,eu,us", "markets": "h2h", "oddsFormat": "decimal"},
            )
            if r.status_code == 200:
                raw = r.json()
                if isinstance(raw, list):
                    events.extend(raw)
            s = await client.get(
                "https://api.the-odds-api.com/v4/sports/soccer_epl/scores",
                params={"apiKey": key, "daysFrom": 3},
            )
            if s.status_code == 200:
                raw = s.json()
                if isinstance(raw, list):
                    by_id = {e.get("id"): e for e in events if e.get("id")}
                    for ev in raw:
                        eid = ev.get("id")
                        if eid and eid in by_id:
                            by_id[eid].update({k: ev[k] for k in ("completed", "scores", "commence_time") if k in ev})
                        elif eid:
                            events.append(ev)
    except Exception as ex:
        logger.warning("Odds API EPL fetch failed: %s", ex)
        return events
    return events


THESPORTSDB_PL_ID = "4328"


async def _fetch_thesportsdb_pl_results(gw: Optional[int] = None) -> List[dict]:
    """PL results by gameweek round. eventsseason.php is truncated on the free key (~15 rows)."""
    now = datetime.now(timezone.utc)
    y = now.year
    seasons = [f"{y}-{y + 1}", f"{y - 1}-{y}"] if now.month >= 7 else [f"{y - 1}-{y}", f"{y}-{y + 1}"]
    rounds = [int(gw)] if gw else [1, 2, 3, 4]
    out: List[dict] = []
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            for season in seasons:
                got_any = False
                for rnd in rounds:
                    r = await client.get(
                        "https://www.thesportsdb.com/api/v1/json/123/eventsround.php",
                        params={"id": THESPORTSDB_PL_ID, "r": int(rnd), "s": season},
                    )
                    if r.status_code != 200:
                        continue
                    events = (r.json() or {}).get("events") or []
                    if not events:
                        continue
                    got_any = True
                    for e in events:
                        ht = (e.get("strHomeTeam") or "").strip()
                        at = (e.get("strAwayTeam") or "").strip()
                        if not ht or not at:
                            continue
                        postponed = (e.get("strPostponed") or "").strip().lower()
                        status = (e.get("strStatus") or "").strip().lower()
                        if postponed in ("yes", "true") or "postponed" in status:
                            out.append({"home": ht, "away": at, "result": "postponed"})
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
                        })
                if got_any:
                    break
    except Exception as ex:
        logger.warning("TheSportsDB PL results failed: %s", ex)
    return out


async def _thesportsdb_round_fixtures(gw: int) -> List[dict]:
    now = datetime.now(timezone.utc)
    y = now.year
    seasons = [f"{y}-{y + 1}", f"{y - 1}-{y}"] if now.month >= 7 else [f"{y - 1}-{y}", f"{y}-{y + 1}"]
    out: List[dict] = []
    try:
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
                    kick = (e.get("strTimestamp") or "").strip()
                    if kick and "T" in kick and "+" not in kick and "Z" not in kick:
                        kick = kick + "+00:00"
                    if not ht or not at or not kick:
                        continue
                    home_name = "AFC Bournemouth" if team_canon(ht) == "bournemouth" else ht
                    away_name = "AFC Bournemouth" if team_canon(at) == "bournemouth" else at
                    fx = {
                        "external_event_id": f"tsdb-{e.get('idEvent') or slug_team(home_name)+slug_team(away_name)}",
                        "home_team_id": slug_team(home_name),
                        "away_team_id": slug_team(away_name),
                        "home": home_name,
                        "away": away_name,
                        "kickoff": kick,
                        "result": None,
                    }
                    postponed = (e.get("strPostponed") or "").strip().lower()
                    status = (e.get("strStatus") or "").strip().upper()
                    if postponed in ("yes", "true") or "POSTPONED" in status:
                        fx["result"] = "postponed"
                    else:
                        try:
                            hs = int(e.get("intHomeScore"))
                            aws = int(e.get("intAwayScore"))
                            fx["home_score"] = hs
                            fx["away_score"] = aws
                            fx["result"] = _fixture_result_from_scores(hs, aws)
                        except (TypeError, ValueError):
                            pass
                    out.append(fx)
                if out:
                    break
    except Exception as ex:
        logger.warning("TheSportsDB PL round %s fixtures failed: %s", gw, ex)
    return _sort_fixtures(out)


def _cluster_odds_into_gameweeks(events: List[dict]) -> Dict[int, List[dict]]:
    rows = []
    for ev in events or []:
        kick = parse_dt(ev.get("commence_time"))
        if not kick:
            continue
        home = (ev.get("home_team") or "").strip()
        away = (ev.get("away_team") or "").strip()
        if not home or not away:
            continue
        fx = {
            "external_event_id": str(ev.get("id") or ""),
            "home_team_id": slug_team(home),
            "away_team_id": slug_team(away),
            "home": home,
            "away": away,
            "kickoff": kick.isoformat(),
            "result": None,
        }
        if ev.get("completed") and ev.get("scores"):
            scores = ev.get("scores") or []
            try:
                by_name = {(s.get("name") or "").strip(): int(s.get("score")) for s in scores}
                hs = by_name.get(home)
                aws = by_name.get(away)
                if hs is not None and aws is not None:
                    fx["home_score"] = hs
                    fx["away_score"] = aws
                    fx["result"] = _fixture_result_from_scores(hs, aws)
            except Exception:
                pass
        rows.append((kick, fx))
    rows.sort(key=lambda x: x[0])
    groups: List[List[dict]] = []
    cur: List[Tuple[datetime, dict]] = []
    for kick, fx in rows:
        if not cur:
            cur = [(kick, fx)]
            continue
        if (kick - cur[-1][0]) > timedelta(hours=60) and len(cur) >= 6:
            groups.append([f for _, f in cur])
            cur = [(kick, fx)]
        else:
            cur.append((kick, fx))
    if cur:
        groups.append([f for _, f in cur])
    out: Dict[int, List[dict]] = {}
    for i, fx_list in enumerate(groups[:LMS_MAX_GW], start=1):
        out[i] = fx_list
    return out


def _deadline_from_fixtures(fixtures: List[dict]) -> Optional[str]:
    times = [parse_dt(f.get("kickoff")) for f in (fixtures or [])]
    times = [t for t in times if t]
    if not times:
        return None
    return min(times).isoformat()


def _sort_fixtures(fixtures: List[dict]) -> List[dict]:
    return sorted(list(fixtures or []), key=lambda f: (f.get("kickoff") or "", f.get("home") or ""))


def official_gw1_2026_fixtures() -> List[dict]:
    """2026/27 opening weekend (kickoffs in UTC; UK was BST)."""
    rows = [
        ("2026-08-21T19:00:00+00:00", "Arsenal", "Coventry City"),
        ("2026-08-22T11:30:00+00:00", "Hull City", "Manchester United"),
        ("2026-08-22T14:00:00+00:00", "Everton", "Crystal Palace"),
        ("2026-08-22T14:00:00+00:00", "Ipswich Town", "Sunderland"),
        ("2026-08-22T14:00:00+00:00", "Nottingham Forest", "Leeds United"),
        ("2026-08-22T16:30:00+00:00", "Brentford", "Tottenham Hotspur"),
        ("2026-08-23T13:00:00+00:00", "Brighton and Hove Albion", "Aston Villa"),
        ("2026-08-23T13:00:00+00:00", "Manchester City", "AFC Bournemouth"),
        ("2026-08-23T15:30:00+00:00", "Newcastle United", "Liverpool"),
        ("2026-08-24T19:00:00+00:00", "Fulham", "Chelsea"),
    ]
    return _official_gw_fixtures(1, rows)


def official_gw2_2026_fixtures() -> List[dict]:
    """2026/27 GW2 (kickoffs in UTC; UK was BST)."""
    rows = [
        ("2026-08-28T19:00:00+00:00", "Crystal Palace", "Manchester City"),
        ("2026-08-29T11:30:00+00:00", "Liverpool", "Nottingham Forest"),
        ("2026-08-29T14:00:00+00:00", "AFC Bournemouth", "Everton"),
        ("2026-08-29T14:00:00+00:00", "Coventry City", "Hull City"),
        ("2026-08-29T16:30:00+00:00", "Tottenham Hotspur", "Newcastle United"),
        ("2026-08-30T13:00:00+00:00", "Chelsea", "Brighton and Hove Albion"),
        ("2026-08-30T13:00:00+00:00", "Leeds United", "Brentford"),
        ("2026-08-30T13:00:00+00:00", "Sunderland", "Fulham"),
        ("2026-08-30T15:30:00+00:00", "Manchester United", "Ipswich Town"),
        ("2026-08-31T19:00:00+00:00", "Aston Villa", "Arsenal"),
    ]
    return _official_gw_fixtures(2, rows)


def _official_gw_fixtures(gw: int, rows: List[Tuple[str, str, str]]) -> List[dict]:
    out = []
    for kick, home, away in rows:
        out.append({
            "external_event_id": f"pl-2026-gw{int(gw)}-{slug_team(home)}-{slug_team(away)}",
            "home_team_id": slug_team(home),
            "away_team_id": slug_team(away),
            "home": home,
            "away": away,
            "kickoff": kick,
            "result": None,
        })
    return _sort_fixtures(out)


def _gw_status_for_fixtures(fixtures: List[dict], *, gw1_must_complete: bool) -> str:
    if gw1_must_complete:
        ok, _, _ = gw1_completeness(fixtures)
        if not ok:
            return "upcoming"
    deadline = parse_dt(_deadline_from_fixtures(fixtures))
    n = now_utc()
    if not deadline:
        return "upcoming"
    if n >= deadline:
        return "locked"
    return "picks_open"


async def sync_season_fixtures(db, season_id: str) -> dict:
    season = await get_season(db, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    fd_matches = await _fetch_football_data_pl_matches()
    grouped: Dict[int, List[dict]] = {}
    source = "none"
    if fd_matches:
        source = "football-data"
        matchdays = set()
        for m in fd_matches:
            try:
                md = int(m.get("matchday") or 0)
            except (TypeError, ValueError):
                md = 0
            if 1 <= md <= LMS_MAX_GW:
                matchdays.add(md)
        for gw in sorted(matchdays):
            grouped[gw] = _fixtures_from_fd_matches(fd_matches, gw)
    gw1_ok, n_fx, n_teams = gw1_completeness(grouped.get(1) or [])
    if not gw1_ok:
        official = official_gw1_2026_fixtures()
        ok_off, n_fx, n_teams = gw1_completeness(official)
        if ok_off:
            grouped[1] = official
            gw1_ok = True
            source = "official-gw1" if source == "none" else f"{source}+official-gw1"
    if not gw1_ok:
        odds_events = await _fetch_odds_epl_events()
        clustered = _cluster_odds_into_gameweeks(odds_events)
        if clustered:
            source = "odds-api" if source == "none" else f"{source}+odds"
            for gw, fx in clustered.items():
                if gw not in grouped or not grouped[gw]:
                    grouped[gw] = fx
        gw1_ok, n_fx, n_teams = gw1_completeness(grouped.get(1) or [])
    gw2_ok, _, _ = gw1_completeness(grouped.get(2) or [])
    if not gw2_ok:
        official2 = official_gw2_2026_fixtures()
        if gw1_completeness(official2)[0]:
            grouped[2] = official2
            source = "official-gw2" if source == "none" else f"{source}+official-gw2"
    for gw in range(1, 7):
        if gw1_completeness(grouped.get(gw) or [])[0]:
            continue
        ts_fx = await _thesportsdb_round_fixtures(gw)
        if gw1_completeness(ts_fx)[0]:
            grouped[gw] = ts_fx
            source = "thesportsdb" if source == "none" else f"{source}+tsdb-gw{gw}"
    if not grouped:
        raise HTTPException(status_code=400, detail="Could not load Premier League fixtures")
    upserted = 0
    for gw, fixtures in grouped.items():
        existing = await get_gameweek(db, season_id, gw)
        prev_status = (existing or {}).get("status") or "upcoming"
        must_complete = gw == 1
        fixtures = _sort_fixtures(fixtures)
        status = _gw_status_for_fixtures(fixtures, gw1_must_complete=must_complete)
        current_gw = int(season.get("current_gameweek") or 1)
        if gw > current_gw and status == "picks_open":
            status = "upcoming"
        if prev_status in ("settling", "settled", "locked"):
            status = prev_status
            if existing and existing.get("fixtures"):
                fixtures = existing["fixtures"]
        deadline = _deadline_from_fixtures(fixtures)
        await db[COL_GAMEWEEKS].update_one(
            {"season_id": season_id, "gw": gw},
            {
                "$set": {
                    "season_id": season_id,
                    "gw": gw,
                    "fixtures": fixtures,
                    "pick_deadline": deadline,
                    "status": status,
                    "synced_at": now_iso(),
                    "source": source,
                },
                "$setOnInsert": {"id": str(uuid.uuid4())},
            },
            upsert=True,
        )
        upserted += 1

    if season.get("status") == "open" and gw1_ok:
        gw1_doc = await get_gameweek(db, season_id, 1)
        if gw1_doc and gw1_doc.get("status") == "picks_open":
            await db[COL_SEASONS].update_one(
                {"id": season_id},
                {"$set": {"current_gameweek": 1, "gw1_complete": True}},
            )
        else:
            await db[COL_SEASONS].update_one({"id": season_id}, {"$set": {"gw1_complete": True}})
    else:
        await db[COL_SEASONS].update_one(
            {"id": season_id},
            {"$set": {"gw1_complete": bool(gw1_ok)}},
        )

    return {
        "season_id": season_id,
        "source": source,
        "gameweeks": upserted,
        "gw1_complete": gw1_ok,
        "gw1_fixtures": n_fx,
        "gw1_teams": n_teams,
        "message": None if gw1_ok else f"GW1 incomplete — {n_fx}/10 fixtures ({n_teams} teams)",
    }


def _team_playing(fixtures: List[dict], team_id: str) -> Optional[dict]:
    tid = (team_id or "").strip()
    for f in fixtures or []:
        if f.get("home_team_id") == tid or f.get("away_team_id") == tid:
            return f
    return None


def _pick_won(fx: dict, team_id: str) -> Optional[str]:
    """Return 'win' | 'lose' | 'postponed' | None (unresolved)."""
    result = fx.get("result")
    if result == "postponed":
        return "postponed"
    if result not in ("home", "away", "draw"):
        return None
    tid = (team_id or "").strip()
    if result == "draw":
        return "lose"
    if result == "home" and fx.get("home_team_id") == tid:
        return "win"
    if result == "away" and fx.get("away_team_id") == tid:
        return "win"
    return "lose"


def _gw_all_resolved(fixtures: List[dict]) -> bool:
    for f in fixtures or []:
        if f.get("result") not in ("home", "away", "draw", "postponed"):
            return False
    return bool(fixtures)


async def create_season(
    db,
    *,
    name: str,
    seed_pot: int = LMS_SEED_POT,
    entry_fee: int = LMS_ENTRY_FEE,
    weekly_correct_bonus: int = LMS_WEEKLY_CORRECT,
    weekly_streak_bonus: int = LMS_WEEKLY_STREAK,
    house_cut_pct: float = 0.0,
) -> dict:
    sid = str(uuid.uuid4())
    doc = {
        "id": sid,
        "name": (name or "").strip() or "Premier League LMS",
        "status": "open",
        "currency": "points",
        "seed_pot": int(seed_pot),
        "entry_fee": int(entry_fee),
        "house_cut_pct": float(house_cut_pct or 0),
        "pot": int(seed_pot),
        "entry_count": 0,
        "weekly_correct_bonus": int(weekly_correct_bonus),
        "weekly_streak_bonus": int(weekly_streak_bonus),
        "starting_lives": LMS_START_LIVES,
        "extra_life_cost": LMS_EXTRA_LIFE_COST,
        "current_gameweek": 1,
        "pick_deadline_mode": "first_kickoff",
        "gw1_complete": False,
        "created_at": now_iso(),
        "settled_at": None,
        "winner_user_ids": [],
    }
    await db[COL_SEASONS].insert_one(doc)
    sync = {}
    try:
        sync = await sync_season_fixtures(db, sid)
    except HTTPException as exc:
        sync = {"message": str(exc.detail)}
    except Exception:
        logger.exception("LMS fixture sync on create failed")
        sync = {"message": "Fixture sync failed"}
    out = _public_season(doc)
    out["sync"] = sync
    return out


async def open_season(db, season_id: str) -> dict:
    season = await get_season(db, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    gw1 = await get_gameweek(db, season_id, 1)
    ok, n_fx, n_teams = gw1_completeness((gw1 or {}).get("fixtures") or [])
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=f"GW1 incomplete — {n_fx}/10 fixtures ({n_teams} teams). Sync fixtures first.",
        )
    await db[COL_SEASONS].update_one(
        {"id": season_id, "status": {"$in": ["open"]}},
        {"$set": {"status": "open", "gw1_complete": True, "current_gameweek": 1}},
    )
    if gw1 and gw1.get("status") == "upcoming":
        deadline = parse_dt(gw1.get("pick_deadline"))
        status = "locked" if deadline and now_utc() >= deadline else "picks_open"
        await db[COL_GAMEWEEKS].update_one(
            {"season_id": season_id, "gw": 1},
            {"$set": {"status": status}},
        )
    return {"ok": True, "season_id": season_id}


async def join_season(db, user: dict, season_id: str) -> dict:
    key = account_key_from_user(user)
    uid = user.get("id") or ""
    if not key:
        raise HTTPException(status_code=400, detail="A verified email is required to join Last Man Standing.")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("is_dead"):
        raise HTTPException(status_code=400, detail="Dead characters cannot join. Create your next character first.")

    await transfer_lms_entry_to_user(db, user, season_id=season_id)
    existing = await db[COL_ENTRIES].find_one({"season_id": season_id, "account_key": key}, {"_id": 0})
    if existing:
        if existing.get("user_id") != uid:
            await transfer_lms_entry_to_user(db, user, season_id=season_id)
            existing = await db[COL_ENTRIES].find_one({"season_id": season_id, "account_key": key}, {"_id": 0})
        return {"already_joined": True, "entry": existing}

    season = await get_season(db, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    if season.get("status") not in ("open", "active"):
        raise HTTPException(status_code=400, detail="This season is not open for entry.")
    gw1 = await get_gameweek(db, season_id, 1)
    ok, n_fx, n_teams = gw1_completeness((gw1 or {}).get("fixtures") or [])
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=f"GW1 fixtures are not ready yet ({n_fx}/10). Try again shortly.",
        )
    if (gw1 or {}).get("status") != "picks_open" or _picks_locked(gw1 or {}):
        raise HTTPException(status_code=400, detail="GW1 is not open for entry.")
    if season.get("status") == "active" and int((gw1 or {}).get("gw") or 1) != 1:
        raise HTTPException(status_code=400, detail="Entry closed for this season.")

    fee = int(season.get("entry_fee") or LMS_ENTRY_FEE)
    debit = await db.users.find_one_and_update(
        {"id": uid, "points": {"$gte": fee}, "is_dead": {"$ne": True}},
        {"$inc": {"points": -fee}},
        projection={"_id": 0, "id": 1, "points": 1, "username": 1},
    )
    if not debit:
        raise HTTPException(status_code=400, detail=f"You need {fee:,} points to enter.")
    staff = is_lms_staff_user(user)
    entry = {
        "id": str(uuid.uuid4()),
        "season_id": season_id,
        "account_key": key,
        "user_id": uid,
        "username": user.get("username") or debit.get("username") or "",
        "status": "alive",
        "teams_used": [],
        "eliminated_gw": None,
        "correct_streak": 0,
        "lives": LMS_START_LIVES,
        "extra_life_bought": False,
        "joined_at": now_iso(),
        "entry_fee_paid": fee,
        "staff_entry": staff,
        "prize_eligible": not staff,
    }
    try:
        await db[COL_ENTRIES].insert_one(entry)
    except DuplicateKeyError:
        await _refund_points(db, uid, fee, event_ref=f"lms:{season_id}:join-dup", meta={"season_id": season_id})
        existing = await db[COL_ENTRIES].find_one({"season_id": season_id, "account_key": key}, {"_id": 0})
        return {"already_joined": True, "entry": existing}
    except Exception:
        await _refund_points(db, uid, fee, event_ref=f"lms:{season_id}:join-fail", meta={"season_id": season_id})
        raise
    # Seat is committed. Pot/ledger must not 500 the client into thinking join failed.
    try:
        await db[COL_SEASONS].update_one(
            {"id": season_id},
            {"$inc": {"pot": fee, "entry_count": 1}},
        )
    except Exception:
        logger.exception("lms join pot increment failed season=%s user=%s", season_id, uid)
        try:
            await db[COL_SEASONS].update_one(
                {"id": season_id},
                {"$inc": {"pot": fee, "entry_count": 1}},
            )
        except Exception:
            logger.exception("lms join pot increment retry failed season=%s", season_id)
    try:
        await log_points_event(
            db,
            user_id=uid,
            points=-fee,
            event_type="lms_entry",
            event_ref=f"lms:{season_id}:entry:{entry['id']}",
            meta={"season_id": season_id, "fee": fee},
        )
    except Exception:
        logger.exception("lms join ledger failed season=%s user=%s", season_id, uid)
    out = {k: v for k, v in entry.items() if k != "_id"}
    return {"already_joined": False, "entry": out}


async def buy_extra_life(db, user: dict, season_id: str) -> dict:
    key = account_key_from_user(user)
    uid = user.get("id") or ""
    if user.get("is_dead"):
        raise HTTPException(status_code=400, detail="Dead characters cannot buy a life.")
    if not key or not uid:
        raise HTTPException(status_code=400, detail="A verified email is required.")
    await transfer_lms_entry_to_user(db, user, season_id=season_id)
    season = await get_season(db, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    if season.get("status") not in ("open", "active"):
        raise HTTPException(status_code=400, detail="This season is not open.")
    cost = int(season.get("extra_life_cost") or LMS_EXTRA_LIFE_COST)
    claimed = await db[COL_ENTRIES].find_one_and_update(
        {
            "season_id": season_id,
            "account_key": key,
            "status": "alive",
            "extra_life_bought": {"$ne": True},
        },
        {"$set": {"extra_life_bought": True, "extra_life_pending": True}},
    )
    if not claimed:
        existing = await db[COL_ENTRIES].find_one({"season_id": season_id, "account_key": key}, {"_id": 0, "status": 1, "extra_life_bought": 1, "lives": 1})
        if not existing:
            raise HTTPException(status_code=400, detail="Join the season first.")
        if existing.get("status") != "alive":
            raise HTTPException(status_code=400, detail="Only alive players can buy an extra life.")
        raise HTTPException(status_code=400, detail="You already bought your extra life this season.")
    debit = await db.users.find_one_and_update(
        {"id": uid, "points": {"$gte": cost}, "is_dead": {"$ne": True}},
        {"$inc": {"points": -cost}},
        projection={"_id": 0, "id": 1, "points": 1},
    )
    if not debit:
        await db[COL_ENTRIES].update_one(
            {"season_id": season_id, "account_key": key, "extra_life_pending": True},
            {"$set": {"extra_life_bought": False, "extra_life_pending": False}},
        )
        raise HTTPException(status_code=400, detail=f"You need {cost:,} points for an extra life.")
    new_lives = entry_lives(claimed, season) + 1
    await db[COL_ENTRIES].update_one(
        {"season_id": season_id, "account_key": key},
        {"$set": {
            "lives": new_lives,
            "extra_life_pending": False,
            "user_id": uid,
            "username": user.get("username") or claimed.get("username") or "",
        }},
    )
    await log_points_event(
        db,
        user_id=uid,
        points=-cost,
        event_type="lms_extra_life",
        event_ref=f"lms:{season_id}:life:{key}",
        meta={"season_id": season_id, "cost": cost},
    )
    entry = await db[COL_ENTRIES].find_one({"season_id": season_id, "account_key": key}, {"_id": 0})
    return {"ok": True, "lives": int((entry or {}).get("lives") or 0), "extra_life_bought": True, "entry": entry}


def _picks_locked(gw: dict) -> bool:
    st = (gw or {}).get("status")
    if st in ("locked", "settling", "settled"):
        return True
    deadline = parse_dt((gw or {}).get("pick_deadline"))
    return bool(deadline and now_utc() >= deadline)


async def submit_pick(db, user: dict, season_id: str, gw: int, team_id: str) -> dict:
    key = account_key_from_user(user)
    uid = user.get("id") or ""
    if user.get("is_dead"):
        raise HTTPException(status_code=400, detail="Dead characters cannot pick.")
    if not key or not uid:
        raise HTTPException(status_code=400, detail="A verified email is required.")
    await transfer_lms_entry_to_user(db, user, season_id=season_id)
    entry = await db[COL_ENTRIES].find_one({"season_id": season_id, "account_key": key}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=400, detail="Join the season first.")
    if entry.get("status") != "alive":
        raise HTTPException(status_code=400, detail="You are out of this season.")
    gw_doc = await get_gameweek(db, season_id, int(gw))
    if not gw_doc:
        raise HTTPException(status_code=404, detail="Gameweek not found")
    if int(gw) == 1:
        ok, n_fx, _n = gw1_completeness(gw_doc.get("fixtures") or [])
        if not ok:
            raise HTTPException(status_code=400, detail=f"GW1 fixtures are not ready ({n_fx}/10).")
    if _picks_locked(gw_doc):
        raise HTTPException(status_code=400, detail="Picks are locked for this gameweek.")
    if gw_doc.get("status") not in ("picks_open",):
        raise HTTPException(status_code=400, detail="Picks are not open for this gameweek.")
    tid = (team_id or "").strip()
    fx = _team_playing(gw_doc.get("fixtures") or [], tid)
    if not fx:
        raise HTTPException(status_code=400, detail="That team is not playing this gameweek.")
    used = [str(x) for x in (entry.get("teams_used") or [])]
    prev = await db[COL_PICKS].find_one({"season_id": season_id, "gw": int(gw), "account_key": key}, {"_id": 0})
    if tid in used and (not prev or prev.get("team_id") != tid):
        raise HTTPException(status_code=400, detail="You already used that team this season.")
    team_name = fx.get("home") if fx.get("home_team_id") == tid else fx.get("away")
    pick_doc = {
        "id": (prev or {}).get("id") or str(uuid.uuid4()),
        "season_id": season_id,
        "gw": int(gw),
        "account_key": key,
        "user_id": uid,
        "username": user.get("username") or entry.get("username") or "",
        "team_id": tid,
        "team_name": team_name,
        "at": now_iso(),
    }
    await db[COL_PICKS].update_one(
        {"season_id": season_id, "gw": int(gw), "account_key": key},
        {"$set": pick_doc},
        upsert=True,
    )
    new_used = [t for t in used if t != (prev or {}).get("team_id")]
    if tid not in new_used:
        new_used.append(tid)
    await db[COL_ENTRIES].update_one(
        {"season_id": season_id, "account_key": key},
        {"$set": {"teams_used": new_used, "user_id": uid, "username": pick_doc["username"]}},
    )
    pick_doc.pop("_id", None)
    return {"pick": pick_doc}


async def lock_due_gameweeks(db, season_id: str) -> int:
    n = 0
    cursor = db[COL_GAMEWEEKS].find({"season_id": season_id, "status": {"$in": ["picks_open", "upcoming"]}})
    async for gw in cursor:
        if _picks_locked(gw) and gw.get("status") != "locked":
            await db[COL_GAMEWEEKS].update_one(
                {"season_id": season_id, "gw": gw["gw"], "status": {"$in": ["picks_open", "upcoming"]}},
                {"$set": {"status": "locked", "locked_at": now_iso()}},
            )
            n += 1
            if int(gw.get("gw") or 0) == 1:
                await db[COL_SEASONS].update_one(
                    {"id": season_id, "status": "open"},
                    {"$set": {"status": "active"}},
                )
    return n


async def _pay_weekly(db, season: dict, gw: int, entry: dict, streak: int) -> Tuple[int, int, bool]:
    key = entry.get("account_key")
    uid = entry.get("user_id")
    staff_skip = entry_prize_ineligible(entry)
    if not staff_skip and uid:
        live = await db.users.find_one(
            {"id": uid},
            {"_id": 0, "email": 1, "is_moderator": 1, "is_admin": 1, "admin_acting_as_normal": 1, "admin_preview_as_mod": 1},
        )
        staff_skip = is_lms_staff_user(live)
    correct = 0 if staff_skip else int(season.get("weekly_correct_bonus") or LMS_WEEKLY_CORRECT)
    per = 0 if staff_skip else int(season.get("weekly_streak_bonus") or LMS_WEEKLY_STREAK)
    total = correct + per * int(streak)
    audit = {
        "id": str(uuid.uuid4()),
        "season_id": season["id"],
        "gw": int(gw),
        "account_key": key,
        "user_id": uid,
        "username": entry.get("username"),
        "points": total,
        "correct_bonus": correct,
        "streak_bonus": per * int(streak),
        "streak": int(streak),
        "staff_excluded": staff_skip,
        "at": now_iso(),
    }
    try:
        await db[COL_WEEKLY].insert_one(audit)
    except DuplicateKeyError:
        existing = await db[COL_WEEKLY].find_one(
            {"season_id": season["id"], "gw": int(gw), "account_key": key},
            {"_id": 0, "points": 1, "streak": 1},
        )
        return int((existing or {}).get("points") or 0), int((existing or {}).get("streak") or streak), False
    if total <= 0:
        return 0, int(streak), True
    await _credit_points(
        db,
        uid,
        correct,
        "lms_weekly",
        event_ref=f"lms:{season['id']}:gw{gw}:weekly:{key}",
        meta={"season_id": season["id"], "gw": gw, "streak": streak},
    )
    if per * streak:
        await _credit_points(
            db,
            uid,
            per * streak,
            "lms_streak",
            event_ref=f"lms:{season['id']}:gw{gw}:streak:{key}",
            meta={"season_id": season["id"], "gw": gw, "streak": streak},
        )
    try:
        from server import send_notification

        await send_notification(
            uid,
            "LMS week survived",
            f"You survived GW{gw}. +{total:,} pts (correct + streak ×{streak}).",
            "reward",
        )
    except Exception:
        logger.exception("LMS weekly notify failed uid=%s", uid)
    return total, int(streak), True


async def _settle_season_pot(db, season: dict, winner_entries: List[dict], *, reason: str) -> dict:
    sid = season["id"]
    claimed = await db[COL_SEASONS].find_one_and_update(
        {"id": sid, "pot_paid": {"$ne": True}, "status": {"$in": ["open", "active", "settling"]}},
        {"$set": {"status": "settling"}},
    )
    if not claimed:
        return {"already_settled": True}
    winners = list(winner_entries or [])
    winners.sort(key=lambda e: e.get("joined_at") or "")
    pot = int(claimed.get("pot") or season.get("pot") or 0)
    shares = split_pot(pot, len(winners) or 1)
    paid = []
    ids = []
    for i, entry in enumerate(winners):
        amt = shares[i] if i < len(shares) else 0
        key = entry.get("account_key")
        uid = entry.get("user_id")
        try:
            await db[COL_POT].insert_one({
                "id": str(uuid.uuid4()),
                "season_id": sid,
                "account_key": key,
                "user_id": uid,
                "username": entry.get("username"),
                "points": amt,
                "reason": reason,
                "at": now_iso(),
            })
        except DuplicateKeyError:
            continue
        if amt <= 0:
            await db[COL_ENTRIES].update_one(
                {"season_id": sid, "account_key": key},
                {"$set": {"status": "won"}},
            )
            ids.append(uid)
            paid.append({"user_id": uid, "username": entry.get("username"), "points": 0})
            continue
        await _credit_points(
            db,
            uid,
            amt,
            "lms_pot_payout",
            event_ref=f"lms:{sid}:pot:{key}",
            meta={"season_id": sid, "reason": reason, "share": amt},
        )
        await db[COL_ENTRIES].update_one(
            {"season_id": sid, "account_key": key},
            {"$set": {"status": "won"}},
        )
        ids.append(uid)
        paid.append({"user_id": uid, "username": entry.get("username"), "points": amt})
        try:
            from server import send_notification

            await send_notification(
                uid,
                "Last Man Standing winner",
                f"You won the LMS pot: {amt:,} points.",
                "reward",
            )
        except Exception:
            logger.exception("LMS pot notify failed uid=%s", uid)
    await db[COL_SEASONS].update_one(
        {"id": sid},
        {
            "$set": {
                "status": "settled",
                "settled_at": now_iso(),
                "winner_user_ids": ids,
                "pot_paid_reason": reason,
                "pot_paid": True,
            }
        },
    )
    return {"winners": paid, "reason": reason, "pot": pot}


async def settle_gameweek(db, season_id: str, gw: int, *, force: bool = False) -> dict:
    season = await get_season(db, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    if season.get("status") == "settled":
        return {"already_settled": True, "gw": gw}
    gw_doc = await get_gameweek(db, season_id, int(gw))
    if not gw_doc:
        raise HTTPException(status_code=404, detail="Gameweek not found")
    await lock_due_gameweeks(db, season_id)
    gw_doc = await get_gameweek(db, season_id, int(gw))
    if gw_doc.get("status") == "settled":
        return {"already_settled": True, "gw": gw}
    if gw_doc.get("status") not in ("locked", "settling") and not force:
        if not _picks_locked(gw_doc):
            raise HTTPException(status_code=400, detail="Gameweek picks are still open.")
    if not _gw_all_resolved(gw_doc.get("fixtures") or []) and not force:
        raise HTTPException(status_code=400, detail="Not all fixtures have results yet.")

    claimed = await db[COL_GAMEWEEKS].find_one_and_update(
        {"season_id": season_id, "gw": int(gw), "status": {"$ne": "settled"}},
        {"$set": {"status": "settling", "settle_started_at": now_iso()}},
    )
    if not claimed:
        return {"already_settled": True, "gw": gw}

    fx_by_team = {}
    for f in gw_doc.get("fixtures") or []:
        fx_by_team[f.get("home_team_id")] = f
        fx_by_team[f.get("away_team_id")] = f

    snap_keys = list(claimed.get("settle_alive_keys") or [])
    if not snap_keys:
        alive_now = await db[COL_ENTRIES].find(
            {"season_id": season_id, "status": "alive"},
            {"_id": 0, "account_key": 1},
        ).to_list(5000)
        snap_keys = [e.get("account_key") for e in alive_now if e.get("account_key")]
        await db[COL_GAMEWEEKS].update_one(
            {"season_id": season_id, "gw": int(gw), "settle_alive_keys": {"$exists": False}},
            {"$set": {"settle_alive_keys": snap_keys}},
        )
        claimed = await get_gameweek(db, season_id, int(gw)) or claimed
        snap_keys = list(claimed.get("settle_alive_keys") or snap_keys)

    alive_before = await db[COL_ENTRIES].find(
        {"season_id": season_id, "account_key": {"$in": snap_keys or ["__none__"]}},
        {"_id": 0},
    ).to_list(5000)
    survivors = []
    eliminated = []
    weekly_paid = 0
    for entry in alive_before:
        key = entry.get("account_key")
        pick = await db[COL_PICKS].find_one(
            {"season_id": season_id, "gw": int(gw), "account_key": key},
            {"_id": 0},
        )
        outcome = "lose"
        if pick:
            fx = fx_by_team.get(pick.get("team_id"))
            if fx:
                outcome = _pick_won(fx, pick.get("team_id")) or "lose"
            else:
                outcome = "lose"
        if pick:
            await db[COL_PICKS].update_one(
                {"season_id": season_id, "gw": int(gw), "account_key": key},
                {"$set": {"outcome": outcome, "correct": outcome == "win"}},
            )
        if pick and pick.get("life_consumed"):
            if entry.get("status") == "out" and int(entry.get("eliminated_gw") or 0) == int(gw):
                eliminated.append(entry)
            else:
                survivors.append(entry)
            continue
        if outcome == "postponed":
            survivors.append(entry)
            continue
        if outcome == "win":
            streak = int(entry.get("correct_streak") or 0) + 1
            points, streak, first = await _pay_weekly(db, season, int(gw), entry, streak)
            await db[COL_ENTRIES].update_one(
                {"season_id": season_id, "account_key": key},
                {"$set": {"status": "alive", "eliminated_gw": None, "correct_streak": streak}},
            )
            entry["correct_streak"] = streak
            if first:
                weekly_paid += points
            survivors.append(entry)
        else:
            current_lives = entry_lives(entry, season)
            left, still_alive = lives_after_wrong_pick(current_lives)
            pick_set = {"outcome": outcome, "correct": False, "life_consumed": True, "survived_with_life": still_alive}
            if pick:
                await db[COL_PICKS].update_one(
                    {"season_id": season_id, "gw": int(gw), "account_key": key},
                    {"$set": pick_set},
                )
            if still_alive:
                await db[COL_ENTRIES].update_one(
                    {"season_id": season_id, "account_key": key},
                    {"$set": {"status": "alive", "eliminated_gw": None, "correct_streak": 0, "lives": left}},
                )
                entry["lives"] = left
                entry["correct_streak"] = 0
                survivors.append(entry)
                try:
                    from server import send_notification

                    await send_notification(
                        entry.get("user_id"),
                        "LMS life used",
                        f"Wrong pick in GW{gw}. You have {left} life left." if left == 1 else f"Wrong pick in GW{gw}. You have {left} lives left.",
                        "system",
                    )
                except Exception:
                    pass
            else:
                await db[COL_ENTRIES].update_one(
                    {"season_id": season_id, "account_key": key},
                    {"$set": {"status": "out", "eliminated_gw": int(gw), "correct_streak": 0, "lives": 0}},
                )
                eliminated.append(entry)
                try:
                    from server import send_notification

                    await send_notification(
                        entry.get("user_id"),
                        "Eliminated from LMS",
                        f"You went out in GW{gw}.",
                        "system",
                    )
                except Exception:
                    pass

    pot_result = None
    eligible_survivors = await filter_prize_eligible(db, survivors)
    eligible_before = await filter_prize_eligible(db, alive_before)
    if len(eligible_survivors) <= 1:
        winners = eligible_survivors if eligible_survivors else eligible_before
        reason = "last_standing" if eligible_survivors else "wipe_split"
        pot_result = await _settle_season_pot(db, season, winners, reason=reason)
    elif int(gw) >= LMS_MAX_GW:
        pot_result = await _settle_season_pot(db, season, eligible_survivors, reason="season_end_split")

    await db[COL_GAMEWEEKS].update_one(
        {"season_id": season_id, "gw": int(gw)},
        {
            "$set": {
                "status": "settled",
                "settled_at": now_iso(),
                "alive_after": len(survivors),
                "eliminated": len(eliminated),
            }
        },
    )
    await db[COL_SEASONS].update_one(
        {"id": season_id},
        {"$set": {"current_gameweek": int(gw) + 1}},
    )

    return {
        "gw": int(gw),
        "alive_before": len(alive_before),
        "alive_after": len(survivors),
        "eliminated": len(eliminated),
        "weekly_points_paid": weekly_paid,
        "pot": pot_result,
    }


def _fd_match_for_fixture(fixture: dict, fd_matches: List[dict]) -> Optional[dict]:
    """Match a stored LMS fixture to a football-data match by id, then by team names.

    Official GW fallbacks use synthetic ids (pl-2026-gw1-...), so id-only matching never
    writes scores and locked weeks stay unresolved forever.
    """
    if not fixture:
        return None
    eid = str(fixture.get("external_event_id") or fixture.get("fd_match_id") or "")
    if eid:
        for m in fd_matches or []:
            if str(m.get("id") or "") == eid:
                return m
    home = fixture.get("home") or ""
    away = fixture.get("away") or ""
    for m in fd_matches or []:
        ht = m.get("homeTeam") or {}
        at = m.get("awayTeam") or {}
        home_ok = any(teams_same(home, ht.get(k) or "") for k in ("name", "shortName", "tla"))
        away_ok = any(teams_same(away, at.get(k) or "") for k in ("name", "shortName", "tla"))
        if home_ok and away_ok:
            return m
    return None


def _odds_event_for_fixture(fixture: dict, odds_events: List[dict]) -> Optional[dict]:
    if not fixture:
        return None
    eid = str(fixture.get("external_event_id") or "")
    for ev in odds_events or []:
        if eid and str(ev.get("id") or "") == eid:
            return ev
    home = fixture.get("home") or ""
    away = fixture.get("away") or ""
    for ev in odds_events or []:
        if teams_same(home, ev.get("home_team") or "") and teams_same(away, ev.get("away_team") or ""):
            return ev
    return None


async def refresh_results_into_gameweek(db, season_id: str, gw: int) -> dict:
    gw_doc = await get_gameweek(db, season_id, int(gw))
    if not gw_doc:
        return {"updated": 0}
    fixtures = list(gw_doc.get("fixtures") or [])
    fd_matches = await _fetch_football_data_pl_matches()
    updated = 0
    new_fx = []
    for f in fixtures:
        m = _fd_match_for_fixture(f, fd_matches)
        if m:
            score = (m.get("score") or {}).get("fullTime") or {}
            nxt = _apply_fd_status(f, m.get("status") or "", score.get("home"), score.get("away"))
            if m.get("id") is not None:
                nxt["fd_match_id"] = str(m.get("id"))
            if nxt.get("result") != f.get("result") or nxt.get("home_score") != f.get("home_score") or nxt.get("away_score") != f.get("away_score"):
                updated += 1
            new_fx.append(nxt)
        else:
            new_fx.append(f)
    fixtures = new_fx
    odds_events = await _fetch_odds_epl_events()
    if odds_events:
        merged = []
        for f in fixtures:
            nxt = dict(f)
            if nxt.get("result") in ("home", "away", "draw", "postponed"):
                merged.append(nxt)
                continue
            ev = _odds_event_for_fixture(nxt, odds_events)
            scores = ev.get("scores") if ev else None
            if ev and scores:
                home = (ev.get("home_team") or nxt.get("home") or "").strip()
                away = (ev.get("away_team") or nxt.get("away") or "").strip()
                try:
                    by_name = {(s.get("name") or "").strip(): int(s.get("score")) for s in (scores or [])}
                    hs = by_name.get(home)
                    aws = by_name.get(away)
                    if hs is None or aws is None:
                        for nm, sc in by_name.items():
                            if teams_same(home, nm):
                                hs = sc
                            elif teams_same(away, nm):
                                aws = sc
                    if hs is not None and aws is not None:
                        nxt["home_score"] = hs
                        nxt["away_score"] = aws
                        nxt["result"] = _fixture_result_from_scores(hs, aws)
                        updated += 1
                except Exception:
                    pass
            merged.append(nxt)
        fixtures = merged
        new_fx = merged
    tsdb = await _fetch_thesportsdb_pl_results(int(gw))
    if tsdb:
        merged = []
        for f in fixtures:
            nxt = dict(f)
            if nxt.get("result") in ("home", "away", "draw", "postponed"):
                merged.append(nxt)
                continue
            hit = None
            for ev in tsdb:
                if teams_same(nxt.get("home") or "", ev.get("home") or "") and teams_same(nxt.get("away") or "", ev.get("away") or ""):
                    hit = ev
                    break
            if hit:
                if hit.get("result") == "postponed":
                    nxt["result"] = "postponed"
                else:
                    nxt["home_score"] = hit.get("home_score")
                    nxt["away_score"] = hit.get("away_score")
                    nxt["result"] = hit.get("result")
                updated += 1
            merged.append(nxt)
        fixtures = merged
        new_fx = merged
    if updated:
        await db[COL_GAMEWEEKS].update_one(
            {"season_id": season_id, "gw": int(gw)},
            {"$set": {"fixtures": new_fx, "results_synced_at": now_iso()}},
        )
    return {"updated": updated}


async def cron_tick(db) -> dict:
    seasons = await db[COL_SEASONS].find(
        {"status": {"$in": ["open", "active", "settling"]}},
        {"_id": 0, "id": 1, "status": 1, "pot_paid": 1},
    ).to_list(20)
    out = []
    for s in seasons:
        sid = s["id"]
        try:
            await sync_season_fixtures(db, sid)
        except Exception:
            logger.exception("LMS cron sync failed season=%s", sid)
        locked = await lock_due_gameweeks(db, sid)
        gws = await db[COL_GAMEWEEKS].find(
            {"season_id": sid, "status": {"$in": ["locked", "picks_open", "settling"]}},
            {"_id": 0, "gw": 1, "status": 1},
        ).to_list(40)
        settled = []
        for g in gws:
            try:
                await refresh_results_into_gameweek(db, sid, int(g["gw"]))
                fresh = await get_gameweek(db, sid, int(g["gw"]))
                if fresh and _picks_locked(fresh) and (
                    fresh.get("status") == "settling" or _gw_all_resolved(fresh.get("fixtures") or [])
                ):
                    settled.append(await settle_gameweek(db, sid, int(g["gw"])))
            except HTTPException:
                continue
            except Exception:
                logger.exception("LMS cron settle failed season=%s gw=%s", sid, g.get("gw"))
        if s.get("status") == "settling" and s.get("pot_paid") is not True:
            try:
                season = await get_season(db, sid)
                winners = await db[COL_ENTRIES].find(
                    {"season_id": sid, "status": {"$in": ["alive", "won"]}},
                    {"_id": 0},
                ).to_list(500)
                if not winners:
                    winners = await db[COL_ENTRIES].find({"season_id": sid}, {"_id": 0}).to_list(500)
                winners = await filter_prize_eligible(db, winners)
                await _settle_season_pot(db, season or s, winners, reason="cron_resume")
            except Exception:
                logger.exception("LMS cron pot resume failed season=%s", sid)
        out.append({"season_id": sid, "locked": locked, "settled": settled})
    return {"seasons": out}


async def cancel_season(db, season_id: str) -> dict:
    season = await get_season(db, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    gw1 = await get_gameweek(db, season_id, 1)
    if gw1 and gw1.get("status") in ("locked", "settling", "settled"):
        raise HTTPException(status_code=400, detail="Cannot refund after GW1 has locked.")
    claimed = await db[COL_SEASONS].find_one_and_update(
        {"id": season_id, "status": {"$in": ["open", "active"]}},
        {"$set": {"status": "cancelled", "cancelled_at": now_iso()}},
    )
    if not claimed:
        raise HTTPException(status_code=400, detail="Season cannot be cancelled.")
    entries = await db[COL_ENTRIES].find({"season_id": season_id}, {"_id": 0}).to_list(5000)
    refunded = 0
    for e in entries:
        fee = int(e.get("entry_fee_paid") or 0)
        if fee > 0:
            await _refund_points(
                db,
                e.get("user_id"),
                fee,
                event_ref=f"lms:{season_id}:cancel:{e.get('account_key')}",
                meta={"season_id": season_id},
            )
            refunded += 1
    return {"cancelled": True, "refunded_entries": refunded}


def season_public_payload(season: dict, *, alive: int = 0, out_n: int = 0) -> dict:
    d = _public_season(season)
    d["alive_count"] = alive
    d["out_count"] = out_n
    d["entered"] = int(season.get("entry_count") or 0)
    d["starting_lives"] = int(season.get("starting_lives") or LMS_START_LIVES)
    d["extra_life_cost"] = int(season.get("extra_life_cost") or LMS_EXTRA_LIFE_COST)
    return d
