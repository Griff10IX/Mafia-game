# Minesweeper — win tracking with server-verified re-sim from seed + click log

from datetime import datetime, timezone
import secrets
from typing import List, Optional, Union

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from server import db, get_current_user, _get_staff_user_ids, _is_admin, log_activity, log_minigame_payout
from utils.minigame_captcha_gate import require_turnstile_for_minigame_start
from utils.minigame_security import skip_minigame_session
from utils.minigame_repeat_guard import check_identical_payload_spam
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    get_plays_left,
    start_minigame_run,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
)
from utils.minesweeper_sim import normalize_clicks, simulate_minesweeper, validate_difficulty

MINESWEEPER_GAME = "minesweeper"

VALID_DIFFICULTIES = ["snitch", "capo", "godfather"]

# 75% reduction for beta
DIFFICULTY_CONFIG = {
    "snitch": {"base_cash": 1_250, "base_respect": 5, "points": 15, "max_time": 600, "min_time": 5},
    "capo": {"base_cash": 3_750, "base_respect": 15, "points": 30, "max_time": 1200, "min_time": 15},
    "godfather": {"base_cash": 12_500, "base_respect": 50, "points": 60, "max_time": 1800, "min_time": 30},
}

MAX_WINS_PER_HOUR = 10


class MinesweeperStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    difficulty: str
    first_r: int
    first_c: int
    captcha_token: Optional[str] = None


class MinesweeperClick(BaseModel):
    model_config = ConfigDict(extra="forbid")

    r: int
    c: int


class MinesweeperWinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    difficulty: Optional[str] = None
    # Client time is display-only; leaderboard uses server session elapsed.
    time_seconds: Optional[int] = 0
    session_id: Optional[str] = None
    clicks: List[Union[MinesweeperClick, List[int]]] = Field(default_factory=list)


