# Entertainer Forum: auto dice games and gbox (1–10 players, auto roll/split on full or after 60s)
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import uuid
import random
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import db, get_current_user, send_notification_to_all, _is_admin

AUTO_ROLL_AFTER_SECONDS = 60
ENTERTAINER_CONFIG_KEY = "entertainer_config"


class CreateGameRequest(BaseModel):
    game_type: str  # "dice" | "gbox"
    max_players: int = 10
    join_fee: int = 0


async def _run_dice_payout(game: dict):
    """Each player is assigned a number 1–N. One roll (1–N): that number wins the whole pot. No re-roll, no tie."""
    participants = game.get("participants") or []
    if not participants:
        return
    pot = game.get("pot", 0)
    n = len(participants)
    # Assign each player a unique number 1..n (shuffle then assign)
    order = list(participants)
    random.shuffle(order)
    number_to_uid = {}
    assignments = []
    for i, p in enumerate(order):
        num = i + 1
        uid = p.get("user_id")
        if uid:
            number_to_uid[num] = uid
            assignments.append({"user_id": uid, "username": p.get("username"), "number": num})
    roll = random.randint(1, n)
    winner_id = number_to_uid.get(roll)
    if winner_id and pot > 0:
        await db.users.update_one({"id": winner_id}, {"$inc": {"money": pot}})
    winner_username = next((a["username"] for a in assignments if a["user_id"] == winner_id), None)
    return {"assignments": assignments, "roll": roll, "winner_id": winner_id, "winner_username": winner_username}


async def _run_gbox_payout(game: dict):
    """Split the pot between everyone with random shares (random % each, not equal)."""
    participants = game.get("participants") or []
    if not participants:
        return
    pot = game.get("pot", 0)
    n = len(participants)
    # Random positive weights, normalize to sum to 1
    weights = [random.random() + 0.01 for _ in range(n)]
    total = sum(weights)
    shares = [w / total for w in weights]
    for i, p in enumerate(participants):
        uid = p.get("user_id")
        if uid:
            amount = int(round(pot * shares[i]))
            if amount > 0:
                await db.users.update_one({"id": uid}, {"$inc": {"money": amount}})
    # Remainder from rounding goes to first participant
    paid = sum(int(round(pot * s)) for s in shares)
    remainder = pot - paid
    if remainder > 0 and participants:
        uid = participants[0].get("user_id")
        if uid:
            await db.users.update_one({"id": uid}, {"$inc": {"money": remainder}})
    percent_per_user = [round(100 * s, 1) for s in shares]
    return {"percent_per_player": dict(zip([p.get("user_id") for p in participants], percent_per_user))}


async def _settle_game(game: dict):
    """Run payout and mark game completed. Idempotent if already completed."""
    if game.get("status") == "completed":
        return
    participants = game.get("participants") or []
    now = datetime.now(timezone.utc).isoformat()
    result = None
    if participants and game.get("pot", 0) >= 0:
        if game.get("game_type") == "dice":
            result = await _run_dice_payout(game)
        else:
            result = await _run_gbox_payout(game)
    await db.entertainer_games.update_one(
        {"id": game["id"]},
        {"$set": {"status": "completed", "completed_at": now, "result": result}},
    )


async def _maybe_auto_settle_open_games():
    """Settle any open game older than AUTO_ROLL_AFTER_SECONDS."""
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=AUTO_ROLL_AFTER_SECONDS)).isoformat()
    open_old = await db.entertainer_games.find(
        {"status": "open", "created_at": {"$lt": cutoff}},
        {"_id": 0},
    ).to_list(50)
    for g in open_old:
        await _settle_game(g)


