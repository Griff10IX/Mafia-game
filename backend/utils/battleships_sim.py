"""Deterministic Rum Runner (Battleships) re-sim from seed + player fleet + action log.

Mirrors src/pages/MiniGames/Battleships.js placement / AI / turn rules (including abilities).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

GRID = 10
MAX_ACTIONS = 400
ALLOWED_DIFFICULTIES = {"easy", "normal", "hard"}

SHIP_CATALOGUE = {
    "carrier": {"id": "carrier", "name": "Aircraft Carrier", "size": 5},
    "battleship": {"id": "battleship", "name": "Battleship", "size": 4},
    "cruiser": {"id": "cruiser", "name": "Heavy Cruiser", "size": 4},
    "destroyer": {"id": "destroyer", "name": "Destroyer", "size": 3},
    "submarine": {"id": "submarine", "name": "Submarine", "size": 3},
    "frigate": {"id": "frigate", "name": "Frigate", "size": 3},
    "gunboat": {"id": "gunboat", "name": "Gunboat", "size": 2},
    "minelayer": {"id": "minelayer", "name": "Minelayer", "size": 2},
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


def validate_settings(*, difficulty: str | None, fleet_size: int | None) -> Dict[str, Any]:
    d = (difficulty or "normal").strip().lower()
    if d not in ALLOWED_DIFFICULTIES:
        raise ValueError("Invalid difficulty.")
    try:
        fs = int(fleet_size if fleet_size is not None else 5)
    except (TypeError, ValueError):
        raise ValueError("Invalid fleet size.") from None
    if fs < 2 or fs > 8:
        raise ValueError("Invalid fleet size.")
    return {"difficulty": d, "fleet_size": fs}


def empty_grid(size: int = GRID) -> List[List[Dict[str, Any]]]:
    return [[{"r": r, "c": c, "ship": None, "hit": False, "miss": False} for c in range(size)] for r in range(size)]


def can_place(grid, ship_size: int, r: int, c: int, horiz: bool, size: int = GRID) -> bool:
    for i in range(ship_size):
        nr = r if horiz else r + i
        nc = c + i if horiz else c
        if nr >= size or nc >= size or grid[nr][nc]["ship"]:
            return False
    return True


def place_ship(grid, ship_id: str, ship_size: int, r: int, c: int, horiz: bool):
    for i in range(ship_size):
        nr = r if horiz else r + i
        nc = c + i if horiz else c
        grid[nr][nc]["ship"] = ship_id


def auto_place_all(ships: Sequence[Dict[str, Any]], rng, size: int = GRID) -> List[List[Dict[str, Any]]]:
    grid = empty_grid(size)
    for ship in ships:
        placed = False
        tries = 0
        while not placed and tries < 500:
            tries += 1
            h = rng() < 0.5
            r = int(rng() * size)
            c = int(rng() * size)
            if r >= size:
                r = size - 1
            if c >= size:
                c = size - 1
            if can_place(grid, int(ship["size"]), r, c, h, size):
                place_ship(grid, ship["id"], int(ship["size"]), r, c, h)
                placed = True
        if not placed:
            raise ValueError("Could not place fleet.")
    return grid


def normalize_placements(raw: Sequence[Any], *, fleet_size: int) -> List[Dict[str, Any]]:
    if not isinstance(raw, (list, tuple)) or len(raw) != fleet_size:
        raise ValueError("Invalid fleet placements.")
    seen = set()
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Invalid placement.")
        sid = str(item.get("id") or "").strip().lower()
        if sid not in SHIP_CATALOGUE or sid in seen:
            raise ValueError("Invalid ship id.")
        seen.add(sid)
        try:
            r = int(item.get("r"))
            c = int(item.get("c"))
            horiz = bool(item.get("horiz"))
        except (TypeError, ValueError):
            raise ValueError("Invalid placement.") from None
        size = SHIP_CATALOGUE[sid]["size"]
        if r < 0 or c < 0 or r >= GRID or c >= GRID:
            raise ValueError("Placement out of range.")
        out.append({"id": sid, "name": SHIP_CATALOGUE[sid]["name"], "size": size, "r": r, "c": c, "horiz": horiz})
    return out


def build_grid_from_placements(placements: Sequence[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    grid = empty_grid()
    for p in placements:
        if not can_place(grid, int(p["size"]), int(p["r"]), int(p["c"]), bool(p["horiz"])):
            raise ValueError("Overlapping or invalid ship placement.")
        place_ship(grid, p["id"], int(p["size"]), int(p["r"]), int(p["c"]), bool(p["horiz"]))
    return grid


def is_ship_sunk(grid, ship_id: str) -> bool:
    for row in grid:
        for cell in row:
            if cell["ship"] == ship_id and not cell["hit"]:
                return False
    return True


def all_sunk(grid, ships: Sequence[Dict[str, Any]]) -> bool:
    return all(is_ship_sunk(grid, s["id"]) for s in ships)


def normalize_actions(actions: Sequence[Any]) -> List[Dict[str, Any]]:
    if actions is None:
        raise ValueError("actions required")
    if not isinstance(actions, (list, tuple)):
        raise ValueError("actions must be a list")
    if len(actions) > MAX_ACTIONS:
        raise ValueError("too many actions")
    out: List[Dict[str, Any]] = []
    for raw in actions:
        if not isinstance(raw, dict):
            raise ValueError("invalid action")
        t = str(raw.get("t") or raw.get("type") or "").strip().lower()
        if t in ("shot", "fire", "s"):
            t = "shot"
        elif t in ("recon", "airrecon", "air_recon"):
            t = "recon"
        elif t in ("sonar", "sonarping", "sonar_ping"):
            t = "sonar"
        elif t in ("salvo", "salvo_arm"):
            t = "salvo"
        else:
            raise ValueError("invalid action type")
        if t == "salvo":
            out.append({"t": "salvo"})
            continue
        try:
            r = int(raw.get("r"))
            c = int(raw.get("c"))
        except (TypeError, ValueError):
            raise ValueError("invalid action") from None
        if r < 0 or c < 0 or r >= GRID or c >= GRID:
            raise ValueError("action out of range")
        out.append({"t": t, "r": r, "c": c})
    return out


def ai_shot(ai_state: Dict[str, Any], player_grid, difficulty: str, rng, size: int = GRID) -> Dict[str, Any]:
    mode = ai_state.get("mode") or "hunt"
    targets = list(ai_state.get("targets") or [])
    direction = ai_state.get("direction")

    if difficulty == "easy":
        avail = []
        for i in range(size):
            for j in range(size):
                if not player_grid[i][j]["hit"] and not player_grid[i][j]["miss"]:
                    avail.append((i, j))
        if not avail:
            return {"r": 0, "c": 0, "newTargets": [], "newMode": "hunt", "direction": direction}
        pick = avail[int(rng() * len(avail)) % len(avail)]
        return {"r": pick[0], "c": pick[1], "newTargets": [], "newMode": "hunt", "direction": direction}

    if mode == "target" and targets:
        r, c = targets[0]
        return {
            "r": int(r),
            "c": int(c),
            "newTargets": targets[1:],
            "newMode": "target" if len(targets) > 1 else "hunt",
            "direction": direction,
        }

    avail = []
    if difficulty == "hard":
        unsunk_sizes = []
        for i in range(size):
            for j in range(size):
                s = player_grid[i][j]["ship"]
                if s and not player_grid[i][j]["hit"]:
                    ship_cat = SHIP_CATALOGUE.get(s)
                    if ship_cat and ship_cat["size"] not in unsunk_sizes:
                        unsunk_sizes.append(ship_cat["size"])
        min_size = min(unsunk_sizes) if unsunk_sizes else 2
        for i in range(size):
            for j in range(size):
                if not player_grid[i][j]["hit"] and not player_grid[i][j]["miss"] and (i + j) % min_size == 0:
                    avail.append((i, j))
    else:
        for i in range(size):
            for j in range(size):
                if not player_grid[i][j]["hit"] and not player_grid[i][j]["miss"] and (i + j) % 2 == 0:
                    avail.append((i, j))
    if not avail:
        for i in range(size):
            for j in range(size):
                if not player_grid[i][j]["hit"] and not player_grid[i][j]["miss"]:
                    avail.append((i, j))
    if not avail:
        return {"r": 0, "c": 0, "newTargets": [], "newMode": "hunt", "direction": direction}
    r, c = avail[int(rng() * len(avail)) % len(avail)]
    return {"r": r, "c": c, "newTargets": [], "newMode": "hunt", "direction": direction}


def add_targets(targets, r, c, grid, difficulty="normal", first_hit=None, size=GRID):
    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    candidates = [
        (r + dr, c + dc)
        for dr, dc in dirs
        if 0 <= r + dr < size and 0 <= c + dc < size and not grid[r + dr][c + dc]["hit"] and not grid[r + dr][c + dc]["miss"]
    ]
    if difficulty == "hard" and first_hit:
        dr = r - first_hit[0]
        dc = c - first_hit[1]
        if dr != 0 or dc != 0:
            axis = "v" if abs(dr) > 0 else "h"
            filtered = [p for p in candidates if (p[1] == c if axis == "v" else p[0] == r)]
            if filtered:
                candidates = filtered
            else:
                candidates = [
                    (r + ddr, c + ddc)
                    for ddr, ddc in dirs
                    if 0 <= r + ddr < size
                    and 0 <= c + ddc < size
                    and not grid[r + ddr][c + ddc]["hit"]
                    and not grid[r + ddr][c + ddc]["miss"]
                ]
    return list(targets) + candidates


def _apply_ai_turn(player_grid, ships, ai_state, difficulty, rng, sunk_by_ai: List[str]) -> Tuple[bool, Dict[str, Any]]:
    """Returns (player_lost, new_ai_state)."""
    shot = ai_shot(ai_state, player_grid, difficulty, rng)
    r, c = shot["r"], shot["c"]
    cell = player_grid[r][c]
    is_hit = bool(cell["ship"])
    cell["hit"] = is_hit
    cell["miss"] = not is_hit
    ut = list(shot["newTargets"])
    um = shot["newMode"]
    fh = ai_state.get("firstHit")
    if is_hit:
        fh = fh or [r, c]
        ut = add_targets(ut, r, c, player_grid, difficulty, fh)
        um = "target"
    newly = [s["id"] for s in ships if is_ship_sunk(player_grid, s["id"]) and s["id"] not in sunk_by_ai]
    if newly:
        sunk_by_ai.extend(newly)
        ut = []
        um = "hunt"
        fh = None
    hits = list(ai_state.get("hits") or [])
    hits.append([r, c])
    new_state = {
        "mode": um,
        "targets": ut,
        "hits": hits,
        "firstHit": None if um == "hunt" else fh,
        "direction": shot.get("direction"),
    }
    return all_sunk(player_grid, ships), new_state


def simulate_battleships(
    *,
    seed: str,
    difficulty: str,
    placements: Sequence[Any],
    actions: Sequence[Any],
    fleet_size: Optional[int] = None,
) -> Dict[str, Any]:
    settings = validate_settings(difficulty=difficulty, fleet_size=fleet_size or (len(placements) if placements else 5))
    diff = settings["difficulty"]
    fs = settings["fleet_size"]
    ships = normalize_placements(placements, fleet_size=fs)
    act_list = normalize_actions(actions)
    rng = mulberry32(seed_to_u32(seed))

    player_grid = build_grid_from_placements(ships)
    ai_grid = auto_place_all(ships, rng)

    ai_state: Dict[str, Any] = {"mode": "hunt", "targets": [], "hits": [], "firstHit": None}
    sunk_by_player: List[str] = []
    sunk_by_ai: List[str] = []
    shots_fired = 0
    consecutive_hits = 0
    bonus_shot_active = False
    abilities = {"airRecon": False, "sonarPing": False, "salvo": False}
    ability_mode = None  # "salvo" only tracked for multi-shot; recon/sonar are action types
    salvo_shots = 0
    player_turn = True
    won = False
    lost = False

    def mark_sunk_player():
        nonlocal won
        newly = [s["id"] for s in ships if is_ship_sunk(ai_grid, s["id"]) and s["id"] not in sunk_by_player]
        if newly:
            sunk_by_player.extend(newly)
        if all_sunk(ai_grid, ships):
            won = True

    def end_turn_ai():
        nonlocal player_turn, lost, ai_state
        if won or lost:
            return
        player_lost, ai_state = _apply_ai_turn(player_grid, ships, ai_state, diff, rng, sunk_by_ai)
        if player_lost:
            lost = True
            return
        player_turn = True

    for act in act_list:
        if won or lost:
            break
        if not player_turn:
            raise ValueError("Action while not player turn.")

        t = act["t"]
        if t == "salvo":
            if abilities["salvo"]:
                raise ValueError("Salvo already used.")
            # Need battleship in fleet (matches client gate)
            if not any(s["id"] == "battleship" for s in ships):
                raise ValueError("Salvo unavailable.")
            abilities["salvo"] = True
            ability_mode = "salvo"
            salvo_shots = 0
            continue

        r, c = int(act["r"]), int(act["c"])

        if t == "recon":
            if abilities["airRecon"]:
                raise ValueError("Air recon already used.")
            if not any(s["id"] == "carrier" for s in ships):
                raise ValueError("Air recon unavailable.")
            abilities["airRecon"] = True
            shots_fired += 1
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < GRID and 0 <= nc < GRID and not ai_grid[nr][nc]["hit"] and not ai_grid[nr][nc]["miss"]:
                        hit = bool(ai_grid[nr][nc]["ship"])
                        ai_grid[nr][nc]["hit"] = hit
                        ai_grid[nr][nc]["miss"] = not hit
            mark_sunk_player()
            player_turn = False
            if not won:
                end_turn_ai()
            continue

        if t == "sonar":
            if abilities["sonarPing"]:
                raise ValueError("Sonar already used.")
            if not any(s["id"] == "submarine" for s in ships):
                raise ValueError("Sonar unavailable.")
            abilities["sonarPing"] = True
            # Informational only — still costs the turn
            player_turn = False
            end_turn_ai()
            continue

        # Normal / salvo / bonus shot
        cell = ai_grid[r][c]
        if cell["hit"] or cell["miss"]:
            raise ValueError("Cell already fired.")
        is_hit = bool(cell["ship"])
        ship_id = cell["ship"]
        cell["hit"] = is_hit
        cell["miss"] = not is_hit
        shots_fired += 1
        mark_sunk_player()
        # Client returns "sunk" when this shot sinks a ship (not a plain "hit").
        res = "miss"
        if is_hit:
            res = "sunk" if ship_id and is_ship_sunk(ai_grid, ship_id) else "hit"

        if ability_mode == "salvo":
            salvo_shots += 1
            if won:
                break
            if salvo_shots >= 3:
                ability_mode = None
                salvo_shots = 0
                player_turn = False
                end_turn_ai()
            continue

        if won:
            break

        if res == "hit":
            consecutive_hits += 1
            if consecutive_hits >= 3 and not bonus_shot_active:
                bonus_shot_active = True
                continue  # keep turn
            if bonus_shot_active:
                bonus_shot_active = False
                consecutive_hits = 0
        else:
            consecutive_hits = 0
            bonus_shot_active = False

        player_turn = False
        end_turn_ai()

    ships_lost = len(sunk_by_ai)
    return {
        "won": won and not lost,
        "lost": lost,
        "shots_fired": shots_fired,
        "ships_lost": ships_lost,
        "fleet_size": fs,
        "difficulty": diff,
        "actions_used": len(act_list),
        "sunk_by_player": list(sunk_by_player),
        "sunk_by_ai": list(sunk_by_ai),
    }
