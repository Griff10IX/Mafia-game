# Twice-weekly lottery (Wed & Sun 00:00 UTC): $500k/ticket, 10% of gross pot removed at draw, 90% net to winner(s).
# Each draw publishes six winning numbers. Exact-match lines split the net pot; if nobody matches the ball draw,
# a random eligible player ticket may be chosen as winner (see LOTTERY_NO_RANDOM_FALLBACK). Admin can force-draw.
# Jackpot inbox uses send_notification(..., category=None) so wins are not muted via notification_preferences.
from __future__ import annotations

import logging
import os
import random
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, field_validator

from server import db, get_current_user, log_activity, send_notification, _is_moderator, user_has_admin_list_email

logger = logging.getLogger(__name__)

TICKET_PRICE = 500_000
POT_TAX_PERCENT = 10
_DRAW_WEEKDAYS = (2, 6)  # Wed, Sun — 00:00 UTC
_LOTTERY_PICK_COUNT = 6
_LOTTERY_NUMBER_MAX = 50
_lottery_rng = random.SystemRandom()
_MAX_WINNER_TICKETS = 100_000


def _lottery_random_fallback_disabled() -> bool:
    """When True, cron uses pure rollover if nobody matches the random ball draw (testing / legacy)."""
    v = (os.environ.get("LOTTERY_NO_RANDOM_FALLBACK") or "").strip().lower()
    return v in ("1", "true", "yes")


def _random_lottery_numbers() -> list[int]:
    """Six distinct numbers 1..50, sorted — same rules for ticket lines and the official draw."""
    return sorted(_lottery_rng.sample(range(1, _LOTTERY_NUMBER_MAX + 1), _LOTTERY_PICK_COUNT))


def _normalize_ticket_numbers(raw: Any) -> Optional[list[int]]:
    """Return sorted valid line or None if ticket cannot participate in exact-match."""
    if raw is None or not isinstance(raw, list):
        return None
    if len(raw) != _LOTTERY_PICK_COUNT:
        return None
    try:
        nums = sorted(int(x) for x in raw)
    except (TypeError, ValueError):
        return None
    if len(set(nums)) != _LOTTERY_PICK_COUNT:
        return None
    if any(n < 1 or n > _LOTTERY_NUMBER_MAX for n in nums):
        return None
    return nums


def _format_numbers_line(nums: list[int]) -> str:
    return ", ".join(str(n) for n in nums)


def _normalize_lottery_user_id(raw: Any) -> Optional[str]:
    """Match `users.id` string form; skip missing/invalid ticket owner ids."""
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def recompute_winner_payouts_from_round(round_doc: dict, tickets: list) -> dict[str, Any]:
    """
    Recompute exact-match winner shares from a closed round document + ticket rows.
    Same split rules as lottery_draw_cron (for admin audit / disputes).
    """
    if (round_doc.get("status") or "") != "closed":
        return {
            "status": "not_closed",
            "match_ticket_count": 0,
            "recomputed_payouts": [],
            "recomputed_total": 0,
            "expected_payout_pool": int(round_doc.get("payout") or 0),
            "payout_split_ok": True,
        }
    wn_raw = round_doc.get("winning_numbers")
    if not wn_raw or not isinstance(wn_raw, list):
        return {
            "status": "no_winning_numbers",
            "match_ticket_count": 0,
            "recomputed_payouts": [],
            "recomputed_total": 0,
            "expected_payout_pool": int(round_doc.get("payout") or 0),
            "payout_split_ok": False,
        }
    try:
        wn = sorted(int(x) for x in wn_raw)
    except (TypeError, ValueError):
        return {
            "status": "bad_winning_numbers",
            "match_ticket_count": 0,
            "recomputed_payouts": [],
            "recomputed_total": 0,
            "expected_payout_pool": int(round_doc.get("payout") or 0),
            "payout_split_ok": False,
        }

    payout = int(round_doc.get("payout") or 0)
    matches: list = []
    for t in tickets:
        norm = _normalize_ticket_numbers(t.get("numbers"))
        if norm is not None and norm == wn:
            matches.append(t)

    amounts_by_user: dict[str, int] = defaultdict(int)
    names_by_user: dict[str, str] = {}
    mcount = len(matches)
    if mcount > 0 and payout > 0:
        share = payout // mcount
        rem = payout % mcount
        for i, t in enumerate(matches):
            amt = share + (1 if i < rem else 0)
            uid = str(t.get("user_id") or "")
            amounts_by_user[uid] += amt
            names_by_user[uid] = (t.get("username") or "?").strip()

    rows = [
        {"user_id": uid, "username": names_by_user.get(uid, "?"), "amount": amt}
        for uid, amt in sorted(amounts_by_user.items(), key=lambda x: (-x[1], x[0]))
    ]
    total = sum(amounts_by_user.values())
    if mcount > 0:
        split_ok = total == payout
    else:
        split_ok = total == 0
    return {
        "status": "ok",
        "match_ticket_count": mcount,
        "distinct_winners": len(amounts_by_user),
        "recomputed_payouts": rows,
        "recomputed_total": total,
        "expected_payout_pool": payout,
        "payout_split_ok": split_ok,
    }


