# Multiplayer Poker (Texas Hold'em): vs dealer (1v1 bot) and vs players (create/join tables)
# Real rules: blinds, preflop, flop, turn, river, betting rounds, showdown
from datetime import datetime, timezone
from typing import List, Optional, Tuple
import secrets
_rng = secrets.SystemRandom()
import uuid
import itertools

from pydantic import BaseModel, field_validator
from fastapi import Depends, HTTPException, Body

from server import db, get_current_user, get_current_user_verified, log_gambling, _is_admin

# ----- Constants -----
MP_POKER_SUITS = ["H", "D", "C", "S"]
MP_POKER_VALUES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
MP_POKER_TURN_SECONDS = 60
MP_POKER_CHAT_MAX = 100
MP_POKER_START_COUNTDOWN = 5
MP_POKER_MIN_PLAYERS = 2
MP_POKER_MAX_PLAYERS = 9
MP_POKER_MAX_BUY_IN = 1_000_000_000
MP_POKER_MAX_EXTRA_PRIZE = 1_000_000_000
MP_POKER_VS_DEALER_MIN_BLIND = 1000
MP_POKER_VS_DEALER_MAX_BLIND = 50_000_000

# Hand rank categories (higher = better)
HAND_HIGH_CARD = 0
HAND_PAIR = 1
HAND_TWO_PAIR = 2
HAND_THREE_KIND = 3
HAND_STRAIGHT = 4
HAND_FLUSH = 5
HAND_FULL_HOUSE = 6
HAND_FOUR_KIND = 7
HAND_STRAIGHT_FLUSH = 8


def _make_deck() -> List[dict]:
    return [{"suit": s, "value": v} for s in MP_POKER_SUITS for v in MP_POKER_VALUES]


def _card_rank(card: dict) -> int:
    """Numeric rank 2-14 (A=14)."""
    v = (card or {}).get("value")
    if v == "A":
        return 14
    if v in ("K", "Q", "J"):
        return {"K": 13, "Q": 12, "J": 11}[v]
    try:
        return int(v) if v else 2
    except (TypeError, ValueError):
        return 2


def _card_suit(card: dict) -> str:
    return (card or {}).get("suit") or ""


def _ranks_sorted(cards: List[dict], descending: bool = True) -> List[int]:
    r = [_card_rank(c) for c in cards]
    return sorted(r, reverse=descending)


def _is_flush(cards: List[dict]) -> bool:
    if len(cards) < 5:
        return False
    suits = [_card_suit(c) for c in cards]
    return max(suits.count(s) for s in suits) >= 5


def _is_straight(ranks: List[int]) -> Optional[int]:
    """Returns high card of straight or None. Ranks should be sorted desc. Ace-low straight (5-4-3-2-A) = 5."""
    if len(ranks) < 5:
        return None
    uniq = sorted(set(ranks), reverse=True)
    for i in range(len(uniq) - 4):
        run = uniq[i:i + 5]
        if run[0] - run[4] == 4:
            return run[0]
    if 14 in uniq:
        low = [r for r in uniq if r <= 5]
        if 5 in low and 4 in low and 3 in low and 2 in low:
            return 5
    return None


def _eval_five(cards: List[dict]) -> Tuple[int, Tuple]:
    """Evaluate 5 cards. Return (category, tiebreaker_tuple)."""
    if len(cards) != 5:
        ranks = _ranks_sorted(cards)[:5]
        return (HAND_HIGH_CARD, tuple(ranks + [0] * (5 - len(ranks))))
    ranks = _ranks_sorted(cards)
    rcount = {}
    for r in ranks:
        rcount[r] = rcount.get(r, 0) + 1
    counts = sorted(rcount.items(), key=lambda x: (-x[1], -x[0]))
    is_flush = _is_flush(cards)
    straight_high = _is_straight(ranks)

    if is_flush and straight_high:
        return (HAND_STRAIGHT_FLUSH, (straight_high,))

    if counts[0][1] == 4:
        quad = counts[0][0]
        kicker = counts[1][0]
        return (HAND_FOUR_KIND, (quad, kicker))

    if counts[0][1] == 3 and counts[1][1] >= 2:
        trip, pair = counts[0][0], counts[1][0]
        return (HAND_FULL_HOUSE, (trip, pair))

    if is_flush:
        return (HAND_FLUSH, tuple(ranks[:5]))

    if straight_high:
        return (HAND_STRAIGHT, (straight_high,))

    if counts[0][1] == 3:
        trip = counts[0][0]
        kickers = [c[0] for c in counts if c[0] != trip][:2]
        return (HAND_THREE_KIND, (trip,) + tuple(kickers))

    if counts[0][1] == 2 and counts[1][1] == 2:
        p1, p2 = counts[0][0], counts[1][0]
        kicker = next((c[0] for c in counts if c[0] not in (p1, p2)), 0)
        return (HAND_TWO_PAIR, (max(p1, p2), min(p1, p2), kicker))

    if counts[0][1] == 2:
        pair = counts[0][0]
        kickers = [c[0] for c in counts if c[0] != pair][:3]
        return (HAND_PAIR, (pair,) + tuple(kickers))

    return (HAND_HIGH_CARD, tuple(ranks[:5]))


def _best_hand_seven(hole: List[dict], board: List[dict]) -> Tuple[int, Tuple]:
    """Best 5-card hand from 2 hole + 5 board (or fewer board cards)."""
    all_cards = list(hole) + list(board)
    if len(all_cards) < 5:
        return (HAND_HIGH_CARD, (0,) * 5)
    best = (HAND_HIGH_CARD, (0,))
    for combo in itertools.combinations(all_cards, 5):
        ev = _eval_five(list(combo))
        if ev > best:
            best = ev
    return best


def _rank_to_name(r: int) -> str:
    """Convert numeric rank 2-14 to display name."""
    if r == 14:
        return "Aces"
    if r == 13:
        return "Kings"
    if r == 12:
        return "Queens"
    if r == 11:
        return "Jacks"
    if r == 10:
        return "Tens"
    if 2 <= r <= 9:
        return f"{r}s"
    return "?"


def _hand_rank_name(category: int) -> str:
    names = {
        HAND_HIGH_CARD: "High Card",
        HAND_PAIR: "Pair",
        HAND_TWO_PAIR: "Two Pair",
        HAND_THREE_KIND: "Three of a Kind",
        HAND_STRAIGHT: "Straight",
        HAND_FLUSH: "Flush",
        HAND_FULL_HOUSE: "Full House",
        HAND_FOUR_KIND: "Four of a Kind",
        HAND_STRAIGHT_FLUSH: "Straight Flush",
    }
    return names.get(category, "High Card")


