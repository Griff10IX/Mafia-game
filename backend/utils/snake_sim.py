"""Deterministic Package Run (Snake) re-simulation from seed + per-tick directions.

Mirrors src/pages/MiniGames/Snake.js tick rules so claim scores are server-authoritative.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

GRID = 20
MAX_DIRS = 12_000
MAX_SCORE_SANITY = 50_000

DIR_MAP = {
    "RIGHT": (1, 0),
    "LEFT": (-1, 0),
    "UP": (0, -1),
    "DOWN": (0, 1),
    "R": (1, 0),
    "L": (-1, 0),
    "U": (0, -1),
    "D": (0, 1),
}

ALLOWED_LEVELS = {"classic", "wrap"}
ALLOWED_DIFFICULTIES = {
    "easy": {
        "baseSpeed": 140,
        "minSpeed": 70,
        "speedStep": 2,
        "copThreshold": 150,
        "maxCops": 4,
        "copSpawnInterval": 200,
    },
    "medium": {
        "baseSpeed": 100,
        "minSpeed": 50,
        "speedStep": 4,
        "copThreshold": 100,
        "maxCops": 6,
        "copSpawnInterval": 150,
    },
    "hard": {
        "baseSpeed": 80,
        "minSpeed": 42,
        "speedStep": 5,
        "copThreshold": 60,
        "maxCops": 8,
        "copSpawnInterval": 100,
    },
}

# Probabilities must match Snake.js PACKAGES order.
PACKAGES = [
    {"type": "whiskey", "points": 10, "prob": 0.18},
    {"type": "gin", "points": 10, "prob": 0.14},
    {"type": "beer", "points": 8, "prob": 0.12},
    {"type": "wine", "points": 12, "prob": 0.10},
    {"type": "cash", "points": 25, "prob": 0.20},
    {"type": "respect", "points": 40, "prob": 0.12},
    {"type": "rank_pts", "points": 35, "prob": 0.10},
    {"type": "bullets", "points": 30, "prob": 0.08},
    {"type": "jail", "points": -30, "prob": 0.06},
]


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


def validate_snake_settings(*, level: str | None, difficulty: str | None) -> Dict[str, Any]:
    lv = (level or "classic").strip().lower()
    df = (difficulty or "medium").strip().lower()
    if lv not in ALLOWED_LEVELS:
        raise ValueError("Invalid level.")
    if df not in ALLOWED_DIFFICULTIES:
        raise ValueError("Invalid difficulty.")
    return {"level": lv, "difficulty": df, "diff": ALLOWED_DIFFICULTIES[df], "wrapWalls": lv == "wrap"}


def normalize_dirs(dirs: Sequence[Any]) -> List[Tuple[int, int]]:
    if dirs is None:
        raise ValueError("dirs required")
    if not isinstance(dirs, (list, tuple)):
        raise ValueError("dirs must be a list")
    if len(dirs) > MAX_DIRS:
        raise ValueError("too many dirs")
    out: List[Tuple[int, int]] = []
    for raw in dirs:
        if isinstance(raw, str):
            key = raw.strip().upper()
            if key not in DIR_MAP:
                raise ValueError("invalid dir")
            out.append(DIR_MAP[key])
            continue
        if isinstance(raw, (list, tuple)) and len(raw) == 2:
            try:
                dx, dy = int(raw[0]), int(raw[1])
            except (TypeError, ValueError):
                raise ValueError("invalid dir") from None
            if (dx, dy) not in DIR_MAP.values():
                raise ValueError("invalid dir")
            out.append((dx, dy))
            continue
        raise ValueError("invalid dir")
    return out


def _pick_package(rng) -> dict:
    r = rng()
    for p in PACKAGES:
        r -= float(p["prob"])
        if r <= 0:
            return p
    return PACKAGES[0]


def _rand_cell(rng, exclude: Sequence[Tuple[int, int]]) -> Tuple[int, int]:
    flat = {f"{x},{y}" for x, y in exclude}
    x = y = 0
    for _ in range(200):
        x = int(rng() * GRID)
        y = int(rng() * GRID)
        if x >= GRID:
            x = GRID - 1
        if y >= GRID:
            y = GRID - 1
        if f"{x},{y}" not in flat:
            return (x, y)
    return (x, y)


def simulate_snake(
    *,
    seed: str,
    dirs: Sequence[Any],
    level: str = "classic",
    difficulty: str = "medium",
) -> Dict[str, Any]:
    settings = validate_snake_settings(level=level, difficulty=difficulty)
    diff = settings["diff"]
    wrap = bool(settings["wrapWalls"])
    dir_list = normalize_dirs(dirs)
    rng = mulberry32(seed_to_u32(seed))

    mid = GRID // 2
    snake: List[Tuple[int, int]] = [(mid, mid), (mid - 1, mid), (mid - 2, mid)]
    direction = (1, 0)
    occupied0 = list(snake)
    pkg_pos = _rand_cell(rng, occupied0)
    pkg = _pick_package(rng)
    cops: List[Tuple[int, int]] = []
    score = 0
    cop_timer = 0
    ticks = 0
    dead = False
    death_reason = None

    for i, want_dir in enumerate(dir_list):
        ticks = i + 1
        # Reject 180° reverse (same as client queue check)
        if want_dir[0] != -direction[0] or want_dir[1] != -direction[1]:
            direction = want_dir

        head = snake[0]
        nx, ny = head[0] + direction[0], head[1] + direction[1]
        if wrap:
            nx = (nx + GRID) % GRID
            ny = (ny + GRID) % GRID
        else:
            if nx < 0 or nx >= GRID or ny < 0 or ny >= GRID:
                dead = True
                death_reason = "wall"
                break

        body_check = snake[:-1]
        if any(x == nx and y == ny for x, y in body_check):
            dead = True
            death_reason = "self"
            break

        if any(x == nx and y == ny for x, y in cops):
            dead = True
            death_reason = "cop"
            break

        ate = pkg_pos[0] == nx and pkg_pos[1] == ny
        new_snake = [(nx, ny)] + snake
        if not ate:
            new_snake.pop()

        if ate:
            pts = int(pkg["points"])
            is_jail = pkg["type"] == "jail"
            if is_jail:
                score = max(0, score + pts)
                # Match JS: while (length > 3) { pop; pop; pop; break; }
                if len(new_snake) > 3:
                    new_snake.pop()
                    if new_snake:
                        new_snake.pop()
                    if new_snake:
                        new_snake.pop()
                occupied = list(new_snake) + list(cops)
                pkg_pos = _rand_cell(rng, occupied)
                pkg = _pick_package(rng)
                snake = new_snake
                continue

            score = score + pts
            occupied = list(new_snake) + list(cops)
            pkg_pos = _rand_cell(rng, occupied)
            pkg = _pick_package(rng)

            cop_timer += pts
            if (
                cop_timer >= int(diff["copSpawnInterval"])
                and len(cops) < int(diff["maxCops"])
                and score >= int(diff["copThreshold"])
            ):
                cop_timer = 0
                cops.append(_rand_cell(rng, list(new_snake) + list(cops)))

        snake = new_snake

    score = max(0, min(MAX_SCORE_SANITY, int(score)))
    return {
        "score": score,
        "ticks": ticks,
        "dead": dead,
        "death_reason": death_reason,
        "dirs_used": len(dir_list),
    }
