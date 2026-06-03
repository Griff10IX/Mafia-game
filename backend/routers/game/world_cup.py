# World Cup 2026 predictions event
import asyncio
import json
import logging
import os
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from routers.casinos import sports_betting as sb
from utils.point_provenance import log_points_event
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_WORLD_CUP

logger = logging.getLogger(__name__)

CONFIG_ID = "world_cup_event"
WC_TEAMS_SEED_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "world_cup_2026_teams.json"
WC_SPORT_KEY = "soccer_fifa_world_cup"
LOCK_MINUTES_BEFORE = 10
SETTLE_MINUTES_AFTER = 122
DEFAULT_ENDED_MESSAGE = "World Cup 2026 has ended. Thanks for playing!"
GROUP_IDS = tuple(chr(ord("A") + i) for i in range(12))

PRED_GROUP_WINNER = "group_winner"
PRED_MATCH_SCORE = "match_score"
PRED_MATCH_SCORER = "match_scorer"
PRED_SECOND_PLACE = "second_place"
PRED_THIRD_PLACE = "third_place"

DEFAULT_POINTS = {
    "group_winner_points": 2500,
    "jackpot_points": 25000,
    "second_place_points": 15000,
    "third_place_points": 10000,
    "match_score_exact_points": 1000,
    "match_score_result_points": 250,
    "match_scorer_points": 500,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None


async def _load_config(db) -> dict:
    doc = await db.game_config.find_one({"id": CONFIG_ID}, {"_id": 0})
    if not doc:
        doc = {"id": CONFIG_ID, "enabled": False, "ended_message": DEFAULT_ENDED_MESSAGE}
    out = dict(doc)
    for k, v in DEFAULT_POINTS.items():
        out.setdefault(k, v)
    out.setdefault("enabled", False)
    out.setdefault("entry_open", True)
    out.setdefault("draft_run", False)
    out.setdefault("auto_sync_enabled", True)
    out.setdefault("ended_message", DEFAULT_ENDED_MESSAGE)
    out.setdefault("phase", "upcoming")
    out.setdefault("banner_text", "")
    return out


async def _require_enabled(cfg: dict, *, admin_ok: bool = False) -> None:
    if cfg.get("enabled"):
        return
    if admin_ok:
        return
    raise HTTPException(status_code=403, detail=cfg.get("ended_message") or DEFAULT_ENDED_MESSAGE)


async def _require_enabled_staff(cfg: dict) -> None:
    if not cfg.get("enabled"):
        raise HTTPException(status_code=403, detail="World Cup event is disabled")


def _points_from_config(cfg: dict) -> dict:
    return {k: int(cfg.get(k) or v) for k, v in DEFAULT_POINTS.items()}


async def _award_points(db, send_notification, user_id: str, points: int, event_ref: str, label: str) -> bool:
    pts = int(points or 0)
    if not user_id or pts <= 0:
        return False
    await db.users.update_one({"id": user_id}, {"$inc": {"points": pts}})
    await log_points_event(
        db,
        user_id=user_id,
        points=pts,
        event_type="world_cup_payout",
        event_ref=event_ref,
        meta={"label": label},
    )
    try:
        await send_notification(user_id, "World Cup", f"You earned {pts:,} points — {label}.", "reward", category="world_cup")
    except Exception:
        pass
    return True


def _norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


async def _teams_by_id(db) -> dict:
    out = {}
    async for t in db.world_cup_teams.find({}, {"_id": 0}):
        tid = t.get("id")
        if tid:
            out[tid] = t
    return out


async def _resolve_team_id(db, name: str, teams_by_id: Optional[dict] = None) -> Optional[str]:
    nm = _norm_name(name)
    if not nm:
        return None
    teams = teams_by_id if teams_by_id is not None else await _teams_by_id(db)
    for t in teams.values():
        if _norm_name(t.get("name")) == nm:
            return t.get("id")
        for alias in t.get("odds_api_names") or []:
            if _norm_name(alias) == nm:
                return t.get("id")
        if sb._team_matches_option(t.get("name") or "", name):
            return t.get("id")
    return None


def _lock_at_from_kickoff(kickoff_iso: str) -> str:
    dt = _parse_iso(kickoff_iso)
    if not dt:
        return kickoff_iso
    return (dt - timedelta(minutes=LOCK_MINUTES_BEFORE)).isoformat()


async def _group_lock_times(db) -> dict:
    """Earliest kickoff per group → lock time."""
    locks = {}
    for gid in GROUP_IDS:
        cursor = db.world_cup_matches.find(
            {"group_id": gid, "stage": "group"},
            {"_id": 0, "kickoff": 1},
        ).sort("kickoff", 1).limit(1)
        docs = await cursor.to_list(1)
        if docs and docs[0].get("kickoff"):
            locks[gid] = _lock_at_from_kickoff(docs[0]["kickoff"])
    return locks


def _is_locked(lock_iso: Optional[str]) -> bool:
    dt = _parse_iso(lock_iso)
    if not dt:
        return False
    return datetime.now(timezone.utc) >= dt


async def _settle_prediction_doc(db, send_notification, pred: dict, points: int, label: str) -> bool:
    if pred.get("settled"):
        return False
    pid = pred.get("id")
    if not pid:
        return False
    res = await db.world_cup_predictions.update_one(
        {"id": pid, "settled": {"$ne": True}},
        {"$set": {"settled": True, "points_awarded": int(points), "settled_at": _now_iso()}},
    )
    if res.modified_count == 0:
        return False
    if points > 0:
        await _award_points(db, send_notification, pred.get("user_id") or "", points, pid, label)
    return True


async def _settle_group_predictions(db, send_notification, cfg: dict, group_id: str, winner_team_id: str) -> int:
    pts_cfg = _points_from_config(cfg)
    pts = pts_cfg["group_winner_points"]
    count = 0
    cursor = db.world_cup_predictions.find(
        {"type": PRED_GROUP_WINNER, "target_id": group_id, "settled": {"$ne": True}},
        {"_id": 0},
    )
    async for pred in cursor:
        pick = (pred.get("value") or {}).get("team_id") if isinstance(pred.get("value"), dict) else pred.get("value")
        if str(pick) != str(winner_team_id):
            await _settle_prediction_doc(db, send_notification, pred, 0, f"Group {group_id} (incorrect)")
            count += 1
            continue
        if await _settle_prediction_doc(db, send_notification, pred, pts, f"Group {group_id} winner"):
            count += 1
    await db.world_cup_groups.update_one(
        {"group_id": group_id},
        {"$set": {"winner_team_id": winner_team_id, "settled_at": _now_iso()}},
        upsert=True,
    )
    return count


def _match_result_outcome(home: int, away: int) -> str:
    if home > away:
        return "home"
    if away > home:
        return "away"
    return "draw"


async def _settle_match_predictions(db, send_notification, cfg: dict, match: dict) -> int:
    result = match.get("result") or {}
    h = int(result.get("home_score") if result.get("home_score") is not None else -1)
    a = int(result.get("away_score") if result.get("away_score") is not None else -1)
    if h < 0 or a < 0:
        return 0
    pts_cfg = _points_from_config(cfg)
    mid = match.get("id")
    count = 0
    actual_outcome = _match_result_outcome(h, a)
    scorers = {_norm_name(x) for x in (result.get("scorers") or []) if x}

    cursor = db.world_cup_predictions.find(
        {"target_id": mid, "type": {"$in": [PRED_MATCH_SCORE, PRED_MATCH_SCORER]}, "settled": {"$ne": True}},
        {"_id": 0},
    )
    async for pred in cursor:
        ptype = pred.get("type")
        val = pred.get("value") or {}
        if ptype == PRED_MATCH_SCORE:
            ph = int(val.get("home") if val.get("home") is not None else -999)
            pa = int(val.get("away") if val.get("away") is not None else -999)
            if ph == h and pa == a:
                pts = pts_cfg["match_score_exact_points"]
                label = f"Exact score {h}-{a}"
            elif _match_result_outcome(ph, pa) == actual_outcome:
                pts = pts_cfg["match_score_result_points"]
                label = "Correct match result"
            else:
                pts = 0
                label = "Incorrect score"
            if await _settle_prediction_doc(db, send_notification, pred, pts, label):
                count += 1
        elif ptype == PRED_MATCH_SCORER and scorers:
            name = _norm_name(val.get("name") if isinstance(val, dict) else str(val))
            if name and name in scorers:
                if await _settle_prediction_doc(
                    db, send_notification, pred, pts_cfg["match_scorer_points"], "Correct goal scorer"
                ):
                    count += 1
            else:
                if await _settle_prediction_doc(db, send_notification, pred, 0, "Incorrect scorer"):
                    count += 1
    return count


def _compute_group_standings(group_teams: list, matches: list) -> list:
    """Return team_ids sorted best-first by pts, GD, GF."""
    stats = {tid: {"pts": 0, "gf": 0, "ga": 0} for tid in group_teams}
    for m in matches:
        res = m.get("result") or {}
        h_id, a_id = m.get("home_team_id"), m.get("away_team_id")
        try:
            hs = int(res.get("home_score"))
            as_ = int(res.get("away_score"))
        except (TypeError, ValueError):
            continue
        if h_id in stats:
            stats[h_id]["gf"] += hs
            stats[h_id]["ga"] += as_
        if a_id in stats:
            stats[a_id]["gf"] += as_
            stats[a_id]["ga"] += hs
        if hs > as_:
            if h_id in stats:
                stats[h_id]["pts"] += 3
        elif as_ > hs:
            if a_id in stats:
                stats[a_id]["pts"] += 3
        else:
            if h_id in stats:
                stats[h_id]["pts"] += 1
            if a_id in stats:
                stats[a_id]["pts"] += 1

    def sort_key(tid):
        s = stats[tid]
        gd = s["gf"] - s["ga"]
        return (s["pts"], gd, s["gf"])

    return sorted(group_teams, key=sort_key, reverse=True)


async def _try_settle_group(db, send_notification, cfg: dict, group_id: str) -> bool:
    grp = await db.world_cup_groups.find_one({"group_id": group_id}, {"_id": 0})
    if grp and grp.get("winner_team_id") and grp.get("settled_at"):
        return False
    gteams = grp.get("team_ids") if grp else []
    if not gteams:
        tdocs = await db.world_cup_teams.find({"group_id": group_id}, {"_id": 0, "id": 1}).to_list(10)
        gteams = [t["id"] for t in tdocs]
    if len(gteams) < 2:
        return False
    matches = await db.world_cup_matches.find(
        {"group_id": group_id, "stage": "group", "status": "settled"},
        {"_id": 0},
    ).to_list(20)
    expected = len(gteams) * (len(gteams) - 1) // 2
    if len(matches) < expected:
        return False
    ranked = _compute_group_standings(gteams, matches)
    winner = ranked[0]
    await _settle_group_predictions(db, send_notification, cfg, group_id, winner)
    return True


async def _apply_match_result(db, send_notification, cfg: dict, match_id: str, home_score: int, away_score: int, scorers: Optional[list] = None) -> dict:
    match = await db.world_cup_matches.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    result = {"home_score": int(home_score), "away_score": int(away_score), "scorers": list(scorers or match.get("result", {}).get("scorers") or [])}
    await db.world_cup_matches.update_one(
        {"id": match_id},
        {"$set": {"status": "settled", "result": result, "settled_at": _now_iso()}},
    )
    match = {**match, "status": "settled", "result": result}
    settled_preds = await _settle_match_predictions(db, send_notification, cfg, match)
    groups_settled = 0
    gid = match.get("group_id")
    if match.get("stage") == "group" and gid:
        if await _try_settle_group(db, send_notification, cfg, gid):
            groups_settled = 1
    stage = (match.get("stage") or "").lower()
    tourney = await _maybe_settle_tournament_from_match(db, send_notification, cfg, match, stage)
    return {"match_id": match_id, "predictions_settled": settled_preds, "groups_settled": groups_settled, **tourney}


async def _maybe_settle_tournament_from_match(db, send_notification, cfg: dict, match: dict, stage: str) -> dict:
    out = {"tournament_settled": False}
    res = match.get("result") or {}
    try:
        hs, as_ = int(res["home_score"]), int(res["away_score"])
    except (TypeError, ValueError, KeyError):
        return out
    home_id, away_id = match.get("home_team_id"), match.get("away_team_id")
    if stage == "third_place":
        third = home_id if hs > as_ else away_id
        await db.game_config.update_one({"id": CONFIG_ID}, {"$set": {"third_place_team_id": third}})
        pts = _points_from_config(cfg)["third_place_points"]
        cursor = db.world_cup_predictions.find({"type": PRED_THIRD_PLACE, "settled": {"$ne": True}}, {"_id": 0})
        async for pred in cursor:
            pick = (pred.get("value") or {}).get("team_id") if isinstance(pred.get("value"), dict) else pred.get("value")
            pts_aw = pts if str(pick) == str(third) else 0
            await _settle_prediction_doc(db, send_notification, pred, pts_aw, "3rd place")
        out["third_place_settled"] = True
    elif stage == "final":
        champion = home_id if hs > as_ else away_id
        runner_up = away_id if hs > as_ else home_id
        await db.game_config.update_one(
            {"id": CONFIG_ID},
            {"$set": {"champion_team_id": champion, "runner_up_team_id": runner_up, "phase": "completed"}},
        )
        pts2 = _points_from_config(cfg)["second_place_points"]
        cursor = db.world_cup_predictions.find({"type": PRED_SECOND_PLACE, "settled": {"$ne": True}}, {"_id": 0})
        async for pred in cursor:
            pick = (pred.get("value") or {}).get("team_id") if isinstance(pred.get("value"), dict) else pred.get("value")
            pts_aw = pts2 if str(pick) == str(runner_up) else 0
            await _settle_prediction_doc(db, send_notification, pred, pts_aw, "2nd place")
        jackpot = _points_from_config(cfg)["jackpot_points"]
        async for entry in db.world_cup_entries.find({"jackpot_awarded": {"$ne": True}}, {"_id": 0}):
            drafted = entry.get("drafted_team_ids") or []
            if str(champion) not in [str(x) for x in drafted]:
                continue
            uid = entry.get("user_id")
            if not uid:
                continue
            ref = f"jackpot:{entry.get('user_id')}:{champion}"
            await _award_points(db, send_notification, uid, jackpot, ref, "World Cup champion (draft)")
            await db.world_cup_entries.update_one({"user_id": uid}, {"$set": {"jackpot_awarded": True, "jackpot_awarded_at": _now_iso()}})
        out["tournament_settled"] = True
    return out


async def _sync_fixtures_from_odds(db) -> dict:
    events = await sb._fetch_odds_api_h2h_events_merged(WC_SPORT_KEY)
    teams_by_id = await _teams_by_id(db)
    synced, skipped = 0, 0
    now = _now_iso()
    for ev in events or []:
        ext_id = (ev.get("id") or "").strip()
        home_name = (ev.get("home_team") or "").strip()
        away_name = (ev.get("away_team") or "").strip()
        commence = ev.get("commence_time") or ev.get("start_time") or ""
        if not ext_id or not home_name or not away_name:
            skipped += 1
            continue
        home_id = await _resolve_team_id(db, home_name, teams_by_id)
        away_id = await _resolve_team_id(db, away_name, teams_by_id)
        if not home_id or not away_id:
            skipped += 1
            continue
        home_team = teams_by_id.get(home_id) or {}
        away_team = teams_by_id.get(away_id) or {}
        g_home, g_away = home_team.get("group_id"), away_team.get("group_id")
        stage = "group"
        group_id = None
        if g_home and g_home == g_away:
            stage = "group"
            group_id = g_home
        else:
            stage = "knockout"
        existing = await db.world_cup_matches.find_one({"external_event_id": ext_id}, {"_id": 0, "status": 1, "result": 1})
        if existing and existing.get("status") == "settled":
            continue
        kickoff = commence if isinstance(commence, str) else _now_iso()
        doc = {
            "external_event_id": ext_id,
            "external_sport_key": WC_SPORT_KEY,
            "home_team_id": home_id,
            "away_team_id": away_id,
            "kickoff": kickoff,
            "lock_at": _lock_at_from_kickoff(kickoff),
            "stage": stage,
            "group_id": group_id,
            "status": "scheduled",
            "updated_at": now,
        }
        if existing:
            await db.world_cup_matches.update_one({"external_event_id": ext_id}, {"$set": doc})
        else:
            doc["id"] = str(uuid.uuid4())
            doc["created_at"] = now
            await db.world_cup_matches.insert_one(doc)
        synced += 1
    await db.game_config.update_one({"id": CONFIG_ID}, {"$set": {"last_fixture_sync_at": now}}, upsert=True)
    return {"synced": synced, "skipped": skipped, "source_events": len(events or [])}


def _scores_from_api_event(api_ev: dict) -> tuple:
    scores = api_ev.get("scores") or []
    home_name = (api_ev.get("home_team") or "").strip()
    away_name = (api_ev.get("away_team") or "").strip()
    h_val, a_val = None, None
    for s in scores:
        n = (s.get("name") or "").strip()
        try:
            v = int(s.get("score"))
        except (TypeError, ValueError):
            continue
        if sb._team_matches_option(home_name, n) or _norm_name(n) == _norm_name(home_name):
            h_val = v
        elif sb._team_matches_option(away_name, n) or _norm_name(n) == _norm_name(away_name):
            a_val = v
    return h_val, a_val


async def _auto_settle_from_scores(db, send_notification) -> dict:
    delay_min = SETTLE_MINUTES_AFTER
    try:
        delay_min = int(os.environ.get("WORLD_CUP_AUTO_SETTLE_MINUTES_AFTER_START", str(SETTLE_MINUTES_AFTER)))
    except (TypeError, ValueError):
        delay_min = SETTLE_MINUTES_AFTER
    now = datetime.now(timezone.utc)
    cfg = await _load_config(db)
    cursor = db.world_cup_matches.find(
        {"status": {"$ne": "settled"}, "external_event_id": {"$exists": True, "$ne": ""}},
        {"_id": 0},
    )
    due_ids = []
    async for m in cursor:
        kick = _parse_iso(m.get("kickoff"))
        if kick and now >= kick + timedelta(minutes=delay_min):
            due_ids.append(m.get("external_event_id"))
    if not due_ids:
        return {"settled": 0, "message": "No due matches"}
    api_events = await sb._fetch_odds_api_scores(WC_SPORT_KEY, days_from=3)
    settled = 0
    for api_ev in api_events or []:
        if not api_ev.get("completed"):
            continue
        ext_id = (api_ev.get("id") or "").strip()
        if ext_id not in due_ids:
            continue
        h, a = _scores_from_api_event(api_ev)
        if h is None or a is None:
            continue
        match = await db.world_cup_matches.find_one({"external_event_id": ext_id}, {"_id": 0})
        if not match or match.get("status") == "settled":
            continue
        await _apply_match_result(db, send_notification, cfg, match["id"], h, a)
        settled += 1
    await db.game_config.update_one({"id": CONFIG_ID}, {"$set": {"last_auto_settle_at": _now_iso()}}, upsert=True)
    return {"settled": settled}


async def _run_draft(db) -> dict:
    cfg = await _load_config(db)
    if cfg.get("draft_run"):
        raise HTTPException(status_code=400, detail="Draft already run")
    entries = await db.world_cup_entries.find({}, {"_id": 0, "user_id": 1}).to_list(5000)
    if not entries:
        raise HTTPException(status_code=400, detail="No entrants")
    teams = await db.world_cup_teams.find({}, {"_id": 0, "id": 1}).to_list(100)
    team_ids = [t["id"] for t in teams if t.get("id")]
    if not team_ids:
        raise HTTPException(status_code=400, detail="No teams seeded")
    seed = random.randint(0, 2**31 - 1)
    rng = random.Random(seed)
    shuffled = list(team_ids)
    rng.shuffle(shuffled)
    n_users = len(entries)
    assignments = {e["user_id"]: [] for e in entries}
    idx = 0
    for tid in shuffled:
        uid = entries[idx % n_users]["user_id"]
        assignments[uid].append(tid)
        idx += 1
    now = _now_iso()
    for uid, tids in assignments.items():
        await db.world_cup_entries.update_one(
            {"user_id": uid},
            {"$set": {"drafted_team_ids": tids, "draft_run_at": now}},
        )
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {"$set": {"draft_run": True, "draft_seed": seed, "draft_run_at": now}},
        upsert=True,
    )
    return {"entrants": n_users, "teams": len(team_ids), "draft_seed": seed}


