# Sports betting: events, place/cancel bets, stats, recent results; admin templates, add/settle/cancel events
from datetime import datetime, timezone, timedelta
import asyncio
import logging
import time
import secrets
_rng = secrets.SystemRandom()
import os
import re
import uuid
from pathlib import Path
from typing import List, Optional

# Ensure backend/.env is loaded before reading THE_ODDS_API_KEY (matches server.py paths)
try:
    from dotenv import load_dotenv
    _backend_dir = Path(__file__).resolve().parents[2]
    load_dotenv(_backend_dir / ".env")
    load_dotenv(_backend_dir.parent / ".env")
except Exception:
    pass

from pydantic import BaseModel
from fastapi import Depends, Header, HTTPException
import httpx

from server import db, get_current_user, get_current_user_verified, log_gambling, _is_admin

logger = logging.getLogger(__name__)

# ----- Models -----
class SportsBetPlaceRequest(BaseModel):
    event_id: str
    option_id: str
    stake: int


class SportsBetCancelRequest(BaseModel):
    bet_id: str


class SportsSettleEventRequest(BaseModel):
    event_id: str
    winning_option_id: str


class AdminAddSportsEventRequest(BaseModel):
    template_id: str


class AdminCancelEventRequest(BaseModel):
    event_id: str


class AdminCustomEventOption(BaseModel):
    name: str
    odds: Optional[float] = 2.0


class AdminAddCustomSportsEventRequest(BaseModel):
    name: str
    category: str
    options: List[AdminCustomEventOption]


# ----- Constants -----
# Max total stake locked in open sports bets per user (split across any number of bets).
SPORTS_BET_MAX_TOTAL_OPEN_STAKE = 10_000_000
# Placing bets and cancelling open bets both end this many minutes before scheduled start.
SPORTS_BETTING_CLOSE_BEFORE_START_MINUTES = 10
SPORTS_LIVE_CACHE_TTL = 30 * 60  # 30 min (was 6h) so "Check for events" gets fresher templates
ODDS_API_BASE = "https://api.the-odds-api.com/v4"
THESPORTSDB_LEAGUE_PREMIER = 4328
THESPORTSDB_LEAGUE_LALIGA = 4335
THESPORTSDB_LEAGUE_UFC = 4443
THESPORTSDB_LEAGUE_BOXING = 4445

_sports_live_cache = {"football": [], "ufc": [], "boxing": [], "f1": [], "updated_at": 0.0}


def _sports_odds_cache_ttl_sec() -> int:
    try:
        return max(120, int(os.environ.get("SPORTS_ODDS_CACHE_TTL_SEC", "1800")))
    except ValueError:
        return 1800


def _sports_odds_scores_cache_ttl_sec() -> int:
    try:
        return max(60, int(os.environ.get("SPORTS_ODDS_SCORES_CACHE_TTL_SEC", "900")))
    except ValueError:
        return 900


def _sports_odds_fetch_concurrency() -> int:
    try:
        return max(1, min(12, int(os.environ.get("SPORTS_ODDS_FETCH_CONCURRENCY", "4"))))
    except ValueError:
        return 4


async def _odds_cache_read_list_if_fresh(cache_key: str, ttl_sec: int) -> list | None:
    try:
        doc = await db.sports_odds_api_cache.find_one({"cache_key": cache_key}, {"_id": 0, "fetched_at": 1, "http_status": 1, "payload": 1})
        if not doc or doc.get("http_status") != 200:
            return None
        fetched = doc.get("fetched_at")
        if fetched is None:
            return None
        if isinstance(fetched, str):
            try:
                fetched = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
            except Exception:
                return None
        if getattr(fetched, "tzinfo", None) is None:
            fetched = fetched.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - fetched > timedelta(seconds=ttl_sec):
            return None
        pl = doc.get("payload")
        return pl if isinstance(pl, list) else None
    except Exception:
        return None


async def _odds_cache_write_list(cache_key: str, status_code: int, payload: list) -> None:
    try:
        await db.sports_odds_api_cache.update_one(
            {"cache_key": cache_key},
            {
                "$set": {
                    "cache_key": cache_key,
                    "fetched_at": datetime.now(timezone.utc),
                    "http_status": int(status_code),
                    "payload": payload if isinstance(payload, list) else [],
                }
            },
            upsert=True,
        )
    except Exception as ex:
        logger.warning("sports_odds_api_cache write failed (%s): %s", cache_key, ex)


def _odds_api_key():
    k = (os.environ.get("THE_ODDS_API_KEY") or "").strip()
    if len(k) >= 2 and k[0] == k[-1] and k[0] in "\"'":
        k = k[1:-1].strip()
    return k


def _parse_commence_time(commence_time) -> str | None:
    """Normalize Odds API commence_time to UTC ISO Z. Handles ISO strings, Unix sec, and Unix ms."""
    if commence_time is None:
        return None
    if isinstance(commence_time, (int, float)):
        try:
            ts = float(commence_time)
            if ts > 1e12:
                ts /= 1000.0
            dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
            return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        except (ValueError, OSError):
            return None
    s = (commence_time or "").strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except Exception:
        pass
    try:
        ts = float(s)
        if ts > 1e12:
            ts /= 1000.0
        dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except (ValueError, OSError, OverflowError):
        return None


def _is_draw_outcome_name(n: str) -> bool:
    x = (n or "").strip().lower()
    if not x:
        return False
    if x in ("draw", "tie", "x", "empate", "remis", "nul", "void"):
        return True
    return "draw" in x or "tie" in x or "empate" in x or "remis" in x


def _team_matches_option(team: str, opt_name: str) -> bool:
    """Loose match for Odds API outcome names vs home_team / away_team (abbreviations, suffixes)."""
    t = (team or "").strip().lower()
    o = (opt_name or "").strip().lower()
    if not t or not o:
        return False
    if t == o:
        return True
    if len(t) >= 4 and (t in o or o in t):
        return True
    for suf in (" fc", " sc", " afc", " cf", " united", " city"):
        tb = t.replace(suf, "").strip()
        ob = o.replace(suf, "").strip()
        if len(tb) >= 4 and (tb in ob or ob in tb or tb == ob):
            return True
    return False


def _extract_outcomes_from_bookmakers(bookmakers: list, three_way: bool) -> list:
    if not bookmakers:
        return []

    def _outcomes_for_keys(keys: tuple) -> list:
        keys_l = frozenset(str(k).lower() for k in keys)
        for b in bookmakers:
            for m in (b.get("markets") or []):
                if (m.get("key") or "").lower() in keys_l:
                    out = m.get("outcomes") or []
                    if isinstance(out, list) and out:
                        return out
        return []

    if three_way:
        out = _outcomes_for_keys(("h2h_3_way",))
        if out:
            return out
        h2h_two: list = []
        for b in bookmakers:
            for m in (b.get("markets") or []):
                if (m.get("key") or "").lower() != "h2h":
                    continue
                raw = m.get("outcomes") or []
                if not isinstance(raw, list) or not raw:
                    continue
                if len(raw) >= 3:
                    return raw
                if len(raw) == 2 and not h2h_two:
                    h2h_two = raw
        if h2h_two:
            return h2h_two
        out = _outcomes_for_keys(("draw_no_bet", "dnb"))
        if out and len(out) >= 2:
            return out
        return []

    out = _outcomes_for_keys(("h2h",))
    if out:
        return out
    return _outcomes_for_keys(("draw_no_bet", "dnb"))


def _odds_template_id(sport_key: str, event_id: str) -> str:
    sk = re.sub(r"[^a-zA-Z0-9_-]+", "_", (sport_key or "x").strip())[:40]
    eid = re.sub(r"[^a-zA-Z0-9_-]+", "_", (event_id or "").strip())[:80]
    if not eid:
        eid = "unknown"
    return "odds_%s__%s" % (sk, eid)


