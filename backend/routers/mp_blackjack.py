# Multiplayer Blackjack: pot-based, 2-8 players, no table ownership
from datetime import datetime, timezone
from typing import List, Optional
import random
import uuid

MP_BJ_TURN_SECONDS = 60
MP_BJ_CHAT_MAX = 100

from pydantic import BaseModel, field_validator
from fastapi import Depends, HTTPException

from server import db, get_current_user, get_current_user_verified, log_gambling

# Reuse card format and logic from blackjack (copy to avoid heavy imports)
MP_BJ_SUITS = ["H", "D", "C", "S"]
MP_BJ_VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]

MP_BJ_MIN_PLAYERS = 2
MP_BJ_MAX_PLAYERS = 8
MP_BJ_MAX_BUY_IN = 1_000_000_000
MP_BJ_MAX_EXTRA_PRIZE = 1_000_000_000


def _mp_bj_make_deck():
    return [{"suit": s, "value": v} for s in MP_BJ_SUITS for v in MP_BJ_VALUES]


def _mp_bj_hand_total(hand):
    total = 0
    aces = 0
    for c in hand:
        v = c.get("value")
        if v == "A":
            aces += 1
            total += 11
        elif v in ("K", "Q", "J"):
            total += 10
        else:
            total += int(v) if v else 0
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


def _mp_bj_is_blackjack(hand):
    return len(hand) == 2 and _mp_bj_hand_total(hand) == 21


class MPCreateRequest(BaseModel):
    max_players: int = 6
    buy_in: int = 100_000
    extra_prize: int = 0
    exclude_yourself: bool = False
    anonymous: bool = False
    card_limit: Optional[int] = None  # None = no limit, else 2, 3, or 5
    twenty_one_only: bool = False

    @field_validator("max_players")
    @classmethod
    def clamp_max_players(cls, v):
        return max(MP_BJ_MIN_PLAYERS, min(MP_BJ_MAX_PLAYERS, int(v or 6)))

    @field_validator("buy_in", "extra_prize", mode="before")
    @classmethod
    def coerce_int(cls, v):
        if v is None:
            return 0
        if isinstance(v, str):
            return int(v.strip() or 0)
        return int(v)

    @field_validator("card_limit", mode="before")
    @classmethod
    def coerce_card_limit(cls, v):
        if v is None or v == "" or (isinstance(v, str) and v.strip().lower() in ("no_limit", "none", "")):
            return None
        n = int(v) if isinstance(v, (int, float)) else int(str(v).strip() or 0)
        if n not in (2, 3, 5):
            return None
        return n


