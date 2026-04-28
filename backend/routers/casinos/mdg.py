# Casino MDG (Pot Game): create game (fee points/money/both), join, list; one winner takes pot; auto-roll when N spots filled
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
import asyncio
import logging
import math
import secrets
_rng = secrets.SystemRandom()
import uuid

from bson import ObjectId
from pydantic import BaseModel
from fastapi import Depends, HTTPException

from utils.point_provenance import log_points_event

from server import db, get_current_user, get_current_user_verified, send_notification, log_gambling, _is_admin, _is_moderator, _is_entertainer
from utils.entertainer_service import (
    ENTERTAINER_MDG_MAX_POINTS_PER_GAME,
    try_debit_entertainer_fund,
    insert_funded_game_row,
    on_funded_game_completed,
)

MDG_MIN_PLAYERS = 2
MDG_MAX_PLAYERS = 100
ENTERTAINER_MDG_MIN_MAX_PLAYERS = 4  # entertainer-created tables must seat at least this many
MDG_MAX_OPEN_GAMES_PER_USER = 3
MDG_MAX_FEE_POINTS = 100_000_000
MDG_MAX_FEE_MONEY = 1_000_000_000
MDG_MAX_EXTRA_POT_POINTS = 100_000_000
MDG_MAX_EXTRA_POT_MONEY = 1_000_000_000

# ── Automated MDG constants ──
AUTO_MDG_CYCLE_HOURS = 3
AUTO_MDG_GAMES_PER_CYCLE = 3
AUTO_MDG_POT_MIN = 5_000_000
AUTO_MDG_POT_MAX = 25_000_000
AUTO_MDG_MAX_PLAYERS = 10
AUTO_MDG_EARLY_ROLL_MINUTES = 10

_logger = logging.getLogger(__name__)


def _mdg_sanitize_for_json(obj: Any) -> Any:
    """Strip Mongo `_id` keys and BSON ObjectIds so FastAPI can JSON-encode responses (nested `entries`, etc.)."""
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, dict):
        return {k: _mdg_sanitize_for_json(v) for k, v in obj.items() if k != "_id"}
    if isinstance(obj, list):
        return [_mdg_sanitize_for_json(x) for x in obj]
    return obj


def _mdg_roll_pool(entries: list) -> list:
    """Ordered list of entrants used for winner selection — every player who paid has one equal slot."""
    return list(entries or [])


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


# ── Automated MDG helpers (module-level so ticker can call them) ──

def _next_cycle_boundary(now: datetime) -> datetime:
    """Return the next 3h UTC boundary (00:00, 03:00, 06:00 ... 21:00)."""
    h = now.hour
    next_h = (math.ceil((h + 1) / AUTO_MDG_CYCLE_HOURS)) * AUTO_MDG_CYCLE_HOURS
    if next_h > 23:
        base = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        base = now.replace(hour=next_h, minute=0, second=0, microsecond=0)
    if base <= now:
        base += timedelta(hours=AUTO_MDG_CYCLE_HOURS)
    return base


async def _create_automated_games(cycle_id: str) -> list:
    """Create AUTO_MDG_GAMES_PER_CYCLE automated house games."""
    created = []
    now_iso = datetime.now(timezone.utc).isoformat()
    next_cycle = _next_cycle_boundary(datetime.now(timezone.utc))
    deadline = (next_cycle - timedelta(minutes=AUTO_MDG_EARLY_ROLL_MINUTES)).isoformat()
    for _ in range(AUTO_MDG_GAMES_PER_CYCLE):
        house_pot = _rng.randint(AUTO_MDG_POT_MIN, AUTO_MDG_POT_MAX)
        fee_money = round(house_pot * 0.10)
        game_id = str(uuid.uuid4())
        doc = {
            "id": game_id,
            "created_by": "__house__",
            "created_by_username": "House",
            "created_at": now_iso,
            "fee_points": 0,
            "fee_money": float(fee_money),
            "max_players": AUTO_MDG_MAX_PLAYERS,
            "auto_roll_at": AUTO_MDG_MAX_PLAYERS,
            "extra_pot_points": 0,
            "extra_pot_money": 0.0,
            "entries": [],
            "pot_points": 0,
            "pot_money": float(house_pot),
            "status": "open",
            "winner_id": None,
            "winner_username": None,
            "rolled_at": None,
            "is_automated": True,
            "house_pot": float(house_pot),
            "cycle_id": cycle_id,
            "auto_roll_deadline": deadline,
        }
        await db.mdg_games.insert_one(doc)
        created.append(game_id)
    return created