def _parse_odds_event(event: dict, category: str, three_way: bool, sport_key: str = "") -> dict | None:
    event_id = (event.get("id") or "").strip()
    home = (event.get("home_team") or "").strip()
    away = (event.get("away_team") or "").strip()
    if not home or not away or not event_id:
        return None
    bookmakers = event.get("bookmakers") or []
    outcomes = _extract_outcomes_from_bookmakers(bookmakers, three_way)
    if not outcomes:
        return None
    options = []
    for o in outcomes:
        name = (o.get("name") or "").strip()
        if not name:
            continue
        try:
            price = float(o.get("price") or 2.0)
        except (TypeError, ValueError):
            price = 2.0
        opt_id = name.lower().replace(" ", "_").replace(".", "")[:24]
        options.append({"id": opt_id, "name": name, "odds": round(price, 2)})
    if three_way:
        if len(options) == 3:
            used = set()
            ordered = []
            for candidate in [home, "Draw", away]:
                for i, o in enumerate(options):
                    if i in used:
                        continue
                    n = (o.get("name") or "").strip()
                    if candidate == "Draw" and _is_draw_outcome_name(n):
                        ordered.append(o)
                        used.add(i)
                        break
                    if candidate != "Draw" and (n == candidate or _team_matches_option(candidate, n)):
                        ordered.append(o)
                        used.add(i)
                        break
            if len(ordered) == 3:
                options = ordered
            else:
                draw_opts = [o for o in options if _is_draw_outcome_name((o.get("name") or ""))]
                rest = [o for o in options if o not in draw_opts]
                if len(draw_opts) == 1 and len(rest) == 2:
                    draw_o = draw_opts[0]
                    r0, r1 = rest[0], rest[1]
                    n0, n1 = (r0.get("name") or ""), (r1.get("name") or "")
                    if _team_matches_option(home, n0) and not _team_matches_option(away, n0):
                        h_o, a_o = r0, r1
                    elif _team_matches_option(home, n1) and not _team_matches_option(away, n1):
                        h_o, a_o = r1, r0
                    elif _team_matches_option(home, n0):
                        h_o, a_o = r0, r1
                    elif _team_matches_option(home, n1):
                        h_o, a_o = r1, r0
                    else:
                        h_o, a_o = r0, r1
                    options = [h_o, draw_o, a_o]
                # else keep API order (books often list home, draw, away)
        elif len(options) == 2:
            ordered = []
            for candidate in [home, away]:
                for o in options:
                    n = (o.get("name") or "").strip()
                    if n == candidate or _team_matches_option(candidate, n):
                        ordered.append(o)
                        break
            if len(ordered) == 2:
                options = ordered
            else:
                options = options[:2]
        else:
            return None
    else:
        if len(options) != 2:
            return None
    name = "%s vs %s" % (home, away)
    ct_raw = event.get("commence_time")
    if ct_raw is not None:
        out = {"id": "", "name": name, "category": category, "options": options, "commence_time": ct_raw}
    else:
        out = {"id": "", "name": name, "category": category, "options": options}
    start_time = _parse_commence_time(ct_raw)
    if start_time:
        out["start_time"] = start_time
    tid = _odds_template_id(sport_key, event_id) if sport_key else "odds_%s_%s" % (category.lower()[:3], re.sub(r"[^a-zA-Z0-9_-]+", "_", event_id)[:48])
    out["id"] = tid
    if sport_key:
        out["external_event_id"] = event_id
        out["external_sport_key"] = sport_key
    return out


# Keys from https://the-odds-api.com/sports-odds-data/sports-apis.html (invalid keys → empty odds for that league).
SOCCER_LEAGUES = (
    "soccer_epl",
    "soccer_fa_cup",
    "soccer_england_efl_cup",
    "soccer_efl_champ",
    "soccer_england_league1",
    "soccer_england_league2",
    "soccer_spain_la_liga",
    "soccer_spain_segunda_division",
    "soccer_germany_bundesliga",
    "soccer_germany_bundesliga2",
    "soccer_italy_serie_a",
    "soccer_italy_serie_b",
    "soccer_france_ligue_one",
    "soccer_uefa_champs_league",
    "soccer_uefa_champs_league_qualification",
    "soccer_uefa_champs_league_women",
    "soccer_uefa_europa_league",
    "soccer_uefa_europa_conference_league",
    "soccer_uefa_nations_league",
    # International / FIFA / confederations (national teams & major tournaments; keys from the-odds-api.com sports list)
    "soccer_fifa_world_cup",
    "soccer_fifa_world_cup_qualifiers_europe",
    "soccer_fifa_world_cup_qualifiers_south_america",
    "soccer_fifa_world_cup_womens",
    "soccer_fifa_club_world_cup",
    "soccer_uefa_european_championship",
    "soccer_uefa_euro_qualification",
    "soccer_africa_cup_of_nations",
    "soccer_conmebol_copa_america",
    "soccer_concacaf_gold_cup",
    "soccer_netherlands_eredivisie",
    "soccer_portugal_primeira_liga",
    "soccer_spl",
    "soccer_belgium_first_div",
    "soccer_turkey_super_league",
    "soccer_usa_mls",
    "soccer_mexico_ligamx",
    "soccer_brazil_campeonato",
    "soccer_australia_aleague",
)

# Bookmaker regions (Odds API): try narrow sets first, then add fr/se/au so one bad region does not block the rest.
SOCCER_ODDS_REGION_ATTEMPTS = (
    "uk,us,eu",
    "uk,us,eu,fr,se",
    "uk,us,eu,fr,se,au",
)


def _soccer_league_display_name(sport_key: str) -> str:
    if not sport_key:
        return ""
    labels = {
        "soccer_epl": "Premier League",
        "soccer_fa_cup": "FA Cup",
        "soccer_england_efl_cup": "EFL Cup (Carabao)",
        "soccer_efl_champ": "Championship",
        "soccer_england_league1": "League One",
        "soccer_england_league2": "League Two",
        "soccer_spain_la_liga": "La Liga",
        "soccer_spain_segunda_division": "La Liga 2",
        "soccer_germany_bundesliga": "Bundesliga",
        "soccer_germany_bundesliga2": "Bundesliga 2",
        "soccer_italy_serie_a": "Serie A",
        "soccer_italy_serie_b": "Serie B",
        "soccer_france_ligue_one": "Ligue 1",
        "soccer_uefa_champs_league": "Champions League",
        "soccer_uefa_champs_league_qualification": "Champions League (qualifying)",
        "soccer_uefa_champs_league_women": "Women's Champions League",
        "soccer_uefa_europa_league": "Europa League",
        "soccer_uefa_europa_conference_league": "Conference League",
        "soccer_uefa_nations_league": "UEFA Nations League",
        "soccer_fifa_world_cup": "FIFA World Cup",
        "soccer_fifa_world_cup_qualifiers_europe": "World Cup qualifiers (Europe)",
        "soccer_fifa_world_cup_qualifiers_south_america": "World Cup qualifiers (South America)",
        "soccer_fifa_world_cup_womens": "Women's World Cup",
        "soccer_fifa_club_world_cup": "FIFA Club World Cup",
        "soccer_uefa_european_championship": "UEFA European Championship (Euro)",
        "soccer_uefa_euro_qualification": "UEFA Euro qualification",
        "soccer_africa_cup_of_nations": "Africa Cup of Nations",
        "soccer_conmebol_copa_america": "Copa América",
        "soccer_concacaf_gold_cup": "CONCACAF Gold Cup",
        "soccer_netherlands_eredivisie": "Eredivisie",
        "soccer_portugal_primeira_liga": "Primeira Liga",
        "soccer_spl": "Scottish Premiership",
        "soccer_belgium_first_div": "Belgium First Division",
        "soccer_turkey_super_league": "Turkey Super League",
        "soccer_usa_mls": "MLS",
        "soccer_mexico_ligamx": "Liga MX",
        "soccer_brazil_campeonato": "Brazil Série A",
        "soccer_australia_aleague": "A-League",
    }
    if sport_key in labels:
        return labels[sport_key]
    return sport_key.replace("soccer_", "").replace("_", " ").title()


