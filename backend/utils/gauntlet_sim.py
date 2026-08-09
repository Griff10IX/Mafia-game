"""Deterministic Flappy Gangster (Gauntlet) re-simulation from seed + flap ticks.

Mirrors src/pages/MiniGames/Gauntlet.js physics so claim scores are server-authoritative.
"""
from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple

GRAVITY = 0.25
JUMP_FORCE = -5.8
TERMINAL_VEL = 6.0
PIPE_SPEED_BASE = 3.0
PIPE_GAP_BASE = 175
PIPE_WIDTH = 62
BIRD_SIZE = 36
VIEW_W = 420
VIEW_H = 580

MAX_FLAPS = 8_000
MAX_TICKS = 60 * 60 * 25  # 25 minutes at 60 FPS

SPEED_OPTIONS = {
    "crawl": 0.5,
    "slow": 0.72,
    "normal": 1.0,
    "mult115": 1.15,
    "mult125": 1.25,
    "fast": 1.45,
}

DIFFICULTY_OPTIONS = {
    "easy": {"gapOffset": 25, "speedMult": 0.85},
    "normal": {"gapOffset": 0, "speedMult": 1.0},
    "hard": {"gapOffset": -30, "speedMult": 1.25},
    "insane": {"gapOffset": -50, "speedMult": 1.38},
}


def mulberry32(seed: int):
    """Return a PRNG matching the JS mulberry32 used by the client."""
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
    # Prefer hex token from secrets.token_hex; fall back to hash of string.
    try:
        return int(s[:8], 16) & 0xFFFFFFFF or 1
    except ValueError:
        h = 2166136261
        for ch in s:
            h ^= ord(ch)
            h = (h * 16777619) & 0xFFFFFFFF
        return h or 1


def resolve_run_params(speed: str | None, difficulty: str | None) -> Tuple[float, float, int]:
    speed_mult = SPEED_OPTIONS.get((speed or "normal").strip().lower(), SPEED_OPTIONS["normal"])
    diff = DIFFICULTY_OPTIONS.get((difficulty or "normal").strip().lower(), DIFFICULTY_OPTIONS["normal"])
    pipe_speed = PIPE_SPEED_BASE * speed_mult * float(diff["speedMult"])
    pipe_gap = PIPE_GAP_BASE + int(diff["gapOffset"])
    spawn_interval = max(40, round(95 / speed_mult))
    return pipe_speed, float(pipe_gap), int(spawn_interval)


def normalize_flaps(flaps: Sequence[Any]) -> List[int]:
    if flaps is None:
        raise ValueError("flaps required")
    if not isinstance(flaps, (list, tuple)):
        raise ValueError("flaps must be a list")
    if len(flaps) > MAX_FLAPS:
        raise ValueError("too many flaps")
    out: List[int] = []
    prev = -1
    for raw in flaps:
        try:
            t = int(raw)
        except (TypeError, ValueError):
            raise ValueError("invalid flap tick") from None
        if t < 0:
            raise ValueError("flap tick must be non-negative")
        if t <= prev:
            raise ValueError("flaps must be strictly increasing")
        out.append(t)
        prev = t
    return out


def simulate_gauntlet(
    *,
    seed: str,
    flaps: Sequence[Any],
    speed: str | None = "normal",
    difficulty: str | None = "normal",
    max_ticks: int = MAX_TICKS,
) -> Dict[str, Any]:
    """Re-play a run. Initial start flap is applied before tick 1 (JUMP_FORCE).

    Mid-run flaps are tick indices: at the start of that tick, vel is set to JUMP_FORCE
    (before gravity), matching client immediate birdVelRef updates recorded as tick+1.
    """
    flap_ticks = normalize_flaps(flaps)
    flap_set = set(flap_ticks)
    pipe_speed, pipe_gap, spawn_interval = resolve_run_params(speed, difficulty)
    rng = mulberry32(seed_to_u32(seed))

    bird_y = VIEW_H / 2.0
    bird_vel = JUMP_FORCE  # start jump before first physics tick
    pipes: List[Dict[str, Any]] = [
        {"x": float(VIEW_W + 80), "topHeight": 100.0 + rng() * 200.0, "scored": False}
    ]
    score = 0
    died = False
    last_tick = 0

    for tick in range(1, max(1, int(max_ticks)) + 1):
        last_tick = tick
        if tick in flap_set:
            bird_vel = JUMP_FORCE

        bird_vel = min(TERMINAL_VEL, bird_vel + GRAVITY)
        new_y = bird_y + bird_vel

        new_pipes: List[Dict[str, Any]] = []
        for p in pipes:
            new_pipes.append({"x": p["x"] - pipe_speed, "topHeight": p["topHeight"], "scored": p["scored"]})

        if tick % spawn_interval == 0:
            new_pipes.append(
                {
                    "x": float(VIEW_W + 20),
                    "topHeight": 80.0 + rng() * 240.0,
                    "scored": False,
                }
            )
        new_pipes = [p for p in new_pipes if p["x"] > -PIPE_WIDTH - 20]

        for p in new_pipes:
            if (not p["scored"]) and (p["x"] + PIPE_WIDTH < 80):
                score += 1
                p["scored"] = True

        bird_x = 70.0
        bird_r = BIRD_SIZE / 2.0 - 4.0
        hit = new_y < 0 or new_y > VIEW_H - BIRD_SIZE
        if not hit:
            for p in new_pipes:
                in_x = bird_x + bird_r > p["x"] + 4 and bird_x - bird_r < p["x"] + PIPE_WIDTH - 4
                in_top = new_y - bird_r < p["topHeight"] - 4
                in_bot = new_y + bird_r > p["topHeight"] + pipe_gap + 4
                if in_x and (in_top or in_bot):
                    hit = True
                    break

        bird_y = new_y
        pipes = new_pipes

        if hit:
            died = True
            break

    return {
        "score": int(score),
        "ticks": int(last_tick),
        "died": bool(died),
        "pipe_speed": pipe_speed,
        "pipe_gap": pipe_gap,
        "spawn_interval": spawn_interval,
    }
