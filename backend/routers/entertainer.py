# Entertainer Forum: free entry, random prizes (points/cash/bullets/cars). Dice = one winner; Gbox = everyone gets a random reward.
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import uuid
import random
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import db, get_current_user, send_notification, send_notification_to_all, _is_admin, CARS

# Auto-create runs every 3 hours; open games roll 20 mins before the next batch (so plenty of time to join)
AUTO_CREATE_INTERVAL_SECONDS = 3 * 3600   # 3 hours between batches
ROLL_BEFORE_NEXT_CREATE_SECONDS = 20 * 60  # roll current games 20 mins before next batch
ENTERTAINER_CONFIG_KEY = "entertainer_config"

# Cars that can be won (common/uncommon/rare; exclude custom and exclusive)
E_GAME_CAR_IDS = [c["id"] for c in CARS if c.get("id") not in ("car_custom", "car20") and c.get("rarity") in ("common", "uncommon", "rare")]

REWARD_TYPES = [
    "points",           # 5-50 points
    "cash",             # $100-$2000
    "bullets",          # 1-25 bullets
    "cash_bullets",     # cash + bullets
    "cash_points",      # cash + points
    "bullets_points",   # bullets + points
    "cash_bullets_points",  # all three
    "car",              # 1 random car
    "two_cars",         # 2 random cars
    "car_cash",         # 1 car + cash
]

def _random_cash():
    return random.randint(100, 2000)

def _random_points():
    return random.randint(5, 50)

def _random_bullets():
    return random.randint(1, 25)


async def _give_random_reward(user_id: str) -> dict:
    """Apply a random reward to user. Returns description for result."""
    reward_type = random.choice(REWARD_TYPES)
    desc = {"reward_type": reward_type, "points": 0, "money": 0, "bullets": 0, "cars": []}
    updates = {}
    if reward_type == "points":
        amt = _random_points()
        updates["points"] = amt
        desc["points"] = amt
    elif reward_type == "cash":
        amt = _random_cash()
        updates["money"] = amt
        desc["money"] = amt
    elif reward_type == "bullets":
        amt = _random_bullets()
        updates["bullets"] = amt
        desc["bullets"] = amt
    elif reward_type == "cash_bullets":
        c, b = _random_cash(), _random_bullets()
        updates["money"], updates["bullets"] = c, b
        desc["money"], desc["bullets"] = c, b
    elif reward_type == "cash_points":
        c, p = _random_cash(), _random_points()
        updates["money"], updates["points"] = c, p
        desc["money"], desc["points"] = c, p
    elif reward_type == "bullets_points":
        b, p = _random_bullets(), _random_points()
        updates["bullets"], updates["points"] = b, p
        desc["bullets"], desc["points"] = b, p
    elif reward_type == "cash_bullets_points":
        c, b, p = _random_cash(), _random_bullets(), _random_points()
        updates["money"], updates["bullets"], updates["points"] = c, b, p
        desc["money"], desc["bullets"], desc["points"] = c, b, p
    elif reward_type == "car":
        if E_GAME_CAR_IDS:
            car_id = random.choice(E_GAME_CAR_IDS)
            car = next((c for c in CARS if c.get("id") == car_id), None)
            if car:
                await db.user_cars.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "car_id": car_id,
                    "car_name": car.get("name", car_id),
                    "acquired_at": datetime.now(timezone.utc).isoformat(),
                })
                desc["cars"] = [car.get("name", car_id)]
    elif reward_type == "two_cars":
        if E_GAME_CAR_IDS:
            chosen = random.sample(E_GAME_CAR_IDS, min(2, len(E_GAME_CAR_IDS)))
            for car_id in chosen:
                car = next((c for c in CARS if c.get("id") == car_id), None)
                if car:
                    await db.user_cars.insert_one({
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "car_id": car_id,
                        "car_name": car.get("name", car_id),
                        "acquired_at": datetime.now(timezone.utc).isoformat(),
                    })
                    desc["cars"].append(car.get("name", car_id))
    elif reward_type == "car_cash":
        c = _random_cash()
        updates["money"] = c
        desc["money"] = c
        if E_GAME_CAR_IDS:
            car_id = random.choice(E_GAME_CAR_IDS)
            car = next((c for c in CARS if c.get("id") == car_id), None)
            if car:
                await db.user_cars.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "car_id": car_id,
                    "car_name": car.get("name", car_id),
                    "acquired_at": datetime.now(timezone.utc).isoformat(),
                })
                desc["cars"] = [car.get("name", car_id)]
    if updates:
        inc = {k: v for k, v in updates.items() if v}
        if inc:
            await db.users.update_one({"id": user_id}, {"$inc": inc})
    return desc


