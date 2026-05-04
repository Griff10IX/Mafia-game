# Casino Slots: state-owned or player-owned (3h lottery). Enter to win draw; owner sets max bet & buy-back.
# If owner can't pay a win, ownership transfers to winner (buy-back offer). After your 3h you can't enter next draw.
from datetime import datetime, timezone, timedelta
import logging
import re
import secrets
_rng = secrets.SystemRandom()
import uuid
from typing import Optional
from pydantic import BaseModel, field_validator

from fastapi import Depends, HTTPException

from utils.point_provenance import log_points_event
from utils.civilian_protection import maybe_revoke_civilian_protection

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    STATES,
    get_rank_info,
    user_prestige_rank_mult,
    casino_ownership_write_below_capo_ops,
    maybe_auto_relinquish_below_capo,
    CASINO_MIN_OWNER_MAX_BET,
    log_gambling,
    resolve_gambling_log_buy_back,
    get_head_family_id_for_state,
    state_head_casino_treasury_share,
    get_casino_caps,
    assert_casino_clear_of_buy_back_for_relinquish,
    adjust_casino_buy_back_escrow,
    refund_casino_buy_back_escrow_points,
    refund_and_delete_buy_back_offers_matching,
    log_casino_buyback_credit_points,
    _ownership_display_profit,
    bump_user_biggest_casino_payout,
    notify_casino_seizure,
)

# ----- Constants -----
SLOTS_MAX_BET = 5_000_000
SLOTS_HOUSE_EDGE = 0.0005  # 0.05% house edge on wins
SLOTS_OWNERSHIP_HOURS = 3
# Draw every 3 hours on the hour (00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC)
SLOTS_DRAW_HOURS_UTC = (0, 3, 6, 9, 12, 15, 18, 21)
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
    norm = _normalize_state(state)
    if norm:
        await maybe_auto_relinquish_below_capo(db.slots_ownership, {"state": norm}, reset_casino_max_bet=True)
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


async def _active_slots_ownership_elsewhere(user_id: str, current_state: str) -> Optional[dict]:
    """If user has non-expired slots ownership in any state other than current_state, return one such doc."""
    uid = (user_id or "").strip()
    if not uid:
        return None
    cur = _normalize_state(current_state)
    async for doc in db.slots_ownership.find({"owner_id": uid}, {"_id": 0}):
        st = doc.get("state") or ""
        if _normalize_state(st) == cur:
            continue
        if not _is_slots_ownership_expired(doc):
            return doc
    return None


def _parse_iso_datetime(s: str):
    """Parse ISO datetime; return None on error."""
    if not s:
        return None
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t
    except Exception:
        return None


def _next_draw_utc():
    """Return next draw time: next 3h on the hour (00:00, 03:00, 06:00, ..., 21:00 UTC)."""
    now = datetime.now(timezone.utc)
    today = now.date()
    for h in SLOTS_DRAW_HOURS_UTC:
        candidate = datetime(today.year, today.month, today.day, h, 0, 0, 0, tzinfo=timezone.utc)
        if candidate > now:
            return candidate
    return datetime(today.year, today.month, today.day, 0, 0, 0, 0, tzinfo=timezone.utc) + timedelta(days=1)


def get_next_slots_draw_on_the_hour_utc() -> str:
    """Return next draw time as ISO string. Used by admin reset-draw-default."""
    return _next_draw_utc().isoformat()


