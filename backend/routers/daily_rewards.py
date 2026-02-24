# Daily Rewards: Rock Paper Scissors vs computer. 3 plays per 6 hours. Win = rewards.
from datetime import datetime, timezone, timedelta
import random

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user

RPS_PLAYS_PER_WINDOW = 3
RPS_WINDOW_HOURS = 6
RPS_CHOICES = ["rock", "paper", "scissors"]
# Win rewards
RPS_WIN_MONEY = 50_000
RPS_WIN_POINTS = 2


def _rps_winner(player: str, computer: str) -> str:
    """Return 'win', 'lose', or 'draw'."""
    if player == computer:
        return "draw"
    if (player == "rock" and computer == "scissors") or (player == "paper" and computer == "rock") or (player == "scissors" and computer == "paper"):
        return "win"
    return "lose"


def _plays_in_window(plays: list) -> list:
    """Filter play timestamps to only those within the last RPS_WINDOW_HOURS."""
    if not plays:
        return []
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=RPS_WINDOW_HOURS)
    out = []
    for at in plays:
        try:
            if isinstance(at, str):
                dt = datetime.fromisoformat(at.replace("Z", "+00:00"))
            else:
                dt = at
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt >= cutoff:
                out.append(at)
        except Exception:
            continue
    return out


class RPSPlayRequest(BaseModel):
    choice: str


def register(router):
    @router.get("/daily-rewards/info")
    async def daily_rewards_info(current_user: dict = Depends(get_current_user)):
        """Plays left in current 6h window, next play time if at limit."""
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "rps_plays": 1})
        plays = user.get("rps_plays") or []
        in_window = _plays_in_window(plays)
        plays_used = len(in_window)
        plays_left = max(0, RPS_PLAYS_PER_WINDOW - plays_used)
        next_play_at = None
        if plays_used >= RPS_PLAYS_PER_WINDOW and in_window:
            try:
                oldest = min(
                    datetime.fromisoformat(str(t).replace("Z", "+00:00")) if isinstance(t, str) else t
                    for t in in_window
                )
                if oldest.tzinfo is None:
                    oldest = oldest.replace(tzinfo=timezone.utc)
                next_play_at = (oldest + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()
            except Exception:
                next_play_at = (datetime.now(timezone.utc) + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()
        return {
            "plays_used": plays_used,
            "plays_left": plays_left,
            "plays_per_window": RPS_PLAYS_PER_WINDOW,
            "window_hours": RPS_WINDOW_HOURS,
            "next_play_at": next_play_at,
            "win_money": RPS_WIN_MONEY,
            "win_points": RPS_WIN_POINTS,
        }

    @router.post("/daily-rewards/play")
    async def daily_rewards_play(req: RPSPlayRequest, current_user: dict = Depends(get_current_user)):
        """Play rock/paper/scissors. Uses one of your 3 plays per 6h. Win = money + points."""
        choice = (req.choice or "").strip().lower()
        if choice not in RPS_CHOICES:
            raise HTTPException(status_code=400, detail="Choice must be rock, paper, or scissors")
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "rps_plays": 1, "money": 1, "points": 1})
        plays = user.get("rps_plays") or []
        in_window = _plays_in_window(plays)
        if len(in_window) >= RPS_PLAYS_PER_WINDOW:
            raise HTTPException(
                status_code=400,
                detail=f"You have used all {RPS_PLAYS_PER_WINDOW} plays for this 6-hour window. Come back later.",
            )
        computer = random.choice(RPS_CHOICES)
        result = _rps_winner(choice, computer)
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        new_plays = (plays + [now_iso])[-50]
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"rps_plays": new_plays}},
        )
        money_won = 0
        points_won = 0
        if result == "win":
            money_won = RPS_WIN_MONEY
            points_won = RPS_WIN_POINTS
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"money": money_won, "points": points_won}},
            )
        plays_in_window_after = _plays_in_window(new_plays)
        next_play_at = None
        if len(plays_in_window_after) >= RPS_PLAYS_PER_WINDOW and plays_in_window_after:
            try:
                oldest = min(
                    datetime.fromisoformat(str(t).replace("Z", "+00:00")) if isinstance(t, str) else t
                    for t in plays_in_window_after
                )
                if oldest.tzinfo is None:
                    oldest = oldest.replace(tzinfo=timezone.utc)
                next_play_at = (oldest + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()
            except Exception:
                next_play_at = (now + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()
        return {
            "your_choice": choice,
            "computer_choice": computer,
            "result": result,
            "money_won": money_won,
            "points_won": points_won,
            "plays_left": max(0, RPS_PLAYS_PER_WINDOW - len(plays_in_window_after)),
            "next_play_at": next_play_at,
        }