def _format_reward_desc(desc: dict) -> str:
    """Turn reward description dict into a short readable string."""
    if not desc:
        return "Nothing"
    parts = []
    if desc.get("money"):
        parts.append(f"${desc['money']:,}")
    if desc.get("points"):
        parts.append(f"{desc['points']} pts")
    if desc.get("bullets"):
        parts.append(f"{desc['bullets']} bullets")
    if desc.get("cars"):
        parts.append(", ".join(desc["cars"]))
    return ", ".join(parts) if parts else "Nothing"


async def _settle_game(game: dict):
    """Run payout (random rewards + pot) and mark game completed. Idempotent if already completed."""
    if game.get("status") == "completed":
        return
    participants = game.get("participants") or []
    now = datetime.now(timezone.utc).isoformat()
    result = None
    if participants:
        if game.get("game_type") == "dice":
            result = await _run_dice_payout(game)
        else:
            result = await _run_gbox_payout(game)
    pot = int(game.get("pot") or 0)
    if pot > 0 and participants:
        if game.get("game_type") == "dice" and result and result.get("winner_id"):
            await db.users.update_one({"id": result["winner_id"]}, {"$inc": {"money": pot}})
        elif game.get("game_type") == "gbox":
            n = len(participants)
            each = pot // n
            remainder = pot - (each * n)
            for i, p in enumerate(participants):
                uid = p.get("user_id")
                if uid:
                    amt = each + (remainder if i == 0 else 0)
                    if amt > 0:
                        await db.users.update_one({"id": uid}, {"$inc": {"money": amt}})
    await db.entertainer_games.update_one(
        {"id": game["id"]},
        {"$set": {"status": "completed", "completed_at": now, "result": result}},
    )
    # Notify each participant with their winnings
    if result and participants:
        game_type = game.get("game_type") or "dice"
        pot = game.get("pot") or 0
        for p in participants:
            uid = p.get("user_id")
            if not uid:
                continue
            try:
                if game_type == "dice":
                    winner_id = (result or {}).get("winner_id")
                    reward = (result or {}).get("reward")
                    if uid == winner_id and reward:
                        msg = f"You won! Winnings: {_format_reward_desc(reward)}. Pot was ${pot:,}."
                    else:
                        winner_name = (result or {}).get("winner_username") or "Someone"
                        msg = f"Game over. Winner: {winner_name}. Pot was ${pot:,}. Better luck next time!"
                    await send_notification(uid, "🎲 E-Game results", msg, "system", category="ent_games")
                else:
                    # gbox: each player got a reward
                    rewards = (result or {}).get("rewards_by_user") or {}
                    reward = rewards.get(uid)
                    if reward:
                        msg = f"You won: {_format_reward_desc(reward)}. Pot was ${pot:,}."
                    else:
                        msg = f"Game over. Pot was ${pot:,}."
                    await send_notification(uid, "🎁 E-Game results", msg, "system", category="ent_games")
            except Exception:
                pass


class CreateGameRequest(BaseModel):
    game_type: str  # "dice" | "gbox"
    max_players: int = 10
    join_fee: int = 0  # entry fee per player (added to pot when they join)
    pot: int = 0  # creator-funded pot (deducted from creator on create)
    manual_roll: bool = False  # if True, creator rolls when ready (no auto-settle by time)
    topic_id: Optional[str] = None  # optional; when created from a topic


async def _run_dice_payout(game: dict):
    """One winner by roll; winner gets a random reward (points/cash/bullets/cars)."""
    participants = game.get("participants") or []
    if not participants:
        return None
    n = len(participants)
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
    winner_username = next((a["username"] for a in assignments if a["user_id"] == winner_id), None)
    reward = None
    if winner_id:
        reward = await _give_random_reward(winner_id)
    return {"assignments": assignments, "roll": roll, "winner_id": winner_id, "winner_username": winner_username, "reward": reward}


