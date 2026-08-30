# Casino MDG (Pot Game): create game (fee points/money/both), join, list; one winner takes pot; auto-roll when N spots filled
from datetime import datetime, timezone, timedelta
from typing import Any, List, Optional
import asyncio
import logging
import math
import secrets
_rng = secrets.SystemRandom()
import uuid

from bson import ObjectId
from pymongo import ReturnDocument
from pydantic import BaseModel
from fastapi import Depends, HTTPException, Request

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    send_notification,
    log_gambling,
    _is_admin,
    _is_moderator,
    _is_entertainer,
    CASINO_MIN_OWNER_MAX_BET,
    _user_owns_any_casino,
    _user_owns_airport,
    _user_owns_bullet_factory,
)
from utils.entertainer_service import (
    ENTERTAINER_MDG_MAX_POINTS_PER_GAME,
    try_debit_entertainer_fund,
    insert_funded_game_row,
    on_funded_game_completed,
)
from utils.gambling_self_ban import is_gambling_self_banned, raise_if_gambling_self_banned
from utils.mdg_prize_holds import (
    MDG_PRIZE_HOLD_DISPLAY_NAME,
    mdg_prize_hold_owner_id,
    mongo_unowned_owner_clause,
)
from utils.point_provenance import log_points_event

MDG_MIN_PLAYERS = 2
MDG_MAX_PLAYERS = 100
ENTERTAINER_MDG_MIN_MAX_PLAYERS = 4  # entertainer-created tables must seat at least this many
MDG_MAX_OPEN_GAMES_PER_USER = 3
MDG_MAX_FEE_POINTS = 100_000_000
MDG_MAX_FEE_MONEY = 50_000_000_000
MDG_MAX_EXTRA_POT_POINTS = 100_000_000
MDG_MAX_EXTRA_POT_MONEY = 50_000_000_000

# --- Anti-bot join tokens (layer 1, always on) — same scheme as entertainer E-Game joins. ---
# Issued per-user with the games list; joins must echo the token back. A minimum age check
# means a script that fetches the list and joins in the same instant fails; single-use per join.
MDG_JOIN_TOKEN_TTL_SECONDS = 600
MDG_JOIN_TOKEN_MIN_AGE_SECONDS = 1.5

# ── Automated MDG constants ──
AUTO_MDG_CYCLE_HOURS = 3
AUTO_MDG_GAMES_PER_CYCLE = 3
AUTO_MDG_POT_MIN = 50_000_000
AUTO_MDG_POT_MAX = 150_000_000
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


def _mdg_uses_entertainer_fund(user: dict) -> bool:
    """Entertainer fund path — admins are exempt even if they also have the entertainer flag."""
    return bool(_is_entertainer(user) and not _is_admin(user))


def _mdg_entry_is_staff_flagged(entry: dict) -> bool:
    return bool(entry and entry.get("is_staff"))


async def _mdg_user_is_staff(user_id: str) -> bool:
    if not user_id:
        return False
    u = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "email": 1, "is_moderator": 1, "is_admin": 1},
    )
    if not u:
        return False
    return bool(_is_admin(u) or _is_moderator(u))


async def _mdg_eligible_win_pool(entries: list) -> list:
    """Admins/mods may enter MDG but are never eligible to win."""
    out = []
    for e in entries or []:
        uid = (e.get("user_id") or "").strip()
        if not uid or uid == "__house__":
            continue
        if _mdg_entry_is_staff_flagged(e):
            continue
        if await _mdg_user_is_staff(uid):
            continue
        out.append(e)
    return out


# Admin-only side prizes (tokens / skips / unowned state assets). Granted to winner on roll.
MDG_ADMIN_TOKEN_TYPES = (
    # Armoury perk / skip tokens
    "xp_crimes",
    "xp_gta",
    "auto_rank_2h",
    "crew_oc_auto_3h",
    "melt",
    "oc_reduced",
    "booze",
    "racket",
    "travel",
    "properties",
    "jailbust_bonus",
    "auto_collect_12h",
    "auto_collect_24h",
    "cooldown_skip_crime",
    "cooldown_skip_gta",
    "cooldown_skip_booze",
    "cooldown_skip_properties",
    "rank_xp_pass",
    # Store count-only
    "jail_bailout",
    "mission_skip",
    "robot_bodyguard_hire",
)
MDG_STORE_TOKEN_FIELDS = {
    "jail_bailout": "jail_bailout_tokens",
    "mission_skip": "mission_skip_tokens",
    "robot_bodyguard_hire": "robot_bodyguard_hire_tokens",
}
MDG_UNOWNED_CASINO_COLLECTIONS = {
    "dice": "dice_ownership",
    "roulette": "roulette_ownership",
    "blackjack": "blackjack_ownership",
    "horseracing": "horseracing_ownership",
    "videopoker": "videopoker_ownership",
    "slots": "slots_ownership",
}


class MDGAdminPrize(BaseModel):
    """Admin-only prize attached to an MDG (in addition to the cash/points pot)."""
    kind: str  # token | unowned_airport | unowned_armoury | unowned_casino
    token_type: Optional[str] = None
    amount: int = 1
    state: Optional[str] = None
    casino: Optional[str] = None  # dice|roulette|blackjack|horseracing|videopoker|slots
    label: Optional[str] = None  # display override


class MDGCreateRequest(BaseModel):
    fee_points: int = 0
    fee_money: float = 0
    max_players: int = 10
    auto_roll_at: Optional[int] = None  # when this many spots filled, auto roll; null = manual only (or when max_players)
    extra_pot_points: int = 0
    extra_pot_money: float = 0
    admin_prizes: Optional[List[MDGAdminPrize]] = None


