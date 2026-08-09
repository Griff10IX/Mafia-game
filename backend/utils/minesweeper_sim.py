"""Deterministic Minesweeper re-simulation from seed + click log.

Mirrors src/pages/MiniGames/Minesweeper.js board placement and flood reveal.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

MAX_CLICKS = 600

DIFFICULTIES = {
    "snitch": {"rows": 9, "cols": 9, "mines": 10},
    "capo": {"rows": 16, "cols": 16, "mines": 40},
    "godfather": {"rows": 16, "cols": 30, "mines": 99},
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


def validate_difficulty(difficulty: str | None) -> Dict[str, Any]:
    d = (difficulty or "").strip().lower()
    if d not in DIFFICULTIES:
        raise ValueError("Invalid difficulty.")
    cfg = DIFFICULTIES[d]
    return {"difficulty": d, "rows": cfg["rows"], "cols": cfg["cols"], "mines": cfg["mines"]}


def normalize_clicks(clicks: Sequence[Any], *, rows: int, cols: int) -> List[Tuple[int, int]]:
    if clicks is None:
        raise ValueError("clicks required")
    if not isinstance(clicks, (list, tuple)):
        raise ValueError("clicks must be a list")
    if len(clicks) > MAX_CLICKS:
        raise ValueError("too many clicks")
    out: List[Tuple[int, int]] = []
    for raw in clicks:
        if isinstance(raw, dict):
            try:
                r, c = int(raw.get("r")), int(raw.get("c"))
            except (TypeError, ValueError):
                raise ValueError("invalid click") from None
        elif isinstance(raw, (list, tuple)) and len(raw) == 2:
            try:
                r, c = int(raw[0]), int(raw[1])
            except (TypeError, ValueError):
                raise ValueError("invalid click") from None
        else:
            raise ValueError("invalid click")
        if r < 0 or c < 0 or r >= rows or c >= cols:
            raise ValueError("click out of range")
        out.append((r, c))
    return out


def place_mines(
    *,
    rows: int,
    cols: int,
    mine_count: int,
    safe_r: int,
    safe_c: int,
    rng,
) -> List[List[Dict[str, Any]]]:
    board = [
        [{"mine": False, "revealed": False, "flagged": False, "count": 0} for _ in range(cols)]
        for _ in range(rows)
    ]
    placed = 0
    # Rejection sampling — must match client loop (same RNG consumption).
    while placed < mine_count:
        r = int(rng() * rows)
        c = int(rng() * cols)
        if r >= rows:
            r = rows - 1
        if c >= cols:
            c = cols - 1
        if board[r][c]["mine"]:
            continue
        if abs(r - safe_r) <= 1 and abs(c - safe_c) <= 1:
            continue
        board[r][c]["mine"] = True
        placed += 1

    for r in range(rows):
        for c in range(cols):
            if board[r][c]["mine"]:
                continue
            count = 0
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols and board[nr][nc]["mine"]:
                        count += 1
            board[r][c]["count"] = count
    return board


def reveal_cells(board: List[List[Dict[str, Any]]], rows: int, cols: int, start_r: int, start_c: int) -> None:
    queue = [(start_r, start_c)]
    visited = set()
    while queue:
        r, c = queue.pop(0)
        key = (r, c)
        if key in visited:
            continue
        visited.add(key)
        if r < 0 or r >= rows or c < 0 or c >= cols:
            continue
        cell = board[r][c]
        if cell["revealed"] or cell["flagged"] or cell["mine"]:
            continue
        cell["revealed"] = True
        if cell["count"] == 0:
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr != 0 or dc != 0:
                        queue.append((r + dr, c + dc))


def check_win(board: List[List[Dict[str, Any]]]) -> bool:
    for row in board:
        for cell in row:
            if cell["mine"]:
                if cell["revealed"]:
                    return False
            elif not cell["revealed"]:
                return False
    return True


def simulate_minesweeper(
    *,
    seed: str,
    difficulty: str,
    clicks: Sequence[Any],
    first_r: Optional[int] = None,
    first_c: Optional[int] = None,
) -> Dict[str, Any]:
    settings = validate_difficulty(difficulty)
    rows, cols, mines = settings["rows"], settings["cols"], settings["mines"]
    click_list = normalize_clicks(clicks, rows=rows, cols=cols)
    if not click_list:
        return {
            "won": False,
            "dead": False,
            "clicks_used": 0,
            "reason": "no_clicks",
        }

    fr, fc = click_list[0]
    if first_r is not None and first_c is not None:
        if int(first_r) != fr or int(first_c) != fc:
            raise ValueError("First click does not match this run.")

    rng = mulberry32(seed_to_u32(seed))
    board = place_mines(
        rows=rows,
        cols=cols,
        mine_count=mines,
        safe_r=fr,
        safe_c=fc,
        rng=rng,
    )

    dead = False
    death_cell = None
    for r, c in click_list:
        cell = board[r][c]
        if cell["revealed"] or cell["flagged"]:
            continue
        if cell["mine"]:
            dead = True
            death_cell = {"r": r, "c": c}
            break
        reveal_cells(board, rows, cols, r, c)

    won = (not dead) and check_win(board)
    return {
        "won": won,
        "dead": dead,
        "death_cell": death_cell,
        "clicks_used": len(click_list),
        "difficulty": settings["difficulty"],
        "rows": rows,
        "cols": cols,
        "mines": mines,
    }
