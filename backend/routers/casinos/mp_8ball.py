# Multiplayer 8-ball pool with AI and PvP (polling-based realtime model).
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Tuple
import math
import random
import uuid

from fastapi import Depends, HTTPException
from pydantic import BaseModel, field_validator

from server import db, get_current_user, get_current_user_verified, maybe_process_rank_up
from routers.minigames.minigame_leaderboard import log_minigame_play

_rng = random.SystemRandom()

MP_8BALL_MIN_PLAYERS = 2
MP_8BALL_MAX_PLAYERS = 2
MP_8BALL_TURN_SECONDS = 45
MP_8BALL_START_COUNTDOWN = 3
MP_8BALL_MAX_BUY_IN = 200_000_000
MP_8BALL_AI_ID = "ai_pool_bot"
MP_8BALL_TABLE_W = 2.2
MP_8BALL_TABLE_H = 1.1
MP_8BALL_BALL_R = 0.028
MP_8BALL_POCKET_R = 0.045
MP_8BALL_RESTITUTION = 0.985
MP_8BALL_FRICTION = 0.994
MP_8BALL_STOP_SPEED = 0.012
MP_8BALL_SIM_DT = 0.016
MP_8BALL_REPLAY_SAMPLE_EVERY = 1
MP_8BALL_MAX_REPLAY_FRAMES = 1200
MP_8BALL_SPIN_CARRY = 0.03
MP_8BALL_SLEEP_EPS = 0.006
MP_8BALL_POS_EPS = 1e-5
MP_8BALL_MAX_SIM_STEPS = 1200
MP_8BALL_SPIN_SWERVE = 0.045
MP_8BALL_SPIN_DECAY = 0.988
MP_8BALL_RAIL_SPIN_THROW = 0.085
MP_8BALL_AI_WIN_CASH = 1400
MP_8BALL_PVP_WIN_CASH = 650
MP_8BALL_UPGRADE_STATS = ("power", "curve", "luck", "aim", "control")
MP_8BALL_UPGRADE_STAT_CAP = 50
MP_8BALL_UPGRADE_TOTAL_CAP = 250


class PoolCreateRequest(BaseModel):
    buy_in: int = 0
    rated: bool = True
    anonymous: bool = False

    @field_validator("buy_in", mode="before")
    @classmethod
    def _coerce_buy_in(cls, v):
        if v is None:
            return 0
        if isinstance(v, str):
            return int(v.strip() or 0)
        return int(v)


class PoolShootRequest(BaseModel):
    angle: float
    power: float
    spin_x: float = 0.0
    spin_y: float = 0.0


class CueBuyRequest(BaseModel):
    cue_id: str


class CueSelectRequest(BaseModel):
    cue_instance_id: str


class CueUpgradeRequest(BaseModel):
    cue_instance_id: str
    stat: str


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


def _new_ball(ball_id: int, number: int, x: float, y: float) -> dict:
    if number == 0:
        kind = "cue"
    elif number == 8:
        kind = "black"
    elif 1 <= number <= 7:
        kind = "solid"
    else:
        kind = "stripe"
    return {
        "id": ball_id,
        "number": number,
        "kind": kind,
        "x": x,
        "y": y,
        "vx": 0.0,
        "vy": 0.0,
        "pocketed": False,
    }


def _initial_balls() -> List[dict]:
    balls: List[dict] = []
    balls.append(_new_ball(0, 0, MP_8BALL_TABLE_W * 0.25, MP_8BALL_TABLE_H * 0.5))
    rack_origin_x = MP_8BALL_TABLE_W * 0.73
    rack_origin_y = MP_8BALL_TABLE_H * 0.5
    spacing = MP_8BALL_BALL_R * 2.08
    nums = list(range(1, 16))
    _rng.shuffle(nums)
    # Keep 8 roughly center-ish in rack.
    nums.remove(8)
    nums.insert(4, 8)
    idx = 0
    ball_id = 1
    for row in range(5):
        for col in range(row + 1):
            x = rack_origin_x + row * (spacing * 0.87)
            y = rack_origin_y - (row * spacing / 2.0) + col * spacing
            balls.append(_new_ball(ball_id, nums[idx], x, y))
            idx += 1
            ball_id += 1
    return balls


def _pockets() -> List[Tuple[float, float]]:
    return [
        (0.0, 0.0),
        (MP_8BALL_TABLE_W / 2.0, 0.0),
        (MP_8BALL_TABLE_W, 0.0),
        (0.0, MP_8BALL_TABLE_H),
        (MP_8BALL_TABLE_W / 2.0, MP_8BALL_TABLE_H),
        (MP_8BALL_TABLE_W, MP_8BALL_TABLE_H),
    ]


def _active_balls(balls: List[dict]) -> List[dict]:
    return [b for b in balls if not b.get("pocketed")]


def _replay_frame_balls(balls: List[dict]) -> List[dict]:
    return [
        {
            "id": int(b.get("id") or 0),
            "number": int(b.get("number") or 0),
            "kind": b.get("kind"),
            "x": float(b.get("x") or 0.0),
            "y": float(b.get("y") or 0.0),
            "vx": float(b.get("vx") or 0.0),
            "vy": float(b.get("vy") or 0.0),
            "pocketed": bool(b.get("pocketed")),
        }
        for b in balls
    ]