class MDGJoinRequest(BaseModel):
    game_id: str
    table_seat: Optional[str] = None
    cf_response: Optional[str] = None


class MDGRollRequest(BaseModel):
    game_id: str


def _mdg_normalize_admin_prizes(raw_prizes, *, is_admin: bool) -> list:
    if not raw_prizes:
        return []
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only admins can attach bonus prizes to an MDG")
    from server import STATES

    out = []
    for p in raw_prizes:
        kind = (getattr(p, "kind", None) or (p.get("kind") if isinstance(p, dict) else None) or "").strip().lower()
        if not kind:
            continue
        amount = max(1, int(getattr(p, "amount", None) or (p.get("amount") if isinstance(p, dict) else 1) or 1))
        token_type = (getattr(p, "token_type", None) or (p.get("token_type") if isinstance(p, dict) else None) or "").strip().lower() or None
        state = (getattr(p, "state", None) or (p.get("state") if isinstance(p, dict) else None) or "").strip() or None
        casino = (getattr(p, "casino", None) or (p.get("casino") if isinstance(p, dict) else None) or "").strip().lower() or None
        label = (getattr(p, "label", None) or (p.get("label") if isinstance(p, dict) else None) or "").strip() or None

        if kind == "token":
            if not token_type or token_type not in MDG_ADMIN_TOKEN_TYPES:
                raise HTTPException(status_code=400, detail=f"Invalid admin token prize: {token_type}")
            if amount > 100:
                raise HTTPException(status_code=400, detail="Token prize amount max is 100")
            label = label or f"{amount}× {token_type.replace('_', ' ')}"
            out.append({"kind": "token", "token_type": token_type, "amount": amount, "label": label})
        elif kind in ("unowned_airport", "unowned_armoury"):
            if not state or state not in STATES:
                raise HTTPException(status_code=400, detail=f"Invalid state for {kind}")
            label = label or f"Unowned {('airport' if kind == 'unowned_airport' else 'armoury')} · {state}"
            out.append({"kind": kind, "state": state, "label": label})
        elif kind == "unowned_casino":
            if not state or state not in STATES:
                raise HTTPException(status_code=400, detail="Invalid state for unowned casino")
            if not casino or casino not in MDG_UNOWNED_CASINO_COLLECTIONS:
                raise HTTPException(status_code=400, detail="Invalid casino type for unowned casino prize")
            label = label or f"Unowned {casino} · {state}"
            out.append({"kind": "unowned_casino", "state": state, "casino": casino, "label": label})
        else:
            raise HTTPException(status_code=400, detail=f"Unknown admin prize kind: {kind}")
    if len(out) > 20:
        raise HTTPException(status_code=400, detail="Too many admin prizes (max 20)")
    return out


def _mdg_prizes_include_assets(prizes: list) -> bool:
    for p in prizes or []:
        kind = (p.get("kind") or "").strip().lower()
        if kind in ("unowned_airport", "unowned_armoury", "unowned_casino"):
            return True
    return False


def _mdg_asset_claimable_filter(*, hold_id: Optional[str] = None, extra: Optional[dict] = None) -> dict:
    """Match unowned rows, or optionally the MDG hold for this game."""
    if hold_id:
        owner_clause = {"$or": [mongo_unowned_owner_clause(), {"owner_id": hold_id}]}
    else:
        owner_clause = mongo_unowned_owner_clause()
    if extra:
        return {"$and": [extra, owner_clause]}
    return owner_clause


async def _mdg_release_admin_asset_holds(game_id: str) -> None:
    """Clear MDG prize holds so assets become claimable again."""
    if not game_id:
        return
    hold_id = mdg_prize_hold_owner_id(game_id)
    release_set = {"owner_id": None, "owner_username": None}
    unset_doc = {"below_capo_acquired_at": ""}
    try:
        await db.airport_ownership.update_many(
            {"owner_id": hold_id},
            {"$set": release_set, "$unset": unset_doc},
        )
        await db.bullet_factory.update_many(
            {"owner_id": hold_id},
            {"$set": release_set, "$unset": unset_doc},
        )
        casino_set = {**release_set, "max_bet": CASINO_MIN_OWNER_MAX_BET}
        for coll_name in MDG_UNOWNED_CASINO_COLLECTIONS.values():
            coll = getattr(db, coll_name)
            await coll.update_many(
                {"owner_id": hold_id},
                {"$set": casino_set, "$unset": unset_doc},
            )
        try:
            from routers.admin.airport import _invalidate_airports_list_cache

            _invalidate_airports_list_cache()
        except Exception:
            pass
    except Exception:
        _logger.exception("MDG release asset holds failed game_id=%s", game_id)


