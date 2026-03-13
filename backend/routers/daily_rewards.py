# Daily Rewards: Rock Paper Scissors and Noughts & Crosses vs computer. 3 plays per 6 hours (shared). Win = cash + maybe cars (no points).
from datetime import datetime, timezone, timedelta
import random
import uuid

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user, log_activity, CARS

RPS_PLAYS_PER_WINDOW = 3
RPS_WINDOW_HOURS = 6
RPS_CHOICES = ["rock", "paper", "scissors"]
RPS_WIN_MONEY = 50_000
# Cars up to rare only (common, uncommon, rare)
DAILY_REWARDS_CAR_IDS = [c["id"] for c in CARS if c.get("id") not in ("car_custom", "car20") and c.get("rarity") in ("common", "uncommon", "rare")]
# On win: 25% chance 1 car, 8% chance 2 cars (so sometimes just cash, sometimes cash + 1 or 2 cars)
DAILY_REWARDS_CAR_1_CHANCE = 0.25
DAILY_REWARDS_CAR_2_CHANCE = 0.08

# Noughts & Crosses
TTT_WIN_LINES = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6)]


def _ttt_winner(board: list) -> str:
    """Return 'X', 'O', or '' (no winner)."""
    for a, b, c in TTT_WIN_LINES:
        if board[a] and board[a] == board[b] == board[c]:
            return board[a]
    return ""


def _ttt_empty_cells(board: list) -> list:
    return [i for i in range(9) if not (board[i] or "").strip()]


def _ttt_computer_move(board: list, computer_side: str) -> int:
    """Simple AI: win if possible, else block, else random. Returns cell index."""
    player_side = "O" if computer_side == "X" else "X"
    empty = _ttt_empty_cells(board)
    if not empty:
        return -1
    for idx in empty:
        b = list(board)
        b[idx] = computer_side
        if _ttt_winner(b) == computer_side:
            return idx
    for idx in empty:
        b = list(board)
        b[idx] = player_side
        if _ttt_winner(b) == player_side:
            return idx
    return random.choice(empty)


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


async def _grant_daily_win_rewards(user_id: str) -> tuple[int, list]:
    """Grant cash + optional cars (max rare). Returns (money_won, list of car names)."""
    await db.users.update_one({"id": user_id}, {"$inc": {"money": RPS_WIN_MONEY}})
    cars_won = []
    car_ids = DAILY_REWARDS_CAR_IDS if isinstance(DAILY_REWARDS_CAR_IDS, list) else []
    if not car_ids:
        return RPS_WIN_MONEY, cars_won
    r = random.random()
    num_cars = 2 if r < DAILY_REWARDS_CAR_2_CHANCE else (1 if r < DAILY_REWARDS_CAR_1_CHANCE else 0)
    chosen = random.sample(car_ids, min(num_cars, len(car_ids))) if num_cars else []
    now_iso = datetime.now(timezone.utc).isoformat()
    cars_list = CARS if isinstance(CARS, list) else []
    for car_id in chosen:
        car = next((c for c in cars_list if c.get("id") == car_id), None)
        if car:
            await db.user_cars.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "car_id": car_id,
                "car_name": car.get("name", car_id),
                "acquired_at": now_iso,
                "damage_percent": 0,  # Reward cars have no damage
            })
            cars_won.append(car.get("name", car_id))
    return RPS_WIN_MONEY, cars_won


class RPSPlayRequest(BaseModel):
    choice: str


class TTTMoveRequest(BaseModel):
    cell: int


