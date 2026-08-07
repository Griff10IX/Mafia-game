"""
World Cup 2026 — read-only admin archive.

Player/staff event code was removed after the event ended. Mongo collections are kept
so admins can still view the final leaderboard and entrant history.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

from fastapi import Depends, HTTPException, Query

CONFIG_ID = "world_cup_event"
DEFAULT_JACKPOT_POINTS = 25_000


async def _load_cfg(db) -> dict:
    doc = await db.game_config.find_one({"id": CONFIG_ID}, {"_id": 0}) or {}
    out = dict(doc)
    out.setdefault("jackpot_points", DEFAULT_JACKPOT_POINTS)
    out["enabled"] = False
    out["retired"] = True
    out["phase"] = out.get("phase") or "ended"
    return out


def _team_brief(team: Optional[dict]) -> dict:
    if not team:
        return {}
    return {
        "id": team.get("id"),
        "name": team.get("name"),
        "short_code": team.get("short_code"),
        "group_id": team.get("group_id"),
    }


async def _teams_by_id(db) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    async for t in db.world_cup_teams.find({}, {"_id": 0}):
        tid = t.get("id")
        if tid:
            out[tid] = t
    return out


async def _ghost_user_ids(db) -> set:
    ids = set()
    async for e in db.world_cup_entries.find({"ghost_entry": True}, {"_id": 0, "user_id": 1}):
        uid = e.get("user_id")
        if uid:
            ids.add(uid)
    return ids


def _summarize_predictions(preds: list) -> dict:
    stats = {
        "open": 0,
        "won": 0,
        "lost": 0,
        "pending_payout": 0,
        "points_pending": 0,
        "points_paid": 0,
    }
    for p in preds:
        pts = int(p.get("points_awarded") or 0)
        if not p.get("settled"):
            stats["open"] += 1
        elif pts > 0:
            stats["won"] += 1
            if p.get("payout_status") == "pending":
                stats["pending_payout"] += 1
                stats["points_pending"] += pts
            elif p.get("payout_status") != "ghost":
                stats["points_paid"] += pts
        else:
            stats["lost"] += 1
    return stats


async def _build_leaderboard(db, cfg: dict, ghost_ids: set, limit: int = 100) -> list:
    jackpot_pts = int(cfg.get("jackpot_points") or DEFAULT_JACKPOT_POINTS)
    ghost_list = list(ghost_ids) if ghost_ids else []
    match_filter: dict = {"settled": True, "points_awarded": {"$gt": 0}}
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


async def _build_overview(db, username: Optional[str] = None, limit: int = 500) -> dict:
    cfg = await _load_cfg(db)
    teams_by_id = await _teams_by_id(db)
    ghost_ids = await _ghost_user_ids(db)
    q: dict = {}
    if username and username.strip():
        uname = username.strip()
        user_ids: List[str] = []
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
                "tournament": {"phase": "ended"},
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

    real_entrants = await db.world_cup_entries.count_documents({"ghost_entry": {"$ne": True}})
    ghost_entrants = await db.world_cup_entries.count_documents({"ghost_entry": True})
    predictions_open = await db.world_cup_predictions.count_documents({"settled": {"$ne": True}})
    predictions_won = await db.world_cup_predictions.count_documents(
        {"settled": True, "points_awarded": {"$gt": 0}}
    )
    predictions_lost = await db.world_cup_predictions.count_documents(
        {"settled": True, "points_awarded": {"$lte": 0}}
    )
    predictions_pending_payout = await db.world_cup_predictions.count_documents(
        {"payout_status": "pending"}
    )

    jackpot_pts = int(cfg.get("jackpot_points") or DEFAULT_JACKPOT_POINTS)
    entrants_out = []
    for e in entries:
        uid = e.get("user_id")
        tids = e.get("drafted_team_ids") or []
        drafted = [_team_brief(teams_by_id[tid]) for tid in tids if tid in teams_by_id]
        pred_summary = _summarize_predictions(preds_by_user.get(uid) or [])
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
    entrants_out.sort(
        key=lambda x: (
            -(x["predictions"].get("points_paid", 0) + x["predictions"].get("points_pending", 0)),
            x.get("username") or "",
        )
    )
    champion_id = cfg.get("champion_team_id")
    runner_id = cfg.get("runner_up_team_id")
    third_id = cfg.get("third_place_team_id")
    return {
        "summary": {
            "real_entrants": real_entrants,
            "ghost_entrants": ghost_entrants,
            "draft_run": bool(cfg.get("draft_run")),
            "tournament_started": True,
            "predictions_total": predictions_open + predictions_won + predictions_lost,
            "predictions_open": predictions_open,
            "predictions_won": predictions_won,
            "predictions_lost": predictions_lost,
            "predictions_pending_payout": predictions_pending_payout,
        },
        "tournament": {
            "tournament_start_at": cfg.get("tournament_start_at"),
            "tournament_started": True,
            "champion": _team_brief(teams_by_id.get(champion_id or "")),
            "runner_up": _team_brief(teams_by_id.get(runner_id or "")),
            "third_place": _team_brief(teams_by_id.get(third_id or "")),
            "phase": "ended",
        },
        "leaderboard": await _build_leaderboard(db, cfg, ghost_ids, 100),
        "entrants": entrants_out,
        "total_shown": len(entrants_out),
    }


async def _build_user_detail(db, user_id: str) -> dict:
    cfg = await _load_cfg(db)
    entry = await db.world_cup_entries.find_one({"user_id": user_id}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="User not entered")
    teams_by_id = await _teams_by_id(db)
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1})
    username = (u or {}).get("username") or "?"
    preds = await db.world_cup_predictions.find({"user_id": user_id}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    enriched = []
    for p in preds:
        val = p.get("value") if isinstance(p.get("value"), dict) else {}
        tid = val.get("team_id") if isinstance(val, dict) else None
        team = teams_by_id.get(tid or "") if tid else None
        enriched.append({
            **p,
            "team_name": (team or {}).get("name"),
            "team_short_code": (team or {}).get("short_code"),
        })
    tids = entry.get("drafted_team_ids") or []
    drafted = [_team_brief(teams_by_id[tid]) for tid in tids if tid in teams_by_id]
    return {
        "user_id": user_id,
        "username": username,
        "ghost_entry": bool(entry.get("ghost_entry")),
        "entered_at": entry.get("entered_at"),
        "drafted_teams": drafted,
        "jackpot_pending": bool(entry.get("jackpot_pending")),
        "jackpot_awarded": bool(entry.get("jackpot_awarded")),
        "jackpot_points": int(cfg.get("jackpot_points") or DEFAULT_JACKPOT_POINTS),
        "predictions_summary": _summarize_predictions(preds),
        "predictions": enriched,
    }


def register(router):
    import server as srv

    db = srv.db
    require_admin = srv.require_admin

    @router.get("/admin/world-cup/config")
    async def admin_wc_get_config(current_user: dict = Depends(require_admin)):
        return await _load_cfg(db)

    @router.get("/admin/world-cup/overview")
    async def admin_wc_overview(
        username: Optional[str] = Query(None),
        limit: int = Query(500, ge=1, le=2000),
        current_user: dict = Depends(require_admin),
    ):
        return await _build_overview(db, username, limit)

    @router.get("/admin/world-cup/user/{user_id}")
    async def admin_wc_user_detail(user_id: str, current_user: dict = Depends(require_admin)):
        return await _build_user_detail(db, user_id)

    @router.get("/world-cup/public-status")
    async def world_cup_public_status():
        """Kept so old clients don't 404; always reports retired/closed."""
        return {
            "enabled": False,
            "retired": True,
            "phase": "ended",
            "banner_text": "",
            "ended_message": "World Cup 2026 has ended. Thanks for playing!",
        }