async def _seed_2026(db) -> dict:
    path = WC_TEAMS_SEED_PATH
    if not path.is_file():
        raise HTTPException(status_code=500, detail=f"Seed file not found: {path}")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    await db.world_cup_teams.delete_many({})
    await db.world_cup_groups.delete_many({})
    teams_inserted = 0
    for grp in data.get("groups") or []:
        gid = grp.get("group_id")
        team_ids = []
        for t in grp.get("teams") or []:
            tid = str(uuid.uuid4())
            doc = {
                "id": tid,
                "name": t.get("name"),
                "short_code": t.get("short_code"),
                "flag_emoji": t.get("flag_emoji") or "",
                "group_id": gid,
                "odds_api_names": t.get("odds_api_names") or [],
            }
            await db.world_cup_teams.insert_one(doc)
            team_ids.append(tid)
            teams_inserted += 1
        await db.world_cup_groups.insert_one({"group_id": gid, "team_ids": team_ids, "winner_team_id": None})
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {
            "$setOnInsert": {"enabled": False, "ended_message": DEFAULT_ENDED_MESSAGE},
            "$set": {"seeded_at": _now_iso(), "phase": "upcoming"},
        },
        upsert=True,
    )
    return {"teams": teams_inserted, "groups": len(data.get("groups") or [])}


