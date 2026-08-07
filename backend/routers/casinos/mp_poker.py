# Multiplayer Poker (Texas Hold'em): vs dealer (1v1 bot) and vs players (create/join tables)
# Real rules: blinds, preflop, flop, turn, river, betting rounds, showdown
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple
import secrets
_rng = secrets.SystemRandom()
import uuid
import itertools

from pydantic import BaseModel, field_validator, model_validator
from fastapi import Depends, HTTPException, Body

from server import db, get_current_user, get_current_user_verified, log_gambling, _is_admin, _is_moderator, _is_entertainer, send_notification, require_admin_verified
from utils.point_provenance import log_points_event
from utils.entertainer_service import (
    ENTERTAINER_MP_POKER_MAX_POINTS_PER_GAME,
    try_debit_entertainer_fund,
    insert_funded_game_row,
    on_funded_game_completed,
)
from routers.casinos.mp_poker_flow import (
    classify_player_action as _classify_player_action,
    is_betting_round_complete as _is_betting_round_complete,
    next_actionable_index as _next_actionable_index,
    player_can_act as _player_can_act,
    reset_acted_this_street_for_raise as _reset_acted_this_street_for_raise,
    tournament_survivors as _tournament_survivors,
)

# ----- Constants -----
MP_POKER_SUITS = ["H", "D", "C", "S"]
MP_POKER_VALUES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
MP_POKER_TURN_SECONDS = 30
MP_POKER_CHAT_MAX = 100
MP_POKER_START_COUNTDOWN = 5
MP_POKER_MIN_PLAYERS = 2
MP_POKER_MAX_PLAYERS = 9
MP_POKER_MAX_BUY_IN = 1_000_000_000
MP_POKER_MAX_EXTRA_PRIZE = 1_000_000_000
MP_POKER_VS_DEALER_MIN_BLIND = 1000
MP_POKER_VS_DEALER_MAX_SMALL_BLIND = 25_000  # Hard cap for vs-dealer small blind (UI + API)
MP_POKER_VS_DEALER_MAX_BLIND_DEFAULT = 2_500_000
MP_POKER_TOURNAMENT_MIN_PLAYERS = 4
MP_POKER_TOURNAMENT_MAX_PLAYERS = 9
MP_POKER_TOURNAMENT_MAX_POINTS_BUY_IN = 5_000
MP_POKER_TOURNAMENT_STARTING_STACK = 7_500
MP_POKER_TOURNAMENT_LEVEL_SECONDS = 300
MP_POKER_TOURNAMENT_REMINDER_COOLDOWN_SECONDS = 600
MP_POKER_TOURNAMENT_BLINDS = [
    (50, 100),
    (100, 200),
    (150, 300),
    (200, 400),
    (300, 600),
    (400, 800),
    (600, 1200),
    (800, 1600),
    (1000, 2000),
    (1500, 3000),
    (2000, 4000),
]


async def _get_mp_poker_max_blind() -> int:
    """Admin-configurable max blind cap for MP poker (default 2.5M)."""
    try:
        main_doc = await db.game_settings.find_one({"_id": "main"}, {"_id": 0, "mp_poker_max_blind": 1})
        raw = int((main_doc or {}).get("mp_poker_max_blind") or MP_POKER_VS_DEALER_MAX_BLIND_DEFAULT)
        return max(MP_POKER_VS_DEALER_MIN_BLIND, raw)
    except Exception:
        return MP_POKER_VS_DEALER_MAX_BLIND_DEFAULT

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


def _mp_poker_last_hand_showdown_snapshot(
    g: dict, players: List[dict], board: List[dict], pot: int, results: List[dict]
) -> dict:
    """Snapshot after a tournament hand completes; clients show winners after immediate re-deal clears live results."""
    snap_players: List[dict] = []
    for p in players:
        hc = p.get("hole_cards") or []
        cards: List[dict] = []
        for c in hc:
            cards.append(dict(c) if isinstance(c, dict) else c)
        snap_players.append(
            {
                "user_id": p.get("user_id"),
                "username": p.get("username"),
                "is_bot": bool(p.get("is_bot")),
                "hole_cards": cards,
            }
        )
    bd = board or []
    board_out: List[dict] = []
    for c in bd:
        board_out.append(dict(c) if isinstance(c, dict) else c)
    return {
        "hand_number": int(g.get("hand_number") or 0),
        "pot": int(pot or 0),
        "board": board_out,
        "results": [dict(r) for r in results],
        "players": snap_players,
    }


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


def _mp_poker_hole_only_label(hole: List[dict]) -> Optional[str]:
    """Readable label when the board is not complete enough for a 5-card Hold'em hand (e.g. preflop win)."""
    if len(hole) != 2:
        return None
    c0, c1 = hole[0] or {}, hole[1] or {}
    v0, v1 = c0.get("value"), c1.get("value")
    s0, s1 = c0.get("suit"), c1.get("suit")
    if not v0 or not v1:
        return None
    r0, r1 = _card_rank(c0), _card_rank(c1)
    if v0 == v1:
        return f"Pocket {_rank_to_name(r0)}"
    hi, lo = (c0, c1) if r0 >= r1 else (c1, c0)
    hiv, lov = hi.get("value"), lo.get("value")
    suited = bool(s0) and s0 == s1
    tail = " suited" if suited else " offsuit"
    return f"{hiv}-{lov}{tail}"


def _mp_poker_evaluated_hand_label(p: dict, board: List[dict]) -> Optional[str]:
    """Best 5-card description at showdown; None if folded or no hole cards."""
    if p.get("status") == "folded":
        return None
    hole = list(p.get("hole_cards") or [])
    bd = list(board or [])
    if len(hole) < 2:
        return None
    if len(hole) + len(bd) < 5:
        return _mp_poker_hole_only_label(hole)
    cat, tie = _best_hand_seven(hole, bd)
    return _hand_description(cat, tie)


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


def _uid_str(uid) -> str:
    return str(uid or "").strip()


def _viewer_seated_in_poker(g: Optional[dict], viewer_uid: Optional[str]) -> bool:
    if not g:
        return False
    vid = _uid_str(viewer_uid)
    if not vid:
        return False
    if g.get("mode") == "vs_dealer":
        return _uid_str(g.get("user_id")) == vid
    return any(_uid_str(p.get("user_id")) == vid for p in (g.get("players") or []))


def _can_view_poker_game(g: Optional[dict], current_user: Optional[dict]) -> bool:
    """Lobby/registration can be browsed; live hands require a seat (or staff)."""
    if not g or not current_user:
        return False
    if _is_admin(current_user) or _is_moderator(current_user):
        return True
    if _viewer_seated_in_poker(g, current_user.get("id")):
        return True
    status = g.get("status")
    if status in ("open", "completed", "cancelled"):
        return True
    if g.get("mode") == "tournament" and g.get("tournament_status") in ("registration", "pending_approval"):
        return True
    return False


def _redact_mp_poker_hidden_state_for_viewer(g: Optional[dict], viewer_uid: Optional[str]) -> None:
    """Do not leak hidden table state in API responses before showdown."""
    if not g:
        return
    # Remaining shoe order would let anyone predict future board / reconstruct holes.
    g["deck"] = []
    g.pop("_settlement_claimed", None)
    street = g.get("street")
    status = g.get("status")
    phase = g.get("phase")
    if street == "showdown" or status == "completed" or phase == "settled":
        return
    players = list(g.get("players") or [])
    if status != "playing":
        # Lobby / ready — no live hand; never invent face-down placeholders.
        for p in players:
            if p.get("hole_cards"):
                p["hole_cards"] = []
            p.pop("current_hand_name", None)
        g["players"] = players
        return
    vid = _uid_str(viewer_uid)
    for p in players:
        puid = _uid_str(p.get("user_id"))
        if vid and puid and puid == vid:
            # Keep only viewer's own hole cards.
            pass
        else:
            hc = list(p.get("hole_cards") or [])
            p["hole_cards"] = [{"hidden": True} for _ in range(len(hc))]
        p.pop("current_hand_name", None)
    g["players"] = players


def _serialize_mp_poker_game(
    g: Optional[dict],
    viewer_uid: Optional[str],
    *,
    enrich: bool = False,
) -> dict:
    """Copy + redact for clients. Never mutate the Mongo-sourced document."""
    if not g:
        return {}
    out = {k: v for k, v in g.items() if k != "_id"}
    players = []
    for p in list(out.get("players") or []):
        p2 = dict(p)
        hc = p2.get("hole_cards")
        if hc is not None:
            p2["hole_cards"] = [dict(c) if isinstance(c, dict) else c for c in list(hc or [])]
        players.append(p2)
    out["players"] = players
    if out.get("board") is not None:
        out["board"] = list(out.get("board") or [])
    if out.get("deck") is not None:
        out["deck"] = list(out.get("deck") or [])
    if enrich:
        _enrich_players_current_hand(out)
    _redact_mp_poker_hidden_state_for_viewer(out, viewer_uid)
    return out


class PokerCreateRequest(BaseModel):
    max_players: int = 6
    buy_in: int = 100_000
    extra_prize: int = 0
    small_blind: int = 0


class PokerTournamentCreateRequest(BaseModel):
    max_players: int = 6
    buy_in: int = 100_000
    winner_bonus_cash: int = 0
    winner_bonus_points: int = 0
    second_place_bonus_cash: int = 0
    second_place_bonus_points: int = 0
    third_place_bonus_cash: int = 0
    third_place_bonus_points: int = 0
    buy_in_currency: Literal["money", "points"] = "money"

    @field_validator("max_players")
    @classmethod
    def validate_max_players(cls, v: int) -> int:
        if v < MP_POKER_TOURNAMENT_MIN_PLAYERS or v > MP_POKER_TOURNAMENT_MAX_PLAYERS:
            raise ValueError(f"max_players must be {MP_POKER_TOURNAMENT_MIN_PLAYERS}-{MP_POKER_TOURNAMENT_MAX_PLAYERS}")
        return v

    @model_validator(mode="after")
    def validate_buy_in_for_currency(self):
        bi = int(self.buy_in)
        if bi < 1:
            raise ValueError("buy_in must be at least 1")
        if self.buy_in_currency == "points":
            if bi > MP_POKER_TOURNAMENT_MAX_POINTS_BUY_IN:
                raise ValueError(
                    f"Points tournament buy-in cannot exceed {MP_POKER_TOURNAMENT_MAX_POINTS_BUY_IN} points"
                )
        elif bi > MP_POKER_MAX_BUY_IN:
            raise ValueError(f"buy_in must be at most {MP_POKER_MAX_BUY_IN:,}")
        return self


class PokerTournamentDecisionRequest(BaseModel):
    reason: Optional[str] = None
    bonus_money: int = 0
    bonus_points: int = 0
    bonus_respect_points: int = 0
    bonus_token_type: Optional[str] = None
    bonus_token_amount: int = 0
    bonus_car_id: Optional[str] = None


class PokerTournamentBonusRequest(BaseModel):
    target_user_id: Optional[str] = None
    money: int = 0
    points: int = 0
    respect_points: int = 0
    token_type: Optional[str] = None
    token_amount: int = 0
    car_id: Optional[str] = None


class PokerTournamentSettingsPatchRequest(BaseModel):
    require_approval: Optional[bool] = None
    tournament_limit_per_day: Optional[int] = None


class PokerTournamentAdminFixRequest(BaseModel):
    reason: Optional[str] = None


class PokerKickRequest(BaseModel):
    user_id: str


