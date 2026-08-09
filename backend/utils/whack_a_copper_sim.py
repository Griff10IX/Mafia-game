"""Deterministic Whack-A-Copper re-simulation from seed + hit log.

Mirrors src/pages/MiniGames/whackACopperEngine.js so claim scores are server-authoritative.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

FIXED_DT = 1000.0 / 60.0
COUNTDOWN_MS = 3000.0
HIT_GRACE_MS = 80.0
MAX_HITS = 2_000
MAX_SCORE_SANITY = 50_000

ALLOWED_DIFF = {"easy", "medium", "hard"}
ALLOWED_DURATION = {20, 30, 60}
ALLOWED_GRID = {6, 9, 12}
ALLOWED_LIVES = {0, 3, 5}

DIFF_PRESETS = {
    "easy": {
        "stayMs": 2100,
        "stayMinMs": 1300,
        "stayDecayPerTier": 35,
        "waveMs": 1450,
        "waveMinMs": 950,
        "waveDecayPerTier": 25,
        "maxUp": 2,
        "warningPct": 0.32,
    },
    "medium": {
        "stayMs": 1650,
        "stayMinMs": 950,
        "stayDecayPerTier": 45,
        "waveMs": 1150,
        "waveMinMs": 720,
        "waveDecayPerTier": 35,
        "maxUp": 3,
        "warningPct": 0.28,
    },
    "hard": {
        "stayMs": 1150,
        "stayMinMs": 650,
        "stayDecayPerTier": 55,
        "waveMs": 780,
        "waveMinMs": 480,
        "waveDecayPerTier": 45,
        "maxUp": 4,
        "warningPct": 0.24,
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


def validate_settings(
    *,
    diff: str | None,
    duration: Any,
    grid_size: Any,
    lives_mode: Any,
) -> Dict[str, Any]:
    d = (diff or "medium").strip().lower()
    if d not in ALLOWED_DIFF:
        raise ValueError("Invalid difficulty.")
    try:
        dur = int(duration)
        grid = int(grid_size)
        lives = int(lives_mode)
    except (TypeError, ValueError):
        raise ValueError("Invalid settings.") from None
    if dur not in ALLOWED_DURATION:
        raise ValueError("Invalid duration.")
    if grid not in ALLOWED_GRID:
        raise ValueError("Invalid grid size.")
    if lives not in ALLOWED_LIVES:
        raise ValueError("Invalid lives mode.")
    return {"diff": d, "duration": dur, "gridSize": grid, "livesMode": lives}


def normalize_hits(hits: Sequence[Any], *, grid_size: int) -> List[Tuple[int, int]]:
    if hits is None:
        raise ValueError("hits required")
    if not isinstance(hits, (list, tuple)):
        raise ValueError("hits must be a list")
    if len(hits) > MAX_HITS:
        raise ValueError("too many hits")
    out: List[Tuple[int, int]] = []
    prev_t = -1
    for raw in hits:
        if not isinstance(raw, dict):
            raise ValueError("invalid hit")
        try:
            t_ms = int(raw.get("t_ms"))
            hole = int(raw.get("hole"))
        except (TypeError, ValueError):
            raise ValueError("invalid hit") from None
        if t_ms < 0:
            raise ValueError("hit time must be non-negative")
        if t_ms < prev_t:
            raise ValueError("hits must be non-decreasing in time")
        if hole < 0 or hole >= grid_size:
            raise ValueError("hit hole out of range")
        out.append((t_ms, hole))
        prev_t = t_ms
    return out


def _tier(score: int) -> int:
    return score // 100


def _stay_ms(diff: dict, score: int) -> float:
    t = _tier(score)
    return float(max(diff["stayMinMs"], diff["stayMs"] - t * diff["stayDecayPerTier"]))


def _wave_ms(diff: dict, score: int) -> float:
    t = _tier(score)
    return float(max(diff["waveMinMs"], diff["waveMs"] - t * diff["waveDecayPerTier"]))


def _max_concurrent(diff: dict, score: int) -> int:
    t = _tier(score)
    return min(int(diff["maxUp"]), 1 + min(2, t // 2))


def _empty_hole() -> Dict[str, Any]:
    return {
        "up": False,
        "bonked": False,
        "upUntil": 0.0,
        "warningAt": 0.0,
        "bonkedUntil": 0.0,
    }


def _can_whack(holes_up: List[bool], holes: List[dict], index: int, clock_ms: float, phase: str) -> bool:
    if phase != "playing":
        return False
    if index < 0 or index >= len(holes):
        return False
    h = holes[index]
    if h["bonked"] or not holes_up[index]:
        return False
    return bool(h["upUntil"]) and clock_ms <= h["upUntil"] + HIT_GRACE_MS


def _fisher_yates(arr: List[int], rng) -> None:
    for i in range(len(arr) - 1, 0, -1):
        j = int(rng() * (i + 1))
        if j > i:
            j = i
        arr[i], arr[j] = arr[j], arr[i]


def simulate_whack_a_copper(
    *,
    seed: str,
    hits: Sequence[Any],
    diff: str = "medium",
    duration: int = 30,
    grid_size: int = 9,
    lives_mode: int = 3,
) -> Dict[str, Any]:
    settings = validate_settings(diff=diff, duration=duration, grid_size=grid_size, lives_mode=lives_mode)
    d = DIFF_PRESETS[settings["diff"]]
    grid = int(settings["gridSize"])
    hit_list = normalize_hits(hits, grid_size=grid)
    rng = mulberry32(seed_to_u32(seed))

    duration_ms = float(settings["duration"] * 1000)
    lives = int(settings["livesMode"]) if settings["livesMode"] > 0 else 999
    lives_on = int(settings["livesMode"]) > 0

    phase = "countdown"
    countdown_ms = COUNTDOWN_MS
    clock_ms = 0.0
    playing_ms = 0.0
    time_left_ms = duration_ms
    wave_cooldown_ms = 600.0
    score = 0
    combo = 1
    max_combo = 1
    miss_count = 0
    holes = [_empty_hole() for _ in range(grid)]
    holes_up = [False] * grid
    hit_i = 0
    ticks = 0
    ended = False

    max_ticks = int((COUNTDOWN_MS + duration_ms) / FIXED_DT) + 120

    def pop_hole(index: int) -> None:
        if holes_up[index]:
            return
        stay = _stay_ms(d, score)
        holes_up[index] = True
        h = holes[index]
        h["up"] = True
        h["bonked"] = False
        h["upUntil"] = clock_ms + stay
        h["warningAt"] = clock_ms + stay * (1.0 - float(d["warningPct"]))
        h["bonkedUntil"] = 0.0

    def duck_miss(index: int) -> None:
        nonlocal miss_count, combo, lives, ended, phase
        if not holes_up[index]:
            return
        holes_up[index] = False
        h = holes[index]
        h["up"] = False
        h["upUntil"] = 0.0
        miss_count += 1
        combo = 1
        if lives_on:
            lives = max(0, lives - 1)
            if lives <= 0:
                ended = True
                phase = "over"

    def schedule_wave() -> None:
        nonlocal wave_cooldown_ms
        up_count = sum(1 for x in holes_up if x)
        slots = _max_concurrent(d, score) - up_count
        if slots <= 0:
            return
        avail = [i for i in range(grid) if not holes_up[i]]
        if not avail:
            return
        _fisher_yates(avail, rng)
        extra = 1 if _tier(score) > 2 else 0
        count = min(slots, len(avail), max(1, int(rng() * 2) + extra))
        for n in range(count):
            pop_hole(avail[n])
        wave_cooldown_ms = _wave_ms(d, score)

    def try_whack(index: int) -> None:
        nonlocal score, combo, max_combo
        if not _can_whack(holes_up, holes, index, clock_ms, phase):
            return
        holes_up[index] = False
        h = holes[index]
        h["up"] = False
        h["upUntil"] = 0.0
        h["warningAt"] = 0.0
        h["bonked"] = True
        h["bonkedUntil"] = clock_ms + 420.0
        pts = 10 * combo
        score += pts
        next_combo = min(combo + 1, 12)
        max_combo = max(max_combo, next_combo)
        combo = next_combo

    for _ in range(max_ticks):
        if ended or phase == "over":
            break
        ticks += 1
        clock_ms += FIXED_DT

        if phase == "countdown":
            countdown_ms -= FIXED_DT
            if countdown_ms <= 0:
                phase = "playing"
                wave_cooldown_ms = 400.0
            continue

        if phase != "playing":
            break

        playing_ms += FIXED_DT
        # Hits recorded on client between ticks at current playingMs.
        while hit_i < len(hit_list) and hit_list[hit_i][0] <= int(playing_ms):
            try_whack(hit_list[hit_i][1])
            hit_i += 1

        time_left_ms -= FIXED_DT
        if time_left_ms <= 0:
            ended = True
            phase = "over"
            break

        wave_cooldown_ms -= FIXED_DT
        if wave_cooldown_ms <= 0:
            schedule_wave()

        for i in range(grid):
            h = holes[i]
            if h["up"] and h["upUntil"] and clock_ms >= h["upUntil"]:
                duck_miss(i)
            if h["bonkedUntil"] and clock_ms >= h["bonkedUntil"]:
                h["bonked"] = False

        if ended:
            break

    while hit_i < len(hit_list) and hit_list[hit_i][0] <= int(playing_ms):
        try_whack(hit_list[hit_i][1])
        hit_i += 1

    score = max(0, min(MAX_SCORE_SANITY, int(score)))
    return {
        "score": score,
        "ticks": ticks,
        "ended": bool(ended or phase == "over"),
        "playing_ms": int(playing_ms),
        "max_combo": int(max_combo),
        "miss_count": int(miss_count),
    }
