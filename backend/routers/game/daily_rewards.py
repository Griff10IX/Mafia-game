# Daily Rewards: Rock Paper Scissors and Noughts & Crosses vs computer. 3 plays per 6 hours (shared). Win = cash + maybe cars + maybe loot pieces.
from datetime import datetime, timezone, timedelta
import secrets
import uuid

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user, log_activity, CARS

_rng = secrets.SystemRandom()

RPS_PLAYS_PER_WINDOW = 3
RPS_WINDOW_HOURS = 6
RPS_CHOICES = ["rock", "paper", "scissors"]
RPS_WIN_MONEY = 10_000_000
# Cars up to rare only (common, uncommon, rare)
DAILY_REWARDS_CAR_IDS = [c["id"] for c in CARS if c.get("id") not in ("car_custom", "car20", "car21", "car22") and c.get("rarity") in ("common", "uncommon", "rare")]
# On win: 25% chance 1 car, 8% chance 2 cars (so sometimes just cash, sometimes cash + 1 or 2 cars)
DAILY_REWARDS_CAR_1_CHANCE = 0.25
DAILY_REWARDS_CAR_2_CHANCE = 0.08
# On win: 25% chance for 10 or 15 loot box pieces
DAILY_REWARDS_LOOT_CHANCE = 0.25
DAILY_REWARDS_LOOT_PIECES_OPTIONS = (10, 15)

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
    return _rng.choice(empty)


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


def _parse_window_start(raw) -> datetime | None:
    """Parse rps_window_start into a timezone-aware datetime, or None."""
    if not raw:
        return None
    try:
        ws = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if ws.tzinfo is None:
            ws = ws.replace(tzinfo=timezone.utc)
        return ws
    except Exception:
        return None


async def _claim_play_slot(uid: str) -> tuple[int, str | None]:
    """Atomically claim a play slot using $inc with a $lt guard.
    Returns (plays_left, next_play_at).
    Raises HTTPException(429) if the limit has been reached.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=RPS_WINDOW_HOURS)

    # Reset the window atomically if it has expired or was never initialised
    await db.users.update_one(
        {"id": uid, "$or": [
            {"rps_window_start": {"$lt": cutoff.isoformat()}},
            {"rps_window_start": {"$exists": False}},
        ]},
        {"$set": {"rps_window_plays": 0, "rps_window_start": now.isoformat()}},
    )

    # Atomically increment only when below the limit – prevents TOCTOU races
    claim = await db.users.update_one(
        {"id": uid, "rps_window_plays": {"$lt": RPS_PLAYS_PER_WINDOW}},
        {"$inc": {"rps_window_plays": 1}},
    )
    if claim.modified_count == 0:
        raise HTTPException(
            status_code=429,
            detail=f"You have used all {RPS_PLAYS_PER_WINDOW} plays for this 6-hour window. Come back later.",
        )

    return await _get_play_window(uid)


async def _get_play_window(uid: str) -> tuple[int, str | None]:
    """Return (plays_left, next_play_at) for the user's current play window."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=RPS_WINDOW_HOURS)

    user = await db.users.find_one({"id": uid}, {"rps_window_start": 1, "rps_window_plays": 1})
    plays_used = (user or {}).get("rps_window_plays", 0)
    ws = _parse_window_start((user or {}).get("rps_window_start"))

    if not ws or ws < cutoff:
        plays_used = 0

    plays_left = max(0, RPS_PLAYS_PER_WINDOW - plays_used)
    next_play_at = None
    if plays_left == 0 and ws:
        next_play_at = (ws + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()

    return plays_left, next_play_at


async def _grant_daily_win_rewards(user_id: str) -> tuple[int, list, int]:
    """Grant cash + optional cars (max rare) + optional loot pieces. Returns (money_won, car names, loot pieces)."""
    inc: dict = {"money": RPS_WIN_MONEY}
    loot_box_pieces = 0
    if _rng.random() < DAILY_REWARDS_LOOT_CHANCE:
        loot_box_pieces = _rng.choice(DAILY_REWARDS_LOOT_PIECES_OPTIONS)
        inc["loot_box_pieces"] = loot_box_pieces

    cars_won = []
    car_ids = DAILY_REWARDS_CAR_IDS if isinstance(DAILY_REWARDS_CAR_IDS, list) else []
    if car_ids:
        r = _rng.random()
        num_cars = 2 if r < DAILY_REWARDS_CAR_2_CHANCE else (1 if r < DAILY_REWARDS_CAR_1_CHANCE else 0)
        chosen = _rng.sample(car_ids, min(num_cars, len(car_ids))) if num_cars else []
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
                    "damage_percent": 0,
                })
                cars_won.append(car.get("name", car_id))

    await db.users.update_one({"id": user_id}, {"$inc": inc})
    return RPS_WIN_MONEY, cars_won, loot_box_pieces