async def _mdg_reserve_admin_asset_prizes(game_id: str, prizes: list) -> None:
    """Atomically claim unowned airport/armoury/casino prizes for this MDG so nobody else can own them."""
    assets = [
        p
        for p in (prizes or [])
        if (p.get("kind") or "").strip().lower() in ("unowned_airport", "unowned_armoury", "unowned_casino")
    ]
    if not assets:
        return
    hold_id = mdg_prize_hold_owner_id(game_id)
    hold_name = MDG_PRIZE_HOLD_DISPLAY_NAME
    try:
        for p in assets:
            kind = (p.get("kind") or "").strip().lower()
            state = (p.get("state") or "").strip()
            label = p.get("label") or kind
            if kind == "unowned_airport":
                res = await db.airport_ownership.find_one_and_update(
                    {"$and": [{"state": state}, mongo_unowned_owner_clause()]},
                    {
                        "$set": {"owner_id": hold_id, "owner_username": hold_name},
                        "$unset": {"below_capo_acquired_at": ""},
                    },
                    return_document=ReturnDocument.AFTER,
                )
                if not res:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot reserve {label}: airport in {state} is no longer unowned",
                    )
            elif kind == "unowned_armoury":
                res = await db.bullet_factory.find_one_and_update(
                    {"$and": [{"state": state}, mongo_unowned_owner_clause()]},
                    {
                        "$set": {"owner_id": hold_id, "owner_username": hold_name},
                        "$unset": {"below_capo_acquired_at": ""},
                    },
                    return_document=ReturnDocument.AFTER,
                )
                if not res:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot reserve {label}: armoury in {state} is no longer unowned",
                    )
            elif kind == "unowned_casino":
                casino = (p.get("casino") or "").strip().lower()
                coll_name = MDG_UNOWNED_CASINO_COLLECTIONS.get(casino)
                if not coll_name:
                    raise HTTPException(status_code=400, detail=f"Cannot reserve {label}: bad casino type")
                coll = getattr(db, coll_name)
                loc_filter = {"$or": [{"city": state}, {"state": state}]}
                res = await coll.find_one_and_update(
                    {"$and": [loc_filter, mongo_unowned_owner_clause()]},
                    {
                        "$set": {
                            "owner_id": hold_id,
                            "owner_username": hold_name,
                            "max_bet": CASINO_MIN_OWNER_MAX_BET,
                        },
                        "$unset": {"below_capo_acquired_at": ""},
                    },
                    return_document=ReturnDocument.AFTER,
                )
                if not res:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot reserve {label}: {casino} in {state} is no longer unowned",
                    )
        try:
            from routers.admin.airport import _invalidate_airports_list_cache

            _invalidate_airports_list_cache()
        except Exception:
            pass
    except Exception:
        await _mdg_release_admin_asset_holds(game_id)
        raise


async def _mdg_raise_if_blocked_from_asset_prize_game(user_id: str, user: dict, prizes: list) -> None:
    """Players who already own a casino, airport, or armoury cannot join MDGs that award those assets."""
    if not _mdg_prizes_include_assets(prizes):
        return
    if _is_admin(user) or _is_moderator(user):
        return
    if await _user_owns_any_casino(user_id):
        raise HTTPException(
            status_code=400,
            detail="You already own a casino — you cannot join an MDG that awards casino / airport / armoury prizes.",
        )
    if await _user_owns_airport(user_id):
        raise HTTPException(
            status_code=400,
            detail="You already own an airport — you cannot join an MDG that awards casino / airport / armoury prizes.",
        )
    if await _user_owns_bullet_factory(user_id):
        raise HTTPException(
            status_code=400,
            detail="You already own an armoury — you cannot join an MDG that awards casino / airport / armoury prizes.",
        )


async def _mdg_grant_admin_prizes(
    winner_id: str,
    winner_username: str,
    prizes: list,
    *,
    game_id: Optional[str] = None,
) -> list:
    """Grant admin side-prizes. Returns list of {label, ok, detail}."""
    results = []
    if not prizes or not winner_id:
        return results
    from routers.kill.armoury import TOKEN_CONFIG

    hold_id = mdg_prize_hold_owner_id(game_id) if game_id else None

    for p in prizes:
        kind = (p.get("kind") or "").strip().lower()
        label = p.get("label") or kind
        try:
            if kind == "token":
                tt = (p.get("token_type") or "").strip().lower()
                amount = max(1, int(p.get("amount") or 1))
                if tt in MDG_STORE_TOKEN_FIELDS:
                    field = MDG_STORE_TOKEN_FIELDS[tt]
                    await db.users.update_one({"id": winner_id}, {"$inc": {field: amount}})
                    results.append({"label": label, "ok": True, "detail": f"+{amount} {field}"})
                elif tt in TOKEN_CONFIG:
                    field = TOKEN_CONFIG[tt]["count_field"]
                    await db.users.update_one({"id": winner_id}, {"$inc": {field: amount}})
                    results.append({"label": label, "ok": True, "detail": f"+{amount} {field}"})
                else:
                    results.append({"label": label, "ok": False, "detail": "unknown token"})
            elif kind == "unowned_airport":
                state = (p.get("state") or "").strip()
                res = None
                if hold_id:
                    res = await db.airport_ownership.find_one_and_update(
                        {"state": state, "owner_id": hold_id},
                        {
                            "$set": {"owner_id": winner_id, "owner_username": winner_username},
                            "$unset": {"below_capo_acquired_at": ""},
                        },
                        return_document=ReturnDocument.AFTER,
                    )
                if not res:
                    res = await db.airport_ownership.find_one_and_update(
                        _mdg_asset_claimable_filter(extra={"state": state}),
                        {
                            "$set": {"owner_id": winner_id, "owner_username": winner_username},
                            "$unset": {"below_capo_acquired_at": ""},
                        },
                        return_document=ReturnDocument.AFTER,
                    )
                if not res:
                    results.append({"label": label, "ok": False, "detail": "already owned or missing"})
                else:
                    try:
                        from routers.admin.airport import _invalidate_airports_list_cache

                        _invalidate_airports_list_cache()
                    except Exception:
                        pass
                    results.append({"label": label, "ok": True, "detail": f"airport {state}"})
            elif kind == "unowned_armoury":
                state = (p.get("state") or "").strip()
                res = None
                if hold_id:
                    res = await db.bullet_factory.find_one_and_update(
                        {"state": state, "owner_id": hold_id},
                        {
                            "$set": {"owner_id": winner_id, "owner_username": winner_username},
                            "$unset": {"below_capo_acquired_at": ""},
                        },
                        return_document=ReturnDocument.AFTER,
                    )
                if not res:
                    res = await db.bullet_factory.find_one_and_update(
                        _mdg_asset_claimable_filter(extra={"state": state}),
                        {
                            "$set": {"owner_id": winner_id, "owner_username": winner_username},
                            "$unset": {"below_capo_acquired_at": ""},
                        },
                        return_document=ReturnDocument.AFTER,
                    )
                if not res:
                    results.append({"label": label, "ok": False, "detail": "already owned or missing"})
                else:
                    results.append({"label": label, "ok": True, "detail": f"armoury {state}"})
            elif kind == "unowned_casino":
                state = (p.get("state") or "").strip()
                casino = (p.get("casino") or "").strip().lower()
                coll_name = MDG_UNOWNED_CASINO_COLLECTIONS.get(casino)
                if not coll_name:
                    results.append({"label": label, "ok": False, "detail": "bad casino type"})
                    continue
                coll = getattr(db, coll_name)
                loc_filter = {"$or": [{"city": state}, {"state": state}]}
                casino_set = {
                    "owner_id": winner_id,
                    "owner_username": winner_username,
                    "max_bet": CASINO_MIN_OWNER_MAX_BET,
                }
                res = None
                if hold_id:
                    res = await coll.find_one_and_update(
                        {"$and": [loc_filter, {"owner_id": hold_id}]},
                        {"$set": casino_set, "$unset": {"below_capo_acquired_at": ""}},
                        return_document=ReturnDocument.AFTER,
                    )
                if not res:
                    res = await coll.find_one_and_update(
                        _mdg_asset_claimable_filter(extra=loc_filter),
                        {"$set": casino_set, "$unset": {"below_capo_acquired_at": ""}},
                        return_document=ReturnDocument.AFTER,
                    )
                if not res:
                    results.append({"label": label, "ok": False, "detail": "already owned or missing"})
                else:
                    results.append({"label": label, "ok": True, "detail": f"{casino} {state}"})
            else:
                results.append({"label": label, "ok": False, "detail": "unknown kind"})
        except Exception as ex:
            _logger.exception("MDG admin prize grant failed kind=%s winner=%s", kind, winner_id)
            results.append({"label": label, "ok": False, "detail": str(ex)[:120]})
    if game_id:
        await _mdg_release_admin_asset_holds(game_id)
    return results