async def _run_gbox_payout(game: dict):
    """Each participant gets a random reward (points/cash/bullets/cars)."""
    participants = game.get("participants") or []
    if not participants:
        return None
    rewards_by_user = {}
    for p in participants:
        uid = p.get("user_id")
        if uid:
            rewards_by_user[uid] = await _give_random_reward(uid)
    return {"rewards_by_user": rewards_by_user}


def _parse_iso(iso_str):
    if not iso_str:
        return None
    try:
        return datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


async def _maybe_auto_settle_open_games():
    """Settle all open (non-manual) games when we're in the '20 mins before next batch' window."""
    doc = await db.game_config.find_one({"key": ENTERTAINER_CONFIG_KEY}, {"last_auto_create_at": 1})
    last_at = _parse_iso(doc.get("last_auto_create_at") if doc else None)
    if not last_at:
        return
    next_create = last_at + timedelta(seconds=AUTO_CREATE_INTERVAL_SECONDS)
    roll_at = next_create - timedelta(seconds=ROLL_BEFORE_NEXT_CREATE_SECONDS)
    now = datetime.now(timezone.utc)
    if now < roll_at:
        return
    open_games = await db.entertainer_games.find(
        {"status": "open", "manual_roll": {"$ne": True}},
        {"_id": 0},
    ).to_list(50)
    for g in open_games:
        await _settle_game(g)


async def settle_open_games_now():
    """Settle all open non-manual games (called by server task 20 mins before next batch)."""
    open_games = await db.entertainer_games.find(
        {"status": "open", "manual_roll": {"$ne": True}},
        {"_id": 0},
    ).to_list(50)
    for g in open_games:
        await _settle_game(g)


async def get_prizes(current_user: dict = Depends(get_current_user)):
    """Return possible prizes for E-Games (for display: cash/points/bullets ranges and cars that can be won)."""
    prize_cars = [
        {"name": c.get("name", c["id"]), "rarity": c.get("rarity", "common")}
        for c in CARS
        if c.get("id") not in ("car_custom", "car20") and c.get("rarity") in ("common", "uncommon", "rare")
    ]
    return {
        "cash": {"min": 100, "max": 2000},
        "points": {"min": 5, "max": 50},
        "bullets": {"min": 1, "max": 25},
        "cars": prize_cars,
    }