def _simulate_shot(balls: List[dict], cue_angle: float, cue_power: float, spin_x: float = 0.0, spin_y: float = 0.0) -> dict:
    out = [{**b} for b in balls]
    cue = next((b for b in out if b.get("number") == 0), None)
    if not cue or cue.get("pocketed"):
        return {
            "balls": out,
            "first_contact": None,
            "pocketed_numbers": [],
            "cue_pocketed": False,
            "shot_replay": {
                "schema_version": 2,
                "frame_dt_ms": int(MP_8BALL_SIM_DT * 1000 * MP_8BALL_REPLAY_SAMPLE_EVERY),
                "duration_ms": 0,
                "frames": [{"t_ms": 0, "balls": _replay_frame_balls(out)}],
                "events": [],
            },
        }
    power = max(0.0, min(1.0, float(cue_power)))
    speed = 2.2 * power
    cue["vx"] = math.cos(cue_angle) * speed + (spin_x * 0.05)
    cue["vy"] = math.sin(cue_angle) * speed + (spin_y * 0.05)
    cue_spin_x = max(-1.0, min(1.0, float(spin_x or 0.0)))
    cue_spin_y = max(-1.0, min(1.0, float(spin_y or 0.0)))
    impacted_ids = {int(cue.get("id") or 0)}
    first_contact = None
    pocketed_numbers: List[int] = []
    replay_frames: List[dict] = [{"t_ms": 0, "balls": _replay_frame_balls(out)}]
    replay_events: List[dict] = []
    sim_elapsed_ms = 0

    settled = False
    for step in range(MP_8BALL_MAX_SIM_STEPS):
        sim_elapsed_ms = int((step + 1) * MP_8BALL_SIM_DT * 1000)
        active = _active_balls(out)
        for b in active:
            # Apply cue-ball spin as gradual side-force (swerve) and top/back speed bias.
            if b.get("number") == 0:
                speed_now = math.hypot(b["vx"], b["vy"])
                if speed_now > MP_8BALL_STOP_SPEED:
                    # Side spin curves path while ball is rolling.
                    px = -b["vy"] / max(speed_now, 1e-6)
                    py = b["vx"] / max(speed_now, 1e-6)
                    swerve = cue_spin_x * MP_8BALL_SPIN_SWERVE * MP_8BALL_SIM_DT
                    b["vx"] += px * swerve
                    b["vy"] += py * swerve
                    # Top/back spin nudges along velocity axis.
                    speed_bias = cue_spin_y * 0.035 * MP_8BALL_SIM_DT
                    b["vx"] += (b["vx"] / max(speed_now, 1e-6)) * speed_bias
                    b["vy"] += (b["vy"] / max(speed_now, 1e-6)) * speed_bias
                cue_spin_x *= MP_8BALL_SPIN_DECAY
                cue_spin_y *= MP_8BALL_SPIN_DECAY
            b["x"] += b["vx"] * MP_8BALL_SIM_DT
            b["y"] += b["vy"] * MP_8BALL_SIM_DT
            # Cushion bounce.
            if b["x"] <= MP_8BALL_BALL_R:
                b["x"] = MP_8BALL_BALL_R
                pre = abs(b["vx"])
                b["vx"] = abs(b["vx"]) * MP_8BALL_RESTITUTION
                if b.get("number") == 0:
                    b["vy"] += cue_spin_x * MP_8BALL_RAIL_SPIN_THROW
                if pre > 0.15:
                    replay_events.append({
                        "type": "rail",
                        "axis": "x",
                        "t_ms": int((step + 1) * MP_8BALL_SIM_DT * 1000),
                        "x": float(b["x"]),
                        "y": float(b["y"]),
                        "strength": float(pre),
                    })
            elif b["x"] >= MP_8BALL_TABLE_W - MP_8BALL_BALL_R:
                b["x"] = MP_8BALL_TABLE_W - MP_8BALL_BALL_R
                pre = abs(b["vx"])
                b["vx"] = -abs(b["vx"]) * MP_8BALL_RESTITUTION
                if b.get("number") == 0:
                    b["vy"] -= cue_spin_x * MP_8BALL_RAIL_SPIN_THROW
                if pre > 0.15:
                    replay_events.append({
                        "type": "rail",
                        "axis": "x",
                        "t_ms": int((step + 1) * MP_8BALL_SIM_DT * 1000),
                        "x": float(b["x"]),
                        "y": float(b["y"]),
                        "strength": float(pre),
                    })
            if b["y"] <= MP_8BALL_BALL_R:
                b["y"] = MP_8BALL_BALL_R
                pre = abs(b["vy"])
                b["vy"] = abs(b["vy"]) * MP_8BALL_RESTITUTION
                if b.get("number") == 0:
                    b["vx"] -= cue_spin_x * MP_8BALL_RAIL_SPIN_THROW
                if pre > 0.15:
                    replay_events.append({
                        "type": "rail",
                        "axis": "y",
                        "t_ms": int((step + 1) * MP_8BALL_SIM_DT * 1000),
                        "x": float(b["x"]),
                        "y": float(b["y"]),
                        "strength": float(pre),
                    })
            elif b["y"] >= MP_8BALL_TABLE_H - MP_8BALL_BALL_R:
                b["y"] = MP_8BALL_TABLE_H - MP_8BALL_BALL_R
                pre = abs(b["vy"])
                b["vy"] = -abs(b["vy"]) * MP_8BALL_RESTITUTION
                if b.get("number") == 0:
                    b["vx"] += cue_spin_x * MP_8BALL_RAIL_SPIN_THROW
                if pre > 0.15:
                    replay_events.append({
                        "type": "rail",
                        "axis": "y",
                        "t_ms": int((step + 1) * MP_8BALL_SIM_DT * 1000),
                        "x": float(b["x"]),
                        "y": float(b["y"]),
                        "strength": float(pre),
                    })

            speed_now = math.hypot(b["vx"], b["vy"])
            drag = MP_8BALL_FRICTION - (0.0015 if speed_now < 0.18 else 0.0)
            b["vx"] *= max(0.975, drag)
            b["vy"] *= max(0.975, drag)
            if abs(b["vx"]) < MP_8BALL_SLEEP_EPS:
                b["vx"] = 0.0
            if abs(b["vy"]) < MP_8BALL_SLEEP_EPS:
                b["vy"] = 0.0
            if abs(b["vx"]) < MP_8BALL_POS_EPS and abs(b["vy"]) < MP_8BALL_POS_EPS:
                b["vx"] = 0.0
                b["vy"] = 0.0

        # Ball collisions.
        active = _active_balls(out)
        for i in range(len(active)):
            for j in range(i + 1, len(active)):
                a = active[i]
                b = active[j]
                dx = b["x"] - a["x"]
                dy = b["y"] - a["y"]
                dist = math.hypot(dx, dy)
                min_dist = MP_8BALL_BALL_R * 2.0
                if dist <= 1e-8 or dist >= min_dist:
                    continue
                nx = dx / dist
                ny = dy / dist
                a_impacted = int(a.get("id") or 0) in impacted_ids
                b_impacted = int(b.get("id") or 0) in impacted_ids
                if not a_impacted and not b_impacted:
                    # Prevent untouched balls from jittering due tiny rack overlaps.
                    continue
                overlap = (min_dist - dist) * 0.5
                a["x"] -= nx * overlap
                a["y"] -= ny * overlap
                b["x"] += nx * overlap
                b["y"] += ny * overlap

                rvx = b["vx"] - a["vx"]
                rvy = b["vy"] - a["vy"]
                vel_along_normal = rvx * nx + rvy * ny
                if vel_along_normal > 0:
                    continue
                impulse = -(1 + MP_8BALL_RESTITUTION) * vel_along_normal / 2.0
                ix = impulse * nx
                iy = impulse * ny
                a["vx"] -= ix
                a["vy"] -= iy
                b["vx"] += ix
                b["vy"] += iy
                impacted_ids.add(int(a.get("id") or 0))
                impacted_ids.add(int(b.get("id") or 0))
                strength = math.hypot(ix, iy)
                if a.get("number") == 0:
                    a["vx"] += nx * MP_8BALL_SPIN_CARRY
                    a["vy"] += ny * MP_8BALL_SPIN_CARRY
                if b.get("number") == 0:
                    b["vx"] -= nx * MP_8BALL_SPIN_CARRY
                    b["vy"] -= ny * MP_8BALL_SPIN_CARRY
                if strength > 0.02:
                    band = "soft" if strength < 0.08 else "medium" if strength < 0.16 else "hard"
                    replay_events.append(
                        {
                            "type": "collision",
                            "t_ms": int((step + 1) * MP_8BALL_SIM_DT * 1000),
                            "x": float((a["x"] + b["x"]) / 2.0),
                            "y": float((a["y"] + b["y"]) / 2.0),
                            "strength": float(strength),
                            "band": band,
                        }
                    )
                if first_contact is None and (a.get("number") == 0 or b.get("number") == 0):
                    other = b if a.get("number") == 0 else a
                    first_contact = int(other.get("number") or 0)

        # Pocket detection.
        for b in out:
            if b.get("pocketed"):
                continue
            for px, py in _pockets():
                if math.hypot(b["x"] - px, b["y"] - py) <= MP_8BALL_POCKET_R:
                    b["pocketed"] = True
                    b["vx"] = 0.0
                    b["vy"] = 0.0
                    if b.get("number") is not None:
                        pocketed_numbers.append(int(b["number"]))
                        replay_events.append(
                            {
                                "type": "pocket",
                                "t_ms": int((step + 1) * MP_8BALL_SIM_DT * 1000),
                                "number": int(b.get("number") or 0),
                                "x": float(px),
                                "y": float(py),
                            }
                        )
                    break

        if ((step + 1) % MP_8BALL_REPLAY_SAMPLE_EVERY) == 0 and len(replay_frames) < MP_8BALL_MAX_REPLAY_FRAMES:
            replay_frames.append(
                {
                    "t_ms": int((step + 1) * MP_8BALL_SIM_DT * 1000),
                    "balls": _replay_frame_balls(out),
                }
            )

        # Stop condition.
        moving = False
        for b in _active_balls(out):
            if math.hypot(b["vx"], b["vy"]) > MP_8BALL_STOP_SPEED:
                moving = True
                break
        if not moving:
            settled = True
            break

    # Strict settle gate: never hand off a turn with latent micro-velocity.
    if not settled:
        for b in _active_balls(out):
            b["vx"] = 0.0
            b["vy"] = 0.0

    cue_after = next((b for b in out if b.get("number") == 0), None)
    cue_pocketed = bool(cue_after and cue_after.get("pocketed"))
    final_t_ms = max(int(sim_elapsed_ms), 1)
    if (
        not replay_frames
        or int(replay_frames[-1].get("t_ms") or 0) < final_t_ms
        or replay_frames[-1].get("balls") != _replay_frame_balls(out)
    ):
        replay_frames.append({"t_ms": final_t_ms, "balls": _replay_frame_balls(out)})
    return {
        "balls": out,
        "first_contact": first_contact,
        "pocketed_numbers": pocketed_numbers,
        "cue_pocketed": cue_pocketed,
        "balls_settled": True,
        "sim_duration_ms": final_t_ms,
        "shot_replay": {
            "schema_version": 2,
            "frame_dt_ms": int(MP_8BALL_SIM_DT * 1000 * MP_8BALL_REPLAY_SAMPLE_EVERY),
            "duration_ms": final_t_ms,
            "frames": replay_frames,
            "events": replay_events[-120:],
        },
    }