def _next_draw_utc(after: datetime) -> datetime:
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    after = after.astimezone(timezone.utc)
    for add in range(0, 15):
        d = (after + timedelta(days=add)).date()
        for wd in _DRAW_WEEKDAYS:
            if d.weekday() != wd:
                continue
            candidate = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=timezone.utc)
            if candidate > after:
                return candidate
    return after + timedelta(days=3)


async def _ensure_open_round() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    open_rounds = await db.lottery_rounds.find(
        {"status": "open"},
        {"_id": 1, "closes_at": 1, "status": 1, "created_at": 1, "rollover_in": 1},
    ).to_list(500)
    future_rounds: list[tuple[int, datetime, dict[str, Any]]] = []
    for r in open_rounds:
        closes_at = _parse_iso(r.get("closes_at"))
        if closes_at and closes_at > now:
            rollover_in = int(r.get("rollover_in") or 0)
            future_rounds.append((rollover_in, closes_at, r))
    if future_rounds:
        # If duplicate open rounds exist, prefer the round carrying rollover.
        # Tie-break on earliest close time so buys still target the next due draw.
        future_rounds.sort(key=lambda x: (-x[0], x[1]))
        return future_rounds[0][2]
    closes = _next_draw_utc(now)
    doc = {"closes_at": closes.isoformat(), "status": "open", "created_at": now.isoformat(), "rollover_in": 0}
    ins = await db.lottery_rounds.insert_one(doc)
    doc["_id"] = ins.inserted_id
    return doc


class LotteryBuyBody(BaseModel):
    count: int = 1

    @field_validator("count")
    @classmethod
    def count_ok(cls, v: int) -> int:
        if v is None or v < 1 or v > 500:
            raise ValueError("count must be 1–500")
        return v