def _is_future_event(ev: dict, require_time: bool = False, buffer_minutes: int = 10) -> bool:
    """True if event has not started yet (or starts after buffer). If require_time, skip events without commence_time."""
    ct = ev.get("commence_time")
    if not ct:
        return not require_time
    try:
        if isinstance(ct, (int, float)):
            dt = datetime.fromtimestamp(int(ct), tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(ct).replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if dt < now - timedelta(hours=24):
            return False
        return now < dt - timedelta(minutes=max(0, int(buffer_minutes)))
    except Exception:
        return not require_time


async def _fetch_odds_api_soccer_league_raw(client: httpx.AsyncClient, sport_key: str, sem: asyncio.Semaphore, api_key: str) -> list:
    cache_key = "v4:odds:%s" % sport_key
    ttl = _sports_odds_cache_ttl_sec()
    cached = await _odds_cache_read_list_if_fresh(cache_key, ttl)
    if cached is not None:
        return cached
    async with sem:
        r = None
        # Bulk /sports/{key}/odds only accepts featured markets. draw_no_bet and other
        # "additional" markets cause INVALID_MARKET and fail the whole request — avoid them here.
        for regions in SOCCER_ODDS_REGION_ATTEMPTS:
            for markets in ("h2h,h2h_3_way", "h2h"):
                try:
                    r = await client.get(
                        "%s/sports/%s/odds" % (ODDS_API_BASE, sport_key),
                        params={
                            "apiKey": api_key,
                            "regions": regions,
                            "markets": markets,
                            "oddsFormat": "decimal",
                        },
                    )
                except Exception as ex:
                    logger.warning("Odds API odds fetch failed %s: %s", sport_key, ex)
                    return []
                if r.status_code == 200:
                    break
            if r is not None and r.status_code == 200:
                break
        if r is None or r.status_code != 200:
            logger.warning(
                "Odds API odds %s failed (last HTTP %s); tried regions: %s",
                sport_key,
                getattr(r, "status_code", 0) if r is not None else 0,
                ", ".join(SOCCER_ODDS_REGION_ATTEMPTS),
            )
            return []
    events = r.json()
    if not isinstance(events, list):
        events = []
    await _odds_cache_write_list(cache_key, 200, events)
    return events


async def _fetch_odds_api_soccer() -> list:
    key = _odds_api_key()
    if not key:
        return []
    out = []
    seen_event = set()
    sem = asyncio.Semaphore(_sports_odds_fetch_concurrency())
    try:
        async with httpx.AsyncClient(timeout=22.0) as client:
            raw_lists = await asyncio.gather(*[_fetch_odds_api_soccer_league_raw(client, sk, sem, key) for sk in SOCCER_LEAGUES])
        for sport_key, events in zip(SOCCER_LEAGUES, raw_lists):
            if not isinstance(events, list):
                continue
            # Cap per league to control payload; parse fix above allows most fixtures through
            for ev in events[:100]:
                eid = (ev.get("id") or "").strip()
                if not eid:
                    continue
                dedupe = (sport_key, eid)
                if dedupe in seen_event:
                    continue
                if not _is_future_event(ev, buffer_minutes=1):
                    continue
                parsed = _parse_odds_event(ev, "Football", three_way=True, sport_key=sport_key)
                if parsed:
                    seen_event.add(dedupe)
                    out.append(parsed)
    except Exception as ex:
        logger.warning("Odds API soccer aggregate failed: %s", ex)
    return out


async def _fetch_odds_api_mma() -> list:
    key = _odds_api_key()
    if not key:
        return []
    cache_key = "v1:odds:mma_mixed_martial_arts"
    ttl = _sports_odds_cache_ttl_sec()
    out = []
    try:
        events = await _odds_cache_read_list_if_fresh(cache_key, ttl)
        if events is None:
            async with httpx.AsyncClient(timeout=14.0) as client:
                r = await client.get(
                    "%s/sports/mma_mixed_martial_arts/odds" % ODDS_API_BASE,
                    params={"apiKey": key, "regions": "uk,us", "markets": "h2h", "oddsFormat": "decimal"},
                )
            if r.status_code != 200:
                logger.warning("Odds API odds mma HTTP %s", r.status_code)
                return []
            events = r.json()
            if not isinstance(events, list):
                events = []
            await _odds_cache_write_list(cache_key, 200, events)
        for ev in events[:35]:
            if not _is_future_event(ev, require_time=True):
                continue
            parsed = _parse_odds_event(ev, "UFC", three_way=False, sport_key="mma_mixed_martial_arts")
            if parsed:
                out.append(parsed)
    except Exception as ex:
        logger.warning("Odds API mma: %s", ex)
    return out


async def _fetch_odds_api_boxing() -> list:
    key = _odds_api_key()
    if not key:
        return []
    cache_key = "v1:odds:boxing_boxing"
    ttl = _sports_odds_cache_ttl_sec()
    out = []
    try:
        events = await _odds_cache_read_list_if_fresh(cache_key, ttl)
        if events is None:
            async with httpx.AsyncClient(timeout=14.0) as client:
                r = await client.get(
                    "%s/sports/boxing_boxing/odds" % ODDS_API_BASE,
                    params={"apiKey": key, "regions": "uk,us", "markets": "h2h", "oddsFormat": "decimal"},
                )
            if r.status_code != 200:
                logger.warning("Odds API odds boxing HTTP %s", r.status_code)
                return []
            events = r.json()
            if not isinstance(events, list):
                events = []
            await _odds_cache_write_list(cache_key, 200, events)
        for ev in events[:25]:
            if not _is_future_event(ev, require_time=True):
                continue
            parsed = _parse_odds_event(ev, "Boxing", three_way=False, sport_key="boxing_boxing")
            if parsed:
                out.append(parsed)
    except Exception as ex:
        logger.warning("Odds API boxing: %s", ex)
    return out


# ----- Odds API Scores (for auto-settle) -----
ODDS_API_SPORT_KEYS = {
    "Football": list(SOCCER_LEAGUES),
    "UFC": ["mma_mixed_martial_arts"],
    "Boxing": ["boxing_boxing"],
}


async def _fetch_odds_api_scores(sport_key: str, days_from: int = 1) -> list:
    """Fetch completed events with scores from The Odds API. days_from 1-3 returns completed games."""
    key = _odds_api_key()
    if not key:
        return []
    d = min(3, max(1, int(days_from)))
    cache_key = "v1:scores:%s:d%s" % (sport_key, d)
    ttl = _sports_odds_scores_cache_ttl_sec()
    try:
        cached = await _odds_cache_read_list_if_fresh(cache_key, ttl)
        if cached is not None:
            return cached
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                "%s/sports/%s/scores" % (ODDS_API_BASE, sport_key),
                params={"apiKey": key, "daysFrom": d},
            )
        if r.status_code != 200:
            logger.warning("Odds API scores %s HTTP %s", sport_key, r.status_code)
            return []
        events = r.json()
        events = events if isinstance(events, list) else []
        await _odds_cache_write_list(cache_key, 200, events)
        return events
    except Exception as ex:
        logger.warning("Odds API scores %s: %s", sport_key, ex)
        return []


def _derive_winning_option_from_scores(api_event: dict, options: list, three_way: bool) -> str | None:
    """Derive winning_option_id from Odds API scores. Returns option id or None if unclear."""
    scores = api_event.get("scores") or []
    home_team = (api_event.get("home_team") or "").strip()
    away_team = (api_event.get("away_team") or "").strip()
    option_by_name = {(o.get("name") or "").strip().lower(): o.get("id") for o in (options or []) if o.get("id")}
    if len(scores) == 1:
        winner_name = (scores[0].get("name") or "").strip()
        for name, opt_id in option_by_name.items():
            if name and winner_name and name.lower() == winner_name.lower():
                return opt_id
        return None
    if len(scores) != 2:
        return None
    s0_name = (scores[0].get("name") or "").strip()
    s1_name = (scores[1].get("name") or "").strip()
    try:
        s0_val = int(scores[0].get("score") or 0)
        s1_val = int(scores[1].get("score") or 0)
    except (TypeError, ValueError):
        return None
    if s0_val > s1_val:
        winner_name = s0_name
    elif s1_val > s0_val:
        winner_name = s1_name
    else:
        if three_way:
            for o in options or []:
                if _is_draw_outcome_name((o.get("name") or "")):
                    return o.get("id")
        return None
    for name, opt_id in option_by_name.items():
        if name and winner_name and name.lower() == winner_name.lower():
            return opt_id
    return None


async def _auto_settle_from_scores() -> dict:
    """Poll Odds API scores, match to open events with external_event_id, settle and pay. Returns stats."""
    settled_count = 0
    skipped_no_match = 0
    skipped_no_winner = 0
    key = _odds_api_key()
    if not key:
        return {"settled": 0, "message": "No Odds API key"}
    sport_keys_used = set()
    for category, keys in ODDS_API_SPORT_KEYS.items():
        three_way = category == "Football"
        for sport_key in keys:
            if sport_key in sport_keys_used:
                continue
            sport_keys_used.add(sport_key)
            events = await _fetch_odds_api_scores(sport_key, days_from=1)
            for api_ev in events:
                if not api_ev.get("completed"):
                    continue
                ext_id = (api_ev.get("id") or "").strip()
                if not ext_id:
                    continue
                ev = await db.sports_events.find_one(
                    {"external_event_id": ext_id, "external_sport_key": sport_key, "status": "open"},
                    {"_id": 0, "id": 1, "options": 1},
                )
                if not ev:
                    skipped_no_match += 1
                    continue
                winning_id = _derive_winning_option_from_scores(api_ev, ev.get("options") or [], three_way)
                if not winning_id:
                    skipped_no_winner += 1
                    continue
                if await _settle_event_internal(ev["id"], winning_id):
                    settled_count += 1
    return {"settled": settled_count, "skipped_no_match": skipped_no_match, "skipped_no_winner": skipped_no_winner}