def register(router):
    @router.post("/minesweeper/start")
    async def minesweeper_start(
        body: MinesweeperStartRequest,
        request: Request,
        current_user: dict = Depends(get_current_user),
    ):
        await require_turnstile_for_minigame_start(
            db,
            request=request,
            current_user=current_user,
            captcha_token=body.captcha_token,
            is_admin=_is_admin(current_user),
        )
        try:
            settings = validate_difficulty(body.difficulty)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e) or "Invalid difficulty.") from e

        fr, fc = int(body.first_r), int(body.first_c)
        if fr < 0 or fc < 0 or fr >= settings["rows"] or fc >= settings["cols"]:
            raise HTTPException(status_code=400, detail="First click out of range.")

        seed = secrets.token_hex(16)
        meta = {
            "seed": seed,
            "difficulty": settings["difficulty"],
            "first_r": fr,
            "first_c": fc,
        }
        resp = await start_minigame_run(
            db,
            user_id=current_user["id"],
            game=MINESWEEPER_GAME,
            meta=meta,
        )
        resp["seed"] = seed
        resp["difficulty"] = settings["difficulty"]
        resp["first_r"] = fr
        resp["first_c"] = fc
        return resp

    @router.post("/minesweeper/win")
    async def submit_minesweeper_win(body: MinesweeperWinRequest, current_user: dict = Depends(get_current_user)):
        """Submit a Minesweeper win. Server re-sims clicks; time from session elapsed."""
        now = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now.isoformat().replace("+00:00", "Z")
        hour_start, _ = utc_rate_limit_window(now)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")

        uid = current_user["id"]
        skip_session = skip_minigame_session(_is_admin(current_user))
        session_id = (body.session_id or "").strip()

        raw_clicks = []
        for item in body.clicks or []:
            if isinstance(item, MinesweeperClick):
                raw_clicks.append({"r": item.r, "c": item.c})
            elif isinstance(item, (list, tuple)) and len(item) == 2:
                raw_clicks.append({"r": int(item[0]), "c": int(item[1])})
            elif isinstance(item, dict):
                raw_clicks.append(item)
            else:
                raise HTTPException(status_code=400, detail="Invalid clicks.")

        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a game before submitting (missing session).")
            pl = await get_plays_left(db, user_id=uid, game=MINESWEEPER_GAME)
            if pl["plays_left"] == 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"Win limit reached ({pl['max_plays']} per {RATE_LIMIT_PERIOD_HOURS}h). Resets at {pl['resets_at']}.",
                )
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=MINESWEEPER_GAME, session_id=session_id, now_dt=now
            )

            sess_meta = sess.get("meta") if isinstance(sess.get("meta"), dict) else {}
            seed = str(sess_meta.get("seed") or "").strip()
            if not seed:
                raise HTTPException(status_code=400, detail="Run seed missing; start a new run.")

            try:
                settings = validate_difficulty(sess_meta.get("difficulty"))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid run settings.") from e

            difficulty = settings["difficulty"]
            if body.difficulty is not None and str(body.difficulty).strip() and str(body.difficulty).strip().lower() != difficulty:
                raise HTTPException(status_code=400, detail="Difficulty mismatch with session.")

            cfg = DIFFICULTY_CONFIG[difficulty]
            started_at = as_utc_started(sess.get("started_at"))
            elapsed = max(0.0, (now - started_at).total_seconds())
            min_time = cfg.get("min_time", 5)
            if elapsed < min_time:
                raise HTTPException(status_code=400, detail="Game too short for this difficulty.")
            if elapsed > cfg["max_time"]:
                raise HTTPException(status_code=400, detail="Time exceeds maximum for this difficulty.")

            time_seconds = int(elapsed)

            try:
                first_r = int(sess_meta.get("first_r"))
                first_c = int(sess_meta.get("first_c"))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Run first click missing; start a new run.") from None

            try:
                normalize_clicks(raw_clicks, rows=settings["rows"], cols=settings["cols"])
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid clicks.") from e

            try:
                sim = simulate_minesweeper(
                    seed=seed,
                    difficulty=difficulty,
                    clicks=raw_clicks,
                    first_r=first_r,
                    first_c=first_c,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid clicks.") from e

            if not sim.get("won"):
                raise HTTPException(status_code=400, detail="Board not cleared.")

            await check_identical_payload_spam(
                db,
                user_id=uid,
                game=MINESWEEPER_GAME,
                parts=(difficulty, time_seconds, len(raw_clicks)),
                now=now,
            )
        else:
            # Admin session-skip: do not accept client win claims without re-sim seed.
            raise HTTPException(status_code=400, detail="Start a verified run before submitting.")

        result = await db.user_meta.update_one(
            {"user_id": uid, "minesweeper_hour_start": hour_start_iso, "minesweeper_hour_count": {"$lt": MAX_WINS_PER_HOUR}},
            {"$inc": {"minesweeper_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "minesweeper_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"minesweeper_hour_start": hour_start_iso, "minesweeper_hour_count": 1}},
                upsert=True,
            )
            if result.modified_count == 0 and result.upserted_id is None:
                raise HTTPException(
                    status_code=429,
                    detail=f"Win limit reached ({MAX_WINS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again later.",
                )

        cash = cfg["base_cash"]
        respect = cfg["base_respect"]

        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": cash, "respect_points": respect}},
        )

        win_doc = {
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "difficulty": difficulty,
            "time_seconds": time_seconds,
            "cash": cash,
            "respect": respect,
            "created_at": now_iso,
        }
        await db.minesweeper_wins.insert_one(win_doc)

        await log_activity(uid, current_user.get("username", "?"), "minigame_minesweeper", {
            "difficulty": difficulty, "time_seconds": time_seconds, "cash": cash, "respect": respect,
        })
        await log_minigame_payout(
            uid,
            current_user.get("username", "?"),
            "minesweeper",
            max(1, cfg["max_time"] - time_seconds),
            {"money": cash, "respect_points": respect},
        )

        try:
            from routers.minigames.minigame_leaderboard import log_minigame_play
            score = max(1, cfg["max_time"] - time_seconds)
            await log_minigame_play(current_user["id"], current_user.get("username"), "minesweeper", score)
        except Exception:
            pass

        plays_info = await get_plays_left(db, user_id=uid, game=MINESWEEPER_GAME)
        return {
            "ok": True,
            "time_seconds": time_seconds,
            "difficulty": difficulty,
            "plays_left": plays_info["plays_left"],
            "max_plays": plays_info["max_plays"],
            "resets_at": plays_info["resets_at"],
        }

    @router.get("/minesweeper/leaderboard")
    async def get_minesweeper_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 fastest Minesweeper wins across all difficulties."""
        staff_ids = await _get_staff_user_ids()
        staff_stage = [{"$match": {"user_id": {"$nin": staff_ids}}}] if staff_ids else []
        pipeline = staff_stage + [
            {"$sort": {"time_seconds": 1}},
            {
                "$group": {
                    "_id": {"user_id": "$user_id", "difficulty": "$difficulty"},
                    "username": {"$first": "$username"},
                    "time_seconds": {"$first": "$time_seconds"},
                    "created_at": {"$first": "$created_at"},
                }
            },
            {"$sort": {"time_seconds": 1}},
            {"$limit": 10},
            {
                "$project": {
                    "_id": 0,
                    "user_id": "$_id.user_id",
                    "difficulty": "$_id.difficulty",
                    "username": 1,
                    "time_seconds": 1,
                    "created_at": 1,
                }
            },
        ]
        rows = await db.minesweeper_wins.aggregate(pipeline).to_list(10)
        return {"leaderboard": rows}

    @router.get("/minesweeper/my-stats")
    async def get_my_minesweeper_stats(current_user: dict = Depends(get_current_user)):
        """Get current user's best times per difficulty."""
        pipeline = [
            {"$match": {"user_id": current_user["id"]}},
            {
                "$group": {
                    "_id": "$difficulty",
                    "best_time": {"$min": "$time_seconds"},
                    "total_wins": {"$sum": 1},
                }
            },
        ]
        rows = await db.minesweeper_wins.aggregate(pipeline).to_list(10)
        by_difficulty = {r["_id"]: {"best_time": r["best_time"], "total_wins": r["total_wins"]} for r in rows}
        return {"stats": by_difficulty}
