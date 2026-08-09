# Battleships (Rum Runner) — win tracking with server-verified re-sim

from datetime import datetime, timezone
import secrets
from typing import Any, Dict, List, Optional, Union

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from server import db, get_current_user, _get_staff_user_ids, _is_admin, log_activity, log_minigame_payout
from utils.minigame_captcha_gate import require_turnstile_for_minigame_start
from utils.minigame_security import skip_minigame_session
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    get_plays_left,
    start_minigame_run,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
)
from utils.battleships_sim import (
    normalize_actions,
    normalize_placements,
    simulate_battleships,
    validate_settings,
)

BATTLESHIPS_GAME = "battleships"

MAX_WINS_PER_HOUR = 10

# 75% reduction for beta
BASE_CASH = 6_250
BASE_RESPECT = 25
BONUS_PER_SHIP_SAVED = 1_250
BONUS_RESPECT_PER_SHIP = 5
MAX_TIME_SECONDS = 1800
MIN_PLAY_SECONDS = 30


class ShipPlacement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    r: int
    c: int
    horiz: bool


class BattleAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    t: str
    r: Optional[int] = None
    c: Optional[int] = None


class BattleshipsStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    difficulty: str = "normal"
    fleet_size: int = 5
    ships: List[ShipPlacement]
    captcha_token: Optional[str] = None


class BattleshipsWinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Display-only client fields (ignored for payouts / verification outcome).
    shots_fired: Optional[int] = 0
    ships_lost: Optional[int] = 0
    time_seconds: Optional[int] = 0
    fleet_size: Optional[int] = None
    difficulty: Optional[str] = None
    session_id: Optional[str] = None
    actions: List[Union[BattleAction, Dict[str, Any]]] = Field(default_factory=list)