async def _fetch_football_events_football_data_org() -> list:
    token = os.environ.get("FOOTBALL_DATA_ORG_TOKEN", "").strip()
    if not token:
        return []
    out = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            for code in ("PL", "PD", "BL1", "SA", "FL1", "CL", "EL", "DED", "PPL"):
                r = await client.get(
                    "https://api.football-data.org/v4/competitions/%s/matches" % code,
                    headers={"X-Auth-Token": token},
                )
                if r.status_code != 200:
                    continue
                data = r.json()
                matches = data.get("matches") or []
                count = 0
                for i, m in enumerate(matches):
                    if count >= 20:
                        break
                    status = (m.get("status") or "").upper()
                    if status not in ("SCHEDULED", "TIMED"):
                        continue
                    utc_str = (m.get("utcDate") or m.get("date")) or ""
                    if utc_str:
                        try:
                            md = datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
                            if datetime.now(timezone.utc) >= md - timedelta(minutes=SPORTS_BETTING_CLOSE_BEFORE_START_MINUTES):
                                continue
                        except Exception:
                            pass
                    ht = (m.get("homeTeam") or {}).get("name") or ""
                    at = (m.get("awayTeam") or {}).get("name") or ""
                    if not ht or not at:
                        continue
                    count += 1
                    name = "%s vs %s" % (ht, at)
                    opt_h = ht.lower().replace(" ", "_").replace(".", "")[:20]
                    opt_a = at.lower().replace(" ", "_").replace(".", "")[:20]
                    comp = (m.get("competition") or {}).get("name") or code
                    if comp and comp != code:
                        name = "%s: %s" % (comp, name)
                    odds = m.get("odds") or {}
                    try:
                        home_odds = float(odds.get("homeWin") or 2.1)
                        draw_odds = float(odds.get("draw") or 3.3)
                        away_odds = float(odds.get("awayWin") or 3.2)
                    except (TypeError, ValueError):
                        home_odds, draw_odds, away_odds = 2.1, 3.3, 3.2
                    out.append({
                        "id": "football_fdo_%s_%s" % (code, count - 1),
                        "name": name,
                        "category": "Football",
                        "options": [
                            {"id": "home_" + opt_h, "name": ht, "odds": round(home_odds, 2)},
                            {"id": "draw", "name": "Draw", "odds": round(draw_odds, 2)},
                            {"id": "away_" + opt_a, "name": at, "odds": round(away_odds, 2)},
                        ],
                    })
    except Exception:
        pass
    return out


async def _fetch_football_events_thesportsdb() -> list:
    out = []
    year = datetime.now(timezone.utc).year
    league_ids = [(THESPORTSDB_LEAGUE_PREMIER, "Premier League"), (THESPORTSDB_LEAGUE_LALIGA, "La Liga")]
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            for league_id, _ in league_ids:
                for endpoint, params in [
                    ("eventsseason.php", {"id": league_id, "s": year}),
                    ("eventsseason.php", {"id": league_id, "s": year - 1}),
                    ("eventsnextleague.php", {"id": league_id}),
                ]:
                    try:
                        r = await client.get(
                            "https://www.thesportsdb.com/api/v1/json/123/" + endpoint,
                            params=params,
                        )
                        if r.status_code != 200:
                            continue
                        data = r.json()
                        events = (data.get("events") or [])[:25]
                        for i, e in enumerate(events):
                            sport = (e.get("strSport") or "").lower()
                            if sport not in ("soccer", "football", "") and "league" not in (e.get("strLeague") or "").lower():
                                continue
                            name = (e.get("strEvent") or "").strip()
                            home = (e.get("strHomeTeam") or "").strip()
                            away = (e.get("strAwayTeam") or "").strip()
                            if not home or not away:
                                continue
                            if not name:
                                name = "%s vs %s" % (home, away)
                            status = (e.get("strStatus") or "").lower()
                            if "finished" in status or "result" in status or status == "match finished":
                                continue
                            opt_h = home.lower().replace(" ", "_").replace(".", "")[:20]
                            opt_a = away.lower().replace(" ", "_").replace(".", "")[:20]
                            out.append({
                                "id": "football_tsdb_%s_%s" % (league_id, len(out)),
                                "name": name,
                                "category": "Football",
                                "options": [
                                    {"id": "home_" + opt_h, "name": home, "odds": round(2.0 + _rng.uniform(0.2, 1.2), 2)},
                                    {"id": "draw", "name": "Draw", "odds": round(3.0 + _rng.uniform(0.1, 0.6), 2)},
                                    {"id": "away_" + opt_a, "name": away, "odds": round(2.0 + _rng.uniform(0.2, 1.2), 2)},
                                ],
                            })
                        if out:
                            break
                    except Exception:
                        continue
                    if out:
                        break
                if len(out) >= 20:
                    break
    except Exception:
        pass
    return out[:30]


async def _fetch_football_events() -> list:
    """Use Odds API exclusively when key is set. Fallback only when no key or API fails."""
    if _odds_api_key():
        events = await _fetch_odds_api_soccer()
        if events:
            return events
    events = await _fetch_football_events_football_data_org()
    if not events:
        events = await _fetch_football_events_thesportsdb()
    return events


async def _fetch_boxing_events() -> list:
    if _odds_api_key():
        events = await _fetch_odds_api_boxing()
        if events:
            return events
    try:
        year = datetime.now(timezone.utc).year
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://www.thesportsdb.com/api/v1/json/123/eventsseason.php",
                params={"id": THESPORTSDB_LEAGUE_BOXING, "s": year},
            )
            if r.status_code != 200:
                return []
            data = r.json()
            events = (data.get("events") or [])[:15]
            out = []
            for i, e in enumerate(events):
                name = (e.get("strEvent") or "").strip() or "Boxing %s" % (i + 1)
                home = (e.get("strHomeTeam") or "").strip()
                away = (e.get("strAwayTeam") or "").strip()
                if not home or not away:
                    if " vs " in name:
                        parts = name.split(" vs ", 1)
                        away = (parts[1].strip() if len(parts) > 1 else "").strip()
                        first = (parts[0].strip() if parts else "")
                        bits = first.split()
                        home = bits[-1] if bits else "Fighter A"
                        if not away:
                            away = "Fighter B"
                    else:
                        home = home or "Fighter A"
                        away = away or "Fighter B"
                opt_id_h = home.lower().replace(" ", "_").replace(".", "")[:24]
                opt_id_a = away.lower().replace(" ", "_").replace(".", "")[:24]
                out.append({
                    "id": "boxing_live_%s" % i,
                    "name": name,
                    "category": "Boxing",
                    "options": [
                        {"id": opt_id_h, "name": home, "odds": 1.9},
                        {"id": opt_id_a, "name": away, "odds": 1.95},
                    ],
                })
            return out
    except Exception:
        return []


async def _fetch_f1_drivers() -> list:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://f1api.dev/api/current/drivers",
                headers={"Accept": "application/json"},
            )
            if r.status_code == 200:
                data = r.json()
                raw = (data.get("drivers") or [])[:20]
                if raw:
                    out = []
                    for i, d in enumerate(raw):
                        driver_id = (d.get("driverId") or "d%s" % i).lower().replace(" ", "_").replace("-", "_")
                        first = (d.get("name") or "").strip()
                        last = (d.get("surname") or "").strip()
                        name = "%s %s" % (first, last).strip() or "Driver %s" % (i + 1)
                        out.append({
                            "driver_id": driver_id,
                            "name": name,
                            "option": {"id": driver_id, "name": name, "odds": round(2.0 + (i * 0.2), 2)},
                        })
                    return out
    except Exception:
        pass
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://ergast.com/api/f1/2025/drivers.json",
                headers={"Accept": "application/json"},
            )
            if r.status_code != 200:
                return []
            data = r.json()
            driver_table = (data.get("MRData") or {}).get("DriverTable") or {}
            raw = (driver_table.get("Drivers") or [])[:20]
            out = []
            for i, d in enumerate(raw):
                driver_id = (d.get("driverId") or "d%s" % i).lower().replace(" ", "_")
                given = (d.get("givenName") or "").strip()
                family = (d.get("familyName") or "").strip()
                name = "%s %s" % (given, family).strip() or "Driver %s" % (i + 1)
                out.append({
                    "driver_id": driver_id,
                    "name": name,
                    "option": {"id": driver_id, "name": name, "odds": round(2.0 + (i * 0.2), 2)},
                })
            return out
    except Exception:
        return []