async def _mdg_settle_winner(
    *,
    game: dict,
    game_id: str,
    entries: list,
    winner_entry: dict,
    roll: int,
    pot_pts: int,
    pot_money: float,
    trigger: str,
) -> dict:
    """Claim game, pay pot + admin prizes, notify. Returns response fields."""
    winner_id = winner_entry["user_id"]
    winner_user = await db.users.find_one({"id": winner_id}, {"_id": 0, "username": 1})
    winner_username = (winner_user and winner_user.get("username")) or winner_entry.get("username") or "?"
    now_iso = datetime.now(timezone.utc).isoformat()
    prize_results = []
    claim_res = await db.mdg_games.find_one_and_update(
        {"id": game_id, "status": "open"},
        {
            "$set": {
                "status": "completed",
                "winner_id": winner_id,
                "winner_username": winner_username,
                "rolled_at": now_iso,
                "roll": roll,
            }
        },
    )
    if not claim_res:
        return {"already_closed": True}
    winner_before_payout = await db.users.find_one_and_update(
        {"id": winner_id},
        {"$inc": {"points": pot_pts, "money": pot_money}},
        projection={"_id": 0, "points": 1},
        return_document=ReturnDocument.BEFORE,
    )
    if pot_pts > 0:
        pts_before_payout = int((winner_before_payout or {}).get("points") or 0)
        await log_points_event(
            db,
            user_id=winner_id,
            points=pot_pts,
            event_type="casino_mdg",
            event_ref=f"payout:{game_id}",
            source="casino_mdg",
            correlation_id=game_id,
            context={
                "action": "winner_payout",
                "result": "won",
                "game_id": game_id,
                "host": {"id": game.get("created_by"), "username": game.get("created_by_username")},
                "opponents": [{"id": e.get("user_id"), "username": e.get("username")} for e in entries if e.get("user_id") != winner_id],
                "stake_points": int(winner_entry.get("paid_points") or 0),
                "payout_points": pot_pts,
                "pot_points": pot_pts,
                "trigger": trigger,
            },
            meta={"action": "winner_payout", "game_id": game_id, "pot_points": pot_pts, "trigger": trigger},
            wallet_points_before=pts_before_payout,
            wallet_points_after=pts_before_payout + pot_pts,
        )
    await log_gambling(
        winner_id,
        winner_username,
        "mdg",
        {"action": "payout", "game_id": game_id, "pot_points": pot_pts, "pot_money": pot_money, "trigger": trigger},
    )
    admin_prizes = list(game.get("admin_prizes") or [])
    if admin_prizes:
        prize_results = await _mdg_grant_admin_prizes(
            winner_id, winner_username, admin_prizes, game_id=game_id
        )
        try:
            await db.mdg_games.update_one(
                {"id": game_id},
                {"$set": {"admin_prize_results": prize_results}},
            )
        except Exception:
            pass
    else:
        await _mdg_release_admin_asset_holds(game_id)
    prize_ok = [r["label"] for r in prize_results if r.get("ok")]
    prize_fail = [r["label"] for r in prize_results if not r.get("ok")]
    msg_bits = [f"You won the pot: {pot_pts} pts, ${pot_money:,.0f}"]
    if prize_ok:
        msg_bits.append("Bonus: " + ", ".join(prize_ok))
    if prize_fail:
        msg_bits.append("Could not grant: " + ", ".join(prize_fail))
    await send_notification(winner_id, "🎲 MDG Won", ". ".join(msg_bits), "reward")
    # Notify losers
    sent_to = {winner_id}
    for e in entries or []:
        uid = (e.get("user_id") or "").strip()
        if not uid or uid in sent_to:
            continue
        sent_to.add(uid)
        try:
            await send_notification(
                uid,
                "🎲 MDG Result",
                f"You lost this MDG. Winner: {winner_username}. Final pot: {pot_pts} pts, ${pot_money:,.0f}.",
                "system",
            )
        except Exception:
            continue
    return {
        "already_closed": False,
        "winner_id": winner_id,
        "winner_username": winner_username,
        "roll": roll,
        "pot_points": pot_pts,
        "pot_money": pot_money,
        "admin_prize_results": prize_results,
    }