def _cron_verify():
    secret = (os.environ.get("CRON_SECRET") or "").strip()

    async def verify(x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret")):
        if not secret:
            raise HTTPException(status_code=503, detail="Cron not configured (CRON_SECRET unset)")
        if (x_cron_secret or "").strip() != secret:
            raise HTTPException(status_code=403, detail="Invalid cron secret")
        return True

    return verify


def _parse_iso(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


async def get_lottery_state(current_user: dict = Depends(get_current_user)):
    rd = await _ensure_open_round()
    rid = rd["_id"]
    now = datetime.now(timezone.utc)
    closes_at = _parse_iso(rd["closes_at"]) or now
    total = await db.lottery_tickets.count_documents({"round_id": rid})
    mine = await db.lottery_tickets.count_documents({"round_id": rid, "user_id": current_user["id"]})
    rollover_in = int(rd.get("rollover_in") or 0)
    gross = total * TICKET_PRICE + rollover_in
    closed_projection = {
        "_id": 0,
        "drawn_at": 1,
        "gross_pot": 1,
        "payout": 1,
        "sink_amount": 1,
        "ticket_count": 1,
        "winner_username": 1,
        "winner_user_id": 1,
        "winning_numbers": 1,
        "draw_fallback": 1,
        "exact_match_count": 1,
        "rollover_to_next": 1,
    }
    recent_draws = await (
        db.lottery_rounds.find({"status": "closed"}, closed_projection)
        .sort("drawn_at", -1)
        .limit(5)
        .to_list(5)
    )
    last = recent_draws[0] if recent_draws else None
    recent_winners = await (
        db.lottery_rounds.find(
            {
                "status": "closed",
                "$or": [
                    {"exact_match_count": {"$gt": 0}},
                    {"winner_payouts.0": {"$exists": True}},
                    {
                        "$and": [
                            {"winner_username": {"$nin": [None, ""]}},
                            {"exact_match_count": {"$nin": [0]}},
                        ]
                    },
                ],
            },
            closed_projection,
        )
        .sort("drawn_at", -1)
        .limit(10)
        .to_list(10)
    )
    return {
        "round_id": str(rid),
        "closes_at": rd["closes_at"],
        "seconds_until_close": max(0.0, (closes_at - now).total_seconds()),
        "ticket_price": TICKET_PRICE,
        "pot_tax_percent": POT_TAX_PERCENT,
        "ticket_count": total,
        "gross_pot": gross,
        "rollover_in": rollover_in,
        "my_tickets": mine,
        "last_draw": last,
        "recent_draws": recent_draws,
        "recent_winners": recent_winners,
    }


async def buy_lottery_tickets(body: LotteryBuyBody, current_user: dict = Depends(get_current_user)):
    rd = await _ensure_open_round()
    rid = rd["_id"]
    now = datetime.now(timezone.utc)
    closes_at = _parse_iso(rd.get("closes_at"))
    if closes_at and now >= closes_at:
        raise HTTPException(status_code=400, detail="This round just closed — wait for the next round.")
    count = int(body.count)
    total_cost = TICKET_PRICE * count
    uid = current_user["id"]
    uname = (current_user.get("username") or "?").strip()
    result = await db.users.update_one(
        {"id": uid, "money": {"$gte": total_cost}},
        {"$inc": {"money": -total_cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    now_iso = now.isoformat()
    docs = [
        {
            "round_id": rid,
            "user_id": uid,
            "username": uname,
            "created_at": now_iso,
            "ticket_id": str(uuid.uuid4()),
            "numbers": _random_lottery_numbers(),
        }
        for _ in range(count)
    ]
    if docs:
        await db.lottery_tickets.insert_many(docs)
    await log_activity(uid, uname, "lottery_buy", {"round_id": str(rid), "count": count, "spent": total_cost})
    try:
        await db.economy_events.insert_one(
            {
                "at": now_iso,
                "type": "lottery_buy",
                "user_id": uid,
                "username": uname,
                "round_id": str(rid),
                "count": count,
                "spent": total_cost,
            }
        )
    except Exception as e:
        logger.warning("economy_events lottery_buy: %s", e)
    return {"message": f"Bought {count} ticket(s) for ${total_cost:,}.", "spent": total_cost, "count": count, "round_id": str(rid)}


async def get_my_lottery_tickets(current_user: dict = Depends(get_current_user)):
    """Return the current user's tickets for the open round (numbers + purchase time)."""
    rd = await _ensure_open_round()
    rid = rd["_id"]
    uid = current_user["id"]
    cursor = db.lottery_tickets.find(
        {"round_id": rid, "user_id": uid},
        {"_id": 0, "created_at": 1, "numbers": 1, "ticket_id": 1},
    ).sort("created_at", -1).limit(500)
    docs = await cursor.to_list(500)
    tickets = []
    for d in docs:
        nums = d.get("numbers")
        if nums is not None and not isinstance(nums, list):
            nums = None
        tickets.append(
            {
                "ticket_id": (d.get("ticket_id") or "").strip(),
                "purchased_at": d.get("created_at") or "",
                "numbers": nums,
            }
        )
    return {"round_id": str(rid), "total": len(tickets), "tickets": tickets}


async def _blocked_staff_ids_from_user_ids(user_ids: list[str]) -> set[str]:
    blocked: set[str] = set()
    if not user_ids:
        return blocked
    staff_rows = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "email": 1, "is_moderator": 1},
    ).to_list(len(user_ids))
    for u in staff_rows:
        uid = _normalize_lottery_user_id(u.get("id"))
        if uid and (_is_moderator(u) or user_has_admin_list_email(u)):
            blocked.add(uid)
    return blocked


async def _eligible_player_tickets_for_round(rid: Any) -> list[dict]:
    """Tickets whose owners are not staff/mod/admin-email and have valid number lines."""
    cursor = db.lottery_tickets.find(
        {"round_id": rid},
        {"_id": 0, "user_id": 1, "username": 1, "numbers": 1},
    )
    all_rows = await cursor.to_list(500_000)
    uids = sorted({u for u in (_normalize_lottery_user_id(t.get("user_id")) for t in all_rows) if u})
    blocked = await _blocked_staff_ids_from_user_ids(uids)
    out: list[dict] = []
    for t in all_rows:
        uid = _normalize_lottery_user_id(t.get("user_id"))
        if uid and uid not in blocked and _normalize_ticket_numbers(t.get("numbers")):
            out.append(t)
    return out


async def _apply_winning_numbers_and_pay(
    rid: Any,
    winning_numbers: list[int],
    payout: int,
    gross: int,
) -> tuple[dict[str, int], dict[str, str], int, list[dict[str, Any]], set[str]]:
    """Compute exact-match payouts for winning_numbers; credit wallets."""
    amounts_by_user: dict[str, int] = defaultdict(int)
    names_by_user: dict[str, str] = {}
    payout_errors: list[dict[str, Any]] = []
    paid_user_ids: set[str] = set()

    raw_winning = await db.lottery_tickets.find(
        {"round_id": rid, "numbers": winning_numbers},
        {"_id": 0, "user_id": 1, "username": 1, "numbers": 1},
    ).to_list(_MAX_WINNER_TICKETS + 1)
    if len(raw_winning) > _MAX_WINNER_TICKETS:
        logger.warning(
            "lottery draw: exact-match ticket count exceeds cap (%s > %s) round_id=%s; capping payouts to cap",
            len(raw_winning),
            _MAX_WINNER_TICKETS,
            rid,
        )
        raw_winning = raw_winning[:_MAX_WINNER_TICKETS]

    ticket_user_ids = sorted(
        {uid for uid in (_normalize_lottery_user_id(t.get("user_id")) for t in raw_winning) if uid}
    )
    blocked_winner_ids = await _blocked_staff_ids_from_user_ids(ticket_user_ids)

    matches: list = []
    if gross > 0 and payout > 0:
        for t in raw_winning:
            norm = _normalize_ticket_numbers(t.get("numbers"))
            owner_id = _normalize_lottery_user_id(t.get("user_id"))
            if norm is not None and norm == winning_numbers and owner_id not in blocked_winner_ids:
                matches.append(t)

    exact_match_count = len(matches)

    if gross > 0 and payout > 0 and matches:
        valid_matches: list[tuple[dict, str]] = []
        for t in matches:
            uid = _normalize_lottery_user_id(t.get("user_id"))
            if uid:
                valid_matches.append((t, uid))
            else:
                logger.warning(
                    "lottery draw: winning ticket missing user_id round_id=%s numbers=%s",
                    rid,
                    t.get("numbers"),
                )
        if len(valid_matches) < len(matches):
            logger.error(
                "lottery draw: %s of %s winning tickets lack user_id (round_id=%s)",
                len(matches) - len(valid_matches),
                len(matches),
                rid,
            )

        if valid_matches:
            mcount = len(valid_matches)
            share = payout // mcount
            rem = payout % mcount
            for i, (t, uid) in enumerate(valid_matches):
                amt = share + (1 if i < rem else 0)
                amounts_by_user[uid] += amt
                names_by_user[uid] = (t.get("username") or "?").strip()

            for uid, amt in list(amounts_by_user.items()):
                if amt <= 0:
                    continue
                pay_res = await db.users.update_one({"id": uid}, {"$inc": {"money": amt}})
                if pay_res.modified_count != 1:
                    payout_errors.append(
                        {
                            "user_id": uid,
                            "amount": int(amt),
                            "detail": "user_update_modified_count=%s" % (pay_res.modified_count,),
                        }
                    )
                    logger.error(
                        "lottery payout failed round_id=%s user_id=%s amount=%s modified_count=%s",
                        rid,
                        uid,
                        amt,
                        pay_res.modified_count,
                    )
                else:
                    paid_user_ids.add(uid)

            if valid_matches and payout > 0 and not paid_user_ids:
                logger.critical(
                    "lottery draw: all winner payouts failed round_id=%s payout_pool=%s errors=%s",
                    rid,
                    payout,
                    payout_errors,
                )
            unpaid = sum(int(amounts_by_user[u]) for u in amounts_by_user if u not in paid_user_ids)
            if unpaid > 0:
                logger.error(
                    "lottery draw: unpaid winner share remains round_id=%s unpaid_total=%s paid_users=%s",
                    rid,
                    unpaid,
                    len(paid_user_ids),
                )

    return amounts_by_user, names_by_user, exact_match_count, payout_errors, paid_user_ids


async def _settle_one_round(rid: Any, rd: dict[str, Any], *, settle_mode: str) -> dict[str, Any]:
    """
    Close one round (caller must have transitioned status to drawing). Inserts next open round.
    settle_mode: cron | admin_standard | admin_random_ticket
    """
    if settle_mode not in ("cron", "admin_standard", "admin_random_ticket"):
        raise ValueError("invalid settle_mode")

    n = await db.lottery_tickets.count_documents({"round_id": rid})
    rollover_start = int(rd.get("rollover_in") or 0)
    ticket_revenue = n * TICKET_PRICE
    gross = ticket_revenue + rollover_start
    sink = (gross * POT_TAX_PERCENT) // 100 if gross > 0 else 0
    payout = gross - sink
    drawn_iso = datetime.now(timezone.utc).isoformat()

    draw_fallback = False
    fallback_reason: Optional[str] = None
    winning_numbers: list[int]

    if settle_mode == "admin_random_ticket":
        eligible = await _eligible_player_tickets_for_round(rid)
        if not eligible:
            winning_numbers = _random_lottery_numbers()
        else:
            pick = _lottery_rng.choice(eligible)
            wn = _normalize_ticket_numbers(pick.get("numbers"))
            if wn:
                winning_numbers = wn
                draw_fallback = True
                fallback_reason = "admin_random_ticket"
            else:
                winning_numbers = _random_lottery_numbers()
    elif settle_mode == "admin_standard":
        winning_numbers = _random_lottery_numbers()
    else:
        winning_numbers = _random_lottery_numbers()

    amounts_by_user: dict[str, int]
    names_by_user: dict[str, str]
    exact_match_count: int
    payout_errors: list[dict[str, Any]]
    paid_user_ids: set[str]

    amounts_by_user, names_by_user, exact_match_count, payout_errors, paid_user_ids = await _apply_winning_numbers_and_pay(
        rid, winning_numbers, payout, gross
    )

    if (
        settle_mode == "cron"
        and payout > 0
        and gross > 0
        and not paid_user_ids
        and not _lottery_random_fallback_disabled()
    ):
        eligible = await _eligible_player_tickets_for_round(rid)
        if eligible:
            pick = _lottery_rng.choice(eligible)
            wn = _normalize_ticket_numbers(pick.get("numbers"))
            if wn:
                winning_numbers = wn
                draw_fallback = True
                fallback_reason = "cron_random_ticket"
                amounts_by_user, names_by_user, exact_match_count, payout_errors, paid_user_ids = await _apply_winning_numbers_and_pay(
                    rid, winning_numbers, payout, gross
                )

    if payout > 0:
        if not amounts_by_user:
            rollover_next = payout
        elif not paid_user_ids and amounts_by_user:
            rollover_next = payout
        else:
            rollover_next = 0
    else:
        rollover_next = 0

    nums_txt = _format_numbers_line(winning_numbers)
    display_winner_user_id = None
    display_winner_username = None
    if amounts_by_user:
        if len(amounts_by_user) == 1:
            only = next(iter(amounts_by_user))
            display_winner_user_id = only
            display_winner_username = names_by_user.get(only, "?")
        else:
            display_winner_username = ", ".join(sorted(names_by_user[u] for u in amounts_by_user))

    winner_payouts = (
        [
            {"user_id": uid, "username": names_by_user.get(uid, "?"), "amount": int(amt)}
            for uid, amt in sorted(amounts_by_user.items(), key=lambda x: (-x[1], x[0]))
        ]
        if amounts_by_user
        else []
    )

    round_set = {
        "status": "closed",
        "drawn_at": drawn_iso,
        "ticket_count": n,
        "gross_pot": gross,
        "sink_amount": sink,
        "payout": payout if gross > 0 else 0,
        "winner_user_id": display_winner_user_id,
        "winner_username": display_winner_username,
        "winning_numbers": winning_numbers,
        "draw_fallback": draw_fallback,
        "fallback_reason": fallback_reason,
        "exact_match_count": exact_match_count,
        "rollover_to_next": rollover_next,
        "winner_payouts": winner_payouts,
        "payout_errors": payout_errors,
    }
    await db.lottery_rounds.update_one({"_id": rid}, {"$set": round_set})

    try:
        ev_draw = {
            "at": drawn_iso,
            "type": "lottery_draw",
            "round_id": str(rid),
            "ticket_count": n,
            "gross_pot": gross,
            "sink_amount": sink,
            "payout": payout,
            "winner_user_id": display_winner_user_id,
            "winner_username": display_winner_username,
            "winning_numbers": winning_numbers,
            "draw_fallback": draw_fallback,
            "fallback_reason": fallback_reason,
            "exact_match_count": exact_match_count,
            "rollover_to_next": rollover_next,
            "rollover_in": rollover_start,
            "winners_paid_count": len(paid_user_ids),
        }
        if payout_errors:
            ev_draw["payout_errors"] = payout_errors
        await db.economy_events.insert_one(ev_draw)
    except Exception as e:
        logger.warning("economy_events lottery_draw: %s", e)

    if paid_user_ids:
        win_body_exact = (
            "Winning numbers: {nums}. Your ticket matched! You received ${amt:,} "
            "(share of the net pot). Gross pot ${gross:,} ({n:,} tickets); {tax}% tax removed."
        )
        win_body_fallback = (
            "Winning numbers: {nums}. Your ticket was selected as this round's winner! You received ${amt:,} "
            "(share of the net pot). Gross pot ${gross:,} ({n:,} tickets); {tax}% tax removed."
        )
        for uid in paid_user_ids:
            amt = int(amounts_by_user.get(uid) or 0)
            if amt <= 0:
                continue
            uname = names_by_user.get(uid, "?")
            await log_activity(
                uid,
                uname,
                "lottery_win",
                {
                    "round_id": str(rid),
                    "payout": amt,
                    "gross_pot": gross,
                    "winning_numbers": winning_numbers,
                    "draw_fallback": draw_fallback,
                },
            )
            try:
                tmpl = win_body_fallback if draw_fallback else win_body_exact
                body = tmpl.format(
                    nums=nums_txt,
                    amt=amt,
                    gross=gross,
                    n=n,
                    tax=POT_TAX_PERCENT,
                )
                await send_notification(
                    uid,
                    "Lottery Winner!",
                    body,
                    "system",
                    category=None,
                )
            except Exception as e:
                logger.warning("lottery winner notification: %s", e)
        try:
            await db.lottery_events.insert_one(
                {
                    "type": "lottery_winner",
                    "winner_username": display_winner_username,
                    "winner_user_id": display_winner_user_id,
                    "payout": payout,
                    "gross_pot": gross,
                    "ticket_count": n,
                    "drawn_at": drawn_iso,
                    "winning_numbers": winning_numbers,
                    "draw_fallback": draw_fallback,
                    "fallback_reason": fallback_reason,
                    "exact_match_count": exact_match_count,
                }
            )
        except Exception as e:
            logger.warning("lottery_events insert: %s", e)
    elif rollover_next > 0:
        try:
            await db.lottery_events.insert_one(
                {
                    "type": "lottery_rollover",
                    "rollover_amount": rollover_next,
                    "winning_numbers": winning_numbers,
                    "drawn_at": drawn_iso,
                    "ticket_count": n,
                    "gross_pot": gross,
                }
            )
        except Exception as e:
            logger.warning("lottery_events rollover insert: %s", e)

    now2 = datetime.now(timezone.utc)
    nxt = _next_draw_utc(now2)
    await db.lottery_rounds.insert_one(
        {
            "closes_at": nxt.isoformat(),
            "status": "open",
            "created_at": now2.isoformat(),
            "rollover_in": rollover_next,
        }
    )

    return {
        "round_id": str(rid),
        "settle_mode": settle_mode,
        "winning_numbers": winning_numbers,
        "draw_fallback": draw_fallback,
        "fallback_reason": fallback_reason,
        "payout": payout if gross > 0 else 0,
        "gross_pot": gross,
        "ticket_count": n,
        "winner_user_id": display_winner_user_id,
        "winner_username": display_winner_username,
        "rollover_to_next": rollover_next,
        "paid_user_ids": sorted(paid_user_ids),
    }


async def lottery_draw_cron(_: bool = Depends(_cron_verify())):
    now = datetime.now(timezone.utc)
    processed = 0
    while True:
        open_rounds = await db.lottery_rounds.find(
            {"status": "open"},
            {"_id": 1, "closes_at": 1, "status": 1, "created_at": 1, "rollover_in": 1},
        ).to_list(500)
        due_rounds = []
        for r in open_rounds:
            closes_at = _parse_iso(r.get("closes_at"))
            if closes_at and closes_at <= now:
                due_rounds.append((closes_at, r))
        if due_rounds:
            due_rounds.sort(key=lambda x: x[0])
            rd = due_rounds[0][1]
        else:
            rd = None
        if not rd:
            break
        rid = rd["_id"]
        lock = await db.lottery_rounds.update_one({"_id": rid, "status": "open"}, {"$set": {"status": "drawing"}})
        if lock.modified_count == 0:
            break
        await _settle_one_round(rid, rd, settle_mode="cron")
        processed += 1
    await _ensure_open_round()
    return {"ok": True, "rounds_drawn": processed}


async def lottery_admin_force_draw(round_id: str, mode: str, current_user: dict) -> dict[str, Any]:
    """Admin-only: force-close an open or stuck drawing round. mode: standard | random_ticket."""
    from bson import ObjectId
    from bson.errors import InvalidId

    if mode not in ("standard", "random_ticket"):
        raise HTTPException(status_code=400, detail="mode must be standard or random_ticket")
    try:
        oid = ObjectId(round_id.strip())
    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid round_id")

    rd = await db.lottery_rounds.find_one({"_id": oid})
    if not rd:
        raise HTTPException(status_code=404, detail="Round not found")
    st = rd.get("status") or ""
    if st == "closed":
        raise HTTPException(status_code=400, detail="Round already closed")

    if st == "open":
        lock = await db.lottery_rounds.update_one(
            {"_id": oid, "status": "open"},
            {"$set": {"status": "drawing"}},
        )
        if lock.modified_count == 0:
            raise HTTPException(status_code=409, detail="Could not lock round (already drawing or closed)")
    elif st != "drawing":
        raise HTTPException(status_code=400, detail=f"Invalid round status: {st}")

    settle_mode = "admin_standard" if mode == "standard" else "admin_random_ticket"
    summary = await _settle_one_round(oid, rd, settle_mode=settle_mode)
    await _ensure_open_round()
    summary["mode"] = mode
    summary["forced_by"] = current_user.get("username") or current_user.get("id")
    return summary


async def lottery_repair_stuck_rounds(_: bool = Depends(_cron_verify())):
    """
    One-off repair for stuck open rounds:
    - Normalize malformed/empty closes_at on open rounds to "now"
    - Immediately run draw cron to settle anything now due
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    open_rounds = await db.lottery_rounds.find(
        {"status": "open"},
        {"_id": 1, "closes_at": 1, "created_at": 1},
    ).to_list(1000)

    normalized = 0
    for rd in open_rounds:
        if _parse_iso(rd.get("closes_at")) is not None:
            continue
        res = await db.lottery_rounds.update_one(
            {"_id": rd["_id"], "status": "open"},
            {"$set": {"closes_at": now_iso}},
        )
        if res.modified_count:
            normalized += 1

    draw_res = await lottery_draw_cron(True)
    now2 = datetime.now(timezone.utc)
    open_rounds_after = await db.lottery_rounds.find(
        {"status": "open"},
        {"_id": 1, "closes_at": 1, "rollover_in": 1, "created_at": 1},
    ).to_list(500)
    future: list[tuple[int, datetime, dict[str, Any]]] = []
    for rd in open_rounds_after:
        dt = _parse_iso(rd.get("closes_at"))
        if dt and dt > now2:
            future.append((int(rd.get("rollover_in") or 0), dt, rd))

    merged_open_rounds = 0
    merged_rollover = 0
    if len(future) > 1:
        future.sort(key=lambda x: (-x[0], x[1]))
        primary = future[0][2]
        primary_id = primary["_id"]
        move_total = 0
        for _, _, rd in future[1:]:
            rid = rd["_id"]
            ticket_count = await db.lottery_tickets.count_documents({"round_id": rid}, limit=1)
            if ticket_count > 0:
                continue
            rollover_in = int(rd.get("rollover_in") or 0)
            move_total += rollover_in
            res = await db.lottery_rounds.update_one(
                {"_id": rid, "status": "open"},
                {
                    "$set": {
                        "status": "merged",
                        "merged_into_round_id": str(primary_id),
                        "merged_at": now2.isoformat(),
                    }
                },
            )
            if res.modified_count:
                merged_open_rounds += 1
                merged_rollover += rollover_in
        if move_total > 0:
            await db.lottery_rounds.update_one(
                {"_id": primary_id},
                {"$inc": {"rollover_in": move_total}},
            )
    return {
        "ok": True,
        "normalized_open_rounds": normalized,
        "merged_open_rounds": merged_open_rounds,
        "merged_rollover_into_primary": merged_rollover,
        "draw_result": draw_res,
    }


def register(router: APIRouter) -> None:
    router.add_api_route("/lottery", get_lottery_state, methods=["GET"])
    router.add_api_route("/lottery/my-tickets", get_my_lottery_tickets, methods=["GET"])
    router.add_api_route("/lottery/buy", buy_lottery_tickets, methods=["POST"])
    router.add_api_route("/lottery/draw-cron", lottery_draw_cron, methods=["POST"])
    router.add_api_route("/lottery/repair-stuck-rounds", lottery_repair_stuck_rounds, methods=["POST"])
