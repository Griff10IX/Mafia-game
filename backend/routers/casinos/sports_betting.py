# Sports betting: events, place/cancel bets, stats, recent results; admin templates, add/settle/cancel events
from datetime import datetime, timezone, timedelta
import asyncio
import logging
import time
import secrets
import unicodedata
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
from fastapi import Depends, Header, HTTPException, Query
import httpx

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    log_gambling,
    send_notification,
    _is_admin,
    _is_moderator,
    _get_staff_user_ids,
)

logger = logging.getLogger(__name__)


def _env_flag(name: str) -> bool:
    v = (os.environ.get(name) or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _sports_payout_to_swiss() -> bool:
    """Win payouts go to swiss_balance (bypasses deposit limit). Set SPORTS_PAYOUT_TO_SWISS=0 to pay cash instead."""
    v = (os.environ.get("SPORTS_PAYOUT_TO_SWISS") or "").strip().lower()
    if v in ("0", "false", "no", "off"):
        return False
    return True


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
    # Optional ISO-8601 times (UTC or offset). Omitted = defaults (start = now+2h; close = 10 min before start; open = immediately).
    start_time: Optional[str] = None
    betting_opens_at: Optional[str] = None
    betting_closes_at: Optional[str] = None


class AdminPatchSportsEventBettingWindow(BaseModel):
    event_id: str
    betting_opens_at: Optional[str] = None
    betting_closes_at: Optional[str] = None


class SportsRequestEventBody(BaseModel):
    template_id: str


class AdminSportsEventRequestApprove(BaseModel):
    request_id: str


class AdminSportsEventRequestDeny(BaseModel):
    request_id: str
    reason: Optional[str] = None


# ----- Constants -----
# Max total stake locked in open sports bets per user (split across any number of bets).
# Override persisted in game_settings key sports_bet_max_total_open_stake (see get_sports_bet_max_total_open_stake).
SPORTS_BET_MAX_TOTAL_OPEN_STAKE = 25_000_000
_SPORTS_BET_STAKE_CAP_CEILING = 10**15
# Placing bets and cancelling open bets both end this many minutes before scheduled start.
SPORTS_BETTING_CLOSE_BEFORE_START_MINUTES = 10
# Public board: return enough open events that high-volume Football does not crowd out UFC/Boxing/F1.
SPORTS_BETTING_PUBLIC_EVENTS_LIMIT = 500
# Player-submitted requests to add a template to the board (UTC calendar day).
SPORTS_EVENT_REQUESTS_PER_DAY = 3
SPORTS_EVENT_REQUEST_MAX_HOURS_AHEAD = 24
SPORTS_LIVE_CACHE_TTL = 30 * 60  # 30 min (was 6h) so "Check for events" gets fresher templates
ODDS_API_BASE = "https://api.the-odds-api.com/v4"
THESPORTSDB_LEAGUE_PREMIER = 4328
THESPORTSDB_LEAGUE_LALIGA = 4335
THESPORTSDB_LEAGUE_UFC = 4443
THESPORTSDB_LEAGUE_BOXING = 4445

_sports_live_cache = {"football": [], "ufc": [], "boxing": [], "f1": [], "updated_at": 0.0}


async def get_sports_bet_max_total_open_stake() -> int:
    """Total open sports stake cap per user (admin-configurable via game_settings)."""
    try:
        doc = await db.game_settings.find_one({"key": "sports_bet_max_total_open_stake"}, {"_id": 0, "value": 1})
        if doc is not None and doc.get("value") is not None:
            v = int(doc["value"])
            return max(1, min(v, _SPORTS_BET_STAKE_CAP_CEILING))
    except (TypeError, ValueError):
        pass
    return SPORTS_BET_MAX_TOTAL_OPEN_STAKE


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


def _merge_odds_api_events_by_id(raw_lists: list) -> list:
    """Union Odds API event payloads by id; merge bookmakers so h2h markets from any region are available."""
    merged: dict = {}
    for events in raw_lists:
        if not isinstance(events, list):
            continue
        for ev in events:
            if not isinstance(ev, dict):
                continue
            eid = (ev.get("id") or "").strip()
            if not eid:
                continue
            if eid not in merged:
                merged[eid] = dict(ev)
                continue
            cur = merged[eid]
            cur_b = list(cur.get("bookmakers") or [])
            seen = {(b.get("key"), b.get("title")) for b in cur_b}
            for b in ev.get("bookmakers") or []:
                if not isinstance(b, dict):
                    continue
                t = (b.get("key"), b.get("title"))
                if t not in seen:
                    cur_b.append(b)
                    seen.add(t)
            cur["bookmakers"] = cur_b
    return list(merged.values())


def _kickoff_still_upcoming_for_template_list(start_time_iso: Optional[str], *, now: Optional[datetime] = None) -> bool:
    """False if kickoff is in the past (UTC). True if missing or unparseable (keep legacy rows)."""
    if not start_time_iso or not str(start_time_iso).strip():
        return True
    now = now or datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(str(start_time_iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt > now
    except Exception:
        return True


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

    # Boxing/MMA often list fighter + draw under h2h_3_way only; two-way parse strips draw later.
    tw = _outcomes_for_keys(("h2h_3_way",))
    if tw:
        return tw
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
        if len(options) == 3:
            no_draw = [o for o in options if not _is_draw_outcome_name((o.get("name") or ""))]
            if len(no_draw) == 2:
                options = no_draw
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
    "soccer_saudi_arabia_pro_league",
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

# Boxing/MMA: merge across regions so fights with only EU/UK books (e.g. PPV cards) still appear.
FIGHT_SPORTS_ODDS_REGION_ATTEMPTS = (
    "uk,us,eu",
    "uk,us",
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
        "soccer_saudi_arabia_pro_league": "Saudi Pro League",
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
    cache_key = "v2:odds:mma_mixed_martial_arts:merged"
    ttl = _sports_odds_cache_ttl_sec()
    out = []
    try:
        events = await _odds_cache_read_list_if_fresh(cache_key, ttl)
        if events is None:
            raw_lists: list = []
            async with httpx.AsyncClient(timeout=18.0) as client:
                for regions in FIGHT_SPORTS_ODDS_REGION_ATTEMPTS:
                    try:
                        r = await client.get(
                            "%s/sports/mma_mixed_martial_arts/odds" % ODDS_API_BASE,
                            params={"apiKey": key, "regions": regions, "markets": "h2h", "oddsFormat": "decimal"},
                        )
                        if r.status_code != 200:
                            logger.warning("Odds API odds mma HTTP %s regions=%s", r.status_code, regions)
                            continue
                        chunk = r.json()
                        if isinstance(chunk, list):
                            raw_lists.append(chunk)
                    except Exception as ex:
                        logger.warning("Odds API mma fetch regions=%s: %s", regions, ex)
            events = _merge_odds_api_events_by_id(raw_lists)
            await _odds_cache_write_list(cache_key, 200, events)
        for ev in events:
            if not _is_future_event(ev, require_time=True, buffer_minutes=0):
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
    cache_key = "v2:odds:boxing_boxing:merged"
    ttl = _sports_odds_cache_ttl_sec()
    out = []
    try:
        events = await _odds_cache_read_list_if_fresh(cache_key, ttl)
        if events is None:
            raw_lists: list = []
            async with httpx.AsyncClient(timeout=18.0) as client:
                for regions in FIGHT_SPORTS_ODDS_REGION_ATTEMPTS:
                    try:
                        r = await client.get(
                            "%s/sports/boxing_boxing/odds" % ODDS_API_BASE,
                            params={"apiKey": key, "regions": regions, "markets": "h2h", "oddsFormat": "decimal"},
                        )
                        if r.status_code != 200:
                            logger.warning("Odds API odds boxing HTTP %s regions=%s", r.status_code, regions)
                            continue
                        chunk = r.json()
                        if isinstance(chunk, list):
                            raw_lists.append(chunk)
                    except Exception as ex:
                        logger.warning("Odds API boxing fetch regions=%s: %s", regions, ex)
            events = _merge_odds_api_events_by_id(raw_lists)
            await _odds_cache_write_list(cache_key, 200, events)
        for ev in events:
            if not _is_future_event(ev, require_time=True, buffer_minutes=0):
                continue
            parsed = _parse_odds_event(ev, "Boxing", three_way=False, sport_key="boxing_boxing")
            if parsed:
                out.append(parsed)
    except Exception as ex:
        logger.warning("Odds API boxing: %s", ex)
    return out


async def _fetch_odds_api_f1() -> list:
    """Head-to-head / two-outcome markets from The Odds API (linkable for auto-settle)."""
    key = _odds_api_key()
    if not key:
        return []
    cache_key = "v1:odds:motor_racing_f1"
    ttl = _sports_odds_cache_ttl_sec()
    out = []
    try:
        events = await _odds_cache_read_list_if_fresh(cache_key, ttl)
        if events is None:
            async with httpx.AsyncClient(timeout=14.0) as client:
                r = await client.get(
                    "%s/sports/motor_racing_f1/odds" % ODDS_API_BASE,
                    params={"apiKey": key, "regions": "uk,us", "markets": "h2h", "oddsFormat": "decimal"},
                )
            if r.status_code != 200:
                logger.warning("Odds API odds motor_racing_f1 HTTP %s", r.status_code)
                return []
            events = r.json()
            if not isinstance(events, list):
                events = []
            await _odds_cache_write_list(cache_key, 200, events)
        for ev in events[:25]:
            if not _is_future_event(ev, require_time=True):
                continue
            parsed = _parse_odds_event(ev, "Formula 1", three_way=False, sport_key="motor_racing_f1")
            if parsed:
                out.append(parsed)
    except Exception as ex:
        logger.warning("Odds API F1: %s", ex)
    return out


# ----- Odds API Scores (for auto-settle) -----
ODDS_API_SPORT_KEYS = {
    "Football": list(SOCCER_LEAGUES),
    "UFC": ["mma_mixed_martial_arts"],
    "Boxing": ["boxing_boxing"],
    "Formula 1": ["motor_racing_f1"],
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


def _name_norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _match_option_id_by_name(options: list, target_name: str) -> Optional[str]:
    t = _name_norm(target_name)
    if not t:
        return None
    for o in options or []:
        name = (o.get("name") or "")
        if _name_norm(name) == t:
            return o.get("id")
    # fallback: token-ish containment
    for o in options or []:
        n = _name_norm(o.get("name") or "")
        if n and (n in t or t in n):
            return o.get("id")
    return None


def _derive_winning_option_from_simple_score(
    options: list,
    home_team: str,
    away_team: str,
    home_score: int,
    away_score: int,
    three_way: bool,
) -> Optional[str]:
    if home_score > away_score:
        return _match_option_id_by_name(options, home_team)
    if away_score > home_score:
        return _match_option_id_by_name(options, away_team)
    if three_way:
        for o in options or []:
            if _is_draw_outcome_name((o.get("name") or "")):
                return o.get("id")
    return None


def _event_datetime_utc(ev: dict) -> Optional[datetime]:
    return _parse_start_time_utc((ev or {}).get("start_time"))


def _looks_like_same_teams(event_options: list, home_team: str, away_team: str) -> bool:
    option_names = [str((o or {}).get("name") or "").strip() for o in (event_options or [])]
    option_names = [n for n in option_names if n and not _is_draw_outcome_name(n)]
    if len(option_names) < 2:
        return False
    h = _name_norm(home_team)
    a = _name_norm(away_team)
    if not h or not a:
        return False
    n0 = _name_norm(option_names[0])
    n1 = _name_norm(option_names[1])
    return (h in n0 or n0 in h) and (a in n1 or n1 in a) or (h in n1 or n1 in h) and (a in n0 or n0 in a)


async def _fetch_football_data_finished_matches(days_back: int = 4) -> list:
    token = (os.environ.get("FOOTBALL_DATA_ORG_TOKEN") or "").strip()
    if not token:
        return []
    to_dt = datetime.now(timezone.utc).date()
    from_dt = to_dt - timedelta(days=max(1, min(int(days_back), 10)))
    out = []
    comp_codes = ("PL", "PD", "BL1", "SA", "FL1", "CL", "EL", "PPL", "DED")
    try:
        async with httpx.AsyncClient(timeout=16.0) as client:
            for code in comp_codes:
                r = await client.get(
                    "https://api.football-data.org/v4/competitions/%s/matches" % code,
                    headers={"X-Auth-Token": token},
                    params={"status": "FINISHED", "dateFrom": str(from_dt), "dateTo": str(to_dt)},
                )
                if r.status_code != 200:
                    continue
                data = r.json() or {}
                for m in (data.get("matches") or []):
                    ht = ((m.get("homeTeam") or {}).get("name") or "").strip()
                    at = ((m.get("awayTeam") or {}).get("name") or "").strip()
                    full = (m.get("score") or {}).get("fullTime") or {}
                    try:
                        hs = int(full.get("home"))
                        as_ = int(full.get("away"))
                    except Exception:
                        continue
                    dt_raw = (m.get("utcDate") or "").strip()
                    if not ht or not at or not dt_raw:
                        continue
                    out.append({
                        "home_team": ht,
                        "away_team": at,
                        "home_score": hs,
                        "away_score": as_,
                        "utcDate": dt_raw,
                    })
    except Exception as ex:
        logger.warning("football-data.org finished matches fetch failed: %s", ex)
        return []
    return out


async def _auto_settle_fallback_football_data() -> int:
    """Fallback settle for soccer-linked open events when Odds API score polling fails."""
    bet_event_ids = await _linkable_due_once_event_ids_with_open_bets()
    if not bet_event_ids:
        return 0
    has_soccer = await db.sports_events.find_one(
        {"status": "open", "id": {"$in": list(bet_event_ids)},
         "external_sport_key": {"$in": list(SOCCER_LEAGUES)}},
        {"_id": 1},
    )
    if not has_soccer:
        return 0
    matches = await _fetch_football_data_finished_matches(days_back=4)
    if not matches:
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor = db.sports_events.find(
        {
            "status": "open",
            "external_sport_key": {"$in": list(SOCCER_LEAGUES)},
            "start_time": {"$lte": now_iso},
            "id": {"$in": list(bet_event_ids)},
        },
        {"_id": 0, "id": 1, "options": 1, "start_time": 1},
    ).limit(1000)
    settled = 0
    async for ev in cursor:
        st = _event_datetime_utc(ev)
        if st is None:
            continue
        winning_id = None
        for m in matches:
            if not _looks_like_same_teams(ev.get("options") or [], m["home_team"], m["away_team"]):
                continue
            try:
                md = datetime.fromisoformat(str(m.get("utcDate") or "").replace("Z", "+00:00"))
            except Exception:
                continue
            if abs((md - st).total_seconds()) > 60 * 60 * 48:
                continue
            winning_id = _derive_winning_option_from_simple_score(
                ev.get("options") or [],
                m["home_team"],
                m["away_team"],
                int(m["home_score"]),
                int(m["away_score"]),
                True,
            )
            if winning_id:
                break
        if not winning_id:
            continue
        if await _settle_event_internal(ev.get("id") or "", winning_id):
            settled += 1
    return settled


async def _fetch_ergast_f1_results_recent() -> list:
    out = []
    endpoints = [
        "https://ergast.com/api/f1/current/results.json?limit=500",
        "https://ergast.com/api/f1/last/results.json?limit=500",
    ]
    try:
        async with httpx.AsyncClient(timeout=16.0) as client:
            for url in endpoints:
                r = await client.get(url, headers={"Accept": "application/json"})
                if r.status_code != 200:
                    continue
                data = r.json() or {}
                races = (((data.get("MRData") or {}).get("RaceTable") or {}).get("Races") or [])
                out.extend(races)
    except Exception as ex:
        logger.warning("Ergast F1 results fetch failed: %s", ex)
        return []
    return out


def _driver_finish_pos_from_race(race: dict, option_name: str) -> Optional[int]:
    target = _name_norm(option_name)
    if not target:
        return None
    for row in (race.get("Results") or []):
        drv = row.get("Driver") or {}
        name = "%s %s" % ((drv.get("givenName") or "").strip(), (drv.get("familyName") or "").strip())
        key = _name_norm(name)
        if not key:
            continue
        if key == target or key in target or target in key:
            try:
                return int(row.get("position") or 0)
            except Exception:
                return None
    return None


async def _auto_settle_fallback_f1_ergast() -> int:
    bet_event_ids = await _linkable_due_once_event_ids_with_open_bets()
    if not bet_event_ids:
        return 0
    has_f1 = await db.sports_events.find_one(
        {"status": "open", "id": {"$in": list(bet_event_ids)},
         "external_sport_key": "motor_racing_f1"},
        {"_id": 1},
    )
    if not has_f1:
        return 0
    races = await _fetch_ergast_f1_results_recent()
    if not races:
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor = db.sports_events.find(
        {
            "status": "open",
            "external_sport_key": "motor_racing_f1",
            "start_time": {"$lte": now_iso},
            "id": {"$in": list(bet_event_ids)},
        },
        {"_id": 0, "id": 1, "options": 1, "start_time": 1},
    ).limit(500)
    settled = 0
    async for ev in cursor:
        options = ev.get("options") or []
        if len(options) < 2:
            continue
        try:
            st = _event_datetime_utc(ev)
        except Exception:
            st = None
        if st is None:
            continue
        best_winning_id = None
        for race in races:
            rd = (race.get("date") or "").strip()
            if not rd:
                continue
            try:
                race_dt = datetime.fromisoformat(rd).replace(tzinfo=timezone.utc)
            except Exception:
                continue
            if abs((race_dt - st).total_seconds()) > 60 * 60 * 72:
                continue
            p0 = _driver_finish_pos_from_race(race, options[0].get("name") or "")
            p1 = _driver_finish_pos_from_race(race, options[1].get("name") or "")
            if p0 is None or p1 is None or p0 == p1:
                continue
            best_winning_id = options[0].get("id") if p0 < p1 else options[1].get("id")
            if best_winning_id:
                break
        if not best_winning_id:
            continue
        if await _settle_event_internal(ev.get("id") or "", best_winning_id):
            settled += 1
    return settled


def _event_duel_names_from_options(options: list) -> tuple[str, str]:
    names = [str((o or {}).get("name") or "").strip() for o in (options or [])]
    names = [n for n in names if n and not _is_draw_outcome_name(n)]
    if len(names) < 2:
        return ("", "")
    return (names[0], names[1])


def _event_name_query_candidates(name: str, team_a: str, team_b: str) -> list[str]:
    raw = (name or "").strip()
    candidates = []
    if raw:
        candidates.append(raw)
        if ":" in raw:
            right = raw.split(":", 1)[1].strip()
            if right:
                candidates.append(right)
    if team_a and team_b:
        candidates.append(f"{team_a} vs {team_b}")
        candidates.append(f"{team_b} vs {team_a}")
    # De-dupe while preserving order.
    seen = set()
    out = []
    for c in candidates:
        k = _name_norm(c)
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(c)
    return out[:5]


async def _thesportsdb_search_finished_events(query: str) -> list[dict]:
    q = (query or "").strip()
    if not q:
        return []
    try:
        async with httpx.AsyncClient(timeout=14.0) as client:
            r = await client.get(
                "https://www.thesportsdb.com/api/v1/json/123/searchevents.php",
                params={"e": q},
            )
        if r.status_code != 200:
            return []
        events = (r.json() or {}).get("event") or []
        out = []
        for e in events:
            status = ((e.get("strStatus") or "") + " " + (e.get("strPostponed") or "")).lower()
            # Keep only completed/finished outcomes.
            if not ("match finished" in status or "finished" in status or "ft" in status):
                continue
            ht = (e.get("strHomeTeam") or "").strip()
            at = (e.get("strAwayTeam") or "").strip()
            try:
                hs = int(e.get("intHomeScore"))
                as_ = int(e.get("intAwayScore"))
            except Exception:
                continue
            dt_raw = (e.get("dateEvent") or "").strip()
            if not ht or not at or not dt_raw:
                continue
            out.append({
                "home_team": ht,
                "away_team": at,
                "home_score": hs,
                "away_score": as_,
                "dateEvent": dt_raw,
                "strEvent": (e.get("strEvent") or "").strip(),
            })
        return out
    except Exception:
        return []


async def _auto_settle_fallback_thesportsdb_open_bets() -> int:
    """Fallback settle using TheSportsDB finished results for football/boxing-style 2-side events."""
    bet_event_ids = await _open_bet_due_once_event_ids()
    if not bet_event_ids:
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    has_fb = await db.sports_events.find_one(
        {"status": "open", "id": {"$in": list(bet_event_ids)},
         "start_time": {"$lte": now_iso},
         "category": {"$in": ["Football", "Boxing"]}},
        {"_id": 1},
    )
    if not has_fb:
        return 0
    cursor = db.sports_events.find(
        {
            "status": "open",
            "id": {"$in": list(bet_event_ids)},
            "start_time": {"$lte": now_iso},
            "category": {"$in": ["Football", "Boxing"]},
        },
        {"_id": 0, "id": 1, "name": 1, "category": 1, "options": 1, "start_time": 1},
    ).limit(1200)

    cache: dict[str, list[dict]] = {}
    settled = 0
    async for ev in cursor:
        st = _event_datetime_utc(ev)
        if st is None:
            continue
        team_a, team_b = _event_duel_names_from_options(ev.get("options") or [])
        if not team_a or not team_b:
            continue
        candidates = _event_name_query_candidates(ev.get("name") or "", team_a, team_b)
        winning_id = None
        for c in candidates:
            key = _name_norm(c)
            if key not in cache:
                cache[key] = await _thesportsdb_search_finished_events(c)
            for m in cache.get(key) or []:
                if not _looks_like_same_teams(ev.get("options") or [], m["home_team"], m["away_team"]):
                    continue
                try:
                    md = datetime.fromisoformat(str(m.get("dateEvent") or "")).replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                if abs((md - st).total_seconds()) > 60 * 60 * 72:
                    continue
                winning_id = _derive_winning_option_from_simple_score(
                    ev.get("options") or [],
                    m["home_team"],
                    m["away_team"],
                    int(m["home_score"]),
                    int(m["away_score"]),
                    True if (ev.get("category") or "") == "Football" else False,
                )
                if winning_id:
                    break
            if winning_id:
                break
        if not winning_id:
            continue
        if await _settle_event_internal(ev.get("id") or "", winning_id):
            settled += 1
    return settled


async def _auto_settle_from_scores() -> dict:
    """Poll Odds API scores, match to open events with external_event_id, settle and pay. Returns stats."""
    settled_count = 0
    skipped_no_match = 0
    skipped_no_winner = 0
    fallback_settled = 0
    due_open_event_ids = await _open_bet_due_once_event_ids()
    if not due_open_event_ids:
        return {
            "settled": 0,
            "skipped_no_match": 0,
            "skipped_no_winner": 0,
            "fallback_settled": 0,
            "message": "No due open-bet events to settle",
        }
    key = _odds_api_key()
    if not key:
        # Keep admin/cron/manual path useful even when Odds API key is absent.
        try:
            fallback_settled += await _auto_settle_fallback_football_data()
        except Exception as ex:
            logger.warning("Fallback auto-settle football-data failed (no Odds key): %s", ex)
        try:
            fallback_settled += await _auto_settle_fallback_f1_ergast()
        except Exception as ex:
            logger.warning("Fallback auto-settle F1 Ergast failed (no Odds key): %s", ex)
        try:
            fallback_settled += await _auto_settle_fallback_thesportsdb_open_bets()
        except Exception as ex:
            logger.warning("Fallback auto-settle TheSportsDB failed (no Odds key): %s", ex)
        try:
            await db.sports_events.update_many(
                {"id": {"$in": list(due_open_event_ids)}, "status": "open", "auto_settle_attempted_at": {"$exists": False}},
                {"$set": {"auto_settle_attempted_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception as ex:
            logger.warning("Auto-settle attempted marker update failed (no Odds key): %s", ex)
        return {"settled": fallback_settled, "skipped_no_match": 0, "skipped_no_winner": 0, "source": "fallback_only"}
    due_event_ids = await _linkable_due_once_event_ids_with_open_bets()
    # Collect only the sport keys that actually have due events with open bets.
    needed_sport_keys: set[str] = set()
    if due_event_ids:
        _nsk_cursor = db.sports_events.find(
            {**_LINKABLE_OPEN_EVENT_FILTER, "id": {"$in": list(due_event_ids)}},
            {"_id": 0, "external_sport_key": 1},
        ).limit(3000)
        async for _nsk_doc in _nsk_cursor:
            _sk = (_nsk_doc.get("external_sport_key") or "").strip()
            if _sk:
                needed_sport_keys.add(_sk)
    all_sport_keys: set[str] = set()
    for _ks in ODDS_API_SPORT_KEYS.values():
        all_sport_keys.update(_ks)
    sport_keys_used = set()
    for category, keys in ODDS_API_SPORT_KEYS.items():
        three_way = category == "Football"
        for sport_key in keys:
            if sport_key in sport_keys_used:
                continue
            if sport_key not in needed_sport_keys:
                continue
            sport_keys_used.add(sport_key)
            events = await _fetch_odds_api_scores(sport_key, days_from=3)
            for api_ev in events:
                if not api_ev.get("completed"):
                    continue
                ext_id = (api_ev.get("id") or "").strip()
                if not ext_id:
                    continue
                ev = await db.sports_events.find_one(
                    {
                        "external_event_id": ext_id,
                        "external_sport_key": sport_key,
                        "status": "open",
                        "id": {"$in": list(due_event_ids)},
                    },
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
    try:
        fallback_settled += await _auto_settle_fallback_football_data()
    except Exception as ex:
        logger.warning("Fallback auto-settle football-data failed: %s", ex)
    try:
        fallback_settled += await _auto_settle_fallback_f1_ergast()
    except Exception as ex:
        logger.warning("Fallback auto-settle F1 Ergast failed: %s", ex)
    try:
        fallback_settled += await _auto_settle_fallback_thesportsdb_open_bets()
    except Exception as ex:
        logger.warning("Fallback auto-settle TheSportsDB failed: %s", ex)
    # Mark all due events as attempted so each event is auto-processed only once.
    try:
        if due_open_event_ids:
            await db.sports_events.update_many(
                {"id": {"$in": list(due_open_event_ids)}, "status": "open", "auto_settle_attempted_at": {"$exists": False}},
                {"$set": {"auto_settle_attempted_at": datetime.now(timezone.utc).isoformat()}},
            )
    except Exception as ex:
        logger.warning("Auto-settle attempted marker update failed: %s", ex)
    return {
        "settled": settled_count + fallback_settled,
        "skipped_no_match": skipped_no_match,
        "skipped_no_winner": skipped_no_winner,
        "fallback_settled": fallback_settled,
        "sport_keys_queried": len(sport_keys_used),
        "sport_keys_skipped": len(all_sport_keys) - len(sport_keys_used),
    }


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
    football, ufc, boxing, f1_drivers, f1_odds_events = await asyncio.gather(
        _fetch_football_events(),
        _fetch_ufc_events(),
        _fetch_boxing_events(),
        _fetch_f1_drivers(),
        _fetch_odds_api_f1(),
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
    if f1_odds_events:
        f1_templates.extend(f1_odds_events)
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
    out: list = []
    for d in docs:
        st = d.get("start_time")
        if st and not _kickoff_still_upcoming_for_template_list(str(st)):
            continue
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


def _football_league_filter_options() -> list:
    """Every soccer league we fetch from Odds API — admin filter lists all, not only leagues with templates today."""
    return [{"key": k, "label": _soccer_league_display_name(k)} for k in SOCCER_LEAGUES]


def _admin_templates_json_from_list(templates: list, *, template_source: str) -> dict:
    categories = ["Football", "UFC", "Boxing", "Formula 1"]
    by_category = {c: [] for c in categories}
    for t in templates:
        cat = t.get("category")
        if not cat:
            continue
        st = t.get("start_time")
        if st and not _kickoff_still_upcoming_for_template_list(str(st)):
            continue
        by_category.setdefault(cat, []).append(_sports_template_to_response(t))
    return {
        "categories": categories,
        "templates": by_category,
        "odds_api_configured": bool(_odds_api_key()),
        "templates_total": len(templates),
        "template_source": template_source,
        "football_league_filter_options": _football_league_filter_options(),
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


def _sports_iso_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sports_event_effective_start_dt(ev: dict, now: Optional[datetime] = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    parsed = _parse_start_time_utc(ev.get("start_time"))
    return parsed if parsed is not None else now


def _sports_event_effective_betting_deadline(ev: dict, start_dt: datetime) -> datetime:
    custom_close = _parse_start_time_utc(ev.get("betting_closes_at"))
    if custom_close is not None:
        return custom_close
    return start_dt - timedelta(minutes=SPORTS_BETTING_CLOSE_BEFORE_START_MINUTES)


def _sports_event_betting_is_open(ev: dict, now: Optional[datetime] = None) -> bool:
    """True if players may place or cancel bets on this event (same window for both)."""
    now = now or datetime.now(timezone.utc)
    start_dt = _sports_event_effective_start_dt(ev, now)
    opens = _parse_start_time_utc(ev.get("betting_opens_at"))
    if opens is not None and now < opens:
        return False
    deadline = _sports_event_effective_betting_deadline(ev, start_dt)
    return now < deadline


def _sports_event_betting_block_reason(ev: dict) -> Optional[str]:
    """Human-readable reason when betting/cancellation is not allowed."""
    now = datetime.now(timezone.utc)
    start_dt = _sports_event_effective_start_dt(ev, now)
    opens = _parse_start_time_utc(ev.get("betting_opens_at"))
    if opens is not None and now < opens:
        return "Betting is not open yet for this event"
    deadline = _sports_event_effective_betting_deadline(ev, start_dt)
    if now >= deadline:
        return "Betting is closed for this event"
    return None


def _utc_day_start(now: Optional[datetime] = None) -> datetime:
    n = now or datetime.now(timezone.utc)
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    return n.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


async def _count_sports_event_requests_today(user_id: str) -> int:
    if not user_id:
        return 0
    day0 = _utc_day_start()
    day1 = day0 + timedelta(days=1)
    lo = day0.isoformat()
    hi = day1.isoformat()
    return await db.sports_event_requests.count_documents(
        {"user_id": user_id, "created_at": {"$gte": lo, "$lt": hi}},
    )


async def _open_board_template_ids() -> set:
    ids: set = set()
    cursor = db.sports_events.find(
        {"status": "open"},
        {"_id": 0, "source_template_id": 1, "external_event_id": 1, "external_sport_key": 1},
    )
    async for doc in cursor:
        stid = (doc.get("source_template_id") or "").strip()
        if stid:
            ids.add(stid)
            continue
        ex = (doc.get("external_event_id") or "").strip()
        sk = (doc.get("external_sport_key") or "").strip()
        if ex and sk:
            ids.add(_odds_template_id(sk, ex))
    return ids


async def _create_sports_board_event_from_template(template: dict) -> dict:
    """Insert sports_events from template; sets source_template_id. Returns inserted event doc."""
    now = datetime.now(timezone.utc)
    template_id_key = (template.get("id") or "").strip()
    if not template_id_key:
        raise HTTPException(status_code=400, detail="Template has no id")
    nm = (template.get("name") or "").strip()
    cat = (template.get("category") or "").strip()
    if not nm or not cat:
        raise HTTPException(status_code=400, detail="Template missing name or category")
    opts = template.get("options") or []
    if len(opts) < 2:
        raise HTTPException(status_code=400, detail="Template needs at least two options")
    start_time = template.get("start_time") or _parse_commence_time(template.get("commence_time"))
    if not start_time:
        start_time = (now + timedelta(hours=2)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    ev = {
        "id": str(uuid.uuid4()),
        "name": nm,
        "category": cat,
        "start_time": start_time,
        "options": [dict(o) for o in opts],
        "is_special": False,
        "status": "open",
        "source_template_id": template_id_key,
    }
    if template.get("external_event_id") and template.get("external_sport_key"):
        ev["external_event_id"] = template["external_event_id"]
        ev["external_sport_key"] = template["external_sport_key"]
    await db.sports_events.insert_one(ev)
    return ev


async def _notify_staff_sports_event_request(
    *,
    request_id: str,
    requester_username: str,
    template_id: str,
    template_name: str,
    template_category: str,
) -> None:
    title = "Sports book — event request"
    msg = (
        f"{requester_username or 'A player'} requested a game be added to the sports book.\n\n"
        f"Game: {template_name}\n"
        f"Category: {template_category}\n"
        f"Template id: {template_id}\n"
        f"Request id: {request_id}\n\n"
        "Open Casino → Sports betting → pending requests (admin) to approve or deny."
    )
    try:
        staff_ids = await _get_staff_user_ids()
        for staff_uid in staff_ids:
            try:
                await send_notification(staff_uid, title, msg, "staff_sports_event_request")
            except Exception as ex:
                logger.warning("sports event request staff notify %s: %s", staff_uid, ex)
    except Exception:
        logger.exception("notify_staff_sports_event_request failed")


# ----- Public routes -----
async def sports_betting_events(current_user: dict = Depends(get_current_user_verified)):
    await _sports_ensure_seed_events()
    now = datetime.now(timezone.utc)
    cursor = db.sports_events.find(
        {"status": "open"},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "category": 1,
            "start_time": 1,
            "options": 1,
            "is_special": 1,
            "external_sport_key": 1,
            "betting_opens_at": 1,
            "betting_closes_at": 1,
        },
    ).sort("start_time", 1)
    events = await cursor.to_list(SPORTS_BETTING_PUBLIC_EVENTS_LIMIT)
    result = []
    for e in events:
        st = e.get("start_time")
        try:
            start_dt = datetime.fromisoformat(st.replace("Z", "+00:00")) if st else now
        except Exception:
            start_dt = now
        if st and start_dt + timedelta(hours=3) < now:
            continue
        deadline_dt = _sports_event_effective_betting_deadline(e, start_dt)
        betting_open = _sports_event_betting_is_open(e, now)
        if now < start_dt:
            status = "upcoming"
        elif now < start_dt + timedelta(hours=3):
            status = "in_play"
        else:
            status = "finished"
        exk = (e.get("external_sport_key") or "").strip()
        league_label = None
        if (e.get("category") or "") == "Football" and exk:
            league_label = _soccer_league_display_name(exk)
        row = {
            "id": e["id"],
            "name": e.get("name", "?"),
            "category": e.get("category", "—"),
            "start_time": st,
            "options": e.get("options") or [],
            "is_special": bool(e.get("is_special")),
            "betting_open": betting_open,
            "status": status,
            "betting_deadline_at": _sports_iso_z(deadline_dt),
            "betting_opens_at": e.get("betting_opens_at") or None,
            "betting_closes_at": e.get("betting_closes_at") or None,
        }
        if league_label:
            row["league_label"] = league_label
        result.append(row)

    event_ids = [r["id"] for r in result]
    stake_by_event_option: dict = {}
    event_pool: dict = {}
    if event_ids:
        stake_rows = await db.sports_bets.aggregate(
            [
                {"$match": {"status": "open", "event_id": {"$in": event_ids}}},
                {
                    "$group": {
                        "_id": {"e": "$event_id", "o": "$option_id"},
                        "total": {"$sum": "$stake"},
                    }
                },
            ]
        ).to_list(len(event_ids) * 32)
        for sr in stake_rows:
            kid = sr.get("_id") or {}
            eid = kid.get("e")
            oid = kid.get("o")
            if not eid or not oid:
                continue
            amt = int(sr.get("total") or 0)
            stake_by_event_option[(eid, oid)] = amt
            event_pool[eid] = event_pool.get(eid, 0) + amt

    for row in result:
        eid = row["id"]
        pool = int(event_pool.get(eid, 0))
        enriched_opts = []
        for o in row.get("options") or []:
            oid = o.get("id")
            amt = int(stake_by_event_option.get((eid, oid), 0)) if oid else 0
            pct = round((100.0 * amt / pool), 1) if pool > 0 else 0.0
            od = dict(o)
            od["open_stake_total"] = amt
            od["open_stake_pct"] = pct
            enriched_opts.append(od)
        row["options"] = enriched_opts
        row["open_pool_total"] = pool

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
    reason = _sports_event_betting_block_reason(ev)
    if reason:
        raise HTTPException(status_code=400, detail=reason)
    opt = next((o for o in (ev.get("options") or []) if o.get("id") == option_id), None)
    if not opt:
        raise HTTPException(status_code=400, detail="Invalid option")
    uid = current_user.get("id") or ""
    open_total = await _sports_open_stake_total(uid)
    max_open = await get_sports_bet_max_total_open_stake()
    if open_total + stake > max_open:
        remaining = max(0, max_open - open_total)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Total open sports stakes are capped at ${max_open:,}. "
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
    max_open = await get_sports_bet_max_total_open_stake()
    remaining = max(0, max_open - open_stake_total)
    return {
        "open": [{"id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "odds": b.get("odds"), "stake": b.get("stake"), "created_at": b.get("created_at")} for b in open_bets],
        "closed": [{"id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "odds": b.get("odds"), "stake": b.get("stake"), "status": b.get("status"), "created_at": b.get("created_at"), "settled_at": b.get("settled_at")} for b in closed_bets],
        "max_total_open_stake": max_open,
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
    ev = await db.sports_events.find_one(
        {"id": bet.get("event_id") or ""},
        {"_id": 0, "start_time": 1, "betting_opens_at": 1, "betting_closes_at": 1},
    )
    if ev is not None:
        r = _sports_event_betting_block_reason(ev)
        if r:
            raise HTTPException(status_code=400, detail=r)
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
        ev_cursor = db.sports_events.find(
            {"id": {"$in": eids}},
            {"_id": 0, "id": 1, "start_time": 1, "betting_opens_at": 1, "betting_closes_at": 1},
        )
        for doc in await ev_cursor.to_list(len(eids)):
            events_by_id[doc["id"]] = doc
    total_refund = 0
    cancelled_count = 0
    skipped_count = 0
    now = datetime.now(timezone.utc).isoformat()
    for b in bets:
        ev = events_by_id.get(b.get("event_id") or "")
        if ev is not None and _sports_event_betting_block_reason(ev):
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
        msg = f"No bets cancelled — {skipped_count} open bet(s) past the betting window for their event(s)."
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
    """All-time book stats excluding admin/mod bets; aggregate player P/L on settled won/lost."""
    staff_ids = await _get_staff_user_ids()
    base_match = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
    total_bets_all_time = await db.sports_bets.count_documents(base_match)
    won_stake = await db.sports_bets.aggregate([
        {"$match": {**base_match, "status": "won"}},
        {"$group": {"_id": None, "sum": {"$sum": {"$multiply": ["$stake", "$odds"]}}}},
    ]).to_list(1)
    lost_stake = await db.sports_bets.aggregate([
        {"$match": {**base_match, "status": "lost"}},
        {"$group": {"_id": None, "sum": {"$sum": "$stake"}}},
    ]).to_list(1)
    winnings = int((won_stake[0].get("sum", 0) or 0)) if won_stake else 0
    losses = int((lost_stake[0].get("sum", 0) or 0)) if lost_stake else 0
    aggregate_player_profit_loss = winnings - losses
    settled_bets_count = await db.sports_bets.count_documents({**base_match, "status": {"$in": ["won", "lost"]}})
    open_agg = await db.sports_bets.aggregate([
        {"$match": {**base_match, "status": "open"}},
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


async def sports_template_library(current_user: dict = Depends(get_current_user_verified)):
    """Public: DB-backed template list (same shape as admin templates) + which template ids are already on the open board."""
    db_list = await _load_sports_templates_from_db()
    on_board = await _open_board_template_ids()
    payload = _admin_templates_json_from_list(db_list, template_source="database")
    payload["on_board_template_ids"] = sorted(on_board)
    payload["requests_per_day_limit"] = SPORTS_EVENT_REQUESTS_PER_DAY
    return payload


async def sports_my_event_requests(current_user: dict = Depends(get_current_user_verified)):
    uid = current_user.get("id") or ""
    used = await _count_sports_event_requests_today(uid)
    limit_n = SPORTS_EVENT_REQUESTS_PER_DAY
    req_cur = db.sports_event_requests.find(
        {"user_id": uid},
        {"_id": 0, "id": 1, "template_id": 1, "template_name": 1, "template_category": 1, "status": 1, "created_at": 1, "deny_reason": 1},
    ).sort("created_at", -1).limit(25)
    recent = await req_cur.to_list(25)
    return {
        "used_today": used,
        "limit": limit_n,
        "remaining": max(0, limit_n - used),
        "recent_requests": recent,
    }


async def sports_request_event(body: SportsRequestEventBody, current_user: dict = Depends(get_current_user_verified)):
    template_id = (body.template_id or "").strip()
    if not template_id:
        raise HTTPException(status_code=400, detail="template_id required")
    uid = current_user.get("id") or ""
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    db_list = await _load_sports_templates_from_db()
    template = next((t for t in db_list if (t.get("id") or "").strip() == template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Game not found in the saved library — it may have expired from the list")
    now_dt = datetime.now(timezone.utc)
    start_iso = template.get("start_time") or _parse_commence_time(template.get("commence_time"))
    start_dt = _parse_start_time_utc(start_iso)
    if start_dt is None:
        raise HTTPException(status_code=400, detail="This game is missing a valid start time and cannot be requested")
    if start_dt <= now_dt:
        raise HTTPException(status_code=400, detail="This game has already started and cannot be requested")
    max_allowed = now_dt + timedelta(hours=SPORTS_EVENT_REQUEST_MAX_HOURS_AHEAD)
    if start_dt > max_allowed:
        raise HTTPException(
            status_code=400,
            detail=f"You can only request games starting within the next {SPORTS_EVENT_REQUEST_MAX_HOURS_AHEAD} hours.",
        )
    on_board = await _open_board_template_ids()
    if template_id in on_board:
        raise HTTPException(status_code=400, detail="This game is already on the board")
    used = await _count_sports_event_requests_today(uid)
    if used >= SPORTS_EVENT_REQUESTS_PER_DAY:
        raise HTTPException(
            status_code=400,
            detail=f"You can submit up to {SPORTS_EVENT_REQUESTS_PER_DAY} game requests per UTC day. Try again after midnight UTC.",
        )
    dup = await db.sports_event_requests.find_one(
        {"user_id": uid, "template_id": template_id, "status": "pending"},
        {"_id": 0, "id": 1},
    )
    if dup:
        raise HTTPException(status_code=400, detail="You already have a pending request for this game")
    now = datetime.now(timezone.utc).isoformat()
    rid = str(uuid.uuid4())
    uname = (current_user.get("username") or "").strip() or "?"
    tname = (template.get("name") or "?").strip()
    tcat = (template.get("category") or "?").strip()
    doc = {
        "id": rid,
        "user_id": uid,
        "username": uname,
        "template_id": template_id,
        "template_name": tname,
        "template_category": tcat,
        "status": "pending",
        "created_at": now,
    }
    await db.sports_event_requests.insert_one(doc)
    await _notify_staff_sports_event_request(
        request_id=rid,
        requester_username=uname,
        template_id=template_id,
        template_name=tname,
        template_category=tcat,
    )
    new_used = used + 1
    return {
        "message": "Request submitted — staff will review it.",
        "request_id": rid,
        "used_today": new_used,
        "remaining": max(0, SPORTS_EVENT_REQUESTS_PER_DAY - new_used),
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
    payload = await _admin_sports_templates_payload(templates_persisted=n)
    if _env_flag("SPORTS_AUTO_SETTLE_ON_REFRESH"):
        try:
            payload["auto_settle"] = await _auto_settle_from_scores()
        except Exception as ex:
            logger.warning("SPORTS_AUTO_SETTLE_ON_REFRESH: auto-settle failed: %s", ex)
            payload["auto_settle"] = {"settled": 0, "error": str(ex)}
    return payload


async def admin_sports_auto_settle_run(current_user: dict = Depends(get_current_user_verified)):
    """Admin: run the same Odds API score poll as cron; returns settled / skipped counts."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    return await _auto_settle_from_scores()


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
    ev = await _create_sports_board_event_from_template(template)
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
    start_raw = (request.start_time or "").strip()
    if start_raw:
        start_dt = _parse_start_time_utc(start_raw)
        if start_dt is None:
            raise HTTPException(status_code=400, detail="Invalid start_time (use ISO-8601)")
        start_time = _sports_iso_z(start_dt)
    else:
        start_time = _sports_iso_z(now + timedelta(hours=2))

    betting_opens_raw = (request.betting_opens_at or "").strip()
    betting_closes_raw = (request.betting_closes_at or "").strip()
    betting_opens_at = None
    betting_closes_at = None
    if betting_opens_raw:
        bo = _parse_start_time_utc(betting_opens_raw)
        if bo is None:
            raise HTTPException(status_code=400, detail="Invalid betting_opens_at (use ISO-8601)")
        betting_opens_at = _sports_iso_z(bo)
    if betting_closes_raw:
        bc = _parse_start_time_utc(betting_closes_raw)
        if bc is None:
            raise HTTPException(status_code=400, detail="Invalid betting_closes_at (use ISO-8601)")
        betting_closes_at = _sports_iso_z(bc)
    if betting_opens_at and betting_closes_at:
        if _parse_start_time_utc(betting_opens_at) >= _parse_start_time_utc(betting_closes_at):
            raise HTTPException(status_code=400, detail="betting_opens_at must be before betting_closes_at")

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
    if betting_opens_at:
        ev["betting_opens_at"] = betting_opens_at
    if betting_closes_at:
        ev["betting_closes_at"] = betting_closes_at
    await db.sports_events.insert_one(ev)
    return {"message": f"Added custom event: {name}", "event_id": ev["id"]}


async def admin_sports_patch_event_betting_window(
    request: AdminPatchSportsEventBettingWindow,
    current_user: dict = Depends(get_current_user_verified),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    event_id = (request.event_id or "").strip()
    if not event_id:
        raise HTTPException(status_code=400, detail="event_id required")
    ev = await db.sports_events.find_one({"id": event_id, "status": "open"}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found or not open")

    payload = request.model_dump(exclude_unset=True)
    set_doc: dict = {}
    unset_doc: dict = {}

    if "betting_opens_at" in payload:
        v = payload["betting_opens_at"]
        if v is None or (isinstance(v, str) and not v.strip()):
            unset_doc["betting_opens_at"] = ""
        else:
            bo = _parse_start_time_utc(str(v).strip())
            if bo is None:
                raise HTTPException(status_code=400, detail="Invalid betting_opens_at")
            set_doc["betting_opens_at"] = _sports_iso_z(bo)

    if "betting_closes_at" in payload:
        v = payload["betting_closes_at"]
        if v is None or (isinstance(v, str) and not v.strip()):
            unset_doc["betting_closes_at"] = ""
        else:
            bc = _parse_start_time_utc(str(v).strip())
            if bc is None:
                raise HTTPException(status_code=400, detail="Invalid betting_closes_at")
            set_doc["betting_closes_at"] = _sports_iso_z(bc)

    merged = {**ev, **set_doc}
    for k in unset_doc:
        merged.pop(k, None)

    bo_m = _parse_start_time_utc(merged.get("betting_opens_at"))
    bc_m = _parse_start_time_utc(merged.get("betting_closes_at"))
    if bo_m is not None and bc_m is not None and bo_m >= bc_m:
        raise HTTPException(status_code=400, detail="betting_opens_at must be before betting_closes_at")

    if not set_doc and not unset_doc:
        raise HTTPException(status_code=400, detail="No fields to update")

    upd: dict = {}
    if set_doc:
        upd["$set"] = set_doc
    if unset_doc:
        upd["$unset"] = unset_doc
    await db.sports_events.update_one({"id": event_id}, upd)
    return {"message": "Betting window updated", "event_id": event_id}


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
        stake = int(bet_claim.get("stake") or 0)
        odds = float(bet_claim.get("odds") or 1)
        payout = int(stake * odds) if won else 0
        to_swiss = _sports_payout_to_swiss()
        log_payload = {
            "bet_id": bet_claim["id"],
            "event_name": bet_claim.get("event_name"),
            "option_name": bet_claim.get("option_name"),
            "stake": stake,
            "odds": odds,
            "status": new_status,
            "settled_at": now,
        }
        if won:
            log_payload["payout"] = payout
            log_payload["payout_destination"] = "swiss" if to_swiss else "money"
        await log_gambling(bet_claim["user_id"], u.get("username") if u else "?", "sports_bet", log_payload)
        if won:
            current_streak = int((u or {}).get("sports_current_win_streak", 0)) + 1
            best_streak = max(current_streak, int((u or {}).get("sports_best_win_streak", 0)))
            update_fields = {"sports_current_win_streak": current_streak, "sports_best_win_streak": best_streak}
            if payout > 0:
                inc_field = "swiss_balance" if to_swiss else "money"
                await db.users.update_one({"id": bet_claim["user_id"]}, {"$inc": {inc_field: payout}, "$set": update_fields})
            else:
                await db.users.update_one({"id": bet_claim["user_id"]}, {"$set": update_fields})
        else:
            await db.users.update_one({"id": bet_claim["user_id"]}, {"$set": {"sports_current_win_streak": 0}})

        ev_nm = (bet_claim.get("event_name") or "Sports event").strip() or "Sports event"
        pick_nm = (bet_claim.get("option_name") or "your pick").strip() or "your pick"
        uid = bet_claim["user_id"]
        if won:
            dest = "your Swiss bank" if to_swiss else "cash on hand"
            win_msg = (
                f"Your pick ({pick_nm}) won on \"{ev_nm}\". "
                f"Payout ${payout:,} added to {dest} (stake ${stake:,} at {odds:g}×)."
            )
            await send_notification(uid, "Sports bet won", win_msg, "reward")
        else:
            lose_msg = f"Your pick ({pick_nm}) lost on \"{ev_nm}\". Stake ${stake:,} was not returned."
            await send_notification(uid, "Sports bet lost", lose_msg, "system")

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
    refunded_count, total_refunded = await _cancel_open_bets_for_event(
        event_id=event_id,
        now_iso=now,
        cancel_event=True,
        cancel_reason="admin_cancel_event",
    )
    return {
        "message": f"Event cancelled. {refunded_count} bet(s) refunded (${total_refunded:,} total).",
        "refunded_count": refunded_count,
        "total_refunded": total_refunded,
    }


async def _cancel_open_bets_for_event(
    event_id: str,
    now_iso: str,
    cancel_event: bool = False,
    cancel_reason: Optional[str] = None,
) -> tuple[int, int]:
    if cancel_event:
        ev = await db.sports_events.find_one_and_update(
            {"id": event_id, "status": "open"},
            {"$set": {"status": "cancelled", "cancelled_at": now_iso, "cancel_reason": cancel_reason or "cancelled"}},
        )
        if not ev:
            return (0, 0)
    cursor = db.sports_bets.find(
        {"event_id": event_id, "status": "open"},
        {"_id": 0, "id": 1, "user_id": 1, "stake": 1, "event_name": 1},
    )
    refunded_count = 0
    total_refunded = 0
    for b in await cursor.to_list(1000):
        bet_claim = await db.sports_bets.find_one_and_update(
            {"id": b["id"], "status": "open"},
            {"$set": {"status": "cancelled", "settled_at": now_iso, "cancel_reason": cancel_reason or "cancelled"}},
        )
        if not bet_claim:
            continue
        stake = int(bet_claim.get("stake") or 0)
        if stake > 0:
            await db.users.update_one({"id": bet_claim["user_id"]}, {"$inc": {"money": stake}})
        try:
            u = await db.users.find_one({"id": bet_claim["user_id"]}, {"_id": 0, "username": 1})
            await log_gambling(
                bet_claim["user_id"],
                (u or {}).get("username") or "?",
                "sports_bet",
                {
                    "bet_id": bet_claim["id"],
                    "event_name": bet_claim.get("event_name"),
                    "stake": stake,
                    "status": "cancelled",
                    "settled_at": now_iso,
                    "cancel_reason": cancel_reason or "cancelled",
                    "refund": stake,
                },
            )
            await send_notification(
                bet_claim["user_id"],
                "Sports bet refunded",
                f"Your open bet on \"{(bet_claim.get('event_name') or 'Sports event').strip() or 'Sports event'}\" was cancelled and refunded (${stake:,}).",
                "system",
            )
        except Exception:
            pass
        refunded_count += 1
        total_refunded += stake
    return (refunded_count, total_refunded)


async def admin_sports_cancel_stale_open_bets(
    hours: int = Query(72, ge=1, le=24 * 30),
    limit_events: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user_verified),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    cutoff_iso = (now_dt - timedelta(hours=int(hours))).isoformat()

    open_bet_rows = await db.sports_bets.aggregate([
        {"$match": {"status": "open", "event_id": {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {"_id": "$event_id", "open_bets": {"$sum": 1}}},
    ]).to_list(5000)
    event_ids = [str(r.get("_id") or "") for r in open_bet_rows if r.get("_id")]
    if not event_ids:
        return {
            "message": "No open bets found.",
            "hours": int(hours),
            "events_cancelled": 0,
            "bets_refunded": 0,
            "total_refunded": 0,
        }

    cursor = db.sports_events.find(
        {
            "id": {"$in": event_ids},
            "status": "open",
            "start_time": {"$lte": cutoff_iso},
        },
        {"_id": 0, "id": 1, "name": 1, "start_time": 1},
    ).sort("start_time", 1).limit(int(limit_events))
    stale_events = await cursor.to_list(int(limit_events))
    if not stale_events:
        return {
            "message": f"No unresolved open-bet events older than {int(hours)}h.",
            "hours": int(hours),
            "events_cancelled": 0,
            "bets_refunded": 0,
            "total_refunded": 0,
        }

    events_cancelled = 0
    bets_refunded = 0
    total_refunded = 0
    for ev in stale_events:
        eid = str(ev.get("id") or "")
        if not eid:
            continue
        rc, total = await _cancel_open_bets_for_event(
            event_id=eid,
            now_iso=now_iso,
            cancel_event=True,
            cancel_reason=f"stale_unresolved_{int(hours)}h",
        )
        if rc > 0:
            events_cancelled += 1
            bets_refunded += rc
            total_refunded += total

    return {
        "message": f"Cancelled {events_cancelled} stale event(s) and refunded {bets_refunded} bet(s) (${total_refunded:,}).",
        "hours": int(hours),
        "events_cancelled": events_cancelled,
        "bets_refunded": bets_refunded,
        "total_refunded": total_refunded,
    }


async def admin_sports_bets_list(
    limit: int = Query(200, ge=1, le=500),
    username: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    event_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user_verified),
):
    """Admin or moderator: ledger of sports bets (who bet what, from sports_bets)."""
    if not _is_admin(current_user) and not _is_moderator(current_user):
        raise HTTPException(status_code=403, detail="Admin or moderator access required")
    limit = min(max(1, int(limit)), 500)
    query: dict = {}
    if status and status.strip():
        s = status.strip().lower()
        if s not in ("open", "won", "lost", "cancelled"):
            raise HTTPException(status_code=400, detail="status must be open, won, lost, or cancelled")
        query["status"] = s
    if event_id and event_id.strip():
        query["event_id"] = event_id.strip()
    if username and username.strip():
        uname_pattern = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE)
        urow = await db.users.find_one({"username": uname_pattern}, {"_id": 0, "id": 1})
        if not urow:
            return {"bets": [], "count": 0}
        query["user_id"] = urow["id"]
    cursor = db.sports_bets.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    bets = await cursor.to_list(limit)
    uids = list({b.get("user_id") for b in bets if b.get("user_id")})
    users_by_id: dict = {}
    if uids:
        udocs = await db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "username": 1}).to_list(len(uids))
        for doc in udocs:
            users_by_id[doc["id"]] = doc.get("username") or "?"
    out = []
    for b in bets:
        stake = int(b.get("stake") or 0)
        odds = float(b.get("odds") or 1)
        st = b.get("status")
        payout = int(stake * odds) if st == "won" else None
        out.append({
            "id": b.get("id"),
            "user_id": b.get("user_id"),
            "username": users_by_id.get(b.get("user_id"), "?"),
            "event_id": b.get("event_id"),
            "event_name": b.get("event_name"),
            "option_id": b.get("option_id"),
            "option_name": b.get("option_name"),
            "odds": odds,
            "stake": stake,
            "status": st,
            "payout_if_won": payout,
            "created_at": b.get("created_at"),
            "settled_at": b.get("settled_at"),
        })
    return {"bets": out, "count": len(out)}


async def admin_sports_unsettled_events(
    limit: int = Query(200, ge=1, le=1000),
    include_no_open_bets: bool = Query(False),
    current_user: dict = Depends(get_current_user_verified),
):
    """Admin/moderator: old open events that look overdue for settlement."""
    if not _is_admin(current_user) and not _is_moderator(current_user):
        raise HTTPException(status_code=403, detail="Admin or moderator access required")
    limit = min(max(1, int(limit)), 1000)
    now_iso = datetime.now(timezone.utc).isoformat()
    query: dict = {"status": "open", "start_time": {"$lt": now_iso}}
    cursor = db.sports_events.find(
        query,
        {"_id": 0, "id": 1, "name": 1, "category": 1, "start_time": 1, "created_at": 1, "external_event_id": 1, "external_sport_key": 1, "options": 1},
    ).sort("start_time", 1).limit(limit)
    events = await cursor.to_list(limit)
    if not events:
        return {"events": [], "count": 0}

    event_ids = [e.get("id") for e in events if e.get("id")]
    open_counts: dict = {}
    if event_ids:
        pipeline = [
            {"$match": {"event_id": {"$in": event_ids}, "status": "open"}},
            {"$group": {"_id": "$event_id", "open_bets": {"$sum": 1}, "open_stake_total": {"$sum": {"$toInt": "$stake"}}}},
        ]
        rows = await db.sports_bets.aggregate(pipeline).to_list(len(event_ids))
        for row in rows:
            eid = row.get("_id")
            if eid:
                open_counts[eid] = {
                    "open_bets": int(row.get("open_bets") or 0),
                    "open_stake_total": int(row.get("open_stake_total") or 0),
                }

    out = []
    for ev in events:
        eid = ev.get("id") or ""
        cnt = open_counts.get(eid, {"open_bets": 0, "open_stake_total": 0})
        if not include_no_open_bets and cnt["open_bets"] <= 0:
            continue
        out.append({
            "id": eid,
            "name": ev.get("name"),
            "category": ev.get("category"),
            "start_time": ev.get("start_time"),
            "created_at": ev.get("created_at"),
            "external_event_id": ev.get("external_event_id"),
            "external_sport_key": ev.get("external_sport_key"),
            "open_bets": cnt["open_bets"],
            "open_stake_total": cnt["open_stake_total"],
            "options": [
                {"id": o.get("id"), "name": o.get("name")}
                for o in (ev.get("options") or [])
                if o.get("id") and o.get("name")
            ],
        })
    return {"events": out, "count": len(out)}


async def admin_sports_auto_settle_health(current_user: dict = Depends(get_current_user_verified)):
    """Admin/moderator: quick diagnostics for why auto-settle may appear stuck."""
    if not _is_admin(current_user) and not _is_moderator(current_user):
        raise HTTPException(status_code=403, detail="Admin or moderator access required")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    delay_minutes = _sports_auto_settle_minutes_after_start()
    delay = timedelta(minutes=delay_minutes)
    ticker_use_cron = (os.environ.get("SPORTS_AUTO_SETTLE_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    ticker_raw = (os.environ.get("SPORTS_AUTO_SETTLE_TICKER") or "").strip().lower()
    ticker_enabled = ticker_raw not in ("0", "false", "no", "off")
    odds_key_present = bool(_odds_api_key())

    linkable_open = await db.sports_events.count_documents(_LINKABLE_OPEN_EVENT_FILTER)

    overdue_linkable = 0
    cur = db.sports_events.find(_LINKABLE_OPEN_EVENT_FILTER, {"_id": 0, "start_time": 1}).limit(2000)
    async for doc in cur:
        st = _parse_start_time_utc(doc.get("start_time"))
        if st is None or now >= (st + delay):
            overdue_linkable += 1

    stale_open_filter = {"status": "open", "start_time": {"$lt": now_iso}}
    stale_open_events_total = await db.sports_events.count_documents(stale_open_filter)
    stale_non_linkable_events = await db.sports_events.count_documents({
        **stale_open_filter,
        "$or": [
            {"external_event_id": {"$in": [None, ""]}},
            {"external_event_id": {"$exists": False}},
            {"external_sport_key": {"$in": [None, ""]}},
            {"external_sport_key": {"$exists": False}},
        ],
    })

    stale_with_open_bets_rows = await db.sports_bets.aggregate([
        {"$match": {"status": "open"}},
        {"$group": {"_id": "$event_id", "open_bets": {"$sum": 1}}},
    ]).to_list(5000)
    open_bets_by_event = {str(r.get("_id") or ""): int(r.get("open_bets") or 0) for r in stale_with_open_bets_rows if r.get("_id")}

    stale_non_linkable_with_open_bets = 0
    stale_non_linkable_open_bets_total = 0
    stale_cursor = db.sports_events.find(
        {
            **stale_open_filter,
            "$or": [
                {"external_event_id": {"$in": [None, ""]}},
                {"external_event_id": {"$exists": False}},
                {"external_sport_key": {"$in": [None, ""]}},
                {"external_sport_key": {"$exists": False}},
            ],
        },
        {"_id": 0, "id": 1},
    ).limit(3000)
    async for ev in stale_cursor:
        eid = str(ev.get("id") or "")
        c = int(open_bets_by_event.get(eid, 0))
        if c > 0:
            stale_non_linkable_with_open_bets += 1
            stale_non_linkable_open_bets_total += c

    return {
        "odds_api_key_present": odds_key_present,
        "ticker_enabled": ticker_enabled,
        "ticker_use_cron": ticker_use_cron,
        "minutes_after_start": delay_minutes,
        "linkable_open_events": linkable_open,
        "overdue_linkable_events": overdue_linkable,
        "stale_open_events_total": stale_open_events_total,
        "stale_non_linkable_events": stale_non_linkable_events,
        "stale_non_linkable_with_open_bets": stale_non_linkable_with_open_bets,
        "stale_non_linkable_open_bets_total": stale_non_linkable_open_bets_total,
        "note": "Only events with external_event_id + external_sport_key are auto-settled.",
    }


async def admin_sports_event_requests_list(current_user: dict = Depends(get_current_user_verified)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    cur = db.sports_event_requests.find({"status": "pending"}, {"_id": 0}).sort("created_at", 1).limit(200)
    rows = await cur.to_list(200)
    return {"requests": rows, "count": len(rows)}


async def admin_sports_event_request_approve(
    body: AdminSportsEventRequestApprove,
    current_user: dict = Depends(get_current_user_verified),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    rid = (body.request_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="request_id required")
    req = await db.sports_event_requests.find_one({"id": rid, "status": "pending"}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found or already resolved")
    tid = (req.get("template_id") or "").strip()
    merged = await _merged_sports_templates_for_admin()
    template = next((t for t in merged if (t.get("id") or "").strip() == tid), None)
    if not template:
        raise HTTPException(
            status_code=400,
            detail="Template is no longer available — refresh Odds data or deny this request",
        )
    on_board = await _open_board_template_ids()
    now_iso = datetime.now(timezone.utc).isoformat()
    admin_id = current_user.get("id") or ""
    if tid in on_board:
        await db.sports_event_requests.update_one(
            {"id": rid},
            {"$set": {"status": "approved", "resolved_at": now_iso, "resolved_by": admin_id, "board_event_id": None}},
        )
        uid = req.get("user_id") or ""
        if uid:
            await send_notification(
                uid,
                "Sports book request",
                f"Your request for \"{req.get('template_name') or 'a game'}\" was marked approved — it was already on the board.",
                "system",
            )
        return {"message": "Request closed — game was already on the board", "event_id": None}
    ev = await _create_sports_board_event_from_template(template)
    await db.sports_event_requests.update_one(
        {"id": rid},
        {"$set": {"status": "approved", "resolved_at": now_iso, "resolved_by": admin_id, "board_event_id": ev["id"]}},
    )
    uid = req.get("user_id") or ""
    if uid:
        await send_notification(
            uid,
            "Sports book request approved",
            f"Your requested game \"{template.get('name')}\" was added to the board. You can place bets under Events.",
            "system",
        )
    return {"message": "Event added from request", "event_id": ev["id"]}


async def admin_sports_event_request_deny(
    body: AdminSportsEventRequestDeny,
    current_user: dict = Depends(get_current_user_verified),
):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    rid = (body.request_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="request_id required")
    reason = (body.reason or "").strip()[:500]
    req = await db.sports_event_requests.find_one({"id": rid, "status": "pending"}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found or already resolved")
    now_iso = datetime.now(timezone.utc).isoformat()
    admin_id = current_user.get("id") or ""
    await db.sports_event_requests.update_one(
        {"id": rid},
        {"$set": {"status": "denied", "resolved_at": now_iso, "resolved_by": admin_id, "deny_reason": reason or None}},
    )
    uid = req.get("user_id") or ""
    if uid:
        nm = req.get("template_name") or "the game"
        msg = f"Your request to add \"{nm}\" to the sports book was denied."
        if reason:
            msg += f"\n\nReason: {reason}"
        await send_notification(uid, "Sports book request denied", msg, "system")
    return {"message": "Request denied"}


# ----- In-process auto-settle ticker (time-gated; optional via SPORTS_AUTO_SETTLE_TICKER) -----
def _sports_auto_settle_minutes_after_start() -> int:
    try:
        v = int(os.environ.get("SPORTS_AUTO_SETTLE_MINUTES_AFTER_START", "122"))
        return max(1, min(v, 600))
    except ValueError:
        return 122


def _sports_auto_settle_ticker_idle_sec() -> int:
    try:
        return max(60, int(os.environ.get("SPORTS_AUTO_SETTLE_TICKER_IDLE_SEC", "600")))
    except ValueError:
        return 600


def _sports_auto_settle_ticker_poll_interval_sec() -> int:
    try:
        return max(30, int(os.environ.get("SPORTS_AUTO_SETTLE_TICKER_POLL_INTERVAL_SEC", "180")))
    except ValueError:
        return 180


def _sports_auto_settle_ticker_wait_cap_sec() -> int:
    try:
        return max(60, int(os.environ.get("SPORTS_AUTO_SETTLE_TICKER_WAIT_CAP_SEC", "900")))
    except ValueError:
        return 900


def _parse_start_time_utc(iso_s) -> Optional[datetime]:
    if not iso_s:
        return None
    try:
        dt = datetime.fromisoformat(str(iso_s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


_LINKABLE_OPEN_EVENT_FILTER = {
    "status": "open",
    "external_event_id": {"$exists": True, "$nin": [None, ""]},
    "external_sport_key": {"$exists": True, "$nin": [None, ""]},
}


async def _linkable_open_event_ids_with_open_bets() -> set[str]:
    rows = await db.sports_bets.aggregate([
        {"$match": {"status": "open", "event_id": {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {"_id": "$event_id"}},
    ]).to_list(5000)
    return {str(r.get("_id") or "") for r in rows if r.get("_id")}


async def _open_bet_due_once_event_ids() -> set[str]:
    """Open events with open bets that reached delay and have not been auto-attempted yet."""
    bet_event_ids = await _linkable_open_event_ids_with_open_bets()
    if not bet_event_ids:
        return set()
    now = datetime.now(timezone.utc)
    delay = timedelta(minutes=_sports_auto_settle_minutes_after_start())
    cursor = db.sports_events.find(
        {
            "status": "open",
            "id": {"$in": list(bet_event_ids)},
            "auto_settle_attempted_at": {"$exists": False},
        },
        {"_id": 0, "id": 1, "start_time": 1},
    ).limit(3000)
    out: set[str] = set()
    async for doc in cursor:
        eid = str(doc.get("id") or "")
        if not eid:
            continue
        st = _parse_start_time_utc(doc.get("start_time"))
        if st is None or now >= st + delay:
            out.add(eid)
    return out


async def _linkable_due_once_event_ids_with_open_bets() -> set[str]:
    """Open Odds-linked events with open bets that are due for their one auto-settle attempt."""
    bet_event_ids = await _open_bet_due_once_event_ids()
    if not bet_event_ids:
        return set()
    cursor = db.sports_events.find(
        {
            **_LINKABLE_OPEN_EVENT_FILTER,
            "id": {"$in": list(bet_event_ids)},
        },
        {"_id": 0, "id": 1},
    ).limit(2000)
    out: set[str] = set()
    async for doc in cursor:
        eid = str(doc.get("id") or "")
        if not eid:
            continue
        out.add(eid)
    return out


async def any_linkable_open_event_past_settle_delay() -> bool:
    """True if any open Odds-linked event is due for its one auto-settle attempt."""
    due_ids = await _linkable_due_once_event_ids_with_open_bets()
    return len(due_ids) > 0


async def _seconds_until_next_linkable_eligible_or_cap() -> float:
    """
    Seconds to sleep before at least one linkable event is past kickoff + delay.
    0.0 if already eligible. Capped (default 15m) so we re-query periodically for long waits.
    """
    now = datetime.now(timezone.utc)
    delay = timedelta(minutes=_sports_auto_settle_minutes_after_start())
    cap = float(_sports_auto_settle_ticker_wait_cap_sec())
    min_positive: Optional[float] = None
    event_ids = await _linkable_open_event_ids_with_open_bets()
    if not event_ids:
        return 0.0
    cursor = db.sports_events.find(
        {
            **_LINKABLE_OPEN_EVENT_FILTER,
            "id": {"$in": list(event_ids)},
            "auto_settle_attempted_at": {"$exists": False},
        },
        {"_id": 0, "start_time": 1},
    ).limit(1000)
    async for doc in cursor:
        st = _parse_start_time_utc(doc.get("start_time"))
        if st is None:
            return 0.0
        eligible_at = st + delay
        w = (eligible_at - now).total_seconds()
        if w <= 0:
            return 0.0
        if min_positive is None or w < min_positive:
            min_positive = w
    if min_positive is None:
        return 0.0
    return min(cap, min_positive)


async def run_sports_auto_settle_ticker() -> None:
    """
    Background loop: call Odds API auto-settle only after kickoff + delay for linkable open events.
    Enable with SPORTS_AUTO_SETTLE_TICKER=1; disable when using SPORTS_AUTO_SETTLE_USE_CRON=1.
    """
    log = logging.getLogger(__name__)
    warned_no_key = False
    while True:
        try:
            if not _odds_api_key():
                if not warned_no_key:
                    log.info("Sports auto-settle ticker: THE_ODDS_API_KEY unset — sleeping 1h.")
                    warned_no_key = True
                await asyncio.sleep(3600)
                continue
            warned_no_key = False

            try:
                due_ids = await _linkable_due_once_event_ids_with_open_bets()
                if not due_ids:
                    await asyncio.sleep(_sports_auto_settle_ticker_idle_sec())
                    continue
                n_linkable = len(due_ids)
            except Exception as ex:
                log.warning("Sports auto-settle ticker: count linkable events failed: %s", ex)
                await asyncio.sleep(300)
                continue

            if n_linkable == 0:
                await asyncio.sleep(_sports_auto_settle_ticker_idle_sec())
                continue

            wait_sec = await _seconds_until_next_linkable_eligible_or_cap()
            if wait_sec > 0:
                await asyncio.sleep(wait_sec)
                if not await any_linkable_open_event_past_settle_delay():
                    continue

            try:
                out = await _auto_settle_from_scores()
                settled = int(out.get("settled") or 0)
                if settled > 0:
                    log.info(
                        "Sports auto-settle ticker: settled=%s skipped_no_match=%s skipped_no_winner=%s",
                        settled,
                        out.get("skipped_no_match"),
                        out.get("skipped_no_winner"),
                    )
                elif out.get("message"):
                    log.debug("Sports auto-settle ticker: %s", out.get("message"))
            except Exception as ex:
                log.exception("Sports auto-settle ticker: _auto_settle_from_scores failed: %s", ex)

            await asyncio.sleep(_sports_auto_settle_ticker_poll_interval_sec())
        except asyncio.CancelledError:
            raise
        except Exception as ex:
            log.exception("Sports auto-settle ticker: loop error: %s", ex)
            await asyncio.sleep(300)


def register(router):
    if _odds_api_key():
        logger.info(
            "Sports betting: THE_ODDS_API_KEY is set — using The Odds API for Football/UFC/Boxing/F1 (where available) and for auto-settle.",
        )
    else:
        logger.warning("Sports betting: THE_ODDS_API_KEY is not set — Football/UFC/Boxing use fallback sources; auto-settle will not run.")

    router.add_api_route("/sports-betting/events", sports_betting_events, methods=["GET"])
    router.add_api_route("/sports-betting/bet", sports_betting_place, methods=["POST"])
    router.add_api_route("/sports-betting/my-bets", sports_betting_my_bets, methods=["GET"])
    router.add_api_route("/sports-betting/cancel-bet", sports_betting_cancel_bet, methods=["POST"])
    router.add_api_route("/sports-betting/cancel-all-bets", sports_betting_cancel_all_bets, methods=["POST"])
    router.add_api_route("/sports-betting/stats", sports_betting_stats, methods=["GET"])
    router.add_api_route("/sports-betting/recent-results", sports_betting_recent_results, methods=["GET"])
    router.add_api_route("/sports-betting/template-library", sports_template_library, methods=["GET"])
    router.add_api_route("/sports-betting/my-event-requests", sports_my_event_requests, methods=["GET"])
    router.add_api_route("/sports-betting/request-event", sports_request_event, methods=["POST"])
    router.add_api_route("/admin/sports-betting/templates", admin_sports_templates, methods=["GET"])
    router.add_api_route("/admin/sports-betting/templates/load-db", admin_sports_templates_load_db, methods=["POST"])
    router.add_api_route("/admin/sports-betting/refresh", admin_sports_refresh, methods=["POST"])
    router.add_api_route("/admin/sports-betting/auto-settle-run", admin_sports_auto_settle_run, methods=["POST"])
    router.add_api_route("/admin/sports-betting/events", admin_sports_add_event, methods=["POST"])
    router.add_api_route("/admin/sports-betting/custom-event", admin_sports_add_custom_event, methods=["POST"])
    router.add_api_route("/admin/sports-betting/events/betting-window", admin_sports_patch_event_betting_window, methods=["PATCH"])
    router.add_api_route("/admin/sports-betting/settle", admin_sports_settle, methods=["POST"])
    router.add_api_route("/admin/sports-betting/cancel-event", admin_sports_cancel_event, methods=["POST"])
    router.add_api_route("/admin/sports-betting/cancel-stale-open-bets", admin_sports_cancel_stale_open_bets, methods=["POST"])
    router.add_api_route("/admin/sports-betting/bets", admin_sports_bets_list, methods=["GET"])
    router.add_api_route("/admin/sports-betting/unsettled-events", admin_sports_unsettled_events, methods=["GET"])
    router.add_api_route("/admin/sports-betting/auto-settle-health", admin_sports_auto_settle_health, methods=["GET"])
    router.add_api_route("/admin/sports-betting/event-requests", admin_sports_event_requests_list, methods=["GET"])
    router.add_api_route("/admin/sports-betting/event-requests/approve", admin_sports_event_request_approve, methods=["POST"])
    router.add_api_route("/admin/sports-betting/event-requests/deny", admin_sports_event_request_deny, methods=["POST"])

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