async def _run_slots_draw_if_needed(state: str):
    """Run draw when next_draw_at is due (every 3h on the hour: 00:00, 03:00, ..., 21:00 UTC). If no entries, advance next_draw_at and continue."""
    stored_state, doc = await _get_slots_ownership_doc(state)
    now = datetime.now(timezone.utc)
    st = stored_state or state
    # Use exact state from doc for DB updates so we always match the document we read
    filter_state = (doc.get("state") if doc else None) or state
    next_draw_at = _parse_iso_datetime(doc.get("next_draw_at") if doc else None) if doc else None

    # Run draw when: no doc, no next_draw_at, or next_draw_at is due (past or now)
    if not doc or not next_draw_at or next_draw_at <= now:
        logging.getLogger().info("Slots draw running for state=%s (doc=%s, next_draw_at=%s)", state, bool(doc), next_draw_at)
        next_draw_iso = _next_draw_utc().isoformat()
        previous_owner_id = doc.get("owner_id") if doc else None
        # Get entries and filter by cooldown only. Slots: one active state per user (cleared on win); other casinos unchanged.
        # Match slots_entries by exact state first, then case-insensitive so we find entries regardless of casing
        entries_doc = await db.slots_entries.find_one({"state": st}, {"_id": 0, "user_ids": 1, "state": 1})
        if not entries_doc:
            entries_pattern = re.compile(f"^{re.escape(st)}$", re.IGNORECASE)
            entries_doc = await db.slots_entries.find_one({"state": entries_pattern}, {"_id": 0, "user_ids": 1, "state": 1})
            if entries_doc:
                logging.getLogger().info("Slots entries for state=%s found via case-insensitive match (doc.state=%r)", state, entries_doc.get("state"))
        user_ids = list((entries_doc or {}).get("user_ids") or [])
        eligible = []
        if user_ids:
            user_docs = await db.users.find(
                {"id": {"$in": user_ids}},
                {"_id": 0, "id": 1, "slots_cooldown_until": 1},
            ).to_list(500)
            cooldown_by_uid = {d["id"]: d.get("slots_cooldown_until") for d in user_docs if d.get("id")}
            for uid in user_ids:
                if uid not in cooldown_by_uid:
                    continue
                until = cooldown_by_uid.get(uid)
                if until:
                    t = _parse_iso_datetime(until)
                    if t and now < t:
                        continue
                eligible.append(uid)
        if eligible:
            # Only the previous owner gets cooldown; entrants who lost can enter the next draw
            cooldown_until = (now + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()
            if previous_owner_id:
                await db.users.update_one({"id": previous_owner_id}, {"$set": {"slots_cooldown_until": cooldown_until}})
            winner_id = _rng.choice(eligible)
            winner = await db.users.find_one({"id": winner_id}, {"_id": 0, "username": 1, "rank_points": 1})
            winner_name = (winner.get("username") or "?") if winner else "?"
            expires_at = next_draw_iso
            winner_rank_id, _ = get_rank_info((winner or {}).get("rank_points", 0), user_prestige_rank_mult(winner))
            slots_set = {
                "state": filter_state,
                "owner_id": winner_id,
                "owner_username": winner_name,
                "max_bet": SLOTS_MAX_BET,
                "buy_back_reward": 0,
                "buy_back_points_held": 0,
                "expires_at": expires_at,
                "next_draw_at": next_draw_iso,
            }
            res = await db.slots_ownership.update_one(
                {"state": filter_state},
                casino_ownership_write_below_capo_ops(slots_set, new_owner_rank_id=winner_rank_id),
                upsert=True,
            )
            # One slots holding per user globally: remove stale owner_id from other states' docs
            async for stale in db.slots_ownership.find({"owner_id": winner_id}, {"_id": 1, "state": 1}):
                ost = _normalize_state((stale.get("state") or ""))
                if ost != _normalize_state(filter_state):
                    await db.slots_ownership.update_one(
                        {"_id": stale["_id"]},
                        {"$set": {"owner_id": None, "owner_username": None}},
                    )
            logging.getLogger().info(
                "Slots draw winner state=%s winner=%s (%s) matched=%s modified=%s",
                state, winner_id, winner_name, res.matched_count, res.modified_count,
            )
            await maybe_revoke_civilian_protection(db, winner_id, "received_casino_transfer")
            entries_state_key = (entries_doc or {}).get("state") or st
            await db.slots_entries.update_one({"state": entries_state_key}, {"$set": {"user_ids": []}}, upsert=True)
            for uid in set(user_ids):
                _invalidate_slots_ownership_cache(uid)
        else:
            # No eligible entries: advance next draw; keep current owner if any (so winner keeps slots until next draw with entries)
            logging.getLogger().info(
                "Slots draw no winner state=%s (entries=%s eligible=%s)",
                state, len(user_ids), len(eligible),
            )
            update_payload = {"state": filter_state, "next_draw_at": next_draw_iso}
            if not (doc and doc.get("owner_id")):
                update_payload["owner_id"] = None
                update_payload["owner_username"] = None
            await db.slots_ownership.update_one(
                {"state": filter_state},
                {"$set": update_payload},
                upsert=True,
            )
        return
    # now < next_draw_at: draw not due yet, do nothing


async def run_slots_draws_due():
    """Run the lottery draw for every state where next_draw_at is due. Call from a background task so draws run on time even if no one is on the page."""
    log = logging.getLogger(__name__)
    now = datetime.now(timezone.utc)
    docs = await db.slots_ownership.find({}, {"_id": 0, "state": 1, "next_draw_at": 1}).to_list(300)
    states_with_doc: set[str] = set()
    due_norm: set[str] = set()
    for d in docs:
        st = (d.get("state") or "").strip()
        if not st:
            continue
        norm = _normalize_state(st)
        states_with_doc.add(norm)
        nd = _parse_iso_datetime(d.get("next_draw_at"))
        if nd is None or nd <= now:
            due_norm.add(norm)
    for state in STATES or []:
        ns = _normalize_state(state)
        if ns not in states_with_doc:
            due_norm.add(ns)
    log.debug("Slots draw check (due_states=%s of %s total STATES)", len(due_norm), len(STATES or []))
    for state in STATES or []:
        if _normalize_state(state) not in due_norm:
            continue
        try:
            await _run_slots_draw_if_needed(state)
        except Exception as e:
            log.exception("Slots draw failed for state %s: %s", state, e)


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
    r = _rng.uniform(0, total)
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
    async def casino_slots_config(current_user: dict = Depends(get_current_user_verified)):
        """Slots config: max_bet (owner or default), symbols, current_state, states. May be state-owned or player-owned."""
        # Log so we can confirm this endpoint is hit (check server console or backend/logs/server.log)
        logging.getLogger().info("Slots config requested - running draw check for all states")
        # Run draw check for ALL states when config is loaded so draws run even if ticker is delayed or not running
        await run_slots_draws_due()
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        current_state = _normalize_state(raw) if raw else (STATES[0] if STATES else "")
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
        next_draw_at = (doc.get("next_draw_at") or doc.get("expires_at")) if doc else None
        if not next_draw_at:
            next_draw_at = _next_draw_utc().isoformat()
        return {
            "max_bet": max_bet,
            "house_edge": SLOTS_HOUSE_EDGE,
            "symbols": list(SLOTS_SYMBOLS),
            "current_state": current_state,
            "states": list(STATES or []),
            "state_owned": state_owned,
            "owner_id": owner_id,
            "expires_at": expires_at,
            "next_draw_at": next_draw_at,
            "ownership_hours": SLOTS_OWNERSHIP_HOURS,
            "draw_interval_minutes": 180,  # 3h on the hour (for UI label; draws at 00:00, 03:00, ..., 21:00 UTC)
        }

    @router.get("/casino/slots/ownership")
    async def casino_slots_ownership(current_user: dict = Depends(get_current_user_verified)):
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
        is_owner = is_valid_owner and owner_id == current_user.get("id") or ""
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
        if can_enter and await _active_slots_ownership_elsewhere(str(current_user.get("id") or ""), state):
            can_enter = False
        entries_doc = await db.slots_entries.find_one({"state": stored_state or state}, {"_id": 0, "user_ids": 1})
        entry_user_ids = (entries_doc or {}).get("user_ids") or []
        entries_count = len(entry_user_ids)
        has_entered = (current_user.get("id") or "") in entry_user_ids
        next_draw_at = (doc.get("next_draw_at") or doc.get("expires_at")) if doc else None
        if not next_draw_at:
            next_draw_at = _next_draw_utc().isoformat()
        return {
            "state": stored_state or state,
            "owner_id": owner_id if is_valid_owner else None,
            "owner_username": doc.get("owner_username") if is_valid_owner else None,
            "is_owner": is_owner,
            "max_bet": max_bet,
            "buy_back_reward": buy_back_reward,
            "expires_at": expires_at,
            "next_draw_at": next_draw_at,
            "can_enter": can_enter,
            "has_entered": has_entered,
            "entries_count": entries_count,
            "profit": _ownership_display_profit(doc) if is_owner and doc else None,
        }

    @router.post("/casino/slots/enter")
    async def casino_slots_enter(request: SlotsEnterRequest, current_user: dict = Depends(get_current_user_verified)):
        """Enter the lottery to possibly own slots in this state for 3 hours. One random entrant wins when current ownership ends."""
        _invalidate_slots_ownership_cache(current_user.get("id") or "")
        state = _normalize_state((request.state or "").strip())
        if not state or state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        await _run_slots_draw_if_needed(state)
        stored_state, doc = await _get_slots_ownership_doc(state)
        if doc and doc.get("owner_id") == current_user.get("id") and not _is_slots_ownership_expired(doc):
            raise HTTPException(status_code=400, detail="You already own the slots here")
        if await _active_slots_ownership_elsewhere(str(current_user.get("id") or ""), state):
            raise HTTPException(
                status_code=400,
                detail="You already hold slots in another state; only one slots holding at a time",
            )
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
            {"$addToSet": {"user_ids": current_user.get("id") or ""}},
            upsert=True,
        )
        return {"message": "You have entered the draw. A random winner is chosen when the current owner's 3 hours end."}

    @router.post("/casino/slots/relinquish")
    async def casino_slots_relinquish(request: SlotsEnterRequest, current_user: dict = Depends(get_current_user_verified)):
        """Give up ownership early. You will be on cooldown and cannot enter the next draw."""
        _invalidate_slots_ownership_cache(current_user.get("id") or "")
        state = _normalize_state((request.state or "").strip())
        if not state or state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        stored_state, doc = await _get_slots_ownership_doc(state)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own the slots here")
        assert_casino_clear_of_buy_back_for_relinquish(doc)
        cooldown_until = (datetime.now(timezone.utc) + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$set": {"slots_cooldown_until": cooldown_until}})
        loc = stored_state or state
        await refund_and_delete_buy_back_offers_matching(
            "slots_buy_back_offers",
            {"state": loc},
            points_event_type="casino_slots",
            meta_base={"state": loc, "reason": "relinquish_table"},
        )
        held = int((doc or {}).get("buy_back_points_held") or 0)
        await refund_casino_buy_back_escrow_points(
            current_user.get("id") or "",
            held,
            event_type="casino_slots",
            meta={"state": loc, "reason": "relinquish"},
        )
        await db.slots_ownership.update_one(
            {"state": loc},
            {
                "$set": {
                    "owner_id": None,
                    "owner_username": None,
                    "max_bet": CASINO_MIN_OWNER_MAX_BET,
                    "buy_back_reward": 0,
                    "buy_back_points_held": 0,
                }
            },
        )
        return {"message": "You have relinquished the slots. You cannot enter the next draw for 3 hours."}

    @router.post("/casino/slots/reset-profit")
    async def casino_slots_reset_profit(request: SlotsEnterRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reset profit counter to zero (owner only)."""
        _invalidate_slots_ownership_cache(current_user.get("id") or "")
        state = _normalize_state((request.state or "").strip())
        if not state or state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        stored_state, doc = await _get_slots_ownership_doc(state)
        if not doc or doc.get("owner_id") != current_user.get("id") or "" or _is_slots_ownership_expired(doc):
            raise HTTPException(status_code=403, detail="You do not own the slots here")
        await db.slots_ownership.update_one({"state": stored_state or state}, {"$set": {"profit": 0}})
        return {"message": "Profit reset to zero."}

    @router.post("/casino/slots/set-max-bet")
    async def casino_slots_set_max_bet(request: SlotsSetMaxBetRequest, current_user: dict = Depends(get_current_user_verified)):
        """Set max bet for your slots (owner only)."""
        _invalidate_slots_ownership_cache(current_user.get("id") or "")
        state = _normalize_state((request.state or "").strip())
        if not state or state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        stored_state, doc = await _get_slots_ownership_doc(state)
        if not doc or doc.get("owner_id") != current_user.get("id") or "" or _is_slots_ownership_expired(doc):
            raise HTTPException(status_code=403, detail="You do not own the slots here")
        global_cap, _ = await get_casino_caps()
        new_max = max(50_000, min(int(request.max_bet), global_cap))
        await db.slots_ownership.update_one({"state": stored_state or state}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/slots/set-buy-back-reward")
    async def casino_slots_set_buy_back_reward(request: SlotsSetBuyBackRequest, current_user: dict = Depends(get_current_user_verified)):
        """Set buy-back reward (points) when you cannot pay a win (owner only)."""
        _invalidate_slots_ownership_cache(current_user.get("id") or "")
        state = _normalize_state((request.state or "").strip())
        if not state or state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        stored_state, doc = await _get_slots_ownership_doc(state)
        if not doc or doc.get("owner_id") != current_user.get("id") or "" or _is_slots_ownership_expired(doc):
            raise HTTPException(status_code=403, detail="You do not own the slots here")
        _, buyback_cap = await get_casino_caps()
        amount = max(0, min(int(request.amount), buyback_cap))
        old_held = int((doc or {}).get("buy_back_points_held") or 0)
        await adjust_casino_buy_back_escrow(
            current_user["id"],
            old_held,
            amount,
            event_type="casino_slots",
            meta={"state": stored_state or state},
        )
        await db.slots_ownership.update_one(
            {"state": stored_state or state},
            {"$set": {"buy_back_reward": amount, "buy_back_points_held": amount}},
        )
        return {"message": "Buy-back reward updated."}

    @router.post("/casino/slots/buy-back/accept")
    async def casino_slots_buy_back_accept(request: SlotsBuyBackAcceptRequest, current_user: dict = Depends(get_current_user_verified)):
        """Accept buy-back: receive points and return ownership to previous owner."""
        offer = await db.slots_buy_back_offers.find_one_and_delete({"id": request.offer_id}, projection={"_id": 0})
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found or already claimed")
        if offer.get("to_user_id") != current_user.get("id") or "":
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
        if not from_user:
            raise HTTPException(status_code=400, detail="Previous owner not found")
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"points": points_offered}})
        await log_casino_buyback_credit_points(
            current_user.get("id") or "",
            points_offered,
            "casino_slots",
            request.offer_id,
            {"state": state},
        )
        stored_state, _ = await _get_slots_ownership_doc(state)
        next_draw_iso = _next_draw_utc().isoformat()
        await db.slots_ownership.update_one(
            {"state": stored_state or state},
            {
                "$set": {
                    "owner_id": from_owner_id,
                    "owner_username": from_user.get("username"),
                    "expires_at": next_draw_iso,
                    "next_draw_at": next_draw_iso,
                    "max_bet": 0,
                    "buy_back_reward": 0,
                    "buy_back_points_held": 0,
                },
                "$unset": {"below_capo_acquired_at": ""},
            },
        )
        _invalidate_slots_ownership_cache(current_user.get("id") or "")
        _invalidate_slots_ownership_cache(from_owner_id)
        await resolve_gambling_log_buy_back(request.offer_id, "accepted", points_offered)
        return {"message": "Accepted. You received the points and the slots were returned to the previous owner."}

    @router.post("/casino/slots/buy-back/reject")
    async def casino_slots_buy_back_reject(request: SlotsBuyBackRejectRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reject buy-back: keep ownership."""
        offer = await db.slots_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1, "from_owner_id": 1, "points_offered": 1, "state": 1})
        if not offer or offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.slots_buy_back_offers.delete_one({"id": request.offer_id})
        await refund_casino_buy_back_escrow_points(
            str(offer.get("from_owner_id") or ""),
            int(offer.get("points_offered") or 0),
            event_type="casino_slots",
            meta={"state": offer.get("state"), "offer_id": request.offer_id, "reason": "reject"},
        )
        _invalidate_slots_ownership_cache(current_user.get("id") or "")
        await resolve_gambling_log_buy_back(request.offer_id, "rejected", 0)
        await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "casino_buyback_reject")
        return {"message": "Rejected. You keep the slots."}

    @router.post("/casino/slots/spin")
    async def casino_slots_spin(request: SlotsSpinRequest, current_user: dict = Depends(get_current_user_verified)):
        """Spin the slots. State-owned = house pays. Owner-owned = owner pays wins (or loses ownership if can't pay; buy-back offer)."""
        _invalidate_slots_ownership_cache(current_user.get("id") or "")
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
        if is_valid_owner and owner_id == current_user.get("id"):
            raise HTTPException(status_code=400, detail="You cannot play at your own slots")
        bet = int(request.bet or 0)
        if bet < 1:
            raise HTTPException(status_code=400, detail="Bet must be at least 1")
        if bet > max_bet:
            raise HTTPException(status_code=400, detail=f"Max bet is ${max_bet:,}")
        debit_res = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": bet}},
            {"$inc": {"money": -bet}},
            return_document=False,
        )
        if not debit_res:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        user_money = int((debit_res.get("money") or 0) or 0)

        reels = _slots_spin()
        payout_full = _slots_payout(reels, bet)
        win = payout_full > 0

        if not is_valid_owner:
            # State-owned: house pays; house edge to state head (like dice)
            head_family_id = await get_head_family_id_for_state(stored_state or state) if (stored_state or state) else None
            if win:
                gross = bet * (a["mult_3"] if (a := next((s for s in SLOTS_SYMBOLS if s["id"] == reels[0]["id"]), {})) else 3)
                house_cut = state_head_casino_treasury_share(int(gross * SLOTS_HOUSE_EDGE)) if head_family_id else 0
                if house_cut > 0:
                    await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": house_cut, "state_head_income.slots": house_cut}})
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout_full}})
            else:
                if head_family_id:
                    edge_lose = state_head_casino_treasury_share(int(bet * SLOTS_HOUSE_EDGE))
                    if edge_lose > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.slots": edge_lose}})
            new_money = (user_money - bet) + (payout_full if win else 0)
            history_entry = {
                "bet": bet,
                "reels": [r["id"] for r in reels],
                "reel_names": [r["name"] for r in reels],
                "payout": payout_full,
                "won": win,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.users.update_one(
                {"id": current_user.get("id") or ""},
                {"$push": {"slots_history": {"$each": [history_entry], "$position": 0, "$slice": SLOTS_HISTORY_MAX}}},
            )
            await log_gambling(
                current_user.get("id") or "",
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

        # Owner-owned (bet already debited above)
        head_family_id = await get_head_family_id_for_state(stored_state or state) if (stored_state or state) else None
        if not win:
            if head_family_id:
                edge_lose_full = int(bet * SLOTS_HOUSE_EDGE)
                edge_lose = state_head_casino_treasury_share(edge_lose_full)
                if edge_lose > 0:
                    await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.slots": edge_lose}})
                owner_take = max(0, bet - edge_lose_full)
                if owner_take > 0:
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_take}})
                await db.slots_ownership.update_one(
                    {"state": stored_state or state}, {"$inc": {"profit": owner_take, "total_earnings": owner_take}}
                )
                _invalidate_slots_ownership_cache(owner_id)
            else:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
                await db.slots_ownership.update_one(
                    {"state": stored_state or state}, {"$inc": {"profit": bet, "total_earnings": bet}}
                )
                _invalidate_slots_ownership_cache(owner_id)
            await log_gambling(
                current_user.get("id") or "",
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
                {"id": current_user.get("id") or ""},
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

        # Player won: credit bet to owner first, then owner pays payout
        await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
        owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1, "username": 1})
        owner_money = int(((owner or {}).get("money") or 0) or 0)
        owner_username = (owner or {}).get("username")
        actual_payout = min(payout_full, owner_money)
        shortfall = payout_full - actual_payout
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": actual_payout}})
        await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_payout, "total_casino_payouts": actual_payout}})
        # Track biggest payout for owner
        await bump_user_biggest_casino_payout(owner_id, actual_payout)
        ownership_transferred = False
        buy_back_offer = None
        points_offered = int((doc or {}).get("buy_back_reward") or 0)

        if shortfall > 0:
            next_draw_iso = _next_draw_utc().isoformat()
            spin_winner_rank_id, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
            spin_owner_set = {
                "owner_id": current_user.get("id") or "",
                "owner_username": current_user.get("username"),
                "expires_at": next_draw_iso,
                "next_draw_at": next_draw_iso,
                "buy_back_reward": 0,
                "buy_back_points_held": 0,
            }
            spin_owner_update = casino_ownership_write_below_capo_ops(spin_owner_set, new_owner_rank_id=spin_winner_rank_id)
            if points_offered <= 0:
                edge_lose_full = int(bet * SLOTS_HOUSE_EDGE) if head_family_id else 0
                if head_family_id:
                    edge_lose_tr = state_head_casino_treasury_share(edge_lose_full)
                    if edge_lose_tr > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose_tr, "state_head_income.slots": edge_lose_tr}})
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": -edge_lose_full}})
                else:
                    d1 = bet - actual_payout
                    await db.slots_ownership.update_one(
                        {"state": stored_state or state}, {"$inc": {"profit": d1, "total_earnings": d1}}
                    )
                # Profit should match owner's net after state-head tax (same delta for lifetime total_earnings)
                eadj = -edge_lose_full
                if eadj != 0:
                    await db.slots_ownership.update_one(
                        {"state": stored_state or state},
                        {"$inc": {"profit": eadj, "total_earnings": eadj}},
                    )
                _invalidate_slots_ownership_cache(owner_id)
                # End owner's 3h: clear ownership and set cooldown
                cooldown_until = (datetime.now(timezone.utc) + timedelta(hours=SLOTS_OWNERSHIP_HOURS)).isoformat()
                await db.users.update_one({"id": owner_id}, {"$set": {"slots_cooldown_until": cooldown_until}})
                await db.slots_ownership.update_one(
                    {"state": stored_state or state},
                    spin_owner_update,
                )
                ownership_transferred = True
                # Track casino won/lost stats
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"casinos_seized": 1}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"casinos_lost": 1}})
            else:
                ownership_transferred = True
                await db.slots_ownership.update_one(
                    {"state": stored_state or state},
                    spin_owner_update,
                )
                # Track casino won/lost stats
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"casinos_seized": 1}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"casinos_lost": 1}})
                offer_id = str(uuid.uuid4())
                expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                buy_back_doc = {
                    "id": offer_id,
                    "state": stored_state or state,
                    "from_owner_id": owner_id,
                    "from_owner_username": owner_username,
                    "to_user_id": current_user.get("id") or "",
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
            await notify_casino_seizure(
                former_owner_id=owner_id,
                former_owner_username=owner_username,
                winner_user_id=current_user.get("id") or "",
                winner_username=current_user.get("username") or "?",
                venue_label="slots",
                location_label=stored_state or state,
                full_payout_to_winner=payout_full,
                actual_payout_to_winner=actual_payout,
                shortfall=shortfall,
                buy_back_points=points_offered,
            )
        else:
            edge = int(bet * SLOTS_HOUSE_EDGE)
            head_tc = state_head_casino_treasury_share(edge)
            if head_family_id and head_tc > 0:
                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": head_tc, "state_head_income.slots": head_tc}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -edge}})
            d = (bet - actual_payout) - (edge if head_family_id else 0)
            await db.slots_ownership.update_one(
                {"state": stored_state or state},
                {"$inc": {"profit": d, "total_earnings": d}},
            )
            _invalidate_slots_ownership_cache(owner_id)

        if ownership_transferred:
            await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "received_casino_transfer")

        history_entry = {
            "bet": bet,
            "reels": [r["id"] for r in reels],
            "reel_names": [r["name"] for r in reels],
            "payout": payout_full,
            "won": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$push": {"slots_history": {"$each": [history_entry], "$position": 0, "$slice": SLOTS_HISTORY_MAX}}},
        )
        slots_details = {
            "state": state,
            "bet": bet,
            "reels": [r["id"] for r in reels],
            "payout": payout_full,
            "actual_payout": actual_payout,
            "shortfall": shortfall,
            "ownership_transferred": ownership_transferred,
        }
        if ownership_transferred:
            if buy_back_offer and buy_back_offer.get("offer_id"):
                slots_details["buy_back_offer_id"] = buy_back_offer["offer_id"]
                slots_details["buy_back_points_offered"] = points_offered
                slots_details["buy_back_outcome"] = "pending"
            else:
                slots_details["buy_back_points_offered"] = 0
                slots_details["buy_back_outcome"] = "not_offered"
        await log_gambling(
            current_user.get("id") or "",
            current_user.get("username") or "?",
            "slots",
            slots_details,
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
    async def casino_slots_history(current_user: dict = Depends(get_current_user_verified)):
        user = await db.users.find_one({"id": current_user.get("id") or ""}, {"_id": 0, "slots_history": 1})
        history = (user.get("slots_history") or [])[:SLOTS_HISTORY_MAX]
        return {"history": list(reversed(history))}