def _remaining_group_balls(balls: List[dict], group: Optional[str]) -> int:
    if group not in ("solid", "stripe"):
        return 0
    return sum(1 for b in balls if not b.get("pocketed") and b.get("kind") == group)


def _ensure_game_turn(game: dict, uid: str):
    if game.get("phase") != "playing":
        raise HTTPException(status_code=400, detail="Balls are still resolving")
    players = list(game.get("players") or [])
    idx = int(game.get("current_turn_index") or 0)
    if idx < 0 or idx >= len(players):
        raise HTTPException(status_code=400, detail="Invalid turn state")
    if players[idx].get("user_id") != uid:
        raise HTTPException(status_code=400, detail="It is not your turn")


def _maybe_finalize_resolving(game: dict) -> dict:
    if game.get("status") != "in_progress":
        return game
    if game.get("phase") != "resolving":
        return game
    resolve_at = _parse_iso(game.get("resolve_at"))
    if resolve_at and datetime.now(timezone.utc) < resolve_at:
        return game
    players = list(game.get("players") or [])
    fallback_idx = int(game.get("current_turn_index") or 0)
    next_idx = int(game.get("pending_turn_index") or fallback_idx)
    if next_idx < 0 or next_idx >= len(players):
        next_idx = fallback_idx
    game["phase"] = "playing"
    game["current_turn_index"] = next_idx
    game["pending_turn_index"] = None
    game["resolve_at"] = None
    game["turn_started_at"] = _now_iso()
    game["updated_at"] = _now_iso()
    game.setdefault("table_state", {})["balls_settled"] = True
    return game


def _public_game(game: dict, viewer_uid: Optional[str] = None) -> dict:
    g = {k: v for k, v in game.items() if k != "_id"}
    g["viewer_user_id"] = viewer_uid
    if g.get("anonymous"):
        for i, p in enumerate(g.get("players") or []):
            if p.get("user_id") != viewer_uid:
                p["username"] = f"Player {i + 1}"
    return g


def _elo_delta(my: int, opp: int, win: bool, k: int = 24) -> int:
    expected = 1.0 / (1.0 + 10 ** ((opp - my) / 400.0))
    score = 1.0 if win else 0.0
    return int(round(k * (score - expected)))