def register(router):
    @router.get("/daily-rewards/info")
    async def daily_rewards_info(current_user: dict = Depends(get_current_user)):
        """Plays left in current 6h window, next play time if at limit."""
        # get_current_user already loaded the full user from DB
        raw_plays = current_user.get("rps_plays")
        if isinstance(raw_plays, list):
            plays = list(raw_plays)
        elif isinstance(raw_plays, str):
            plays = [raw_plays]
        else:
            plays = []
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
        }

    @router.post("/daily-rewards/play")
    async def daily_rewards_play(req: RPSPlayRequest, current_user: dict = Depends(get_current_user)):
        """Play rock/paper/scissors. Uses one of your 3 plays per 6h. Win = money + optional cars."""
        choice = (req.choice or "").strip().lower()
        if choice not in RPS_CHOICES:
            raise HTTPException(status_code=400, detail="Choice must be rock, paper, or scissors")
        raw_plays = current_user.get("rps_plays")
        if isinstance(raw_plays, list):
            plays = list(raw_plays)
        elif isinstance(raw_plays, str):
            plays = [raw_plays]  # migrate: was stored as single string by bug
        else:
            plays = []
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
        new_plays = (plays + [now_iso])[-50:]
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$set": {"rps_plays": new_plays}},
        )
        money_won = 0
        cars_won = []
        if result == "win":
            money_won, cars_won = await _grant_daily_win_rewards(current_user.get("id") or "")
        await log_activity(
            current_user.get("id") or "",
            current_user.get("username") or "?",
            "daily_rewards_rps",
            {"game": "rps", "result": result, "money_won": money_won, "cars_won": cars_won, "your_choice": choice, "computer_choice": computer},
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
            "cars_won": cars_won,
            "plays_left": max(0, RPS_PLAYS_PER_WINDOW - len(plays_in_window_after)),
            "next_play_at": next_play_at,
        }

    @router.get("/daily-rewards/ttt")
    async def daily_rewards_ttt_status(current_user: dict = Depends(get_current_user)):
        """Get current Noughts & Crosses game if any (for resuming)."""
        game = await db.daily_rewards_ttt.find_one({"user_id": current_user.get("id") or ""})
        if not game:
            return {"has_game": False}
        board = list(game.get("board") or [""] * 9)
        if len(board) != 9:
            board = (board + [""] * 9)[:9]
        return {
            "has_game": True,
            "board": board,
            "player_side": game.get("player_side") or "X",
            "turn": game.get("turn") or "X",
        }

    @router.post("/daily-rewards/ttt/start")
    async def daily_rewards_ttt_start(current_user: dict = Depends(get_current_user)):
        """Start a Noughts & Crosses game. Uses one of your 3 plays per 6h. Player is X or O at random; if O, computer moves first."""
        raw_plays = current_user.get("rps_plays")
        if isinstance(raw_plays, list):
            plays = list(raw_plays)
        elif isinstance(raw_plays, str):
            plays = [raw_plays]
        else:
            plays = []
        in_window = _plays_in_window(plays)
        if len(in_window) >= RPS_PLAYS_PER_WINDOW:
            raise HTTPException(
                status_code=400,
                detail=f"You have used all {RPS_PLAYS_PER_WINDOW} plays for this 6-hour window.",
            )
        existing = await db.daily_rewards_ttt.find_one({"user_id": current_user.get("id") or ""})
        if existing:
            raise HTTPException(status_code=400, detail="Finish your current Noughts & Crosses game first.")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        player_side = random.choice(["X", "O"])
        computer_side = "O" if player_side == "X" else "X"
        board = [""] * 9
        if player_side == "O":
            first_cell = random.choice([0, 2, 4, 6, 8])
            board[first_cell] = computer_side
            turn = "O"  # Computer just moved; now player's turn
        else:
            turn = "X"  # Player (X) goes first
        new_plays = (plays + [now_iso])[-50:]
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$set": {"rps_plays": new_plays}})
        await db.daily_rewards_ttt.insert_one({
            "user_id": current_user.get("id") or "",
            "board": board,
            "player_side": player_side,
            "computer_side": computer_side,
            "turn": turn,
            "created_at": now_iso,
        })
        plays_after = _plays_in_window(new_plays)
        next_play_at = None
        if len(plays_after) >= RPS_PLAYS_PER_WINDOW and plays_after:
            try:
                oldest = min(
                    datetime.fromisoformat(str(t).replace("Z", "+00:00")) if isinstance(t, str) else t for t in plays_after
                )
                if oldest.tzinfo is None:
                    oldest = oldest.replace(tzinfo=timezone.utc)
                next_play_at = (oldest + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()
            except Exception:
                next_play_at = (now + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()
        return {
            "board": board,
            "player_side": player_side,
            "turn": turn,
            "plays_left": max(0, RPS_PLAYS_PER_WINDOW - len(plays_after)),
            "next_play_at": next_play_at,
        }

    @router.post("/daily-rewards/ttt/move")
    async def daily_rewards_ttt_move(req: TTTMoveRequest, current_user: dict = Depends(get_current_user)):
        """Play a move in Noughts & Crosses. Returns updated board and result (ongoing/win/lose/draw)."""
        cell = max(0, min(8, int(req.cell)))
        game = await db.daily_rewards_ttt.find_one({"user_id": current_user.get("id") or ""})
        if not game:
            raise HTTPException(status_code=400, detail="No active game. Start one first.")
        board = list(game.get("board") or [""] * 9)
        if len(board) != 9:
            board = (board + [""] * 9)[:9]
        player_side = game.get("player_side") or "X"
        computer_side = game.get("computer_side") or "O"
        turn = game.get("turn") or "X"
        if turn != player_side:
            raise HTTPException(status_code=400, detail="Not your turn.")
        if board[cell]:
            raise HTTPException(status_code=400, detail="Cell already taken.")
        board[cell] = player_side
        winner = _ttt_winner(board)
        result = "ongoing"
        money_won = 0
        cars_won = []
        if winner:
            result = "win" if winner == player_side else "lose"
            if result == "win":
                money_won, cars_won = await _grant_daily_win_rewards(current_user.get("id") or "")
            await log_activity(
                current_user.get("id") or "",
                current_user.get("username") or "?",
                "daily_rewards_ttt",
                {"game": "ttt", "result": result, "money_won": money_won, "cars_won": cars_won},
            )
            await db.daily_rewards_ttt.delete_one({"user_id": current_user.get("id") or ""})
        else:
            empty = _ttt_empty_cells(board)
            if not empty:
                result = "draw"
                await log_activity(
                    current_user.get("id") or "",
                    current_user.get("username") or "?",
                    "daily_rewards_ttt",
                    {"game": "ttt", "result": "draw"},
                )
                await db.daily_rewards_ttt.delete_one({"user_id": current_user.get("id") or ""})
            else:
                comp_cell = _ttt_computer_move(board, computer_side)
                if comp_cell >= 0:
                    board[comp_cell] = computer_side
                    winner = _ttt_winner(board)
                    if winner:
                        result = "lose"
                        await log_activity(
                            current_user.get("id") or "",
                            current_user.get("username") or "?",
                            "daily_rewards_ttt",
                            {"game": "ttt", "result": "lose"},
                        )
                        await db.daily_rewards_ttt.delete_one({"user_id": current_user.get("id") or ""})
                    elif not _ttt_empty_cells(board):
                        result = "draw"
                        await log_activity(
                            current_user.get("id") or "",
                            current_user.get("username") or "?",
                            "daily_rewards_ttt",
                            {"game": "ttt", "result": "draw"},
                        )
                        await db.daily_rewards_ttt.delete_one({"user_id": current_user.get("id") or ""})
                    else:
                        await db.daily_rewards_ttt.update_one(
                            {"user_id": current_user.get("id") or ""},
                            {"$set": {"board": board, "turn": player_side}},
                        )
        raw_plays = current_user.get("rps_plays")
        if isinstance(raw_plays, list):
            plays = list(raw_plays)
        elif isinstance(raw_plays, str):
            plays = [raw_plays]
        else:
            plays = []
        in_window = _plays_in_window(plays)
        next_play_at = None
        if len(in_window) >= RPS_PLAYS_PER_WINDOW and in_window:
            try:
                oldest = min(
                    datetime.fromisoformat(str(t).replace("Z", "+00:00")) if isinstance(t, str) else t for t in in_window
                )
                if oldest.tzinfo is None:
                    oldest = oldest.replace(tzinfo=timezone.utc)
                next_play_at = (oldest + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()
            except Exception:
                next_play_at = (datetime.now(timezone.utc) + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()
        return {
            "board": board,
            "turn": player_side if result == "ongoing" else None,
            "result": result,
            "money_won": money_won,
            "cars_won": cars_won,
            "plays_left": max(0, RPS_PLAYS_PER_WINDOW - len(in_window)),
            "next_play_at": next_play_at,
        }
