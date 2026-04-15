# Admin helpers: adjust minigame weekly (minigame_plays) and per-game score collections.
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

# game slug -> Mongo collection attribute name on db
PER_GAME_SCORE_COLLECTIONS: Dict[str, str] = {
    "snake": "snake_scores",
    "gauntlet": "gauntlet_scores",
    "shooting_range": "shooting_range_scores",
    "mafia_rpg": "mafia_rpg_scores",
    "family_run": "family_run_scores",
    "whack_a_copper": "whack_a_copper_scores",
    "minesweeper": "minesweeper_wins",
    "battleships": "battleships_wins",
    "the_getaway": "the_getaway_runs",
}

# Subset with a simple numeric score row we can synthesize for admin "add score"
PER_GAME_SIMPLE_SCORE_GAMES = frozenset(
    {"snake", "gauntlet", "shooting_range", "mafia_rpg", "family_run", "whack_a_copper"}
)


def current_week_start_iso() -> str:
    from utils.game_timezone import game_week_start_utc

    return game_week_start_utc(datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")


async def delete_minigame_weekly_plays_for_user(db, *, user_id: str, scope: str) -> int:
    """scope: 'current' (this Mon 00:00 UK week) or 'all'."""
    if scope == "current":
        q = {"user_id": user_id, "week_start": current_week_start_iso()}
    else:
        q = {"user_id": user_id}
    res = await db.minigame_plays.delete_many(q)
    return int(res.deleted_count or 0)


async def delete_per_game_score_rows_for_user(
    db, *, user_id: str, games: Optional[List[str]] = None
) -> Dict[str, int]:
    """If games is None or empty, all PER_GAME_SCORE_COLLECTIONS; else filter by slug."""
    want = {g.strip().lower() for g in (games or []) if (g or "").strip()}
    out: Dict[str, int] = {}
    for slug, coll_name in PER_GAME_SCORE_COLLECTIONS.items():
        if want and slug not in want:
            continue
        coll = getattr(db, coll_name, None)
        if coll is None:
            continue
        r = await coll.delete_many({"user_id": user_id})
        out[slug] = int(r.deleted_count or 0)
    return out


async def insert_synthetic_per_game_score(
    db, *, game: str, user_id: str, username: str, score: int
) -> None:
    """Insert one leaderboard row (no cash/respect payout)."""
    g = (game or "").strip().lower()
    if g not in PER_GAME_SIMPLE_SCORE_GAMES:
        raise ValueError(f"Per-game score row not supported for '{g}'. Use weekly play only.")
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    uname = (username or "?")[:120]
    sc = max(0, int(score))

    coll_name = PER_GAME_SCORE_COLLECTIONS[g]
    coll = getattr(db, coll_name)

    if g == "snake":
        await coll.insert_one(
            {"id": str(uuid.uuid4()), "user_id": user_id, "username": uname, "score": sc, "at": now_iso}
        )
    elif g == "gauntlet":
        await coll.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "username": uname,
                "score": sc,
                "cash": 0,
                "respect": 0,
                "at": now_iso,
            }
        )
    elif g == "shooting_range":
        await coll.insert_one(
            {"user_id": user_id, "username": uname, "score": sc, "created_at": now_iso}
        )
    elif g == "mafia_rpg":
        await coll.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "username": uname,
                "score": sc,
                "respect": 0,
                "missions_complete": 0,
                "total_earned": 0,
                "cash_reward": 0,
                "at": now_iso,
            }
        )
    elif g == "family_run":
        await coll.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "username": uname,
                "score": sc,
                "coins": 0,
                "at": now_iso,
            }
        )
    elif g == "whack_a_copper":
        await coll.insert_one(
            {"user_id": user_id, "username": uname, "score": sc, "cash": 0, "at": now_iso}
        )


async def add_minigame_leaderboard_play_for_user(
    db, *, user_id: str, username: str, game: str, score: int, record_weekly: bool, record_per_game: bool
) -> Dict[str, object]:
    from routers.minigames.minigame_leaderboard import VALID_GAMES, log_minigame_play

    g = (game or "").strip().lower()
    if g not in VALID_GAMES:
        raise ValueError(f"Unknown game '{game}'. Valid: {', '.join(VALID_GAMES)}")
    sc = max(0, int(score))
    out: Dict[str, object] = {"game": g, "score": sc}

    if record_weekly:
        await log_minigame_play(user_id, username or "?", g, sc)
        out["weekly_play_logged"] = True
    else:
        out["weekly_play_logged"] = False

    if record_per_game:
        await insert_synthetic_per_game_score(db, game=g, user_id=user_id, username=username, score=sc)
        out["per_game_row_inserted"] = True
    else:
        out["per_game_row_inserted"] = False

    return out