async def list_games(
    game_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """List entertainer games (open + recent completed). Auto-settles open games when 20 mins before next batch."""
    await _maybe_auto_settle_open_games()
    query = {}
    if game_type and game_type in ("dice", "gbox"):
        query["game_type"] = game_type
    if status and status in ("open", "full", "completed"):
        query["status"] = status
    games = await db.entertainer_games.find(query, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"games": games}


async def games_history(current_user: dict = Depends(get_current_user)):
    """Last 10 completed games with pot and winners for the entertainer forum."""
    games = await db.entertainer_games.find(
        {"status": "completed"},
        {"_id": 0, "id": 1, "game_type": 1, "pot": 1, "completed_at": 1, "result": 1, "participants": 1},
    ).sort("completed_at", -1).limit(10).to_list(10)
    out = []
    for g in games:
        r = g.get("result") or {}
        pot = g.get("pot") or 0
        if g.get("game_type") == "dice":
            winner = r.get("winner_username") or "—"
            reward = r.get("reward")
            reward_text = _format_reward_desc(reward) if reward else None
            out.append({
                "id": g["id"], "game_type": "dice", "pot": pot, "completed_at": g.get("completed_at"),
                "winner": winner, "reward_text": reward_text,
            })
        else:
            rewards = r.get("rewards_by_user") or {}
            participants = g.get("participants") or []
            winner_names = [p.get("username") or "?" for p in participants if p.get("user_id") in rewards]
            # Per-player reward summary for display (e.g. "Bob: $500, 10 pts")
            reward_summaries = []
            for p in participants:
                uid, name = p.get("user_id"), p.get("username") or "?"
                if uid in rewards:
                    reward_summaries.append(f"{name}: {_format_reward_desc(rewards[uid])}")
            out.append({
                "id": g["id"], "game_type": "gbox", "pot": pot, "completed_at": g.get("completed_at"),
                "winners": winner_names, "reward_text": ", ".join(reward_summaries) if reward_summaries else None,
            })
    return {"games": out}


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
    """Create a dice or gbox game. Admins can only create manual-roll games (auto games use admin auto-create)."""
    if _is_admin(current_user) and not bool(request.manual_roll):
        raise HTTPException(status_code=403, detail="Admins can only create manual-roll games here. Use admin auto-create for system games.")
    if request.game_type not in ("dice", "gbox"):
        raise HTTPException(status_code=400, detail="game_type must be dice or gbox")
    max_players = max(1, min(10, request.max_players))
    join_fee = max(0, int(request.join_fee or 0))
    pot = max(0, int(request.pot or 0))
    if pot > 0:
        user_money = int(current_user.get("money") or 0)
        if user_money < pot:
            raise HTTPException(status_code=400, detail=f"You need ${pot:,} to fund the pot (you have ${user_money:,})")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -pot}})
    game_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    participants = []
    manual_roll = bool(request.manual_roll)
    topic_id = (request.topic_id or "").strip() or None
    doc = {
        "id": game_id,
        "game_type": request.game_type,
        "max_players": max_players,
        "join_fee": join_fee,
        "pot": pot,
        "creator_id": current_user["id"],
        "creator_username": current_user.get("username") or "?",
        "participants": participants,
        "status": "open",
        "created_at": now,
        "completed_at": None,
        "result": None,
        "manual_roll": manual_roll,
        "topic_id": topic_id,
    }
    await db.entertainer_games.insert_one(doc)
    return {"id": game_id, "message": "Game created", "game": {**doc, "participants": participants}}


async def join_game(game_id: str, current_user: dict = Depends(get_current_user)):
    """Join an open game. Pay join_fee if set (added to pot). If full after join, run payout automatically."""
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("status") != "open":
        raise HTTPException(status_code=400, detail="Game is not open to join")
    participants = game.get("participants") or []
    if any(p.get("user_id") == current_user["id"] for p in participants):
        raise HTTPException(status_code=400, detail="Already in this game")
    max_players = game.get("max_players", 10)
    if len(participants) >= max_players:
        raise HTTPException(status_code=400, detail="Game is full")
    join_fee = int(game.get("join_fee") or 0)
    if join_fee > 0:
        user_money = int(current_user.get("money") or 0)
        if user_money < join_fee:
            raise HTTPException(status_code=400, detail=f"Entry fee is ${join_fee:,} (you have ${user_money:,})")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -join_fee}})
    new_participants = participants + [{"user_id": current_user["id"], "username": current_user.get("username") or "?"}]
    is_full = len(new_participants) >= max_players
    current_pot = int(game.get("pot") or 0) + join_fee
    updates = {
        "participants": new_participants,
        "pot": current_pot,
        "status": "full" if is_full else "open",
    }
    if is_full:
        now = datetime.now(timezone.utc).isoformat()
        updates["completed_at"] = now
        updated_game = {**game, "participants": new_participants, "pot": current_pot}
        if game.get("game_type") == "dice":
            res = await _run_dice_payout(updated_game)
            updates["result"] = res
        else:
            res = await _run_gbox_payout(updated_game)
            updates["result"] = res
        updates["status"] = "completed"
    await db.entertainer_games.update_one({"id": game_id}, {"$set": updates})
    updated = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    return {"message": "Joined game" + (" — rewards rolled!" if is_full else ""), "game": updated}


# ---------- Manual roll: admin or creator (for manual_roll games) ----------
async def admin_roll_game(game_id: str, current_user: dict = Depends(get_current_user)):
    """Force settle (roll) an open game now. Admin can always roll; creator can roll if game is manual_roll."""
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Game already completed")
    is_admin = _is_admin(current_user)
    is_creator = game.get("creator_id") == current_user["id"] and game.get("creator_id") != "system"
    if not is_admin and not (is_creator and game.get("manual_roll")):
        raise HTTPException(status_code=403, detail="Only the game creator can roll manual games; admins can roll any game.")
    await _settle_game(game)
    updated = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    return {"message": "Game rolled", "game": updated}


