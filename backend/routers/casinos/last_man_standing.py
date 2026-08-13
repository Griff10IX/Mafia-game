"""Premier League Last Man Standing routes."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, Field

from server import db, get_current_user, get_current_user_verified, require_admin_verified
from utils.gambling_self_ban import raise_if_gambling_self_banned
from utils.sustained_page_ratelimit import PAGE_KEY_SPORTS_BETTING, check_sustained_page_rl
from utils import last_man_standing as lms

logger = logging.getLogger(__name__)

_join_pick_hits: dict[str, float] = {}


def _action_rl(user_id: str, kind: str) -> None:
    uid = (user_id or "").strip()
    if not uid:
        return
    key = f"{kind}:{uid}"
    now = time.monotonic()
    last = _join_pick_hits.get(key) or 0.0
    if now - last < 0.8:
        raise HTTPException(status_code=429, detail="Slow down — try that again in a second.")
    _join_pick_hits[key] = now
    if len(_join_pick_hits) > 4000:
        cutoff = now - 60
        for k, v in list(_join_pick_hits.items()):
            if v < cutoff:
                _join_pick_hits.pop(k, None)


async def _lms_rl(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_SPORTS_BETTING)


_lms_rl_u = [Depends(_lms_rl)]


class LmsCreateSeasonBody(BaseModel):
    name: Optional[str] = None
    seed_pot: int = Field(default=lms.LMS_SEED_POT, ge=0, le=50_000_000)
    entry_fee: int = Field(default=lms.LMS_ENTRY_FEE, ge=0, le=1_000_000)
    weekly_correct_bonus: int = Field(default=lms.LMS_WEEKLY_CORRECT, ge=0, le=100_000)
    weekly_streak_bonus: int = Field(default=lms.LMS_WEEKLY_STREAK, ge=0, le=50_000)


class LmsPickBody(BaseModel):
    gw: int = Field(ge=1, le=lms.LMS_MAX_GW)
    team_id: str


def _strip(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    out = dict(doc)
    out.pop("_id", None)
    return out


async def _counts(season_id: str) -> dict[str, int]:
    alive = await db[lms.COL_ENTRIES].count_documents({"season_id": season_id, "status": "alive"})
    out_n = await db[lms.COL_ENTRIES].count_documents({"season_id": season_id, "status": "out"})
    won = await db[lms.COL_ENTRIES].count_documents({"season_id": season_id, "status": "won"})
    entered = await db[lms.COL_ENTRIES].count_documents({"season_id": season_id})
    return {"alive": alive, "out": out_n, "won": won, "entered": entered}


async def _season_view(season: dict, user: dict) -> dict:
    sid = season["id"]
    counts = await _counts(sid)
    key = lms.account_key_from_user(user)
    if key:
        await lms.transfer_lms_entry_to_user(db, user, season_id=sid)
    entry = None
    if key:
        entry = _strip(await db[lms.COL_ENTRIES].find_one({"season_id": sid, "account_key": key}, {"_id": 0}))
    gw_n = int(season.get("current_gameweek") or 1)
    gw = await lms.get_gameweek(db, sid, gw_n)
    if not gw or gw.get("status") == "settled":
        open_rows = await db[lms.COL_GAMEWEEKS].find(
            {"season_id": sid, "status": {"$in": ["picks_open", "locked"]}},
            {"_id": 0},
        ).sort("gw", 1).limit(1).to_list(1)
        if open_rows:
            gw = open_rows[0]
            gw_n = int(gw.get("gw") or gw_n)
    my_pick = None
    if entry and gw:
        my_pick = _strip(
            await db[lms.COL_PICKS].find_one(
                {"season_id": sid, "gw": gw_n, "account_key": key},
                {"_id": 0},
            )
        )
    standing = (
        await db[lms.COL_ENTRIES]
        .find({"season_id": sid, "status": {"$in": ["alive", "won"]}}, {"_id": 0, "username": 1, "status": 1, "correct_streak": 1})
        .sort("joined_at", 1)
        .to_list(200)
    )
    fallen = (
        await db[lms.COL_ENTRIES]
        .find({"season_id": sid, "status": "out"}, {"_id": 0, "username": 1, "eliminated_gw": 1})
        .sort("eliminated_gw", 1)
        .to_list(300)
    )
    next_weekly = 0
    staff_no_prizes = bool(lms.is_lms_staff_user(user) or (entry and lms.entry_prize_ineligible(entry)))
    if entry and entry.get("status") == "alive" and not staff_no_prizes:
        streak = int(entry.get("correct_streak") or 0) + 1
        next_weekly = int(season.get("weekly_correct_bonus") or 0) + int(season.get("weekly_streak_bonus") or 0) * streak
    can_buy_life = bool(
        entry
        and entry.get("status") == "alive"
        and not entry.get("extra_life_bought")
        and not user.get("is_dead")
        and season.get("status") in ("open", "active")
    )
    return {
        "season": {
            **lms.season_public_payload(season, alive=counts["alive"], out_n=counts["out"]),
            **counts,
        },
        "entry": entry,
        "gameweek": gw,
        "my_pick": my_pick,
        "standing": standing,
        "fallen": fallen,
        "next_weekly_preview": next_weekly,
        "staff_no_prizes": staff_no_prizes,
        "can_buy_life": can_buy_life,
        "picks_locked": lms._picks_locked(gw) if gw else True,
        "can_join": (
            not entry
            and bool(key)
            and not user.get("is_dead")
            and season.get("status") in ("open", "active")
            and bool(gw)
            and int(gw.get("gw") or 0) == 1
            and gw.get("status") == "picks_open"
            and not lms._picks_locked(gw)
            and lms.gw1_completeness(gw.get("fixtures") or [])[0]
        ),
    }


async def lms_current(current_user: dict = Depends(get_current_user_verified)):
    season = await lms.current_season(db)
    if not season:
        return {"season": None, "entry": None, "gameweek": None, "standing": [], "fallen": []}
    return await _season_view(season, current_user)


async def lms_season(season_id: str, current_user: dict = Depends(get_current_user_verified)):
    season = await lms.get_season(db, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    return await _season_view(season, current_user)


async def lms_join(season_id: str, current_user: dict = Depends(get_current_user_verified)):
    raise_if_gambling_self_banned(current_user)
    _action_rl(current_user.get("id") or "", "join")
    return await lms.join_season(db, current_user, season_id)


async def lms_extra_life(season_id: str, current_user: dict = Depends(get_current_user_verified)):
    raise_if_gambling_self_banned(current_user)
    _action_rl(current_user.get("id") or "", "life")
    return await lms.buy_extra_life(db, current_user, season_id)


async def lms_gameweek(season_id: str, gw: int, current_user: dict = Depends(get_current_user_verified)):
    gw_doc = await lms.get_gameweek(db, season_id, int(gw))
    if not gw_doc:
        raise HTTPException(status_code=404, detail="Gameweek not found")
    key = lms.account_key_from_user(current_user)
    my_pick = None
    if key:
        my_pick = _strip(
            await db[lms.COL_PICKS].find_one({"season_id": season_id, "gw": int(gw), "account_key": key}, {"_id": 0})
        )
    return {"gameweek": gw_doc, "my_pick": my_pick, "picks_locked": lms._picks_locked(gw_doc)}


async def lms_picks_feed(
    season_id: str,
    gw: Optional[int] = None,
    current_user: dict = Depends(get_current_user_verified),
):
    season = await lms.get_season(db, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    counts = await _counts(season_id)
    gw_n = int(gw or season.get("current_gameweek") or 1)
    gw_doc = await lms.get_gameweek(db, season_id, gw_n)
    locked = bool(gw_doc and lms._picks_locked(gw_doc))
    key = lms.account_key_from_user(current_user)
    my_pick = None
    if key:
        my_pick = _strip(
            await db[lms.COL_PICKS].find_one({"season_id": season_id, "gw": gw_n, "account_key": key}, {"_id": 0})
        )
    picks = []
    grouped = []
    if locked:
        rows = await db[lms.COL_PICKS].find({"season_id": season_id, "gw": gw_n}, {"_id": 0}).to_list(2000)
        entries = {
            e["account_key"]: e
            for e in await db[lms.COL_ENTRIES].find({"season_id": season_id}, {"_id": 0, "account_key": 1, "username": 1, "status": 1}).to_list(2000)
        }
        by_team: dict[str, list] = {}
        for p in rows:
            acc = p.get("account_key")
            ent = entries.get(acc) or {}
            row = {
                "username": ent.get("username") or p.get("username"),
                "team_id": p.get("team_id"),
                "team_name": p.get("team_name"),
                "status": ent.get("status"),
            }
            picks.append(row)
            tn = p.get("team_name") or p.get("team_id") or "?"
            by_team.setdefault(tn, []).append(row["username"])
        grouped = [{"team": t, "count": len(u), "usernames": u} for t, u in sorted(by_team.items(), key=lambda x: (-len(x[1]), x[0]))]
    history = []
    past = await db[lms.COL_GAMEWEEKS].find(
        {"season_id": season_id, "gw": {"$lt": gw_n}, "status": "settled"},
        {"_id": 0, "gw": 1},
    ).sort("gw", -1).to_list(12)
    for g in past:
        gwn = int(g["gw"])
        rows = await db[lms.COL_PICKS].find({"season_id": season_id, "gw": gwn}, {"_id": 0}).to_list(2000)
        ents = {
            e["account_key"]: e
            for e in await db[lms.COL_ENTRIES].find({"season_id": season_id}, {"_id": 0, "account_key": 1, "username": 1, "eliminated_gw": 1, "status": 1}).to_list(2000)
        }
        hist_rows = []
        for p in rows:
            ent = ents.get(p.get("account_key")) or {}
            elim = ent.get("eliminated_gw")
            result = p.get("outcome") or "survived"
            if result == "win":
                result = "survived"
            elif result == "lose":
                result = "used a life" if p.get("survived_with_life") else "out"
            elif result == "postponed":
                result = "free pass"
            elif elim == gwn:
                result = "out"
            hist_rows.append({
                "username": ent.get("username") or p.get("username"),
                "team_name": p.get("team_name"),
                "result": result,
            })
        history.append({"gw": gwn, "picks": hist_rows})
    return {
        "entered": counts["entered"],
        "alive": counts["alive"],
        "out": counts["out"],
        "gw": gw_n,
        "hidden": not locked,
        "my_pick": my_pick,
        "picks": picks,
        "grouped": grouped,
        "history": history,
        "message": None if locked else "Picks hidden until the gameweek deadline.",
    }


async def lms_my_entry(season_id: str, current_user: dict = Depends(get_current_user_verified)):
    await lms.transfer_lms_entry_to_user(db, current_user, season_id=season_id)
    key = lms.account_key_from_user(current_user)
    if not key:
        return {"entry": None}
    entry = await db[lms.COL_ENTRIES].find_one({"season_id": season_id, "account_key": key}, {"_id": 0})
    return {"entry": entry}


async def admin_lms_list(current_user: dict = Depends(require_admin_verified)):
    rows = await db[lms.COL_SEASONS].find({}, {"_id": 0}).sort("created_at", -1).to_list(30)
    out = []
    for s in rows:
        c = await _counts(s["id"])
        gw1 = await lms.get_gameweek(db, s["id"], 1)
        ok, n_fx, n_teams = lms.gw1_completeness((gw1 or {}).get("fixtures") or [])
        out.append({**s, **c, "gw1_complete": ok, "gw1_fixtures": n_fx, "gw1_teams": n_teams})
    return {"seasons": out}


async def admin_lms_create(body: LmsCreateSeasonBody, current_user: dict = Depends(require_admin_verified)):
    return await lms.create_season(
        db,
        name=body.name or "Premier League LMS",
        seed_pot=body.seed_pot,
        entry_fee=body.entry_fee,
        weekly_correct_bonus=body.weekly_correct_bonus,
        weekly_streak_bonus=body.weekly_streak_bonus,
    )


async def admin_lms_sync(season_id: str, current_user: dict = Depends(require_admin_verified)):
    return await lms.sync_season_fixtures(db, season_id)


async def admin_lms_open(season_id: str, current_user: dict = Depends(require_admin_verified)):
    return await lms.open_season(db, season_id)


async def admin_lms_settle(season_id: str, gw: int, current_user: dict = Depends(require_admin_verified)):
    await lms.refresh_results_into_gameweek(db, season_id, int(gw))
    return await lms.settle_gameweek(db, season_id, int(gw), force=True)


async def admin_lms_cancel(season_id: str, current_user: dict = Depends(require_admin_verified)):
    return await lms.cancel_season(db, season_id)


async def admin_lms_tick(current_user: dict = Depends(require_admin_verified)):
    return await lms.cron_tick(db)


async def run_lms_ticker() -> None:
    log = logging.getLogger(__name__)
    while True:
        try:
            await lms.cron_tick(db)
        except Exception:
            log.exception("LMS ticker failed")
        await asyncio.sleep(900)


def register(router):
    router.add_api_route("/lms/seasons", lms_current, methods=["GET"], dependencies=_lms_rl_u)
    router.add_api_route("/lms/seasons/{season_id}", lms_season, methods=["GET"], dependencies=_lms_rl_u)
    router.add_api_route("/lms/seasons/{season_id}/join", lms_join, methods=["POST"], dependencies=_lms_rl_u)
    router.add_api_route("/lms/seasons/{season_id}/picks", lms_pick, methods=["POST"], dependencies=_lms_rl_u)
    router.add_api_route("/lms/seasons/{season_id}/extra-life", lms_extra_life, methods=["POST"], dependencies=_lms_rl_u)
    router.add_api_route("/lms/seasons/{season_id}/gameweeks/{gw}", lms_gameweek, methods=["GET"], dependencies=_lms_rl_u)
    router.add_api_route("/lms/seasons/{season_id}/picks-feed", lms_picks_feed, methods=["GET"], dependencies=_lms_rl_u)
    router.add_api_route("/lms/seasons/{season_id}/my-entry", lms_my_entry, methods=["GET"], dependencies=_lms_rl_u)
    router.add_api_route("/admin/lms/seasons", admin_lms_list, methods=["GET"])
    router.add_api_route("/admin/lms/seasons", admin_lms_create, methods=["POST"])
    router.add_api_route("/admin/lms/seasons/{season_id}/sync-fixtures", admin_lms_sync, methods=["POST"])
    router.add_api_route("/admin/lms/seasons/{season_id}/open", admin_lms_open, methods=["POST"])
    router.add_api_route("/admin/lms/seasons/{season_id}/cancel", admin_lms_cancel, methods=["POST"])
    router.add_api_route("/admin/lms/tick", admin_lms_tick, methods=["POST"])
    router.add_api_route("/admin/lms/gameweeks/{season_id}/{gw}/settle", admin_lms_settle, methods=["POST"])

    cron_secret = (os.environ.get("CRON_SECRET") or "").strip()

    async def verify_lms_cron_secret(x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret")):
        if not cron_secret:
            raise HTTPException(status_code=503, detail="Cron not configured (CRON_SECRET unset)")
        if (x_cron_secret or "").strip() != cron_secret:
            raise HTTPException(status_code=403, detail="Invalid cron secret")

    async def cron_lms_tick(_: None = Depends(verify_lms_cron_secret)):
        return await lms.cron_tick(db)

    router.add_api_route("/lms/cron/tick", cron_lms_tick, methods=["POST"])