def _hand_description(category: int, tie: Tuple) -> str:
    """Human-readable hand description, e.g. 'Pair of Aces', 'Two Pair, Fives and Twos'."""
    base = _hand_rank_name(category)
    if not tie:
        return base
    if category == HAND_PAIR and len(tie) >= 1:
        return f"Pair of {_rank_to_name(tie[0])}"
    if category == HAND_TWO_PAIR and len(tie) >= 2:
        return f"Two Pair, {_rank_to_name(tie[0])} and {_rank_to_name(tie[1])}"
    if category == HAND_THREE_KIND and len(tie) >= 1:
        return f"Three of a Kind, {_rank_to_name(tie[0])}"
    if category == HAND_FULL_HOUSE and len(tie) >= 2:
        return f"Full House, {_rank_to_name(tie[0])} full of {_rank_to_name(tie[1])}"
    if category == HAND_FOUR_KIND and len(tie) >= 1:
        return f"Four of a Kind, {_rank_to_name(tie[0])}"
    if category in (HAND_STRAIGHT, HAND_STRAIGHT_FLUSH) and len(tie) >= 1:
        high = tie[0]
        if high == 14:
            return f"{base} (Ace high)"
        if high == 13:
            return f"{base} (King high)"
        if high == 12:
            return f"{base} (Queen high)"
        if high == 5:
            return f"{base} (5 high)"
        return f"{base} ({_rank_to_name(high).rstrip('s')} high)"
    if category == HAND_HIGH_CARD and len(tie) >= 1:
        return f"High Card, {_rank_to_name(tie[0])}"
    return base


def _enrich_players_current_hand(g: dict) -> None:
    """Set current_hand_name on each player (for API response only; not persisted)."""
    if not g:
        return
    players = list(g.get("players") or [])
    board = list(g.get("board") or [])
    if len(board) < 3:
        return
    for p in players:
        if p.get("status") == "folded":
            continue
        hole = p.get("hole_cards") or []
        if len(hole) < 2:
            continue
        cat, _ = _best_hand_seven(hole, board)
        p["current_hand_name"] = _hand_rank_name(cat)


class PokerCreateRequest(BaseModel):
    max_players: int = 6
    buy_in: int = 100_000
    extra_prize: int = 0
    small_blind: int = 0


