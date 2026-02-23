# Casino MDG (Pot Game): create game (fee points/money/both), join, list; one winner takes pot; auto-roll when N spots filled
from datetime import datetime, timezone
from typing import Optional
import random
import uuid

from pydantic import BaseModel
from fastapi import Depends, HTTPException

from server import db, get_current_user, send_notification

MDG_MIN_PLAYERS = 2
MDG_MAX_PLAYERS = 100
MDG_MAX_FEE_POINTS = 100_000_000
MDG_MAX_FEE_MONEY = 1_000_000_000
MDG_MAX_EXTRA_POT_POINTS = 100_000_000
MDG_MAX_EXTRA_POT_MONEY = 1_000_000_000


class MDGCreateRequest(BaseModel):
    fee_points: int = 0
    fee_money: float = 0
    max_players: int = 10
    auto_roll_at: Optional[int] = None  # when this many spots filled, auto roll; null = manual only (or when max_players)
    extra_pot_points: int = 0
    extra_pot_money: float = 0


class MDGJoinRequest(BaseModel):
    game_id: str


class MDGRollRequest(BaseModel):
    game_id: str


def register(router):
    @router.get("/casino/mdg/games")
    async def mdg_list_games(current_user: dict = Depends(get_current_user)):
        """List open MDG games (joinable)."""
        cursor = db.mdg_games.find(
            {"status": "open"},
            {"_id": 0, "id": 1, "created_by": 1, "created_by_username": 1, "created_at": 1, "fee_points": 1, "fee_money": 1, "max_players": 1, "auto_roll_at": 1, "extra_pot_points": 1, "extra_pot_money": 1, "entries": 1, "pot_points": 1, "pot_money": 1, "status": 1},
        ).sort("created_at", -1)
        games = await cursor.to_list(100)
        return {"games": games}

    @router.post("/casino/mdg/create")
    async def mdg_create(request: MDGCreateRequest, current_user: dict = Depends(get_current_user)):
        """Create a new MDG. Fee and extra pot can be points, money, or both. At least one of fee_points or fee_money must be > 0."""
        fee_pts = max(0, int(request.fee_points or 0))
        fee_money = max(0.0, float(request.fee_money or 0))
        if fee_pts <= 0 and fee_money <= 0:
            raise HTTPException(status_code=400, detail="Set a fee: points and/or money must be greater than 0")
        if fee_pts > MDG_MAX_FEE_POINTS or fee_money > MDG_MAX_FEE_MONEY:
            raise HTTPException(status_code=400, detail="Fee exceeds maximum allowed")
        max_players = max(MDG_MIN_PLAYERS, min(MDG_MAX_PLAYERS, int(request.max_players or 10)))
        auto_roll_at = None
        if request.auto_roll_at is not None:
            auto_roll_at = max(MDG_MIN_PLAYERS, min(max_players, int(request.auto_roll_at)))
        extra_pts = max(0, int(request.extra_pot_points or 0))
        extra_money = max(0.0, float(request.extra_pot_money or 0))
        if extra_pts > MDG_MAX_EXTRA_POT_POINTS or extra_money > MDG_MAX_EXTRA_POT_MONEY:
            raise HTTPException(status_code=400, detail="Extra pot exceeds maximum allowed")

        game_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": game_id,
            "created_by": current_user["id"],
            "created_by_username": current_user.get("username") or "?",
            "created_at": now_iso,
            "fee_points": fee_pts,
            "fee_money": fee_money,
            "max_players": max_players,
            "auto_roll_at": auto_roll_at,
            "extra_pot_points": extra_pts,
            "extra_pot_money": extra_money,
            "entries": [],
            "pot_points": extra_pts,
            "pot_money": extra_money,
            "status": "open",
            "winner_id": None,
            "winner_username": None,
            "rolled_at": None,
        }
        await db.mdg_games.insert_one(doc)
        return {"message": "Game created", "game_id": game_id, "game": {k: v for k, v in doc.items() if k != "_id"}}

    @router.post("/casino/mdg/join")
    async def mdg_join(request: MDGJoinRequest, current_user: dict = Depends(get_current_user)):
        """Join an open game. Pay fee (points/money); if auto_roll_at is reached, roll runs and one winner takes the pot."""
        game = await db.mdg_games.find_one({"id": request.game_id, "status": "open"}, {"_id": 0})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found or already closed")
        uid = current_user["id"]
        if any(e.get("user_id") == uid for e in game.get("entries") or []):
            raise HTTPException(status_code=400, detail="You are already in this game")
        fee_pts = int(game.get("fee_points") or 0)
        fee_money = float(game.get("fee_money") or 0)
        max_players = int(game.get("max_players") or 10)
        entries = list(game.get("entries") or [])
        if len(entries) >= max_players:
            raise HTTPException(status_code=400, detail="Game is full")

        user = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1, "money": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=400, detail="User not found")
        points = int(user.get("points") or 0)
        money = float(user.get("money") or 0)
        if fee_pts > points:
            raise HTTPException(status_code=400, detail="Insufficient points")
        if fee_money > money:
            raise HTTPException(status_code=400, detail="Insufficient money")

        entry = {"user_id": uid, "username": user.get("username") or "?", "paid_points": fee_pts, "paid_money": fee_money}
        new_entries = entries + [entry]
        new_pot_pts = int(game.get("pot_points") or 0) + fee_pts
        new_pot_money = float(game.get("pot_money") or 0) + fee_money

        # Deduct from user
        if fee_pts:
            await db.users.update_one({"id": uid}, {"$inc": {"points": -fee_pts}})
        if fee_money:
            await db.users.update_one({"id": uid}, {"$inc": {"money": -fee_money}})

        # Update game
        await db.mdg_games.update_one(
            {"id": request.game_id, "status": "open"},
            {"$set": {"entries": new_entries, "pot_points": new_pot_pts, "pot_money": new_pot_money}},
        )

        # Auto-roll if threshold reached
        auto_roll_at = game.get("auto_roll_at")
        should_roll = (auto_roll_at is not None and len(new_entries) >= auto_roll_at) or len(new_entries) >= max_players
        if should_roll and len(new_entries) >= MDG_MIN_PLAYERS:
            winner_entry = random.choice(new_entries)
            winner_id = winner_entry["user_id"]
            await db.users.update_one(
                {"id": winner_id},
                {"$inc": {"points": new_pot_pts, "money": new_pot_money}},
            )
            winner_user = await db.users.find_one({"id": winner_id}, {"_id": 0, "username": 1})
            winner_username = (winner_user and winner_user.get("username")) or winner_entry.get("username") or "?"
            now_iso = datetime.now(timezone.utc).isoformat()
            await db.mdg_games.update_one(
                {"id": request.game_id},
                {"$set": {"status": "completed", "winner_id": winner_id, "winner_username": winner_username, "rolled_at": now_iso}},
            )
            await send_notification(winner_id, "🎲 MDG Won", f"You won the pot: {new_pot_pts} pts, ${new_pot_money:,.0f}", "reward")
            return {"message": "Joined; game rolled. One winner takes the pot.", "winner_id": winner_id, "winner_username": winner_username, "pot_points": new_pot_pts, "pot_money": new_pot_money}

        return {"message": "Joined", "players": len(new_entries), "pot_points": new_pot_pts, "pot_money": new_pot_money}

    @router.post("/casino/mdg/roll")
    async def mdg_roll(request: MDGRollRequest, current_user: dict = Depends(get_current_user)):
        """Manually roll an open game (creator only). One random winner takes the pot. Requires at least 2 players."""
        game = await db.mdg_games.find_one({"id": request.game_id, "status": "open"}, {"_id": 0})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found or already closed")
        if game.get("created_by") != current_user["id"]:
            raise HTTPException(status_code=403, detail="Only the game creator can roll")
        entries = list(game.get("entries") or [])
        if len(entries) < MDG_MIN_PLAYERS:
            raise HTTPException(status_code=400, detail="Need at least 2 players to roll")

        winner_entry = random.choice(entries)
        winner_id = winner_entry["user_id"]
        pot_pts = int(game.get("pot_points") or 0)
        pot_money = float(game.get("pot_money") or 0)
        await db.users.update_one({"id": winner_id}, {"$inc": {"points": pot_pts, "money": pot_money}})
        winner_user = await db.users.find_one({"id": winner_id}, {"_id": 0, "username": 1})
        winner_username = (winner_user and winner_user.get("username")) or winner_entry.get("username") or "?"
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.mdg_games.update_one(
            {"id": request.game_id},
            {"$set": {"status": "completed", "winner_id": winner_id, "winner_username": winner_username, "rolled_at": now_iso}},
        )
        await send_notification(winner_id, "🎲 MDG Won", f"You won the pot: {pot_pts} pts, ${pot_money:,.0f}", "reward")
        return {"message": "Roll complete. One winner takes the pot.", "winner_id": winner_id, "winner_username": winner_username, "pot_points": pot_pts, "pot_money": pot_money}
