# Casino Slots: state-owned or player-owned (3h lottery). Enter to win draw; owner sets max bet & buy-back.
# If owner can't pay a win, ownership transfers to winner (buy-back offer). After your 3h you can't enter next draw.
from datetime import datetime, timezone, timedelta
import re
import random
import uuid
from typing import Optional
from pydantic import BaseModel, field_validator

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    STATES,
    log_gambling,
    _user_owns_any_casino,
)

# ----- Constants -----
SLOTS_MAX_BET = 5_000_000
SLOTS_HOUSE_EDGE = 0.05  # 5% house edge on wins
SLOTS_OWNERSHIP_HOURS = 3
# 3-reel slot: symbols with weights (higher = more frequent)
SLOTS_SYMBOLS = [
    {"id": "cherry", "name": "Cherry", "weight": 40, "mult_3": 3},
    {"id": "lemon", "name": "Lemon", "weight": 25, "mult_3": 5},
    {"id": "bar", "name": "Bar", "weight": 15, "mult_3": 20},
    {"id": "bell", "name": "Bell", "weight": 12, "mult_3": 10},
    {"id": "seven", "name": "Seven", "weight": 8, "mult_3": 50},
]
SLOTS_HISTORY_MAX = 20

_ownership_cache = {}
_OWNERSHIP_TTL_SEC = 10
_OWNERSHIP_MAX_ENTRIES = 5000


def _invalidate_slots_ownership_cache(user_id: str):
    _ownership_cache.pop(user_id, None)


def _normalize_state(state_raw: str) -> str:
    if not (state_raw or "").strip():
        return STATES[0] if STATES else ""
    s = (state_raw or "").strip()
    for st in STATES or []:
        if st and s.lower() == st.lower():
            return st
    return STATES[0] if STATES else s


async def _get_slots_ownership_doc(state: str):
    """Return (normalized_state, doc). Doc may have expired owner - caller checks expires_at."""
    if not state:
        return None, None
    pattern = re.compile(f"^{re.escape(state)}$", re.IGNORECASE)
    doc = await db.slots_ownership.find_one({"state": pattern}, {"_id": 0})
    if doc:
        return doc.get("state") or state, doc
    norm = _normalize_state(state)
    doc = await db.slots_ownership.find_one({"state": norm}, {"_id": 0})
    if doc:
        return norm, doc
    return norm, None


def _is_slots_ownership_expired(doc: dict) -> bool:
    if not doc or not doc.get("owner_id"):
        return True
    exp = doc.get("expires_at")
    if not exp:
        return True
    try:
        t = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) >= t
    except Exception:
        return True


