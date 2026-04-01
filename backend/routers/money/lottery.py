# Twice-weekly lottery (Wed & Sun 00:00 UTC): $500k/ticket, 10% of gross pot removed at draw, 90% to one random winner.
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, field_validator

from server import db, get_current_user, log_activity, send_notification

logger = logging.getLogger(__name__)

TICKET_PRICE = 500_000
POT_TAX_PERCENT = 10
_DRAW_WEEKDAYS = (2, 6)  # Wed, Sun — 00:00 UTC


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
    r = await db.lottery_rounds.find_one(
        {"status": "open", "closes_at": {"$gt": now.isoformat()}},
        {"_id": 1, "closes_at": 1, "status": 1, "created_at": 1},
    )
    if r:
        return r
    closes = _next_draw_utc(now)
    doc = {"closes_at": closes.isoformat(), "status": "open", "created_at": now.isoformat()}
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
    gross = total * TICKET_PRICE
    last = await db.lottery_rounds.find_one(
        {"status": "closed"},
        {"_id": 0, "drawn_at": 1, "gross_pot": 1, "payout": 1, "sink_amount": 1, "ticket_count": 1, "winner_username": 1, "winner_user_id": 1},
        sort=[("drawn_at", -1)],
    )
    return {
        "round_id": str(rid),
        "closes_at": rd["closes_at"],
        "seconds_until_close": max(0.0, (closes_at - now).total_seconds()),
        "ticket_price": TICKET_PRICE,
        "pot_tax_percent": POT_TAX_PERCENT,
        "ticket_count": total,
        "gross_pot": gross,
        "my_tickets": mine,
        "last_draw": last,
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
    docs = [{"round_id": rid, "user_id": uid, "username": uname, "created_at": now_iso} for _ in range(count)]
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
    """Return the current user's tickets for the open round (purchase timestamps)."""
    rd = await _ensure_open_round()
    rid = rd["_id"]
    uid = current_user["id"]
    cursor = db.lottery_tickets.find(
        {"round_id": rid, "user_id": uid},
        {"_id": 0, "created_at": 1},
    ).sort("created_at", -1).limit(500)
    docs = await cursor.to_list(500)
    grouped: dict[str, int] = {}
    for d in docs:
        key = (d.get("created_at") or "unknown")[:19]
        grouped[key] = grouped.get(key, 0) + 1
    purchases = [{"purchased_at": k, "count": v} for k, v in grouped.items()]
    purchases.sort(key=lambda x: x["purchased_at"], reverse=True)
    return {"round_id": str(rid), "total": len(docs), "purchases": purchases}


async def lottery_draw_cron(_: bool = Depends(_cron_verify())):
    now = datetime.now(timezone.utc)
    processed = 0
    while True:
        rd = await db.lottery_rounds.find_one({"status": "open", "closes_at": {"$lte": now.isoformat()}})
        if not rd:
            break
        rid = rd["_id"]
        lock = await db.lottery_rounds.update_one({"_id": rid, "status": "open"}, {"$set": {"status": "drawing"}})
        if lock.modified_count == 0:
            break
        tickets = await db.lottery_tickets.find({"round_id": rid}, {"_id": 0, "user_id": 1, "username": 1}).to_list(500_000)
        n = len(tickets)
        gross = n * TICKET_PRICE
        sink = (gross * POT_TAX_PERCENT) // 100 if gross > 0 else 0
        payout = gross - sink
        winner_uid = None
        winner_name = None
        if n > 0:
            w = secrets.choice(tickets)
            winner_uid = w["user_id"]
            winner_name = (w.get("username") or "?").strip()
            await db.users.update_one({"id": winner_uid}, {"$inc": {"money": payout}})
        drawn_iso = datetime.now(timezone.utc).isoformat()
        await db.lottery_rounds.update_one(
            {"_id": rid},
            {
                "$set": {
                    "status": "closed",
                    "drawn_at": drawn_iso,
                    "ticket_count": n,
                    "gross_pot": gross,
                    "sink_amount": sink,
                    "payout": payout if n else 0,
                    "winner_user_id": winner_uid,
                    "winner_username": winner_name,
                }
            },
        )
        try:
            await db.economy_events.insert_one(
                {
                    "at": drawn_iso,
                    "type": "lottery_draw",
                    "round_id": str(rid),
                    "ticket_count": n,
                    "gross_pot": gross,
                    "sink_amount": sink,
                    "payout": payout,
                    "winner_user_id": winner_uid,
                    "winner_username": winner_name,
                }
            )
        except Exception as e:
            logger.warning("economy_events lottery_draw: %s", e)
        if winner_uid:
            await log_activity(winner_uid, winner_name or "?", "lottery_win", {"round_id": str(rid), "payout": payout, "gross_pot": gross})
            try:
                await send_notification(
                    winner_uid,
                    "Lottery Winner!",
                    f"Congratulations! You won the City Lottery and received ${payout:,}. "
                    f"The gross pot was ${gross:,} ({n:,} tickets). {POT_TAX_PERCENT}% was removed as tax.",
                    "system",
                    category="lottery",
                )
            except Exception as e:
                logger.warning("lottery winner notification: %s", e)
            try:
                await db.lottery_events.insert_one({
                    "type": "lottery_winner",
                    "winner_username": winner_name,
                    "payout": payout,
                    "gross_pot": gross,
                    "ticket_count": n,
                    "drawn_at": drawn_iso,
                })
            except Exception as e:
                logger.warning("lottery_events insert: %s", e)
        processed += 1
        now2 = datetime.now(timezone.utc)
        nxt = _next_draw_utc(now2)
        await db.lottery_rounds.insert_one({"closes_at": nxt.isoformat(), "status": "open", "created_at": now2.isoformat()})
    await _ensure_open_round()
    return {"ok": True, "rounds_drawn": processed}


def register(router: APIRouter) -> None:
    router.add_api_route("/lottery", get_lottery_state, methods=["GET"])
    router.add_api_route("/lottery/my-tickets", get_my_lottery_tickets, methods=["GET"])
    router.add_api_route("/lottery/buy", buy_lottery_tickets, methods=["POST"])
    router.add_api_route("/lottery/draw-cron", lottery_draw_cron, methods=["POST"])