async def _roll_automated_game(game: dict) -> None:
    """Roll an automated game. House gets one slot in the pool alongside players."""
    game_id = game["id"]
    entries = list(game.get("entries") or [])
    pot_pts = int(game.get("pot_points") or 0)
    pot_money = float(game.get("pot_money") or 0)
    house_pot = float(game.get("house_pot") or 0)
    fees_collected = sum(float(e.get("paid_money") or 0) for e in entries)

    if not entries:
        # No players joined — close quietly, house loses nothing
        await db.mdg_games.update_one(
            {"id": game_id, "status": "open"},
            {"$set": {"status": "completed", "winner_id": "__house__", "winner_username": "House", "rolled_at": datetime.now(timezone.utc).isoformat(), "roll": 0}},
        )
        return

    # Every fee-paying entrant gets one equal slot; +1 for house (last slot).
    player_pool = _mdg_roll_pool(entries)
    total_slots = len(player_pool) + 1
    roll = _rng.randrange(1, total_slots + 1)
    now_iso = datetime.now(timezone.utc).isoformat()

    house_won = roll == total_slots  # last slot = house

    if house_won:
        # House wins — pot is burned (removed from economy)
        claim_res = await db.mdg_games.find_one_and_update(
            {"id": game_id, "status": "open"},
            {"$set": {"status": "completed", "winner_id": "__house__", "winner_username": "House", "rolled_at": now_iso, "roll": roll}},
        )
        if not claim_res:
            return
        # Stats: house gained fees_collected, pot was house money that returns
        await db.mdg_house_stats.update_one(
            {"id": "global"},
            {"$inc": {
                "total_games": 1,
                "house_wins": 1,
                "total_pot_created": house_pot,
                "total_fees_collected": fees_collected,
                "total_paid_to_winners": 0,
            }},
            upsert=True,
        )
        # Notify all players they lost
        for e in entries:
            uid = (e.get("user_id") or "").strip()
            if not uid:
                continue
            try:
                await send_notification(
                    uid,
                    "🎲 Auto MDG Result",
                    f"The House won this automated MDG. Pot: ${pot_money:,.0f}. Better luck next time!",
                    "system",
                )
            except Exception:
                continue
    else:
        # Player wins
        winner_entry = player_pool[roll - 1]
        winner_id = winner_entry["user_id"]
        winner_user = await db.users.find_one({"id": winner_id}, {"_id": 0, "username": 1})
        winner_username = (winner_user and winner_user.get("username")) or winner_entry.get("username") or "?"
        claim_res = await db.mdg_games.find_one_and_update(
            {"id": game_id, "status": "open"},
            {"$set": {"status": "completed", "winner_id": winner_id, "winner_username": winner_username, "rolled_at": now_iso, "roll": roll}},
        )
        if not claim_res:
            return
        await db.users.update_one(
            {"id": winner_id},
            {"$inc": {"money": pot_money}},
        )
        await log_gambling(
            winner_id, winner_username, "mdg",
            {"action": "payout", "game_id": game_id, "pot_points": 0, "pot_money": pot_money, "trigger": "auto_mdg"},
        )
        # Stats: house put up house_pot, collected fees, paid out full pot
        await db.mdg_house_stats.update_one(
            {"id": "global"},
            {"$inc": {
                "total_games": 1,
                "player_wins": 1,
                "total_pot_created": house_pot,
                "total_fees_collected": fees_collected,
                "total_paid_to_winners": pot_money,
            }},
            upsert=True,
        )
        await send_notification(winner_id, "🎲 Auto MDG Won!", f"You won the automated MDG pot: ${pot_money:,.0f}!", "reward")
        # Notify losers
        for e in entries:
            uid = (e.get("user_id") or "").strip()
            if not uid or uid == winner_id:
                continue
            try:
                await send_notification(
                    uid,
                    "🎲 Auto MDG Result",
                    f"You lost this automated MDG. Winner: {winner_username}. Pot: ${pot_money:,.0f}.",
                    "system",
                )
            except Exception:
                continue