def register(router):
    @router.post("/battleships/start")
    async def battleships_start(
        body: BattleshipsStartRequest,
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
            settings = validate_settings(difficulty=body.difficulty, fleet_size=body.fleet_size)
            raw_ships = [s.model_dump() if hasattr(s, "model_dump") else dict(s) for s in body.ships]
            placements = normalize_placements(raw_ships, fleet_size=settings["fleet_size"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e) or "Invalid fleet.") from e

        seed = secrets.token_hex(16)
        meta = {
            "seed": seed,
            "difficulty": settings["difficulty"],
            "fleet_size": settings["fleet_size"],
            "ships": placements,
        }
        resp = await start_minigame_run(
            db,
            user_id=current_user["id"],
            game=BATTLESHIPS_GAME,
            meta=meta,
        )
        resp["seed"] = seed
        resp["difficulty"] = settings["difficulty"]
        resp["fleet_size"] = settings["fleet_size"]
        return resp

    @router.post("/battleships/win")
    async def submit_battleships_win(body: BattleshipsWinRequest, current_user: dict = Depends(get_current_user)):
        """Submit a Battleships win. Server re-sims actions; ignores client score fields."""
        now = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now.isoformat().replace("+00:00", "Z")
        hour_start, _ = utc_rate_limit_window(now)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")

        uid = current_user["id"]
        skip_session = skip_minigame_session(_is_admin(current_user))
        session_id = (body.session_id or "").strip()

        raw_actions = []
        for item in body.actions or []:
            if isinstance(item, BattleAction):
                d = {"t": item.t}
                if item.r is not None:
                    d["r"] = item.r
                if item.c is not None:
                    d["c"] = item.c
                raw_actions.append(d)
            elif isinstance(item, dict):
                raw_actions.append(item)
            else:
                raise HTTPException(status_code=400, detail="Invalid actions.")

        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a game before submitting (missing session).")
            pl = await get_plays_left(db, user_id=uid, game=BATTLESHIPS_GAME)
            if pl["plays_left"] == 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"Win limit reached ({pl['max_plays']} per {RATE_LIMIT_PERIOD_HOURS}h). Resets at {pl['resets_at']}.",
                )
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=BATTLESHIPS_GAME, session_id=session_id, now_dt=now
            )

            started_at = as_utc_started(sess.get("started_at"))
            elapsed = max(0.0, (now - started_at).total_seconds())
            if elapsed < MIN_PLAY_SECONDS:
                raise HTTPException(status_code=400, detail="Game too short.")
            if elapsed > MAX_TIME_SECONDS:
                raise HTTPException(status_code=400, detail="Game exceeded time limit.")

            time_seconds = int(elapsed)

            sess_meta = sess.get("meta") if isinstance(sess.get("meta"), dict) else {}
            seed = str(sess_meta.get("seed") or "").strip()
            if not seed:
                raise HTTPException(status_code=400, detail="Run seed missing; start a new run.")

            try:
                settings = validate_settings(
                    difficulty=sess_meta.get("difficulty"),
                    fleet_size=sess_meta.get("fleet_size"),
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid run settings.") from e

            difficulty = settings["difficulty"]
            fleet_size = settings["fleet_size"]
            if body.difficulty is not None and str(body.difficulty).strip() and str(body.difficulty).strip().lower() != difficulty:
                raise HTTPException(status_code=400, detail="Difficulty mismatch with session.")
            if body.fleet_size is not None and int(body.fleet_size) != fleet_size:
                raise HTTPException(status_code=400, detail="Fleet size mismatch with session.")

            placements = sess_meta.get("ships") or []
            try:
                normalize_actions(raw_actions)
                sim = simulate_battleships(
                    seed=seed,
                    difficulty=difficulty,
                    placements=placements,
                    actions=raw_actions,
                    fleet_size=fleet_size,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid game data.") from e

            if not sim.get("won"):
                raise HTTPException(status_code=400, detail="Fleet not sunk.")

            shots_fired = int(sim.get("shots_fired") or 0)
            ships_lost = int(sim.get("ships_lost") or 0)
        else:
            raise HTTPException(status_code=400, detail="Start a verified run before submitting.")

        result = await db.user_meta.update_one(
            {"user_id": uid, "battleships_hour_start": hour_start_iso, "battleships_hour_count": {"$lt": MAX_WINS_PER_HOUR}},
            {"$inc": {"battleships_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "battleships_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"battleships_hour_start": hour_start_iso, "battleships_hour_count": 1}},
                upsert=True,
            )
            if result.modified_count == 0 and result.upserted_id is None:
                raise HTTPException(
                    status_code=429,
                    detail=f"Win limit reached ({MAX_WINS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again later.",
                )

        ships_saved = fleet_size - ships_lost
        diff_mult = {"easy": 0.6, "normal": 1.0, "hard": 1.5}.get(difficulty, 1.0)
        fleet_mult = fleet_size / 5.0
        cash = int((BASE_CASH + (ships_saved * BONUS_PER_SHIP_SAVED)) * diff_mult * fleet_mult)
        respect = int((BASE_RESPECT + (ships_saved * BONUS_RESPECT_PER_SHIP)) * diff_mult * fleet_mult)

        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": cash, "respect_points": respect}},
        )

        win_doc = {
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "shots_fired": shots_fired,
            "ships_lost": ships_lost,
            "fleet_size": fleet_size,
            "difficulty": difficulty,
            "time_seconds": time_seconds,
            "cash": cash,
            "respect": respect,
            "created_at": now_iso,
        }
        await db.battleships_wins.insert_one(win_doc)

        await log_activity(uid, current_user.get("username", "?"), "minigame_battleships", {
            "score": shots_fired, "difficulty": difficulty, "fleet_size": fleet_size,
            "ships_lost": ships_lost, "cash": cash, "respect": respect,
        })
        await log_minigame_payout(uid, current_user.get("username", "?"), "battleships", shots_fired, {"money": cash, "respect_points": respect})

        try:
            from routers.minigames.minigame_leaderboard import log_minigame_play
            total_enemy_cells = sum([5, 4, 4, 3, 3, 3, 2, 2][:fleet_size])
            accuracy_pct = (total_enemy_cells / max(1, shots_fired)) * 100
            efficiency_score = max(1, int(accuracy_pct * 10 + ships_saved * 50 * diff_mult))
            await log_minigame_play(current_user["id"], current_user.get("username"), "battleships", efficiency_score)
        except Exception:
            pass

        plays_info = await get_plays_left(db, user_id=uid, game=BATTLESHIPS_GAME)
        return {
            "ok": True,
            "shots_fired": shots_fired,
            "ships_lost": ships_lost,
            "time_seconds": time_seconds,
            "plays_left": plays_info["plays_left"],
            "max_plays": plays_info["max_plays"],
            "resets_at": plays_info["resets_at"],
        }

    @router.get("/battleships/leaderboard")
    async def get_battleships_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 Battleships wins by fewest shots with no ships lost."""
        staff_ids = await _get_staff_user_ids()
        staff_stage = [{"$match": {"user_id": {"$nin": staff_ids}}}] if staff_ids else []
        pipeline = staff_stage + [
            {"$sort": {"shots_fired": 1, "time_seconds": 1}},
            {
                "$group": {
                    "_id": "$user_id",
                    "username": {"$first": "$username"},
                    "shots_fired": {"$first": "$shots_fired"},
                    "ships_lost": {"$first": "$ships_lost"},
                    "time_seconds": {"$first": "$time_seconds"},
                    "created_at": {"$first": "$created_at"},
                }
            },
            {"$sort": {"shots_fired": 1, "time_seconds": 1}},
            {"$limit": 10},
            {
                "$project": {
                    "_id": 0,
                    "user_id": "$_id",
                    "username": 1,
                    "shots_fired": 1,
                    "ships_lost": 1,
                    "time_seconds": 1,
                    "created_at": 1,
                }
            },
        ]
        rows = await db.battleships_wins.aggregate(pipeline).to_list(10)
        return {"leaderboard": rows}

    @router.get("/battleships/my-stats")
    async def get_my_battleships_stats(current_user: dict = Depends(get_current_user)):
        """Get current user's Battleships stats."""
        pipeline = [
            {"$match": {"user_id": current_user["id"]}},
            {
                "$group": {
                    "_id": None,
                    "total_wins": {"$sum": 1},
                    "best_shots": {"$min": "$shots_fired"},
                    "avg_shots": {"$avg": "$shots_fired"},
                    "total_ships_lost": {"$sum": "$ships_lost"},
                    "perfect_games": {"$sum": {"$cond": [{"$eq": ["$ships_lost", 0]}, 1, 0]}},
                    "total_cash": {"$sum": {"$ifNull": ["$cash", 0]}},
                    "total_respect": {"$sum": {"$ifNull": ["$respect", 0]}},
                    "best_time": {"$min": "$time_seconds"},
                }
            },
        ]
        rows = await db.battleships_wins.aggregate(pipeline).to_list(1)
        if not rows:
            return {"stats": {"total_wins": 0, "best_shots": None, "avg_shots": None, "total_ships_lost": 0, "perfect_games": 0, "total_cash": 0, "total_respect": 0, "best_time": None}}
        row = rows[0]
        return {
            "stats": {
                "total_wins": row.get("total_wins", 0),
                "best_shots": row.get("best_shots"),
                "avg_shots": round(row.get("avg_shots", 0), 1) if row.get("avg_shots") else None,
                "total_ships_lost": row.get("total_ships_lost", 0),
                "perfect_games": row.get("perfect_games", 0),
                "total_cash": row.get("total_cash", 0),
                "total_respect": row.get("total_respect", 0),
                "best_time": row.get("best_time"),
            }
        }
