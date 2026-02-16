# Sports betting: events, place/cancel bets, stats, recent results; admin templates, add/settle/cancel events
from datetime import datetime, timezone, timedelta
import asyncio
import time
import random
import os
import uuid
from typing import List, Optional

from pydantic import BaseModel
from fastapi import Depends, HTTPException
import httpx

from server import db, get_current_user, log_gambling, _is_admin

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
SPORTS_LIVE_CACHE_TTL = 6 * 3600
ODDS_API_BASE = "https://api.the-odds-api.com/v4"
THESPORTSDB_LEAGUE_PREMIER = 4328
THESPORTSDB_LEAGUE_LALIGA = 4335
THESPORTSDB_LEAGUE_UFC = 4443
THESPORTSDB_LEAGUE_BOXING = 4445

_sports_live_cache = {"football": [], "ufc": [], "boxing": [], "f1": [], "updated_at": 0.0}


def _odds_api_key():
    return os.environ.get("THE_ODDS_API_KEY", "").strip()


def _parse_commence_time(commence_time) -> str | None:
    if commence_time is None:
        return None
    if isinstance(commence_time, (int, float)):
        try:
            dt = datetime.fromtimestamp(int(commence_time), tz=timezone.utc)
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
        return None


def _parse_odds_event(event: dict, category: str, three_way: bool) -> dict | None:
    event_id = (event.get("id") or "").strip()
    home = (event.get("home_team") or "").strip()
    away = (event.get("away_team") or "").strip()
    if not home or not away or not event_id:
        return None
    bookmakers = event.get("bookmakers") or []
    outcomes = []
    for b in bookmakers:
        for m in (b.get("markets") or []):
            if (m.get("key") or "").lower() == "h2h":
                outcomes = m.get("outcomes") or []
                break
        if outcomes:
            break
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
        if len(options) != 3:
            return None
        used = set()
        ordered = []
        for candidate in [home, "Draw", away]:
            for i, o in enumerate(options):
                if i in used:
                    continue
                n = (o.get("name") or "").strip()
                if candidate == "Draw" and "draw" in n.lower():
                    ordered.append(o)
                    used.add(i)
                    break
                if n == candidate:
                    ordered.append(o)
                    used.add(i)
                    break
        if len(ordered) == 3:
            options = ordered
    elif len(options) != 2:
        return None
    name = "%s vs %s" % (home, away)
    start_time = _parse_commence_time(event.get("commence_time"))
    out = {"id": "odds_%s_%s" % (category.lower()[:3], event_id[:16]), "name": name, "category": category, "options": options}
    if start_time:
        out["start_time"] = start_time
    return out


async def _fetch_odds_api_soccer() -> list:
    key = _odds_api_key()
    if not key:
        return []
    out = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            for sport_key in ("soccer_epl", "soccer_spain_la_liga", "soccer_germany_bundesliga"):
                r = await client.get(
                    "%s/sports/%s/odds" % (ODDS_API_BASE, sport_key),
                    params={"apiKey": key, "regions": "uk", "markets": "h2h", "oddsFormat": "decimal"},
                )
                if r.status_code != 200:
                    continue
                events = r.json()
                if not isinstance(events, list):
                    continue
                for ev in events[:12]:
                    parsed = _parse_odds_event(ev, "Football", three_way=True)
                    if parsed:
                        out.append(parsed)
    except Exception:
        pass
    return out


async def _fetch_odds_api_mma() -> list:
    key = _odds_api_key()
    if not key:
        return []
    out = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(
                "%s/sports/mma_mixed_martial_arts/odds" % ODDS_API_BASE,
                params={"apiKey": key, "regions": "uk", "markets": "h2h", "oddsFormat": "decimal"},
            )
            if r.status_code != 200:
                return []
            events = r.json()
            if not isinstance(events, list):
                return []
            for ev in events[:15]:
                parsed = _parse_odds_event(ev, "UFC", three_way=False)
                if parsed:
                    out.append(parsed)
    except Exception:
        pass
    return out


async def _fetch_odds_api_boxing() -> list:
    key = _odds_api_key()
    if not key:
        return []
    out = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(
                "%s/sports/boxing_boxing/odds" % ODDS_API_BASE,
                params={"apiKey": key, "regions": "uk", "markets": "h2h", "oddsFormat": "decimal"},
            )
            if r.status_code != 200:
                return []
            events = r.json()
            if not isinstance(events, list):
                return []
            for ev in events[:15]:
                parsed = _parse_odds_event(ev, "Boxing", three_way=False)
                if parsed:
                    out.append(parsed)
    except Exception:
        pass
    return out