# ---------- Admin: entertainer config (auto-create on/off) ----------
async def get_entertainer_config(current_user: dict = Depends(get_current_user)):
    """Get entertainer config (auto_create_enabled, last/next run). Anyone can read."""
    doc = await db.game_config.find_one({"key": ENTERTAINER_CONFIG_KEY}, {"_id": 0, "key": 0})
    if not doc:
        return {"auto_create_enabled": False, "last_auto_create_at": None, "next_auto_create_at": None}
    last_at = doc.get("last_auto_create_at")
    next_at = None
    if last_at:
        last_dt = _parse_iso(last_at)
        if last_dt:
            next_dt = last_dt + timedelta(seconds=AUTO_CREATE_INTERVAL_SECONDS)
            next_at = next_dt.isoformat()
    return {
        "auto_create_enabled": doc.get("auto_create_enabled", False),
        "last_auto_create_at": last_at,
        "next_auto_create_at": next_at,
    }


class EntertainerConfigUpdate(BaseModel):
    auto_create_enabled: bool


async def update_entertainer_config(
    body: EntertainerConfigUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Admin only: enable/disable auto-create games every 3 hours."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    await db.game_config.update_one(
        {"key": ENTERTAINER_CONFIG_KEY},
        {"$set": {"key": ENTERTAINER_CONFIG_KEY, "auto_create_enabled": body.auto_create_enabled}},
        upsert=True,
    )
    return {"auto_create_enabled": body.auto_create_enabled}


# ---------- Admin: create 3–5 system games now and notify all ----------
async def _create_system_game(game_type: str, max_players: int) -> dict:
    """Create one open game with no creator (system). Free to join; winnings are random (points, cash, bullets, cars)."""
    game_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": game_id,
        "game_type": game_type,
        "max_players": max_players,
        "join_fee": 0,
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
    created = []
    for _ in range(n):
        game_type = random.choice(["dice", "gbox"])
        max_players = random.randint(2, 10)
        g = await _create_system_game(game_type, max_players)
        created.append(g)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.game_config.update_one(
        {"key": ENTERTAINER_CONFIG_KEY},
        {"$set": {"key": ENTERTAINER_CONFIG_KEY, "last_auto_create_at": now_iso}},
        upsert=True,
    )
    try:
        await send_notification_to_all(
            "🎲 New E-Games",
            f"{len(created)} new dice & gbox games are open in the Entertainer Forum! Join now.",
            "system",
            category="ent_games",
        )
    except Exception:
        pass  # Don't fail the request if notification fails; games were already created
    return {"message": f"Created {len(created)} games", "count": len(created), "games": created}


async def run_auto_create_if_enabled():
    """Called by scheduled task every 3h: if auto_create_enabled, create 3–5 games and notify."""
    doc = await db.game_config.find_one({"key": ENTERTAINER_CONFIG_KEY}, {"_id": 0})
    if not doc or not doc.get("auto_create_enabled"):
        return
    n = random.randint(3, 5)
    for _ in range(n):
        game_type = random.choice(["dice", "gbox"])
        max_players = random.randint(2, 10)
        await _create_system_game(game_type, max_players)
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
        category="ent_games",
    )


def register(router):
    router.add_api_route("/forum/entertainer/prizes", get_prizes, methods=["GET"])
    router.add_api_route("/forum/entertainer/games", list_games, methods=["GET"])
    router.add_api_route("/forum/entertainer/games", create_game, methods=["POST"])
    router.add_api_route("/forum/entertainer/games/history", games_history, methods=["GET"])
    router.add_api_route("/forum/entertainer/games/{game_id}", get_game, methods=["GET"])
    router.add_api_route("/forum/entertainer/games/{game_id}/join", join_game, methods=["POST"])
    router.add_api_route("/forum/entertainer/games/{game_id}/roll", admin_roll_game, methods=["POST"])
    router.add_api_route("/forum/entertainer/admin/config", get_entertainer_config, methods=["GET"])
    router.add_api_route("/forum/entertainer/admin/config", update_entertainer_config, methods=["PATCH"])
    router.add_api_route("/forum/entertainer/admin/auto-create", admin_auto_create_now, methods=["POST"])