def _cue_catalog() -> List[dict]:
    return [
        {"id": "basic_oak", "name": "Basic Oak Cue", "price_points": 0, "stats": {"power": 1.0, "aim": 1.0, "spin": 1.0, "control": 1.0}},
        {"id": "street_hustler", "name": "Street Hustler Cue", "price_points": 2500, "stats": {"power": 1.06, "aim": 1.03, "spin": 1.04, "control": 1.02}},
        {"id": "don_series", "name": "Don Series Cue", "price_points": 7500, "stats": {"power": 1.12, "aim": 1.08, "spin": 1.09, "control": 1.08}},
        {"id": "legacy_noir", "name": "Legacy Noir Cue", "price_points": 14500, "stats": {"power": 1.18, "aim": 1.14, "spin": 1.14, "control": 1.12}},
    ]


def _upgrade_defaults(uid: str, cue_instance_id: str) -> dict:
    return {
        "user_id": uid,
        "cue_instance_id": cue_instance_id,
        "power": 0,
        "curve": 0,
        "luck": 0,
        "aim": 0,
        "control": 0,
        "spin": 0,   # legacy compatibility
        "preview": 0,  # legacy compatibility
    }


def _normalize_upgrade_doc(row: Optional[dict], uid: str, cue_instance_id: str) -> dict:
    out = _upgrade_defaults(uid, cue_instance_id)
    src = row or {}
    for k in ("power", "curve", "luck", "aim", "control", "spin", "preview"):
        out[k] = max(0, int(src.get(k) or 0))
    # Backfill curve from legacy spin if needed.
    if out["curve"] <= 0 and out["spin"] > 0:
        out["curve"] = out["spin"]
    return out


def _upgrade_total_level(upg: dict) -> int:
    return int(sum(int(upg.get(k) or 0) for k in MP_8BALL_UPGRADE_STATS))