async def list_games(
    game_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """List entertainer games (open + recent completed). Auto-settles open games older than 60s."""
    await _maybe_auto_settle_open_games()
    query = {}
    if game_type and game_type in ("dice", "gbox"):
        query["game_type"] = game_type
    if status and status in ("open", "full", "completed"):
        query["status"] = status
    games = await db.entertainer_games.find(query, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"games": games, "auto_roll_after_seconds": AUTO_ROLL_AFTER_SECONDS}


async def get_game(game_id: str, current_user: dict = Depends(get_current_user)):
    """Get one game by id."""
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return {"game": game}


async def create_game(
    request: CreateGameRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create a dice or gbox game. Creator joins as first participant and pays join_fee."""
    if request.game_type not in ("dice", "gbox"):
        raise HTTPException(status_code=400, detail="game_type must be dice or gbox")
    max_players = max(1, min(10, request.max_players))
    join_fee = max(0, request.join_fee)
    user_money = int(current_user.get("money") or 0)
    if join_fee > user_money:
        raise HTTPException(status_code=400, detail="Insufficient cash for join fee")
    game_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    participants = [{"user_id": current_user["id"], "username": current_user.get("username") or "?"}]
    doc = {
        "id": game_id,
        "game_type": request.game_type,
        "max_players": max_players,
        "join_fee": join_fee,
        "pot": join_fee,
        "creator_id": current_user["id"],
        "creator_username": current_user.get("username") or "?",
        "participants": participants,
        "status": "full" if max_players == 1 else "open",
        "created_at": now,
        "completed_at": None,
        "result": None,
    }
    await db.entertainer_games.insert_one(doc)
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -join_fee}})
    if max_players == 1:
        doc["status"] = "completed"
        doc["completed_at"] = now
        if request.game_type == "dice":
            res = await _run_dice_payout(doc)
            doc["result"] = res
        else:
            res = await _run_gbox_payout(doc)
            doc["result"] = res
        await db.entertainer_games.update_one(
            {"id": game_id},
            {"$set": {"status": "completed", "completed_at": now, "result": doc.get("result")}},
        )
    return {"id": game_id, "message": "Game created", "game": {**doc, "participants": participants}}


async def join_game(game_id: str, current_user: dict = Depends(get_current_user)):
    """Join an open game. Pay join_fee. If full after join, run payout automatically."""
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("status") != "open":
        raise HTTPException(status_code=400, detail="Game is not open to join")
    join_fee = game.get("join_fee", 0)
    user_money = int(current_user.get("money") or 0)
    if join_fee > user_money:
        raise HTTPException(status_code=400, detail="Insufficient cash for join fee")
    participants = game.get("participants") or []
    if any(p.get("user_id") == current_user["id"] for p in participants):
        raise HTTPException(status_code=400, detail="Already in this game")
    max_players = game.get("max_players", 10)
    if len(participants) >= max_players:
        raise HTTPException(status_code=400, detail="Game is full")
    new_participants = participants + [{"user_id": current_user["id"], "username": current_user.get("username") or "?"}]
    new_pot = game.get("pot", 0) + join_fee
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -join_fee}})
    is_full = len(new_participants) >= max_players
    updates = {
        "participants": new_participants,
        "pot": new_pot,
        "status": "full" if is_full else "open",
    }
    if is_full:
        now = datetime.now(timezone.utc).isoformat()
        updates["completed_at"] = now
        updated_game = {**game, **updates}
        if game.get("game_type") == "dice":
            res = await _run_dice_payout(updated_game)
            updates["result"] = res
        else:
            res = await _run_gbox_payout(updated_game)
            updates["result"] = res
        updates["status"] = "completed"
    await db.entertainer_games.update_one({"id": game_id}, {"$set": updates})
    updated = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    return {"message": "Joined game" + (" — game full, payout done!" if is_full else ""), "game": updated}


# ---------- Admin: manual roll ----------
async def admin_roll_game(game_id: str, current_user: dict = Depends(get_current_user)):
    """Admin only: force settle (roll) an open game now."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Game already completed")
    await _settle_game(game)
    updated = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    return {"message": "Game rolled", "game": updated}


# ---------- Admin: entertainer config (auto-create on/off) ----------
async def get_entertainer_config(current_user: dict = Depends(get_current_user)):
    """Get entertainer config (auto_create_enabled). Admin only for write; anyone can read."""
    doc = await db.game_config.find_one({"key": ENTERTAINER_CONFIG_KEY}, {"_id": 0, "key": 0})
    if not doc:
        return {"auto_create_enabled": False, "last_auto_create_at": None}
    return {"auto_create_enabled": doc.get("auto_create_enabled", False), "last_auto_create_at": doc.get("last_auto_create_at")}


class EntertainerConfigUpdate(BaseModel):
    auto_create_enabled: bool


async def update_entertainer_config(
    body: EntertainerConfigUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Admin only: enable/disable auto-create games every hour."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    await db.game_config.update_one(
        {"key": ENTERTAINER_CONFIG_KEY},
        {"$set": {"key": ENTERTAINER_CONFIG_KEY, "auto_create_enabled": body.auto_create_enabled}},
        upsert=True,
    )
    return {"auto_create_enabled": body.auto_create_enabled}


# ---------- Admin: create 3–5 system games now and notify all ----------
async def _create_system_game(game_type: str, max_players: int, join_fee: int) -> dict:
    """Create one open game with no creator (system). Participants join and pay."""
    game_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": game_id,
        "game_type": game_type,
        "max_players": max_players,
        "join_fee": join_fee,
        "pot": 0,
        "creator_id": "system",
        "creator_username": "System",
        "participants": [],
        "status": "open",
        "created_at": now,
        "completed_at": None,
        "result": None,
    }
    await db.entertainer_games.insert_one(doc)
    return doc