async def _fetch_football_events_football_data_org() -> list:
    token = os.environ.get("FOOTBALL_DATA_ORG_TOKEN", "").strip()
    if not token:
        return []
    out = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            for code in ("PL", "PD", "BL1"):
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
                    if count >= 15:
                        break
                    status = (m.get("status") or "").upper()
                    if status not in ("SCHEDULED", "TIMED"):
                        continue
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
                                    {"id": "home_" + opt_h, "name": home, "odds": round(2.0 + random.uniform(0.2, 1.2), 2)},
                                    {"id": "draw", "name": "Draw", "odds": round(3.0 + random.uniform(0.1, 0.6), 2)},
                                    {"id": "away_" + opt_a, "name": away, "odds": round(2.0 + random.uniform(0.2, 1.2), 2)},
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


def _get_all_sports_templates() -> list:
    return (
        (_sports_live_cache.get("football") or [])
        + (_sports_live_cache.get("ufc") or [])
        + (_sports_live_cache.get("boxing") or [])
        + (_sports_live_cache.get("f1") or [])
    )


def _sports_template_to_response(t):
    row = {"id": t["id"], "name": t["name"], "category": t["category"], "options": t.get("options") or []}
    st = t.get("start_time")
    if st:
        row["start_time"] = st
        try:
            dt = datetime.fromisoformat(st.replace("Z", "+00:00"))
            row["start_time_display"] = dt.strftime("%d-%m-%Y %H:%M")
        except Exception:
            row["start_time_display"] = st
    return row


async def _sports_ensure_seed_events():
    pass


# ----- Public routes -----
async def sports_betting_events(current_user: dict = Depends(get_current_user)):
    await _sports_ensure_seed_events()
    now = datetime.now(timezone.utc)
    cursor = db.sports_events.find(
        {"status": "open"},
        {"_id": 0, "id": 1, "name": 1, "category": 1, "start_time": 1, "options": 1, "is_special": 1},
    ).sort("start_time", 1)
    events = await cursor.to_list(50)
    result = []
    close_betting_minutes = 10
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
            "start_time_display": start_dt.strftime("%d-%m-%Y - %H:%M"),
            "options": e.get("options") or [],
            "is_special": bool(e.get("is_special")),
            "betting_open": betting_open,
            "status": status,
        })
    return {"events": result}


async def sports_betting_place(request: SportsBetPlaceRequest, current_user: dict = Depends(get_current_user)):
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
    try:
        start_dt = datetime.fromisoformat(st.replace("Z", "+00:00")) if st else datetime.now(timezone.utc)
    except Exception:
        start_dt = datetime.now(timezone.utc)
    if datetime.now(timezone.utc) >= start_dt - timedelta(minutes=10):
        raise HTTPException(status_code=400, detail="Betting closed (closes 10 min before start)")
    opt = next((o for o in (ev.get("options") or []) if o.get("id") == option_id), None)
    if not opt:
        raise HTTPException(status_code=400, detail="Invalid option")
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(user.get("money", 0) or 0)
    if stake > money:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    now = datetime.now(timezone.utc).isoformat()
    bet_id = str(uuid.uuid4())
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -stake}})
    await db.sports_bets.insert_one({
        "id": bet_id,
        "user_id": current_user["id"],
        "event_id": event_id,
        "event_name": ev.get("name", "?"),
        "option_id": option_id,
        "option_name": opt.get("name", "?"),
        "odds": float(opt.get("odds", 1)),
        "stake": stake,
        "status": "open",
        "created_at": now,
    })
    await log_gambling(current_user["id"], current_user.get("username") or "?", "sports_bet", {"bet_id": bet_id, "event_name": ev.get("name"), "option_name": opt.get("name"), "odds": float(opt.get("odds", 1)), "stake": stake, "status": "open"})
    return {"message": f"Bet placed: ${stake:,} on {opt.get('name')}", "bet_id": bet_id}