def _upgrade_milestones(upg: dict) -> Dict[str, int]:
    return {k: int(int(upg.get(k) or 0) // 10) for k in MP_8BALL_UPGRADE_STATS}


def _upgrade_effects(upg: dict) -> dict:
    lv_power = int(upg.get("power") or 0)
    lv_curve = int(upg.get("curve") or 0)
    lv_luck = int(upg.get("luck") or 0)
    lv_aim = int(upg.get("aim") or 0)
    lv_control = int(upg.get("control") or 0)
    ms = _upgrade_milestones(upg)
    return {
        "power_mul": 1.0 + (lv_power * 0.006) + (ms["power"] * 0.01),
        "curve_mul": 1.0 + (lv_curve * 0.007) + (ms["curve"] * 0.015),
        "luck_chance": min(0.24, (lv_luck * 0.0035) + (ms["luck"] * 0.01)),
        "aim_nudge": max(0.0, 0.05 - (lv_aim * 0.0008)),
        "foul_relief_chance": min(0.2, (lv_control * 0.0028) + (ms["control"] * 0.008)),
    }


def _upgrade_cash_cost(stat_level: int, total_level: int) -> int:
    base = 420 + (stat_level * 130)
    progression_tax = (total_level // 5) * 30
    return int(base + progression_tax)


def register(router):
    @router.get("/casino/mp-8ball/games")
    async def pool_list_games(current_user: dict = Depends(get_current_user_verified)):
        rows = await db.mp_8ball_games.find(
            {"mode": "vs_players", "status": {"$in": ["waiting", "in_progress"]}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(60)
        return {"games": [_public_game(r, current_user.get("id")) for r in rows]}

    @router.post("/casino/mp-8ball/games")
    async def pool_create_game(body: PoolCreateRequest, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        buy_in = max(0, min(MP_8BALL_MAX_BUY_IN, int(body.buy_in or 0)))
        if buy_in > 0:
            user = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1})
            if not user or int(user.get("money") or 0) < buy_in:
                raise HTTPException(status_code=400, detail="Not enough cash for buy-in")
            await db.users.update_one({"id": uid, "money": {"$gte": buy_in}}, {"$inc": {"money": -buy_in}})
        gid = f"mp8_{uuid.uuid4().hex[:12]}"
        player = {
            "user_id": uid,
            "username": current_user.get("username") or "?",
            "ready": True,
            "group": None,
            "fouls": 0,
            "score": 0,
        }
        game = {
            "id": gid,
            "mode": "vs_players",
            "status": "waiting",
            "phase": "lobby",
            "rated": bool(body.rated),
            "anonymous": bool(body.anonymous),
            "buy_in": buy_in,
            "pot": buy_in,
            "players": [player],
            "max_players": 2,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "current_turn_index": 0,
            "turn_started_at": None,
            "all_ready_at": None,
            "winner_user_id": None,
            "result_reason": None,
            "table_state": {
                "table_w": MP_8BALL_TABLE_W,
                "table_h": MP_8BALL_TABLE_H,
                "balls": _initial_balls(),
                "shot_count": 0,
                "balls_settled": True,
                "history": [],
            },
        }
        await db.mp_8ball_games.insert_one(game)
        return _public_game(game, uid)

    @router.post("/casino/mp-8ball/games/{game_id}/join")
    async def pool_join_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        game = await db.mp_8ball_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.get("status") != "waiting":
            raise HTTPException(status_code=400, detail="Game already started")
        players = list(game.get("players") or [])
        if any(p.get("user_id") == uid for p in players):
            return _public_game(game, uid)
        if len(players) >= MP_8BALL_MAX_PLAYERS:
            raise HTTPException(status_code=400, detail="Game is full")
        buy_in = int(game.get("buy_in") or 0)
        if buy_in > 0:
            user = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1})
            if not user or int(user.get("money") or 0) < buy_in:
                raise HTTPException(status_code=400, detail="Not enough cash for buy-in")
            await db.users.update_one({"id": uid, "money": {"$gte": buy_in}}, {"$inc": {"money": -buy_in}})
        players.append({
            "user_id": uid,
            "username": current_user.get("username") or "?",
            "ready": True,
            "group": None,
            "fouls": 0,
            "score": 0,
        })
        await db.mp_8ball_games.update_one(
            {"id": game_id},
            {"$set": {"players": players, "pot": int(game.get("pot") or 0) + buy_in, "updated_at": _now_iso()}},
        )
        game = await db.mp_8ball_games.find_one({"id": game_id}, {"_id": 0})
        return _public_game(game, uid)

    @router.post("/casino/mp-8ball/games/{game_id}/leave")
    async def pool_leave_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        game = await db.mp_8ball_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.get("status") != "waiting":
            raise HTTPException(status_code=400, detail="Cannot leave after match start")
        players = [p for p in (game.get("players") or []) if p.get("user_id") != uid]
        if len(players) == len(game.get("players") or []):
            return {"message": "Not in game"}
        buy_in = int(game.get("buy_in") or 0)
        if buy_in > 0:
            await db.users.update_one({"id": uid}, {"$inc": {"money": buy_in}})
        if not players:
            await db.mp_8ball_games.delete_one({"id": game_id})
            return {"message": "Game closed"}
        await db.mp_8ball_games.update_one({"id": game_id}, {"$set": {"players": players, "pot": max(0, int(game.get("pot") or 0) - buy_in)}})
        return {"message": "Left game"}

    @router.post("/casino/mp-8ball/games/{game_id}/ready")
    async def pool_ready_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        game = await db.mp_8ball_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        players = list(game.get("players") or [])
        found = False
        for p in players:
            if p.get("user_id") == uid:
                p["ready"] = True
                found = True
        if not found:
            raise HTTPException(status_code=400, detail="You are not in this game")
        all_ready = len(players) == 2 and all(bool(p.get("ready")) for p in players)
        updates = {"players": players, "updated_at": _now_iso()}
        if all_ready:
            updates["all_ready_at"] = _now_iso()
        await db.mp_8ball_games.update_one({"id": game_id}, {"$set": updates})
        return {"message": "Ready status updated", "all_ready": all_ready}

    @router.post("/casino/mp-8ball/games/{game_id}/start")
    async def pool_start_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        game = await db.mp_8ball_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        players = list(game.get("players") or [])
        if len(players) != 2:
            raise HTTPException(status_code=400, detail="Need 2 players")
        if players[0].get("user_id") != uid and players[1].get("user_id") != uid:
            raise HTTPException(status_code=403, detail="Not in this game")
        if not all(bool(p.get("ready")) for p in players):
            raise HTTPException(status_code=400, detail="All players must be ready")
        breaker = _rng.randrange(0, 2)
        await db.mp_8ball_games.update_one(
            {"id": game_id, "status": "waiting"},
            {
                "$set": {
                    "status": "in_progress",
                    "phase": "playing",
                    "current_turn_index": breaker,
                    "turn_started_at": _now_iso(),
                    "updated_at": _now_iso(),
                }
            },
        )
        g = await db.mp_8ball_games.find_one({"id": game_id}, {"_id": 0})
        return _public_game(g, uid)

    @router.get("/casino/mp-8ball/games/{game_id}")
    async def pool_get_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        game = await db.mp_8ball_games.find_one({"id": game_id}, {"_id": 0})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        uid = current_user["id"]
        if not any(p.get("user_id") == uid for p in (game.get("players") or [])):
            raise HTTPException(status_code=403, detail="Not in this game")
        game_before = dict(game)
        game = _maybe_finalize_resolving(game)
        if game != game_before:
            await db.mp_8ball_games.update_one(
                {"id": game_id},
                {
                    "$set": {
                        "phase": game.get("phase"),
                        "current_turn_index": game.get("current_turn_index"),
                        "pending_turn_index": game.get("pending_turn_index"),
                        "resolve_at": game.get("resolve_at"),
                        "turn_started_at": game.get("turn_started_at"),
                        "updated_at": game.get("updated_at"),
                        "table_state": game.get("table_state"),
                    }
                },
            )
        # Auto-timeout handling.
        if game.get("status") == "in_progress" and game.get("phase") == "playing":
            ts = _parse_iso(game.get("turn_started_at"))
            if ts and (datetime.now(timezone.utc) - ts).total_seconds() > MP_8BALL_TURN_SECONDS:
                players = list(game.get("players") or [])
                idx = int(game.get("current_turn_index") or 0)
                players[idx]["fouls"] = int(players[idx].get("fouls") or 0) + 1
                nidx = (idx + 1) % len(players)
                await db.mp_8ball_games.update_one(
                    {"id": game_id},
                    {"$set": {"players": players, "current_turn_index": nidx, "turn_started_at": _now_iso(), "updated_at": _now_iso()}},
                )
                game = await db.mp_8ball_games.find_one({"id": game_id}, {"_id": 0})
        return _public_game(game, uid)

    @router.post("/casino/mp-8ball/games/{game_id}/shoot")
    async def pool_shoot(game_id: str, body: PoolShootRequest, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        game = await db.mp_8ball_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.get("status") != "in_progress" or game.get("phase") != "playing":
            raise HTTPException(status_code=400, detail="Game is not active")
        _ensure_game_turn(game, uid)

        players = list(game.get("players") or [])
        idx = int(game.get("current_turn_index") or 0)
        shooter = players[idx]
        opp_idx = (idx + 1) % len(players)
        opponent = players[opp_idx]
        shooter_uid = str(shooter.get("user_id") or "")

        table_state = dict(game.get("table_state") or {})
        balls = list(table_state.get("balls") or [])
        selected_cue = await db.user_pool_cues.find_one({"user_id": shooter_uid, "selected": True}, {"_id": 0, "id": 1})
        if not selected_cue:
            selected_cue = await db.user_pool_cues.find_one({"user_id": shooter_uid}, {"_id": 0, "id": 1})
        upg_row = None
        if selected_cue and selected_cue.get("id"):
            upg_row = await db.pool_cue_upgrades.find_one(
                {"user_id": shooter_uid, "cue_instance_id": selected_cue.get("id")},
                {"_id": 0},
            )
        shooter_upg = _normalize_upgrade_doc(upg_row, shooter_uid, str((selected_cue or {}).get("id") or ""))
        effects = _upgrade_effects(shooter_upg)
        input_angle = float(body.angle) + (_rng.uniform(-1, 1) * effects["aim_nudge"] * 0.5)
        input_power = max(0.0, min(1.0, float(body.power) * effects["power_mul"]))
        input_spin_x = float(body.spin_x or 0.0) * effects["curve_mul"]
        input_spin_y = float(body.spin_y or 0.0) * effects["curve_mul"]
        sim = _simulate_shot(
            balls,
            cue_angle=input_angle,
            cue_power=input_power,
            spin_x=input_spin_x,
            spin_y=input_spin_y,
        )
        new_balls = sim["balls"]
        shot_replay = sim.get("shot_replay") or {}
        pocketed = [n for n in sim["pocketed_numbers"] if n != 0]
        first_contact = sim["first_contact"]
        cue_pocketed = bool(sim["cue_pocketed"])

        shooter_group = shooter.get("group")
        opponent_group = opponent.get("group")
        solids = [n for n in pocketed if 1 <= n <= 7]
        stripes = [n for n in pocketed if 9 <= n <= 15]
        black_pocketed = 8 in pocketed

        # Assign groups if still open and only one category was pocketed.
        if shooter_group is None and opponent_group is None:
            if solids and not stripes:
                shooter_group, opponent_group = "solid", "stripe"
            elif stripes and not solids:
                shooter_group, opponent_group = "stripe", "solid"
            shooter["group"] = shooter_group
            opponent["group"] = opponent_group

        # Determine legal target.
        legal_target = None
        if shooter_group in ("solid", "stripe"):
            if _remaining_group_balls(new_balls, shooter_group) > 0:
                legal_target = shooter_group
            else:
                legal_target = "black"

        foul = False
        if cue_pocketed:
            foul = True
        if first_contact is None:
            foul = True
        else:
            first_kind = "solid" if 1 <= first_contact <= 7 else "stripe" if 9 <= first_contact <= 15 else "black" if first_contact == 8 else "cue"
            if legal_target and first_kind != legal_target:
                foul = True
            if legal_target is None and first_contact == 8:
                foul = True
        if foul and _rng.random() < effects["foul_relief_chance"]:
            foul = False

        winner_uid = None
        result_reason = None
        keep_turn = False

        if black_pocketed:
            can_pot_black = (legal_target == "black")
            if can_pot_black and not foul:
                winner_uid = uid
                result_reason = "8-ball legally potted"
            else:
                winner_uid = opponent.get("user_id")
                result_reason = "8-ball foul"
        else:
            if not foul:
                if shooter_group == "solid":
                    keep_turn = len(solids) > 0
                elif shooter_group == "stripe":
                    keep_turn = len(stripes) > 0
                else:
                    keep_turn = len(pocketed) > 0
                if not keep_turn and _rng.random() < effects["luck_chance"] and len(pocketed) > 0:
                    keep_turn = True
            else:
                shooter["fouls"] = int(shooter.get("fouls") or 0) + 1
                keep_turn = False

        table_state["balls"] = new_balls
        table_state["shot_count"] = int(table_state.get("shot_count") or 0) + 1
        table_state["last_shot_replay"] = shot_replay
        table_state["last_shot_replay_shot_count"] = int(table_state.get("shot_count") or 0)
        table_state["balls_settled"] = bool(sim.get("balls_settled", True))
        hist = list(table_state.get("history") or [])
        hist.append({
            "at": _now_iso(),
            "shooter_id": uid,
            "first_contact": first_contact,
            "pocketed": pocketed,
            "foul": foul,
            "cue_pocketed": cue_pocketed,
        })
        table_state["history"] = hist[-40:]

        updates = {
            "players": players,
            "table_state": table_state,
            "updated_at": _now_iso(),
        }
        if winner_uid:
            updates["status"] = "completed"
            updates["phase"] = "settled"
            updates["winner_user_id"] = winner_uid
            updates["result_reason"] = result_reason
            updates["completed_at"] = _now_iso()
        else:
            next_turn_idx = idx if keep_turn else opp_idx
            replay_duration_ms = int((shot_replay or {}).get("duration_ms") or 0)
            sim_duration_ms = int(sim.get("sim_duration_ms") or replay_duration_ms)
            # Keep authoritative lock until replay window completes.
            hold_ms = max(450, max(replay_duration_ms, sim_duration_ms) + 120)
            updates["phase"] = "resolving"
            updates["pending_turn_index"] = next_turn_idx
            updates["resolve_at"] = (datetime.now(timezone.utc) + timedelta(milliseconds=hold_ms)).isoformat()
            updates["turn_started_at"] = game.get("turn_started_at") or _now_iso()
            table_state["balls_settled"] = False

        await db.mp_8ball_games.update_one({"id": game_id}, {"$set": updates})

        # Settlement / progression.
        if winner_uid:
            pot = int(game.get("pot") or 0)
            if pot > 0:
                await db.users.update_one({"id": winner_uid}, {"$inc": {"money": pot}})
            win_cash = MP_8BALL_AI_WIN_CASH if str(game.get("mode")) == "vs_ai" else MP_8BALL_PVP_WIN_CASH
            await db.users.update_one({"id": winner_uid}, {"$inc": {"money": int(win_cash)}})
            loser_uid = opponent.get("user_id") if winner_uid == uid else uid
            # Rank points and MMR.
            w_prof = await db.pool_profiles.find_one({"user_id": winner_uid}, {"_id": 0}) or {"user_id": winner_uid, "rating": 1000, "wins": 0, "losses": 0}
            l_prof = await db.pool_profiles.find_one({"user_id": loser_uid}, {"_id": 0}) or {"user_id": loser_uid, "rating": 1000, "wins": 0, "losses": 0}
            w_delta = _elo_delta(int(w_prof.get("rating") or 1000), int(l_prof.get("rating") or 1000), True)
            l_delta = _elo_delta(int(l_prof.get("rating") or 1000), int(w_prof.get("rating") or 1000), False)
            await db.pool_profiles.update_one(
                {"user_id": winner_uid},
                {"$inc": {"wins": 1, "rating": w_delta}, "$setOnInsert": {"created_at": _now_iso()}},
                upsert=True,
            )
            await db.pool_profiles.update_one(
                {"user_id": loser_uid},
                {"$inc": {"losses": 1, "rating": l_delta}, "$setOnInsert": {"created_at": _now_iso()}},
                upsert=True,
            )
            winner_doc = await db.users.find_one({"id": winner_uid}, {"_id": 0, "rank_points": 1, "username": 1})
            if winner_doc:
                rp_gain = 60 if bool(game.get("rated", True)) else 25
                await db.users.update_one({"id": winner_uid}, {"$inc": {"rank_points": rp_gain}})
                await maybe_process_rank_up(
                    winner_uid,
                    int(winner_doc.get("rank_points") or 0),
                    rp_gain,
                    winner_doc.get("username") or "?",
                    1.0,
                )
                await log_minigame_play(winner_uid, winner_doc.get("username") or "?", "pool_8ball", int(table_state.get("shot_count") or 0))

        g = await db.mp_8ball_games.find_one({"id": game_id}, {"_id": 0})
        return _public_game(g, uid)

    @router.post("/casino/mp-8ball/games/{game_id}/timeout")
    async def pool_timeout(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        game = await db.mp_8ball_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        _ensure_game_turn(game, uid)
        players = list(game.get("players") or [])
        idx = int(game.get("current_turn_index") or 0)
        players[idx]["fouls"] = int(players[idx].get("fouls") or 0) + 1
        nidx = (idx + 1) % len(players)
        await db.mp_8ball_games.update_one(
            {"id": game_id},
            {"$set": {"players": players, "current_turn_index": nidx, "turn_started_at": _now_iso(), "updated_at": _now_iso()}},
        )
        return {"message": "Turn timed out"}

    @router.post("/casino/mp-8ball/vs-ai/start")
    async def pool_ai_start(current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        # Close old active AI session.
        await db.mp_8ball_games.update_many(
            {"mode": "vs_ai", "status": {"$in": ["waiting", "in_progress"]}, "owner_user_id": uid},
            {"$set": {"status": "completed", "phase": "abandoned", "completed_at": _now_iso()}},
        )
        gid = f"ai8_{uuid.uuid4().hex[:12]}"
        game = {
            "id": gid,
            "owner_user_id": uid,
            "mode": "vs_ai",
            "status": "in_progress",
            "phase": "playing",
            "rated": False,
            "anonymous": False,
            "buy_in": 0,
            "pot": 0,
            "players": [
                {"user_id": uid, "username": current_user.get("username") or "You", "ready": True, "group": None, "fouls": 0, "score": 0},
                {"user_id": MP_8BALL_AI_ID, "username": "AI Shark", "ready": True, "group": None, "fouls": 0, "score": 0},
            ],
            "max_players": 2,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "current_turn_index": _rng.randrange(0, 2),
            "turn_started_at": _now_iso(),
            "winner_user_id": None,
            "result_reason": None,
            "table_state": {"table_w": MP_8BALL_TABLE_W, "table_h": MP_8BALL_TABLE_H, "balls": _initial_balls(), "shot_count": 0, "balls_settled": True, "history": []},
        }
        await db.mp_8ball_games.insert_one(game)
        return _public_game(game, uid)

    async def _ai_take_turn(game: dict):
        players = list(game.get("players") or [])
        idx = int(game.get("current_turn_index") or 0)
        shooter = players[idx]
        if shooter.get("user_id") != MP_8BALL_AI_ID:
            return
        balls = list((game.get("table_state") or {}).get("balls") or [])
        cue = next((b for b in balls if b.get("number") == 0), None)
        targets = [b for b in balls if not b.get("pocketed") and b.get("number") not in (0, 8)]
        if not cue or not targets:
            target = next((b for b in balls if not b.get("pocketed") and b.get("number") == 8), None)
            if not cue or not target:
                return
        else:
            target = min(targets, key=lambda b: math.hypot((b["x"] - cue["x"]), (b["y"] - cue["y"])))
        ang = math.atan2((target["y"] - cue["y"]), (target["x"] - cue["x"]))
        req = PoolShootRequest(angle=ang, power=0.65 + _rng.random() * 0.25, spin_x=0.0, spin_y=0.0)
        fake_user = {"id": MP_8BALL_AI_ID}
        # Reuse core shot logic by directly applying here.
        sim = _simulate_shot(
            balls,
            cue_angle=float(req.angle),
            cue_power=float(req.power),
            spin_x=float(req.spin_x),
            spin_y=float(req.spin_y),
        )
        game["table_state"]["balls"] = sim["balls"]
        game["table_state"]["shot_count"] = int(game["table_state"].get("shot_count") or 0) + 1
        game["table_state"]["last_shot_replay"] = sim.get("shot_replay") or {}
        game["table_state"]["last_shot_replay_shot_count"] = int(game["table_state"].get("shot_count") or 0)
        game["table_state"]["balls_settled"] = bool(sim.get("balls_settled", True))
        game["current_turn_index"] = 0
        game["turn_started_at"] = _now_iso()
        game["updated_at"] = _now_iso()
        await db.mp_8ball_games.update_one(
            {"id": game["id"], "status": "in_progress"},
            {"$set": {"table_state": game["table_state"], "current_turn_index": game["current_turn_index"], "turn_started_at": game["turn_started_at"], "updated_at": game["updated_at"]}},
        )

    @router.get("/casino/mp-8ball/vs-ai/game")
    async def pool_ai_get_game(current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        game = await db.mp_8ball_games.find_one(
            {"mode": "vs_ai", "owner_user_id": uid, "status": {"$in": ["waiting", "in_progress"]}},
            sort=[("created_at", -1)],
        )
        if not game:
            raise HTTPException(status_code=404, detail="No active AI game")
        game_before = dict(game)
        game = _maybe_finalize_resolving(game)
        if game != game_before:
            await db.mp_8ball_games.update_one(
                {"id": game["id"]},
                {
                    "$set": {
                        "phase": game.get("phase"),
                        "current_turn_index": game.get("current_turn_index"),
                        "pending_turn_index": game.get("pending_turn_index"),
                        "resolve_at": game.get("resolve_at"),
                        "turn_started_at": game.get("turn_started_at"),
                        "updated_at": game.get("updated_at"),
                        "table_state": game.get("table_state"),
                    }
                },
            )
        idx = int(game.get("current_turn_index") or 0)
        players = list(game.get("players") or [])
        if game.get("status") == "in_progress" and game.get("phase") == "playing" and idx < len(players) and players[idx].get("user_id") == MP_8BALL_AI_ID:
            ts = _parse_iso(game.get("turn_started_at"))
            if not ts or (datetime.now(timezone.utc) - ts).total_seconds() >= 1.1:
                await _ai_take_turn(game)
                game = await db.mp_8ball_games.find_one({"id": game["id"]})
        return _public_game(game, uid)

    @router.post("/casino/mp-8ball/vs-ai/shoot")
    async def pool_ai_shoot(body: PoolShootRequest, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        game = await db.mp_8ball_games.find_one(
            {"mode": "vs_ai", "owner_user_id": uid, "status": "in_progress"},
            sort=[("created_at", -1)],
        )
        if not game:
            raise HTTPException(status_code=404, detail="No active AI game")
        _ensure_game_turn(game, uid)
        # Reuse PvP shot endpoint implementation.
        return await pool_shoot(game["id"], body, current_user)

    @router.get("/casino/mp-8ball/profile")
    async def pool_profile(current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        p = await db.pool_profiles.find_one({"user_id": uid}, {"_id": 0}) or {"user_id": uid, "rating": 1000, "wins": 0, "losses": 0}
        user_row = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1})
        selected_cue = await db.user_pool_cues.find_one({"user_id": uid, "selected": True}, {"_id": 0, "id": 1, "cue_id": 1})
        if not selected_cue:
            selected_cue = await db.user_pool_cues.find_one({"user_id": uid}, {"_id": 0, "id": 1, "cue_id": 1})
        return {
            "rating": int(p.get("rating") or 1000),
            "wins": int(p.get("wins") or 0),
            "losses": int(p.get("losses") or 0),
            "money": int((user_row or {}).get("money") or 0),
            "selected_cue_id": (selected_cue or {}).get("id"),
            "selected_cue_type": (selected_cue or {}).get("cue_id"),
        }

    @router.get("/casino/mp-8ball/leaderboard")
    async def pool_leaderboard(current_user: dict = Depends(get_current_user_verified)):
        rows = await db.pool_profiles.find({}, {"_id": 0}).sort([("rating", -1), ("wins", -1)]).to_list(100)
        return {"rows": rows[:50]}

    @router.get("/casino/mp-8ball/cues/catalog")
    async def pool_cues_catalog(current_user: dict = Depends(get_current_user_verified)):
        return {"catalog": _cue_catalog()}

    @router.get("/casino/mp-8ball/cues/me")
    async def pool_cues_me(current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        owned = await db.user_pool_cues.find({"user_id": uid}, {"_id": 0}).sort("acquired_at", 1).to_list(100)
        rows = await db.pool_cue_upgrades.find({"user_id": uid}, {"_id": 0}).to_list(300)
        row_by_cue = {str(r.get("cue_instance_id") or ""): r for r in rows}
        upgs = []
        for cue in owned:
            cue_id = str(cue.get("id") or "")
            norm = _normalize_upgrade_doc(row_by_cue.get(cue_id), uid, cue_id)
            norm["total_level"] = _upgrade_total_level(norm)
            norm["milestones"] = _upgrade_milestones(norm)
            upgs.append(norm)
        return {"owned": owned, "upgrades": upgs, "upgrade_total_cap": MP_8BALL_UPGRADE_TOTAL_CAP, "upgrade_stat_cap": MP_8BALL_UPGRADE_STAT_CAP}

    @router.post("/casino/mp-8ball/cues/buy")
    async def pool_cues_buy(body: CueBuyRequest, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        cue = next((c for c in _cue_catalog() if c["id"] == body.cue_id), None)
        if not cue:
            raise HTTPException(status_code=400, detail="Cue not found")
        exists = await db.user_pool_cues.find_one({"user_id": uid, "cue_id": cue["id"]}, {"_id": 0, "id": 1})
        if exists:
            raise HTTPException(status_code=400, detail="Cue already owned")
        price = int(cue.get("price_points") or 0)
        if price > 0:
            user = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1})
            if not user or int(user.get("points") or 0) < price:
                raise HTTPException(status_code=400, detail="Not enough points")
            await db.users.update_one({"id": uid, "points": {"$gte": price}}, {"$inc": {"points": -price}})
        owned_count = await db.user_pool_cues.count_documents({"user_id": uid})
        inst_id = f"cue_{uuid.uuid4().hex[:10]}"
        await db.user_pool_cues.insert_one(
            {"id": inst_id, "user_id": uid, "cue_id": cue["id"], "selected": owned_count == 0, "acquired_at": _now_iso()}
        )
        await db.pool_cue_upgrades.update_one(
            {"user_id": uid, "cue_instance_id": inst_id},
            {
                "$setOnInsert": {
                    "user_id": uid,
                    "cue_instance_id": inst_id,
                    "power": 0,
                    "curve": 0,
                    "luck": 0,
                    "aim": 0,
                    "control": 0,
                    "spin": 0,
                    "preview": 0,
                    "created_at": _now_iso(),
                }
            },
            upsert=True,
        )
        return {"message": "Cue purchased", "cue_instance_id": inst_id}

    @router.post("/casino/mp-8ball/cues/select")
    async def pool_cues_select(body: CueSelectRequest, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        row = await db.user_pool_cues.find_one({"id": body.cue_instance_id, "user_id": uid}, {"_id": 0, "id": 1})
        if not row:
            raise HTTPException(status_code=404, detail="Cue not owned")
        await db.user_pool_cues.update_many({"user_id": uid}, {"$set": {"selected": False}})
        await db.user_pool_cues.update_one({"id": body.cue_instance_id, "user_id": uid}, {"$set": {"selected": True}})
        return {"message": "Cue selected"}

    @router.post("/casino/mp-8ball/cues/upgrade")
    async def pool_cues_upgrade(body: CueUpgradeRequest, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user["id"]
        stat = (body.stat or "").strip().lower()
        if stat == "spin":
            stat = "curve"
        if stat == "preview":
            stat = "aim"
        if stat not in MP_8BALL_UPGRADE_STATS:
            raise HTTPException(status_code=400, detail="Invalid stat")
        cue = await db.user_pool_cues.find_one({"id": body.cue_instance_id, "user_id": uid}, {"_id": 0, "id": 1})
        if not cue:
            raise HTTPException(status_code=404, detail="Cue not owned")
        raw_upg = await db.pool_cue_upgrades.find_one({"user_id": uid, "cue_instance_id": body.cue_instance_id}, {"_id": 0})
        upg = _normalize_upgrade_doc(raw_upg, uid, body.cue_instance_id)
        lvl = int(upg.get(stat) or 0)
        total_level = _upgrade_total_level(upg)
        if total_level >= MP_8BALL_UPGRADE_TOTAL_CAP:
            raise HTTPException(status_code=400, detail="Total upgrade cap reached")
        if lvl >= MP_8BALL_UPGRADE_STAT_CAP:
            raise HTTPException(status_code=400, detail="Stat is maxed")
        cost = _upgrade_cash_cost(lvl, total_level)
        user = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1})
        if not user or int(user.get("money") or 0) < cost:
            raise HTTPException(status_code=400, detail="Not enough cash")
        await db.users.update_one({"id": uid, "money": {"$gte": cost}}, {"$inc": {"money": -cost}})
        await db.pool_cue_upgrades.update_one(
            {"user_id": uid, "cue_instance_id": body.cue_instance_id},
            {"$inc": {stat: 1}, "$setOnInsert": {"created_at": _now_iso(), **_upgrade_defaults(uid, body.cue_instance_id)}},
            upsert=True,
        )
        new_row = await db.pool_cue_upgrades.find_one({"user_id": uid, "cue_instance_id": body.cue_instance_id}, {"_id": 0})
        new_upg = _normalize_upgrade_doc(new_row, uid, body.cue_instance_id)
        balance = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1})
        return {
            "message": f"{stat.title()} upgraded",
            "cost": cost,
            "currency": "cash",
            "money_balance": int((balance or {}).get("money") or 0),
            "total_level": _upgrade_total_level(new_upg),
            "milestones": _upgrade_milestones(new_upg),
            "upgrades": new_upg,
        }