def register(router):
    # ── Vs Dealer helpers ─────────────────────────────────────────────────────
    async def _vs_dealer_showdown(game_id: str):
        claim = await db.mp_poker_games.update_one(
            {"id": game_id, "status": {"$ne": "completed"}},
            {"$set": {"status": "completed", "phase": "settled"}},
        )
        if claim.modified_count == 0:
            return
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g:
            return
        players = list(g.get("players") or [])
        board = list(g.get("board") or [])
        pot = int(g.get("pot") or 0)
        uid = g.get("user_id")
        active = [p for p in players if p.get("status") not in ("folded",)]
        if len(active) == 1:
            winner = active[0]
            best = None
        else:
            best = None
            winner = None
            for p in active:
                hole = p.get("hole_cards") or []
                cat, tie = _best_hand_seven(hole, board)
                if best is None or (cat, tie) > best:
                    best = (cat, tie)
                    winner = p
        now_iso = datetime.now(timezone.utc).isoformat()
        results = []
        hand_name = None
        if winner and len(active) > 1 and best:
            hand_name = _hand_description(best[0], best[1])
        if winner and winner.get("user_id") == uid and pot > 0:
            await db.users.update_one({"id": uid}, {"$inc": {"money": pot}})
            await log_gambling(uid, g.get("username") or "?", "mp_poker", {"action": "payout", "game_id": game_id, "winnings": pot})
            results.append({"user_id": uid, "result": "win", "payout": pot, "hand": hand_name})
            results.append({"user_id": "dealer", "result": "lose", "payout": 0})
        elif winner and winner.get("user_id") == "dealer":
            results.append({"user_id": uid, "result": "lose", "payout": 0})
            results.append({"user_id": "dealer", "result": "win", "payout": pot, "hand": hand_name})
        else:
            results.append({"user_id": uid, "result": "win" if winner and winner.get("user_id") == uid else "lose", "payout": pot if winner and winner.get("user_id") == uid else 0, "hand": hand_name if winner and winner.get("user_id") == uid else None})
            results.append({"user_id": "dealer", "result": "lose" if winner and winner.get("user_id") == uid else "win", "payout": 0 if winner and winner.get("user_id") == uid else pot, "hand": hand_name if winner and winner.get("user_id") == "dealer" else None})
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {"$set": {"results": results, "completed_at": now_iso}},
        )

    async def _vs_dealer_advance_street(game_id: str) -> Optional[dict]:
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("status") != "playing":
            return g
        street = g.get("street")
        deck = list(g.get("deck") or [])
        board = list(g.get("board") or [])
        players = list(g.get("players") or [])
        for p in players:
            p["current_bet"] = 0
        if street == "preflop":
            for _ in range(3):
                if deck:
                    board.append(deck.pop())
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"street": "flop", "board": board, "deck": deck, "players": players, "current_turn_index": 0, "to_call": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
            )
        elif street == "flop":
            if deck:
                board.append(deck.pop())
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"street": "turn", "board": board, "deck": deck, "players": players, "current_turn_index": 0, "to_call": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
            )
        elif street == "turn":
            if deck:
                board.append(deck.pop())
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"street": "river", "board": board, "deck": deck, "players": players, "current_turn_index": 0, "to_call": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
            )
        elif street == "river":
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"street": "showdown", "players": players}},
            )
            await _vs_dealer_showdown(game_id)
        return await db.mp_poker_games.find_one({"id": game_id})

    async def _vs_dealer_run_out_all_in(game_id: str) -> Optional[dict]:
        """When human is all-in, run out flop->turn->river->showdown so the hand completes."""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("status") != "playing":
            return g
        players = list(g.get("players") or [])
        human = next((p for p in players if not p.get("is_bot")), None)
        if not human or human.get("status") != "all_in":
            return g
        while g and g.get("street") in ("preflop", "flop", "turn", "river"):
            g = await _vs_dealer_advance_street(game_id)
        return await db.mp_poker_games.find_one({"id": game_id})

    async def _run_vs_dealer_bot_turn(game_id: str) -> Optional[dict]:
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("current_turn_index") != 1:
            return g
        players = list(g.get("players") or [])
        bot = next((p for p in players if p.get("is_bot")), None)
        human = next((p for p in players if not p.get("is_bot")), None)
        if not bot or not human or bot.get("status") == "folded" or human.get("status") == "folded":
            await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"street": "showdown"}})
            await _vs_dealer_showdown(game_id)
            return await db.mp_poker_games.find_one({"id": game_id})
        board = list(g.get("board") or [])
        to_call = int(g.get("to_call") or 0)
        min_raise = int(g.get("min_raise") or g.get("big_blind", 1) * 2)
        pot = int(g.get("pot") or 0)
        bot_stack = int(bot.get("stack") or 0)
        cat, _ = _best_hand_seven(bot.get("hole_cards") or [], board)
        call_amount = min(to_call - int(bot.get("current_bet") or 0), bot_stack)
        if call_amount < 0:
            call_amount = 0
        if to_call <= 0:
            # Bot checks — betting round is complete; advance street (deal flop/turn/river) then human acts first
            bot["last_action"] = {"action": "check"}
            await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"players": players}})
            await _vs_dealer_advance_street(game_id)
            return await db.mp_poker_games.find_one({"id": game_id})
        if cat >= HAND_PAIR and bot_stack >= min_raise and _rng.random() < 0.6:
            raise_amt = min(min_raise, bot_stack)
            bot["stack"] -= raise_amt
            bot["current_bet"] = int(bot.get("current_bet") or 0) + raise_amt
            bot["total_bet_this_hand"] = int(bot.get("total_bet_this_hand") or 0) + raise_amt
            bot["last_action"] = {"action": "raise", "amount": raise_amt}
            new_pot = pot + raise_amt
            new_to_call = raise_amt - int(human.get("current_bet") or 0)
            new_min_raise = raise_amt
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "pot": new_pot, "to_call": new_to_call, "min_raise": new_min_raise, "current_turn_index": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
            )
            # Human is all-in so cannot respond to the raise — run out the board
            if human.get("status") == "all_in":
                await _vs_dealer_run_out_all_in(game_id)
            return await db.mp_poker_games.find_one({"id": game_id})
        elif call_amount <= bot_stack and (call_amount <= int(g.get("big_blind") or 0) * 2 or cat >= HAND_PAIR or _rng.random() < 0.5):
            bot["stack"] -= call_amount
            bot["current_bet"] = int(bot.get("current_bet") or 0) + call_amount
            bot["total_bet_this_hand"] = int(bot.get("total_bet_this_hand") or 0) + call_amount
            bot["last_action"] = {"action": "call", "amount": call_amount}
            new_pot = pot + call_amount
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "pot": new_pot, "to_call": 0, "current_turn_index": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
            )
            g = await db.mp_poker_games.find_one({"id": game_id})
            human = next((p for p in (g.get("players") or []) if not p.get("is_bot")), None)
            # If human is all-in, run out the board regardless of bet sizes (avoids stuck state; showdown handles main/side pot)
            if human and human.get("status") == "all_in":
                await _vs_dealer_run_out_all_in(game_id)
            else:
                human_bet = next((p.get("current_bet") for p in g.get("players") or [] if not p.get("is_bot")), 0)
                bot_bet = next((p.get("current_bet") for p in g.get("players") or [] if p.get("is_bot")), 0)
                if human_bet == bot_bet:
                    await _vs_dealer_advance_street(game_id)
        else:
            bot["status"] = "folded"
            bot["last_action"] = {"action": "fold"}
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "street": "showdown"}},
            )
            await _vs_dealer_showdown(game_id)
        return await db.mp_poker_games.find_one({"id": game_id})

    @router.post("/casino/mp-poker/vs-dealer/start")
    async def vs_dealer_start(
        current_user: dict = Depends(get_current_user_verified),
        blind: Optional[int] = Body(None, embed=True),
    ):
        """Start a new 1v1 vs dealer game. Body: { blind?: number }."""
        uid = current_user.get("id") or ""
        blind = blind or 5000
        blind = max(MP_POKER_VS_DEALER_MIN_BLIND, min(MP_POKER_VS_DEALER_MAX_BLIND, int(blind)))
        game_id = str(uuid.uuid4())
        deck = _make_deck()
        _rng.shuffle(deck)
        human_stack = blind * 20
        bot_stack = blind * 20
        human = {
            "user_id": uid,
            "username": current_user.get("username") or "Player",
            "seat_index": 0,
            "hole_cards": [deck.pop(), deck.pop()],
            "stack": human_stack,
            "current_bet": 0,
            "total_bet_this_hand": 0,
            "status": "active",
            "is_bot": False,
        }
        bot = {
            "user_id": "dealer",
            "username": "Dealer",
            "seat_index": 1,
            "hole_cards": [deck.pop(), deck.pop()],
            "stack": bot_stack,
            "current_bet": 0,
            "total_bet_this_hand": 0,
            "status": "active",
            "is_bot": True,
        }
        human["stack"] -= blind
        human["current_bet"] = blind
        human["total_bet_this_hand"] = blind
        bot["stack"] -= blind * 2
        bot["current_bet"] = blind * 2
        bot["total_bet_this_hand"] = blind * 2
        pot = blind * 3
        deduct_result = await db.users.update_one(
            {"id": uid, "money": {"$gte": human_stack}},
            {"$inc": {"money": -human_stack}},
        )
        if deduct_result.modified_count == 0:
            raise HTTPException(status_code=400, detail="Need at least 4x blind to play")
        await log_gambling(uid, (current_user.get("username") or "?"), "mp_poker", {"action": "create", "game_id": game_id, "buy_in": human_stack, "mode": "vs_dealer"})
        now_iso = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": game_id,
            "mode": "vs_dealer",
            "user_id": uid,
            "status": "playing",
            "phase": "playing",
            "street": "preflop",
            "players": [human, bot],
            "deck": deck,
            "board": [],
            "pot": pot,
            "small_blind": blind,
            "big_blind": blind * 2,
            "current_turn_index": 0,
            "turn_started_at": now_iso,
            "min_raise": blind * 2,
            "to_call": blind * 2,
            "hand_number": 1,
            "created_at": now_iso,
            "results": None,
        }
        await db.mp_poker_games.insert_one(doc)
        return {"game_id": game_id, "game": {k: v for k, v in doc.items() if k != "_id"}}

    @router.get("/casino/mp-poker/vs-dealer/game")
    async def vs_dealer_game(current_user: dict = Depends(get_current_user_verified)):
        """Get current vs-dealer game for user. If it's bot's turn, runs bot action and returns updated game.
        When no active game, returns the most recent game (including completed) so the results screen doesn't flicker."""
        uid = current_user.get("id") or ""
        g = await db.mp_poker_games.find_one(
            {"mode": "vs_dealer", "user_id": uid, "status": "playing"},
            sort=[("created_at", -1)],
        )
        if not g:
            # Return most recent vs_dealer game (e.g. completed) so client can show results without "game not found" flicker
            g = await db.mp_poker_games.find_one(
                {"mode": "vs_dealer", "user_id": uid},
                sort=[("created_at", -1)],
            )
        if not g:
            return {"game": None}
        if g.get("status") == "playing" and g.get("current_turn_index") == 1:
            g = await _run_vs_dealer_bot_turn(g["id"])
        _enrich_players_current_hand(g)
        out = {k: v for k, v in (g or {}).items() if k != "_id"}
        return {"game": out}

    @router.post("/casino/mp-poker/vs-dealer/act")
    async def vs_dealer_act(
        current_user: dict = Depends(get_current_user_verified),
        action: Optional[str] = Body(None, embed=True),
        amount: Optional[int] = Body(None, embed=True),
        game_id: Optional[str] = Body(None, embed=True),
    ):
        """Act in vs-dealer game: fold, check, call, bet, raise, all_in. amount required for bet/raise. Optional game_id to target specific game."""
        uid = current_user.get("id") or ""
        action = (action or "").strip().lower()
        amount = amount or 0
        game_id = (game_id or "").strip() or None
        if game_id:
            g = await db.mp_poker_games.find_one({"id": game_id, "mode": "vs_dealer", "user_id": uid, "status": "playing"})
        else:
            g = await db.mp_poker_games.find_one({"mode": "vs_dealer", "user_id": uid, "status": "playing"}, sort=[("created_at", -1)])
        if not g:
            raise HTTPException(status_code=404, detail="No active vs-dealer game")
        if g.get("current_turn_index") != 0:
            raise HTTPException(status_code=400, detail="Not your turn")
        players = list(g.get("players") or [])
        human = next((p for p in players if p.get("user_id") == uid), None)
        bot = next((p for p in players if p.get("is_bot")), None)
        if not human or human.get("status") == "folded":
            raise HTTPException(status_code=400, detail="Cannot act")
        to_call = int(g.get("to_call") or 0)
        min_raise = int(g.get("min_raise") or g.get("big_blind", 1) * 2)
        pot = int(g.get("pot") or 0)
        stack = int(human.get("stack") or 0)
        current_bet = int(human.get("current_bet") or 0)
        need_to_call = to_call - current_bet
        if action == "fold":
            human["status"] = "folded"
            human["last_action"] = {"action": "fold"}
            await db.mp_poker_games.update_one({"id": g["id"]}, {"$set": {"players": players, "street": "showdown"}})
            await _vs_dealer_showdown(g["id"])
            g = await db.mp_poker_games.find_one({"id": g["id"]})
            _enrich_players_current_hand(g)
            return {"game": {k: v for k, v in (g or {}).items() if k != "_id"}}
        if action == "check":
            if need_to_call > 0:
                raise HTTPException(status_code=400, detail="Cannot check, must call or fold")
            human["current_bet"] = current_bet
            human["last_action"] = {"action": "check"}
        elif action == "call":
            amt = min(need_to_call, stack)
            human["stack"] -= amt
            human["current_bet"] = current_bet + amt
            human["total_bet_this_hand"] = int(human.get("total_bet_this_hand") or 0) + amt
            pot += amt
            human["last_action"] = {"action": "call", "amount": amt}
        elif action in ("bet", "raise"):
            amt = max(amount, min_raise) if action == "raise" else amount
            if action == "bet" and amt < min_raise:
                raise HTTPException(status_code=400, detail=f"Bet must be at least {min_raise:,}")
            if amt < min_raise and to_call > 0:
                raise HTTPException(status_code=400, detail=f"Raise must be at least {min_raise:,}")
            if amt > stack:
                amt = stack
            if amt <= 0:
                raise HTTPException(status_code=400, detail=f"Bet/raise must be at least {min_raise:,}")
            human["stack"] -= amt
            human["current_bet"] = current_bet + amt
            human["total_bet_this_hand"] = int(human.get("total_bet_this_hand") or 0) + amt
            pot += amt
            human["last_action"] = {"action": action, "amount": amt}
            new_to_call = human["current_bet"] - int(bot.get("current_bet") or 0)
            min_raise = amt
        elif action == "all_in":
            amt = stack
            human["stack"] = 0
            human["current_bet"] = current_bet + amt
            human["total_bet_this_hand"] = int(human.get("total_bet_this_hand") or 0) + amt
            human["status"] = "all_in"
            pot += amt
            human["last_action"] = {"action": "all_in", "amount": amt}
            new_to_call = max(0, human["current_bet"] - int(bot.get("current_bet") or 0))
        else:
            raise HTTPException(status_code=400, detail="Invalid action")
        if action in ("call", "check"):
            new_to_call = 0
            bot_bet = int(bot.get("current_bet") or 0)
            human_bet = int(human.get("current_bet") or 0)
            if human_bet == bot_bet:
                street = g.get("street")
                # Human check/call completed the round. On river, go straight to showdown so the hand doesn't get stuck.
                if street == "river":
                    for p in players:
                        p["current_bet"] = 0
                    await db.mp_poker_games.update_one(
                        {"id": g["id"]},
                        {"$set": {"players": players, "pot": pot, "to_call": 0, "street": "showdown"}},
                    )
                    await _vs_dealer_showdown(g["id"])
                    g = await db.mp_poker_games.find_one({"id": g["id"]})
                    _enrich_players_current_hand(g)
                    return {"game": {k: v for k, v in (g or {}).items() if k != "_id"}}
                g = await db.mp_poker_games.find_one({"id": g["id"]})
                await db.mp_poker_games.update_one(
                    {"id": g["id"]},
                    {"$set": {"players": players, "pot": pot, "to_call": 0, "current_turn_index": 1, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
                )
                g = await _run_vs_dealer_bot_turn(g["id"])
                _enrich_players_current_hand(g)
                return {"game": {k: v for k, v in (g or {}).items() if k != "_id"}}
        await db.mp_poker_games.update_one(
            {"id": g["id"]},
            {"$set": {"players": players, "pot": pot, "to_call": new_to_call if action in ("bet", "raise", "all_in") else 0, "min_raise": min_raise if action in ("bet", "raise", "all_in") else g.get("min_raise"), "current_turn_index": 1, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
        )
        g = await _run_vs_dealer_bot_turn(g["id"])
        _enrich_players_current_hand(g)
        return {"game": {k: v for k, v in (g or {}).items() if k != "_id"}}

    # ── Vs Players: list, create, join, etc. ───────────────────────────────────
    @router.get("/casino/mp-poker/games")
    async def list_games(current_user: dict = Depends(get_current_user_verified)):
        """List open and in-progress multiplayer poker games."""
        cursor = db.mp_poker_games.find(
            {"mode": "vs_players", "status": {"$in": ["open", "playing"]}},
            {"_id": 0, "id": 1, "creator_id": 1, "creator_username": 1, "max_players": 1,
             "buy_in": 1, "extra_prize": 1, "pot": 1, "players": 1, "status": 1, "phase": 1,
             "created_at": 1, "small_blind": 1, "big_blind": 1},
        ).sort("created_at", -1)
        games = await cursor.to_list(100)
        out = []
        for g in games:
            players_list = g.get("players") or []
            out.append({
                "id": g["id"],
                "creator_id": g.get("creator_id"),
                "creator_username": g.get("creator_username"),
                "max_players": g.get("max_players", 6),
                "buy_in": g.get("buy_in", 0),
                "extra_prize": g.get("extra_prize", 0),
                "pot": g.get("pot", 0),
                "player_count": len(players_list),
                "player_ids": [p.get("user_id") for p in players_list if p.get("user_id")],
                "status": g.get("status"),
                "phase": g.get("phase"),
                "created_at": g.get("created_at"),
                "small_blind": g.get("small_blind"),
                "big_blind": g.get("big_blind"),
            })
        return {"games": out}

    @router.get("/casino/mp-poker/recent-games")
    async def recent_games(current_user: dict = Depends(get_current_user_verified)):
        """Last 5 completed multiplayer poker games."""
        cursor = db.mp_poker_games.find(
            {"mode": "vs_players", "status": "completed"},
            {"_id": 0, "id": 1, "creator_username": 1, "pot": 1, "completed_at": 1, "results": 1},
        ).sort("completed_at", -1).limit(5)
        games = await cursor.to_list(5)
        return {"games": games}

    @router.post("/casino/mp-poker/games")
    async def create_game(
        request: PokerCreateRequest,
        current_user: dict = Depends(get_current_user_verified),
    ):
        """Create a new multiplayer poker table."""
        max_players = max(MP_POKER_MIN_PLAYERS, min(MP_POKER_MAX_PLAYERS, request.max_players))
        buy_in = max(0, min(MP_POKER_MAX_BUY_IN, request.buy_in))
        extra_prize = max(0, min(MP_POKER_MAX_EXTRA_PRIZE, request.extra_prize))
        uid = current_user.get("id") or ""
        username = current_user.get("username") or "Player"
        need = buy_in + extra_prize
        game_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        if request.small_blind > 0:
            small_blind = max(1, min(buy_in // 2, request.small_blind))
        else:
            small_blind = max(buy_in // 100, 1)
        big_blind = small_blind * 2
        players = [{
            "user_id": uid,
            "username": username,
            "seat_index": 0,
            "stack": buy_in,
            "hole_cards": [],
            "current_bet": 0,
            "total_bet_this_hand": 0,
            "status": "waiting",
            "ready": False,
            "is_bot": False,
        }]
        doc = {
            "id": game_id,
            "mode": "vs_players",
            "creator_id": uid,
            "creator_username": username,
            "max_players": max_players,
            "buy_in": buy_in,
            "extra_prize": extra_prize,
            "pot": extra_prize,
            "small_blind": small_blind,
            "big_blind": big_blind,
            "status": "open",
            "phase": "lobby",
            "players": players,
            "street": None,
            "board": [],
            "deck": [],
            "current_turn_index": -1,
            "turn_started_at": None,
            "button_index": 0,
            "hand_number": 0,
            "created_at": now_iso,
            "chat": [],
        }
        deduct_result = await db.users.update_one(
            {"id": uid, "money": {"$gte": need}},
            {"$inc": {"money": -need}},
        )
        if deduct_result.modified_count == 0:
            raise HTTPException(status_code=400, detail="Insufficient funds")
        await log_gambling(uid, username, "mp_poker", {"action": "create", "game_id": game_id, "buy_in": need, "mode": "vs_players"})
        await db.mp_poker_games.insert_one(doc)
        return {"game_id": game_id, "game": {k: v for k, v in doc.items() if k != "_id"}}

    @router.get("/casino/mp-poker/games/{game_id}")
    async def get_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Get full game state. For vs_dealer, if it's bot's turn, run bot action and return updated game.
        For vs_players in showdown, run showdown so the game settles and clients don't get stuck."""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g:
            raise HTTPException(status_code=404, detail="Game not found")
        if g.get("mode") == "vs_dealer" and g.get("status") == "playing":
            if g.get("current_turn_index") == 1:
                g = await _run_vs_dealer_bot_turn(game_id)
            # If human is all-in and we're still on flop/turn/river, run out the board so "Check Result" resolves
            players = list(g.get("players") or [])
            human = next((p for p in players if not p.get("is_bot")), None)
            if human and human.get("status") == "all_in" and g.get("street") in ("flop", "turn", "river"):
                g = await _vs_dealer_run_out_all_in(game_id)
        if g.get("mode") == "vs_players" and g.get("status") == "playing" and g.get("street") == "showdown":
            await _mp_poker_run_showdown(game_id)
            g = await db.mp_poker_games.find_one({"id": game_id})
        _enrich_players_current_hand(g)
        return {k: v for k, v in (g or {}).items() if k != "_id"}

    @router.post("/casino/mp-poker/games/{game_id}/join")
    async def join_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Join an open poker game."""
        uid = current_user.get("id") or ""
        username = current_user.get("username") or "Player"
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") != "vs_players" or g.get("status") != "open":
            raise HTTPException(status_code=400, detail="Game not joinable")
        players = list(g.get("players") or [])
        if any(p.get("user_id") == uid for p in players):
            raise HTTPException(status_code=400, detail="Already in game")
        if len(players) >= g.get("max_players", 6):
            raise HTTPException(status_code=400, detail="Game full")
        buy_in = int(g.get("buy_in") or 0)
        join_deduct = await db.users.update_one(
            {"id": uid, "money": {"$gte": buy_in}},
            {"$inc": {"money": -buy_in}},
        )
        if join_deduct.modified_count == 0:
            raise HTTPException(status_code=400, detail="Insufficient funds")
        players.append({
            "user_id": uid,
            "username": username,
            "seat_index": len(players),
            "stack": buy_in,
            "hole_cards": [],
            "current_bet": 0,
            "total_bet_this_hand": 0,
            "status": "waiting",
            "ready": False,
            "is_bot": False,
        })
        await log_gambling(uid, username, "mp_poker", {"action": "join", "game_id": game_id, "buy_in": buy_in})
        # 2+ players is enough to enter ready phase; creator can start once all current players are ready
        phase = "ready" if len(players) >= 2 else "lobby"
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {"$set": {"players": players, "phase": phase}},
        )
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {k: v for k, v in g.items() if k != "_id"}

    @router.post("/casino/mp-poker/games/{game_id}/cancel")
    async def cancel_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Cancel open/ready game; refund all."""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") != "vs_players":
            raise HTTPException(status_code=404, detail="Game not found")
        if g.get("status") not in ("open", "ready"):
            raise HTTPException(status_code=400, detail="Cannot cancel")
        uid = current_user.get("id") or ""
        if g.get("creator_id") != uid and not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Only creator can cancel")
        claim_res = await db.mp_poker_games.update_one(
            {"id": game_id, "status": {"$in": ("open", "ready")}},
            {"$set": {"status": "cancelled", "phase": "cancelled"}},
        )
        if claim_res.modified_count == 0:
            raise HTTPException(status_code=400, detail="Game already cancelled or in progress")
        players = g.get("players") or []
        buy_in = int(g.get("buy_in") or 0)
        extra = int(g.get("extra_prize") or 0)
        for p in players:
            refund = buy_in + (extra if p.get("user_id") == g.get("creator_id") else 0)
            if refund > 0:
                await db.users.update_one({"id": p.get("user_id") or ""}, {"$inc": {"money": refund}})
        return {"message": "Game cancelled"}

    @router.post("/casino/mp-poker/games/{game_id}/leave")
    async def leave_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Leave an open/ready multiplayer poker game before the hand starts.

        Non-creators can leave while the game is still in the lobby/ready phase.
        They get their buy-in back and are removed from the seats.
        """
        uid = current_user.get("id") or ""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") != "vs_players":
            raise HTTPException(status_code=404, detail="Game not found")
        # Only allow leaving before the first hand has started
        if g.get("status") != "open" or g.get("phase") not in ("lobby", "ready"):
            raise HTTPException(status_code=400, detail="Cannot leave at this stage")
        players = list(g.get("players") or [])
        idx = next((i for i, p in enumerate(players) if p.get("user_id") == uid), None)
        if idx is None:
            raise HTTPException(status_code=400, detail="You are not in this game")
        if g.get("creator_id") == uid and not _is_admin(current_user):
            # Creator should cancel the table instead so everyone is refunded consistently
            raise HTTPException(status_code=400, detail="Creator must cancel the table instead of leaving")
        buy_in = int(g.get("buy_in") or 0)
        # Remove player and refund their buy-in
        players.pop(idx)
        if buy_in > 0:
            await db.users.update_one({"id": uid}, {"$inc": {"money": buy_in}})
        # Re-seat remaining players
        for i, p in enumerate(players):
            p["seat_index"] = i
        # Recompute phase and ready state
        phase = "ready" if len(players) >= 2 else "lobby"
        all_ready_at = None
        if phase == "ready":
            all_ready = len(players) >= 2 and all(p.get("ready") for p in players)
            if all_ready:
                all_ready_at = g.get("all_ready_at") or datetime.now(timezone.utc).isoformat()
        updates = {"players": players, "phase": phase, "all_ready_at": all_ready_at}
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": updates})
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {k: v for k, v in g.items() if k != "_id"}

    @router.post("/casino/mp-poker/games/{game_id}/ready")
    async def ready_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Mark yourself ready. When all are ready, all_ready_at is set."""
        uid = current_user.get("id") or ""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") != "vs_players" or g.get("phase") not in ("lobby", "ready"):
            raise HTTPException(status_code=400, detail="Cannot ready")
        players = list(g.get("players") or [])
        for p in players:
            if p.get("user_id") == uid:
                p["ready"] = True
                break
        all_ready = len(players) >= 2 and all(p.get("ready") for p in players)
        now_iso = datetime.now(timezone.utc).isoformat()
        updates = {"players": players}
        if all_ready and not g.get("all_ready_at"):
            updates["all_ready_at"] = now_iso
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": updates})
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {k: v for k, v in g.items() if k != "_id"}

    async def _mp_poker_run_showdown(game_id: str):
        claim_res = await db.mp_poker_games.update_one(
            {"id": game_id, "street": "showdown", "status": {"$ne": "completed"}},
            {"$set": {"status": "completed", "phase": "settled"}},
        )
        if claim_res.modified_count == 0:
            return
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("street") != "showdown":
            return
        players = list(g.get("players") or [])
        board = list(g.get("board") or [])
        pot = int(g.get("pot") or 0)
        active = [p for p in players if p.get("status") not in ("folded",)]
        results = []
        if len(active) == 1:
            winner = active[0]
            uid = winner.get("user_id")
            if uid and uid != "dealer":
                await db.users.update_one({"id": uid}, {"$inc": {"money": pot}})
                await log_gambling(uid, winner.get("username") or "?", "mp_poker", {"action": "payout", "game_id": game_id, "winnings": pot})
            for p in players:
                results.append({
                    "user_id": p.get("user_id"),
                    "result": "win" if p.get("user_id") == uid else "lose",
                    "payout": pot if p.get("user_id") == uid else 0,
                    "hand": None,
                })
        else:
            best_rank = None
            winners = []
            winner_hand_name = None
            for p in active:
                hole = p.get("hole_cards") or []
                r = _best_hand_seven(hole, board)
                if best_rank is None or r > best_rank:
                    best_rank = r
                    winners = [p]
                    winner_hand_name = _hand_description(r[0], r[1]) if r else None
                elif r == best_rank:
                    winners.append(p)
            split = pot // len(winners)
            remainder = pot - split * len(winners)
            winner_payouts = {}
            for i, w in enumerate(winners):
                uid = w.get("user_id")
                winner_payouts[uid] = split + (remainder if i == 0 else 0)
                if uid and uid != "dealer" and winner_payouts[uid] > 0:
                    await db.users.update_one({"id": uid}, {"$inc": {"money": winner_payouts[uid]}})
                    await log_gambling(uid, w.get("username") or "?", "mp_poker", {"action": "payout", "game_id": game_id, "winnings": winner_payouts[uid]})
            for p in players:
                uid = p.get("user_id")
                results.append({
                    "user_id": uid,
                    "result": "win" if uid in winner_payouts else "lose",
                    "payout": winner_payouts.get(uid, 0),
                    "hand": winner_hand_name if uid in winner_payouts else None,
                })
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {"$set": {"status": "completed", "phase": "settled", "results": results, "completed_at": now_iso}},
        )

    def _first_actor_after_advance(players: list, start_idx: int) -> int:
        """First seat index that can act (not folded, not all_in). If none, return start_idx."""
        n = len(players)
        idx = start_idx % n
        for _ in range(n):
            if players[idx].get("status") not in ("folded", "all_in"):
                return idx
            idx = (idx + 1) % n
        return start_idx % n

    async def _mp_poker_advance_street(game_id: str) -> bool:
        """Advance to next street or showdown. Returns True if advanced. Skips folded/all_in for first to act."""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("status") != "playing":
            return False
        street = g.get("street")
        deck = list(g.get("deck") or [])
        board = list(g.get("board") or [])
        players = list(g.get("players") or [])
        n = len(players)
        for p in players:
            p["current_bet"] = 0
        button = int(g.get("button_index") or 0)
        if street == "preflop":
            for _ in range(3):
                if deck:
                    board.append(deck.pop())
            first = _first_actor_after_advance(players, (button + 3) % n)
            if players[first].get("status") in ("folded", "all_in"):
                await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"street": "showdown", "board": board, "players": players}})
                await _mp_poker_run_showdown(game_id)
            else:
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"street": "flop", "board": board, "deck": deck, "players": players, "current_turn_index": first, "first_turn_index_this_street": first, "to_call": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
                )
        elif street == "flop":
            if deck:
                board.append(deck.pop())
            first = _first_actor_after_advance(players, (button + 1) % n)
            if players[first].get("status") in ("folded", "all_in"):
                if deck:
                    board.append(deck.pop())
                await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"street": "showdown", "board": board, "deck": deck, "players": players}})
                await _mp_poker_run_showdown(game_id)
            else:
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"street": "turn", "board": board, "deck": deck, "players": players, "current_turn_index": first, "first_turn_index_this_street": first, "to_call": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
                )
        elif street == "turn":
            if deck:
                board.append(deck.pop())
            first = _first_actor_after_advance(players, (button + 1) % n)
            if players[first].get("status") in ("folded", "all_in"):
                await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"street": "showdown", "board": board, "deck": deck, "players": players}})
                await _mp_poker_run_showdown(game_id)
            else:
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"street": "river", "board": board, "deck": deck, "players": players, "current_turn_index": first, "first_turn_index_this_street": first, "to_call": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
                )
        elif street == "river":
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"street": "showdown", "players": players}},
            )
            await _mp_poker_run_showdown(game_id)
        return True

    @router.post("/casino/mp-poker/games/{game_id}/start")
    async def start_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Start the hand (deal, post blinds). Call after countdown when all ready."""
        uid = current_user.get("id") or ""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") != "vs_players" or g.get("phase") != "ready":
            raise HTTPException(status_code=400, detail="Game not in ready phase")
        players = list(g.get("players") or [])
        if not all(p.get("ready") for p in players) or len(players) < 2:
            raise HTTPException(status_code=400, detail="Not all ready")
        deck = _make_deck()
        _rng.shuffle(deck)
        sb = int(g.get("small_blind") or 1)
        bb = int(g.get("big_blind") or 2)
        button_index = int(g.get("button_index") or 0)
        n = len(players)
        for p in players:
            p["hole_cards"] = [deck.pop(), deck.pop()] if deck else []
            p["current_bet"] = 0
            p["total_bet_this_hand"] = 0
            p["status"] = "active"
        sb_seat = (button_index + 1) % n
        bb_seat = (button_index + 2) % n
        players[sb_seat]["stack"] = int(players[sb_seat].get("stack") or 0) - sb
        players[sb_seat]["current_bet"] = sb
        players[sb_seat]["total_bet_this_hand"] = sb
        players[bb_seat]["stack"] = int(players[bb_seat].get("stack") or 0) - bb
        players[bb_seat]["current_bet"] = bb
        players[bb_seat]["total_bet_this_hand"] = bb
        pot = int(g.get("pot") or 0) + sb + bb
        first_act = (button_index + 3) % n
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {"$set": {
                "status": "playing",
                "phase": "playing",
                "street": "preflop",
                "players": players,
                "deck": deck,
                "board": [],
                "pot": pot,
                "current_turn_index": first_act,
                "first_turn_index_this_street": first_act,
                "turn_started_at": now_iso,
                "to_call": bb - sb,
                "min_raise": bb,
                "hand_number": int(g.get("hand_number") or 0) + 1,
            }},
        )
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {k: v for k, v in g.items() if k != "_id"}

    @router.post("/casino/mp-poker/games/{game_id}/act")
    async def game_act(
        game_id: str,
        current_user: dict = Depends(get_current_user_verified),
        action: Optional[str] = Body(None, embed=True),
        amount: Optional[int] = Body(None, embed=True),
    ):
        """Fold, check, call, bet, raise, all_in."""
        uid = current_user.get("id") or ""
        action = (action or "").strip().lower()
        amount = amount or 0
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") != "vs_players" or g.get("status") != "playing":
            raise HTTPException(status_code=404, detail="Game not found or not playing")
        players = list(g.get("players") or [])
        turn_idx = int(g.get("current_turn_index") or 0)
        if turn_idx < 0 or turn_idx >= len(players) or players[turn_idx].get("user_id") != uid:
            raise HTTPException(status_code=400, detail="Not your turn")
        p = players[turn_idx]
        if p.get("status") in ("folded", "all_in"):
            raise HTTPException(status_code=400, detail="Cannot act")
        to_call = int(g.get("to_call") or 0)
        min_raise = int(g.get("min_raise") or g.get("big_blind", 1))
        pot = int(g.get("pot") or 0)
        stack = int(p.get("stack") or 0)
        current_bet = int(p.get("current_bet") or 0)
        need_to_call = to_call - current_bet
        if action == "fold":
            p["status"] = "folded"
            p["last_action"] = {"action": "fold"}
            active = [x for x in players if x.get("status") not in ("folded",)]
            if len(active) == 1:
                await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"players": players, "street": "showdown"}})
                await _mp_poker_run_showdown(game_id)
            else:
                next_idx = (turn_idx + 1) % len(players)
                while next_idx != turn_idx and (players[next_idx].get("status") in ("folded", "all_in")):
                    next_idx = (next_idx + 1) % len(players)
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"players": players, "current_turn_index": next_idx, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
                )
            g = await db.mp_poker_games.find_one({"id": game_id})
            return {k: v for k, v in (g or {}).items() if k != "_id"}
        if action == "check":
            if need_to_call > 0:
                raise HTTPException(status_code=400, detail="Cannot check")
            p["last_action"] = {"action": "check"}
        elif action == "call":
            amt = min(need_to_call, stack)
            p["stack"] = stack - amt
            p["current_bet"] = current_bet + amt
            p["total_bet_this_hand"] = int(p.get("total_bet_this_hand") or 0) + amt
            pot += amt
            p["last_action"] = {"action": "call", "amount": amt}
        elif action in ("bet", "raise"):
            amt = max(amount, min_raise) if to_call > 0 else amount
            if action == "bet" and amt < min_raise:
                raise HTTPException(status_code=400, detail=f"Bet must be at least {min_raise:,}")
            if amt > stack:
                amt = stack
            if amt <= 0:
                raise HTTPException(status_code=400, detail="Invalid amount")
            p["stack"] = stack - amt
            p["current_bet"] = current_bet + amt
            p["total_bet_this_hand"] = int(p.get("total_bet_this_hand") or 0) + amt
            pot += amt
            if amt >= stack:
                p["status"] = "all_in"
            p["last_action"] = {"action": action, "amount": amt}
            max_bet_amt = max(int(x.get("current_bet") or 0) for x in players)
            g["to_call"] = max_bet_amt
            g["min_raise"] = amt
        elif action == "all_in":
            amt = stack
            p["stack"] = 0
            p["current_bet"] = current_bet + amt
            p["total_bet_this_hand"] = int(p.get("total_bet_this_hand") or 0) + amt
            p["status"] = "all_in"
            pot += amt
            p["last_action"] = {"action": "all_in", "amount": amt}
            max_bet_amt = max(int(x.get("current_bet") or 0) for x in players)
            g["to_call"] = max_bet_amt
        else:
            raise HTTPException(status_code=400, detail="Invalid action")
        max_bet = max(int(x.get("current_bet") or 0) for x in players)
        all_in_or_folded = all(
            int(x.get("current_bet") or 0) == max_bet or x.get("status") in ("folded", "all_in")
            for x in players if x.get("status") not in ("folded",)
        )
        next_idx = (turn_idx + 1) % len(players)
        while next_idx != turn_idx and (players[next_idx].get("status") in ("folded", "all_in")):
            next_idx = (next_idx + 1) % len(players)
        updates = {"players": players, "pot": pot, "current_turn_index": next_idx, "turn_started_at": datetime.now(timezone.utc).isoformat()}
        if action in ("call", "check"):
            first_this_street = int(g.get("first_turn_index_this_street") or 0)
            # Advance when everyone has matched; if no one bet this street (max_bet==0) require turn to return to first actor
            betting_round_complete = all_in_or_folded and (max_bet > 0 or next_idx == first_this_street or next_idx == turn_idx)
            if betting_round_complete:
                updates["to_call"] = 0
                await db.mp_poker_games.update_one({"id": game_id}, {"$set": updates})
                await _mp_poker_advance_street(game_id)
            else:
                updates["to_call"] = max_bet
                await db.mp_poker_games.update_one({"id": game_id}, {"$set": updates})
        else:
            updates["to_call"] = g.get("to_call", max_bet)
            updates["min_raise"] = g.get("min_raise", min_raise)
            await db.mp_poker_games.update_one({"id": game_id}, {"$set": updates})
        g = await db.mp_poker_games.find_one({"id": game_id})
        _enrich_players_current_hand(g)
        return {k: v for k, v in (g or {}).items() if k != "_id"}

    @router.post("/casino/mp-poker/games/{game_id}/timeout")
    async def game_timeout(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Auto-fold on turn timeout. For vs_dealer, if current player is all-in, run out the board instead of folding."""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("status") != "playing":
            raise HTTPException(status_code=404, detail="Game not found")
        turn_idx = int(g.get("current_turn_index") or 0)
        players = list(g.get("players") or [])
        if turn_idx < 0 or turn_idx >= len(players) or players[turn_idx].get("user_id") != current_user.get("id") or "":
            return {k: v for k, v in g.items() if k != "_id"}
        # Vs dealer: if human is all-in, run out the board instead of folding (fixes stuck all-in hand)
        if g.get("mode") == "vs_dealer" and players[turn_idx].get("status") == "all_in":
            human = next((p for p in players if not p.get("is_bot")), None)
            if human and human.get("status") == "all_in" and g.get("street") in ("preflop", "flop", "turn", "river"):
                g = await _vs_dealer_run_out_all_in(game_id)
                _enrich_players_current_hand(g)
                return {k: v for k, v in (g or {}).items() if k != "_id"}
        players[turn_idx]["status"] = "folded"
        next_idx = (turn_idx + 1) % len(players)
        while next_idx != turn_idx and (players[next_idx].get("status") in ("folded", "all_in")):
            next_idx = (next_idx + 1) % len(players)
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {"$set": {"players": players, "current_turn_index": next_idx, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
        )
        active = [x for x in players if x.get("status") not in ("folded",)]
        if len(active) == 1:
            await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"street": "showdown"}})
            await _mp_poker_run_showdown(game_id)
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {k: v for k, v in (g or {}).items() if k != "_id"}

    @router.post("/casino/mp-poker/games/{game_id}/chat")
    async def game_chat(
        game_id: str,
        current_user: dict = Depends(get_current_user_verified),
        message: Optional[str] = Body(None, embed=True),
    ):
        """Send a chat message."""
        msg = (message or "").strip()[:MP_POKER_CHAT_MAX]
        if not msg:
            raise HTTPException(status_code=400, detail="Message required")
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g:
            raise HTTPException(status_code=404, detail="Game not found")
        chat = list(g.get("chat") or [])
        chat.append({"user_id": current_user.get("id") or "", "username": current_user.get("username") or "Player", "message": msg, "at": datetime.now(timezone.utc).isoformat()})
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"chat": chat[-50:]}})
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {k: v for k, v in g.items() if k != "_id"}