def _parse_iso_utc(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _is_tournament_game(g: dict) -> bool:
    return (g or {}).get("mode") == "tournament"


def _tournament_buy_in_currency(g: Optional[dict]) -> str:
    """Stored on tournament doc: 'money' (default) or 'points'."""
    if not g:
        return "money"
    raw = g.get("buy_in_currency") or g.get("buy_in_type") or "money"
    s = str(raw).strip().lower()
    if s in ("points", "point", "pts"):
        return "points"
    return "money"


async def _tournament_refund_user(uid: str, amount: int, currency: str) -> None:
    if not uid or amount <= 0:
        return
    if currency == "points":
        await db.users.update_one({"id": uid}, {"$inc": {"points": amount}})
        try:
            await log_points_event(db, user_id=uid, points=amount, event_type="mp_poker_tournament_refund", meta={"amount": amount})
        except Exception:
            pass
    else:
        await db.users.update_one({"id": uid}, {"$inc": {"money": amount}})


def _clamp_tournament_bonus_amount(raw: Any) -> int:
    return max(0, min(MP_POKER_MAX_EXTRA_PRIZE, int(raw or 0)))


def _tournament_bonus_amounts_from_request(request: PokerTournamentCreateRequest) -> dict[str, int]:
    return {
        "winner_bonus_cash": _clamp_tournament_bonus_amount(request.winner_bonus_cash),
        "winner_bonus_points": _clamp_tournament_bonus_amount(request.winner_bonus_points),
        "second_place_bonus_cash": _clamp_tournament_bonus_amount(request.second_place_bonus_cash),
        "second_place_bonus_points": _clamp_tournament_bonus_amount(request.second_place_bonus_points),
        "third_place_bonus_cash": _clamp_tournament_bonus_amount(request.third_place_bonus_cash),
        "third_place_bonus_points": _clamp_tournament_bonus_amount(request.third_place_bonus_points),
    }


def _tournament_bonus_amounts_from_game(g: dict) -> dict[str, int]:
    return {
        "winner_bonus_cash": int(g.get("winner_bonus_cash") or 0),
        "winner_bonus_points": int(g.get("winner_bonus_points") or 0),
        "second_place_bonus_cash": int(g.get("second_place_bonus_cash") or 0),
        "second_place_bonus_points": int(g.get("second_place_bonus_points") or 0),
        "third_place_bonus_cash": int(g.get("third_place_bonus_cash") or 0),
        "third_place_bonus_points": int(g.get("third_place_bonus_points") or 0),
    }


def _tournament_total_bonus_cash(g: dict) -> int:
    b = _tournament_bonus_amounts_from_game(g)
    return b["winner_bonus_cash"] + b["second_place_bonus_cash"] + b["third_place_bonus_cash"]


def _tournament_total_bonus_points(g: dict) -> int:
    b = _tournament_bonus_amounts_from_game(g)
    return b["winner_bonus_points"] + b["second_place_bonus_points"] + b["third_place_bonus_points"]


def _tournament_podium_uids(g: dict, winner_uid: Optional[str]) -> dict[int, Optional[str]]:
    eliminations = [str(u).strip() for u in (g.get("tournament_eliminations") or []) if u]
    places: dict[int, Optional[str]] = {1: winner_uid, 2: None, 3: None}
    if winner_uid and len(eliminations) >= 1:
        places[2] = eliminations[-1]
    if winner_uid and len(eliminations) >= 2:
        places[3] = eliminations[-2]
    return places


async def _refund_tournament_creator_bonuses(creator_id: str, g: dict) -> None:
    if not creator_id:
        return
    cash_refund = _tournament_total_bonus_cash(g)
    pts_refund = _tournament_total_bonus_points(g)
    if cash_refund > 0:
        await db.users.update_one({"id": creator_id}, {"$inc": {"money": cash_refund}})
    if pts_refund > 0:
        await db.users.update_one({"id": creator_id}, {"$inc": {"points": pts_refund}})


async def _pay_tournament_place_bonus(uid: Optional[str], cash: int, points: int) -> None:
    if not uid:
        return
    if cash > 0:
        await db.users.update_one({"id": uid}, {"$inc": {"money": cash}})
    if points > 0:
        await db.users.update_one({"id": uid}, {"$inc": {"points": points}})
        try:
            await log_points_event(
                db,
                user_id=uid,
                points=points,
                event_type="mp_poker_tournament_place_bonus",
                meta={"cash": cash, "points": points},
            )
        except Exception:
            pass


def _safe_tournament_blind(level_idx: int) -> Tuple[int, int]:
    i = max(0, min(level_idx, len(MP_POKER_TOURNAMENT_BLINDS) - 1))
    return MP_POKER_TOURNAMENT_BLINDS[i]


def _today_utc_iso_bounds() -> Tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    end = datetime.fromtimestamp(start.timestamp() + 86400, tz=timezone.utc)
    return start.isoformat(), end.isoformat()


def register(router):
    async def _get_tournament_settings() -> Dict[str, Any]:
        main_doc = await db.game_settings.find_one({"_id": "main"}, {"_id": 0, "mp_poker_tournament_require_approval": 1, "mp_poker_tournament_limit_per_day": 1})
        require_approval = bool((main_doc or {}).get("mp_poker_tournament_require_approval", True))
        try:
            limit_per_day = int((main_doc or {}).get("mp_poker_tournament_limit_per_day") or 10)
        except (TypeError, ValueError):
            limit_per_day = 10
        limit_per_day = max(1, min(500, limit_per_day))
        start_iso, end_iso = _today_utc_iso_bounds()
        created_today = await db.mp_poker_games.count_documents(
            {"mode": "tournament", "created_at": {"$gte": start_iso, "$lt": end_iso}}
        )
        return {
            "require_approval": require_approval,
            "tournament_limit_per_day": limit_per_day,
            "tournaments_created_today": int(created_today or 0),
        }

    async def _apply_tournament_bonus_rewards(
        target_user_id: str,
        *,
        money: int = 0,
        points: int = 0,
        respect_points: int = 0,
        token_type: Optional[str] = None,
        token_amount: int = 0,
        car_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        money = max(0, int(money or 0))
        points = max(0, int(points or 0))
        respect_points = max(0, int(respect_points or 0))
        token_amount = max(0, int(token_amount or 0))
        update_inc: Dict[str, int] = {}
        if money:
            update_inc["money"] = money
        if points:
            update_inc["points"] = points
        if respect_points:
            update_inc["respect_points"] = respect_points
        token_field_map = {
            "xp_crimes": "xp_crimes_tokens",
            "xp_gta": "xp_gta_tokens",
            "auto_rank_2h": "auto_rank_2h_tokens",
            "melt": "melt_tokens",
            "oc_reduced": "oc_reduced_tokens",
            "booze": "booze_tokens",
            "racket": "racket_tokens",
            "travel": "travel_tokens",
            "properties": "properties_tokens",
            "jailbust_bonus": "jailbust_tokens",
        }
        token_type_clean = (token_type or "").strip() or None
        if token_type_clean:
            if token_type_clean == "rank_xp_pass":
                raise HTTPException(
                    status_code=400,
                    detail="Game Pass (rank_xp_pass) cannot be granted via tournament bonuses; use POST /admin/grant-game-pass.",
                )
            if token_type_clean not in token_field_map:
                raise HTTPException(status_code=400, detail="Invalid token type")
            if token_amount < 1:
                raise HTTPException(status_code=400, detail="token_amount must be at least 1")
            update_inc[token_field_map[token_type_clean]] = token_amount
        if update_inc:
            await db.users.update_one({"id": target_user_id}, {"$inc": update_inc})

        given_car = None
        if car_id:
            # Tournament car bonuses disabled — new cars only from GTA / dealer / marketplace / store / admin
            car_id = None

        return {
            "money": money,
            "points": points,
            "respect_points": respect_points,
            "token_type": token_type_clean,
            "token_amount": token_amount if token_type_clean else 0,
            "car_id": given_car,
        }

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
        human_player = next((p for p in players if p.get("user_id") == uid), None)
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

        # Vs dealer is a single-hand cash game: refund remaining human stack, then add pot if human won.
        # Without this, players lose all unbet chips at hand end.
        human_stack_refund = int((human_player or {}).get("stack") or 0)
        human_pot_win = pot if winner and winner.get("user_id") == uid else 0
        human_cashout = max(0, human_stack_refund + human_pot_win)

        if human_cashout > 0:
            await db.users.update_one({"id": uid}, {"$inc": {"money": human_cashout}})
            await log_gambling(
                uid,
                g.get("username") or "?",
                "mp_poker",
                {
                    "action": "payout",
                    "game_id": game_id,
                    "winnings": human_cashout,
                    "stack_refund": human_stack_refund,
                    "pot_win": human_pot_win,
                    "mode": "vs_dealer",
                },
            )

        if winner and winner.get("user_id") == uid and pot > 0:
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
            if deck:
                deck.pop()  # burn
            for _ in range(3):
                if deck:
                    board.append(deck.pop())
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"street": "flop", "board": board, "deck": deck, "players": players, "current_turn_index": 0, "to_call": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
            )
        elif street == "flop":
            if deck:
                deck.pop()  # burn
            if deck:
                board.append(deck.pop())
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"street": "turn", "board": board, "deck": deck, "players": players, "current_turn_index": 0, "to_call": 0, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
            )
        elif street == "turn":
            if deck:
                deck.pop()  # burn
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
        # Chips needed to match human's street bet (do not mix "to_call" face vs delta — always derive from faces).
        human_face = int(human.get("current_bet") or 0)
        bot_face = int(bot.get("current_bet") or 0)
        call_amount = min(max(0, human_face - bot_face), bot_stack)
        human_all_in = human.get("status") == "all_in"
        if call_amount < 0:
            call_amount = 0
        if to_call <= 0:
            # Bot checks — betting round is complete; advance street (deal flop/turn/river) then human acts first
            bot["last_action"] = {"action": "check"}
            await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"players": players}})
            await _vs_dealer_advance_street(game_id)
            return await db.mp_poker_games.find_one({"id": game_id})
        # Human already all-in: dealer can only call or fold (no raise — no one can respond).
        if cat >= HAND_PAIR and bot_stack >= min_raise and _rng.random() < 0.6 and not human_all_in:
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
        # Facing an all-in: always call if affordable (heads-up). Folding half the time was exploitable
        # (players could shove every hand and collect dead money when dealer folded).
        elif call_amount <= bot_stack and (
            human_all_in
            or call_amount <= int(g.get("big_blind") or 0) * 2
            or cat >= HAND_PAIR
            or _rng.random() < 0.5
        ):
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
        max_blind = min(await _get_mp_poker_max_blind(), MP_POKER_VS_DEALER_MAX_SMALL_BLIND)
        blind = blind or 5000
        blind = max(MP_POKER_VS_DEALER_MIN_BLIND, min(max_blind, int(blind)))
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
            raise HTTPException(status_code=400, detail="Need at least 20x blind to play")
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
        return {"game_id": game_id, "game": _serialize_mp_poker_game(doc, uid)}

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
        return {"game": _serialize_mp_poker_game(g, current_user.get("id"), enrich=True)}

    @router.post("/casino/mp-poker/vs-dealer/act")
    async def vs_dealer_act(
        current_user: dict = Depends(get_current_user_verified),
        action: Optional[str] = Body(None, embed=True),
        amount: Optional[int] = Body(None, embed=True),
        game_id: Optional[str] = Body(None, embed=True),
    ):
        """Act in vs-dealer game: fold, check, call, bet, raise, all_in. amount required for bet/raise. Optional game_id to target specific game."""
        uid = current_user.get("id") or ""
        action = _classify_player_action(action)
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
            return {"game": _serialize_mp_poker_game(g, current_user.get("id"), enrich=True)}
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
                    return {"game": _serialize_mp_poker_game(g, current_user.get("id"), enrich=True)}
                g = await db.mp_poker_games.find_one({"id": g["id"]})
                await db.mp_poker_games.update_one(
                    {"id": g["id"]},
                    {"$set": {"players": players, "pot": pot, "to_call": 0, "current_turn_index": 1, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
                )
                g = await _run_vs_dealer_bot_turn(g["id"])
                return {"game": _serialize_mp_poker_game(g, current_user.get("id"), enrich=True)}
        await db.mp_poker_games.update_one(
            {"id": g["id"]},
            {"$set": {"players": players, "pot": pot, "to_call": new_to_call if action in ("bet", "raise", "all_in") else 0, "min_raise": min_raise if action in ("bet", "raise", "all_in") else g.get("min_raise"), "current_turn_index": 1, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
        )
        g = await _run_vs_dealer_bot_turn(g["id"])
        return {"game": _serialize_mp_poker_game(g, current_user.get("id"), enrich=True)}

    async def _maybe_progress_tournament_blinds(game_id: str) -> Optional[dict]:
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or not _is_tournament_game(g):
            return g
        if g.get("tournament_status") != "running":
            return g
        started_at = _parse_iso_utc(g.get("blind_level_started_at"))
        if not started_at:
            return g
        now = datetime.now(timezone.utc)
        elapsed = max(0, int((now - started_at).total_seconds()))
        level_steps = elapsed // MP_POKER_TOURNAMENT_LEVEL_SECONDS
        current_idx = int(g.get("blind_level_index") or 0)
        if level_steps <= current_idx:
            return g
        next_idx = min(level_steps, len(MP_POKER_TOURNAMENT_BLINDS) - 1)
        sb, bb = _safe_tournament_blind(next_idx)
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {
                "$set": {
                    "blind_level_index": next_idx,
                    "small_blind": sb,
                    "big_blind": bb,
                }
            },
        )
        return await db.mp_poker_games.find_one({"id": game_id})

    async def _tournament_finalize_if_done(game_id: str) -> Optional[dict]:
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or not _is_tournament_game(g):
            return g
        players = list(g.get("players") or [])
        alive = [p for p in players if int(p.get("stack") or 0) > 0 and p.get("status") != "busted"]
        if len(alive) > 1:
            return g
        winner = alive[0] if alive else None
        prize_pool = int(g.get("prize_pool") or 0)
        bonuses = _tournament_bonus_amounts_from_game(g)
        winner_bonus_cash = bonuses["winner_bonus_cash"]
        winner_bonus_points = bonuses["winner_bonus_points"]
        second_bonus_cash = bonuses["second_place_bonus_cash"]
        second_bonus_points = bonuses["second_place_bonus_points"]
        third_bonus_cash = bonuses["third_place_bonus_cash"]
        third_bonus_points = bonuses["third_place_bonus_points"]
        now_iso = datetime.now(timezone.utc).isoformat()
        winner_uid = (winner or {}).get("user_id")
        winner_name = (winner or {}).get("username")
        currency = _tournament_buy_in_currency(g)
        podium = _tournament_podium_uids(g, winner_uid)
        second_uid = podium.get(2)
        third_uid = podium.get(3)
        if winner_uid and prize_pool > 0:
            if currency == "points":
                await db.users.update_one({"id": winner_uid}, {"$inc": {"points": prize_pool}})
                try:
                    await log_points_event(
                        db,
                        user_id=winner_uid,
                        points=prize_pool,
                        event_type="mp_poker_tournament_payout",
                        meta={"game_id": game_id, "mode": "tournament"},
                    )
                except Exception:
                    pass
            else:
                await db.users.update_one({"id": winner_uid}, {"$inc": {"money": prize_pool}})
        await _pay_tournament_place_bonus(winner_uid, winner_bonus_cash, winner_bonus_points)
        await _pay_tournament_place_bonus(second_uid, second_bonus_cash, second_bonus_points)
        await _pay_tournament_place_bonus(third_uid, third_bonus_cash, third_bonus_points)
        if winner_uid and (prize_pool > 0 or winner_bonus_cash > 0 or winner_bonus_points > 0):
            await log_gambling(
                winner_uid,
                winner_name or "?",
                "mp_poker",
                {
                    "action": "payout",
                    "mode": "tournament",
                    "game_id": game_id,
                    "winnings": prize_pool,
                    "winner_bonus_cash": winner_bonus_cash,
                    "winner_bonus_points": winner_bonus_points,
                    "second_place_user_id": second_uid,
                    "second_place_bonus_cash": second_bonus_cash,
                    "second_place_bonus_points": second_bonus_points,
                    "third_place_user_id": third_uid,
                    "third_place_bonus_cash": third_bonus_cash,
                    "third_place_bonus_points": third_bonus_points,
                    "buy_in_currency": currency,
                },
            )
            bonus_cfg = g.get("admin_bonus_reward") if isinstance(g.get("admin_bonus_reward"), dict) else {}
            bonus_granted = {}
            if bonus_cfg:
                bonus_granted = await _apply_tournament_bonus_rewards(
                    winner_uid,
                    money=int(bonus_cfg.get("money") or 0),
                    points=int(bonus_cfg.get("points") or 0),
                    respect_points=int(bonus_cfg.get("respect_points") or 0),
                    token_type=bonus_cfg.get("token_type"),
                    token_amount=int(bonus_cfg.get("token_amount") or 0),
                    car_id=bonus_cfg.get("car_id"),
                )
            if bonus_granted:
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"admin_bonus_reward_granted": bonus_granted, "admin_bonus_reward_granted_at": now_iso}},
                )
        results = []
        for p in players:
            uid = p.get("user_id")
            place_cash = 0
            place_points = 0
            if winner_uid and uid == winner_uid:
                place_cash = winner_bonus_cash
                place_points = winner_bonus_points
            elif second_uid and uid == second_uid:
                place_cash = second_bonus_cash
                place_points = second_bonus_points
            elif third_uid and uid == third_uid:
                place_cash = third_bonus_cash
                place_points = third_bonus_points
            results.append(
                {
                    "user_id": uid,
                    "result": "win" if winner_uid and uid == winner_uid else "lose",
                    "payout": prize_pool if winner_uid and uid == winner_uid else 0,
                    "winner_bonus_cash": place_cash,
                    "winner_bonus_points": place_points,
                    "hand": None,
                }
            )
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {
                "$set": {
                    "status": "completed",
                    "phase": "settled",
                    "tournament_status": "completed",
                    "winner_user_id": winner_uid,
                    "winner_username": winner_name,
                    "results": results,
                    "completed_at": now_iso,
                }
            },
        )
        if g.get("entertainer_funded"):
            bi = int(g.get("buy_in") or 0)
            ent_outcome = {
                "winner_username": (winner_name or "").strip() or None,
                "winner_id": winner_uid,
                "total_winnings_points": (int(prize_pool) if currency == "points" else 0) + _tournament_total_bonus_points(g),
                "total_winnings_cash": (float(prize_pool) if currency == "money" else 0.0) + float(_tournament_total_bonus_cash(g)),
                "from_entertainer_fund_points": (int(bi) if currency == "points" else 0) + _tournament_total_bonus_points(g),
                "from_entertainer_fund_cash": (float(bi) if currency == "money" else 0.0) + float(_tournament_total_bonus_cash(g)),
                "mp_poker_subkind": "tournament",
            }
            await on_funded_game_completed(
                db,
                ref_id=game_id,
                source="mp_poker",
                send_notification=send_notification,
                log_points_event=log_points_event,
                outcome=ent_outcome,
            )
        return await db.mp_poker_games.find_one({"id": game_id})

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

    @router.get("/casino/mp-poker/tournaments")
    async def list_tournaments(current_user: dict = Depends(get_current_user_verified)):
        cursor = db.mp_poker_games.find(
            {"mode": "tournament", "tournament_status": {"$in": ["pending_approval", "registration", "running", "completed", "denied"]}},
            {
                "_id": 0,
                "id": 1,
                "creator_id": 1,
                "creator_username": 1,
                "max_players": 1,
                "buy_in": 1,
                "buy_in_currency": 1,
                "player_count": 1,
                "players": 1,
                "status": 1,
                "phase": 1,
                "approval_status": 1,
                "approval_reason": 1,
                "tournament_status": 1,
                "small_blind": 1,
                "big_blind": 1,
                "blind_level_index": 1,
                "prize_pool": 1,
                "winner_bonus_cash": 1,
                "winner_bonus_points": 1,
                "second_place_bonus_cash": 1,
                "second_place_bonus_points": 1,
                "third_place_bonus_cash": 1,
                "third_place_bonus_points": 1,
                "winner_username": 1,
                "admin_bonus_reward": 1,
                "created_at": 1,
            },
        ).sort("created_at", -1).limit(50)
        games = await cursor.to_list(50)
        out = []
        for g in games:
            players = list(g.get("players") or [])
            not_ready = sum(1 for p in players if p.get("user_id") and not p.get("ready"))
            out.append(
                {
                    "id": g.get("id"),
                    "creator_id": g.get("creator_id"),
                    "creator_username": g.get("creator_username"),
                    "max_players": g.get("max_players"),
                    "buy_in": g.get("buy_in"),
                    "buy_in_currency": _tournament_buy_in_currency(g),
                    "player_count": len(players),
                    "player_ids": [p.get("user_id") for p in players if p.get("user_id")],
                    "status": g.get("status"),
                    "phase": g.get("phase"),
                    "approval_status": g.get("approval_status"),
                    "approval_reason": g.get("approval_reason"),
                    "tournament_status": g.get("tournament_status"),
                    "small_blind": g.get("small_blind"),
                    "big_blind": g.get("big_blind"),
                    "blind_level_index": int(g.get("blind_level_index") or 0),
                    "prize_pool": int(g.get("prize_pool") or 0),
                    "winner_bonus_cash": int(g.get("winner_bonus_cash") or 0),
                    "winner_bonus_points": int(g.get("winner_bonus_points") or 0),
                    "second_place_bonus_cash": int(g.get("second_place_bonus_cash") or 0),
                    "second_place_bonus_points": int(g.get("second_place_bonus_points") or 0),
                    "third_place_bonus_cash": int(g.get("third_place_bonus_cash") or 0),
                    "third_place_bonus_points": int(g.get("third_place_bonus_points") or 0),
                    "winner_username": g.get("winner_username"),
                    "admin_bonus_reward": g.get("admin_bonus_reward") if isinstance(g.get("admin_bonus_reward"), dict) else None,
                    "created_at": g.get("created_at"),
                    "not_ready_count": not_ready,
                    "inactive_reminder_sent_at": g.get("inactive_reminder_sent_at"),
                }
            )
        return {"tournaments": out}

    @router.get("/casino/mp-poker/tournaments/admin-settings")
    async def get_tournament_admin_settings(current_user: dict = Depends(require_admin_verified)):
        return await _get_tournament_settings()

    @router.patch("/casino/mp-poker/tournaments/admin-settings")
    async def patch_tournament_admin_settings(
        body: PokerTournamentSettingsPatchRequest,
        current_user: dict = Depends(require_admin_verified),
    ):
        set_doc: Dict[str, Any] = {}
        if body.require_approval is not None:
            set_doc["mp_poker_tournament_require_approval"] = bool(body.require_approval)
        if body.tournament_limit_per_day is not None:
            try:
                limit = int(body.tournament_limit_per_day)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Invalid tournament_limit_per_day")
            set_doc["mp_poker_tournament_limit_per_day"] = max(1, min(500, limit))
        if not set_doc:
            return await _get_tournament_settings()
        await db.game_settings.update_one({"_id": "main"}, {"$set": set_doc}, upsert=True)
        return await _get_tournament_settings()

    @router.post("/casino/mp-poker/tournaments")
    async def create_tournament(
        request: PokerTournamentCreateRequest,
        current_user: dict = Depends(get_current_user_verified),
    ):
        uid = current_user.get("id") or ""
        username = current_user.get("username") or "Player"
        buy_in = int(request.buy_in)
        bonuses = _tournament_bonus_amounts_from_request(request)
        winner_bonus_cash = bonuses["winner_bonus_cash"]
        winner_bonus_points = bonuses["winner_bonus_points"]
        second_place_bonus_cash = bonuses["second_place_bonus_cash"]
        second_place_bonus_points = bonuses["second_place_bonus_points"]
        third_place_bonus_cash = bonuses["third_place_bonus_cash"]
        third_place_bonus_points = bonuses["third_place_bonus_points"]
        max_players = int(request.max_players)
        currency = str(request.buy_in_currency or "money").strip().lower()
        if currency not in ("money", "points"):
            currency = "money"
        settings = await _get_tournament_settings()
        start_iso, end_iso = _today_utc_iso_bounds()
        created_today = await db.mp_poker_games.count_documents(
            {"mode": "tournament", "created_at": {"$gte": start_iso, "$lt": end_iso}}
        )
        if created_today >= int(settings.get("tournament_limit_per_day") or 10):
            raise HTTPException(status_code=400, detail="Daily tournament limit reached")
        use_ent_fund = _is_entertainer(current_user)
        if use_ent_fund and currency == "points" and buy_in > ENTERTAINER_MP_POKER_MAX_POINTS_PER_GAME:
            raise HTTPException(
                status_code=400,
                detail=f"Entertainer points tournaments: buy-in cannot exceed {ENTERTAINER_MP_POKER_MAX_POINTS_PER_GAME:,} points from the entertainer fund.",
            )
        points_debit = (buy_in if currency == "points" else 0) + winner_bonus_points + second_place_bonus_points + third_place_bonus_points
        cash_debit = (buy_in if currency == "money" else 0) + winner_bonus_cash + second_place_bonus_cash + third_place_bonus_cash
        if use_ent_fund and points_debit > ENTERTAINER_MP_POKER_MAX_POINTS_PER_GAME:
            raise HTTPException(
                status_code=400,
                detail=f"Entertainer points tournaments: buy-in + all place point prizes cannot exceed {ENTERTAINER_MP_POKER_MAX_POINTS_PER_GAME:,} points from the entertainer fund.",
            )
        if use_ent_fund:
            ok = await try_debit_entertainer_fund(db, uid, float(cash_debit), int(points_debit))
            if not ok:
                raise HTTPException(status_code=400, detail="Insufficient entertainer fund for tournament buy-in / winner bonus")
        elif currency == "points":
            if points_debit > 0:
                deduct = await db.users.update_one(
                    {"id": uid, "points": {"$gte": points_debit}},
                    {"$inc": {"points": -points_debit}},
                )
                if deduct.modified_count == 0:
                    raise HTTPException(status_code=400, detail="Insufficient points")
            if cash_debit > 0:
                deduct_cash = await db.users.update_one(
                    {"id": uid, "money": {"$gte": cash_debit}},
                    {"$inc": {"money": -cash_debit}},
                )
                if deduct_cash.modified_count == 0:
                    if points_debit > 0:
                        await db.users.update_one({"id": uid}, {"$inc": {"points": points_debit}})
                    raise HTTPException(status_code=400, detail="Insufficient funds")
        else:
            if cash_debit > 0:
                deduct = await db.users.update_one(
                    {"id": uid, "money": {"$gte": cash_debit}},
                    {"$inc": {"money": -cash_debit}},
                )
                if deduct.modified_count == 0:
                    raise HTTPException(status_code=400, detail="Insufficient funds")
            if points_debit > 0:
                deduct_points = await db.users.update_one(
                    {"id": uid, "points": {"$gte": points_debit}},
                    {"$inc": {"points": -points_debit}},
                )
                if deduct_points.modified_count == 0:
                    if cash_debit > 0:
                        await db.users.update_one({"id": uid}, {"$inc": {"money": cash_debit}})
                    raise HTTPException(status_code=400, detail="Insufficient points")
        game_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        sb, bb = _safe_tournament_blind(0)
        require_approval = bool(settings.get("require_approval", True))
        doc = {
            "id": game_id,
            "mode": "tournament",
            "creator_id": uid,
            "creator_username": username,
            "max_players": max_players,
            "buy_in": buy_in,
            "buy_in_currency": currency,
            "extra_prize": 0,
            "winner_bonus_cash": winner_bonus_cash,
            "winner_bonus_points": winner_bonus_points,
            "second_place_bonus_cash": second_place_bonus_cash,
            "second_place_bonus_points": second_place_bonus_points,
            "third_place_bonus_cash": third_place_bonus_cash,
            "third_place_bonus_points": third_place_bonus_points,
            "tournament_eliminations": [],
            "prize_pool": buy_in + winner_bonus_cash + (winner_bonus_points if currency == "points" else 0),
            "pot": 0,
            "small_blind": sb,
            "big_blind": bb,
            "blind_level_index": 0,
            "blind_level_started_at": None,
            "approval_status": "pending" if require_approval else "approved",
            "approval_reason": None,
            "approved_by": None,
            "approved_at": None if require_approval else now_iso,
            "tournament_status": "pending_approval" if require_approval else "registration",
            "status": "open",
            "phase": "lobby",
            "players": [
                {
                    "user_id": uid,
                    "username": username,
                    "seat_index": 0,
                    "stack": MP_POKER_TOURNAMENT_STARTING_STACK,
                    "hole_cards": [],
                    "current_bet": 0,
                    "total_bet_this_hand": 0,
                    "status": "waiting",
                    "ready": False,
                    "is_bot": False,
                    "is_creator": True,
                }
            ],
            "street": None,
            "board": [],
            "deck": [],
            "current_turn_index": -1,
            "turn_started_at": None,
            "button_index": 0,
            "hand_number": 0,
            "created_at": now_iso,
            "chat": [],
            "admin_bonus_reward": None,
            "entertainer_funded": bool(use_ent_fund),
        }
        await log_gambling(
            uid,
            username,
            "mp_poker",
            {
                "action": "create",
                "game_id": game_id,
                "buy_in": buy_in,
                "winner_bonus_cash": winner_bonus_cash,
                "winner_bonus_points": winner_bonus_points,
                "mode": "tournament",
                "buy_in_currency": currency,
                **({"entertainer_fund": True} if use_ent_fund else {}),
            },
        )
        await db.mp_poker_games.insert_one(doc)
        if use_ent_fund:
            await insert_funded_game_row(db, entertainer_id=uid, source="mp_poker", ref_id=game_id)
        if currency == "points":
            try:
                await log_points_event(
                    db,
                    user_id=uid,
                    points=-points_debit,
                    event_type="mp_poker_tournament_buy_in",
                    meta={
                        "action": "create",
                        "game_id": game_id,
                        "winner_bonus_cash": winner_bonus_cash,
                        "winner_bonus_points": winner_bonus_points,
                    },
                )
            except Exception:
                pass
        return {"game_id": game_id, "game": _serialize_mp_poker_game(doc, uid)}

    @router.post("/casino/mp-poker/tournaments/{game_id}/join")
    async def join_tournament(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        uid = current_user.get("id") or ""
        username = current_user.get("username") or "Player"
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or not _is_tournament_game(g):
            raise HTTPException(status_code=404, detail="Tournament not found")
        if g.get("approval_status") != "approved" or g.get("tournament_status") != "registration":
            raise HTTPException(status_code=400, detail="Tournament is not open for registration")
        max_players = int(g.get("max_players") or MP_POKER_TOURNAMENT_MAX_PLAYERS)
        buy_in = int(g.get("buy_in") or 0)
        currency = _tournament_buy_in_currency(g)
        if currency == "points":
            deduct = await db.users.update_one(
                {"id": uid, "points": {"$gte": buy_in}},
                {"$inc": {"points": -buy_in}},
            )
            if deduct.modified_count == 0:
                raise HTTPException(status_code=400, detail="Insufficient points")
        else:
            deduct = await db.users.update_one(
                {"id": uid, "money": {"$gte": buy_in}},
                {"$inc": {"money": -buy_in}},
            )
            if deduct.modified_count == 0:
                raise HTTPException(status_code=400, detail="Insufficient funds")
        new_player = {
            "user_id": uid,
            "username": username,
            "seat_index": 0,
            "stack": MP_POKER_TOURNAMENT_STARTING_STACK,
            "hole_cards": [],
            "current_bet": 0,
            "total_bet_this_hand": 0,
            "status": "waiting",
            "ready": False,
            "is_bot": False,
            "is_creator": False,
        }
        join_result = await db.mp_poker_games.update_one(
            {
                "id": game_id,
                "players.user_id": {"$ne": uid},
                "$expr": {"$lt": [{"$size": "$players"}, max_players]},
            },
            {"$push": {"players": new_player}, "$inc": {"prize_pool": buy_in}},
        )
        if join_result.modified_count == 0:
            await _tournament_refund_user(uid, buy_in, currency)
            raise HTTPException(status_code=400, detail="Could not join (tournament full, already registered, or closed)")
        g = await db.mp_poker_games.find_one({"id": game_id})
        players = list(g.get("players") or [])
        for i, p in enumerate(players):
            p["seat_index"] = i
        phase = "ready" if len(players) >= MP_POKER_TOURNAMENT_MIN_PLAYERS else "lobby"
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"players": players, "phase": phase}})
        await log_gambling(
            uid,
            username,
            "mp_poker",
            {"action": "join", "game_id": game_id, "buy_in": buy_in, "mode": "tournament", "buy_in_currency": currency},
        )
        if currency == "points":
            try:
                await log_points_event(
                    db,
                    user_id=uid,
                    points=-buy_in,
                    event_type="mp_poker_tournament_buy_in",
                    meta={"action": "join", "game_id": game_id},
                )
            except Exception:
                pass
        g = await db.mp_poker_games.find_one({"id": game_id})
        return _serialize_mp_poker_game(g, uid)

    @router.get("/casino/mp-poker/tournaments/{game_id}")
    async def get_tournament(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or not _is_tournament_game(g):
            raise HTTPException(status_code=404, detail="Tournament not found")
        if not _can_view_poker_game(g, current_user):
            raise HTTPException(status_code=403, detail="Not in this tournament")
        g = await _maybe_progress_tournament_blinds(game_id)
        if g and g.get("status") == "playing" and g.get("street") == "showdown":
            await _mp_poker_run_showdown(game_id)
            g = await db.mp_poker_games.find_one({"id": game_id})
        return _serialize_mp_poker_game(g, current_user.get("id"), enrich=True)

    @router.post("/casino/mp-poker/tournaments/{game_id}/remind-inactive")
    async def tournament_remind_inactive(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Notify seated players who are not Ready (inbox). Host, admin, or moderator only. Cooldown between sends."""
        uid = (current_user.get("id") or "").strip()
        g = await db.mp_poker_games.find_one({"id": game_id, "mode": "tournament"})
        if not g:
            raise HTTPException(status_code=404, detail="Tournament not found")
        is_host = (g.get("creator_id") or "") == uid
        is_staff = _is_admin(current_user) or _is_moderator(current_user)
        if not is_host and not is_staff:
            raise HTTPException(status_code=403, detail="Only the tournament host or staff can send reminders")
        if g.get("tournament_status") != "registration":
            raise HTTPException(status_code=400, detail="Reminders are only for tournaments still in registration")
        if g.get("status") != "open" or g.get("phase") not in ("lobby", "ready"):
            raise HTTPException(status_code=400, detail="Cannot send reminders in this phase")
        last_raw = g.get("inactive_reminder_sent_at")
        last_dt = _parse_iso_utc(last_raw) if last_raw else None
        if last_dt:
            elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
            if elapsed < MP_POKER_TOURNAMENT_REMINDER_COOLDOWN_SECONDS:
                wait = int(MP_POKER_TOURNAMENT_REMINDER_COOLDOWN_SECONDS - elapsed)
                raise HTTPException(
                    status_code=400,
                    detail=f"Wait {wait}s before sending another reminder",
                )
        players = list(g.get("players") or [])
        targets = []
        seen = set()
        for p in players:
            puid = (p.get("user_id") or "").strip()
            if not puid or p.get("ready"):
                continue
            if puid == uid:
                continue
            if puid in seen:
                continue
            seen.add(puid)
            targets.append(p)
        if not targets:
            raise HTTPException(status_code=400, detail="No inactive players to remind (everyone is ready, or only you are seated)")
        host_name = (g.get("creator_username") or "The host").strip() or "The host"
        buy_in = int(g.get("buy_in") or 0)
        cur = _tournament_buy_in_currency(g)
        buy_label = f"{buy_in:,} pts" if cur == "points" else f"${buy_in:,}"
        title = "Poker tournament — ready up"
        msg = (
            f"{host_name} is waiting: open Casinos → MP Poker → this tournament and tap I'm Ready so play can start. "
            f"Buy-in {buy_label}."
        )
        for p in targets:
            await send_notification(p.get("user_id"), title, msg, "system", category="casino")
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"inactive_reminder_sent_at": now_iso}})
        return {"message": f"Inbox reminder sent to {len(targets)} player(s)", "count": len(targets), "inactive_reminder_sent_at": now_iso}

    @router.get("/admin/mp-poker/tournaments/pending")
    async def admin_list_pending_tournaments(current_user: dict = Depends(require_admin_verified)):
        rows = await db.mp_poker_games.find(
            {"mode": "tournament", "approval_status": "pending"},
            {"_id": 0, "id": 1, "creator_id": 1, "creator_username": 1, "max_players": 1, "buy_in": 1, "prize_pool": 1, "created_at": 1, "players": 1},
        ).sort("created_at", -1).to_list(100)
        out = []
        for g in rows:
            out.append(
                {
                    "id": g.get("id"),
                    "creator_id": g.get("creator_id"),
                    "creator_username": g.get("creator_username"),
                    "max_players": g.get("max_players"),
                    "buy_in": g.get("buy_in"),
                    "prize_pool": g.get("prize_pool"),
                    "player_count": len(g.get("players") or []),
                    "created_at": g.get("created_at"),
                }
            )
        return {"tournaments": out}

    @router.post("/admin/mp-poker/tournaments/{game_id}/approve")
    async def admin_approve_tournament(
        game_id: str,
        body: PokerTournamentDecisionRequest,
        current_user: dict = Depends(require_admin_verified),
    ):
        now_iso = datetime.now(timezone.utc).isoformat()
        bonus_cfg = {
            "money": max(0, int(body.bonus_money or 0)),
            "points": max(0, int(body.bonus_points or 0)),
            "respect_points": max(0, int(body.bonus_respect_points or 0)),
            "token_type": (body.bonus_token_type or "").strip() or None,
            "token_amount": max(0, int(body.bonus_token_amount or 0)),
            "car_id": (body.bonus_car_id or "").strip() or None,
        }
        if bonus_cfg["token_type"] and bonus_cfg["token_amount"] < 1:
            raise HTTPException(status_code=400, detail="bonus_token_amount must be at least 1 when token type is set")
        if not any(
            [
                bonus_cfg["money"] > 0,
                bonus_cfg["points"] > 0,
                bonus_cfg["respect_points"] > 0,
                bonus_cfg["token_type"],
                bonus_cfg["car_id"],
            ]
        ):
            bonus_cfg = None
        res = await db.mp_poker_games.update_one(
            {"id": game_id, "mode": "tournament", "approval_status": "pending"},
            {
                "$set": {
                    "approval_status": "approved",
                    "approval_reason": (body.reason or "").strip() or None,
                    "approved_by": current_user.get("username") or current_user.get("id") or "admin",
                    "approved_at": now_iso,
                    "tournament_status": "registration",
                    "admin_bonus_reward": bonus_cfg,
                }
            },
        )
        if res.modified_count == 0:
            raise HTTPException(status_code=400, detail="Tournament not pending approval")
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {"message": "Tournament approved", "game": _serialize_mp_poker_game(g, current_user.get("id"))}

    @router.post("/admin/mp-poker/tournaments/{game_id}/deny")
    async def admin_deny_tournament(
        game_id: str,
        body: PokerTournamentDecisionRequest,
        current_user: dict = Depends(require_admin_verified),
    ):
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or not _is_tournament_game(g):
            raise HTTPException(status_code=404, detail="Tournament not found")
        if g.get("approval_status") != "pending":
            raise HTTPException(status_code=400, detail="Tournament is not pending")
        players = list(g.get("players") or [])
        buy_in = int(g.get("buy_in") or 0)
        currency = _tournament_buy_in_currency(g)
        for p in players:
            uid = (p.get("user_id") or "").strip()
            if uid and buy_in > 0:
                await _tournament_refund_user(uid, buy_in, currency)
        creator_id = (g.get("creator_id") or "").strip()
        await _refund_tournament_creator_bonuses(creator_id, g)
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {
                "$set": {
                    "approval_status": "denied",
                    "approval_reason": (body.reason or "").strip() or "Denied by admin",
                    "tournament_status": "denied",
                    "status": "cancelled",
                    "phase": "cancelled",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {"message": "Tournament denied and refunded", "game": _serialize_mp_poker_game(g, current_user.get("id"))}

    @router.post("/admin/mp-poker/tournaments/{game_id}/bonus-rewards")
    async def admin_tournament_bonus_rewards(
        game_id: str,
        body: PokerTournamentBonusRequest,
        current_user: dict = Depends(require_admin_verified),
    ):
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or not _is_tournament_game(g):
            raise HTTPException(status_code=404, detail="Tournament not found")
        target_user_id = (body.target_user_id or g.get("winner_user_id") or "").strip()
        if not target_user_id:
            raise HTTPException(status_code=400, detail="No target user (set winner first)")
        target = await db.users.find_one({"id": target_user_id}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="Target user not found")
        granted = await _apply_tournament_bonus_rewards(
            target_user_id,
            money=int(body.money or 0),
            points=int(body.points or 0),
            respect_points=int(body.respect_points or 0),
            token_type=body.token_type,
            token_amount=int(body.token_amount or 0),
            car_id=body.car_id,
        )
        return {
            "message": "Tournament bonus rewards granted",
            "target_user_id": target_user_id,
            "target_username": target.get("username"),
            "granted": granted,
        }

    @router.post("/admin/mp-poker/tournaments/{game_id}/fix")
    async def admin_fix_tournament(
        game_id: str,
        body: PokerTournamentAdminFixRequest,
        current_user: dict = Depends(require_admin_verified),
    ):
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or not _is_tournament_game(g):
            raise HTTPException(status_code=404, detail="Tournament not found")
        if g.get("tournament_status") in ("completed", "denied") or g.get("status") in ("completed", "cancelled"):
            raise HTTPException(status_code=400, detail="Tournament is already closed")
        now_iso = datetime.now(timezone.utc).isoformat()
        reason = (body.reason or "").strip() or "Manual admin fix"
        admin_name = current_user.get("username") or current_user.get("id") or "admin"
        if g.get("status") == "playing" and g.get("street") == "showdown":
            await _mp_poker_run_showdown(game_id)
            g = await db.mp_poker_games.find_one({"id": game_id})
            return {
                "message": "Tournament fixed: showdown completed",
                "fix": "showdown_completed",
                "game": _serialize_mp_poker_game(g, current_user.get("id"), enrich=True),
            }
        fixed = False
        fix_type = "no_change"
        if g.get("status") == "playing":
            players = list(g.get("players") or [])
            turn_idx = int(g.get("current_turn_index") or 0)
            if players:
                if turn_idx < 0 or turn_idx >= len(players) or players[turn_idx].get("status") in ("folded", "all_in", "busted"):
                    next_idx = turn_idx % len(players) if len(players) else 0
                    found = False
                    for _ in range(len(players)):
                        if players[next_idx].get("status") not in ("folded", "all_in", "busted"):
                            found = True
                            break
                        next_idx = (next_idx + 1) % len(players)
                    if found:
                        await db.mp_poker_games.update_one(
                            {"id": game_id},
                            {
                                "$set": {
                                    "current_turn_index": next_idx,
                                    "turn_started_at": now_iso,
                                }
                            },
                        )
                        fixed = True
                        fix_type = "turn_reassigned"
            # Try to advance if no one can act or game is otherwise stalled.
            g_latest = await db.mp_poker_games.find_one({"id": game_id})
            players_latest = list((g_latest or {}).get("players") or [])
            actionable = [p for p in players_latest if p.get("status") not in ("folded", "all_in", "busted")]
            if len(actionable) <= 1 and (g_latest or {}).get("street") in ("preflop", "flop", "turn", "river"):
                await _mp_poker_advance_street(game_id)
                fixed = True
                fix_type = "street_advanced"
            if not fixed:
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {
                        "$set": {
                            "turn_started_at": now_iso,
                        }
                    },
                )
                fixed = True
                fix_type = "turn_timer_reset"
        else:
            # Open/ready states: normalize status for registration if already approved.
            if g.get("approval_status") == "approved" and g.get("tournament_status") in ("pending_approval", None):
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {
                        "$set": {
                            "tournament_status": "registration",
                            "status": "open",
                            "phase": "lobby",
                        }
                    },
                )
                fixed = True
                fix_type = "registration_reopened"
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {
                "$set": {
                    "admin_last_fix_at": now_iso,
                    "admin_last_fix_by": admin_name,
                    "admin_last_fix_reason": reason,
                }
            },
        )
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {
            "message": "Tournament fix applied" if fixed else "No fix needed",
            "fix": fix_type,
            "game": _serialize_mp_poker_game(g, current_user.get("id"), enrich=True),
        }

    @router.post("/admin/mp-poker/tournaments/{game_id}/refund")
    async def admin_refund_tournament(
        game_id: str,
        body: PokerTournamentAdminFixRequest,
        current_user: dict = Depends(require_admin_verified),
    ):
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or not _is_tournament_game(g):
            raise HTTPException(status_code=404, detail="Tournament not found")
        if g.get("admin_refunded_at"):
            raise HTTPException(status_code=400, detail="Tournament has already been refunded")
        if g.get("tournament_status") in ("completed", "denied") or g.get("status") in ("completed", "cancelled"):
            raise HTTPException(status_code=400, detail="Tournament is already closed")
        players = list(g.get("players") or [])
        buy_in = int(g.get("buy_in") or 0)
        creator_id = (g.get("creator_id") or "").strip()
        currency = _tournament_buy_in_currency(g)
        refunded_users = []
        seen = set()
        if buy_in > 0:
            for p in players:
                uid = (p.get("user_id") or "").strip()
                if not uid or uid in seen:
                    continue
                seen.add(uid)
                await _tournament_refund_user(uid, buy_in, currency)
                refunded_users.append(uid)
        await _refund_tournament_creator_bonuses(creator_id, g)
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {
                "$set": {
                    "approval_status": "denied",
                    "approval_reason": (body.reason or "").strip() or "Refunded by admin due to stuck tournament",
                    "tournament_status": "denied",
                    "status": "cancelled",
                    "phase": "cancelled",
                    "completed_at": now_iso,
                    "admin_refunded_at": now_iso,
                    "admin_refunded_by": current_user.get("username") or current_user.get("id") or "admin",
                    "admin_refund_count": len(refunded_users),
                }
            },
        )
        g = await db.mp_poker_games.find_one({"id": game_id})
        return {
            "message": "Tournament refunded and closed",
            "refunded_count": len(refunded_users),
            "buy_in_refund_each": buy_in,
            "game": _serialize_mp_poker_game(g, current_user.get("id")),
        }

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
        max_blind = await _get_mp_poker_max_blind()
        if request.small_blind > 0:
            small_blind = max(1, min(buy_in // 2, max_blind, request.small_blind))
        else:
            small_blind = max(1, min(max_blind, buy_in // 100))
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
            "entertainer_funded": False,
        }
        if _is_entertainer(current_user):
            ok = await try_debit_entertainer_fund(db, uid, float(need), 0)
            if not ok:
                raise HTTPException(status_code=400, detail="Insufficient entertainer fund for buy-in + extra prize")
            doc["entertainer_funded"] = True
            await log_gambling(
                uid,
                username,
                "mp_poker",
                {"action": "create", "game_id": game_id, "buy_in": need, "mode": "vs_players", "entertainer_fund": True},
            )
            await db.mp_poker_games.insert_one(doc)
            await insert_funded_game_row(db, entertainer_id=uid, source="mp_poker", ref_id=game_id)
        else:
            deduct_result = await db.users.update_one(
                {"id": uid, "money": {"$gte": need}},
                {"$inc": {"money": -need}},
            )
            if deduct_result.modified_count == 0:
                raise HTTPException(status_code=400, detail="Insufficient funds")
            await log_gambling(uid, username, "mp_poker", {"action": "create", "game_id": game_id, "buy_in": need, "mode": "vs_players"})
            await db.mp_poker_games.insert_one(doc)
        return {"game_id": game_id, "game": _serialize_mp_poker_game(doc, uid)}

    @router.get("/casino/mp-poker/games/{game_id}")
    async def get_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Get full game state. For vs_dealer, if it's bot's turn, run bot action and return updated game.
        For vs_players in showdown, run showdown so the game settles and clients don't get stuck."""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g:
            raise HTTPException(status_code=404, detail="Game not found")
        if not _can_view_poker_game(g, current_user):
            raise HTTPException(status_code=403, detail="Not in this game")
        # Server-driven timeout: if turn is expired, allow any seated player poll to advance the hand.
        if g.get("mode") in ("vs_players", "tournament") and g.get("status") == "playing":
            turn_started = _parse_iso_utc(g.get("turn_started_at"))
            if turn_started:
                elapsed = (datetime.now(timezone.utc) - turn_started).total_seconds()
                if elapsed >= MP_POKER_TURN_SECONDS:
                    await game_timeout(game_id, current_user)
                    g = await db.mp_poker_games.find_one({"id": game_id})
            # Safety heal: if current turn points to folded/all-in/busted player, advance to next actionable seat.
            players_now = list(g.get("players") or [])
            turn_idx_now = int(g.get("current_turn_index") or 0)
            in_live_street = g.get("street") in ("preflop", "flop", "turn", "river")
            if in_live_street and players_now:
                bad_turn_idx = turn_idx_now < 0 or turn_idx_now >= len(players_now) or not _player_can_act(players_now[turn_idx_now])
                if bad_turn_idx:
                    next_idx = _next_actionable_index(players_now, max(0, turn_idx_now))
                    if next_idx < 0 or not _player_can_act(players_now[next_idx]):
                        await _mp_poker_advance_street(game_id)
                    else:
                        await db.mp_poker_games.update_one(
                            {"id": game_id},
                            {"$set": {"current_turn_index": next_idx, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
                        )
                    g = await db.mp_poker_games.find_one({"id": game_id})
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
        if _is_tournament_game(g):
            g = await _maybe_progress_tournament_blinds(game_id)
            if g and g.get("status") == "playing" and g.get("street") == "showdown":
                await _mp_poker_run_showdown(game_id)
                g = await db.mp_poker_games.find_one({"id": game_id})
        return _serialize_mp_poker_game(g, current_user.get("id"), enrich=True)

    @router.post("/casino/mp-poker/games/{game_id}/join")
    async def join_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Join an open poker game."""
        uid = current_user.get("id") or ""
        username = current_user.get("username") or "Player"
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") not in ("vs_players", "tournament") or g.get("status") != "open":
            raise HTTPException(status_code=400, detail="Game not joinable")
        if _is_tournament_game(g):
            if g.get("approval_status") != "approved" or g.get("tournament_status") != "registration":
                raise HTTPException(status_code=400, detail="Tournament is not open for registration")
        max_players = g.get("max_players", 6)
        buy_in = int(g.get("buy_in") or 0)
        is_tournament = _is_tournament_game(g)
        currency = _tournament_buy_in_currency(g) if is_tournament else "money"
        if is_tournament and currency == "points":
            join_deduct = await db.users.update_one(
                {"id": uid, "points": {"$gte": buy_in}},
                {"$inc": {"points": -buy_in}},
            )
            if join_deduct.modified_count == 0:
                raise HTTPException(status_code=400, detail="Insufficient points")
        else:
            join_deduct = await db.users.update_one(
                {"id": uid, "money": {"$gte": buy_in}},
                {"$inc": {"money": -buy_in}},
            )
            if join_deduct.modified_count == 0:
                raise HTTPException(status_code=400, detail="Insufficient funds")
        new_player = {
            "user_id": uid,
            "username": username,
            "seat_index": 0,
            "stack": MP_POKER_TOURNAMENT_STARTING_STACK if is_tournament else buy_in,
            "hole_cards": [],
            "current_bet": 0,
            "total_bet_this_hand": 0,
            "status": "waiting",
            "ready": False,
            "is_bot": False,
        }
        join_update = {"$push": {"players": new_player}}
        if is_tournament:
            join_update["$inc"] = {"prize_pool": buy_in}
        join_result = await db.mp_poker_games.update_one(
            {
                "id": game_id,
                "status": "open",
                "players.user_id": {"$ne": uid},
                "$expr": {"$lt": [{"$size": "$players"}, max_players]},
            },
            join_update,
        )
        if join_result.modified_count == 0:
            if is_tournament:
                await _tournament_refund_user(uid, buy_in, currency)
            else:
                await db.users.update_one({"id": uid}, {"$inc": {"money": buy_in}})
            raise HTTPException(status_code=400, detail="Could not join (game full, already joined, or closed)")
        g = await db.mp_poker_games.find_one({"id": game_id})
        players = list(g.get("players") or [])
        for i, p in enumerate(players):
            p["seat_index"] = i
        min_players = MP_POKER_TOURNAMENT_MIN_PLAYERS if is_tournament else 2
        phase = "ready" if len(players) >= min_players else "lobby"
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"players": players, "phase": phase}})
        await log_gambling(
            uid,
            username,
            "mp_poker",
            {
                "action": "join",
                "game_id": game_id,
                "buy_in": buy_in,
                "mode": "tournament" if is_tournament else "vs_players",
                **({"buy_in_currency": currency} if is_tournament else {}),
            },
        )
        if is_tournament and currency == "points":
            try:
                await log_points_event(
                    db,
                    user_id=uid,
                    points=-buy_in,
                    event_type="mp_poker_tournament_buy_in",
                    meta={"action": "join", "game_id": game_id},
                )
            except Exception:
                pass
        g = await db.mp_poker_games.find_one({"id": game_id})
        return _serialize_mp_poker_game(g, uid)

    @router.post("/casino/mp-poker/games/{game_id}/cancel")
    async def cancel_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Cancel open/ready cash table, or a tournament still in registration; refund all seated players."""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") not in ("vs_players", "tournament"):
            raise HTTPException(status_code=404, detail="Game not found")
        if g.get("status") not in ("open", "ready"):
            raise HTTPException(status_code=400, detail="Cannot cancel")
        uid = current_user.get("id") or ""
        if g.get("creator_id") != uid and not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Only creator can cancel")
        is_tournament = _is_tournament_game(g)
        if is_tournament:
            if g.get("approval_status") != "approved" or g.get("tournament_status") != "registration":
                raise HTTPException(status_code=400, detail="Cannot cancel tournament at this stage")
            if g.get("phase") not in ("lobby", "ready"):
                raise HTTPException(status_code=400, detail="Cannot cancel")
            now_iso = datetime.now(timezone.utc).isoformat()
            claim_res = await db.mp_poker_games.update_one(
                {
                    "id": game_id,
                    "status": {"$in": ("open", "ready")},
                    "mode": "tournament",
                    "tournament_status": "registration",
                },
                {
                    "$set": {
                        "status": "cancelled",
                        "phase": "cancelled",
                        "tournament_status": "denied",
                        "approval_reason": "Cancelled by host",
                        "completed_at": now_iso,
                    }
                },
            )
            if claim_res.modified_count == 0:
                raise HTTPException(status_code=400, detail="Game already cancelled or in progress")
            players = list(g.get("players") or [])
            buy_in = int(g.get("buy_in") or 0)
            currency = _tournament_buy_in_currency(g)
            seen: set[str] = set()
            for p in players:
                puid = (p.get("user_id") or "").strip()
                if not puid or puid in seen:
                    continue
                seen.add(puid)
                if buy_in > 0:
                    await _tournament_refund_user(puid, buy_in, currency)
            await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"prize_pool": 0}})
            return {"message": "Tournament cancelled; everyone refunded"}

        claim_res = await db.mp_poker_games.update_one(
            {"id": game_id, "status": {"$in": ("open", "ready")}, "mode": "vs_players"},
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
        """Leave an open/ready cash table or tournament (registration only) before the hand starts.

        Non-creators can leave while the game is still in the lobby/ready phase.
        They get their buy-in back and are removed from the seats.
        """
        uid = current_user.get("id") or ""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") not in ("vs_players", "tournament"):
            raise HTTPException(status_code=404, detail="Game not found")
        is_tournament = _is_tournament_game(g)
        if is_tournament:
            if g.get("approval_status") != "approved" or g.get("tournament_status") != "registration":
                raise HTTPException(status_code=400, detail="Cannot leave at this stage")
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
        currency = _tournament_buy_in_currency(g) if is_tournament else "money"
        players.pop(idx)
        if buy_in > 0:
            if is_tournament:
                await _tournament_refund_user(uid, buy_in, currency)
            else:
                await db.users.update_one({"id": uid}, {"$inc": {"money": buy_in}})
        for i, p in enumerate(players):
            p["seat_index"] = i
        min_players = MP_POKER_TOURNAMENT_MIN_PLAYERS if (is_tournament and g.get("tournament_status") == "registration") else 2
        phase = "ready" if len(players) >= min_players else "lobby"
        all_ready_at = None
        if phase == "ready":
            all_ready = len(players) >= min_players and all(p.get("ready") for p in players)
            if all_ready:
                all_ready_at = g.get("all_ready_at") or datetime.now(timezone.utc).isoformat()
        updates: Dict[str, Any] = {"players": players, "phase": phase, "all_ready_at": all_ready_at}
        if is_tournament and buy_in > 0:
            updates["prize_pool"] = max(0, int(g.get("prize_pool") or 0) - buy_in)
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": updates})
        g = await db.mp_poker_games.find_one({"id": game_id})
        return _serialize_mp_poker_game(g, uid)

    @router.post("/casino/mp-poker/games/{game_id}/kick")
    async def kick_unready_player(
        game_id: str,
        body: PokerKickRequest,
        current_user: dict = Depends(get_current_user_verified),
    ):
        """Host (or staff, tournaments only) removes a seated player who has not readied up; target is refunded."""
        uid = (current_user.get("id") or "").strip()
        tid = (body.user_id or "").strip()
        if not tid:
            raise HTTPException(status_code=400, detail="user_id required")
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") not in ("vs_players", "tournament"):
            raise HTTPException(status_code=404, detail="Game not found")
        is_tournament = _is_tournament_game(g)
        if is_tournament:
            if g.get("approval_status") != "approved" or g.get("tournament_status") != "registration":
                raise HTTPException(status_code=400, detail="Cannot remove players at this stage")
        if g.get("status") != "open" or g.get("phase") not in ("lobby", "ready"):
            raise HTTPException(status_code=400, detail="Cannot remove players at this stage")
        is_host = (g.get("creator_id") or "").strip() == uid
        is_staff = _is_admin(current_user) or _is_moderator(current_user)
        if is_tournament:
            if not is_host and not is_staff:
                raise HTTPException(status_code=403, detail="Only the tournament host or staff can remove a player")
        else:
            if not is_host:
                raise HTTPException(status_code=403, detail="Only the table host can remove a player")
        if tid == uid:
            raise HTTPException(status_code=400, detail="Use Leave Table to step away as a player")
        if tid == (g.get("creator_id") or "").strip():
            raise HTTPException(status_code=400, detail="Cannot remove the host")
        players = list(g.get("players") or [])
        idx = next((i for i, p in enumerate(players) if (p.get("user_id") or "").strip() == tid), None)
        if idx is None:
            raise HTTPException(status_code=400, detail="Player is not seated at this table")
        target = players[idx]
        if target.get("ready"):
            raise HTTPException(status_code=400, detail="Player has already readied up")
        buy_in = int(g.get("buy_in") or 0)
        currency = _tournament_buy_in_currency(g) if is_tournament else "money"
        players.pop(idx)
        if buy_in > 0:
            if is_tournament:
                await _tournament_refund_user(tid, buy_in, currency)
            else:
                await db.users.update_one({"id": tid}, {"$inc": {"money": buy_in}})
        for i, p in enumerate(players):
            p["seat_index"] = i
        min_players = MP_POKER_TOURNAMENT_MIN_PLAYERS if (is_tournament and g.get("tournament_status") == "registration") else 2
        phase = "ready" if len(players) >= min_players else "lobby"
        all_ready_at = None
        if phase == "ready":
            all_ready = len(players) >= min_players and all(p.get("ready") for p in players)
            if all_ready:
                all_ready_at = g.get("all_ready_at") or datetime.now(timezone.utc).isoformat()
        updates: Dict[str, Any] = {"players": players, "phase": phase, "all_ready_at": all_ready_at}
        if is_tournament and buy_in > 0:
            updates["prize_pool"] = max(0, int(g.get("prize_pool") or 0) - buy_in)
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": updates})
        host_name = (current_user.get("username") or "Host").strip() or "Host"
        table_label = "tournament" if is_tournament else "table"
        try:
            await send_notification(
                tid,
                "Removed from poker " + table_label,
                f"{host_name} removed you before play started because you had not readied up. Your buy-in has been refunded.",
                "system",
                category="casino",
            )
        except Exception:
            pass
        g = await db.mp_poker_games.find_one({"id": game_id})
        return _serialize_mp_poker_game(g, uid)

    @router.post("/casino/mp-poker/games/{game_id}/ready")
    async def ready_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Mark yourself ready. When all are ready, all_ready_at is set."""
        uid = current_user.get("id") or ""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") not in ("vs_players", "tournament") or g.get("phase") not in ("lobby", "ready"):
            raise HTTPException(status_code=400, detail="Cannot ready")
        is_tournament = _is_tournament_game(g)
        if is_tournament:
            if g.get("approval_status") != "approved" or g.get("tournament_status") not in ("registration", "running"):
                raise HTTPException(status_code=400, detail="Tournament is not ready for this action")
        players = list(g.get("players") or [])
        for p in players:
            if p.get("user_id") == uid:
                p["ready"] = True
                break
        min_players = MP_POKER_TOURNAMENT_MIN_PLAYERS if (is_tournament and g.get("tournament_status") == "registration") else 2
        all_ready = len(players) >= min_players and all(p.get("ready") for p in players)
        now_iso = datetime.now(timezone.utc).isoformat()
        updates = {"players": players}
        if all_ready and not g.get("all_ready_at"):
            updates["all_ready_at"] = now_iso
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": updates})
        g = await db.mp_poker_games.find_one({"id": game_id})
        return _serialize_mp_poker_game(g, uid)

    async def _mp_poker_run_showdown(game_id: str):
        claim_res = await db.mp_poker_games.update_one(
            {"id": game_id, "street": "showdown", "status": {"$ne": "completed"}},
            {"$set": {"phase": "settled"}},
        )
        if claim_res.modified_count == 0:
            return
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("street") != "showdown":
            return
        is_tournament = _is_tournament_game(g)
        players = list(g.get("players") or [])
        board = list(g.get("board") or [])
        pot = int(g.get("pot") or 0)
        active = [p for p in players if p.get("status") not in ("folded",)]
        results = []
        winner_payouts = {}
        if len(active) == 1:
            winner = active[0]
            uid = winner.get("user_id")
            if uid and uid != "dealer":
                winner_payouts[uid] = pot
            for p in players:
                results.append({
                    "user_id": p.get("user_id"),
                    "result": "win" if p.get("user_id") == uid else "lose",
                    "payout": pot if p.get("user_id") == uid else 0,
                    "hand": _mp_poker_evaluated_hand_label(p, board),
                })
        else:
            # Side-pot algorithm: a player can only win from each opponent
            # the amount they themselves invested.
            contribs = []
            for i, p in enumerate(players):
                contribs.append((int(p.get("total_bet_this_hand") or 0), i, p.get("status") == "folded"))
            levels = sorted(set(b for b, _, _ in contribs if b > 0))
            prev_level = 0
            side_pots = []
            for level in levels:
                pot_amt = 0
                elig = []
                for bet, idx, folded in contribs:
                    pot_amt += min(bet, level) - min(bet, prev_level)
                    if not folded and bet >= level:
                        elig.append(idx)
                if pot_amt > 0 and elig:
                    side_pots.append((pot_amt, elig))
                elif pot_amt > 0 and side_pots:
                    prev_a, prev_e = side_pots[-1]
                    side_pots[-1] = (prev_a + pot_amt, prev_e)
                prev_level = level
            side_pot_total = sum(a for a, _ in side_pots)
            if side_pots and side_pot_total < pot:
                a, e = side_pots[-1]
                side_pots[-1] = (a + pot - side_pot_total, e)
            if not side_pots:
                side_pots = [(pot, [i for i, p in enumerate(players) if p.get("status") != "folded"])]

            for sp_amt, sp_elig in side_pots:
                best_rank = None
                pot_winners = []
                for idx in sp_elig:
                    hole = players[idx].get("hole_cards") or []
                    r = _best_hand_seven(hole, board)
                    if best_rank is None or r > best_rank:
                        best_rank = r
                        pot_winners = [players[idx]]
                    elif r == best_rank:
                        pot_winners.append(players[idx])
                sp_split = sp_amt // len(pot_winners)
                sp_rem = sp_amt - sp_split * len(pot_winners)
                for i, w in enumerate(pot_winners):
                    uid = w.get("user_id")
                    winner_payouts[uid] = winner_payouts.get(uid, 0) + sp_split + (sp_rem if i == 0 else 0)

            showdown_hands = {}
            for p in players:
                uid = p.get("user_id")
                if uid:
                    lbl = _mp_poker_evaluated_hand_label(p, board)
                    if lbl:
                        showdown_hands[uid] = lbl

            for p in players:
                uid = p.get("user_id")
                results.append({
                    "user_id": uid,
                    "result": "win" if uid in winner_payouts else "lose",
                    "payout": winner_payouts.get(uid, 0),
                    "hand": showdown_hands.get(uid),
                })
        last_snap = _mp_poker_last_hand_showdown_snapshot(g, players, board, pot, results) if is_tournament else None
        if is_tournament:
            # Tournament hand: pot is returned to winner stack(s), not paid out to wallet.
            newly_busted_uids: list[str] = []
            for p in players:
                uid = (p.get("user_id") or "").strip()
                if not uid:
                    continue
                win_amt = int(winner_payouts.get(uid) or 0)
                if win_amt > 0:
                    p["stack"] = int(p.get("stack") or 0) + win_amt
                if int(p.get("stack") or 0) <= 0:
                    p["stack"] = 0
                    p["status"] = "busted"
                    newly_busted_uids.append(uid)
                else:
                    p["status"] = "waiting"
                p["current_bet"] = 0
                p["total_bet_this_hand"] = 0
                p["ready"] = True
                p["hole_cards"] = []
            players = _tournament_survivors(players)
            elim_patch = (
                {"$push": {"tournament_eliminations": {"$each": newly_busted_uids}}}
                if newly_busted_uids
                else {}
            )
            if len(players) <= 1:
                patch = {
                    "$set": {"players": players, "pot": 0, "results": results, "last_hand_showdown": last_snap},
                    **elim_patch,
                }
                await db.mp_poker_games.update_one({"id": game_id}, patch)
                await _tournament_finalize_if_done(game_id)
                return
            next_button = (int(g.get("button_index") or 0) + 1) % len(players)
            patch = {
                "$set": {
                    "status": "open",
                    "phase": "settled",
                    "street": None,
                    "board": [],
                    "deck": [],
                    "pot": 0,
                    "results": results,
                    "last_hand_showdown": last_snap,
                    "players": players,
                    "all_ready_at": None,
                    "button_index": next_button,
                },
                **elim_patch,
            }
            await db.mp_poker_games.update_one({"id": game_id}, patch)
            await _mp_poker_deal_new_hand(game_id)
            return

        # Single-hand table cashout: return remaining stack + any pot share to each player.
        # Without this, unbet chips disappear when the table settles.
        cashout_rows: List[Tuple[str, str, int, int]] = []
        for p in players:
            uid = (p.get("user_id") or "").strip()
            if not uid or uid == "dealer":
                continue
            stack_refund = max(0, int(p.get("stack") or 0))
            pot_win = max(0, int(winner_payouts.get(uid) or 0))
            cashout = stack_refund + pot_win
            cashout_rows.append((uid, (p.get("username") or "?").strip(), cashout, pot_win))
            if cashout <= 0:
                continue
            await db.users.update_one({"id": uid}, {"$inc": {"money": cashout}})
            await log_gambling(
                uid,
                p.get("username") or "?",
                "mp_poker",
                {
                    "action": "payout",
                    "game_id": game_id,
                    "winnings": cashout,
                    "stack_refund": stack_refund,
                    "pot_win": pot_win,
                    "mode": "vs_players",
                },
            )
        now_iso = datetime.now(timezone.utc).isoformat()
        ent_funded = bool(g.get("entertainer_funded"))
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {"$set": {"status": "completed", "phase": "settled", "results": results, "completed_at": now_iso}},
        )
        if ent_funded and not is_tournament:
            buy_in = int(g.get("buy_in") or 0)
            extra_prize = int(g.get("extra_prize") or 0)
            seed_cash = float(buy_in + extra_prize)
            top_c = max((c[2] for c in cashout_rows), default=0)
            tops = [c for c in cashout_rows if c[2] == top_c and top_c > 0]
            if tops:
                wnames = " / ".join(t[1] for t in tops)
                wid = tops[0][0] if len(tops) == 1 else None
            else:
                wnames = None
                wid = None
            await on_funded_game_completed(
                db,
                ref_id=game_id,
                source="mp_poker",
                send_notification=send_notification,
                log_points_event=log_points_event,
                outcome={
                    "winner_username": wnames,
                    "winner_id": wid,
                    "total_winnings_points": 0,
                    "total_winnings_cash": float(top_c),
                    "from_entertainer_fund_points": 0,
                    "from_entertainer_fund_cash": seed_cash,
                    "mp_poker_subkind": "table",
                },
            )

    def _first_actor_after_advance(players: list, start_idx: int) -> int:
        """First seat index that can act (not folded, not all_in). If none, return start_idx."""
        return _next_actionable_index(players, start_idx)

    async def _mp_poker_deal_new_hand(game_id: str) -> Optional[dict]:
        """Shuffle, post blinds, set preflop turn. Used after /start and after tournament showdown."""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("mode") not in ("vs_players", "tournament"):
            return None
        is_tournament = _is_tournament_game(g)
        if is_tournament:
            if g.get("approval_status") != "approved":
                return None
            g = await _maybe_progress_tournament_blinds(game_id) or g
        players = list(g.get("players") or [])
        if is_tournament:
            players = _tournament_survivors(players)
            if len(players) < 2:
                return await _tournament_finalize_if_done(game_id)
        elif len(players) < 2:
            return None
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
            p["acted_this_street"] = False
            p["status"] = "active"
        if n == 2:
            sb_seat = button_index
            bb_seat = (button_index + 1) % 2
        else:
            sb_seat = (button_index + 1) % n
            bb_seat = (button_index + 2) % n
        sb_stack = max(0, int(players[sb_seat].get("stack") or 0))
        sb_post = min(sb, sb_stack)
        players[sb_seat]["stack"] = sb_stack - sb_post
        players[sb_seat]["current_bet"] = sb_post
        players[sb_seat]["total_bet_this_hand"] = sb_post
        if players[sb_seat]["stack"] <= 0:
            players[sb_seat]["stack"] = 0
            players[sb_seat]["status"] = "all_in"
        bb_stack = max(0, int(players[bb_seat].get("stack") or 0))
        bb_post = min(bb, bb_stack)
        players[bb_seat]["stack"] = bb_stack - bb_post
        players[bb_seat]["current_bet"] = bb_post
        players[bb_seat]["total_bet_this_hand"] = bb_post
        if players[bb_seat]["stack"] <= 0:
            players[bb_seat]["stack"] = 0
            players[bb_seat]["status"] = "all_in"
        pot = int(g.get("pot") or 0) + sb_post + bb_post
        if n == 2:
            first_act = _first_actor_after_advance(players, button_index)
        else:
            first_act = _first_actor_after_advance(players, (button_index + 3) % n)
        preflop_to_call = max(int(x.get("current_bet") or 0) for x in players)
        now_iso = datetime.now(timezone.utc).isoformat()
        set_deal: Dict[str, Any] = {
            "status": "playing",
            "phase": "playing",
            "tournament_status": "running" if is_tournament else g.get("tournament_status"),
            "street": "preflop",
            "players": players,
            "deck": deck,
            "board": [],
            "pot": pot,
            "current_turn_index": first_act,
            "first_turn_index_this_street": first_act,
            "turn_started_at": now_iso,
            "to_call": preflop_to_call,
            "min_raise": bb,
            "hand_number": int(g.get("hand_number") or 0) + 1,
            "blind_level_started_at": g.get("blind_level_started_at") or now_iso if is_tournament else g.get("blind_level_started_at"),
            "all_ready_at": None,
        }
        if is_tournament:
            set_deal["results"] = None
        await db.mp_poker_games.update_one(
            {"id": game_id},
            {"$set": set_deal},
        )
        if players[first_act].get("status") in ("folded", "all_in"):
            await _mp_poker_advance_street(game_id)
        return await db.mp_poker_games.find_one({"id": game_id})

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
            p["acted_this_street"] = False
        button = int(g.get("button_index") or 0)
        bb = int(g.get("big_blind") or 2)
        if street == "preflop":
            if deck:
                deck.pop()  # burn
            for _ in range(3):
                if deck:
                    board.append(deck.pop())
            first = _first_actor_after_advance(players, (button + 1) % n)
            if players[first].get("status") in ("folded", "all_in"):
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"street": "flop", "board": board, "deck": deck, "players": players, "to_call": 0, "min_raise": bb}},
                )
                await _mp_poker_advance_street(game_id)
            else:
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"street": "flop", "board": board, "deck": deck, "players": players, "current_turn_index": first, "first_turn_index_this_street": first, "to_call": 0, "min_raise": bb, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
                )
        elif street == "flop":
            if deck:
                deck.pop()  # burn
            if deck:
                board.append(deck.pop())
            first = _first_actor_after_advance(players, (button + 1) % n)
            if players[first].get("status") in ("folded", "all_in"):
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"street": "turn", "board": board, "deck": deck, "players": players, "to_call": 0, "min_raise": bb}},
                )
                await _mp_poker_advance_street(game_id)
            else:
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"street": "turn", "board": board, "deck": deck, "players": players, "current_turn_index": first, "first_turn_index_this_street": first, "to_call": 0, "min_raise": bb, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
                )
        elif street == "turn":
            if deck:
                deck.pop()  # burn
            if deck:
                board.append(deck.pop())
            first = _first_actor_after_advance(players, (button + 1) % n)
            if players[first].get("status") in ("folded", "all_in"):
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"street": "river", "board": board, "deck": deck, "players": players, "to_call": 0, "min_raise": bb}},
                )
                await _mp_poker_advance_street(game_id)
            else:
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"street": "river", "board": board, "deck": deck, "players": players, "current_turn_index": first, "first_turn_index_this_street": first, "to_call": 0, "min_raise": bb, "turn_started_at": datetime.now(timezone.utc).isoformat()}},
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
        if not g or g.get("mode") not in ("vs_players", "tournament") or g.get("phase") != "ready":
            raise HTTPException(status_code=400, detail="Game not in ready phase")
        is_tournament = _is_tournament_game(g)
        if is_tournament:
            if g.get("approval_status") != "approved":
                raise HTTPException(status_code=400, detail="Tournament is not approved")
            g = await _maybe_progress_tournament_blinds(game_id) or g
        players = list(g.get("players") or [])
        min_players = MP_POKER_TOURNAMENT_MIN_PLAYERS if is_tournament and g.get("tournament_status") == "registration" else 2
        if not all(p.get("ready") for p in players) or len(players) < min_players:
            raise HTTPException(status_code=400, detail="Not all ready")
        if is_tournament:
            players = _tournament_survivors(players)
            if len(players) < 2:
                g = await _tournament_finalize_if_done(game_id)
                return _serialize_mp_poker_game(g, uid, enrich=True)
        g = await _mp_poker_deal_new_hand(game_id)
        if not g:
            raise HTTPException(status_code=400, detail="Could not start hand")
        return _serialize_mp_poker_game(g, uid, enrich=True)

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
        if not g or g.get("mode") not in ("vs_players", "tournament") or g.get("status") != "playing":
            raise HTTPException(status_code=404, detail="Game not found or not playing")
        players = list(g.get("players") or [])
        turn_idx = int(g.get("current_turn_index") or 0)
        if turn_idx < 0 or turn_idx >= len(players) or players[turn_idx].get("user_id") != uid:
            raise HTTPException(status_code=400, detail="Not your turn")
        p = players[turn_idx]
        if p.get("status") in ("folded", "all_in"):
            raise HTTPException(status_code=400, detail="Cannot act")
        for x in players:
            if "acted_this_street" not in x:
                x["acted_this_street"] = False
        to_call = int(g.get("to_call") or 0)
        bb = max(1, int(g.get("big_blind") or 1))
        pot = int(g.get("pot") or 0)
        stack = int(p.get("stack") or 0)
        current_bet = int(p.get("current_bet") or 0)
        need_to_call = to_call - current_bet
        prev_max_bet = max(int(x.get("current_bet") or 0) for x in players)
        min_raise_updated = bb
        if action == "fold":
            p["status"] = "folded"
            p["last_action"] = {"action": "fold"}
            p["acted_this_street"] = True
            active = [x for x in players if x.get("status") not in ("folded",)]
            if len(active) == 1:
                await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"players": players, "street": "showdown"}})
                await _mp_poker_run_showdown(game_id)
                g = await db.mp_poker_games.find_one({"id": game_id})
                return _serialize_mp_poker_game(g, uid, enrich=True)
        elif action == "check":
            if need_to_call > 0:
                raise HTTPException(status_code=400, detail="Cannot check")
            p["last_action"] = {"action": "check"}
            p["acted_this_street"] = True
        elif action == "call":
            amt = min(need_to_call, stack)
            p["stack"] = stack - amt
            p["current_bet"] = current_bet + amt
            p["total_bet_this_hand"] = int(p.get("total_bet_this_hand") or 0) + amt
            pot += amt
            p["last_action"] = {"action": "call", "amount": amt}
            p["acted_this_street"] = True
            if p["stack"] <= 0:
                p["stack"] = 0
                p["status"] = "all_in"
        elif action in ("bet", "raise"):
            effective = action
            if effective == "raise" and to_call <= 0:
                effective = "bet"
            try:
                amt = int(amount)
            except (TypeError, ValueError):
                amt = 0
            if amt > stack:
                amt = stack
            if amt <= 0:
                raise HTTPException(status_code=400, detail="Invalid amount")
            if effective == "bet":
                if to_call > 0:
                    raise HTTPException(status_code=400, detail="Cannot open bet — call, raise, or fold")
                if amt < stack and amt < bb:
                    raise HTTPException(status_code=400, detail=f"Bet must be at least {bb:,}")
            else:
                new_bet = current_bet + amt
                if new_bet < to_call:
                    if amt < stack:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Must match the current bet ({to_call:,}) or go all-in",
                        )
                elif new_bet > to_call:
                    if amt < stack and new_bet < to_call + bb:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Minimum total bet to raise is {to_call + bb:,} (or go all-in)",
                        )
            p["stack"] = stack - amt
            p["current_bet"] = current_bet + amt
            p["total_bet_this_hand"] = int(p.get("total_bet_this_hand") or 0) + amt
            pot += amt
            if p["stack"] <= 0:
                p["stack"] = 0
                p["status"] = "all_in"
            p["last_action"] = {"action": effective, "amount": amt}
            p["acted_this_street"] = True
            max_bet_amt = max(int(x.get("current_bet") or 0) for x in players)
            if max_bet_amt > prev_max_bet:
                _reset_acted_this_street_for_raise(players, turn_idx)
                p["acted_this_street"] = True
                min_raise_updated = bb
        elif action == "all_in":
            amt = stack
            p["stack"] = 0
            p["current_bet"] = current_bet + amt
            p["total_bet_this_hand"] = int(p.get("total_bet_this_hand") or 0) + amt
            p["status"] = "all_in"
            pot += amt
            p["last_action"] = {"action": "all_in", "amount": amt}
            p["acted_this_street"] = True
            max_bet_amt = max(int(x.get("current_bet") or 0) for x in players)
            if max_bet_amt > prev_max_bet:
                _reset_acted_this_street_for_raise(players, turn_idx)
                p["acted_this_street"] = True
                min_raise_updated = bb
        else:
            raise HTTPException(status_code=400, detail="Invalid action")
        max_bet = max(int(x.get("current_bet") or 0) for x in players)
        round_complete = _is_betting_round_complete(players)
        if round_complete:
            await db.mp_poker_games.update_one(
                {"id": game_id},
                {"$set": {"players": players, "pot": pot, "to_call": 0}},
            )
            await _mp_poker_advance_street(game_id)
        else:
            next_idx = _next_actionable_index(players, turn_idx + 1)
            if next_idx < 0 or not _player_can_act(players[next_idx]):
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {"$set": {"players": players, "pot": pot, "to_call": max_bet, "min_raise": min_raise_updated}},
                )
                await _mp_poker_advance_street(game_id)
            else:
                await db.mp_poker_games.update_one(
                    {"id": game_id},
                    {
                        "$set": {
                            "players": players,
                            "pot": pot,
                            "to_call": max_bet,
                            "min_raise": min_raise_updated,
                            "current_turn_index": next_idx,
                            "turn_started_at": datetime.now(timezone.utc).isoformat(),
                        }
                    },
                )
        g = await db.mp_poker_games.find_one({"id": game_id})
        return _serialize_mp_poker_game(g, uid, enrich=True)

    @router.post("/casino/mp-poker/games/{game_id}/timeout")
    async def game_timeout(game_id: str, current_user: dict = Depends(get_current_user_verified)):
        """Auto-fold on turn timeout. For vs_dealer, if current player is all-in, run out the board instead of folding."""
        uid = current_user.get("id") or ""
        g = await db.mp_poker_games.find_one({"id": game_id})
        if not g or g.get("status") != "playing":
            raise HTTPException(status_code=404, detail="Game not found")
        if not _can_view_poker_game(g, current_user):
            raise HTTPException(status_code=403, detail="Not in this game")
        turn_idx = int(g.get("current_turn_index") or 0)
        players = list(g.get("players") or [])
        if turn_idx < 0 or turn_idx >= len(players):
            return _serialize_mp_poker_game(g, uid, enrich=True)
        turn_started = _parse_iso_utc(g.get("turn_started_at"))
        elapsed = (datetime.now(timezone.utc) - turn_started).total_seconds() if turn_started else 0
        timed_out = elapsed >= MP_POKER_TURN_SECONDS
        # Never fold / advance on timeout until server clock says the turn actually expired.
        # (Previously: current player could POST before 30s and still fold — client timer + skew vs UTC.)
        if not timed_out:
            return _serialize_mp_poker_game(g, uid, enrich=True)
        # Seated players (or staff) may apply the auto-fold once the clock has expired.
        # If current player is all-in they cannot fold by timeout; run out/advance street instead.
        if players[turn_idx].get("status") == "all_in" and g.get("street") in ("preflop", "flop", "turn", "river"):
            await _mp_poker_advance_street(game_id)
            g = await db.mp_poker_games.find_one({"id": game_id})
            return _serialize_mp_poker_game(g, uid, enrich=True)
        # Vs dealer: if human is all-in, run out the board instead of folding (fixes stuck all-in hand)
        if g.get("mode") == "vs_dealer" and players[turn_idx].get("status") == "all_in":
            human = next((p for p in players if not p.get("is_bot")), None)
            if human and human.get("status") == "all_in" and g.get("street") in ("preflop", "flop", "turn", "river"):
                g = await _vs_dealer_run_out_all_in(game_id)
                return _serialize_mp_poker_game(g, uid, enrich=True)
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
        return _serialize_mp_poker_game(g, uid, enrich=True)

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
        uid = str(current_user.get("id") or "").strip()
        players = list(g.get("players") or [])
        if g.get("mode") in ("vs_players", "tournament") and not any(
            str(p.get("user_id") or "").strip() == uid for p in players
        ):
            raise HTTPException(status_code=403, detail="Only seated players can chat")
        chat = list(g.get("chat") or [])
        chat.append({"user_id": current_user.get("id") or "", "username": current_user.get("username") or "Player", "message": msg, "at": datetime.now(timezone.utc).isoformat()})
        await db.mp_poker_games.update_one({"id": game_id}, {"$set": {"chat": chat[-50:]}})
        g = await db.mp_poker_games.find_one({"id": game_id})
        return _serialize_mp_poker_game(g, uid, enrich=True)