async def admin_auto_create_now(current_user: dict = Depends(get_current_user)):
    """Admin only: create 3–5 system games now and send notification to all users."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    n = random.randint(3, 5)
    join_fee_options = [0, 100, 250, 500, 1000, 2500]
    created = []
    for _ in range(n):
        game_type = random.choice(["dice", "gbox"])
        max_players = random.randint(2, 10)
        join_fee = random.choice(join_fee_options)
        g = await _create_system_game(game_type, max_players, join_fee)
        created.append(g)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.game_config.update_one(
        {"key": ENTERTAINER_CONFIG_KEY},
        {"$set": {"key": ENTERTAINER_CONFIG_KEY, "last_auto_create_at": now_iso}},
        upsert=True,
    )
    await send_notification_to_all(
        "🎲 New E-Games",
        f"{len(created)} new dice & gbox games are open in the Entertainer Forum! Join now.",
        "system",
    )
    return {"message": f"Created {len(created)} games", "count": len(created), "games": created}


async def run_auto_create_if_enabled():
    """Called by hourly task: if auto_create_enabled, create 3–5 games and notify."""
    doc = await db.game_config.find_one({"key": ENTERTAINER_CONFIG_KEY}, {"_id": 0})
    if not doc or not doc.get("auto_create_enabled"):
        return
    n = random.randint(3, 5)
    join_fee_options = [0, 100, 250, 500, 1000, 2500]
    for _ in range(n):
        game_type = random.choice(["dice", "gbox"])
        max_players = random.randint(2, 10)
        join_fee = random.choice(join_fee_options)
        await _create_system_game(game_type, max_players, join_fee)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.game_config.update_one(
        {"key": ENTERTAINER_CONFIG_KEY},
        {"$set": {"key": ENTERTAINER_CONFIG_KEY, "last_auto_create_at": now_iso}},
        upsert=True,
    )
    await send_notification_to_all(
        "🎲 New E-Games",
        f"{n} new dice & gbox games are open in the Entertainer Forum! Join now.",
        "system",
    )


def register(router):
    router.add_api_route("/forum/entertainer/games", list_games, methods=["GET"])
    router.add_api_route("/forum/entertainer/games", create_game, methods=["POST"])
    router.add_api_route("/forum/entertainer/games/{game_id}", get_game, methods=["GET"])
    router.add_api_route("/forum/entertainer/games/{game_id}/join", join_game, methods=["POST"])
    router.add_api_route("/forum/entertainer/games/{game_id}/roll", admin_roll_game, methods=["POST"])
    router.add_api_route("/forum/entertainer/admin/config", get_entertainer_config, methods=["GET"])
    router.add_api_route("/forum/entertainer/admin/config", update_entertainer_config, methods=["PATCH"])
    router.add_api_route("/forum/entertainer/admin/auto-create", admin_auto_create_now, methods=["POST"])