def _mdg_parse_iso(raw) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


async def _mdg_issue_join_token(uid: str, *, ready_immediately: bool = False) -> Optional[str]:
    """Store a new join token for uid. If ready_immediately, backdate issued_at past min-age."""
    uid = str(uid or "").strip()
    if not uid:
        return None
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    if ready_immediately:
        issued_at = (now - timedelta(seconds=MDG_JOIN_TOKEN_MIN_AGE_SECONDS + 0.05)).isoformat()
    else:
        issued_at = now.isoformat()
    await db.mdg_table_seats.update_one(
        {"user_id": uid},
        {"$set": {"token": token, "issued_at": issued_at}},
        upsert=True,
    )
    return token


async def _mdg_get_or_issue_join_token(uid: str) -> Optional[str]:
    """Return existing unexpired join token, or issue a new one.

    Reusing avoids the games-list poll rotating the token under an in-flight Join
    (which caused false 'invalid' alerts while a later tap with the new token still joined).
    """
    uid = str(uid or "").strip()
    if not uid:
        return None
    row = await db.mdg_table_seats.find_one(
        {"user_id": uid},
        {"_id": 0, "token": 1, "issued_at": 1},
    )
    stored = str((row or {}).get("token") or "").strip()
    if stored:
        issued_at = _mdg_parse_iso((row or {}).get("issued_at"))
        if issued_at is not None:
            age = (datetime.now(timezone.utc) - issued_at).total_seconds()
            if 0 <= age <= MDG_JOIN_TOKEN_TTL_SECONDS:
                return stored
    return await _mdg_issue_join_token(uid)


