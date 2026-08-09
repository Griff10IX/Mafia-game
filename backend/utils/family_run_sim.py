"""Deterministic Family Run re-sim from seed + per-frame inputs.

Mirrors src/pages/MiniGames/FamilyRun.js tick/spawn/collision (fixed 60Hz).
"""
from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple

MAX_FRAMES = 7_200  # 120s @ 60fps
MAX_INPUTS = 3_000
MAX_SCORE_SANITY = 100_000

P_STAND_H = 110.0
BARRIER_FRAC = 0.40
OVERHEAD_FRAC = 0.58


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


def _ri(rng, a: int, b: int) -> int:
    return a + int(rng() * (b - a + 1))


def _spawn(obstacles: list, coin_items: list, rng) -> None:
    z0 = 0.02
    r = rng()
    if r < 0.22:
        obstacles.append({"type": "barrier", "lane": _ri(rng, 0, 2), "z": z0, "hit": False})
    elif r < 0.42:
        obstacles.append({"type": "overhead", "lane": _ri(rng, 0, 2), "z": z0, "hit": False})
    elif r < 0.58:
        free = _ri(rng, 0, 2)
        for lane in range(3):
            if lane != free:
                obstacles.append({"type": "barrier", "lane": lane, "z": z0, "hit": False})
    elif r < 0.72:
        free = _ri(rng, 0, 2)
        for lane in range(3):
            if lane != free:
                obstacles.append({"type": "overhead", "lane": lane, "z": z0, "hit": False})
    elif r < 0.84:
        l1 = _ri(rng, 0, 2)
        l2 = (l1 + 1 + _ri(rng, 0, 1)) % 3
        obstacles.append({"type": "barrier", "lane": l1, "z": z0, "hit": False})
        obstacles.append({"type": "barrier", "lane": l2, "z": z0 - 0.12, "hit": False})
    else:
        lane = _ri(rng, 0, 2)
        for i in range(7):
            coin_items.append({"lane": lane, "z": z0 - i * 0.055, "collected": False})


def _apply_action(player: dict, action: str) -> None:
    if action == "L":
        if player["lane"] > 0:
            player["lane"] -= 1
    elif action == "R":
        if player["lane"] < 2:
            player["lane"] += 1
    elif action == "J":
        if not player["jumping"]:
            player["sliding"] = False
            player["slideTimer"] = 0
            player["jumping"] = True
            player["jumpH"] = 0.0
            player["jumpV"] = 16.0
    elif action == "S":
        if not player["jumping"]:
            player["sliding"] = True
            player["slideTimer"] = 22


def simulate_family_run(*, seed: str, inputs: Sequence[Any], ticks: int | None = None) -> Dict[str, Any]:
    inp = normalize_inputs(inputs)
    rng = mulberry32(seed_to_u32(seed))
    by_frame: Dict[int, List[str]] = {}
    for f, a in inp:
        by_frame.setdefault(f, []).append(a)

    frame = 0
    score = 0.0
    coins = 0
    lives = 3
    speed = 0.009
    spawn_timer = 0
    player = {
        "lane": 1,
        "laneF": 1.0,
        "jumpH": 0.0,
        "jumpV": 0.0,
        "jumping": False,
        "sliding": False,
        "slideTimer": 0,
        "invincible": 0,
    }
    obstacles: List[dict] = []
    coin_items: List[dict] = []
    dead = False

    try:
        ticks_i = int(ticks) if ticks is not None else MAX_FRAMES
    except (TypeError, ValueError):
        ticks_i = MAX_FRAMES
    limit = max(1, min(MAX_FRAMES, ticks_i))

    while frame < limit and not dead:
        for a in by_frame.get(frame, []):
            _apply_action(player, a)

        frame += 1
        score += speed * 400.0
        speed = min(0.022, 0.009 + int(score / 400) * 0.0012)

        if player["invincible"] > 0:
            player["invincible"] -= 1

        player["laneF"] += (player["lane"] - player["laneF"]) * 0.17

        if player["jumping"]:
            player["jumpH"] += player["jumpV"]
            player["jumpV"] -= 0.85
            if player["jumpH"] <= 0:
                player["jumpH"] = 0.0
                player["jumpV"] = 0.0
                player["jumping"] = False

        if player["sliding"]:
            player["slideTimer"] -= 1
            if player["slideTimer"] <= 0:
                player["sliding"] = False

        spawn_timer += 1
        gap = max(42, 92 - int(score / 300) * 5)
        if spawn_timer >= gap:
            spawn_timer = 0
            _spawn(obstacles, coin_items, rng)

        for o in obstacles:
            o["z"] += speed
        for c in coin_items:
            c["z"] += speed
        obstacles = [o for o in obstacles if o["z"] < 1.15]
        coin_items = [c for c in coin_items if c["z"] < 1.15]

        if player["invincible"] == 0:
            for o in obstacles:
                if o["hit"] or o["z"] < 0.88 or o["z"] > 1.06:
                    continue
                if abs(player["laneF"] - o["lane"]) > 0.62:
                    continue
                barrier_top_px = BARRIER_FRAC * P_STAND_H
                safe = False
                if o["type"] == "barrier":
                    safe = player["jumping"] and player["jumpH"] > barrier_top_px * 0.55
                else:
                    safe = bool(player["sliding"])
                if not safe:
                    o["hit"] = True
                    lives -= 1
                    player["invincible"] = 90
                    if lives <= 0:
                        dead = True
                        break

        if dead:
            break

        for c in coin_items:
            if c["collected"] or c["z"] < 0.88 or c["z"] > 1.06:
                continue
            if abs(player["laneF"] - c["lane"]) < 0.6:
                c["collected"] = True
                coins += 100

    out_score = max(0, min(MAX_SCORE_SANITY, int(score)))
    return {
        "score": out_score,
        "coins": int(coins),
        "frames": frame,
        "dead": dead,
        "lives": lives,
    }