class WorldCupPredictionBody(BaseModel):
    type: str = Field(..., min_length=2)
    target_id: str = Field(..., min_length=1)
    value: Any = None


class WorldCupConfigPatch(BaseModel):
    enabled: Optional[bool] = None
    entry_open: Optional[bool] = None
    ended_message: Optional[str] = None
    auto_sync_enabled: Optional[bool] = None
    banner_text: Optional[str] = None
    phase: Optional[str] = None
    group_winner_points: Optional[int] = None
    jackpot_points: Optional[int] = None
    second_place_points: Optional[int] = None
    third_place_points: Optional[int] = None
    match_score_exact_points: Optional[int] = None
    match_score_result_points: Optional[int] = None
    match_scorer_points: Optional[int] = None


class MatchResultPatch(BaseModel):
    home_score: int = Field(..., ge=0, le=30)
    away_score: int = Field(..., ge=0, le=30)
    scorers: Optional[List[str]] = None
    stage: Optional[str] = None


class BulkMatchImport(BaseModel):
    matches: List[dict] = Field(default_factory=list)


def register(router):
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    send_notification = srv.send_notification
    _is_entertainer = srv._is_entertainer
    require_admin = srv.require_admin

    async def _wc_rl_user(current_user: dict = Depends(get_current_user)):
        await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_WORLD_CUP)

    _wc_rl = [Depends(_wc_rl_user)]

    @router.get("/world-cup/public-status")
    async def world_cup_public_status():
        cfg = await _load_config(db)
        return {
            "enabled": bool(cfg.get("enabled")),
            "ended_message": cfg.get("ended_message") or DEFAULT_ENDED_MESSAGE,
            "phase": cfg.get("phase") or "upcoming",
            "banner_text": (cfg.get("banner_text") or "").strip(),
        }

    @router.get("/world-cup/status", dependencies=_wc_rl)
    async def world_cup_status(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        uid = current_user.get("id") or ""
        if not cfg.get("enabled"):
            return {"enabled": False, "ended_message": cfg.get("ended_message") or DEFAULT_ENDED_MESSAGE}
        entry = await db.world_cup_entries.find_one({"user_id": uid}, {"_id": 0}) if uid else None
        group_locks = await _group_lock_times(db)
        teams = await db.world_cup_teams.find({}, {"_id": 0}).sort([("group_id", 1), ("name", 1)]).to_list(100)
        drafted = []
        if entry and entry.get("drafted_team_ids"):
            tmap = {t["id"]: t for t in teams}
            drafted = [tmap[tid] for tid in entry["drafted_team_ids"] if tid in tmap]
        return {
            "enabled": True,
            "config": {k: cfg.get(k) for k in list(DEFAULT_POINTS.keys()) + ["entry_open", "draft_run", "phase", "banner_text"]},
            "points": _points_from_config(cfg),
            "entered": bool(entry),
            "entry": entry,
            "drafted_teams": drafted,
            "group_locks": group_locks,
            "teams_count": len(teams),
        }

    @router.get("/world-cup/teams", dependencies=_wc_rl)
    async def world_cup_teams(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        teams = await db.world_cup_teams.find({}, {"_id": 0}).sort([("group_id", 1), ("name", 1)]).to_list(100)
        groups = await db.world_cup_groups.find({}, {"_id": 0}).sort("group_id", 1).to_list(20)
        return {"teams": teams, "groups": groups}

    @router.get("/world-cup/matches", dependencies=_wc_rl)
    async def world_cup_matches_list(
        stage: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        q = {}
        if stage:
            q["stage"] = stage
        matches = await db.world_cup_matches.find(q, {"_id": 0}).sort("kickoff", 1).to_list(500)
        teams = await _teams_by_id(db)
        out = []
        for m in matches:
            row = dict(m)
            row["home_team"] = teams.get(m.get("home_team_id"))
            row["away_team"] = teams.get(m.get("away_team_id"))
            row["locked"] = _is_locked(m.get("lock_at"))
            out.append(row)
        return {"matches": out}

    @router.get("/world-cup/my-predictions", dependencies=_wc_rl)
    async def world_cup_my_predictions(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        uid = current_user.get("id") or ""
        preds = await db.world_cup_predictions.find({"user_id": uid}, {"_id": 0}).to_list(500)
        return {"predictions": preds}

    @router.get("/world-cup/leaderboard", dependencies=_wc_rl)
    async def world_cup_leaderboard(limit: int = Query(50, ge=1, le=100), current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        uid = current_user.get("id") or ""
        pipeline = [
            {"$match": {"settled": True, "points_awarded": {"$gt": 0}}},
            {"$group": {"_id": "$user_id", "total": {"$sum": "$points_awarded"}}},
            {"$sort": {"total": -1}},
            {"$limit": int(limit)},
        ]
        rows = await db.world_cup_predictions.aggregate(pipeline).to_list(int(limit))
        jackpot_rows = await db.world_cup_entries.find({"jackpot_awarded": True}, {"_id": 0, "user_id": 1}).to_list(5000)
        totals = {r["_id"]: int(r["total"]) for r in rows}
        for e in jackpot_rows:
            uid_j = e.get("user_id")
            if uid_j:
                totals[uid_j] = totals.get(uid_j, 0) + _points_from_config(cfg)["jackpot_points"]
        sorted_users = sorted(totals.items(), key=lambda x: x[1], reverse=True)[: int(limit)]
        usernames = {}
        if sorted_users:
            ids = [u for u, _ in sorted_users]
            async for u in db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "username": 1}):
                usernames[u["id"]] = u.get("username") or "?"
        board = []
        my_rank = None
        for i, (user_id, total) in enumerate(sorted_users):
            rank = i + 1
            board.append({"rank": rank, "user_id": user_id, "username": usernames.get(user_id, "?"), "points": total})
            if user_id == uid:
                my_rank = rank
        my_total = totals.get(uid, 0)
        if uid and my_rank is None and my_total > 0:
            my_rank = len(sorted_users) + 1
        return {"leaderboard": board, "my_rank": my_rank, "my_points": my_total}

    @router.post("/world-cup/enter")
    async def world_cup_enter(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        if not cfg.get("entry_open", True):
            raise HTTPException(status_code=400, detail="Entry is closed")
        uid = current_user.get("id") or ""
        existing = await db.world_cup_entries.find_one({"user_id": uid})
        if existing:
            return {"ok": True, "already_entered": True}
        await db.world_cup_entries.insert_one({"user_id": uid, "entered_at": _now_iso(), "drafted_team_ids": []})
        return {"ok": True}

    @router.post("/world-cup/predictions")
    async def world_cup_save_prediction(body: WorldCupPredictionBody, current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        uid = current_user.get("id") or ""
        entry = await db.world_cup_entries.find_one({"user_id": uid})
        if not entry:
            raise HTTPException(status_code=400, detail="Enter the event first")
        ptype = (body.type or "").strip()
        target = (body.target_id or "").strip()
        if ptype not in (PRED_GROUP_WINNER, PRED_MATCH_SCORE, PRED_MATCH_SCORER, PRED_SECOND_PLACE, PRED_THIRD_PLACE):
            raise HTTPException(status_code=400, detail="Invalid prediction type")
        if ptype == PRED_GROUP_WINNER:
            if target not in GROUP_IDS:
                raise HTTPException(status_code=400, detail="Invalid group")
            locks = await _group_lock_times(db)
            if _is_locked(locks.get(target)):
                raise HTTPException(status_code=400, detail=f"Group {target} is locked")
            team_id = body.value.get("team_id") if isinstance(body.value, dict) else body.value
            if not team_id:
                raise HTTPException(status_code=400, detail="team_id required")
            t = await db.world_cup_teams.find_one({"id": team_id, "group_id": target})
            if not t:
                raise HTTPException(status_code=400, detail="Team not in group")
        elif ptype in (PRED_SECOND_PLACE, PRED_THIRD_PLACE):
            if cfg.get("draft_run") and ptype == PRED_SECOND_PLACE:
                pass
            team_id = body.value.get("team_id") if isinstance(body.value, dict) else body.value
            if not team_id or not await db.world_cup_teams.find_one({"id": team_id}):
                raise HTTPException(status_code=400, detail="Invalid team")
            target = "tournament"
        elif ptype == PRED_MATCH_SCORE:
            match = await db.world_cup_matches.find_one({"id": target}, {"_id": 0})
            if not match:
                raise HTTPException(status_code=404, detail="Match not found")
            if _is_locked(match.get("lock_at")):
                raise HTTPException(status_code=400, detail="Match is locked")
            val = body.value if isinstance(body.value, dict) else {}
            try:
                h, a = int(val.get("home")), int(val.get("away"))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="home and away scores required")
            if h < 0 or a < 0 or h > 20 or a > 20:
                raise HTTPException(status_code=400, detail="Invalid score")
            body.value = {"home": h, "away": a}
        elif ptype == PRED_MATCH_SCORER:
            match = await db.world_cup_matches.find_one({"id": target}, {"_id": 0})
            if not match:
                raise HTTPException(status_code=404, detail="Match not found")
            if _is_locked(match.get("lock_at")):
                raise HTTPException(status_code=400, detail="Match is locked")
            name = (body.value.get("name") if isinstance(body.value, dict) else str(body.value or "")).strip()
            if not name:
                raise HTTPException(status_code=400, detail="Scorer name required")
            body.value = {"name": name[:80]}
        now = _now_iso()
        existing = await db.world_cup_predictions.find_one({"user_id": uid, "type": ptype, "target_id": target})
        if existing:
            if existing.get("settled"):
                raise HTTPException(status_code=400, detail="Prediction already settled")
            await db.world_cup_predictions.update_one(
                {"id": existing["id"]},
                {"$set": {"value": body.value, "updated_at": now}},
            )
            return {"ok": True, "id": existing["id"]}
        pid = str(uuid.uuid4())
        await db.world_cup_predictions.insert_one(
            {
                "id": pid,
                "user_id": uid,
                "type": ptype,
                "target_id": target,
                "value": body.value,
                "settled": False,
                "points_awarded": 0,
                "created_at": now,
                "updated_at": now,
            }
        )
        return {"ok": True, "id": pid}

    # --- Staff ---
    def _require_ent(current_user: dict):
        if not _is_entertainer(current_user):
            raise HTTPException(status_code=403, detail="Entertainer access required")

    @router.get("/world-cup/staff/dashboard")
    async def wc_staff_dashboard(current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        entrants = await db.world_cup_entries.count_documents({})
        unsettled = await db.world_cup_matches.count_documents({"status": {"$ne": "settled"}})
        return {
            "entrants": entrants,
            "unsettled_matches": unsettled,
            "draft_run": bool(cfg.get("draft_run")),
            "last_fixture_sync_at": cfg.get("last_fixture_sync_at"),
            "last_auto_settle_at": cfg.get("last_auto_settle_at"),
        }

    @router.post("/world-cup/staff/run-draft")
    async def wc_staff_run_draft(current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _run_draft(db)

    @router.patch("/world-cup/staff/match/{match_id}/result")
    async def wc_staff_patch_result(match_id: str, body: MatchResultPatch, current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        if body.stage:
            await db.world_cup_matches.update_one({"id": match_id}, {"$set": {"stage": body.stage.strip().lower()}})
        return await _apply_match_result(db, send_notification, cfg, match_id, body.home_score, body.away_score, body.scorers)

    @router.post("/world-cup/staff/settle-match/{match_id}")
    async def wc_staff_settle_match(match_id: str, current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        match = await db.world_cup_matches.find_one({"id": match_id}, {"_id": 0})
        if not match or not match.get("result"):
            raise HTTPException(status_code=400, detail="Match needs result first")
        res = match["result"]
        return await _apply_match_result(db, send_notification, cfg, match_id, int(res["home_score"]), int(res["away_score"]), res.get("scorers"))

    @router.post("/world-cup/staff/settle-groups")
    async def wc_staff_settle_groups(group_id: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        gids = [group_id] if group_id else list(GROUP_IDS)
        done = 0
        for gid in gids:
            if gid and await _try_settle_group(db, send_notification, cfg, gid):
                done += 1
        return {"groups_settled": done}

    @router.post("/world-cup/staff/settle-tournament")
    async def wc_staff_settle_tournament(current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        champion = cfg.get("champion_team_id")
        if not champion:
            raise HTTPException(status_code=400, detail="Champion not set — settle final match first")
        return {"ok": True, "champion_team_id": champion}

    @router.get("/world-cup/staff/entries")
    async def wc_staff_entries(limit: int = Query(100, ge=1, le=500), current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        entries = await db.world_cup_entries.find({}, {"_id": 0}).limit(int(limit)).to_list(int(limit))
        return {"entries": entries}

    @router.get("/world-cup/staff/predictions")
    async def wc_staff_predictions(limit: int = Query(100, ge=1, le=500), current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        preds = await db.world_cup_predictions.find({}, {"_id": 0}).sort("created_at", -1).limit(int(limit)).to_list(int(limit))
        return {"predictions": preds}

    # --- Admin ---
    @router.post("/admin/world-cup/seed-2026")
    async def admin_wc_seed(current_user: dict = Depends(require_admin)):
        return await _seed_2026(db)

    @router.patch("/admin/world-cup/config")
    async def admin_wc_config(body: WorldCupConfigPatch, current_user: dict = Depends(require_admin)):
        patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
        if not patch:
            return await _load_config(db)
        if patch.get("enabled") is False:
            patch.setdefault("auto_sync_enabled", False)
        patch["updated_at"] = _now_iso()
        await db.game_config.update_one({"id": CONFIG_ID}, {"$set": patch}, upsert=True)
        return await _load_config(db)

    @router.get("/admin/world-cup/config")
    async def admin_wc_get_config(current_user: dict = Depends(require_admin)):
        return await _load_config(db)

    @router.post("/admin/world-cup/sync-fixtures")
    async def admin_wc_sync(current_user: dict = Depends(require_admin)):
        cfg = await _load_config(db)
        if not cfg.get("enabled"):
            raise HTTPException(status_code=400, detail="Enable event first")
        return await _sync_fixtures_from_odds(db)

    @router.post("/admin/world-cup/auto-settle-run")
    async def admin_wc_auto_settle(current_user: dict = Depends(require_admin)):
        cfg = await _load_config(db)
        if not cfg.get("enabled"):
            raise HTTPException(status_code=400, detail="Enable event first")
        return await _auto_settle_from_scores(db, send_notification)

    @router.get("/admin/world-cup/auto-sync-health")
    async def admin_wc_health(current_user: dict = Depends(require_admin)):
        cfg = await _load_config(db)
        unsettled = await db.world_cup_matches.count_documents({"status": {"$ne": "settled"}})
        entrants = await db.world_cup_entries.count_documents({})
        return {
            "enabled": bool(cfg.get("enabled")),
            "auto_sync_enabled": bool(cfg.get("auto_sync_enabled", True)),
            "last_fixture_sync_at": cfg.get("last_fixture_sync_at"),
            "last_auto_settle_at": cfg.get("last_auto_settle_at"),
            "unsettled_matches": unsettled,
            "entrants": entrants,
            "draft_run": bool(cfg.get("draft_run")),
            "odds_api_configured": bool(sb._odds_api_key()),
        }

    @router.post("/admin/world-cup/matches/bulk")
    async def admin_wc_bulk_matches(body: BulkMatchImport, current_user: dict = Depends(require_admin)):
        inserted = 0
        for raw in body.matches or []:
            home_id = raw.get("home_team_id")
            away_id = raw.get("away_team_id")
            kickoff = raw.get("kickoff") or _now_iso()
            doc = {
                "id": str(uuid.uuid4()),
                "home_team_id": home_id,
                "away_team_id": away_id,
                "kickoff": kickoff,
                "lock_at": _lock_at_from_kickoff(kickoff),
                "stage": raw.get("stage") or "group",
                "group_id": raw.get("group_id"),
                "status": "scheduled",
                "created_at": _now_iso(),
            }
            await db.world_cup_matches.insert_one(doc)
            inserted += 1
        return {"inserted": inserted}

    # --- Cron ---
    cron_secret = (os.environ.get("CRON_SECRET") or "").strip()

    async def verify_wc_cron(x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret")):
        if not cron_secret:
            raise HTTPException(status_code=503, detail="Cron not configured (CRON_SECRET unset)")
        if (x_cron_secret or "").strip() != cron_secret:
            raise HTTPException(status_code=403, detail="Invalid cron secret")

    async def _cron_guard():
        cfg = await _load_config(db)
        if not cfg.get("enabled") or not cfg.get("auto_sync_enabled", True):
            return {"message": "event_disabled", "enabled": cfg.get("enabled")}
        return None

    @router.post("/world-cup/cron/sync-fixtures")
    async def wc_cron_sync(_: None = Depends(verify_wc_cron)):
        disabled = await _cron_guard()
        if disabled:
            return disabled
        return await _sync_fixtures_from_odds(db)

    @router.post("/world-cup/cron/auto-settle")
    async def wc_cron_settle(_: None = Depends(verify_wc_cron)):
        disabled = await _cron_guard()
        if disabled:
            return disabled
        return await _auto_settle_from_scores(db, send_notification)


async def run_world_cup_auto_settle_ticker():
    """Background ticker for World Cup auto-settle."""
    import server as srv

    interval = max(900, int(os.environ.get("WORLD_CUP_AUTO_SETTLE_INTERVAL_SEC", "1800")))
    while True:
        try:
            cfg = await _load_config(srv.db)
            if cfg.get("enabled") and cfg.get("auto_sync_enabled", True):
                await _auto_settle_from_scores(srv.db, srv.send_notification)
        except Exception as ex:
            logger.warning("World Cup auto-settle ticker: %s", ex)
        await asyncio.sleep(interval)


async def run_world_cup_sync_ticker():
    """Background ticker for daily-ish fixture sync."""
    import server as srv

    interval = max(3600, int(os.environ.get("WORLD_CUP_SYNC_INTERVAL_SEC", "86400")))
    while True:
        try:
            cfg = await _load_config(srv.db)
            if cfg.get("enabled") and cfg.get("auto_sync_enabled", True):
                await _sync_fixtures_from_odds(srv.db)
        except Exception as ex:
            logger.warning("World Cup sync ticker: %s", ex)
        await asyncio.sleep(interval)