async def _run_slots_draw_if_needed(state: str):
    """If no valid owner (none or expired), run draw: pick random from entries (not in cooldown), set owner 3h, clear entries, set previous owner cooldown."""
    stored_state, doc = await _get_slots_ownership_doc(state)
    now = datetime.now(timezone.utc)
    has_valid_owner = doc and doc.get("owner_id") and not _is_slots_ownership_expired(doc)
    if has_valid_owner:
        return
    previous_owner_id = doc.get("owner_id") if doc else None
    # Clear expired owner and set cooldown for previous owner
    cooldown_until = (now + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()
    if previous_owner_id:
        await db.users.update_one({"id": previous_owner_id}, {"$set": {"slots_cooldown_until": cooldown_until}})
    await db.slots_ownership.update_one(
        {"state": stored_state or state},
        {"$set": {"owner_id": None, "owner_username": None}},
        upsert=True,
    )
    # Get entries and filter by cooldown
    entries_doc = await db.slots_entries.find_one({"state": stored_state or state}, {"_id": 0, "user_ids": 1})
    user_ids = list(entries_doc.get("user_ids") or [])
    if not user_ids:
        return
    # Filter: user must not be in cooldown
    eligible = []
    for uid in user_ids:
        u = await db.users.find_one({"id": uid}, {"_id": 0, "slots_cooldown_until": 1})
        if not u:
            continue
        until = u.get("slots_cooldown_until")
        if until:
            try:
                t = datetime.fromisoformat(until.replace("Z", "+00:00"))
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                if now < t:
                    continue
            except Exception:
                pass
        eligible.append(uid)
    if not eligible:
        await db.slots_entries.update_one({"state": stored_state or state}, {"$set": {"user_ids": []}}, upsert=True)
        return
    winner_id = random.choice(eligible)
    winner = await db.users.find_one({"id": winner_id}, {"_id": 0, "username": 1})
    expires_at = (now + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()
    st = stored_state or state
    await db.slots_ownership.update_one(
        {"state": st},
        {
            "$set": {
                "state": st,
                "owner_id": winner_id,
                "owner_username": (winner.get("username") or "?"),
                "max_bet": SLOTS_MAX_BET,
                "buy_back_reward": 0,
                "expires_at": expires_at,
                "profit": 0,
            }
        },
        upsert=True,
    )
    await db.slots_entries.update_one({"state": st}, {"$set": {"user_ids": []}}, upsert=True)
    for uid in set(user_ids):
        _invalidate_slots_ownership_cache(uid)


# ----- Models -----
class SlotsSpinRequest(BaseModel):
    bet: int

    @field_validator("bet", mode="before")
    @classmethod
    def coerce_bet(cls, v):
        if v is None:
            return 0
        if isinstance(v, str):
            return int(v.strip() or 0)
        return int(v)


class SlotsEnterRequest(BaseModel):
    state: str


class SlotsSetMaxBetRequest(BaseModel):
    state: str
    max_bet: int


class SlotsSetBuyBackRequest(BaseModel):
    state: str
    amount: int


class SlotsBuyBackAcceptRequest(BaseModel):
    offer_id: str


class SlotsBuyBackRejectRequest(BaseModel):
    offer_id: str


def _slots_weighted_symbol():
    total = sum(s["weight"] for s in SLOTS_SYMBOLS)
    r = random.uniform(0, total)
    acc = 0
    for sym in SLOTS_SYMBOLS:
        acc += sym["weight"]
        if r <= acc:
            return sym
    return SLOTS_SYMBOLS[-1]


def _slots_spin() -> tuple:
    return (_slots_weighted_symbol(), _slots_weighted_symbol(), _slots_weighted_symbol())


def _slots_payout(reels: tuple, bet: int) -> int:
    a, b, c = reels
    if a["id"] == b["id"] == c["id"]:
        mult = a["mult_3"]
        gross = bet * mult
        return max(0, int(gross * (1.0 - SLOTS_HOUSE_EDGE)))
    return 0


def register(router):
    @router.get("/casino/slots/config")
    async def casino_slots_config(current_user: dict = Depends(get_current_user)):
        """Slots config: max_bet (owner or default), symbols, current_state, states. May be state-owned or player-owned."""
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        current_state = _normalize_state(raw) if raw else (STATES[0] if STATES else "")
        await _run_slots_draw_if_needed(current_state)
        stored_state, doc = await _get_slots_ownership_doc(current_state)
        max_bet = SLOTS_MAX_BET
        state_owned = True
        owner_id = None
        expires_at = None
        if doc and doc.get("owner_id") and not _is_slots_ownership_expired(doc):
            max_bet = doc.get("max_bet") if doc.get("max_bet") is not None else SLOTS_MAX_BET
            state_owned = False
            owner_id = doc.get("owner_id")
            expires_at = doc.get("expires_at")
        return {
            "max_bet": max_bet,
            "house_edge": SLOTS_HOUSE_EDGE,
            "symbols": list(SLOTS_SYMBOLS),
            "current_state": current_state,
            "states": list(STATES or []),
            "state_owned": state_owned,
            "owner_id": owner_id,
            "expires_at": expires_at,
            "ownership_hours": SLOTS_OWNERSHIP_HOURS,
        }

    @router.get("/casino/slots/ownership")
    async def casino_slots_ownership(current_user: dict = Depends(get_current_user)):
        """Current state's slots: owner (if any), is_owner, max_bet, buy_back_reward, expires_at, can_enter, entries count."""
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        state = _normalize_state(raw) if raw else (STATES[0] if STATES else "")
        if state not in (STATES or []):
            return {"state": state, "is_owner": False, "max_bet": SLOTS_MAX_BET, "can_enter": False, "entries_count": 0}
        await _run_slots_draw_if_needed(state)
        stored_state, doc = await _get_slots_ownership_doc(state)
        owner_id = doc.get("owner_id") if doc else None
        is_valid_owner = owner_id and not _is_slots_ownership_expired(doc)
        max_bet = (doc.get("max_bet") if doc.get("max_bet") is not None else SLOTS_MAX_BET) if doc else SLOTS_MAX_BET
        buy_back_reward = (doc.get("buy_back_reward") or 0) if doc else 0
        expires_at = doc.get("expires_at") if doc else None
        is_owner = is_valid_owner and owner_id == current_user["id"]
        # Can enter: not current owner, not in cooldown, state is this state
        can_enter = False
        if not is_owner and state:
            cooldown = current_user.get("slots_cooldown_until")
            if cooldown:
                try:
                    t = datetime.fromisoformat(cooldown.replace("Z", "+00:00"))
                    if t.tzinfo is None:
                        t = t.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) < t:
                        can_enter = False
                    else:
                        can_enter = True
                except Exception:
                    can_enter = True
            else:
                can_enter = True
        entries_doc = await db.slots_entries.find_one({"state": stored_state or state}, {"_id": 0, "user_ids": 1})
        entries_count = len(entries_doc.get("user_ids") or [])
        has_entered = current_user["id"] in (entries_doc.get("user_ids") or []) if entries_doc else False
        return {
            "state": stored_state or state,
            "owner_id": owner_id if is_valid_owner else None,
            "owner_username": doc.get("owner_username") if is_valid_owner else None,
            "is_owner": is_owner,
            "max_bet": max_bet,
            "buy_back_reward": buy_back_reward,
            "expires_at": expires_at,
            "can_enter": can_enter,
            "has_entered": has_entered,
            "entries_count": entries_count,
            "profit": doc.get("profit") if is_owner and doc else None,
        }

    @router.post("/casino/slots/enter")
    async def casino_slots_enter(request: SlotsEnterRequest, current_user: dict = Depends(get_current_user)):
        """Enter the lottery to possibly own slots in this state for 3 hours. One random entrant wins when current ownership ends."""
        _invalidate_slots_ownership_cache(current_user["id"])
        state = _normalize_state((request.state or "").strip())
        if not state or state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        await _run_slots_draw_if_needed(state)
        stored_state, doc = await _get_slots_ownership_doc(state)
        if doc and doc.get("owner_id") == current_user["id"] and not _is_slots_ownership_expired(doc):
            raise HTTPException(status_code=400, detail="You already own the slots here")
        cooldown = current_user.get("slots_cooldown_until")
        if cooldown:
            try:
                t = datetime.fromisoformat(cooldown.replace("Z", "+00:00"))
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) < t:
                    raise HTTPException(status_code=400, detail="You cannot enter yet; wait until after your cooldown (previous 3h ownership)")
            except Exception:
                pass
        await db.slots_entries.update_one(
            {"state": stored_state or state},
            {"$addToSet": {"user_ids": current_user["id"]}},
            upsert=True,
        )
        return {"message": "You have entered the draw. A random winner is chosen when the current owner's 3 hours end."}

    @router.post("/casino/slots/relinquish")
    async def casino_slots_relinquish(request: SlotsEnterRequest, current_user: dict = Depends(get_current_user)):
        """Give up ownership early. You will be on cooldown and cannot enter the next draw."""
        _invalidate_slots_ownership_cache(current_user["id"])
        state = _normalize_state((request.state or "").strip())
        if not state or state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        stored_state, doc = await _get_slots_ownership_doc(state)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own the slots here")
        cooldown_until = (datetime.now(timezone.utc) + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"slots_cooldown_until": cooldown_until}})
        await db.slots_ownership.update_one(
            {"state": stored_state or state},
            {"$set": {"owner_id": None, "owner_username": None}},
        )
        return {"message": "You have relinquished the slots. You cannot enter the next draw for 3 hours."}

    @router.post("/casino/slots/set-max-bet")
    async def casino_slots_set_max_bet(request: SlotsSetMaxBetRequest, current_user: dict = Depends(get_current_user)):
        """Set max bet for your slots (owner only)."""
        _invalidate_slots_ownership_cache(current_user["id"])
        state = _normalize_state((request.state or "").strip())
        if not state or state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        stored_state, doc = await _get_slots_ownership_doc(state)
        if not doc or doc.get("owner_id") != current_user["id"] or _is_slots_ownership_expired(doc):
            raise HTTPException(status_code=403, detail="You do not own the slots here")
        new_max = max(1, min(int(request.max_bet), SLOTS_MAX_BET))
        await db.slots_ownership.update_one({"state": stored_state or state}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/slots/set-buy-back-reward")
    async def casino_slots_set_buy_back_reward(request: SlotsSetBuyBackRequest, current_user: dict = Depends(get_current_user)):
        """Set buy-back reward (points) when you cannot pay a win (owner only)."""
        _invalidate_slots_ownership_cache(current_user["id"])
        state = _normalize_state((request.state or "").strip())
        if not state or state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        stored_state, doc = await _get_slots_ownership_doc(state)
        if not doc or doc.get("owner_id") != current_user["id"] or _is_slots_ownership_expired(doc):
            raise HTTPException(status_code=403, detail="You do not own the slots here")
        amount = max(0, int(request.amount))
        await db.slots_ownership.update_one({"state": stored_state or state}, {"$set": {"buy_back_reward": amount}})
        return {"message": "Buy-back reward updated."}

    @router.post("/casino/slots/buy-back/accept")
    async def casino_slots_buy_back_accept(request: SlotsBuyBackAcceptRequest, current_user: dict = Depends(get_current_user)):
        """Accept buy-back: receive points and return ownership to previous owner."""
        offer = await db.slots_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0})
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found")
        if offer.get("to_user_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not your offer")
        expires = offer.get("expires_at")
        if expires:
            try:
                if datetime.fromisoformat(expires.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                    raise HTTPException(status_code=400, detail="Offer expired")
            except Exception:
                pass
        state = offer.get("state")
        from_owner_id = offer.get("from_owner_id")
        points_offered = int(offer.get("points_offered") or 0)
        if not state or not from_owner_id:
            raise HTTPException(status_code=400, detail="Invalid offer")
        from_user = await db.users.find_one({"id": from_owner_id}, {"_id": 0, "points": 1, "username": 1})
        from_points = int((from_user.get("points") or 0) or 0)
        if from_points < points_offered:
            raise HTTPException(status_code=400, detail="Previous owner does not have enough points")
        await db.users.update_one({"id": from_owner_id}, {"$inc": {"points": -points_offered}})
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": points_offered}})
        stored_state, _ = await _get_slots_ownership_doc(state)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()
        await db.slots_ownership.update_one(
            {"state": stored_state or state},
            {"$set": {"owner_id": from_owner_id, "owner_username": from_user.get("username"), "expires_at": expires_at}},
        )
        await db.slots_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_slots_ownership_cache(current_user["id"])
        _invalidate_slots_ownership_cache(from_owner_id)
        return {"message": "Accepted. You received the points and the slots were returned to the previous owner."}

    @router.post("/casino/slots/buy-back/reject")
    async def casino_slots_buy_back_reject(request: SlotsBuyBackRejectRequest, current_user: dict = Depends(get_current_user)):
        """Reject buy-back: keep ownership."""
        offer = await db.slots_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1})
        if not offer or offer.get("to_user_id") != current_user["id"]:
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.slots_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_slots_ownership_cache(current_user["id"])
        return {"message": "Rejected. You keep the slots."}

    @router.post("/casino/slots/spin")
    async def casino_slots_spin(request: SlotsSpinRequest, current_user: dict = Depends(get_current_user)):
        """Spin the slots. State-owned = house pays. Owner-owned = owner pays wins (or loses ownership if can't pay; buy-back offer)."""
        _invalidate_slots_ownership_cache(current_user["id"])
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        state = _normalize_state(raw) if raw else (STATES[0] if STATES else "")
        if state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        await _run_slots_draw_if_needed(state)
        stored_state, doc = await _get_slots_ownership_doc(state)
        owner_id = doc.get("owner_id") if doc else None
        is_valid_owner = owner_id and not _is_slots_ownership_expired(doc)
        # No owner (or expired) = state-owned: always allow play, house pays
        max_bet = (doc.get("max_bet") if doc and doc.get("max_bet") is not None else SLOTS_MAX_BET)
        if is_valid_owner and owner_id == current_user["id"]:
            raise HTTPException(status_code=400, detail="You cannot play at your own slots")
        bet = int(request.bet or 0)
        if bet < 1:
            raise HTTPException(status_code=400, detail="Bet must be at least 1")
        if bet > max_bet:
            raise HTTPException(status_code=400, detail=f"Max bet is ${max_bet:,}")
        user_money = int(current_user.get("money") or 0)
        if user_money < bet:
            raise HTTPException(status_code=400, detail="Insufficient cash")

        reels = _slots_spin()
        payout_full = _slots_payout(reels, bet)
        win = payout_full > 0

        if not is_valid_owner:
            # State-owned: house pays
            new_money = user_money - bet + payout_full
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"money": new_money}})
            history_entry = {
                "bet": bet,
                "reels": [r["id"] for r in reels],
                "reel_names": [r["name"] for r in reels],
                "payout": payout_full,
                "won": win,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$push": {"slots_history": {"$each": [history_entry], "$position": 0, "$slice": SLOTS_HISTORY_MAX}}},
            )
            await log_gambling(
                current_user["id"],
                current_user.get("username") or "?",
                "slots",
                {"state": state, "bet": bet, "reels": [r["id"] for r in reels], "payout": payout_full, "state_owned": True},
            )
            return {
                "reels": [{"id": r["id"], "name": r["name"]} for r in reels],
                "bet": bet,
                "payout": payout_full,
                "won": win,
                "new_balance": new_money,
                "ownership_transferred": False,
                "buy_back_offer": None,
            }

        # Owner-owned
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -bet}})
        if not win:
            await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
            await db.slots_ownership.update_one({"state": stored_state or state}, {"$inc": {"profit": bet}})
            await log_gambling(
                current_user["id"],
                current_user.get("username") or "?",
                "slots",
                {"state": state, "bet": bet, "reels": [r["id"] for r in reels], "payout": 0, "win": False},
            )
            history_entry = {
                "bet": bet,
                "reels": [r["id"] for r in reels],
                "reel_names": [r["name"] for r in reels],
                "payout": 0,
                "won": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$push": {"slots_history": {"$each": [history_entry], "$position": 0, "$slice": SLOTS_HISTORY_MAX}}},
            )
            return {
                "reels": [{"id": r["id"], "name": r["name"]} for r in reels],
                "bet": bet,
                "payout": 0,
                "won": False,
                "new_balance": user_money - bet,
                "ownership_transferred": False,
                "buy_back_offer": None,
            }

        # Player won: owner pays
        owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1, "username": 1})
        owner_money = int((owner.get("money") or 0) or 0)
        owner_username = owner.get("username") if owner else None
        actual_payout = min(payout_full, owner_money)
        shortfall = payout_full - actual_payout
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": actual_payout}})
        await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_payout}})
        ownership_transferred = False
        buy_back_offer = None
        points_offered = int((doc or {}).get("buy_back_reward") or 0)

        if shortfall > 0:
            if points_offered <= 0:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
                await db.slots_ownership.update_one({"state": stored_state or state}, {"$inc": {"profit": bet - actual_payout}})
                # End owner's 3h: clear ownership and set cooldown
                cooldown_until = (datetime.now(timezone.utc) + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()
                await db.users.update_one({"id": owner_id}, {"$set": {"slots_cooldown_until": cooldown_until}})
                await db.slots_ownership.update_one(
                    {"state": stored_state or state},
                    {"$set": {"owner_id": current_user["id"], "owner_username": current_user.get("username"), "expires_at": (datetime.now(timezone.utc) + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()}},
                )
                ownership_transferred = True
            else:
                ownership_transferred = True
                await db.slots_ownership.update_one(
                    {"state": stored_state or state},
                    {"$set": {"owner_id": current_user["id"], "owner_username": current_user.get("username"), "expires_at": (datetime.now(timezone.utc) + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()}},
                )
                offer_id = str(uuid.uuid4())
                expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                buy_back_doc = {
                    "id": offer_id,
                    "state": stored_state or state,
                    "from_owner_id": owner_id,
                    "from_owner_username": owner_username,
                    "to_user_id": current_user["id"],
                    "to_username": current_user.get("username"),
                    "points_offered": points_offered,
                    "amount_shortfall": shortfall,
                    "owner_paid": actual_payout,
                    "expires_at": expires_at,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                await db.slots_buy_back_offers.insert_one(buy_back_doc)
                buy_back_offer = {"offer_id": offer_id, "points_offered": points_offered, "amount_shortfall": shortfall, "owner_paid": actual_payout, "expires_at": expires_at}
                cooldown_until = (datetime.now(timezone.utc) + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()
                await db.users.update_one({"id": owner_id}, {"$set": {"slots_cooldown_until": cooldown_until}})
        else:
            await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
            await db.slots_ownership.update_one({"state": stored_state or state}, {"$inc": {"profit": bet - actual_payout}})

        history_entry = {
            "bet": bet,
            "reels": [r["id"] for r in reels],
            "reel_names": [r["name"] for r in reels],
            "payout": payout_full,
            "won": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$push": {"slots_history": {"$each": [history_entry], "$position": 0, "$slice": SLOTS_HISTORY_MAX}}},
        )
        await log_gambling(
            current_user["id"],
            current_user.get("username") or "?",
            "slots",
            {"state": state, "bet": bet, "reels": [r["id"] for r in reels], "payout": payout_full, "actual_payout": actual_payout, "shortfall": shortfall},
        )
        new_balance = user_money - bet + actual_payout
        return {
            "reels": [{"id": r["id"], "name": r["name"]} for r in reels],
            "bet": bet,
            "payout": payout_full,
            "won": True,
            "new_balance": new_balance,
            "ownership_transferred": ownership_transferred,
            "buy_back_offer": buy_back_offer,
        }

    @router.get("/casino/slots/history")
    async def casino_slots_history(current_user: dict = Depends(get_current_user)):
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "slots_history": 1})
        history = (user.get("slots_history") or [])[:SLOTS_HISTORY_MAX]
        return {"history": list(reversed(history))}