async def _fetch_ufc_events() -> list:
    if _odds_api_key():
        events = await _fetch_odds_api_mma()
        if events:
            return events
    try:
        year = datetime.now(timezone.utc).year
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://www.thesportsdb.com/api/v1/json/123/eventsseason.php",
                params={"id": THESPORTSDB_LEAGUE_UFC, "s": year},
            )
            if r.status_code != 200:
                return []
            data = r.json()
            events = (data.get("events") or [])[:15]
            out = []
            for i, e in enumerate(events):
                sport = (e.get("strSport") or "").lower()
                if sport != "fighting" and "ufc" not in (e.get("strLeague") or "").lower():
                    continue
                name = (e.get("strEvent") or "").strip() or "UFC Fight %s" % (i + 1)
                home = (e.get("strHomeTeam") or "").strip()
                away = (e.get("strAwayTeam") or "").strip()
                if not home or not away:
                    if " vs " in name:
                        parts = name.split(" vs ", 1)
                        away = (parts[1].strip() if len(parts) > 1 else "").strip()
                        first = (parts[0].strip() if parts else "")
                        bits = first.split()
                        home = bits[-1] if len(bits) >= 1 else "Fighter A"
                        if not away:
                            away = "Fighter B"
                    else:
                        home = home or "Fighter A"
                        away = away or "Fighter B"
                opt_id_h = home.lower().replace(" ", "_").replace(".", "")[:24]
                opt_id_a = away.lower().replace(" ", "_").replace(".", "")[:24]
                out.append({
                    "id": "ufc_live_%s" % i,
                    "name": name,
                    "category": "UFC",
                    "options": [
                        {"id": opt_id_h, "name": home, "odds": 1.9},
                        {"id": opt_id_a, "name": away, "odds": 1.95},
                    ],
                })
            return out
    except Exception:
        return []


async def _refresh_sports_live_cache(force: bool = False):
    now = time.time()
    if not force and now - _sports_live_cache["updated_at"] < SPORTS_LIVE_CACHE_TTL:
        return
    football, ufc, boxing, f1_drivers = await asyncio.gather(
        _fetch_football_events(),
        _fetch_ufc_events(),
        _fetch_boxing_events(),
        _fetch_f1_drivers(),
    )
    _sports_live_cache["football"] = football
    _sports_live_cache["ufc"] = ufc
    _sports_live_cache["boxing"] = boxing
    retry_soon = (not football) or (not f1_drivers)
    if retry_soon:
        _sports_live_cache["updated_at"] = now - SPORTS_LIVE_CACHE_TTL + 120
    else:
        _sports_live_cache["updated_at"] = now
    f1_templates = []
    if f1_drivers:
        opts_race = [d["option"] for d in f1_drivers[:4]]
        if len(opts_race) < 4:
            opts_race.append({"id": "other", "name": "Any Other", "odds": 5.0})
        f1_templates.append({
            "id": "f1_live_race",
            "name": "Grand Prix: Race Winner",
            "category": "Formula 1",
            "options": opts_race,
        })
        d0 = f1_drivers[0] if f1_drivers else None
        if d0:
            f1_templates.append({
                "id": "f1_live_podium",
                "name": "Grand Prix: Podium Finish",
                "category": "Formula 1",
                "options": [
                    {"id": d0["driver_id"] + "_yes", "name": d0["name"] + " - Top 3", "odds": 1.5},
                    {"id": d0["driver_id"] + "_no", "name": d0["name"] + " - No Podium", "odds": 2.6},
                ],
            })
        if len(f1_drivers) >= 2:
            f1_templates.append({
                "id": "f1_live_sprint",
                "name": "Sprint Race Winner",
                "category": "Formula 1",
                "options": [
                    f1_drivers[0]["option"],
                    f1_drivers[1]["option"],
                    {"id": "field", "name": "Rest of Field", "odds": 6.0},
                ],
            })
    _sports_live_cache["f1"] = f1_templates
    try:
        await _persist_sports_templates(_get_all_sports_templates())
    except Exception as ex:
        logger.warning("sports_betting_templates persist failed: %s", ex)


def _get_all_sports_templates() -> list:
    return (
        (_sports_live_cache.get("football") or [])
        + (_sports_live_cache.get("ufc") or [])
        + (_sports_live_cache.get("boxing") or [])
        + (_sports_live_cache.get("f1") or [])
    )


def _template_to_stored_doc(t: dict) -> dict:
    """Shape for sports_betting_templates collection (upsert by id)."""
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": t["id"],
        "name": t["name"],
        "category": t["category"],
        "options": t.get("options") or [],
        "saved_at": now,
    }
    for k in ("start_time", "commence_time", "external_event_id", "external_sport_key"):
        v = t.get(k)
        if v is not None and v != "":
            doc[k] = v
    return doc


async def _persist_sports_templates(templates: list) -> int:
    """Upsert templates after an API refresh so admins can list/add without re-hitting the API."""
    n = 0
    for t in templates:
        tid = (t.get("id") or "").strip()
        if not tid or not t.get("name") or not t.get("category"):
            continue
        doc = _template_to_stored_doc(t)
        await db.sports_betting_templates.update_one({"id": tid}, {"$set": doc}, upsert=True)
        n += 1
    return n