async def run_automated_mdg_ticker():
    """Background loop: every 3h create 3 automated MDG games. Roll unfilled games 10min before next cycle."""
    await asyncio.sleep(10)  # let server finish startup
    _logger.info("Automated MDG ticker started")

    while True:
        try:
            now = datetime.now(timezone.utc)
            next_cycle = _next_cycle_boundary(now)
            cycle_id = next_cycle.isoformat()

            # Roll any leftover open automated games from previous cycles
            leftover = await db.mdg_games.find(
                {"is_automated": True, "status": "open", "cycle_id": {"$ne": cycle_id}},
                {"_id": 0},
            ).to_list(50)
            for g in leftover:
                try:
                    await _roll_automated_game(g)
                except Exception:
                    _logger.exception("Failed to roll leftover auto-MDG %s", g.get("id"))

            # Create new games for this cycle if not already created
            existing = await db.mdg_games.count_documents({"is_automated": True, "cycle_id": cycle_id})
            if existing < AUTO_MDG_GAMES_PER_CYCLE:
                ids = await _create_automated_games(cycle_id)
                _logger.info("Created %d automated MDG games for cycle %s: %s", len(ids), cycle_id, ids)

            # Sleep until early-roll deadline (10min before next cycle)
            deadline = next_cycle - timedelta(minutes=AUTO_MDG_EARLY_ROLL_MINUTES)
            sleep_to_deadline = max(0, (deadline - datetime.now(timezone.utc)).total_seconds())
            if sleep_to_deadline > 0:
                await asyncio.sleep(sleep_to_deadline)

            # Roll any automated games that haven't filled yet
            unfilled = await db.mdg_games.find(
                {"is_automated": True, "status": "open", "cycle_id": cycle_id},
                {"_id": 0},
            ).to_list(50)
            for g in unfilled:
                try:
                    await _roll_automated_game(g)
                except Exception:
                    _logger.exception("Failed to early-roll auto-MDG %s", g.get("id"))

            # Sleep until next cycle boundary
            sleep_to_cycle = max(5, (next_cycle - datetime.now(timezone.utc)).total_seconds())
            await asyncio.sleep(sleep_to_cycle)

        except Exception:
            _logger.exception("Automated MDG ticker error")
            await asyncio.sleep(60)