async def _require_mdg_join_token(
    http_request: Request,
    current_user: dict,
    game_id: str,
    join_token: Optional[str],
) -> None:
    """Layer-1 anti-bot (same as entertainer E-Game joins): validate + consume the single-use
    join token issued with the games list. Enforces a minimum human delay between list fetch and join.
    Join never proceeds past this without a successful token consume."""
    uid = str(current_user.get("id") or "")
    token = (join_token or "").strip()
    fail_reason = None
    if not token:
        fail_reason = "missing"
    else:
        row = await db.mdg_table_seats.find_one({"user_id": uid}, {"_id": 0, "token": 1, "issued_at": 1})
        stored = str((row or {}).get("token") or "")
        # compare_digest requires equal length — treat mismatch as invalid (not 500).
        if not stored or len(stored) != len(token) or not secrets.compare_digest(stored, token):
            fail_reason = "invalid"
        else:
            issued_at = _mdg_parse_iso((row or {}).get("issued_at"))
            age = (datetime.now(timezone.utc) - issued_at).total_seconds() if issued_at else None
            if age is None or age > MDG_JOIN_TOKEN_TTL_SECONDS:
                fail_reason = "expired"
            elif age < MDG_JOIN_TOKEN_MIN_AGE_SECONDS:
                fail_reason = "too_fresh"
            else:
                # Atomic consume: only one concurrent join can win this token.
                consumed = await db.mdg_table_seats.find_one_and_delete(
                    {"user_id": uid, "token": token},
                    projection={"_id": 1},
                )
                if not consumed:
                    fail_reason = "invalid"
    if not fail_reason:
        return
    try:
        from utils.captcha_failure_log import log_captcha_turnstile_failure

        await log_captcha_turnstile_failure(
            db,
            request=http_request,
            current_user=current_user,
            reason=f"mdg_join_token_{fail_reason}",
            detail=f"game_id={game_id}",
        )
    except Exception:
        _logger.exception("mdg join token failure log failed")
    try:
        from utils.staff_bot_client_alert import maybe_notify_staff_ent_join_token_fail

        await maybe_notify_staff_ent_join_token_fail(
            db=db,
            request=http_request,
            user_id=uid,
            username=current_user.get("username") or "?",
            game_id=game_id,
            reason=fail_reason,
            context_label="MDG",
            endpoint_desc="/casino/mdg/join",
            source="mdg_join_token_fail",
        )
    except Exception:
        _logger.exception("mdg join token staff alert failed")
    if fail_reason == "too_fresh":
        raise HTTPException(status_code=400, detail="Please wait briefly before joining.")
    raise HTTPException(status_code=400, detail="Could not verify join — reload the table and try again.")


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
            {"_id": 0, "id": 1, "created_by": 1, "created_by_username": 1, "created_at": 1, "fee_points": 1, "fee_money": 1, "max_players": 1, "auto_roll_at": 1, "extra_pot_points": 1, "extra_pot_money": 1, "entries": 1, "pot_points": 1, "pot_money": 1, "status": 1, "is_automated": 1, "house_pot": 1, "auto_roll_deadline": 1, "admin_prizes": 1, "staff_cannot_win": 1},
        ).sort("created_at", -1)
        games = await cursor.to_list(100)
        # Anti-bot: reuse unexpired join token across list polls (consumed only on successful join).
        join_token = None
        try:
            uid = str(current_user.get("id") or "")
            if uid:
                join_token = await _mdg_get_or_issue_join_token(uid)
        except Exception:
            _logger.exception("mdg join token issue failed")
            join_token = None
        return {"games": [_mdg_sanitize_for_json(g) for g in games], "table_seat": join_token}

    @router.get("/casino/mdg/admin-prize-options")
    async def mdg_admin_prize_options(current_user: dict = Depends(get_current_user_verified)):
        """Admin-only: token types + currently unowned state assets for MDG bonus prizes."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        from server import STATES

        unowned = {"airport": [], "armoury": [], "casino": []}
        for state in STATES:
            air = await db.airport_ownership.find_one(
                {
                    "state": state,
                    "$or": [{"owner_id": None}, {"owner_id": ""}, {"owner_id": {"$exists": False}}],
                },
                {"_id": 0, "state": 1, "slot": 1},
            )
            if air:
                unowned["airport"].append({"state": state, "slot": air.get("slot")})
            arm = await db.bullet_factory.find_one(
                {
                    "state": state,
                    "$or": [{"owner_id": None}, {"owner_id": ""}, {"owner_id": {"$exists": False}}],
                },
                {"_id": 0, "state": 1},
            )
            if arm:
                unowned["armoury"].append({"state": state})
            for casino, coll_name in MDG_UNOWNED_CASINO_COLLECTIONS.items():
                coll = getattr(db, coll_name)
                doc = await coll.find_one(
                    {
                        "$and": [
                            {"$or": [{"city": state}, {"state": state}]},
                            {"$or": [{"owner_id": None}, {"owner_id": ""}, {"owner_id": {"$exists": False}}]},
                        ]
                    },
                    {"_id": 0, "city": 1, "state": 1},
                )
                if doc:
                    unowned["casino"].append({"state": state, "casino": casino})

        token_labels = {
            "mission_skip": "Mission Skip",
            "jail_bailout": "Jail Bailout",
            "robot_bodyguard_hire": "Free Robot Bodyguard hire",
            "cooldown_skip_properties": "Properties Collect Skip",
            "cooldown_skip_crime": "Crime Cooldown Skip",
            "cooldown_skip_gta": "GTA Cooldown Skip",
            "cooldown_skip_booze": "Booze Cooldown Skip",
            "auto_rank_2h": "Auto Rank 2h",
            "rank_xp_pass": "Game Pass (rank XP)",
        }
        tokens = [
            {"token_type": t, "label": token_labels.get(t, t.replace("_", " ").title())}
            for t in MDG_ADMIN_TOKEN_TYPES
        ]
        return {"states": list(STATES), "tokens": tokens, "unowned": unowned}

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
        # Admins/mods may still host MDGs while self-excluded (player casinos stay locked).
        if not (_is_admin(current_user) or _is_moderator(current_user)):
            raise_if_gambling_self_banned(current_user)
        uid = current_user["id"]
        is_admin_creator = bool(_is_admin(current_user))
        open_count = await db.mdg_games.count_documents({"created_by": uid, "status": "open"})
        if not is_admin_creator and open_count >= MDG_MAX_OPEN_GAMES_PER_USER:
            raise HTTPException(status_code=400, detail=f"You can only have {MDG_MAX_OPEN_GAMES_PER_USER} open games at once. Roll or wait for existing games to fill.")

        fee_pts = max(0, int(request.fee_points or 0))
        fee_money = max(0.0, float(request.fee_money or 0))
        if fee_pts <= 0 and fee_money <= 0:
            raise HTTPException(status_code=400, detail="Set a fee: points and/or money must be greater than 0")
        if not is_admin_creator and (fee_pts > MDG_MAX_FEE_POINTS or fee_money > MDG_MAX_FEE_MONEY):
            raise HTTPException(status_code=400, detail="Fee exceeds maximum allowed")
        max_players = max(MDG_MIN_PLAYERS, min(MDG_MAX_PLAYERS, int(request.max_players or 10)))
        use_ent_fund = _mdg_uses_entertainer_fund(current_user)
        if use_ent_fund and max_players < ENTERTAINER_MDG_MIN_MAX_PLAYERS:
            raise HTTPException(
                status_code=400,
                detail=f"Entertainer-created MDG games must allow at least {ENTERTAINER_MDG_MIN_MAX_PLAYERS} players (set Max players ≥ {ENTERTAINER_MDG_MIN_MAX_PLAYERS}).",
            )
        auto_roll_at = None
        if request.auto_roll_at is not None:
            auto_roll_at = max(MDG_MIN_PLAYERS, min(max_players, int(request.auto_roll_at)))
        extra_pts = max(0, int(request.extra_pot_points or 0))
        extra_money = max(0.0, float(request.extra_pot_money or 0))
        if not is_admin_creator and (extra_pts > MDG_MAX_EXTRA_POT_POINTS or extra_money > MDG_MAX_EXTRA_POT_MONEY):
            raise HTTPException(status_code=400, detail="Extra pot exceeds maximum allowed")

        # Creator is auto-joined: must have enough to pay fee + extra pot
        total_pts = fee_pts + extra_pts
        total_money = fee_money + extra_money
        if use_ent_fund and total_pts > ENTERTAINER_MDG_MAX_POINTS_PER_GAME:
            raise HTTPException(
                status_code=400,
                detail=f"Entertainer MDG: fee points + extra pot points cannot exceed {ENTERTAINER_MDG_MAX_POINTS_PER_GAME:,} (from your entertainer fund).",
            )
        admin_prizes = _mdg_normalize_admin_prizes(request.admin_prizes, is_admin=_is_admin(current_user))
        user = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
        if not user:
            raise HTTPException(status_code=400, detail="User not found")
        await _mdg_raise_if_blocked_from_asset_prize_game(uid, current_user, admin_prizes)

        game_id = str(uuid.uuid4())
        await _mdg_reserve_admin_asset_prizes(game_id, admin_prizes)
        now_iso = datetime.now(timezone.utc).isoformat()
        creator_is_staff = bool(_is_admin(current_user) or _is_moderator(current_user))
        creator_entry = {
            "user_id": uid,
            "username": user.get("username") or "?",
            "paid_points": fee_pts,
            "paid_money": fee_money,
            "is_staff": creator_is_staff,
        }
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
            "admin_prizes": admin_prizes,
            "staff_cannot_win": True,
        }
        if use_ent_fund:
            ok = await try_debit_entertainer_fund(db, uid, total_money, total_pts)
            if not ok:
                await _mdg_release_admin_asset_holds(game_id)
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
                    source="casino_mdg",
                    correlation_id=game_id,
                    context={"action": "create_fee", "game_id": game_id, "host": {"id": uid, "username": user.get("username")}, "opponents": [], "stake_points": total_pts, "fee_points": fee_pts, "extra_pot_points": extra_pts, "from": "entertainer_fund"},
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
        deduct_filter = {"id": uid}
        deduct_inc = {}
        if total_pts:
            deduct_filter["points"] = {"$gte": total_pts}
            deduct_inc["points"] = -total_pts
        if total_money:
            deduct_filter["money"] = {"$gte": total_money}
            deduct_inc["money"] = -total_money
        if deduct_inc:
            user_before_create = await db.users.find_one_and_update(
                deduct_filter,
                {"$inc": deduct_inc},
                projection={"_id": 0, "points": 1},
                return_document=ReturnDocument.BEFORE,
            )
            if not user_before_create:
                await _mdg_release_admin_asset_holds(game_id)
                raise HTTPException(status_code=400, detail="Insufficient points or money to create and join (fee + extra pot)")
            if total_pts > 0:
                pts_before_create = int(user_before_create.get("points") or 0)
                await log_points_event(
                    db,
                    user_id=uid,
                    points=-total_pts,
                    event_type="casino_mdg",
                    event_ref=f"create:{game_id}",
                    source="casino_mdg",
                    correlation_id=game_id,
                    context={"action": "create_fee", "game_id": game_id, "host": {"id": uid, "username": user.get("username")}, "opponents": [], "stake_points": total_pts, "fee_points": fee_pts, "extra_pot_points": extra_pts},
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
    async def mdg_join(request: MDGJoinRequest, http_request: Request, current_user: dict = Depends(get_current_user_verified)):
        """Join an open game. Pay fee (points/money); if auto_roll_at is reached, roll runs and one winner takes the pot.
        Anti-bot: requires the single-use join_token from the games list (+ optional Turnstile when enabled)."""
        if is_gambling_self_banned(current_user):
            preview = await db.mdg_games.find_one(
                {"id": request.game_id, "status": "open"},
                {"_id": 0, "created_by": 1, "entries": 1},
            )
            creator_id = str((preview or {}).get("created_by") or "")
            creator_entry = next(
                (e for e in ((preview or {}).get("entries") or []) if e.get("user_id") == creator_id),
                None,
            )
            staff_created = _mdg_entry_is_staff_flagged(creator_entry or {}) or await _mdg_user_is_staff(creator_id)
            if not staff_created:
                raise_if_gambling_self_banned(current_user)
        game = await db.mdg_games.find_one({"id": request.game_id, "status": "open"}, {"_id": 0})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found or already closed")
        uid = current_user["id"]
        await _mdg_raise_if_blocked_from_asset_prize_game(uid, current_user, list(game.get("admin_prizes") or []))
        await _require_mdg_join_token(http_request, current_user, request.game_id, request.table_seat)
        from utils.minigame_captcha_gate import require_turnstile_for_ent_join

        await require_turnstile_for_ent_join(
            db,
            request=http_request,
            current_user=current_user,
            captcha_token=request.cf_response,
            is_admin=_is_admin(current_user),
        )
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

        joiner_is_staff = bool(_is_admin(current_user) or _is_moderator(current_user))
        entry = {
            "user_id": uid,
            "username": user.get("username") or "?",
            "paid_points": fee_pts,
            "paid_money": fee_money,
            "is_staff": joiner_is_staff,
        }
        new_entries = entries + [entry]
        new_pot_pts = int(game.get("pot_points") or 0) + fee_pts
        new_pot_money = float(game.get("pot_money") or 0) + fee_money

        deduct_filter = {"id": uid}
        deduct_inc = {}
        if fee_pts:
            deduct_filter["points"] = {"$gte": fee_pts}
            deduct_inc["points"] = -fee_pts
        if fee_money:
            deduct_filter["money"] = {"$gte": fee_money}
            deduct_inc["money"] = -fee_money
        if deduct_inc:
            user_before_join = await db.users.find_one_and_update(
                deduct_filter,
                {"$inc": deduct_inc},
                projection={"_id": 0, "points": 1},
                return_document=ReturnDocument.BEFORE,
            )
            if not user_before_join:
                raise HTTPException(status_code=400, detail="Insufficient points or money")
            if fee_pts > 0:
                pts_before_join = int(user_before_join.get("points") or 0)
                await log_points_event(
                    db,
                    user_id=uid,
                    points=-fee_pts,
                    event_type="casino_mdg",
                    event_ref=f"join:{request.game_id}",
                    source="casino_mdg",
                    correlation_id=request.game_id,
                    context={"action": "join_fee", "game_id": request.game_id, "host": {"id": game.get("created_by"), "username": game.get("created_by_username")}, "opponents": [{"id": e.get("user_id"), "username": e.get("username")} for e in entries], "stake_points": fee_pts, "fee_points": fee_pts},
                    meta={"action": "join_fee", "game_id": request.game_id, "fee_points": fee_pts},
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
            user_before_refund = await db.users.find_one_and_update(
                {"id": uid},
                {"$inc": {"points": fee_pts, "money": fee_money}},
                projection={"_id": 0, "points": 1},
                return_document=ReturnDocument.BEFORE,
            )
            if fee_pts > 0:
                pts_before_refund = int((user_before_refund or {}).get("points") or 0)
                await log_points_event(
                    db,
                    user_id=uid,
                    points=fee_pts,
                    event_type="casino_mdg",
                    event_ref=f"refund:{request.game_id}",
                    source="casino_mdg",
                    correlation_id=request.game_id,
                    context={"action": "join_refund", "result": "refunded", "game_id": request.game_id, "host": {"id": game.get("created_by"), "username": game.get("created_by_username")}, "opponents": [{"id": e.get("user_id"), "username": e.get("username")} for e in entries], "refund_points": fee_pts},
                    meta={"action": "join_refund", "game_id": request.game_id, "fee_points": fee_pts},
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

            # Regular (non-automated) game roll — staff excluded from win pool
            pool = await _mdg_eligible_win_pool(new_entries)
            if not pool:
                return {
                    "message": "Joined. Game is full of staff only — cannot roll until a non-staff player joins.",
                    "players": len(new_entries),
                    "pot_points": new_pot_pts,
                    "pot_money": new_pot_money,
                }
            roll = _rng.randrange(1, len(pool) + 1)
            winner_entry = pool[roll - 1]
            settled = await _mdg_settle_winner(
                game=game,
                game_id=request.game_id,
                entries=new_entries,
                winner_entry=winner_entry,
                roll=roll,
                pot_pts=new_pot_pts,
                pot_money=new_pot_money,
                trigger="auto_roll",
            )
            if settled.get("already_closed"):
                return {"message": "Joined", "players": len(new_entries), "pot_points": new_pot_pts, "pot_money": new_pot_money}
            if game.get("entertainer_funded"):
                fee_pts_g = int(game.get("fee_points") or 0)
                extra_pts_g = int(game.get("extra_pot_points") or 0)
                fee_money_g = float(game.get("fee_money") or 0)
                extra_money_g = float(game.get("extra_pot_money") or 0)
                await on_funded_game_completed(
                    db,
                    ref_id=request.game_id,
                    source="mdg",
                    send_notification=send_notification,
                    log_points_event=log_points_event,
                    outcome={
                        "winner_username": settled["winner_username"],
                        "winner_id": settled["winner_id"],
                        "total_winnings_points": int(new_pot_pts),
                        "total_winnings_cash": float(new_pot_money),
                        "from_entertainer_fund_points": fee_pts_g + extra_pts_g,
                        "from_entertainer_fund_cash": fee_money_g + extra_money_g,
                    },
                )
            return {
                "message": "Joined; game rolled. One winner takes the pot.",
                "roll": settled["roll"],
                "winner_id": settled["winner_id"],
                "winner_username": settled["winner_username"],
                "pot_points": new_pot_pts,
                "pot_money": new_pot_money,
                "admin_prize_results": settled.get("admin_prize_results") or [],
            }

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

        pool = await _mdg_eligible_win_pool(entries)
        if not pool:
            raise HTTPException(
                status_code=400,
                detail="No eligible winners — admins/mods can enter but cannot win. Need at least one non-staff player.",
            )
        roll = _rng.randrange(1, len(pool) + 1)
        winner_entry = pool[roll - 1]
        pot_pts = int(game.get("pot_points") or 0)
        pot_money = float(game.get("pot_money") or 0)
        settled = await _mdg_settle_winner(
            game=game,
            game_id=request.game_id,
            entries=entries,
            winner_entry=winner_entry,
            roll=roll,
            pot_pts=pot_pts,
            pot_money=pot_money,
            trigger="manual_roll",
        )
        if settled.get("already_closed"):
            raise HTTPException(status_code=400, detail="Game already closed")
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
                    "winner_username": settled["winner_username"],
                    "winner_id": settled["winner_id"],
                    "total_winnings_points": int(pot_pts),
                    "total_winnings_cash": float(pot_money),
                    "from_entertainer_fund_points": fee_pts + extra_pts,
                    "from_entertainer_fund_cash": fee_money + extra_money,
                },
            )
        return {
            "message": "Roll complete. One winner takes the pot.",
            "roll": settled["roll"],
            "winner_id": settled["winner_id"],
            "winner_username": settled["winner_username"],
            "pot_points": pot_pts,
            "pot_money": pot_money,
            "admin_prize_results": settled.get("admin_prize_results") or [],
        }