async def _load_sports_templates_from_db() -> list:
    """Templates saved from previous refreshes. Drops entries whose start_time is long past."""
    cursor = db.sports_betting_templates.find({}, {"_id": 0}).sort("saved_at", -1).limit(5000)
    docs = await cursor.to_list(5000)
    now = datetime.now(timezone.utc)
    out: list = []
    for d in docs:
        st = d.get("start_time")
        if st:
            try:
                dt = datetime.fromisoformat(str(st).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt < now - timedelta(hours=48):
                    continue
            except Exception:
                pass
        t = {k: v for k, v in d.items() if k != "saved_at"}
        if t.get("id") and t.get("name") and t.get("category"):
            out.append(t)
    return out


async def _merged_sports_templates_for_admin() -> list:
    """In-memory snapshot (last refresh) wins on id; DB fills gaps so the panel works without API calls."""
    mem = _get_all_sports_templates()
    try:
        db_list = await _load_sports_templates_from_db()
    except Exception as ex:
        logger.warning("sports_betting_templates read failed: %s", ex)
        db_list = []
    by_id: dict = {}
    for t in db_list:
        tid = t.get("id")
        if tid:
            by_id[tid] = dict(t)
    for t in mem:
        tid = t.get("id")
        if tid:
            by_id[tid] = dict(t)
    return list(by_id.values())


def _admin_templates_json_from_list(templates: list, *, template_source: str) -> dict:
    categories = ["Football", "UFC", "Boxing", "Formula 1"]
    by_category = {c: [] for c in categories}
    for t in templates:
        cat = t.get("category")
        if not cat:
            continue
        by_category.setdefault(cat, []).append(_sports_template_to_response(t))
    return {
        "categories": categories,
        "templates": by_category,
        "odds_api_configured": bool(_odds_api_key()),
        "templates_total": len(templates),
        "template_source": template_source,
    }


async def _admin_sports_templates_payload(*, templates_persisted: Optional[int] = None) -> dict:
    merged = await _merged_sports_templates_for_admin()
    payload = _admin_templates_json_from_list(merged, template_source="merged")
    if templates_persisted is not None:
        payload["templates_persisted"] = templates_persisted
    return payload


def _sports_template_to_response(t):
    row = {"id": t["id"], "name": t["name"], "category": t["category"], "options": t.get("options") or []}
    st = t.get("start_time")
    if st:
        row["start_time"] = st
    exk = t.get("external_sport_key")
    if exk:
        row["external_sport_key"] = exk
        if (t.get("category") or "") == "Football":
            row["league_label"] = _soccer_league_display_name(exk)
    return row


async def _sports_ensure_seed_events():
    pass


async def _sports_open_stake_total(user_id: str) -> int:
    if not user_id:
        return 0
    pipeline = [
        {"$match": {"user_id": user_id, "status": "open"}},
        {"$group": {"_id": None, "t": {"$sum": "$stake"}}},
    ]
    rows = await db.sports_bets.aggregate(pipeline).to_list(1)
    if not rows:
        return 0
    return int(rows[0].get("t") or 0)


def _sports_betting_cancellation_allowed(start_time_iso: Optional[str]) -> bool:
    """True if current UTC time is still before the same cutoff as placing bets (N min before start)."""
    now = datetime.now(timezone.utc)
    try:
        start_dt = datetime.fromisoformat(start_time_iso.replace("Z", "+00:00")) if start_time_iso else now
    except Exception:
        start_dt = now
    deadline = start_dt - timedelta(minutes=SPORTS_BETTING_CLOSE_BEFORE_START_MINUTES)
    return now < deadline


# ----- Public routes -----
async def sports_betting_events(current_user: dict = Depends(get_current_user_verified)):
    await _sports_ensure_seed_events()
    now = datetime.now(timezone.utc)
    cursor = db.sports_events.find(
        {"status": "open"},
        {"_id": 0, "id": 1, "name": 1, "category": 1, "start_time": 1, "options": 1, "is_special": 1},
    ).sort("start_time", 1)
    events = await cursor.to_list(50)
    result = []
    close_betting_minutes = SPORTS_BETTING_CLOSE_BEFORE_START_MINUTES
    for e in events:
        st = e.get("start_time")
        try:
            start_dt = datetime.fromisoformat(st.replace("Z", "+00:00")) if st else now
        except Exception:
            start_dt = now
        betting_closes_at = start_dt - timedelta(minutes=close_betting_minutes)
        betting_open = now < betting_closes_at
        if now < start_dt:
            status = "upcoming"
        elif now < start_dt + timedelta(hours=3):
            status = "in_play"
        else:
            status = "finished"
        result.append({
            "id": e["id"],
            "name": e.get("name", "?"),
            "category": e.get("category", "—"),
            "start_time": st,
            "options": e.get("options") or [],
            "is_special": bool(e.get("is_special")),
            "betting_open": betting_open,
            "status": status,
        })
    return {"events": result}


async def sports_betting_place(request: SportsBetPlaceRequest, current_user: dict = Depends(get_current_user_verified)):
    event_id = (request.event_id or "").strip()
    option_id = (request.option_id or "").strip()
    stake = int(request.stake or 0)
    if not event_id or not option_id:
        raise HTTPException(status_code=400, detail="event_id and option_id required")
    if stake <= 0:
        raise HTTPException(status_code=400, detail="Stake must be greater than 0")
    ev = await db.sports_events.find_one({"id": event_id, "status": "open"}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found or closed")
    st = ev.get("start_time")
    if not _sports_betting_cancellation_allowed(st):
        raise HTTPException(status_code=400, detail="Betting closed (closes 10 min before start)")
    opt = next((o for o in (ev.get("options") or []) if o.get("id") == option_id), None)
    if not opt:
        raise HTTPException(status_code=400, detail="Invalid option")
    uid = current_user.get("id") or ""
    open_total = await _sports_open_stake_total(uid)
    if open_total + stake > SPORTS_BET_MAX_TOTAL_OPEN_STAKE:
        remaining = max(0, SPORTS_BET_MAX_TOTAL_OPEN_STAKE - open_total)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Total open sports stakes are capped at ${SPORTS_BET_MAX_TOTAL_OPEN_STAKE:,}. "
                f"You have ${open_total:,} at risk; you can add at most ${remaining:,} more."
            ),
        )
    now = datetime.now(timezone.utc).isoformat()
    bet_id = str(uuid.uuid4())
    result = await db.users.update_one(
        {"id": current_user.get("id") or "", "money": {"$gte": stake}},
        {"$inc": {"money": -stake}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.sports_bets.insert_one({
        "id": bet_id,
        "user_id": current_user.get("id") or "",
        "event_id": event_id,
        "event_name": ev.get("name", "?"),
        "option_id": option_id,
        "option_name": opt.get("name", "?"),
        "odds": float(opt.get("odds", 1)),
        "stake": stake,
        "status": "open",
        "created_at": now,
    })
    await log_gambling(current_user.get("id") or "", current_user.get("username") or "?", "sports_bet", {"bet_id": bet_id, "event_name": ev.get("name"), "option_name": opt.get("name"), "odds": float(opt.get("odds", 1)), "stake": stake, "status": "open"})
    return {"message": f"Bet placed: ${stake:,} on {opt.get('name')}", "bet_id": bet_id}


async def sports_betting_my_bets(current_user: dict = Depends(get_current_user_verified)):
    uid = current_user.get("id") or ""
    open_bets = await db.sports_bets.find(
        {"user_id": uid, "status": "open"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    closed_bets = await db.sports_bets.find(
        {"user_id": uid, "status": {"$in": ["won", "lost"]}},
        {"_id": 0},
    ).sort("settled_at", -1).to_list(50)
    open_stake_total = await _sports_open_stake_total(uid)
    remaining = max(0, SPORTS_BET_MAX_TOTAL_OPEN_STAKE - open_stake_total)
    return {
        "open": [{"id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "odds": b.get("odds"), "stake": b.get("stake"), "created_at": b.get("created_at")} for b in open_bets],
        "closed": [{"id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "odds": b.get("odds"), "stake": b.get("stake"), "status": b.get("status"), "created_at": b.get("created_at"), "settled_at": b.get("settled_at")} for b in closed_bets],
        "max_total_open_stake": SPORTS_BET_MAX_TOTAL_OPEN_STAKE,
        "open_stake_total": open_stake_total,
        "open_stake_remaining": remaining,
    }


async def sports_betting_cancel_bet(request: SportsBetCancelRequest, current_user: dict = Depends(get_current_user_verified)):
    bet_id = (request.bet_id or "").strip()
    if not bet_id:
        raise HTTPException(status_code=400, detail="bet_id required")
    uid = current_user.get("id") or ""
    bet = await db.sports_bets.find_one({"id": bet_id, "user_id": uid, "status": "open"}, {"_id": 0})
    if not bet:
        raise HTTPException(status_code=400, detail="Bet not found or already cancelled")
    ev = await db.sports_events.find_one({"id": bet.get("event_id") or ""}, {"_id": 0, "start_time": 1})
    if ev is not None and not _sports_betting_cancellation_allowed(ev.get("start_time")):
        raise HTTPException(status_code=400, detail="Cancellation closed (closes 10 min before start)")
    now = datetime.now(timezone.utc).isoformat()
    bet = await db.sports_bets.find_one_and_update(
        {"id": bet_id, "user_id": uid, "status": "open"},
        {"$set": {"status": "cancelled", "settled_at": now}},
    )
    if not bet:
        raise HTTPException(status_code=400, detail="Bet not found or already cancelled")
    stake = int(bet.get("stake") or 0)
    if stake > 0:
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": stake}})
    return {"message": f"Bet cancelled. ${stake:,} refunded.", "refunded": stake}


async def sports_betting_cancel_all_bets(current_user: dict = Depends(get_current_user_verified)):
    uid = current_user.get("id") or ""
    cursor = db.sports_bets.find({"user_id": uid, "status": "open"}, {"_id": 0, "id": 1, "stake": 1, "event_id": 1})
    bets = await cursor.to_list(100)
    if not bets:
        return {"message": "No open bets to cancel.", "refunded": 0, "cancelled_count": 0, "skipped_count": 0}
    eids = list({(b.get("event_id") or "") for b in bets if b.get("event_id")})
    events_by_id: dict = {}
    if eids:
        ev_cursor = db.sports_events.find({"id": {"$in": eids}}, {"_id": 0, "id": 1, "start_time": 1})
        for doc in await ev_cursor.to_list(len(eids)):
            events_by_id[doc["id"]] = doc
    total_refund = 0
    cancelled_count = 0
    skipped_count = 0
    now = datetime.now(timezone.utc).isoformat()
    for b in bets:
        ev = events_by_id.get(b.get("event_id") or "")
        if ev is not None and not _sports_betting_cancellation_allowed(ev.get("start_time")):
            skipped_count += 1
            continue
        claimed = await db.sports_bets.find_one_and_update(
            {"id": b["id"], "status": "open"},
            {"$set": {"status": "cancelled", "settled_at": now}},
        )
        if not claimed:
            continue
        total_refund += int(claimed.get("stake") or 0)
        cancelled_count += 1
    if total_refund > 0:
        await db.users.update_one({"id": uid}, {"$inc": {"money": total_refund}})
    if cancelled_count == 0 and skipped_count > 0:
        msg = (
            f"No bets cancelled — {skipped_count} open bet(s) past cancellation cutoff "
            f"({SPORTS_BETTING_CLOSE_BEFORE_START_MINUTES} min before start)."
        )
    elif skipped_count:
        msg = f"Cancelled {cancelled_count} bet(s). ${total_refund:,} refunded. {skipped_count} bet(s) past cutoff and still open."
    else:
        msg = f"All {cancelled_count} bet(s) cancelled. ${total_refund:,} refunded."
    return {"message": msg, "refunded": total_refund, "cancelled_count": cancelled_count, "skipped_count": skipped_count}


async def compute_sports_betting_stats(uid: str, settled_after_iso: Optional[str] = None) -> dict:
    """Aggregate sports bet stats. If settled_after_iso is set, only settled won/lost with settled_at >= that ISO string."""
    base_settled: dict = {"user_id": uid}
    if settled_after_iso:
        base_settled["settled_at"] = {"$gte": settled_after_iso}
    settled_match = {**base_settled, "status": {"$in": ["won", "lost"]}}
    won_match = {**base_settled, "status": "won"}
    lost_match = {**base_settled, "status": "lost"}
    pipeline = [
        {"$match": settled_match},
        {"$group": {"_id": None, "total_stake": {"$sum": "$stake"}, "won_count": {"$sum": {"$cond": [{"$eq": ["$status", "won"]}, 1, 0]}}, "lost_count": {"$sum": {"$cond": [{"$eq": ["$status", "lost"]}, 1, 0]}}}},
    ]
    agg = await db.sports_bets.aggregate(pipeline).to_list(1)
    doc = agg[0] if agg else {}
    won_count = int(doc.get("won_count", 0) or 0)
    lost_count = int(doc.get("lost_count", 0) or 0)
    total_placed_settled = won_count + lost_count
    won_stake = await db.sports_bets.aggregate([
        {"$match": won_match},
        {"$group": {"_id": None, "sum": {"$sum": {"$multiply": ["$stake", "$odds"]}}}},
    ]).to_list(1)
    lost_stake = await db.sports_bets.aggregate([
        {"$match": lost_match},
        {"$group": {"_id": None, "sum": {"$sum": "$stake"}}},
    ]).to_list(1)
    winnings = int((won_stake[0].get("sum", 0) or 0)) if won_stake else 0
    losses = int((lost_stake[0].get("sum", 0) or 0)) if lost_stake else 0
    profit_loss = winnings - losses
    win_pct = round(100 * won_count / total_placed_settled, 1) if total_placed_settled else 0

    placed_q: dict = {"user_id": uid}
    if settled_after_iso:
        placed_q["created_at"] = {"$gte": settled_after_iso}
    bets_placed_count = await db.sports_bets.count_documents(placed_q)

    biggest_win_doc = await db.sports_bets.find_one(
        won_match,
        {"stake": 1, "odds": 1},
        sort=[("stake", -1)],
    )
    biggest_win = int((biggest_win_doc.get("stake", 0) * biggest_win_doc.get("odds", 1))) if biggest_win_doc else 0

    biggest_loss_doc = await db.sports_bets.find_one(
        lost_match,
        {"stake": 1},
        sort=[("stake", -1)],
    )
    biggest_loss = int(biggest_loss_doc.get("stake", 0)) if biggest_loss_doc else 0

    u = await db.users.find_one({"id": uid}, {"sports_current_win_streak": 1, "sports_best_win_streak": 1})
    current_win_streak = int((u or {}).get("sports_current_win_streak", 0))
    best_win_streak = int((u or {}).get("sports_best_win_streak", 0))

    return {
        "total_bets_placed": bets_placed_count,
        "total_bets_won": won_count,
        "total_bets_lost": lost_count,
        "win_pct": win_pct,
        "profit_loss": profit_loss,
        "biggest_win": biggest_win,
        "biggest_loss": biggest_loss,
        "current_win_streak": current_win_streak,
        "best_win_streak": best_win_streak,
    }


async def compute_sports_betting_global_stats() -> dict:
    """All-time book stats: every bet row, aggregate player P/L on settled won/lost (same formula as per-user stats)."""
    total_bets_all_time = await db.sports_bets.count_documents({})
    won_stake = await db.sports_bets.aggregate([
        {"$match": {"status": "won"}},
        {"$group": {"_id": None, "sum": {"$sum": {"$multiply": ["$stake", "$odds"]}}}},
    ]).to_list(1)
    lost_stake = await db.sports_bets.aggregate([
        {"$match": {"status": "lost"}},
        {"$group": {"_id": None, "sum": {"$sum": "$stake"}}},
    ]).to_list(1)
    winnings = int((won_stake[0].get("sum", 0) or 0)) if won_stake else 0
    losses = int((lost_stake[0].get("sum", 0) or 0)) if lost_stake else 0
    aggregate_player_profit_loss = winnings - losses
    settled_bets_count = await db.sports_bets.count_documents({"status": {"$in": ["won", "lost"]}})
    open_agg = await db.sports_bets.aggregate([
        {"$match": {"status": "open"}},
        {"$group": {"_id": None, "total": {"$sum": "$stake"}}},
    ]).to_list(1)
    open_stake_all_players = int((open_agg[0].get("total", 0) or 0)) if open_agg else 0
    return {
        "total_bets_all_time": total_bets_all_time,
        "settled_bets_count": settled_bets_count,
        "aggregate_player_profit_loss": aggregate_player_profit_loss,
        "open_stake_all_players": open_stake_all_players,
    }


async def sports_betting_stats(current_user: dict = Depends(get_current_user_verified)):
    uid = current_user.get("id") or ""
    personal = await compute_sports_betting_stats(uid, None)
    personal["global_book"] = await compute_sports_betting_global_stats()
    return personal


async def sports_betting_recent_results(current_user: dict = Depends(get_current_user_verified)):
    cursor = db.sports_bets.find(
        {"user_id": current_user.get("id") or "", "status": {"$in": ["won", "lost"]}},
        {"_id": 0, "option_name": 1, "odds": 1, "status": 1, "settled_at": 1, "created_at": 1},
    ).sort("settled_at", -1).limit(25)
    rows = await cursor.to_list(25)
    return {
        "results": [
            {"betting_option": b.get("option_name", "—"), "odds": b.get("odds"), "result": b.get("status", "—"), "date": b.get("settled_at") or b.get("created_at")}
            for b in rows
        ],
    }


# ----- Admin routes -----
async def admin_sports_templates(current_user: dict = Depends(get_current_user_verified)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    return await _admin_sports_templates_payload()


async def admin_sports_refresh(current_user: dict = Depends(get_current_user_verified)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    await _refresh_sports_live_cache(force=True)
    n = len(_get_all_sports_templates())
    return await _admin_sports_templates_payload(templates_persisted=n)


async def admin_sports_templates_load_db(current_user: dict = Depends(get_current_user_verified)):
    """Admin: list templates from MongoDB only (no Odds API / no in-memory cache). Uses no API quota."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    db_list = await _load_sports_templates_from_db()
    return _admin_templates_json_from_list(db_list, template_source="database")


async def admin_sports_add_event(request: AdminAddSportsEventRequest, current_user: dict = Depends(get_current_user_verified)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    template_id = (request.template_id or "").strip()
    merged = await _merged_sports_templates_for_admin()
    template = next((t for t in merged if t.get("id") == template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    now = datetime.now(timezone.utc)
    start_time = template.get("start_time") or _parse_commence_time(template.get("commence_time"))
    if not start_time:
        start_time = (now + timedelta(hours=2)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    ev = {
        "id": str(uuid.uuid4()),
        "name": template["name"],
        "category": template["category"],
        "start_time": start_time,
        "options": [dict(o) for o in template["options"]],
        "is_special": False,
        "status": "open",
    }
    if template.get("external_event_id") and template.get("external_sport_key"):
        ev["external_event_id"] = template["external_event_id"]
        ev["external_sport_key"] = template["external_sport_key"]
    await db.sports_events.insert_one(ev)
    return {"message": f"Added event: {template['name']}", "event_id": ev["id"]}


async def admin_sports_add_custom_event(request: AdminAddCustomSportsEventRequest, current_user: dict = Depends(get_current_user_verified)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    name = (request.name or "").strip()
    category = (request.category or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Event name required")
    valid_categories = ("Football", "UFC", "Boxing", "Formula 1")
    if category not in valid_categories:
        raise HTTPException(status_code=400, detail=f"category must be one of: {', '.join(valid_categories)}")
    opts = list(request.options or [])
    if len(opts) < 2:
        raise HTTPException(status_code=400, detail="At least 2 options required")
    now = datetime.now(timezone.utc)
    start_time = (now + timedelta(hours=2)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    options = []
    for i, o in enumerate(opts):
        opt_name = (o.name or "").strip()
        if not opt_name:
            raise HTTPException(status_code=400, detail=f"Option {i + 1} name required")
        try:
            odds = float(o.odds if o.odds is not None else 2.0)
        except (TypeError, ValueError):
            odds = 2.0
        odds = max(1.01, min(100.0, round(odds, 2)))
        opt_id = (opt_name.lower().replace(" ", "_").replace(".", "")[:24] or f"opt_{i}") + f"_{uuid.uuid4().hex[:6]}"
        options.append({"id": opt_id, "name": opt_name, "odds": odds})
    ev = {
        "id": str(uuid.uuid4()),
        "name": name,
        "category": category,
        "start_time": start_time,
        "options": options,
        "is_special": False,
        "status": "open",
    }
    await db.sports_events.insert_one(ev)
    return {"message": f"Added custom event: {name}", "event_id": ev["id"]}


async def _settle_event_internal(event_id: str, winning_option_id: str) -> bool:
    """Settle an event: update status, settle all open bets, pay winners. Returns True if settled."""
    now = datetime.now(timezone.utc).isoformat()
    ev = await db.sports_events.find_one_and_update(
        {"id": event_id, "status": "open"},
        {"$set": {"status": "settled", "winning_option_id": winning_option_id, "settled_at": now}},
    )
    if not ev:
        return False
    cursor = db.sports_bets.find(
        {"event_id": event_id, "status": "open"},
        {"_id": 0, "id": 1, "user_id": 1, "option_id": 1, "stake": 1, "odds": 1, "event_name": 1, "option_name": 1},
    )
    for b in await cursor.to_list(1000):
        won = b.get("option_id") == winning_option_id
        new_status = "won" if won else "lost"
        bet_claim = await db.sports_bets.find_one_and_update(
            {"id": b["id"], "status": "open"},
            {"$set": {"status": new_status, "settled_at": now}},
        )
        if not bet_claim:
            continue
        u = await db.users.find_one({"id": bet_claim["user_id"]}, {"_id": 0, "username": 1, "sports_current_win_streak": 1, "sports_best_win_streak": 1})
        await log_gambling(bet_claim["user_id"], u.get("username") if u else "?", "sports_bet", {"bet_id": bet_claim["id"], "event_name": bet_claim.get("event_name"), "option_name": bet_claim.get("option_name"), "stake": bet_claim.get("stake"), "odds": bet_claim.get("odds"), "status": new_status, "settled_at": now})
        if won:
            stake = int(bet_claim.get("stake") or 0)
            odds = float(bet_claim.get("odds") or 1)
            payout = int(stake * odds)
            current_streak = int((u or {}).get("sports_current_win_streak", 0)) + 1
            best_streak = max(current_streak, int((u or {}).get("sports_best_win_streak", 0)))
            update_fields = {"sports_current_win_streak": current_streak, "sports_best_win_streak": best_streak}
            if payout > 0:
                await db.users.update_one({"id": bet_claim["user_id"]}, {"$inc": {"money": payout}, "$set": update_fields})
            else:
                await db.users.update_one({"id": bet_claim["user_id"]}, {"$set": update_fields})
        else:
            await db.users.update_one({"id": bet_claim["user_id"]}, {"$set": {"sports_current_win_streak": 0}})
    return True


async def admin_sports_settle(request: SportsSettleEventRequest, current_user: dict = Depends(get_current_user_verified)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    event_id = (request.event_id or "").strip()
    winning_option_id = (request.winning_option_id or "").strip()
    if not event_id or not winning_option_id:
        raise HTTPException(status_code=400, detail="event_id and winning_option_id required")
    settled = await _settle_event_internal(event_id, winning_option_id)
    if not settled:
        raise HTTPException(status_code=400, detail="Event not found or already settled")
    return {"message": f"Event {event_id} settled. Winning option: {winning_option_id}. Winners paid out."}


async def admin_sports_cancel_event(request: AdminCancelEventRequest, current_user: dict = Depends(get_current_user_verified)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    event_id = (request.event_id or "").strip()
    now = datetime.now(timezone.utc).isoformat()
    ev = await db.sports_events.find_one_and_update(
        {"id": event_id, "status": "open"},
        {"$set": {"status": "cancelled", "cancelled_at": now}},
    )
    if not ev:
        raise HTTPException(status_code=400, detail="Event not found or already cancelled")
    cursor = db.sports_bets.find(
        {"event_id": event_id, "status": "open"},
        {"_id": 0, "id": 1, "user_id": 1, "stake": 1},
    )
    refunded_count = 0
    total_refunded = 0
    for b in await cursor.to_list(1000):
        bet_claim = await db.sports_bets.find_one_and_update(
            {"id": b["id"], "status": "open"},
            {"$set": {"status": "cancelled", "settled_at": now}},
        )
        if not bet_claim:
            continue
        stake = int(bet_claim.get("stake") or 0)
        if stake > 0:
            await db.users.update_one({"id": bet_claim["user_id"]}, {"$inc": {"money": stake}})
        refunded_count += 1
        total_refunded += stake
    return {
        "message": f"Event cancelled. {refunded_count} bet(s) refunded (${total_refunded:,} total).",
        "refunded_count": refunded_count,
        "total_refunded": total_refunded,
    }


def register(router):
    if _odds_api_key():
        logger.info("Sports betting: THE_ODDS_API_KEY is set — using The Odds API for Football/UFC/Boxing and for auto-settle.")
    else:
        logger.warning("Sports betting: THE_ODDS_API_KEY is not set — Football/UFC/Boxing use fallback sources; auto-settle will not run.")

    router.add_api_route("/sports-betting/events", sports_betting_events, methods=["GET"])
    router.add_api_route("/sports-betting/bet", sports_betting_place, methods=["POST"])
    router.add_api_route("/sports-betting/my-bets", sports_betting_my_bets, methods=["GET"])
    router.add_api_route("/sports-betting/cancel-bet", sports_betting_cancel_bet, methods=["POST"])
    router.add_api_route("/sports-betting/cancel-all-bets", sports_betting_cancel_all_bets, methods=["POST"])
    router.add_api_route("/sports-betting/stats", sports_betting_stats, methods=["GET"])
    router.add_api_route("/sports-betting/recent-results", sports_betting_recent_results, methods=["GET"])
    router.add_api_route("/admin/sports-betting/templates", admin_sports_templates, methods=["GET"])
    router.add_api_route("/admin/sports-betting/templates/load-db", admin_sports_templates_load_db, methods=["POST"])
    router.add_api_route("/admin/sports-betting/refresh", admin_sports_refresh, methods=["POST"])
    router.add_api_route("/admin/sports-betting/events", admin_sports_add_event, methods=["POST"])
    router.add_api_route("/admin/sports-betting/custom-event", admin_sports_add_custom_event, methods=["POST"])
    router.add_api_route("/admin/sports-betting/settle", admin_sports_settle, methods=["POST"])
    router.add_api_route("/admin/sports-betting/cancel-event", admin_sports_cancel_event, methods=["POST"])

    # Cron: auto-settle from Odds API scores (call every 15-30 min)
    cron_secret = (os.environ.get("CRON_SECRET") or "").strip()

    async def verify_sports_cron_secret(x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret")):
        if not cron_secret:
            raise HTTPException(status_code=503, detail="Sports cron not configured (CRON_SECRET unset)")
        if (x_cron_secret or "").strip() != cron_secret:
            raise HTTPException(status_code=403, detail="Invalid cron secret")

    async def cron_sports_auto_settle(_: None = Depends(verify_sports_cron_secret)):
        """Cron: poll Odds API scores, settle matching events, pay winners. Call every 15-30 min. Header: X-Cron-Secret."""
        return await _auto_settle_from_scores()

    router.add_api_route("/sports-betting/cron/auto-settle", cron_sports_auto_settle, methods=["POST"])
