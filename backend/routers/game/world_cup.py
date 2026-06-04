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
DRAFT_HOURS_BEFORE_START = 24
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


async def _is_ghost_user(db, user_id: str) -> bool:
    if not user_id:
        return False
    entry = await db.world_cup_entries.find_one({"user_id": user_id}, {"ghost_entry": 1})
    return bool(entry and entry.get("ghost_entry"))


async def _ghost_user_ids(db) -> set:
    ids = set()
    async for entry in db.world_cup_entries.find({"ghost_entry": True}, {"user_id": 1}):
        uid = entry.get("user_id")
        if uid:
            ids.add(uid)
    return ids


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
    pipeline = [
        {
            "$match": {
                "stage": "group",
                "group_id": {"$in": list(GROUP_IDS)},
                "kickoff": {"$exists": True, "$nin": [None, ""]},
            }
        },
        {"$sort": {"kickoff": 1}},
        {"$group": {"_id": "$group_id", "kickoff": {"$first": "$kickoff"}}},
    ]
    async for doc in db.world_cup_matches.aggregate(pipeline):
        gid = doc.get("_id")
        kickoff = doc.get("kickoff")
        if gid and kickoff:
            locks[gid] = _lock_at_from_kickoff(kickoff)
    return locks


async def _prediction_target_counts(db, types: list) -> dict:
    counts = {}
    if not types:
        return counts
    pipeline = [
        {"$match": {"type": {"$in": types}}},
        {"$group": {"_id": "$target_id", "n": {"$sum": 1}}},
    ]
    async for doc in db.world_cup_predictions.aggregate(pipeline):
        tid = doc.get("_id")
        if tid:
            counts[tid] = int(doc["n"])
    return counts


async def _prediction_global_stats(db) -> dict:
    pipeline = [
        {
            "$facet": {
                "open": [{"$match": {"settled": {"$ne": True}}}, {"$count": "n"}],
                "won": [{"$match": {"settled": True, "points_awarded": {"$gt": 0}}}, {"$count": "n"}],
                "lost": [{"$match": {"settled": True, "points_awarded": 0}}, {"$count": "n"}],
                "pending": [{"$match": {"payout_status": "pending"}}, {"$count": "n"}],
            }
        }
    ]
    rows = await db.world_cup_predictions.aggregate(pipeline).to_list(1)
    facet = rows[0] if rows else {}
    def _fc(key):
        arr = facet.get(key) or []
        return int(arr[0]["n"]) if arr else 0
    return {
        "predictions_open": _fc("open"),
        "predictions_won": _fc("won"),
        "predictions_lost": _fc("lost"),
        "predictions_pending_payout": _fc("pending"),
    }


async def _entry_counts(db) -> dict:
    pipeline = [
        {
            "$facet": {
                "total": [{"$count": "n"}],
                "real": [{"$match": {"ghost_entry": {"$ne": True}}}, {"$count": "n"}],
                "ghost": [{"$match": {"ghost_entry": True}}, {"$count": "n"}],
            }
        }
    ]
    rows = await db.world_cup_entries.aggregate(pipeline).to_list(1)
    facet = rows[0] if rows else {}
    def _fc(key):
        arr = facet.get(key) or []
        return int(arr[0]["n"]) if arr else 0
    return {"entrants": _fc("total"), "real_entrants": _fc("real"), "ghost_entrants": _fc("ghost")}


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
    pts = int(points or 0)
    payout_status = "none"
    if pts > 0:
        uid = pred.get("user_id") or ""
        if await _is_ghost_user(db, uid):
            payout_status = "ghost"
        else:
            payout_status = "pending"
    res = await db.world_cup_predictions.update_one(
        {"id": pid, "settled": {"$ne": True}},
        {
            "$set": {
                "settled": True,
                "points_awarded": pts,
                "settled_at": _now_iso(),
                "settle_label": label,
                "payout_status": payout_status,
            }
        },
    )
    return res.modified_count > 0


