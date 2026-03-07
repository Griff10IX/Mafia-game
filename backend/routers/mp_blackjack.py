# Multiplayer Blackjack: pot-based, 2-8 players, no table ownership
# Supports: ready-up system, elimination rounds, stable game listing
from datetime import datetime, timezone
from typing import List, Optional
import random
import uuid

MP_BJ_TURN_SECONDS = 60
MP_BJ_CHAT_MAX = 100
MP_BJ_START_COUNTDOWN = 5  # seconds after all ready before deal

from pydantic import BaseModel, field_validator
from fastapi import Depends, HTTPException

from server import db, get_current_user, get_current_user_verified, log_gambling, _is_admin, _is_moderator

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
    card_limit: Optional[int] = None
    twenty_one_only: bool = False
    elimination_rounds: bool = False  # NEW: elimination mode

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

    # ── helpers ──────────────────────────────────────────────────────────────

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
            eliminated = list(out.get("eliminated") or [])
            for i, e in enumerate(eliminated):
                e = dict(e)
                e["username"] = uid_to_label.get(e.get("user_id"), "Anonymous")
                eliminated[i] = e
            out["eliminated"] = eliminated
            for c in out.get("chat") or []:
                c["username"] = uid_to_label.get(c.get("user_id"), "Anonymous")
        return out

    def _deal_round(players: list, deck: list) -> tuple:
        """Deal 2 cards to each active (not eliminated) player. Returns (updated_players, updated_deck)."""
        for p in players:
            if p.get("eliminated"):
                continue
            hand = [deck.pop(), deck.pop()]
            p["hand"] = hand
            p["status"] = "playing"
        return players, deck

    def _active_players(players: list) -> list:
        """Players who are still in the game (not eliminated)."""
        return [p for p in players if not p.get("eliminated")]

    async def _run_settle(game_id: str):
        """
        Settle current round.
        - If elimination_rounds: the player(s) with the lowest hand (or bust) are eliminated.
          If only 1 remains → they win. If a tie for last → all tied are eliminated.
          Refund eliminated players their buy-in from pot, winner gets remainder.
        - If not elimination_rounds: best hand wins the whole pot (original logic).
        """
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game or game.get("phase") not in ("playing", "dealer"):
            return

        players = list(game.get("players") or [])
        pot = int(game.get("pot") or 0)
        twenty_one_only = game.get("twenty_one_only") or False
        elimination_rounds = game.get("elimination_rounds") or False
        buy_in = int(game.get("buy_in") or 0)
        now_iso = datetime.now(timezone.utc).isoformat()

        active = _active_players(players)

        if elimination_rounds:
            # ── Elimination round logic ──────────────────────────────────────
            # Score each active player
            scored = []
            for p in active:
                total = _mp_bj_hand_total(p.get("hand") or [])
                is_bust = total > 21
                effective = -1 if is_bust else total
                if twenty_one_only:
                    effective = total if total == 21 else -1
                scored.append((p["user_id"], effective, total))

            # Find the lowest score (those to eliminate)
            min_score = min(s[1] for s in scored)

            # If all scores tied, no elimination this round (extremely rare edge case)
            to_eliminate_ids = [s[0] for s in scored if s[1] == min_score]
            surviving_ids = [s[0] for s in scored if s[1] != min_score]

            # Mark eliminated players
            eliminated_this_round = []
            for p in players:
                if p["user_id"] in to_eliminate_ids:
                    p["eliminated"] = True
                    p["status"] = "eliminated"
                    eliminated_this_round.append({
                        "user_id": p["user_id"],
                        "username": p.get("username"),
                        "round": int(game.get("current_round") or 1),
                        "hand_total": next((s[2] for s in scored if s[0] == p["user_id"]), 0),
                    })

            # Add to global eliminated list
            existing_eliminated = list(game.get("eliminated") or [])
            existing_eliminated.extend(eliminated_this_round)

            # Eliminated players do not get refunded — they lose their buy-in; pot stays for the winner.

            remaining_active = [p for p in players if not p.get("eliminated")]

            if len(remaining_active) <= 1:
                # Game over — last player wins the remaining pot
                winner_ids = [p["user_id"] for p in remaining_active]
                results = []
                for p in players:
                    uid = p["user_id"]
                    if uid in winner_ids:
                        if pot > 0:
                            await db.users.update_one({"id": uid}, {"$inc": {"money": pot}})
                        results.append({
                            "user_id": uid,
                            "username": p.get("username"),
                            "result": "win",
                            "payout": pot,
                        })
                    elif uid in to_eliminate_ids:
                        results.append({
                            "user_id": uid,
                            "username": p.get("username"),
                            "result": "eliminated",
                            "payout": 0,
                        })
                    else:
                        results.append({
                            "user_id": uid,
                            "username": p.get("username"),
                            "result": "eliminated",
                            "payout": 0,
                        })

                round_entry = {
                    "round": int(game.get("current_round") or 1),
                    "winner_username": remaining_active[0].get("username") if remaining_active else None,
                    "eliminated": None,
                }
                await db.mp_blackjack_games.update_one(
                    {"id": game_id},
                    {
                        "$set": {
                            "status": "completed",
                            "phase": "settled",
                            "completed_at": now_iso,
                            "winner_ids": winner_ids,
                            "results": results,
                            "players": players,
                            "pot": pot,
                            "eliminated": existing_eliminated,
                        },
                        "$push": {"round_history": {"$each": [round_entry], "$slice": -5}},
                    },
                )
            else:
                # Advance to next round
                next_round = int(game.get("current_round") or 1) + 1
                # Reset hands for remaining players
                new_deck = _mp_bj_make_deck()
                random.shuffle(new_deck)
                for p in players:
                    if not p.get("eliminated"):
                        p["hand"] = []
                        p["status"] = "waiting_ready"
                        p["ready"] = False

                round_entry = {
                    "round": int(game.get("current_round") or 1),
                    "winner_username": None,
                    "eliminated": [e.get("username") for e in eliminated_this_round],
                }
                await db.mp_blackjack_games.update_one(
                    {"id": game_id},
                    {
                        "$set": {
                            "phase": "ready",
                            "current_round": next_round,
                            "players": players,
                            "deck": new_deck,
                            "pot": pot,
                            "eliminated": existing_eliminated,
                            "current_turn_index": -1,
                            "all_ready_at": None,
                            "round_eliminated": [e["user_id"] for e in eliminated_this_round],
                        },
                        "$push": {"round_history": {"$each": [round_entry], "$slice": -5}},
                    },
                )
        else:
            # ── Original single-round logic ──────────────────────────────────
            best_total = -1
            for p in active:
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

            num_players = len(active)

            if winner_indices:
                winner_indices = [winner_indices[0]]

            winner_ids = [players[i].get("user_id") for i in winner_indices]
            payouts = {p.get("user_id"): 0 for p in players}

            if not winner_indices:
                # No winner (e.g. everyone busts): refund everyone their share of the pot so they can play again.
                refund_each = pot // num_players if num_players else 0
                remainder = pot - refund_each * num_players
                for i, p in enumerate(active):
                    uid = p.get("user_id")
                    add = refund_each + (remainder if i == 0 else 0)
                    payouts[uid] = add
                    if add > 0:
                        await db.users.update_one({"id": uid}, {"$inc": {"money": add}})
            else:
                # Winner takes full pot; everyone else loses their buy-in.
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

            winner_username = players[winner_indices[0]].get("username") if winner_indices else None
            round_entry = {"round": 1, "winner_username": winner_username, "eliminated": None}

            await db.mp_blackjack_games.update_one(
                {"id": game_id},
                {
                    "$set": {
                        "status": "completed",
                        "phase": "settled",
                        "completed_at": now_iso,
                        "winner_ids": winner_ids,
                        "results": results,
                    },
                    "$push": {"round_history": {"$each": [round_entry], "$slice": -5}},
                },
            )

    async def _maybe_auto_stand(game_id: str):
        """If current turn exceeded MP_BJ_TURN_SECONDS, auto-stand and advance."""
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
        active_statuses = ("playing",)
        while turn_idx < len(players) and (players[turn_idx].get("status") not in active_statuses or players[turn_idx].get("eliminated")):
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

    async def _maybe_start_from_ready(game_id: str):
        """
        If all active players are ready, record the all_ready_at timestamp.
        The frontend countdown triggers /start after MP_BJ_START_COUNTDOWN seconds.
        Returns updated game or None.
        """
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game or game.get("phase") != "ready":
            return None
        players = list(game.get("players") or [])
        active = _active_players(players)
        if not active:
            return None
        all_ready = all(p.get("ready") for p in active)
        if not all_ready:
            return None
        if game.get("all_ready_at"):
            return game  # already set
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.mp_blackjack_games.update_one(
            {"id": game_id},
            {"$set": {"all_ready_at": now_iso}}
        )
        return await db.mp_blackjack_games.find_one({"id": game_id})

    # ── Routes ───────────────────────────────────────────────────────────────

    @router.get("/casino/mp-blackjack/games")
    async def mp_bj_list_games(current_user: dict = Depends(get_current_user_verified)):
        """List open and in-progress multiplayer blackjack games."""
        cursor = db.mp_blackjack_games.find(
            {"status": {"$in": ["open", "playing"]}},
            {"_id": 0, "id": 1, "creator_id": 1, "creator_username": 1, "max_players": 1,
             "buy_in": 1, "extra_prize": 1, "pot": 1, "players": 1, "status": 1, "phase": 1,
             "created_at": 1, "anonymous": 1, "card_limit": 1, "exclude_yourself": 1,
             "twenty_one_only": 1, "elimination_rounds": 1, "current_round": 1,
             "current_turn_index": 1, "turn_started_at": 1},
        ).sort("created_at", -1)
        games = await cursor.to_list(100)
        uid = current_user.get("id")
        out = []
        for g in games:
            players_list = g.get("players") or []
            # Only count non-eliminated players for display
            active_count = sum(1 for p in players_list if not p.get("eliminated"))
            creator_name = g.get("creator_username")
            if g.get("anonymous"):
                creator_name = "Anonymous"
            row = {
                "id": g["id"],
                "creator_id": g.get("creator_id"),
                "creator_username": creator_name,
                "max_players": g.get("max_players", 6),
                "buy_in": g.get("buy_in", 0),
                "extra_prize": g.get("extra_prize", 0),
                "pot": g.get("pot", 0),
                "player_count": active_count,
                "total_player_count": len(players_list),
                "status": g.get("status"),
                "phase": g.get("phase"),
                "created_at": g.get("created_at"),
                "anonymous": g.get("anonymous", False),
                "card_limit": g.get("card_limit"),
                "exclude_yourself": g.get("exclude_yourself", False),
                "twenty_one_only": g.get("twenty_one_only", False),
                "elimination_rounds": g.get("elimination_rounds", False),
                "current_round": g.get("current_round", 1),
            }
            # Game activity for playing phase: whose turn, seconds left
            if g.get("status") == "playing" and g.get("phase") == "playing":
                turn_idx = int(g.get("current_turn_index") or -1)
                turn_started_at = g.get("turn_started_at")
                if turn_idx >= 0 and turn_idx < len(players_list) and turn_started_at:
                    try:
                        dt = datetime.fromisoformat(turn_started_at.replace("Z", "+00:00"))
                        elapsed = (datetime.now(timezone.utc) - dt).total_seconds()
                        row["turn_seconds_left"] = max(0, int(MP_BJ_TURN_SECONDS - elapsed))
                    except Exception:
                        row["turn_seconds_left"] = None
                    p = players_list[turn_idx]
                    if g.get("anonymous"):
                        row["current_turn_username"] = f"Player {turn_idx + 1}"
                    else:
                        row["current_turn_username"] = (p.get("username") or "Player").strip() or "Player"
                    row["current_turn_user_id"] = p.get("user_id")
                    row["current_turn_is_you"] = p.get("user_id") == uid
                else:
                    row["turn_seconds_left"] = None
                    row["current_turn_username"] = None
                    row["current_turn_user_id"] = None
                    row["current_turn_is_you"] = False
            else:
                row["turn_seconds_left"] = None
                row["current_turn_username"] = None
                row["current_turn_user_id"] = None
                row["current_turn_is_you"] = False
            out.append(row)
        return {"games": out}

    @router.get("/casino/mp-blackjack/recent-games")
    async def mp_bj_recent_games(current_user: dict = Depends(get_current_user_verified)):
        """Last 5 completed games with winner and prize for the lobby."""
        cursor = db.mp_blackjack_games.find(
            {"status": "completed"},
            {"_id": 0, "id": 1, "creator_username": 1, "buy_in": 1, "pot": 1, "results": 1, "winner_ids": 1, "players": 1, "completed_at": 1, "anonymous": 1, "elimination_rounds": 1},
        ).sort("completed_at", -1).limit(5)
        games = await cursor.to_list(5)
        out = []
        for g in games:
            winner_username = None
            results = g.get("results") or []
            win_result = next((r for r in results if r.get("result") == "win"), None)
            if win_result:
                winner_username = win_result.get("username") or "?"
            if g.get("anonymous"):
                winner_username = winner_username if winner_username else "Anonymous"
            out.append({
                "id": g.get("id"),
                "creator_username": "Anonymous" if g.get("anonymous") else (g.get("creator_username") or "—"),
                "buy_in": g.get("buy_in", 0),
                "pot": g.get("pot", 0),
                "winner_username": winner_username,
                "completed_at": g.get("completed_at").isoformat() if getattr(g.get("completed_at"), "isoformat", None) else g.get("completed_at"),
                "elimination_rounds": g.get("elimination_rounds", False),
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
        exclude_yourself = bool(request.exclude_yourself)
        anonymous = bool(request.anonymous)
        card_limit = request.card_limit
        twenty_one_only = bool(request.twenty_one_only)
        elimination_rounds = bool(request.elimination_rounds)

        if exclude_yourself:
            total_deduct = extra_prize
            players = []
            pot = extra_prize
        else:
            total_deduct = buy_in + extra_prize
            players = [{
                "user_id": uid,
                "username": username,
                "seat_index": 0,
                "hand": [],
                "status": "waiting",
                "bet": buy_in,
                "ready": False,
                "eliminated": False,
            }]
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
            "elimination_rounds": elimination_rounds,
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
            "eliminated": [],
            "chat": [],
            "turn_started_at": None,
            "all_ready_at": None,
            "current_round": 1,
            "round_eliminated": [],
            "round_history": [],
        }
        await db.mp_blackjack_games.insert_one(doc)
        await db.users.update_one({"id": uid}, {"$inc": {"money": -total_deduct}})
        await log_gambling(uid, username, "mp_blackjack", {"action": "create", "game_id": game_id, "buy_in": buy_in, "extra_prize": extra_prize})
        return {"message": "Game created", "game_id": game_id, "game": {k: v for k, v in doc.items() if k != "_id"}}

    @router.post("/casino/mp-blackjack/games/{game_id}/cancel")
    async def mp_bj_cancel(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Cancel an open/ready game. Creator, admin, or moderator. Refund all players."""
        uid = current_user["id"]
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.get("status") not in ("open", "playing") or game.get("phase") in ("playing", "dealer"):
            raise HTTPException(status_code=400, detail="Game cannot be cancelled at this stage")
        if game.get("creator_id") != uid and not _is_admin(current_user) and not _is_moderator(current_user):
            raise HTTPException(status_code=403, detail="Only the creator or staff can cancel the game")
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
        """Join an open game. Pay buy_in. Game moves to ready phase when full."""
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
        new_player = {
            "user_id": uid,
            "username": username,
            "seat_index": seat_index,
            "hand": [],
            "status": "waiting",
            "bet": buy_in,
            "ready": False,
            "eliminated": False,
        }
        players.append(new_player)
        new_pot = int(game.get("pot") or 0) + buy_in
        await db.users.update_one({"id": uid}, {"$inc": {"money": -buy_in}})
        now_iso = datetime.now(timezone.utc).isoformat()

        if len(players) >= max_players:
            # Table full — move to ready phase
            await db.mp_blackjack_games.update_one(
                {"id": game_id},
                {
                    "$set": {
                        "status": "playing",  # keep as playing so it shows in list
                        "phase": "ready",
                        "players": players,
                        "pot": new_pot,
                        "all_ready_at": None,
                    }
                },
            )
            await log_gambling(uid, username, "mp_blackjack", {"action": "join", "game_id": game_id, "buy_in": buy_in})
            updated = await db.mp_blackjack_games.find_one({"id": game_id})
            return {"message": "Joined — table is full! Ready up to start.", "game": _serialize_game(updated)}

        await db.mp_blackjack_games.update_one(
            {"id": game_id},
            {"$set": {"players": players, "pot": new_pot}},
        )
        await log_gambling(uid, username, "mp_blackjack", {"action": "join", "game_id": game_id, "buy_in": buy_in})
        updated = await db.mp_blackjack_games.find_one({"id": game_id})
        return {"message": "Joined", "game": _serialize_game(updated)}

    @router.post("/casino/mp-blackjack/games/{game_id}/ready")
    async def mp_bj_ready(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Mark self as ready. When all active players ready, sets all_ready_at timestamp."""
        uid = current_user["id"]
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.get("phase") != "ready":
            raise HTTPException(status_code=400, detail="Game is not in ready phase")
        players = list(game.get("players") or [])
        idx = next((i for i, p in enumerate(players) if p.get("user_id") == uid and not p.get("eliminated")), None)
        if idx is None:
            raise HTTPException(status_code=403, detail="You are not an active player in this game")
        if players[idx].get("ready"):
            raise HTTPException(status_code=400, detail="Already marked as ready")
        players[idx]["ready"] = True
        await db.mp_blackjack_games.update_one({"id": game_id}, {"$set": {"players": players}})
        # Check if all ready
        updated = await _maybe_start_from_ready(game_id)
        if updated is None:
            updated = await db.mp_blackjack_games.find_one({"id": game_id})
        return {"game": _serialize_game(updated)}

    @router.post("/casino/mp-blackjack/games/{game_id}/start")
    async def mp_bj_start(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """
        Called by frontend after countdown expires (all_ready_at + MP_BJ_START_COUNTDOWN seconds).
        Deals cards and begins the playing phase.
        """
        uid = current_user["id"]
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.get("phase") != "ready":
            raise HTTPException(status_code=400, detail="Game is not in ready phase")
        players = list(game.get("players") or [])
        # Verify caller is a player
        if not any(p.get("user_id") == uid and not p.get("eliminated") for p in players):
            raise HTTPException(status_code=403, detail="You are not an active player in this game")
        # Verify all ready
        active = _active_players(players)
        if not all(p.get("ready") for p in active):
            raise HTTPException(status_code=400, detail="Not all players are ready yet")
        # Verify countdown elapsed
        all_ready_at = game.get("all_ready_at")
        if all_ready_at:
            try:
                ready_dt = datetime.fromisoformat(all_ready_at.replace("Z", "+00:00"))
                elapsed = (datetime.now(timezone.utc) - ready_dt).total_seconds()
                if elapsed < MP_BJ_START_COUNTDOWN:
                    raise HTTPException(status_code=400, detail=f"Countdown not finished yet ({int(MP_BJ_START_COUNTDOWN - elapsed)}s remaining)")
            except HTTPException:
                raise
            except Exception:
                pass

        # Deal cards
        deck = _mp_bj_make_deck()
        random.shuffle(deck)
        players, deck = _deal_round(players, deck)

        # Find first active player's turn
        first_turn = next((i for i, p in enumerate(players) if not p.get("eliminated") and p.get("status") == "playing"), 0)

        now_iso = datetime.now(timezone.utc).isoformat()
        await db.mp_blackjack_games.update_one(
            {"id": game_id},
            {
                "$set": {
                    "status": "playing",
                    "phase": "playing",
                    "players": players,
                    "deck": deck,
                    "current_turn_index": first_turn,
                    "turn_started_at": now_iso,
                    "started_at": game.get("started_at") or now_iso,
                    "all_ready_at": game.get("all_ready_at"),
                    "round_eliminated": [],
                }
            },
        )
        updated = await db.mp_blackjack_games.find_one({"id": game_id})
        return {"message": "Game started", "game": _serialize_game(updated)}

    @router.get("/casino/mp-blackjack/games/{game_id}")
    async def mp_bj_get_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Get full game state. Applies turn timeout if needed."""
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        updated = await _maybe_auto_stand(game_id)
        if updated is not None:
            game = updated
        return {"game": _serialize_game(game)}

    @router.post("/casino/mp-blackjack/games/{game_id}/hit")
    async def mp_bj_hit(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Current player hits."""
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
        players[turn_idx]["hand"] = hand
        if total > 21:
            players[turn_idx]["status"] = "bust"
        turn_idx += 1
        while turn_idx < len(players) and (players[turn_idx].get("status") != "playing" or players[turn_idx].get("eliminated")):
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
        """Current player stands."""
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
        while turn_idx < len(players) and (players[turn_idx].get("status") != "playing" or players[turn_idx].get("eliminated")):
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
        msg = (request.message or "").strip()[:500]
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
        """Trigger turn timeout check."""
        game = await db.mp_blackjack_games.find_one({"id": game_id})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        updated = await _maybe_auto_stand(game_id)
        if updated is not None:
            game = updated
        return {"game": _serialize_game(game)}