def register(router):
    @router.get("/casino/mp-blackjack/games")
    async def mp_bj_list_games(current_user: dict = Depends(get_current_user_verified)):
        """List open multiplayer blackjack games."""
        cursor = db.mp_blackjack_games.find(
            {"status": "open"},
            {"_id": 0, "id": 1, "creator_id": 1, "creator_username": 1, "max_players": 1, "buy_in": 1, "extra_prize": 1, "pot": 1, "players": 1, "status": 1, "created_at": 1, "anonymous": 1, "card_limit": 1, "exclude_yourself": 1, "twenty_one_only": 1},
        ).sort("created_at", -1)
        games = await cursor.to_list(100)
        out = []
        for g in games:
            players_list = g.get("players") or []
            creator_name = g.get("creator_username")
            if g.get("anonymous"):
                creator_name = "Anonymous"
            out.append({
                "id": g["id"],
                "creator_username": creator_name,
                "max_players": g.get("max_players", 6),
                "buy_in": g.get("buy_in", 0),
                "extra_prize": g.get("extra_prize", 0),
                "pot": g.get("pot", 0),
                "player_count": len(players_list),
                "status": g.get("status"),
                "created_at": g.get("created_at"),
                "anonymous": g.get("anonymous", False),
                "card_limit": g.get("card_limit"),
                "exclude_yourself": g.get("exclude_yourself", False),
                "twenty_one_only": g.get("twenty_one_only", False),
            })
        return {"games": out}

    @router.post("/casino/mp-blackjack/games")
    async def mp_bj_create(request: MPCreateRequest, current_user: dict = Depends(get_current_user_verified)):
        """Create a new multiplayer blackjack game. Creator is first player; pays buy_in + extra_prize."""
        uid = current_user["id"]
        username = (current_user.get("username") or "?").strip()
        max_players = max(MP_BJ_MIN_PLAYERS, min(MP_BJ_MAX_PLAYERS, request.max_players))
        buy_in = max(0, request.buy_in)
        extra_prize = max(0, request.extra_prize)
        if buy_in <= 0:
            raise HTTPException(status_code=400, detail="Buy-in must be positive")
        if buy_in > MP_BJ_MAX_BUY_IN or extra_prize > MP_BJ_MAX_EXTRA_PRIZE:
            raise HTTPException(status_code=400, detail="Buy-in or extra prize exceeds maximum")
        exclude_yourself = getattr(request, "exclude_yourself", False) or False
        anonymous = getattr(request, "anonymous", False) or False
        card_limit = getattr(request, "card_limit", None)
        twenty_one_only = getattr(request, "twenty_one_only", False) or False
        if exclude_yourself:
            total_deduct = extra_prize
            players = []
            pot = extra_prize
        else:
            total_deduct = buy_in + extra_prize
            players = [{"user_id": uid, "username": username, "seat_index": 0, "hand": [], "status": "playing", "bet": buy_in}]
            pot = buy_in + extra_prize
        user = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1})
        if not user or (user.get("money") or 0) < total_deduct:
            raise HTTPException(status_code=400, detail="Insufficient money to create game")
        game_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": game_id,
            "creator_id": uid,
            "creator_username": username,
            "max_players": max_players,
            "buy_in": buy_in,
            "extra_prize": extra_prize,
            "exclude_yourself": exclude_yourself,
            "anonymous": anonymous,
            "card_limit": card_limit,
            "twenty_one_only": twenty_one_only,
            "status": "open",
            "phase": "lobby",
            "players": players,
            "deck": [],
            "current_turn_index": -1,
            "pot": pot,
            "created_at": now_iso,
            "started_at": None,
            "completed_at": None,
            "winner_ids": [],
            "results": [],
            "chat": [],
            "turn_started_at": None,
        }
        await db.mp_blackjack_games.insert_one(doc)
        await db.users.update_one({"id": uid}, {"$inc": {"money": -total_deduct}})
        await log_gambling(uid, username, "mp_blackjack", {"action": "create", "game_id": game_id, "buy_in": buy_in, "extra_prize": extra_prize})
        return {"message": "Game created", "game_id": game_id, "game": {k: v for k, v in doc.items() if k != "_id"}}

    def _serialize_game(g):
        out = {k: v for k, v in g.items() if k != "_id"}
        if g.get("anonymous"):
            out["creator_username"] = "Anonymous"
            players = list(out.get("players") or [])
            uid_to_label = {}
            for i, p in enumerate(players):
                p = dict(p)
                label = f"Player {i + 1}"
                p["username"] = label
                uid_to_label[p.get("user_id")] = label
                players[i] = p
            out["players"] = players
            results = list(out.get("results") or [])
            for i, r in enumerate(results):
                r = dict(r)
                r["username"] = uid_to_label.get(r.get("user_id"), "Anonymous")
                results[i] = r
            out["results"] = results
            for c in out.get("chat") or []:
                c["username"] = uid_to_label.get(c.get("user_id"), "Anonymous")
        return out

    async def _run_settle(game_id: str):
        """Settle game: best hand(s) among non-bust players win the pot. No dealer."""
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game or game.get("phase") not in ("playing", "dealer"):
            return
        players = list(game.get("players") or [])
        pot = int(game.get("pot") or 0)
        twenty_one_only = game.get("twenty_one_only") or False
        # Best total among non-bust players (<=21); if twenty_one_only only 21 counts
        best_total = -1
        for p in players:
            if p.get("status") == "bust":
                continue
            pt = _mp_bj_hand_total(p.get("hand") or [])
            if pt <= 21 and (not twenty_one_only or pt == 21) and pt > best_total:
                best_total = pt
        if twenty_one_only and best_total != 21:
            best_total = -1
        winner_indices = []
        if best_total >= 0:
            for i, p in enumerate(players):
                if p.get("status") == "bust":
                    continue
                if _mp_bj_hand_total(p.get("hand") or []) == best_total:
                    winner_indices.append(i)
        # Single winner: first by seat order gets the whole pot
        num_players = len(players)
        now_iso = datetime.now(timezone.utc).isoformat()
        if winner_indices:
            winner_indices = [winner_indices[0]]
        winner_ids = [players[i].get("user_id") for i in winner_indices]
        payouts = {p.get("user_id"): 0 for p in players}
        if not winner_indices:
            refund_each = pot // num_players
            remainder = pot - refund_each * num_players
            for i, p in enumerate(players):
                uid = p.get("user_id")
                add = refund_each + (remainder if i == 0 else 0)
                payouts[uid] = add
                if add > 0:
                    await db.users.update_one({"id": uid}, {"$inc": {"money": add}})
        else:
            uid = players[winner_indices[0]].get("user_id")
            payouts[uid] = pot
            if pot > 0:
                await db.users.update_one({"id": uid}, {"$inc": {"money": pot}})
        results = []
        for p in players:
            uid = p.get("user_id")
            if not winner_indices:
                results.append({"user_id": uid, "username": p.get("username"), "result": "refund", "payout": payouts.get(uid, 0)})
            elif uid in winner_ids:
                results.append({"user_id": uid, "username": p.get("username"), "result": "win", "payout": payouts.get(uid, 0)})
            else:
                results.append({"user_id": uid, "username": p.get("username"), "result": "lose", "payout": 0})
        await db.mp_blackjack_games.update_one(
            {"id": game_id},
            {
                "$set": {
                    "status": "completed",
                    "phase": "settled",
                    "completed_at": now_iso,
                    "winner_ids": winner_ids,
                    "results": results,
                }
            },
        )

    async def _maybe_auto_stand(game_id: str):
        """If current turn has exceeded MP_BJ_TURN_SECONDS, auto-stand and advance. Returns updated game or None."""
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game or game.get("status") != "playing" or game.get("phase") != "playing":
            return None
        players = list(game.get("players") or [])
        turn_idx = int(game.get("current_turn_index") or 0)
        if turn_idx < 0 or turn_idx >= len(players):
            return None
        started_at = game.get("turn_started_at")
        if not started_at:
            return None
        try:
            dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        except Exception:
            return None
        elapsed = (datetime.now(timezone.utc) - dt).total_seconds()
        if elapsed < MP_BJ_TURN_SECONDS:
            return None
        players[turn_idx]["status"] = "stood"
        deck = list(game.get("deck") or [])
        turn_idx += 1
        while turn_idx < len(players) and players[turn_idx].get("status") != "playing":
            turn_idx += 1
        now_iso = datetime.now(timezone.utc).isoformat()
        if turn_idx >= len(players):
            await db.mp_blackjack_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "deck": deck, "current_turn_index": -1, "phase": "dealer"}},
            )
            await _run_settle(game_id)
        else:
            await db.mp_blackjack_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "deck": deck, "current_turn_index": turn_idx, "turn_started_at": now_iso}},
            )
        return await db.mp_blackjack_games.find_one({"id": game_id})

    @router.post("/casino/mp-blackjack/games/{game_id}/cancel")
    async def mp_bj_cancel(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Cancel an open game. Creator only. Refund all players from pot."""
        uid = current_user["id"]
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.get("status") != "open":
            raise HTTPException(status_code=400, detail="Game can only be cancelled while open")
        if game.get("creator_id") != uid:
            raise HTTPException(status_code=403, detail="Only the creator can cancel the game")
        players = list(game.get("players") or [])
        pot = int(game.get("pot") or 0)
        num_players = len(players)
        if num_players == 0:
            refund_each = 0
            remainder = 0
        else:
            refund_each = pot // num_players
            remainder = pot - refund_each * num_players
        for i, p in enumerate(players):
            uid_p = p.get("user_id")
            add = refund_each + (remainder if i == 0 else 0)
            if add > 0:
                await db.users.update_one({"id": uid_p}, {"$inc": {"money": add}})
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.mp_blackjack_games.update_one(
            {"id": game_id},
            {"$set": {"status": "cancelled", "completed_at": now_iso}},
        )
        return {"message": "Game cancelled; all players refunded", "game_id": game_id}

    @router.post("/casino/mp-blackjack/games/{game_id}/join")
    async def mp_bj_join(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Join an open game. Pay buy_in. If game becomes full, deal and start."""
        uid = current_user["id"]
        username = (current_user.get("username") or "?").strip()
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.get("status") != "open":
            raise HTTPException(status_code=400, detail="Game is not open for join")
        if game.get("exclude_yourself") and game.get("creator_id") == uid:
            raise HTTPException(status_code=400, detail="Creator cannot join this game")
        players = list(game.get("players") or [])
        if any(p.get("user_id") == uid for p in players):
            raise HTTPException(status_code=400, detail="You are already in this game")
        max_players = game.get("max_players", 6)
        if len(players) >= max_players:
            raise HTTPException(status_code=400, detail="Game is full")
        buy_in = int(game.get("buy_in") or 0)
        user = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1})
        if not user or (user.get("money") or 0) < buy_in:
            raise HTTPException(status_code=400, detail="Insufficient money to join")
        seat_index = len(players)
        new_player = {"user_id": uid, "username": username, "seat_index": seat_index, "hand": [], "status": "playing", "bet": buy_in}
        players.append(new_player)
        new_pot = int(game.get("pot") or 0) + buy_in
        await db.users.update_one({"id": uid}, {"$inc": {"money": -buy_in}})
        now_iso = datetime.now(timezone.utc).isoformat()
        if len(players) >= max_players:
            # Start game: deal to players only (no dealer)
            deck = _mp_bj_make_deck()
            random.shuffle(deck)
            for p in players:
                hand = [deck.pop(), deck.pop()]
                p["hand"] = hand
                p["status"] = "playing"
            await db.mp_blackjack_games.update_one(
                {"id": game_id},
                {
                    "$set": {
                        "status": "playing",
                        "phase": "playing",
                        "players": players,
                        "deck": deck,
                        "pot": new_pot,
                        "current_turn_index": 0,
                        "turn_started_at": now_iso,
                        "started_at": now_iso,
                    }
                },
            )
            await log_gambling(uid, username, "mp_blackjack", {"action": "join", "game_id": game_id, "buy_in": buy_in})
            updated = await db.mp_blackjack_games.find_one({"id": game_id})
            return {"message": "Joined and game started", "game": _serialize_game(updated)}
        await db.mp_blackjack_games.update_one(
            {"id": game_id},
            {"$set": {"players": players, "pot": new_pot}},
        )
        await log_gambling(uid, username, "mp_blackjack", {"action": "join", "game_id": game_id, "buy_in": buy_in})
        updated = await db.mp_blackjack_games.find_one({"id": game_id})
        return {"message": "Joined", "game": _serialize_game(updated)}

    @router.get("/casino/mp-blackjack/games/{game_id}")
    async def mp_bj_get_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Get full game state for table view. Applies turn timeout (auto-stand) if needed."""
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        updated = await _maybe_auto_stand(game_id)
        if updated is not None:
            game = updated
        return {"game": _serialize_game(game)}

    @router.post("/casino/mp-blackjack/games/{game_id}/hit")
    async def mp_bj_hit(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Current player hits. If bust, advance turn. If all done, run settle."""
        uid = current_user["id"]
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        updated = await _maybe_auto_stand(game_id)
        if updated is not None:
            game = updated
        if game.get("status") != "playing" or game.get("phase") != "playing":
            raise HTTPException(status_code=400, detail="Game is not in playing phase")
        players = list(game.get("players") or [])
        turn_idx = int(game.get("current_turn_index") or 0)
        if turn_idx < 0 or turn_idx >= len(players):
            raise HTTPException(status_code=400, detail="Invalid turn")
        if players[turn_idx].get("user_id") != uid:
            raise HTTPException(status_code=403, detail="Not your turn")
        deck = list(game.get("deck") or [])
        hand = list(players[turn_idx].get("hand") or [])
        card_limit = game.get("card_limit")
        if card_limit is not None and len(hand) >= card_limit:
            raise HTTPException(status_code=400, detail=f"Card limit reached ({card_limit} cards)")
        if not deck:
            raise HTTPException(status_code=400, detail="No cards left")
        card = deck.pop()
        hand.append(card)
        total = _mp_bj_hand_total(hand)
        if total > 21:
            players[turn_idx]["hand"] = hand
            players[turn_idx]["status"] = "bust"
            turn_idx += 1
        else:
            players[turn_idx]["hand"] = hand
            turn_idx += 1
        # Advance to next playing player or dealer phase
        while turn_idx < len(players) and players[turn_idx].get("status") != "playing":
            turn_idx += 1
        now_iso = datetime.now(timezone.utc).isoformat()
        if turn_idx >= len(players):
            await db.mp_blackjack_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "deck": deck, "current_turn_index": -1, "phase": "dealer"}},
            )
            await _run_settle(game_id)
        else:
            await db.mp_blackjack_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "deck": deck, "current_turn_index": turn_idx, "turn_started_at": now_iso}},
            )
        updated = await db.mp_blackjack_games.find_one({"id": game_id})
        return {"game": _serialize_game(updated)}

    @router.post("/casino/mp-blackjack/games/{game_id}/stand")
    async def mp_bj_stand(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Current player stands. Advance to next or dealer phase."""
        uid = current_user["id"]
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        updated = await _maybe_auto_stand(game_id)
        if updated is not None:
            game = updated
        if game.get("status") != "playing" or game.get("phase") != "playing":
            raise HTTPException(status_code=400, detail="Game is not in playing phase")
        players = list(game.get("players") or [])
        turn_idx = int(game.get("current_turn_index") or 0)
        if turn_idx < 0 or turn_idx >= len(players):
            raise HTTPException(status_code=400, detail="Invalid turn")
        if players[turn_idx].get("user_id") != uid:
            raise HTTPException(status_code=403, detail="Not your turn")
        players[turn_idx]["status"] = "stood"
        deck = list(game.get("deck") or [])
        turn_idx += 1
        while turn_idx < len(players) and players[turn_idx].get("status") != "playing":
            turn_idx += 1
        now_iso = datetime.now(timezone.utc).isoformat()
        if turn_idx >= len(players):
            await db.mp_blackjack_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "deck": deck, "current_turn_index": -1, "phase": "dealer"}},
            )
            await _run_settle(game_id)
        else:
            await db.mp_blackjack_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "deck": deck, "current_turn_index": turn_idx, "turn_started_at": now_iso}},
            )
        updated = await db.mp_blackjack_games.find_one({"id": game_id})
        return {"game": _serialize_game(updated)}

    class MPChatRequest(BaseModel):
        message: str

    @router.post("/casino/mp-blackjack/games/{game_id}/chat")
    async def mp_bj_chat(game_id: str, request: MPChatRequest, current_user: dict = Depends(get_current_user_verified)):
        """Send a chat message. Must be in the game."""
        uid = current_user["id"]
        username = (current_user.get("username") or "?").strip()
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        players = game.get("players") or []
        if not any(p.get("user_id") == uid for p in players):
            raise HTTPException(status_code=403, detail="You are not in this game")
        msg = (request.message or "").strip()[: 500]
        if not msg:
            raise HTTPException(status_code=400, detail="Message cannot be empty")
        now_iso = datetime.now(timezone.utc).isoformat()
        chat = list(game.get("chat") or [])
        chat.append({"user_id": uid, "username": username, "message": msg, "at": now_iso})
        if len(chat) > MP_BJ_CHAT_MAX:
            chat = chat[-MP_BJ_CHAT_MAX:]
        await db.mp_blackjack_games.update_one({"id": game_id}, {"$set": {"chat": chat}})
        updated = await db.mp_blackjack_games.find_one({"id": game_id})
        return {"game": _serialize_game(updated)}

    @router.post("/casino/mp-blackjack/games/{game_id}/timeout")
    async def mp_bj_timeout(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Trigger turn timeout check (auto-stand if current turn exceeded 60s). Returns updated game."""
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        updated = await _maybe_auto_stand(game_id)
        if updated is not None:
            game = updated
        return {"game": _serialize_game(game)}