class RPSPlayRequest(BaseModel):
    choice: str


class TTTMoveRequest(BaseModel):
    cell: int


def register(router):
    @router.get("/daily-rewards/info")
    async def daily_rewards_info(current_user: dict = Depends(get_current_user)):
        """Plays left in current 6h window, next play time if at limit."""
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=RPS_WINDOW_HOURS)
        plays_used = current_user.get("rps_window_plays", 0)
        ws = _parse_window_start(current_user.get("rps_window_start"))
        if not ws or ws < cutoff:
            plays_used = 0
        plays_left = max(0, RPS_PLAYS_PER_WINDOW - plays_used)
        next_play_at = None
        if plays_left == 0 and ws:
            next_play_at = (ws + timedelta(hours=RPS_WINDOW_HOURS)).isoformat()
        return {
            "plays_used": plays_used,
            "plays_left": plays_left,
            "plays_per_window": RPS_PLAYS_PER_WINDOW,
            "window_hours": RPS_WINDOW_HOURS,
            "next_play_at": next_play_at,
            "win_money": RPS_WIN_MONEY,
            "loot_pieces_chance": DAILY_REWARDS_LOOT_CHANCE,
            "loot_pieces_options": list(DAILY_REWARDS_LOOT_PIECES_OPTIONS),
        }

    @router.post("/daily-rewards/play")
    async def daily_rewards_play(req: RPSPlayRequest, current_user: dict = Depends(get_current_user)):
        """Play rock/paper/scissors. Uses one of your 3 plays per 6h. Win = money + optional cars."""
        choice = (req.choice or "").strip().lower()
        if choice not in RPS_CHOICES:
            raise HTTPException(status_code=400, detail="Choice must be rock, paper, or scissors")
        uid = current_user.get("id") or ""

        await _claim_play_slot(uid)

        computer = _rng.choice(RPS_CHOICES)
        result = _rps_winner(choice, computer)
        money_won = 0
        cars_won = []
        loot_box_pieces = 0
        if result == "win":
            money_won, cars_won, loot_box_pieces = await _grant_daily_win_rewards(uid)
        await log_activity(
            uid,
            current_user.get("username") or "?",
            "daily_rewards_rps",
            {"game": "rps", "result": result, "money_won": money_won, "cars_won": cars_won, "loot_box_pieces": loot_box_pieces, "your_choice": choice, "computer_choice": computer},
        )

        plays_left, next_play_at = await _get_play_window(uid)
        return {
            "your_choice": choice,
            "computer_choice": computer,
            "result": result,
            "money_won": money_won,
            "cars_won": cars_won,
            "loot_box_pieces": loot_box_pieces,
            "plays_left": plays_left,
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
        uid = current_user.get("id") or ""

        existing = await db.daily_rewards_ttt.find_one({"user_id": uid})
        if existing:
            raise HTTPException(status_code=400, detail="Finish your current Noughts & Crosses game first.")

        await _claim_play_slot(uid)

        player_side = _rng.choice(["X", "O"])
        computer_side = "O" if player_side == "X" else "X"
        board = [""] * 9
        if player_side == "O":
            first_cell = _rng.choice([0, 2, 4, 6, 8])
            board[first_cell] = computer_side
            turn = "O"
        else:
            turn = "X"

        now_iso = datetime.now(timezone.utc).isoformat()
        await db.daily_rewards_ttt.insert_one({
            "user_id": uid,
            "board": board,
            "player_side": player_side,
            "computer_side": computer_side,
            "turn": turn,
            "created_at": now_iso,
        })

        plays_left, next_play_at = await _get_play_window(uid)
        await log_activity(uid, current_user.get("username", "?"), "daily_ttt_start", {"side": player_side})
        return {
            "board": board,
            "player_side": player_side,
            "turn": turn,
            "plays_left": plays_left,
            "next_play_at": next_play_at,
        }

    @router.post("/daily-rewards/ttt/move")
    async def daily_rewards_ttt_move(req: TTTMoveRequest, current_user: dict = Depends(get_current_user)):
        """Play a move in Noughts & Crosses. Returns updated board and result (ongoing/win/lose/draw)."""
        cell = max(0, min(8, int(req.cell)))
        uid = current_user.get("id") or ""
        # Atomically claim this move to prevent concurrent requests both processing the same board
        game = await db.daily_rewards_ttt.find_one_and_update(
            {"user_id": uid, "status": {"$ne": "processing"}},
            {"$set": {"status": "processing"}},
        )
        if not game:
            existing = await db.daily_rewards_ttt.find_one({"user_id": uid})
            if existing:
                raise HTTPException(status_code=400, detail="Move already being processed.")
            raise HTTPException(status_code=400, detail="No active game. Start one first.")
        board = list(game.get("board") or [""] * 9)
        if len(board) != 9:
            board = (board + [""] * 9)[:9]
        player_side = game.get("player_side") or "X"
        computer_side = game.get("computer_side") or "O"
        turn = game.get("turn") or "X"
        if turn != player_side:
            await db.daily_rewards_ttt.update_one({"user_id": uid}, {"$unset": {"status": ""}})
            raise HTTPException(status_code=400, detail="Not your turn.")
        if board[cell]:
            await db.daily_rewards_ttt.update_one({"user_id": uid}, {"$unset": {"status": ""}})
            raise HTTPException(status_code=400, detail="Cell already taken.")
        board[cell] = player_side
        winner = _ttt_winner(board)
        result = "ongoing"
        money_won = 0
        cars_won = []
        loot_box_pieces = 0
        if winner:
            result = "win" if winner == player_side else "lose"
            if result == "win":
                money_won, cars_won, loot_box_pieces = await _grant_daily_win_rewards(uid)
            await log_activity(
                uid,
                current_user.get("username") or "?",
                "daily_rewards_ttt",
                {"game": "ttt", "result": result, "money_won": money_won, "cars_won": cars_won, "loot_box_pieces": loot_box_pieces},
            )
            await db.daily_rewards_ttt.delete_one({"user_id": uid})
        else:
            empty = _ttt_empty_cells(board)
            if not empty:
                result = "draw"
                await log_activity(
                    uid,
                    current_user.get("username") or "?",
                    "daily_rewards_ttt",
                    {"game": "ttt", "result": "draw"},
                )
                await db.daily_rewards_ttt.delete_one({"user_id": uid})
            else:
                comp_cell = _ttt_computer_move(board, computer_side)
                if comp_cell >= 0:
                    board[comp_cell] = computer_side
                    winner = _ttt_winner(board)
                    if winner:
                        result = "lose"
                        await log_activity(
                            uid,
                            current_user.get("username") or "?",
                            "daily_rewards_ttt",
                            {"game": "ttt", "result": "lose"},
                        )
                        await db.daily_rewards_ttt.delete_one({"user_id": uid})
                    elif not _ttt_empty_cells(board):
                        result = "draw"
                        await log_activity(
                            uid,
                            current_user.get("username") or "?",
                            "daily_rewards_ttt",
                            {"game": "ttt", "result": "draw"},
                        )
                        await db.daily_rewards_ttt.delete_one({"user_id": uid})
                    else:
                        await db.daily_rewards_ttt.update_one(
                            {"user_id": uid},
                            {"$set": {"board": board, "turn": player_side}, "$unset": {"status": ""}},
                        )
        plays_left, next_play_at = await _get_play_window(uid)
        return {
            "board": board,
            "turn": player_side if result == "ongoing" else None,
            "result": result,
            "money_won": money_won,
            "cars_won": cars_won,
            "loot_box_pieces": loot_box_pieces,
            "plays_left": plays_left,
            "next_play_at": next_play_at,
        }