def register(router):
    async def _notify_mdg_losers(
        entries: list,
        winner_id: str,
        winner_username: str,
        pot_points: int,
        pot_money: float,
    ) -> None:
        """Notify all unique non-winner entrants that they lost and who won."""
        sent_to = set()
        for e in entries or []:
            uid = (e.get("user_id") or "").strip()
            if not uid or uid == winner_id or uid in sent_to:
                continue
            sent_to.add(uid)
            try:
                await send_notification(
                    uid,
                    "🎲 MDG Result",
                    f"You lost this MDG. Winner: {winner_username}. Final pot: {pot_points} pts, ${pot_money:,.0f}.",
                    "system",
                )
            except Exception:
                # Do not block roll settlement on notification failures.
                continue

    @router.get("/casino/mdg/games")
    async def mdg_list_games(current_user: dict = Depends(get_current_user_verified)):
        """List open MDG games (joinable)."""
        cursor = db.mdg_games.find(
            {"status": "open"},
            {"_id": 0, "id": 1, "created_by": 1, "created_by_username": 1, "created_at": 1, "fee_points": 1, "fee_money": 1, "max_players": 1, "auto_roll_at": 1, "extra_pot_points": 1, "extra_pot_money": 1, "entries": 1, "pot_points": 1, "pot_money": 1, "status": 1, "is_automated": 1, "house_pot": 1, "auto_roll_deadline": 1},
        ).sort("created_at", -1)
        games = await cursor.to_list(100)
        return {"games": [_mdg_sanitize_for_json(g) for g in games]}

    @router.get("/casino/mdg/auto-stats")
    async def mdg_auto_stats(current_user: dict = Depends(get_current_user_verified)):
        """Return cumulative house stats for automated MDG games + next cycle time."""
        doc = await db.mdg_house_stats.find_one({"id": "global"}, {"_id": 0})
        if not doc:
            doc = {"id": "global", "total_games": 0, "house_wins": 0, "player_wins": 0, "total_pot_created": 0, "total_fees_collected": 0, "total_paid_to_winners": 0}
        now = datetime.now(timezone.utc)
        doc["next_cycle"] = _next_cycle_boundary(now).isoformat()
        return doc

    @router.post("/casino/mdg/create")
    async def mdg_create(request: MDGCreateRequest, current_user: dict = Depends(get_current_user_verified)):
        """Create a new MDG. You are auto-joined. Fee and extra pot can be points, money, or both. Max 3 open games per user."""
        uid = current_user["id"]
        open_count = await db.mdg_games.count_documents({"created_by": uid, "status": "open"})
        if open_count >= MDG_MAX_OPEN_GAMES_PER_USER:
            raise HTTPException(status_code=400, detail=f"You can only have {MDG_MAX_OPEN_GAMES_PER_USER} open games at once. Roll or wait for existing games to fill.")

        fee_pts = max(0, int(request.fee_points or 0))
        fee_money = max(0.0, float(request.fee_money or 0))
        if fee_pts <= 0 and fee_money <= 0:
            raise HTTPException(status_code=400, detail="Set a fee: points and/or money must be greater than 0")
        if fee_pts > MDG_MAX_FEE_POINTS or fee_money > MDG_MAX_FEE_MONEY:
            raise HTTPException(status_code=400, detail="Fee exceeds maximum allowed")
        max_players = max(MDG_MIN_PLAYERS, min(MDG_MAX_PLAYERS, int(request.max_players or 10)))
        if _is_entertainer(current_user) and max_players < ENTERTAINER_MDG_MIN_MAX_PLAYERS:
            raise HTTPException(
                status_code=400,
                detail=f"Entertainer-created MDG games must allow at least {ENTERTAINER_MDG_MIN_MAX_PLAYERS} players (set Max players ≥ {ENTERTAINER_MDG_MIN_MAX_PLAYERS}).",
            )
        auto_roll_at = None
        if request.auto_roll_at is not None:
            auto_roll_at = max(MDG_MIN_PLAYERS, min(max_players, int(request.auto_roll_at)))
        extra_pts = max(0, int(request.extra_pot_points or 0))
        extra_money = max(0.0, float(request.extra_pot_money or 0))
        if extra_pts > MDG_MAX_EXTRA_POT_POINTS or extra_money > MDG_MAX_EXTRA_POT_MONEY:
            raise HTTPException(status_code=400, detail="Extra pot exceeds maximum allowed")

        # Creator is auto-joined: must have enough to pay fee + extra pot
        total_pts = fee_pts + extra_pts
        total_money = fee_money + extra_money
        if _is_entertainer(current_user) and total_pts > ENTERTAINER_MDG_MAX_POINTS_PER_GAME:
            raise HTTPException(
                status_code=400,
                detail=f"Entertainer MDG: fee points + extra pot points cannot exceed {ENTERTAINER_MDG_MAX_POINTS_PER_GAME:,} (from your entertainer fund).",
            )
        user = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
        if not user:
            raise HTTPException(status_code=400, detail="User not found")

        game_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        creator_entry = {"user_id": uid, "username": user.get("username") or "?", "paid_points": fee_pts, "paid_money": fee_money}
        doc = {
            "id": game_id,
            "created_by": uid,
            "created_by_username": current_user.get("username") or "?",
            "created_at": now_iso,
            "fee_points": fee_pts,
            "fee_money": fee_money,
            "max_players": max_players,
            "auto_roll_at": auto_roll_at,
            "extra_pot_points": extra_pts,
            "extra_pot_money": extra_money,
            "entries": [creator_entry],
            "pot_points": extra_pts + fee_pts,
            "pot_money": extra_money + fee_money,
            "status": "open",
            "winner_id": None,
            "winner_username": None,
            "rolled_at": None,
            "entertainer_funded": False,
        }
        if _is_entertainer(current_user):
            ok = await try_debit_entertainer_fund(db, uid, total_money, total_pts)
            if not ok:
                raise HTTPException(
                    status_code=400,
                    detail="Insufficient entertainer fund (fee + extra pot must be covered by your entertainer fund balance).",
                )
            doc["entertainer_funded"] = True
            u_pts_read = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1})
            pts_before_create = int((u_pts_read or {}).get("points") or 0)
            if total_pts > 0:
                await log_points_event(
                    db,
                    user_id=uid,
                    points=-total_pts,
                    event_type="entertainer_mdg_fund",
                    event_ref=f"create:{game_id}",
                    meta={"action": "create_fee", "game_id": game_id, "fee_points": fee_pts, "extra_pot_points": extra_pts, "from": "entertainer_fund"},
                    wallet_points_before=pts_before_create,
                    wallet_points_after=pts_before_create,
                )
            await db.mdg_games.insert_one(doc)
            await insert_funded_game_row(db, entertainer_id=uid, source="mdg", ref_id=game_id)
            await log_gambling(
                uid,
                current_user.get("username") or "?",
                "mdg",
                {"action": "create", "game_id": game_id, "fee_points": fee_pts, "fee_money": fee_money, "extra_pot_points": extra_pts, "extra_pot_money": extra_money, "entertainer_fund": True},
            )
            return {"message": "Game created and you are in it", "game_id": game_id, "game": _mdg_sanitize_for_json(doc)}
        u_pts_read = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1})
        pts_before_create = int((u_pts_read or {}).get("points") or 0)
        deduct_filter = {"id": uid}
        deduct_inc = {}
        if total_pts:
            deduct_filter["points"] = {"$gte": total_pts}
            deduct_inc["points"] = -total_pts
        if total_money:
            deduct_filter["money"] = {"$gte": total_money}
            deduct_inc["money"] = -total_money
        if deduct_inc:
            result = await db.users.update_one(deduct_filter, {"$inc": deduct_inc})
            if result.modified_count == 0:
                raise HTTPException(status_code=400, detail="Insufficient points or money to create and join (fee + extra pot)")
            if total_pts > 0:
                await log_points_event(
                    db,
                    user_id=uid,
                    points=-total_pts,
                    event_type="casino_mdg",
                    event_ref=f"create:{game_id}",
                    meta={"action": "create_fee", "game_id": game_id, "fee_points": fee_pts, "extra_pot_points": extra_pts},
                    wallet_points_before=pts_before_create,
                    wallet_points_after=pts_before_create - total_pts,
                )
        await db.mdg_games.insert_one(doc)
        await log_gambling(
            uid,
            current_user.get("username") or "?",
            "mdg",
            {"action": "create", "game_id": game_id, "fee_points": fee_pts, "fee_money": fee_money, "extra_pot_points": extra_pts, "extra_pot_money": extra_money},
        )
        return {"message": "Game created and you are in it", "game_id": game_id, "game": _mdg_sanitize_for_json(doc)}

    @router.post("/casino/mdg/join")
    async def mdg_join(request: MDGJoinRequest, current_user: dict = Depends(get_current_user_verified)):
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

        user = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
        if not user:
            raise HTTPException(status_code=400, detail="User not found")

        entry = {"user_id": uid, "username": user.get("username") or "?", "paid_points": fee_pts, "paid_money": fee_money}
        new_entries = entries + [entry]
        new_pot_pts = int(game.get("pot_points") or 0) + fee_pts
        new_pot_money = float(game.get("pot_money") or 0) + fee_money

        u_join_pts = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1})
        pts_before_join = int((u_join_pts or {}).get("points") or 0)
        deduct_filter = {"id": uid}
        deduct_inc = {}
        if fee_pts:
            deduct_filter["points"] = {"$gte": fee_pts}
            deduct_inc["points"] = -fee_pts
        if fee_money:
            deduct_filter["money"] = {"$gte": fee_money}
            deduct_inc["money"] = -fee_money
        if deduct_inc:
            result = await db.users.update_one(deduct_filter, {"$inc": deduct_inc})
            if result.modified_count == 0:
                raise HTTPException(status_code=400, detail="Insufficient points or money")
            if fee_pts > 0:
                await log_points_event(
                    db,
                    user_id=uid,
                    points=-fee_pts,
                    event_type="casino_mdg",
                    event_ref=f"join:{request.game_id}",
                    meta={"action": "join_fee", "game_id": request.game_id},
                    wallet_points_before=pts_before_join,
                    wallet_points_after=pts_before_join - fee_pts,
                )

        await log_gambling(
            uid,
            user.get("username") or "?",
            "mdg",
            {"action": "join", "game_id": request.game_id, "fee_points": fee_pts, "fee_money": fee_money, "players_after": len(new_entries)},
        )

        # Update game only if this user_id is not already in entries (prevents double-join from race/double-click)
        result = await db.mdg_games.update_one(
            {"id": request.game_id, "status": "open", "entries.user_id": {"$ne": uid}},
            {"$set": {"entries": new_entries, "pot_points": new_pot_pts, "pot_money": new_pot_money}},
        )
        if result.matched_count == 0:
            u_ref = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1})
            pts_before_refund = int((u_ref or {}).get("points") or 0)
            await db.users.update_one({"id": uid}, {"$inc": {"points": fee_pts, "money": fee_money}})
            if fee_pts > 0:
                await log_points_event(
                    db,
                    user_id=uid,
                    points=fee_pts,
                    event_type="casino_mdg",
                    event_ref=f"refund:{request.game_id}",
                    meta={"action": "join_refund", "game_id": request.game_id},
                    wallet_points_before=pts_before_refund,
                    wallet_points_after=pts_before_refund + fee_pts,
                )
            raise HTTPException(status_code=400, detail="You are already in this game")

        # Auto-roll if threshold reached
        auto_roll_at = game.get("auto_roll_at")
        should_roll = (auto_roll_at is not None and len(new_entries) >= auto_roll_at) or len(new_entries) >= max_players
        if should_roll and len(new_entries) >= MDG_MIN_PLAYERS:
            is_auto_game = game.get("is_automated")

            if is_auto_game:
                # Automated game: use house-roll logic (house gets a slot)
                refreshed = await db.mdg_games.find_one({"id": request.game_id, "status": "open"}, {"_id": 0})
                if refreshed:
                    await _roll_automated_game(refreshed)
                    refreshed_after = await db.mdg_games.find_one({"id": request.game_id}, {"_id": 0, "winner_id": 1, "winner_username": 1, "roll": 1, "pot_money": 1})
                    w_id = (refreshed_after or {}).get("winner_id", "?")
                    w_name = (refreshed_after or {}).get("winner_username", "?")
                    r = (refreshed_after or {}).get("roll", 0)
                    house_won = w_id == "__house__"
                    return {
                        "message": "Joined; game rolled." + (" House won — pot burned!" if house_won else f" Winner: {w_name}"),
                        "roll": r,
                        "winner_id": w_id,
                        "winner_username": w_name,
                        "pot_points": new_pot_pts,
                        "pot_money": new_pot_money,
                        "house_won": house_won,
                    }
                return {"message": "Joined", "players": len(new_entries), "pot_points": new_pot_pts, "pot_money": new_pot_money}

            # Regular (non-automated) game roll — uniform over all entrants
            pool = _mdg_roll_pool(new_entries)
            roll = _rng.randrange(1, len(pool) + 1)
            winner_entry = pool[roll - 1]
            winner_id = winner_entry["user_id"]
            winner_user = await db.users.find_one({"id": winner_id}, {"_id": 0, "username": 1})
            winner_username = (winner_user and winner_user.get("username")) or winner_entry.get("username") or "?"
            now_iso = datetime.now(timezone.utc).isoformat()
            claim_res = await db.mdg_games.find_one_and_update(
                {"id": request.game_id, "status": "open"},
                {"$set": {"status": "completed", "winner_id": winner_id, "winner_username": winner_username, "rolled_at": now_iso, "roll": roll}},
            )
            if not claim_res:
                return {"message": "Joined", "players": len(new_entries), "pot_points": new_pot_pts, "pot_money": new_pot_money}
            w_pts_read = await db.users.find_one({"id": winner_id}, {"_id": 0, "points": 1})
            pts_before_payout = int((w_pts_read or {}).get("points") or 0)
            await db.users.update_one(
                {"id": winner_id},
                {"$inc": {"points": new_pot_pts, "money": new_pot_money}},
            )
            if new_pot_pts > 0:
                await log_points_event(
                    db,
                    user_id=winner_id,
                    points=new_pot_pts,
                    event_type="casino_mdg",
                    event_ref=f"payout:{request.game_id}",
                    meta={"action": "winner_payout", "game_id": request.game_id, "trigger": "auto_roll"},
                    wallet_points_before=pts_before_payout,
                    wallet_points_after=pts_before_payout + new_pot_pts,
                )
            await log_gambling(
                winner_id,
                winner_username,
                "mdg",
                {"action": "payout", "game_id": request.game_id, "pot_points": new_pot_pts, "pot_money": new_pot_money, "trigger": "auto_roll"},
            )
            await send_notification(winner_id, "🎲 MDG Won", f"You won the pot: {new_pot_pts} pts, ${new_pot_money:,.0f}", "reward")
            await _notify_mdg_losers(new_entries, winner_id, winner_username, new_pot_pts, new_pot_money)
            if game.get("entertainer_funded"):
                fee_pts = int(game.get("fee_points") or 0)
                extra_pts = int(game.get("extra_pot_points") or 0)
                fee_money = float(game.get("fee_money") or 0)
                extra_money = float(game.get("extra_pot_money") or 0)
                await on_funded_game_completed(
                    db,
                    ref_id=request.game_id,
                    source="mdg",
                    send_notification=send_notification,
                    log_points_event=log_points_event,
                    outcome={
                        "winner_username": winner_username,
                        "winner_id": winner_id,
                        "total_winnings_points": int(new_pot_pts),
                        "total_winnings_cash": float(new_pot_money),
                        "from_entertainer_fund_points": fee_pts + extra_pts,
                        "from_entertainer_fund_cash": fee_money + extra_money,
                    },
                )
            return {"message": "Joined; game rolled. One winner takes the pot.", "roll": roll, "winner_id": winner_id, "winner_username": winner_username, "pot_points": new_pot_pts, "pot_money": new_pot_money}

        return {"message": "Joined", "players": len(new_entries), "pot_points": new_pot_pts, "pot_money": new_pot_money}

    @router.post("/casino/mdg/roll")
    async def mdg_roll(request: MDGRollRequest, current_user: dict = Depends(get_current_user_verified)):
        """Manually roll an open game (creator, admin, or moderator). One random winner takes the pot."""
        game = await db.mdg_games.find_one({"id": request.game_id, "status": "open"}, {"_id": 0})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found or already closed")
        if game.get("is_automated"):
            raise HTTPException(status_code=403, detail="Automated games are rolled by the system")
        if game.get("created_by") != current_user["id"] and not _is_admin(current_user) and not _is_moderator(current_user):
            raise HTTPException(status_code=403, detail="Only the game creator or staff can roll")
        entries = list(game.get("entries") or [])
        if len(entries) < 1:
            raise HTTPException(status_code=400, detail="No players in game")

        # Uniform over all entrants (order preserved: 1 = first in entries list, etc.)
        pool = _mdg_roll_pool(entries)
        roll = _rng.randrange(1, len(pool) + 1)
        winner_entry = pool[roll - 1]  # roll is 1-indexed, list is 0-indexed
        winner_id = winner_entry["user_id"]
        winner_user = await db.users.find_one({"id": winner_id}, {"_id": 0, "username": 1})
        winner_username = (winner_user and winner_user.get("username")) or winner_entry.get("username") or "?"
        now_iso = datetime.now(timezone.utc).isoformat()
        pot_pts = int(game.get("pot_points") or 0)
        pot_money = float(game.get("pot_money") or 0)
        claim_res = await db.mdg_games.find_one_and_update(
            {"id": request.game_id, "status": "open"},
            {"$set": {"status": "completed", "winner_id": winner_id, "winner_username": winner_username, "rolled_at": now_iso, "roll": roll}},
        )
        if not claim_res:
            raise HTTPException(status_code=400, detail="Game already closed")
        w_pts_read = await db.users.find_one({"id": winner_id}, {"_id": 0, "points": 1})
        pts_before_payout = int((w_pts_read or {}).get("points") or 0)
        await db.users.update_one({"id": winner_id}, {"$inc": {"points": pot_pts, "money": pot_money}})
        if pot_pts > 0:
            await log_points_event(
                db,
                user_id=winner_id,
                points=pot_pts,
                event_type="casino_mdg",
                event_ref=f"payout:{request.game_id}",
                meta={"action": "winner_payout", "game_id": request.game_id, "trigger": "manual_roll"},
                wallet_points_before=pts_before_payout,
                wallet_points_after=pts_before_payout + pot_pts,
            )
        await log_gambling(
            winner_id,
            winner_username,
            "mdg",
            {"action": "payout", "game_id": request.game_id, "pot_points": pot_pts, "pot_money": pot_money, "trigger": "manual_roll"},
        )
        await send_notification(winner_id, "🎲 MDG Won", f"You won the pot: {pot_pts} pts, ${pot_money:,.0f}", "reward")
        await _notify_mdg_losers(entries, winner_id, winner_username, pot_pts, pot_money)
        if game.get("entertainer_funded"):
            fee_pts = int(game.get("fee_points") or 0)
            extra_pts = int(game.get("extra_pot_points") or 0)
            fee_money = float(game.get("fee_money") or 0)
            extra_money = float(game.get("extra_pot_money") or 0)
            await on_funded_game_completed(
                db,
                ref_id=request.game_id,
                source="mdg",
                send_notification=send_notification,
                log_points_event=log_points_event,
                outcome={
                    "winner_username": winner_username,
                    "winner_id": winner_id,
                    "total_winnings_points": int(pot_pts),
                    "total_winnings_cash": float(pot_money),
                    "from_entertainer_fund_points": fee_pts + extra_pts,
                    "from_entertainer_fund_cash": fee_money + extra_money,
                },
            )
        return {"message": "Roll complete. One winner takes the pot.", "roll": roll, "winner_id": winner_id, "winner_username": winner_username, "pot_points": pot_pts, "pot_money": pot_money}
