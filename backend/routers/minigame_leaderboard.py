# Mini Games Weekly Leaderboard - Combined leaderboard for Snake, Gauntlet, and Shooting Range
# Points: 10 base + score/100 (capped at 50) per play
# Top 5 rewarded every Sunday midnight UTC

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user, ADMIN_EMAILS

MINIGAME_LB_CONFIG_ID = "minigame_weekly_leaderboard"
VALID_GAMES = ["snake", "gauntlet", "shooting_range", "minesweeper"]
PARTICIPATION_POINTS = 10
SCORE_BONUS_DIVISOR = 100
SCORE_BONUS_CAP = 50

DEFAULT_REWARDS = {
    1: {"cash": 1_000_000, "respect": 200, "loot_pieces": 15, "bullets": 500},
    2: {"cash": 500_000, "respect": 100, "loot_pieces": 0, "bullets": 300},
    3: {"cash": 250_000, "respect": 50, "loot_pieces": 0, "bullets": 150},
    4: {"cash": 100_000, "respect": 25, "loot_pieces": 0, "bullets": 75},
    5: {"cash": 50_000, "respect": 10, "loot_pieces": 0, "bullets": 50},
}


def _week_start_sunday(dt: datetime) -> datetime:
    """Sunday 00:00 UTC as start of week for mini games leaderboard."""
    d = dt.date()
    days_since_sunday = d.weekday() + 1
    if days_since_sunday == 7:
        days_since_sunday = 0
    start = d - timedelta(days=days_since_sunday)
    return datetime(start.year, start.month, start.day, tzinfo=timezone.utc)


def _next_sunday_midnight(dt: datetime) -> datetime:
    """Next Sunday 00:00 UTC (payout time)."""
    week_start = _week_start_sunday(dt)
    return week_start + timedelta(days=7)