async def _approve_prediction_payout(db, send_notification, prediction_id: str, approver_id: str) -> dict:
    pred = await db.world_cup_predictions.find_one({"id": prediction_id}, {"_id": 0})
    if not pred:
        raise HTTPException(status_code=404, detail="Prediction not found")
    if pred.get("payout_status") != "pending":
        raise HTTPException(status_code=400, detail="Prediction payout is not pending approval")
    pts = int(pred.get("points_awarded") or 0)
    uid = pred.get("user_id") or ""
    label = pred.get("settle_label") or "World Cup prediction"
    res = await db.world_cup_predictions.update_one(
        {"id": prediction_id, "payout_status": "pending"},
        {"$set": {"payout_status": "paid", "payout_approved_at": _now_iso(), "payout_approved_by": approver_id}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Payout already processed")
    if pts > 0 and uid:
        await _award_points(db, send_notification, uid, pts, prediction_id, label)
    return {"ok": True, "prediction_id": prediction_id, "points": pts}


async def _approve_jackpot_payout(db, send_notification, user_id: str, approver_id: str) -> dict:
    entry = await db.world_cup_entries.find_one({"user_id": user_id}, {"_id": 0})
    if not entry or not entry.get("jackpot_pending"):
        raise HTTPException(status_code=400, detail="No pending jackpot for this user")
    pts = int(entry.get("jackpot_points_pending") or 0)
    champion = entry.get("jackpot_champion_team_id") or ""
    label = entry.get("jackpot_label") or "World Cup champion (draft)"
    ref = f"jackpot:{user_id}:{champion}"
    res = await db.world_cup_entries.update_one(
        {"user_id": user_id, "jackpot_pending": True},
        {
            "$set": {
                "jackpot_pending": False,
                "jackpot_awarded": True,
                "jackpot_awarded_at": _now_iso(),
                "jackpot_payout_approved_by": approver_id,
            }
        },
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Jackpot payout already processed")
    if pts > 0:
        await _award_points(db, send_notification, user_id, pts, ref, label)
    return {"ok": True, "user_id": user_id, "points": pts}


async def _approve_all_pending_payouts(db, send_notification, approver_id: str) -> dict:
    preds = await db.world_cup_predictions.find({"payout_status": "pending"}, {"_id": 0, "id": 1}).to_list(5000)
    pred_approved = 0
    pred_points = 0
    for pred in preds:
        pid = pred.get("id")
        if not pid:
            continue
        try:
            result = await _approve_prediction_payout(db, send_notification, pid, approver_id)
            pred_approved += 1
            pred_points += int(result.get("points") or 0)
        except HTTPException:
            continue
    jackpots = await db.world_cup_entries.find({"jackpot_pending": True}, {"_id": 0, "user_id": 1}).to_list(500)
    jackpot_approved = 0
    jackpot_points = 0
    for entry in jackpots:
        uid = entry.get("user_id")
        if not uid:
            continue
        try:
            result = await _approve_jackpot_payout(db, send_notification, uid, approver_id)
            jackpot_approved += 1
            jackpot_points += int(result.get("points") or 0)
        except HTTPException:
            continue
    return {
        "predictions_approved": pred_approved,
        "jackpots_approved": jackpot_approved,
        "total_points": pred_points + jackpot_points,
    }


async def _pending_payout_counts(db) -> dict:
    pending_predictions = await db.world_cup_predictions.count_documents({"payout_status": "pending"})
    pending_jackpots = await db.world_cup_entries.count_documents({"jackpot_pending": True})
    return {
        "pending_predictions": pending_predictions,
        "pending_jackpots": pending_jackpots,
        "pending_payouts": pending_predictions + pending_jackpots,
    }


async def _list_pending_payouts(db, limit: int = 100) -> dict:
    lim = max(1, min(int(limit), 500))
    preds = await db.world_cup_predictions.find(
        {"payout_status": "pending"},
        {"_id": 0},
    ).sort("settled_at", -1).limit(lim).to_list(lim)
    jackpots = await db.world_cup_entries.find(
        {"jackpot_pending": True},
        {"_id": 0},
    ).sort("jackpot_pending_at", -1).limit(lim).to_list(lim)
    user_ids = {p.get("user_id") for p in preds if p.get("user_id")}
    user_ids.update(e.get("user_id") for e in jackpots if e.get("user_id"))
    usernames = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": list(user_ids)}}, {"_id": 0, "id": 1, "username": 1}):
            usernames[u["id"]] = u.get("username") or "?"
    pred_rows = []
    for p in preds:
        pred_rows.append({
            "id": p.get("id"),
            "user_id": p.get("user_id"),
            "username": usernames.get(p.get("user_id"), "?"),
            "type": p.get("type"),
            "target_id": p.get("target_id"),
            "points": int(p.get("points_awarded") or 0),
            "label": p.get("settle_label") or "",
            "settled_at": p.get("settled_at"),
        })
    jackpot_rows = []
    for e in jackpots:
        jackpot_rows.append({
            "user_id": e.get("user_id"),
            "username": usernames.get(e.get("user_id"), "?"),
            "points": int(e.get("jackpot_points_pending") or 0),
            "label": e.get("jackpot_label") or "World Cup champion (draft)",
            "pending_at": e.get("jackpot_pending_at"),
        })
    counts = await _pending_payout_counts(db)
    return {**counts, "predictions": pred_rows, "jackpots": jackpot_rows}


def _prediction_type_label(ptype: str) -> str:
    return {
        PRED_GROUP_WINNER: "Group winner",
        PRED_MATCH_SCORE: "Match score",
        PRED_MATCH_SCORER: "Goal scorer",
        PRED_SECOND_PLACE: "2nd place",
        PRED_THIRD_PLACE: "3rd place",
    }.get(ptype or "", ptype or "?")


def _team_brief(team: dict) -> dict:
    if not team:
        return {}
    return {k: team.get(k) for k in ("id", "name", "short_code", "group_id") if team.get(k)}


def _match_snapshot(match: Optional[dict], teams_by_id: dict) -> Optional[dict]:
    if not match:
        return None
    ht = teams_by_id.get(match.get("home_team_id")) or {}
    at = teams_by_id.get(match.get("away_team_id")) or {}
    res = match.get("result") or {}
    has_score = res.get("home_score") is not None and res.get("away_score") is not None
    return {
        "id": match.get("id"),
        "external_event_id": match.get("external_event_id"),
        "kickoff": match.get("kickoff"),
        "lock_at": match.get("lock_at"),
        "stage": match.get("stage"),
        "group_id": match.get("group_id"),
        "status": match.get("status"),
        "home_team": _team_brief(ht),
        "away_team": _team_brief(at),
        "label": f"{ht.get('name') or '?'} vs {at.get('name') or '?'}",
        "locked": _is_locked(match.get("lock_at")),
        "result": {
            "home_score": res.get("home_score"),
            "away_score": res.get("away_score"),
            "scorers": list(res.get("scorers") or []),
            "display": f"{res.get('home_score')}-{res.get('away_score')}" if has_score else None,
        } if has_score else None,
    }


def _points_for_type(cfg: dict, ptype: str, *, exact_score: bool = False) -> int:
    pts = _points_from_config(cfg)
    if ptype == PRED_GROUP_WINNER:
        return pts["group_winner_points"]
    if ptype == PRED_MATCH_SCORE:
        return pts["match_score_exact_points"] if exact_score else pts["match_score_result_points"]
    if ptype == PRED_MATCH_SCORER:
        return pts["match_scorer_points"]
    if ptype == PRED_SECOND_PLACE:
        return pts["second_place_points"]
    if ptype == PRED_THIRD_PLACE:
        return pts["third_place_points"]
    return 0


def _verification_for_prediction(
    pred: dict,
    ptype: str,
    target: str,
    val: dict,
    cfg: dict,
    teams_by_id: dict,
    matches_by_id: dict,
    groups_by_id: dict,
) -> dict:
    pick_display = ""
    actual_display = ""
    verdict = "pending"
    expected_points = 0

    if ptype == PRED_GROUP_WINNER:
        tid = val.get("team_id") if isinstance(val, dict) else val
        team = teams_by_id.get(tid) or {}
        pick_display = team.get("name") or str(tid or "?")
        grp = groups_by_id.get(target) or {}
        winner_id = grp.get("winner_team_id")
        if winner_id:
            winner = teams_by_id.get(winner_id) or {}
            actual_display = winner.get("name") or str(winner_id)
            verdict = "correct" if str(tid) == str(winner_id) else "incorrect"
            expected_points = _points_for_type(cfg, ptype) if verdict == "correct" else 0
        else:
            actual_display = "—"
    elif ptype == PRED_MATCH_SCORE:
        match = matches_by_id.get(target) or {}
        ht = teams_by_id.get(match.get("home_team_id")) or {}
        at = teams_by_id.get(match.get("away_team_id")) or {}
        ph = val.get("home") if isinstance(val, dict) else None
        pa = val.get("away") if isinstance(val, dict) else None
        pick_display = f"{ph}-{pa}" if ph is not None and pa is not None else "?"
        res = match.get("result") or {}
        if res.get("home_score") is not None and res.get("away_score") is not None:
            ah, aa = int(res["home_score"]), int(res["away_score"])
            actual_display = f"{ah}-{aa}"
            if ph == ah and pa == aa:
                verdict = "correct"
                expected_points = _points_for_type(cfg, ptype, exact_score=True)
            elif _match_result_outcome(int(ph), int(pa)) == _match_result_outcome(ah, aa):
                verdict = "result_correct"
                expected_points = _points_for_type(cfg, ptype, exact_score=False)
            else:
                verdict = "incorrect"
        else:
            actual_display = "—"
    elif ptype == PRED_MATCH_SCORER:
        match = matches_by_id.get(target) or {}
        pick_name = _norm_name(val.get("name") if isinstance(val, dict) else str(val or ""))
        pick_display = (val.get("name") if isinstance(val, dict) else str(val or "")) or "?"
        res = match.get("result") or {}
        scorers = [_norm_name(x) for x in (res.get("scorers") or []) if x]
        if scorers:
            actual_display = ", ".join(res.get("scorers") or [])
            verdict = "correct" if pick_name and pick_name in scorers else "incorrect"
            expected_points = _points_for_type(cfg, ptype) if verdict == "correct" else 0
        else:
            actual_display = "—"
    elif ptype == PRED_SECOND_PLACE:
        tid = val.get("team_id") if isinstance(val, dict) else val
        team = teams_by_id.get(tid) or {}
        pick_display = team.get("name") or "?"
        actual_id = cfg.get("runner_up_team_id")
        if actual_id:
            actual_display = (teams_by_id.get(actual_id) or {}).get("name") or str(actual_id)
            verdict = "correct" if str(tid) == str(actual_id) else "incorrect"
            expected_points = _points_for_type(cfg, ptype) if verdict == "correct" else 0
        else:
            actual_display = "—"
    elif ptype == PRED_THIRD_PLACE:
        tid = val.get("team_id") if isinstance(val, dict) else val
        team = teams_by_id.get(tid) or {}
        pick_display = team.get("name") or "?"
        actual_id = cfg.get("third_place_team_id")
        if actual_id:
            actual_display = (teams_by_id.get(actual_id) or {}).get("name") or str(actual_id)
            verdict = "correct" if str(tid) == str(actual_id) else "incorrect"
            expected_points = _points_for_type(cfg, ptype) if verdict == "correct" else 0
        else:
            actual_display = "—"

    return {
        "pick": pick_display,
        "actual": actual_display,
        "verdict": verdict,
        "expected_points": expected_points,
    }


def _enrich_prediction_for_staff(
    pred: dict,
    teams_by_id: dict,
    matches_by_id: dict,
    groups_by_id: dict,
    usernames: dict,
    entries_by_user: dict,
    cfg: dict,
) -> dict:
    ptype = pred.get("type")
    target = pred.get("target_id")
    val = pred.get("value") or {}
    uid = pred.get("user_id")
    entry = entries_by_user.get(uid) or {}
    verification = _verification_for_prediction(pred, ptype, target, val, cfg, teams_by_id, matches_by_id, groups_by_id)
    row = {
        "id": pred.get("id"),
        "user_id": uid,
        "username": usernames.get(uid, "?"),
        "type": ptype,
        "type_label": _prediction_type_label(ptype),
        "target_id": target,
        "value": val,
        "settled": bool(pred.get("settled")),
        "settled_at": pred.get("settled_at"),
        "payout_status": pred.get("payout_status"),
        "payout_approved_at": pred.get("payout_approved_at"),
        "points_awarded": int(pred.get("points_awarded") or 0),
        "settle_label": pred.get("settle_label") or "",
        "created_at": pred.get("created_at"),
        "updated_at": pred.get("updated_at"),
        "summary": "",
        "pick": verification["pick"],
        "actual": verification["actual"],
        "verdict": verification["verdict"],
        "expected_points": verification["expected_points"],
        "entrant": {
            "entered": bool(entry),
            "ghost_entry": bool(entry.get("ghost_entry")),
            "entered_at": entry.get("entered_at"),
            "drafted_team_count": len(entry.get("drafted_team_ids") or []),
        },
    }
    if ptype == PRED_GROUP_WINNER:
        tid = val.get("team_id") if isinstance(val, dict) else val
        team = teams_by_id.get(tid) or {}
        grp = groups_by_id.get(target) or {}
        row["summary"] = f"Group {target}: {team.get('name') or tid or '?'}"
        row["team"] = _team_brief(team)
        row["group"] = {
            "group_id": target,
            "winner_team_id": grp.get("winner_team_id"),
            "winner_team": _team_brief(teams_by_id.get(grp.get("winner_team_id") or "")),
            "settled_at": grp.get("settled_at"),
        }
        row["target_label"] = f"Group {target}"
    elif ptype in (PRED_MATCH_SCORE, PRED_MATCH_SCORER):
        match = matches_by_id.get(target) or {}
        snap = _match_snapshot(match, teams_by_id)
        row["match"] = snap
        row["target_label"] = snap.get("label") if snap else target
        if ptype == PRED_MATCH_SCORE:
            h, a = val.get("home"), val.get("away")
            row["summary"] = f"{row['target_label']} → pick {h}-{a}"
        else:
            scorer = val.get("name") if isinstance(val, dict) else str(val or "")
            row["summary"] = f"{row['target_label']} → scorer: {scorer or '?'}"
    elif ptype in (PRED_SECOND_PLACE, PRED_THIRD_PLACE):
        tid = val.get("team_id") if isinstance(val, dict) else val
        team = teams_by_id.get(tid) or {}
        place = "2nd" if ptype == PRED_SECOND_PLACE else "3rd"
        row["summary"] = f"{place} place: {team.get('name') or '?'}"
        row["team"] = _team_brief(team)
        row["target_label"] = "Tournament"
        row["tournament"] = {
            "runner_up_team_id": cfg.get("runner_up_team_id"),
            "third_place_team_id": cfg.get("third_place_team_id"),
            "champion_team_id": cfg.get("champion_team_id"),
        }
    else:
        row["summary"] = str(val)[:120]
        row["target_label"] = target
    return row


async def _build_staff_predictions_feed(
    db,
    limit: int = 500,
    pred_type: Optional[str] = None,
    match_id: Optional[str] = None,
    group_id: Optional[str] = None,
    username: Optional[str] = None,
    settled: Optional[bool] = None,
    payout_status: Optional[str] = None,
    verdict: Optional[str] = None,
) -> dict:
    cfg = await _load_config(db)
    q: dict = {}
    if pred_type:
        q["type"] = pred_type
    if match_id:
        q["target_id"] = match_id
        q["type"] = {"$in": [PRED_MATCH_SCORE, PRED_MATCH_SCORER]}
    elif group_id:
        q["target_id"] = group_id.upper()
        q["type"] = PRED_GROUP_WINNER
    if settled is not None:
        q["settled"] = bool(settled)
    if payout_status:
        q["payout_status"] = payout_status
    if username and username.strip():
        uname = username.strip()
        user_ids = []
        async for u in db.users.find(
            {"username": {"$regex": re.escape(uname), "$options": "i"}},
            {"_id": 0, "id": 1},
        ).limit(50):
            if u.get("id"):
                user_ids.append(u["id"])
        if not user_ids:
            return {"predictions": [], "counts": {}, "total_shown": 0, "matches": [], "points_reference": _points_from_config(cfg)}
        q["user_id"] = {"$in": user_ids}
    lim = max(1, min(int(limit), 2000))
    preds = await db.world_cup_predictions.find(q, {"_id": 0}).sort("updated_at", -1).limit(lim).to_list(lim)
    teams_by_id = await _teams_by_id(db)
    matches_by_id = {}
    async for m in db.world_cup_matches.find({}, {"_id": 0}):
        mid = m.get("id")
        if mid:
            matches_by_id[mid] = m
    groups_by_id = {}
    async for g in db.world_cup_groups.find({}, {"_id": 0}):
        gid = g.get("group_id")
        if gid:
            groups_by_id[gid] = g
    user_ids = list({p.get("user_id") for p in preds if p.get("user_id")})
    usernames = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
            usernames[u["id"]] = u.get("username") or "?"
    entries_by_user = {}
    if user_ids:
        async for e in db.world_cup_entries.find({"user_id": {"$in": user_ids}}, {"_id": 0}):
            entries_by_user[e.get("user_id")] = e
    enriched = [
        _enrich_prediction_for_staff(p, teams_by_id, matches_by_id, groups_by_id, usernames, entries_by_user, cfg)
        for p in preds
    ]
    if verdict:
        enriched = [r for r in enriched if r.get("verdict") == verdict]
    counts = {}
    async for doc in db.world_cup_predictions.aggregate([{"$group": {"_id": "$type", "n": {"$sum": 1}}}]):
        counts[doc["_id"]] = int(doc["n"])
    match_pred_counts = await _prediction_target_counts(db, [PRED_MATCH_SCORE, PRED_MATCH_SCORER])
    group_pred_counts = await _prediction_target_counts(db, [PRED_GROUP_WINNER])
    match_options = []
    for mid, m in matches_by_id.items():
        snap = _match_snapshot(m, teams_by_id)
        match_options.append({
            "id": mid,
            "label": snap.get("label") if snap else f"{mid}",
            "kickoff": m.get("kickoff"),
            "stage": m.get("stage"),
            "status": m.get("status"),
            "result": (snap or {}).get("result"),
            "prediction_count": match_pred_counts.get(mid, 0),
        })
    match_options.sort(key=lambda x: x.get("kickoff") or "")
    group_options = []
    for gid in GROUP_IDS:
        grp = groups_by_id.get(gid) or {}
        winner = teams_by_id.get(grp.get("winner_team_id") or "") or {}
        group_options.append({
            "group_id": gid,
            "winner_team": _team_brief(winner),
            "settled": bool(grp.get("winner_team_id")),
            "prediction_count": group_pred_counts.get(gid, 0),
        })
    return {
        "predictions": enriched,
        "counts": counts,
        "total_shown": len(enriched),
        "matches": match_options,
        "groups": group_options,
        "points_reference": _points_from_config(cfg),
        "tournament": {
            "champion_team_id": cfg.get("champion_team_id"),
            "runner_up_team_id": cfg.get("runner_up_team_id"),
            "third_place_team_id": cfg.get("third_place_team_id"),
        },
    }


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
        now = _now_iso()
        async for entry in db.world_cup_entries.find(
            {
                "jackpot_awarded": {"$ne": True},
                "jackpot_pending": {"$ne": True},
                "ghost_entry": {"$ne": True},
            },
            {"_id": 0},
        ):
            drafted = entry.get("drafted_team_ids") or []
            if str(champion) not in [str(x) for x in drafted]:
                continue
            uid = entry.get("user_id")
            if not uid:
                continue
            await db.world_cup_entries.update_one(
                {"user_id": uid},
                {
                    "$set": {
                        "jackpot_pending": True,
                        "jackpot_points_pending": jackpot,
                        "jackpot_pending_at": now,
                        "jackpot_champion_team_id": champion,
                        "jackpot_label": "World Cup champion (draft)",
                    }
                },
            )
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
    await _refresh_tournament_start_in_config(db)
    return {"synced": synced, "skipped": skipped, "source_events": len(events or [])}


async def _get_tournament_start_at(db, cfg: dict) -> Optional[datetime]:
    explicit = _parse_iso(cfg.get("tournament_start_at"))
    if explicit:
        return explicit
    cursor = db.world_cup_matches.find(
        {"kickoff": {"$exists": True, "$nin": [None, ""]}},
        {"kickoff": 1},
    ).sort("kickoff", 1).limit(1)
    docs = await cursor.to_list(1)
    if docs and docs[0].get("kickoff"):
        return _parse_iso(docs[0]["kickoff"])
    return None


def _is_tournament_started_at(start: Optional[datetime]) -> bool:
    if not start:
        return False
    return datetime.now(timezone.utc) >= start


async def _is_tournament_started(db, cfg: dict) -> bool:
    start = await _get_tournament_start_at(db, cfg)
    return _is_tournament_started_at(start)


async def _refresh_tournament_start_in_config(db) -> Optional[str]:
    cursor = db.world_cup_matches.find(
        {"kickoff": {"$exists": True, "$nin": [None, ""]}},
        {"kickoff": 1},
    ).sort("kickoff", 1).limit(1)
    docs = await cursor.to_list(1)
    if not docs or not docs[0].get("kickoff"):
        return None
    kickoff = docs[0]["kickoff"]
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {"$set": {"tournament_start_at": kickoff, "tournament_start_updated_at": _now_iso()}},
        upsert=True,
    )
    return kickoff


def _draft_timing_payload(cfg: dict, tournament_start: Optional[datetime]) -> dict:
    draft_at = None
    if tournament_start:
        draft_at = tournament_start - timedelta(hours=DRAFT_HOURS_BEFORE_START)
    return {
        "tournament_start_at": tournament_start.isoformat() if tournament_start else cfg.get("tournament_start_at"),
        "draft_scheduled_at": draft_at.isoformat() if draft_at else None,
        "draft_run_at": cfg.get("draft_run_at"),
        "draft_hours_before_start": DRAFT_HOURS_BEFORE_START,
    }


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


async def _run_draft_internal(db, send_notification=None) -> dict:
    cfg = await _load_config(db)
    if cfg.get("draft_run"):
        return {"ok": False, "error": "Draft already run"}
    entries = await db.world_cup_entries.find({}, {"_id": 0, "user_id": 1, "ghost_entry": 1}).to_list(5000)
    if not entries:
        return {"ok": False, "error": "No entrants"}
    real_entries = [e for e in entries if not e.get("ghost_entry")]
    if not real_entries:
        return {"ok": False, "error": "No real entrants (ghost-only)"}
    teams = await db.world_cup_teams.find({}, {"_id": 0, "id": 1}).to_list(100)
    team_ids = [t["id"] for t in teams if t.get("id")]
    if not team_ids:
        return {"ok": False, "error": "No teams seeded"}
    seed = random.randint(0, 2**31 - 1)
    rng = random.Random(seed)
    shuffled = list(team_ids)
    rng.shuffle(shuffled)
    n_all = len(entries)
    ghost_count = n_all - len(real_entries)
    assignments = {e["user_id"]: [] for e in entries}
    n_real = len(real_entries)
    for i, tid in enumerate(shuffled):
        uid = real_entries[i % n_real]["user_id"]
        assignments[uid].append(tid)
    for i, entry in enumerate(entries):
        if not entry.get("ghost_entry"):
            continue
        uid = entry["user_id"]
        assignments[uid] = [shuffled[j] for j in range(i, len(shuffled), n_all)]
    now = _now_iso()
    for uid, tids in assignments.items():
        await db.world_cup_entries.update_one(
            {"user_id": uid},
            {"$set": {"drafted_team_ids": tids, "draft_run_at": now}},
        )
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {"$set": {"draft_run": True, "draft_seed": seed, "draft_run_at": now, "entry_open": False}},
        upsert=True,
    )
    if send_notification:
        await _notify_draft_assignments(db, send_notification, assignments, entries)
    real_counts = [len(assignments[e["user_id"]]) for e in real_entries]
    return {
        "ok": True,
        "entrants": n_all,
        "real_entrants": len(real_entries),
        "ghost_entrants": ghost_count,
        "teams": len(team_ids),
        "draft_seed": seed,
        "teams_per_user_min": min(real_counts) if real_counts else 0,
        "teams_per_user_max": max(real_counts) if real_counts else 0,
    }


async def _notify_draft_assignments(db, send_notification, assignments: dict, entries: list) -> None:
    ghost_ids = {e["user_id"] for e in entries if e.get("ghost_entry")}
    teams = await _teams_by_id(db)
    for uid, tids in assignments.items():
        if uid in ghost_ids or not tids:
            continue
        names = [teams[tid].get("name") or "?" for tid in tids if tid in teams]
        if not names:
            continue
        n = len(names)
        preview = ", ".join(names[:5])
        if n > 5:
            preview += f" (+{n - 5} more)"
        try:
            await send_notification(
                uid,
                "World Cup draft",
                f"Team draft complete — you were assigned {n} nation(s): {preview}.",
                "info",
                category="world_cup",
            )
        except Exception:
            pass


async def _run_draft(db, send_notification=None) -> dict:
    result = await _run_draft_internal(db, send_notification)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Draft failed")
    return {k: v for k, v in result.items() if k != "ok"}


async def _auto_run_draft_if_due(db, send_notification=None) -> dict:
    cfg = await _load_config(db)
    if not cfg.get("enabled"):
        return {"skipped": True, "reason": "disabled"}
    if cfg.get("draft_run"):
        return {"skipped": True, "reason": "already_run"}
    start = await _get_tournament_start_at(db, cfg)
    if not start:
        return {"skipped": True, "reason": "no_tournament_start"}
    draft_at = start - timedelta(hours=DRAFT_HOURS_BEFORE_START)
    now = datetime.now(timezone.utc)
    timing = _draft_timing_payload(cfg, start)
    if now < draft_at:
        return {"skipped": True, "reason": "not_due", **timing}
    result = await _run_draft_internal(db, send_notification)
    if not result.get("ok"):
        return {"skipped": True, "reason": result.get("error", "failed"), **timing, **result}
    await db.game_config.update_one(
        {"id": CONFIG_ID},
        {"$set": {"auto_draft_ran_at": _now_iso()}},
        upsert=True,
    )
    return {"ok": True, "auto": True, **timing, **{k: v for k, v in result.items() if k != "ok"}}


async def _build_draft_results(db) -> dict:
    cfg = await _load_config(db)
    start = await _get_tournament_start_at(db, cfg)
    timing = _draft_timing_payload(cfg, start)
    if not cfg.get("draft_run"):
        return {"draft_run": False, **timing, "assignments": []}
    teams = await _teams_by_id(db)
    entries = await db.world_cup_entries.find(
        {"ghost_entry": {"$ne": True}},
        {"_id": 0, "user_id": 1, "drafted_team_ids": 1, "entered_at": 1},
    ).sort("entered_at", 1).to_list(5000)
    user_ids = [e["user_id"] for e in entries if e.get("user_id")]
    usernames = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
            usernames[u["id"]] = u.get("username") or "?"
    assignments = []
    team_total = 0
    for e in entries:
        uid = e.get("user_id")
        tids = e.get("drafted_team_ids") or []
        team_objs = [teams[tid] for tid in tids if tid in teams]
        team_total += len(team_objs)
        assignments.append({
            "user_id": uid,
            "username": usernames.get(uid, "?"),
            "teams": team_objs,
            "team_count": len(team_objs),
        })
    assignments.sort(key=lambda x: (-x["team_count"], (x.get("username") or "").lower()))
    all_teams = await db.world_cup_teams.count_documents({})
    counts = [a["team_count"] for a in assignments]
    return {
        "draft_run": True,
        **timing,
        "real_entrants": len(assignments),
        "total_teams_distributed": team_total,
        "total_teams": all_teams,
        "teams_per_user_min": min(counts) if counts else 0,
        "teams_per_user_max": max(counts) if counts else 0,
        "assignments": assignments,
    }


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


def _summarize_user_predictions(preds: list, teams_by_id: dict) -> dict:
    stats = {
        "total": len(preds),
        "open": 0,
        "won": 0,
        "lost": 0,
        "pending_payout": 0,
        "points_paid": 0,
        "points_pending": 0,
    }
    group_picks = {}
    second_place = None
    third_place = None
    for p in preds:
        pts = int(p.get("points_awarded") or 0)
        if not p.get("settled"):
            stats["open"] += 1
        elif pts > 0:
            stats["won"] += 1
            if p.get("payout_status") == "pending":
                stats["pending_payout"] += 1
                stats["points_pending"] += pts
            elif p.get("payout_status") == "paid":
                stats["points_paid"] += pts
            elif p.get("payout_status") != "ghost":
                stats["points_paid"] += pts
        else:
            stats["lost"] += 1
        ptype = p.get("type")
        val = p.get("value") or {}
        if ptype == PRED_GROUP_WINNER:
            tid = val.get("team_id") if isinstance(val, dict) else val
            group_picks[p.get("target_id") or "?"] = (teams_by_id.get(tid) or {}).get("name") or "?"
        elif ptype == PRED_SECOND_PLACE:
            tid = val.get("team_id") if isinstance(val, dict) else val
            second_place = (teams_by_id.get(tid) or {}).get("name") or "?"
        elif ptype == PRED_THIRD_PLACE:
            tid = val.get("team_id") if isinstance(val, dict) else val
            third_place = (teams_by_id.get(tid) or {}).get("name") or "?"
    return {
        **stats,
        "group_picks": group_picks,
        "second_place": second_place,
        "third_place": third_place,
    }


async def _build_admin_leaderboard(db, cfg: dict, ghost_ids: set, limit: int = 100) -> list:
    pts_cfg = _points_from_config(cfg)
    jackpot_pts = pts_cfg["jackpot_points"]
    ghost_list = list(ghost_ids) if ghost_ids else []
    match_filter = {"settled": True, "points_awarded": {"$gt": 0}}
    if ghost_list:
        match_filter["user_id"] = {"$nin": ghost_list}
    pipeline = [
        {"$match": match_filter},
        {
            "$group": {
                "_id": "$user_id",
                "points_paid": {
                    "$sum": {"$cond": [{"$ne": ["$payout_status", "pending"]}, "$points_awarded", 0]}
                },
                "points_pending": {
                    "$sum": {"$cond": [{"$eq": ["$payout_status", "pending"]}, "$points_awarded", 0]}
                },
                "wins": {"$sum": 1},
            }
        },
        {"$sort": {"points_paid": -1, "points_pending": -1}},
        {"$limit": int(limit) * 2},
    ]
    totals: Dict[str, dict] = {}
    async for doc in db.world_cup_predictions.aggregate(pipeline):
        uid = doc.get("_id")
        if not uid:
            continue
        totals[uid] = {
            "points_paid": int(doc.get("points_paid") or 0),
            "points_pending": int(doc.get("points_pending") or 0),
            "wins": int(doc.get("wins") or 0),
        }
    async for e in db.world_cup_entries.find(
        {"ghost_entry": {"$ne": True}, "$or": [{"jackpot_awarded": True}, {"jackpot_pending": True}]},
        {"_id": 0, "user_id": 1, "jackpot_pending": 1, "jackpot_awarded": 1},
    ):
        uid = e.get("user_id")
        if not uid:
            continue
        row = totals.setdefault(uid, {"points_paid": 0, "points_pending": 0, "wins": 0})
        if e.get("jackpot_pending"):
            row["points_pending"] += jackpot_pts
            row["wins"] += 1
        elif e.get("jackpot_awarded"):
            row["points_paid"] += jackpot_pts
            row["wins"] += 1
    if not totals:
        return []
    user_ids = list(totals.keys())
    usernames = {}
    async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
        usernames[u["id"]] = u.get("username") or "?"
    rows = []
    for uid, t in totals.items():
        paid = int(t["points_paid"])
        pending = int(t["points_pending"])
        rows.append({
            "user_id": uid,
            "username": usernames.get(uid, "?"),
            "points_paid": paid,
            "points_pending": pending,
            "points_total": paid + pending,
            "wins": int(t["wins"]),
        })
    rows.sort(key=lambda x: (-x["points_total"], -x["points_paid"], x["username"].lower()))
    for i, row in enumerate(rows[:limit]):
        row["rank"] = i + 1
    return rows[:limit]


async def _build_admin_overview(db, username: Optional[str] = None, limit: int = 500) -> dict:
    cfg = await _load_config(db)
    teams_by_id = await _teams_by_id(db)
    ghost_ids = await _ghost_user_ids(db)
    start = await _get_tournament_start_at(db, cfg)
    tournament_started = _is_tournament_started_at(start)
    q: dict = {}
    if username and username.strip():
        uname = username.strip()
        user_ids = []
        async for u in db.users.find(
            {"username": {"$regex": re.escape(uname), "$options": "i"}},
            {"_id": 0, "id": 1},
        ).limit(50):
            if u.get("id"):
                user_ids.append(u["id"])
        if not user_ids:
            return {
                "summary": {},
                "entrants": [],
                "leaderboard": [],
                "tournament": {},
                "total_shown": 0,
            }
        q["user_id"] = {"$in": user_ids}
    lim = max(1, min(int(limit), 2000))
    entries = await db.world_cup_entries.find(q, {"_id": 0}).sort("entered_at", 1).limit(lim).to_list(lim)
    user_ids = [e.get("user_id") for e in entries if e.get("user_id")]
    usernames = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
            usernames[u["id"]] = u.get("username") or "?"
    preds_by_user: Dict[str, list] = {uid: [] for uid in user_ids}
    if user_ids:
        async for p in db.world_cup_predictions.find({"user_id": {"$in": user_ids}}, {"_id": 0}):
            uid = p.get("user_id")
            if uid in preds_by_user:
                preds_by_user[uid].append(p)
    global_stats = await _prediction_global_stats(db)
    entry_stats = await _entry_counts(db)
    pending_counts = await _pending_payout_counts(db)
    entrants_out = []
    for e in entries:
        uid = e.get("user_id")
        tids = e.get("drafted_team_ids") or []
        drafted = [_team_brief(teams_by_id[tid]) for tid in tids if tid in teams_by_id]
        pred_summary = _summarize_user_predictions(preds_by_user.get(uid) or [], teams_by_id)
        jackpot_pts = _points_from_config(cfg)["jackpot_points"]
        if e.get("jackpot_pending"):
            pred_summary["pending_payout"] += 1
            pred_summary["points_pending"] += jackpot_pts
        elif e.get("jackpot_awarded"):
            pred_summary["points_paid"] += jackpot_pts
            pred_summary["won"] += 1
        entrants_out.append({
            "user_id": uid,
            "username": usernames.get(uid, "?"),
            "ghost_entry": bool(e.get("ghost_entry")),
            "entered_at": e.get("entered_at"),
            "drafted_teams": drafted,
            "drafted_team_names": [t.get("name") for t in drafted if t.get("name")],
            "drafted_team_count": len(drafted),
            "jackpot_pending": bool(e.get("jackpot_pending")),
            "jackpot_awarded": bool(e.get("jackpot_awarded")),
            "predictions": pred_summary,
        })
    entrants_out.sort(key=lambda x: (-(x["predictions"].get("points_paid", 0) + x["predictions"].get("points_pending", 0)), x.get("username") or ""))
    champion_id = cfg.get("champion_team_id")
    runner_id = cfg.get("runner_up_team_id")
    third_id = cfg.get("third_place_team_id")
    return {
        "summary": {
            **entry_stats,
            "draft_run": bool(cfg.get("draft_run")),
            "tournament_started": tournament_started,
            "predictions_total": (
                global_stats["predictions_open"]
                + global_stats["predictions_won"]
                + global_stats["predictions_lost"]
            ),
            **global_stats,
            **pending_counts,
        },
        "tournament": {
            "tournament_start_at": start.isoformat() if start else cfg.get("tournament_start_at"),
            "tournament_started": tournament_started,
            "champion": _team_brief(teams_by_id.get(champion_id or "")),
            "runner_up": _team_brief(teams_by_id.get(runner_id or "")),
            "third_place": _team_brief(teams_by_id.get(third_id or "")),
            "phase": cfg.get("phase") or "upcoming",
        },
        "leaderboard": await _build_admin_leaderboard(db, cfg, ghost_ids, 100),
        "entrants": entrants_out,
        "total_shown": len(entrants_out),
    }


async def _build_admin_user_detail(db, user_id: str) -> dict:
    cfg = await _load_config(db)
    entry = await db.world_cup_entries.find_one({"user_id": user_id}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="User not entered")
    teams_by_id = await _teams_by_id(db)
    matches_by_id = {}
    async for m in db.world_cup_matches.find({}, {"_id": 0}):
        mid = m.get("id")
        if mid:
            matches_by_id[mid] = m
    groups_by_id = {}
    async for g in db.world_cup_groups.find({}, {"_id": 0}):
        gid = g.get("group_id")
        if gid:
            groups_by_id[gid] = g
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1})
    usernames = {user_id: (u or {}).get("username") or "?"}
    entries_by_user = {user_id: entry}
    preds = await db.world_cup_predictions.find({"user_id": user_id}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    enriched = [
        _enrich_prediction_for_staff(p, teams_by_id, matches_by_id, groups_by_id, usernames, entries_by_user, cfg)
        for p in preds
    ]
    tids = entry.get("drafted_team_ids") or []
    drafted = [_team_brief(teams_by_id[tid]) for tid in tids if tid in teams_by_id]
    summary = _summarize_user_predictions(preds, teams_by_id)
    return {
        "user_id": user_id,
        "username": usernames.get(user_id, "?"),
        "ghost_entry": bool(entry.get("ghost_entry")),
        "entered_at": entry.get("entered_at"),
        "drafted_teams": drafted,
        "jackpot_pending": bool(entry.get("jackpot_pending")),
        "jackpot_awarded": bool(entry.get("jackpot_awarded")),
        "predictions_summary": summary,
        "predictions": enriched,
    }


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
    tournament_start_at: Optional[str] = None
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
    _is_admin = srv._is_admin
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
        pending_payouts = 0
        if uid:
            pending_payouts = await db.world_cup_predictions.count_documents({"user_id": uid, "payout_status": "pending"})
            if entry and entry.get("jackpot_pending"):
                pending_payouts += 1
        drafted = []
        if entry and entry.get("drafted_team_ids"):
            tids = [t for t in entry["drafted_team_ids"] if t]
            if tids:
                drafted = await db.world_cup_teams.find(
                    {"id": {"$in": tids}},
                    {"_id": 0},
                ).to_list(len(tids))
        start = await _get_tournament_start_at(db, cfg)
        draft_timing = _draft_timing_payload(cfg, start)
        tournament_started = _is_tournament_started_at(start)
        return {
            "enabled": True,
            "config": {k: cfg.get(k) for k in list(DEFAULT_POINTS.keys()) + ["entry_open", "draft_run", "phase", "banner_text"]},
            "points": _points_from_config(cfg),
            "entered": bool(entry),
            "ghost_entry": bool(entry and entry.get("ghost_entry")),
            "can_ghost_enter": bool(
                _is_admin(current_user)
                and not entry
                and cfg.get("entry_open", True)
                and not cfg.get("draft_run")
            ),
            "entry": entry,
            "drafted_teams": drafted,
            "group_locks": group_locks,
            "tournament_started": tournament_started,
            "tournament_picks_locked": tournament_started,
            "teams_count": await db.world_cup_teams.count_documents({}),
            "pending_payouts": pending_payouts,
            **draft_timing,
        }

    @router.get("/world-cup/draft-results", dependencies=_wc_rl)
    async def world_cup_draft_results(current_user: dict = Depends(get_current_user)):
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        return await _build_draft_results(db)

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
            {
                "$match": {
                    "settled": True,
                    "points_awarded": {"$gt": 0},
                    "$or": [
                        {"payout_status": "paid"},
                        {"payout_status": {"$exists": False}},
                    ],
                }
            },
            {"$group": {"_id": "$user_id", "total": {"$sum": "$points_awarded"}}},
            {"$sort": {"total": -1}},
            {"$limit": int(limit)},
        ]
        rows = await db.world_cup_predictions.aggregate(pipeline).to_list(int(limit))
        ghost_ids = await _ghost_user_ids(db)
        jackpot_rows = await db.world_cup_entries.find(
            {"jackpot_awarded": True, "jackpot_pending": {"$ne": True}, "ghost_entry": {"$ne": True}},
            {"_id": 0, "user_id": 1},
        ).to_list(5000)
        totals = {}
        for r in rows:
            row_uid = r["_id"]
            if row_uid in ghost_ids:
                continue
            totals[row_uid] = int(r["total"])
        for e in jackpot_rows:
            uid_j = e.get("user_id")
            if uid_j and uid_j not in ghost_ids:
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
        if uid in ghost_ids:
            my_rank = None
            my_total = 0
        elif uid and my_rank is None and my_total > 0:
            my_rank = len(sorted_users) + 1
        return {"leaderboard": board, "my_rank": my_rank, "my_points": my_total, "ghost_entry": uid in ghost_ids}

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

    @router.post("/world-cup/enter-ghost")
    async def world_cup_enter_ghost(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cfg = await _load_config(db)
        await _require_enabled(cfg)
        if not cfg.get("entry_open", True):
            raise HTTPException(status_code=400, detail="Entry is closed")
        if cfg.get("draft_run"):
            raise HTTPException(status_code=400, detail="Draft already run")
        uid = current_user.get("id") or ""
        existing = await db.world_cup_entries.find_one({"user_id": uid})
        if existing:
            if existing.get("ghost_entry"):
                return {"ok": True, "already_entered": True, "ghost_entry": True}
            raise HTTPException(status_code=400, detail="Already entered as a real player")
        await db.world_cup_entries.insert_one({
            "user_id": uid,
            "entered_at": _now_iso(),
            "drafted_team_ids": [],
            "ghost_entry": True,
        })
        return {"ok": True, "ghost_entry": True}

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
            if await _is_tournament_started(db, cfg):
                raise HTTPException(status_code=400, detail="Tournament has started — group picks are locked")
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
            if await _is_tournament_started(db, cfg):
                raise HTTPException(status_code=400, detail="Tournament has started — picks are locked")
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

    def _require_staff(current_user: dict):
        if not _is_entertainer(current_user) and not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Staff access required")

    @router.get("/world-cup/staff/dashboard")
    async def wc_staff_dashboard(current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        entrants = await db.world_cup_entries.count_documents({})
        real_entrants = await db.world_cup_entries.count_documents({"ghost_entry": {"$ne": True}})
        ghost_entrants = await db.world_cup_entries.count_documents({"ghost_entry": True})
        unsettled = await db.world_cup_matches.count_documents({"status": {"$ne": "settled"}})
        pending = await _pending_payout_counts(db)
        start = await _get_tournament_start_at(db, cfg)
        draft_timing = _draft_timing_payload(cfg, start)
        return {
            "entrants": entrants,
            "real_entrants": real_entrants,
            "ghost_entrants": ghost_entrants,
            "unsettled_matches": unsettled,
            "draft_run": bool(cfg.get("draft_run")),
            "last_fixture_sync_at": cfg.get("last_fixture_sync_at"),
            "last_auto_settle_at": cfg.get("last_auto_settle_at"),
            **pending,
            **draft_timing,
        }

    @router.post("/world-cup/staff/run-draft")
    async def wc_staff_run_draft(current_user: dict = Depends(get_current_user)):
        _require_ent(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _run_draft(db, send_notification)

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
        user_ids = [e.get("user_id") for e in entries if e.get("user_id")]
        usernames = {}
        if user_ids:
            async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}):
                usernames[u["id"]] = u.get("username") or "?"
        for e in entries:
            e["username"] = usernames.get(e.get("user_id"), "?")
        return {"entries": entries}

    @router.get("/world-cup/staff/predictions")
    async def wc_staff_predictions(
        limit: int = Query(500, ge=1, le=2000),
        type: Optional[str] = Query(None, alias="type"),
        match_id: Optional[str] = Query(None),
        group_id: Optional[str] = Query(None),
        username: Optional[str] = Query(None),
        settled: Optional[bool] = Query(None),
        payout_status: Optional[str] = Query(None),
        verdict: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        if type and type not in (PRED_GROUP_WINNER, PRED_MATCH_SCORE, PRED_MATCH_SCORER, PRED_SECOND_PLACE, PRED_THIRD_PLACE):
            raise HTTPException(status_code=400, detail="Invalid prediction type filter")
        if verdict and verdict not in ("pending", "correct", "result_correct", "incorrect"):
            raise HTTPException(status_code=400, detail="Invalid verdict filter")
        return await _build_staff_predictions_feed(
            db, limit, type, match_id, group_id, username, settled, payout_status, verdict
        )

    @router.get("/world-cup/staff/pending-payouts")
    async def wc_staff_pending_payouts(limit: int = Query(100, ge=1, le=500), current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _list_pending_payouts(db, limit)

    @router.post("/world-cup/staff/approve-payout/{prediction_id}")
    async def wc_staff_approve_payout(prediction_id: str, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _approve_prediction_payout(db, send_notification, prediction_id, current_user.get("id") or "")

    @router.post("/world-cup/staff/approve-jackpot/{user_id}")
    async def wc_staff_approve_jackpot(user_id: str, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _approve_jackpot_payout(db, send_notification, user_id, current_user.get("id") or "")

    @router.post("/world-cup/staff/approve-all-payouts")
    async def wc_staff_approve_all_payouts(current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        cfg = await _load_config(db)
        await _require_enabled_staff(cfg)
        return await _approve_all_pending_payouts(db, send_notification, current_user.get("id") or "")

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

    @router.get("/admin/world-cup/overview")
    async def admin_wc_overview(
        username: Optional[str] = Query(None),
        limit: int = Query(500, ge=1, le=2000),
        current_user: dict = Depends(require_admin),
    ):
        return await _build_admin_overview(db, username, limit)

    @router.get("/admin/world-cup/user/{user_id}")
    async def admin_wc_user_detail(user_id: str, current_user: dict = Depends(require_admin)):
        return await _build_admin_user_detail(db, user_id)

    @router.post("/admin/world-cup/sync-fixtures")
    async def admin_wc_sync(current_user: dict = Depends(require_admin)):
        cfg = await _load_config(db)
        if not cfg.get("enabled"):
            raise HTTPException(status_code=400, detail="Enable event first")
        synced = await _sync_fixtures_from_odds(db)
        draft = await _auto_run_draft_if_due(db, send_notification)
        return {**synced, "auto_draft": draft}

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
        real_entrants = await db.world_cup_entries.count_documents({"ghost_entry": {"$ne": True}})
        ghost_entrants = await db.world_cup_entries.count_documents({"ghost_entry": True})
        pending = await _pending_payout_counts(db)
        start = await _get_tournament_start_at(db, cfg)
        draft_timing = _draft_timing_payload(cfg, start)
        return {
            "enabled": bool(cfg.get("enabled")),
            "auto_sync_enabled": bool(cfg.get("auto_sync_enabled", True)),
            "last_fixture_sync_at": cfg.get("last_fixture_sync_at"),
            "last_auto_settle_at": cfg.get("last_auto_settle_at"),
            "unsettled_matches": unsettled,
            "entrants": entrants,
            "real_entrants": real_entrants,
            "ghost_entrants": ghost_entrants,
            "draft_run": bool(cfg.get("draft_run")),
            "odds_api_configured": bool(sb._odds_api_key()),
            "auto_draft_ran_at": cfg.get("auto_draft_ran_at"),
            **pending,
            **draft_timing,
        }

    @router.get("/admin/world-cup/pending-payouts")
    async def admin_wc_pending_payouts(limit: int = Query(100, ge=1, le=500), current_user: dict = Depends(require_admin)):
        return await _list_pending_payouts(db, limit)

    @router.post("/admin/world-cup/approve-payout/{prediction_id}")
    async def admin_wc_approve_payout(prediction_id: str, current_user: dict = Depends(require_admin)):
        return await _approve_prediction_payout(db, send_notification, prediction_id, current_user.get("id") or "")

    @router.post("/admin/world-cup/approve-jackpot/{user_id}")
    async def admin_wc_approve_jackpot(user_id: str, current_user: dict = Depends(require_admin)):
        return await _approve_jackpot_payout(db, send_notification, user_id, current_user.get("id") or "")

    @router.post("/admin/world-cup/approve-all-payouts")
    async def admin_wc_approve_all_payouts(current_user: dict = Depends(require_admin)):
        return await _approve_all_pending_payouts(db, send_notification, current_user.get("id") or "")

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
        synced = await _sync_fixtures_from_odds(db)
        draft = await _auto_run_draft_if_due(db, send_notification)
        return {**synced, "auto_draft": draft}

    @router.post("/world-cup/cron/auto-settle")
    async def wc_cron_settle(_: None = Depends(verify_wc_cron)):
        disabled = await _cron_guard()
        if disabled:
            return disabled
        return await _auto_settle_from_scores(db, send_notification)

    @router.post("/world-cup/cron/auto-draft")
    async def wc_cron_auto_draft(_: None = Depends(verify_wc_cron)):
        cfg = await _load_config(db)
        if not cfg.get("enabled"):
            return {"skipped": True, "reason": "disabled"}
        return await _auto_run_draft_if_due(db, send_notification)


async def run_world_cup_auto_draft_ticker():
    """Background ticker: run team draft 24h before tournament start."""
    import server as srv

    interval = max(300, int(os.environ.get("WORLD_CUP_AUTO_DRAFT_INTERVAL_SEC", "900")))
    while True:
        try:
            cfg = await _load_config(srv.db)
            if cfg.get("enabled"):
                result = await _auto_run_draft_if_due(srv.db, srv.send_notification)
                if result.get("ok"):
                    logger.info("World Cup auto-draft ran: %s", result)
        except Exception as ex:
            logger.warning("World Cup auto-draft ticker: %s", ex)
        await asyncio.sleep(interval)


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