async def sports_betting_my_bets(current_user: dict = Depends(get_current_user)):
    open_bets = await db.sports_bets.find(
        {"user_id": current_user["id"], "status": "open"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    closed_bets = await db.sports_bets.find(
        {"user_id": current_user["id"], "status": {"$in": ["won", "lost"]}},
        {"_id": 0},
    ).sort("settled_at", -1).to_list(50)
    return {
        "open": [{"id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "odds": b.get("odds"), "stake": b.get("stake"), "created_at": b.get("created_at")} for b in open_bets],
        "closed": [{"id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "odds": b.get("odds"), "stake": b.get("stake"), "status": b.get("status"), "created_at": b.get("created_at"), "settled_at": b.get("settled_at")} for b in closed_bets],
    }


async def sports_betting_cancel_bet(request: SportsBetCancelRequest, current_user: dict = Depends(get_current_user)):
    bet_id = (request.bet_id or "").strip()
    if not bet_id:
        raise HTTPException(status_code=400, detail="bet_id required")
    bet = await db.sports_bets.find_one({"id": bet_id, "user_id": current_user["id"], "status": "open"}, {"_id": 0, "stake": 1})
    if not bet:
        raise HTTPException(status_code=404, detail="Bet not found or already settled")
    stake = int(bet.get("stake") or 0)
    now = datetime.now(timezone.utc).isoformat()
    await db.sports_bets.update_one({"id": bet_id}, {"$set": {"status": "cancelled", "settled_at": now}})
    if stake > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": stake}})
    return {"message": f"Bet cancelled. ${stake:,} refunded.", "refunded": stake}


async def sports_betting_cancel_all_bets(current_user: dict = Depends(get_current_user)):
    cursor = db.sports_bets.find({"user_id": current_user["id"], "status": "open"}, {"_id": 0, "id": 1, "stake": 1})
    bets = await cursor.to_list(100)
    if not bets:
        return {"message": "No open bets to cancel.", "refunded": 0, "cancelled_count": 0}
    total_refund = 0
    now = datetime.now(timezone.utc).isoformat()
    for b in bets:
        stake = int(b.get("stake") or 0)
        await db.sports_bets.update_one({"id": b["id"]}, {"$set": {"status": "cancelled", "settled_at": now}})
        total_refund += stake
    if total_refund > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": total_refund}})
    return {"message": f"All {len(bets)} bet(s) cancelled. ${total_refund:,} refunded.", "refunded": total_refund, "cancelled_count": len(bets)}


async def sports_betting_stats(current_user: dict = Depends(get_current_user)):
    pipeline = [
        {"$match": {"user_id": current_user["id"], "status": {"$in": ["won", "lost"]}}},
        {"$group": {"_id": None, "total_stake": {"$sum": "$stake"}, "won_count": {"$sum": {"$cond": [{"$eq": ["$status", "won"]}, 1, 0]}}, "lost_count": {"$sum": {"$cond": [{"$eq": ["$status", "lost"]}, 1, 0]}}}},
    ]
    agg = await db.sports_bets.aggregate(pipeline).to_list(1)
    doc = agg[0] if agg else {}
    total_stake = int(doc.get("total_stake", 0) or 0)
    won_count = int(doc.get("won_count", 0) or 0)
    lost_count = int(doc.get("lost_count", 0) or 0)
    total_placed = won_count + lost_count
    won_stake = await db.sports_bets.aggregate([
        {"$match": {"user_id": current_user["id"], "status": "won"}},
        {"$group": {"_id": None, "sum": {"$sum": {"$multiply": ["$stake", "$odds"]}}}},
    ]).to_list(1)
    lost_stake = await db.sports_bets.aggregate([
        {"$match": {"user_id": current_user["id"], "status": "lost"}},
        {"$group": {"_id": None, "sum": {"$sum": "$stake"}}},
    ]).to_list(1)
    winnings = int((won_stake[0].get("sum", 0) or 0)) if won_stake else 0
    losses = int((lost_stake[0].get("sum", 0) or 0)) if lost_stake else 0
    profit_loss = winnings - losses
    win_pct = round(100 * won_count / total_placed, 1) if total_placed else 0
    all_placed = await db.sports_bets.count_documents({"user_id": current_user["id"]})
    return {
        "total_bets_placed": all_placed,
        "total_bets_won": won_count,
        "total_bets_lost": lost_count,
        "win_pct": win_pct,
        "profit_loss": profit_loss,
    }


async def sports_betting_recent_results(current_user: dict = Depends(get_current_user)):
    cursor = db.sports_bets.find(
        {"user_id": current_user["id"], "status": {"$in": ["won", "lost"]}},
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
async def admin_sports_templates(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    categories = ["Football", "UFC", "Boxing", "Formula 1"]
    by_category = {c: [] for c in categories}
    for t in _get_all_sports_templates():
        by_category.setdefault(t["category"], []).append(_sports_template_to_response(t))
    return {"categories": categories, "templates": by_category}


async def admin_sports_refresh(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    await _refresh_sports_live_cache(force=True)
    categories = ["Football", "UFC", "Boxing", "Formula 1"]
    by_category = {c: [] for c in categories}
    for t in _get_all_sports_templates():
        by_category.setdefault(t["category"], []).append(_sports_template_to_response(t))
    return {"categories": categories, "templates": by_category}


async def admin_sports_add_event(request: AdminAddSportsEventRequest, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    template_id = (request.template_id or "").strip()
    template = next((t for t in _get_all_sports_templates() if t["id"] == template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    now = datetime.now(timezone.utc)
    start_time = template.get("start_time") or (now + timedelta(hours=2)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    ev = {
        "id": str(uuid.uuid4()),
        "name": template["name"],
        "category": template["category"],
        "start_time": start_time,
        "options": [dict(o) for o in template["options"]],
        "is_special": False,
        "status": "open",
    }
    await db.sports_events.insert_one(ev)
    return {"message": f"Added event: {template['name']}", "event_id": ev["id"]}


async def admin_sports_add_custom_event(request: AdminAddCustomSportsEventRequest, current_user: dict = Depends(get_current_user)):
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


async def admin_sports_settle(request: SportsSettleEventRequest, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    event_id = (request.event_id or "").strip()
    winning_option_id = (request.winning_option_id or "").strip()
    ev = await db.sports_events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    now = datetime.now(timezone.utc).isoformat()
    await db.sports_events.update_one(
        {"id": event_id},
        {"$set": {"status": "settled", "winning_option_id": winning_option_id}},
    )
    cursor = db.sports_bets.find(
        {"event_id": event_id, "status": "open"},
        {"_id": 0, "id": 1, "user_id": 1, "option_id": 1, "stake": 1, "odds": 1, "event_name": 1, "option_name": 1},
    )
    for b in await cursor.to_list(1000):
        won = b.get("option_id") == winning_option_id
        new_status = "won" if won else "lost"
        await db.sports_bets.update_one({"id": b["id"]}, {"$set": {"status": new_status, "settled_at": now}})
        u = await db.users.find_one({"id": b["user_id"]}, {"_id": 0, "username": 1})
        await log_gambling(b["user_id"], u.get("username") if u else "?", "sports_bet", {"bet_id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "stake": b.get("stake"), "odds": b.get("odds"), "status": new_status, "settled_at": now})
        if won:
            stake = int(b.get("stake") or 0)
            odds = float(b.get("odds") or 1)
            payout = int(stake * odds)
            if payout > 0:
                await db.users.update_one({"id": b["user_id"]}, {"$inc": {"money": payout}})
    return {"message": f"Event {event_id} settled. Winning option: {winning_option_id}. Winners paid out."}


async def admin_sports_cancel_event(request: AdminCancelEventRequest, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    event_id = (request.event_id or "").strip()
    ev = await db.sports_events.find_one({"id": event_id, "status": "open"}, {"_id": 0, "id": 1})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found or already settled/cancelled")
    now = datetime.now(timezone.utc).isoformat()
    cursor = db.sports_bets.find(
        {"event_id": event_id, "status": "open"},
        {"_id": 0, "id": 1, "user_id": 1, "stake": 1},
    )
    refunded_count = 0
    total_refunded = 0
    for b in await cursor.to_list(1000):
        stake = int(b.get("stake") or 0)
        await db.sports_bets.update_one({"id": b["id"]}, {"$set": {"status": "cancelled", "settled_at": now}})
        if stake > 0:
            await db.users.update_one({"id": b["user_id"]}, {"$inc": {"money": stake}})
        refunded_count += 1
        total_refunded += stake
    await db.sports_events.update_one({"id": event_id}, {"$set": {"status": "cancelled"}})
    return {
        "message": f"Event cancelled. {refunded_count} bet(s) refunded (${total_refunded:,} total).",
        "refunded_count": refunded_count,
        "total_refunded": total_refunded,
    }


def register(router):
    router.add_api_route("/sports-betting/events", sports_betting_events, methods=["GET"])
    router.add_api_route("/sports-betting/bet", sports_betting_place, methods=["POST"])
    router.add_api_route("/sports-betting/my-bets", sports_betting_my_bets, methods=["GET"])
    router.add_api_route("/sports-betting/cancel-bet", sports_betting_cancel_bet, methods=["POST"])
    router.add_api_route("/sports-betting/cancel-all-bets", sports_betting_cancel_all_bets, methods=["POST"])
    router.add_api_route("/sports-betting/stats", sports_betting_stats, methods=["GET"])
    router.add_api_route("/sports-betting/recent-results", sports_betting_recent_results, methods=["GET"])
    router.add_api_route("/admin/sports-betting/templates", admin_sports_templates, methods=["GET"])
    router.add_api_route("/admin/sports-betting/refresh", admin_sports_refresh, methods=["POST"])
    router.add_api_route("/admin/sports-betting/events", admin_sports_add_event, methods=["POST"])
    router.add_api_route("/admin/sports-betting/custom-event", admin_sports_add_custom_event, methods=["POST"])
    router.add_api_route("/admin/sports-betting/settle", admin_sports_settle, methods=["POST"])
    router.add_api_route("/admin/sports-betting/cancel-event", admin_sports_cancel_event, methods=["POST"])
