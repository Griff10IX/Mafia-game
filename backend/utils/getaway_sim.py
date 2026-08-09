"""Deterministic The Getaway re-sim from seed + preset + per-frame inputs.

Mirrors src/pages/MiniGames/theGetawayEngine.js gameplay ticks (fixed 60Hz).
Cosmetic world RNG (streaks/buildings) is omitted — does not affect score.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

W = 480.0
H = 640.0
LANE_COUNT = 3
HORIZON_Y = H * 0.28
ROAD_TOP_W = W * 0.2
ROAD_BOTTOM_W = W * 0.88
PLAYER_Y = H - 128.0

MAX_FRAMES = 36_000  # 10 min @ 60fps
MAX_INPUTS = 4_000
MAX_DISTANCE_SANITY = 50_000

SPEED_PRESETS = {
    "relaxed": {
        "id": "relaxed",
        "base": 2.1,
        "max": 5.8,
        "rampFrames": 10800,
        "scrollMult": 0.68,
        "worldMult": 0.75,
        "spawnBase": 175,
        "spawnAhead": 155,
        "graceFrames": 150,
        "obstacleScrollMult": 0.7,
        "copScrollMult": 0.62,
        "maxObstacles": 4,
    },
    "normal": {
        "id": "normal",
        "base": 3.0,
        "max": 8.2,
        "rampFrames": 7200,
        "scrollMult": 0.78,
        "worldMult": 0.86,
        "spawnBase": 145,
        "spawnAhead": 140,
        "graceFrames": 120,
        "obstacleScrollMult": 0.76,
        "copScrollMult": 0.68,
        "maxObstacles": 5,
    },
    "fast": {
        "id": "fast",
        "base": 4.2,
        "max": 11.5,
        "rampFrames": 4800,
        "scrollMult": 0.88,
        "worldMult": 0.95,
        "spawnBase": 118,
        "spawnAhead": 125,
        "graceFrames": 90,
        "obstacleScrollMult": 0.82,
        "copScrollMult": 0.74,
        "maxObstacles": 6,
    },
}


def mulberry32(seed: int):
    t = seed & 0xFFFFFFFF

    def _next() -> float:
        nonlocal t
        t = (t + 0x6D2B79F5) & 0xFFFFFFFF
        x = t
        x = ((x ^ (x >> 15)) * (x | 1)) & 0xFFFFFFFF
        x ^= (x + (((x ^ (x >> 7)) * (x | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((x ^ (x >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return _next


def seed_to_u32(seed: str) -> int:
    s = (seed or "").strip().lower()
    if not s:
        return 1
    try:
        return int(s[:8], 16) & 0xFFFFFFFF or 1
    except ValueError:
        h = 2166136261
        for ch in s:
            h ^= ord(ch)
            h = (h * 16777619) & 0xFFFFFFFF
        return h or 1


def validate_preset(preset_id: str | None) -> Dict[str, Any]:
    p = (preset_id or "normal").strip().lower()
    if p not in SPEED_PRESETS:
        raise ValueError("Invalid speed preset.")
    return SPEED_PRESETS[p]


def normalize_inputs(inputs: Sequence[Any]) -> List[Tuple[int, str]]:
    if inputs is None:
        raise ValueError("inputs required")
    if not isinstance(inputs, (list, tuple)):
        raise ValueError("inputs must be a list")
    if len(inputs) > MAX_INPUTS:
        raise ValueError("too many inputs")
    out: List[Tuple[int, str]] = []
    for raw in inputs:
        if isinstance(raw, dict):
            try:
                f = int(raw.get("f", raw.get("frame")))
            except (TypeError, ValueError):
                raise ValueError("invalid input") from None
            a = str(raw.get("a") or raw.get("action") or "").strip().upper()
        elif isinstance(raw, (list, tuple)) and len(raw) == 2:
            try:
                f = int(raw[0])
            except (TypeError, ValueError):
                raise ValueError("invalid input") from None
            a = str(raw[1]).strip().upper()
        else:
            raise ValueError("invalid input")
        if a in ("LEFT", "L"):
            a = "L"
        elif a in ("RIGHT", "R"):
            a = "R"
        elif a in ("JUMP", "J", "UP", "U"):
            a = "J"
        elif a in ("SLIDE", "S", "DOWN", "D"):
            a = "S"
        else:
            raise ValueError("invalid action")
        if f < 0 or f > MAX_FRAMES:
            raise ValueError("invalid frame")
        out.append((f, a))
    out.sort(key=lambda x: x[0])
    return out


def road_t(y: float) -> float:
    return max(0.0, min(1.0, (y - HORIZON_Y) / (H - HORIZON_Y)))


def road_width_at_y(y: float) -> float:
    t = road_t(y)
    return ROAD_TOP_W + (ROAD_BOTTOM_W - ROAD_TOP_W) * (t * t * 0.7 + t * 0.3)


def lane_screen_x(lane: float, y: float) -> float:
    w = road_width_at_y(y)
    return W / 2 - w / 2 + ((lane + 0.5) / LANE_COUNT) * w


def persp_scale(y: float) -> float:
    t = max(0.0, min(1.0, (y - HORIZON_Y) / (H - HORIZON_Y - 48)))
    return 0.2 + 0.88 * (t * t * 0.6 + t * 0.4)


def _apply_action(player: dict, action: str) -> None:
    if action == "L":
        if player["targetLane"] > 0:
            player["targetLane"] -= 1
            player["laneT"] = 0.0
    elif action == "R":
        if player["targetLane"] < 2:
            player["targetLane"] += 1
            player["laneT"] = 0.0
    elif action == "J":
        if not player["jumping"] and not player["sliding"]:
            player["vy"] = -13.0
            player["jumping"] = True
    elif action == "S":
        if not player["jumping"]:
            player["sliding"] = True
            player["slideTimer"] = 42


def _lanes_blocked(obstacles: list, spawn_y: float) -> set:
    blocked = set()
    for o in obstacles:
        if abs(o["y"] - spawn_y) < 110 and not o["dead"]:
            blocked.add(o["lane"])
    return blocked


def _spawn_obstacle(state: dict, rng) -> None:
    preset = state["preset"]
    alive = sum(1 for o in state["obstacles"] if not o["dead"])
    if alive >= int(preset["maxObstacles"]):
        return
    ahead = float(preset["spawnAhead"])
    spawn_y = HORIZON_Y - ahead
    blocked = _lanes_blocked(state["obstacles"], spawn_y)
    free = [l for l in (0, 1, 2) if l not in blocked]
    if not free:
        return
    roll = rng()
    grace = float(preset["graceFrames"])
    if roll < 0.1 and len(free) >= 2 and state["frame"] > grace * 2:
        l1 = free[int(rng() * len(free)) % len(free)]
        rest = [l for l in free if l != l1]
        l2 = rest[int(rng() * len(rest)) % len(rest)]
        state["obstacles"].append({"lane": l1, "y": spawn_y, "w": 48.0, "h": 50.0, "type": "barrier", "dead": False})
        state["obstacles"].append({"lane": l2, "y": spawn_y, "w": 52.0, "h": 40.0, "type": "lowbar", "dead": False})
        return
    lane = free[int(rng() * len(free)) % len(free)]
    t = rng()
    cop_rate = 0.12 if state["frame"] < grace * 2.5 else 0.22
    if t < cop_rate:
        state["obstacles"].append({"lane": lane, "y": spawn_y, "w": 48.0, "h": 50.0, "type": "cop", "dead": False})
    elif t < 0.55:
        state["obstacles"].append({"lane": lane, "y": spawn_y, "w": 52.0, "h": 40.0, "type": "barrier", "dead": False})
    else:
        state["obstacles"].append({"lane": lane, "y": spawn_y, "w": 64.0, "h": 28.0, "type": "lowbar", "dead": False})


def _spawn_coins(state: dict, rng) -> None:
    lane = int(rng() * 3) % 3
    count = 4 + int(rng() * 3)
    base_y = HORIZON_Y - 45
    for i in range(count):
        state["coin_items"].append({
            "lane": lane,
            "y": base_y - i * 42,
            "r": 11.0,
            "collected": False,
            "spin": rng() * math.pi * 2,
        })


def _update_world(state: dict) -> None:
    preset = state["preset"]
    world_scroll = state["speed"] * float(preset["worldMult"])
    for o in state["obstacles"]:
        sc = persp_scale(o["y"])
        scroll_mult = float(preset["copScrollMult"] if o["type"] == "cop" else preset["obstacleScrollMult"])
        o["y"] += world_scroll * scroll_mult * (0.62 + sc * 0.1)
    for c in state["coin_items"]:
        if c["collected"]:
            continue
        sc = persp_scale(c["y"])
        c["y"] += world_scroll * (0.8 + sc * 0.1)


def _update_player(player: dict) -> None:
    if player["targetLane"] != player["lane"]:
        player["laneT"] += 0.2
        if player["laneT"] >= 1:
            player["lane"] = player["targetLane"]
            player["laneT"] = 1.0
    else:
        player["laneT"] = 1.0
    t = 1.0 if player["lane"] == player["targetLane"] else min(1.0, player["laneT"])
    lerp_lane = player["lane"] + (player["targetLane"] - player["lane"]) * (1 - (1 - t) ** 2)
    target_x = lane_screen_x(lerp_lane, PLAYER_Y)
    player["x"] += (target_x - player["x"]) * 0.3

    if player["jumping"]:
        player["vy"] += 0.65
        if player["vy"] >= 0:
            player["jumping"] = False
            player["vy"] = 0.0
    if player["sliding"]:
        player["slideTimer"] -= 1
        if player["slideTimer"] <= 0:
            player["sliding"] = False
    if player["invincible"] > 0:
        player["invincible"] -= 1


def _check_collisions(state: dict) -> None:
    p = state["player"]
    if p["invincible"] > 0:
        return
    px = p["x"]
    jump_h = max(0.0, -p["vy"] * 5.5) if p["jumping"] else 0.0
    actual_y = PLAYER_Y - jump_h
    ph = p["h"] * 0.52 if p["sliding"] else p["h"]
    p_top = actual_y - ph + (p["h"] * 0.48 if p["sliding"] else 0.0)

    for o in state["obstacles"]:
        if o["dead"]:
            continue
        scale = persp_scale(o["y"])
        ox = lane_screen_x(o["lane"], o["y"])
        ow = o["w"] * scale * 0.88
        oh = o["h"] * scale * 0.88
        o_top = o["y"] - oh
        if abs(px - ox) < 16 + ow / 2 and p_top < o["y"] - 4 and actual_y > o_top:
            if o["type"] == "lowbar" and p["sliding"]:
                continue
            if o["type"] == "barrier" and p["jumping"]:
                continue
            o["dead"] = True
            state["lives"] -= 1
            p["invincible"] = 85
            return

    for c in state["coin_items"]:
        if c["collected"]:
            continue
        cx = lane_screen_x(c["lane"], c["y"])
        magnet = abs(px - cx) < 52 and abs(actual_y - c["y"]) < 55
        if magnet or (abs(px - cx) < 22 and abs(actual_y - c["y"]) < 28):
            c["collected"] = True
            state["coins"] += 1
            state["score"] += 45.0


def simulate_getaway(
    *,
    seed: str,
    inputs: Sequence[Any],
    preset_id: str = "normal",
    ticks: Optional[int] = None,
) -> Dict[str, Any]:
    preset = validate_preset(preset_id)
    inp = normalize_inputs(inputs)
    rng = mulberry32(seed_to_u32(seed))
    by_frame: Dict[int, List[str]] = {}
    for f, a in inp:
        by_frame.setdefault(f, []).append(a)

    try:
        ticks_i = int(ticks) if ticks is not None else MAX_FRAMES
    except (TypeError, ValueError):
        ticks_i = MAX_FRAMES
    limit = max(1, min(MAX_FRAMES, ticks_i))

    player = {
        "lane": 1,
        "targetLane": 1,
        "laneT": 1.0,
        "x": lane_screen_x(1, PLAYER_Y),
        "w": 34.0,
        "h": 52.0,
        "vy": 0.0,
        "jumping": False,
        "sliding": False,
        "slideTimer": 0,
        "invincible": 120,
    }
    state = {
        "preset": preset,
        "frame": 0,
        "score": 0.0,
        "coins": 0,
        "lives": 3,
        "speed": float(preset["base"]),
        "spawnCooldown": int(preset["graceFrames"]),
        "player": player,
        "obstacles": [],
        "coin_items": [],
    }
    dead = False

    while state["frame"] < limit and not dead:
        f = state["frame"]
        for a in by_frame.get(f, []):
            _apply_action(player, a)

        state["frame"] += 1
        ramp_frames = max(600, int(preset["rampFrames"]))
        t = min(1.0, state["frame"] / ramp_frames)
        state["speed"] = float(preset["base"]) + (float(preset["max"]) - float(preset["base"])) * t
        if state["speed"] > float(preset["max"]):
            state["speed"] = float(preset["max"])

        road_scroll = state["speed"] * float(preset["scrollMult"])
        state["score"] += road_scroll * 0.11

        state["spawnCooldown"] -= 1
        spawn_every = max(58, int(preset["spawnBase"]) - int(state["score"] / 350))
        if state["spawnCooldown"] <= 0:
            _spawn_obstacle(state, rng)
            state["spawnCooldown"] = spawn_every
        if state["frame"] % 110 == 55:
            _spawn_coins(state, rng)

        _update_world(state)
        _update_player(player)
        _check_collisions(state)

        state["obstacles"] = [o for o in state["obstacles"] if o["y"] < H + 80 and not o["dead"]]
        state["coin_items"] = [c for c in state["coin_items"] if c["y"] < H + 40]

        if state["lives"] <= 0:
            dead = True
            break

    distance = max(0, min(MAX_DISTANCE_SANITY, int(state["score"])))
    return {
        "distance": distance,
        "coins": int(state["coins"]),
        "frames": state["frame"],
        "dead": dead,
        "lives": state["lives"],
        "preset": preset["id"],
    }