def _calculate_points(score: int) -> int:
    """Calculate points for a single play: base + score bonus (capped)."""
    score_bonus = min(SCORE_BONUS_CAP, max(0, score) // SCORE_BONUS_DIVISOR)
    return PARTICIPATION_POINTS + score_bonus


async def log_minigame_play(user_id: str, username: str, game: str, score: int):
    """Log a mini game play to the minigame_plays collection."""
    if game not in VALID_GAMES:
        return
    now = datetime.now(timezone.utc)
    week_start = _week_start_sunday(now)
    points = _calculate_points(score)
    doc = {
        "user_id": user_id,
        "username": username or "?",
        "game": game,
        "score": max(0, int(score)),
        "points": points,
        "week_start": week_start.isoformat().replace("+00:00", "Z"),
        "played_at": now.isoformat().replace("+00:00", "Z"),
    }
    await db.minigame_plays.insert_one(doc)


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: str
    username: str
    total_points: int
    games_played: int
    is_current_user: bool = False


class MyStatsResponse(BaseModel):
    total_points: int
    games_played: int
    rank: Optional[int]
    by_game: dict
    week_start: str
    next_payout: str


class LeaderboardResponse(BaseModel):
    top5: List[LeaderboardEntry]
    my_rank: Optional[int]
    my_points: int
    my_games_played: int
    week_start: str
    next_payout: str
    rewards: dict


def register(router):
    @router.get("/minigames/leaderboard")
    async def get_minigame_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get the top 5 mini games leaderboard for the current week plus user's stats."""
        now = datetime.now(timezone.utc)
        week_start = _week_start_sunday(now)
        week_start_iso = week_start.isoformat().replace("+00:00", "Z")
        next_payout = _next_sunday_midnight(now)
        next_payout_iso = next_payout.isoformat().replace("+00:00", "Z")

        pipeline = [
            {"$match": {"week_start": week_start_iso}},
            {
                "$group": {
                    "_id": "$user_id",
                    "username": {"$last": "$username"},
                    "total_points": {"$sum": "$points"},
                    "games_played": {"$sum": 1},
                }
            },
            {"$sort": {"total_points": -1, "games_played": -1}},
            {"$limit": 100},
        ]
        rows = await db.minigame_plays.aggregate(pipeline).to_list(100)

        top5 = []
        my_rank = None
        my_points = 0
        my_games_played = 0
        current_user_id = current_user.get("id")

        for i, row in enumerate(rows):
            rank = i + 1
            is_me = row["_id"] == current_user_id
            if is_me:
                my_rank = rank
                my_points = row["total_points"]
                my_games_played = row["games_played"]
            if rank <= 5:
                top5.append(LeaderboardEntry(
                    rank=rank,
                    user_id=row["_id"],
                    username=row.get("username") or "?",
                    total_points=row["total_points"],
                    games_played=row["games_played"],
                    is_current_user=is_me,
                ))

        cfg = await db.game_config.find_one({"id": MINIGAME_LB_CONFIG_ID}, {"_id": 0, "rewards": 1})
        rewards = (cfg or {}).get("rewards") or DEFAULT_REWARDS
        rewards_out = {}
        for k, v in rewards.items():
            rewards_out[str(k)] = v

        return {
            "top5": [e.dict() for e in top5],
            "my_rank": my_rank,
            "my_points": my_points,
            "my_games_played": my_games_played,
            "week_start": week_start_iso,
            "next_payout": next_payout_iso,
            "rewards": rewards_out,
        }

    @router.get("/minigames/my-stats")
    async def get_my_minigame_stats(current_user: dict = Depends(get_current_user)):
        """Get current user's mini game stats breakdown for the current week."""
        now = datetime.now(timezone.utc)
        week_start = _week_start_sunday(now)
        week_start_iso = week_start.isoformat().replace("+00:00", "Z")
        next_payout = _next_sunday_midnight(now)
        next_payout_iso = next_payout.isoformat().replace("+00:00", "Z")

        pipeline = [
            {"$match": {"week_start": week_start_iso, "user_id": current_user["id"]}},
            {
                "$group": {
                    "_id": "$game",
                    "plays": {"$sum": 1},
                    "points": {"$sum": "$points"},
                    "total_score": {"$sum": "$score"},
                    "best_score": {"$max": "$score"},
                }
            },
        ]
        rows = await db.minigame_plays.aggregate(pipeline).to_list(10)

        by_game = {}
        total_points = 0
        games_played = 0
        for row in rows:
            game = row["_id"]
            by_game[game] = {
                "plays": row["plays"],
                "points": row["points"],
                "total_score": row["total_score"],
                "best_score": row["best_score"],
            }
            total_points += row["points"]
            games_played += row["plays"]

        all_pipeline = [
            {"$match": {"week_start": week_start_iso}},
            {
                "$group": {
                    "_id": "$user_id",
                    "total_points": {"$sum": "$points"},
                }
            },
            {"$sort": {"total_points": -1}},
        ]
        all_rows = await db.minigame_plays.aggregate(all_pipeline).to_list(1000)
        rank = None
        for i, row in enumerate(all_rows):
            if row["_id"] == current_user["id"]:
                rank = i + 1
                break

        return {
            "total_points": total_points,
            "games_played": games_played,
            "rank": rank,
            "by_game": by_game,
            "week_start": week_start_iso,
            "next_payout": next_payout_iso,
        }

    @router.get("/minigames/history")
    async def get_minigame_history(current_user: dict = Depends(get_current_user)):
        """Get user's recent mini game plays (last 20)."""
        cursor = db.minigame_plays.find(
            {"user_id": current_user["id"]},
            {"_id": 0, "game": 1, "score": 1, "points": 1, "played_at": 1},
        ).sort("played_at", -1).limit(20)
        rows = await cursor.to_list(20)
        return {"history": rows}


async def run_minigame_weekly_payout(database, test_run: bool = False):
    """
    Run weekly mini games leaderboard payout for the previous week (Sunday to Sunday UTC).
    Uses game_config id minigame_weekly_leaderboard with last_payout_week_start for idempotency.
    Rewards top 5 with cash, respect, loot pieces, and bullets.
    """
    log = logging.getLogger(__name__)
    now = datetime.now(timezone.utc)
    this_week_start = _week_start_sunday(now)
    last_week_start = this_week_start - timedelta(days=7)
    last_week_start_str = last_week_start.strftime("%Y-%m-%d")
    last_week_start_iso = last_week_start.isoformat().replace("+00:00", "Z")

    cfg = await database.game_config.find_one(
        {"id": MINIGAME_LB_CONFIG_ID},
        {"_id": 0, "last_payout_week_start": 1, "rewards": 1},
    )
    if cfg and cfg.get("last_payout_week_start") == last_week_start_str and not test_run:
        return

    rewards = (cfg or {}).get("rewards") or DEFAULT_REWARDS

    if not test_run:
        claim_filter = {
            "id": MINIGAME_LB_CONFIG_ID,
            "$or": [
                {"last_payout_week_start": {"$ne": last_week_start_str}},
                {"last_payout_week_start": {"$exists": False}},
            ],
        }
        claim_result = await database.game_config.update_one(
            claim_filter,
            {"$set": {"last_payout_week_start": last_week_start_str}},
            upsert=True,
        )
        if claim_result.modified_count == 0 and claim_result.upserted_id is None:
            return

    pipeline = [
        {"$match": {"week_start": last_week_start_iso}},
        {
            "$group": {
                "_id": "$user_id",
                "username": {"$last": "$username"},
                "total_points": {"$sum": "$points"},
                "games_played": {"$sum": 1},
            }
        },
        {"$sort": {"total_points": -1, "games_played": -1}},
        {"$limit": 5},
    ]
    top5 = await database.minigame_plays.aggregate(pipeline).to_list(5)

    if not top5:
        log.info("Mini games weekly payout: no plays for week %s", last_week_start_str)
        return

    if test_run:
        log.info(
            "Mini games weekly payout (test_run): week %s would pay %d users",
            last_week_start_str, len(top5),
        )
        return

    payout_log = []
    for i, entry in enumerate(top5):
        rank = i + 1
        user_id = entry["_id"]
        username = entry.get("username") or "?"
        reward = rewards.get(rank) or rewards.get(str(rank)) or {}

        cash = int(reward.get("cash") or 0)
        respect = int(reward.get("respect") or 0)
        loot_pieces = int(reward.get("loot_pieces") or 0)
        bullets = int(reward.get("bullets") or 0)

        inc = {}
        if cash > 0:
            inc["money"] = cash
        if respect > 0:
            inc["respect_points"] = respect
        if loot_pieces > 0:
            inc["loot_box_pieces"] = loot_pieces
        if bullets > 0:
            inc["bullets"] = bullets

        if inc:
            await database.users.update_one({"id": user_id}, {"$inc": inc})

        payout_log.append({
            "rank": rank,
            "user_id": user_id,
            "username": username,
            "points": entry["total_points"],
            "games_played": entry["games_played"],
            "reward": reward,
        })

    payout_record = {
        "week_start": last_week_start_str,
        "paid_at": now.isoformat().replace("+00:00", "Z"),
        "payouts": payout_log,
    }
    await database.minigame_payout_history.insert_one(payout_record)

    log.info(
        "Mini games weekly payout complete: week %s, paid %d users",
        last_week_start_str, len(top5),
    )
