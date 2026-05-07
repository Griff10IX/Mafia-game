from datetime import datetime, timedelta, timezone
import uuid
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import (
    db,
    get_current_user,
    _is_admin,
    _is_moderator,
    send_notification,
    send_notification_to_all,
    require_staff_issued_if_staff_capable,
)
from utils.text import strip_emoji


MAX_AUCTION_DURATION_HOURS = 24
AUCTION_CURRENCIES = {"money", "points"}
OPEN_STATUS = "open"


class DesignerAuctionCreateRequest(BaseModel):
    title: str
    content: str
    image_url: str
    currency: str  # money | points
    starting_bid: int
    end_at: str  # ISO datetime
    title_color: Optional[str] = None


class DesignerAuctionBidRequest(BaseModel):
    amount: int


class DesignerAuctionDeliveryRequest(BaseModel):
    delivered_image_url: str


class DesignerAuctionDisputeRequest(BaseModel):
    reason: Optional[str] = None


class DesignerAuctionResolveRequest(BaseModel):
    action: str  # release | refund
    note: Optional[str] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso_datetime(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _is_staff(user: dict) -> bool:
    return _is_admin(user) or _is_moderator(user)


async def _load_auction_or_404(auction_id: str) -> dict:
    auc = await db.forum_designer_auctions.find_one({"id": auction_id}, {"_id": 0})
    if not auc:
        raise HTTPException(status_code=404, detail="Auction not found")
    return auc


async def _finalize_if_expired(auction: dict) -> dict:
    if not auction or auction.get("status") != OPEN_STATUS:
        return auction
    end_dt = _parse_iso_datetime(auction.get("end_at"))
    if not end_dt or datetime.now(timezone.utc) < end_dt:
        return auction
    closed_at = _now_iso()
    winner_id = auction.get("current_bidder_id")
    amount = int(auction.get("current_bid") or 0)
    currency = auction.get("currency")
    if not winner_id or amount <= 0:
        await db.forum_designer_auctions.update_one(
            {"id": auction["id"], "status": OPEN_STATUS},
            {"$set": {"status": "closed_no_bids", "closed_at": closed_at}},
        )
        return await _load_auction_or_404(auction["id"])

    field = "money" if currency == "money" else "points"
    debit = await db.users.update_one(
        {"id": winner_id, field: {"$gte": amount}},
        {"$inc": {field: -amount}},
    )
    if debit.modified_count == 0:
        await db.forum_designer_auctions.update_one(
            {"id": auction["id"], "status": OPEN_STATUS},
            {"$set": {"status": "closed_no_funds", "closed_at": closed_at}},
        )
        return await _load_auction_or_404(auction["id"])

    await db.forum_designer_auctions.update_one(
        {"id": auction["id"], "status": OPEN_STATUS},
        {"$set": {
            "status": "in_escrow",
            "closed_at": closed_at,
            "winner_id": winner_id,
            "winner_username": auction.get("current_bidder_username"),
            "escrow_amount": amount,
            "escrow_currency": currency,
            "escrow_holder_id": winner_id,
            "escrow_held_at": closed_at,
        }},
    )
    return await _load_auction_or_404(auction["id"])


async def create_designer_auction_topic(
    body: DesignerAuctionCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    title = strip_emoji((body.title or "").strip())
    content = (body.content or "").strip()
    image_url = (body.image_url or "").strip()
    currency = (body.currency or "").strip().lower()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if not content:
        raise HTTPException(status_code=400, detail="Content is required")
    if not image_url.startswith("http://") and not image_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Valid image URL required")
    if currency not in AUCTION_CURRENCIES:
        raise HTTPException(status_code=400, detail="currency must be money or points")
    starting_bid = int(body.starting_bid or 0)
    if starting_bid <= 0:
        raise HTTPException(status_code=400, detail="Starting bid must be positive")
    end_dt = _parse_iso_datetime(body.end_at)
    if not end_dt:
        raise HTTPException(status_code=400, detail="Invalid end_at datetime")
    now = datetime.now(timezone.utc)
    if end_dt <= now:
        raise HTTPException(status_code=400, detail="Auction end must be in the future")
    if end_dt > now + timedelta(hours=MAX_AUCTION_DURATION_HOURS):
        raise HTTPException(status_code=400, detail="Auction duration cannot exceed 1 day")

    now_iso = _now_iso()
    topic_id = str(uuid.uuid4())
    topic_doc = {
        "id": topic_id,
        "title": title,
        "content": content,
        "category": "designer",
        "author_id": current_user["id"],
        "author_username": current_user.get("username") or "?",
        "created_at": now_iso,
        "updated_at": now_iso,
        "views": 0,
        "is_sticky": False,
        "is_important": False,
        "is_locked": False,
        "title_color": (body.title_color or "").strip() or None,
    }
    await db.forum_topics.insert_one(topic_doc)

    auction_id = str(uuid.uuid4())
    auction_doc = {
        "id": auction_id,
        "topic_id": topic_id,
        "topic_title": title,
        "designer_user_id": current_user["id"],
        "designer_username": current_user.get("username") or "?",
        "image_url": image_url,
        "currency": currency,
        "starting_bid": starting_bid,
        "current_bid": 0,
        "current_bidder_id": None,
        "current_bidder_username": None,
        "bid_count": 0,
        "status": OPEN_STATUS,
        "end_at": end_dt.isoformat(),
        "created_at": now_iso,
        "updated_at": now_iso,
        "closed_at": None,
        "winner_id": None,
        "winner_username": None,
        "escrow_amount": 0,
        "escrow_currency": currency,
        "escrow_holder_id": None,
        "escrow_held_at": None,
        "delivered_image_url": None,
        "delivered_at": None,
        "designer_confirmed": False,
        "winner_confirmed": False,
        "payout_released_at": None,
        "disputed_at": None,
        "dispute_id": None,
    }
    await db.forum_designer_auctions.insert_one(auction_doc)
    return {"message": "Designer auction topic created", "topic_id": topic_id, "auction_id": auction_id}


async def get_auction_for_topic(topic_id: str, current_user: dict = Depends(get_current_user)):
    _ = current_user
    auc = await db.forum_designer_auctions.find_one({"topic_id": topic_id}, {"_id": 0})
    if not auc:
        return {"auction": None}
    auc = await _finalize_if_expired(auc)
    return {"auction": auc}


async def place_bid(
    auction_id: str,
    body: DesignerAuctionBidRequest,
    current_user: dict = Depends(get_current_user),
):
    amount = int(body.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Bid amount must be positive")
    auc = await _load_auction_or_404(auction_id)
    auc = await _finalize_if_expired(auc)
    if auc.get("status") != OPEN_STATUS:
        raise HTTPException(status_code=400, detail="Auction is not open")
    if auc.get("designer_user_id") == current_user["id"]:
        raise HTTPException(status_code=400, detail="Designer cannot bid on own auction")
    min_bid = max(int(auc.get("starting_bid") or 0), int(auc.get("current_bid") or 0) + 1)
    if amount < min_bid:
        raise HTTPException(status_code=400, detail=f"Bid must be at least {min_bid:,}")
    field = "money" if auc.get("currency") == "money" else "points"
    bal = int(current_user.get(field) or 0)
    if bal < amount:
        raise HTTPException(status_code=400, detail=f"Insufficient {field}")

    prev_bidder_id = auc.get("current_bidder_id")
    now_iso = _now_iso()
    res = await db.forum_designer_auctions.update_one(
        {
            "id": auction_id,
            "status": OPEN_STATUS,
            "current_bid": int(auc.get("current_bid") or 0),
        },
        {
            "$set": {
                "current_bid": amount,
                "current_bidder_id": current_user["id"],
                "current_bidder_username": current_user.get("username") or "?",
                "updated_at": now_iso,
            },
            "$inc": {"bid_count": 1},
        },
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=409, detail="Bid race detected, please retry")
    await db.forum_designer_auction_bids.insert_one({
        "id": str(uuid.uuid4()),
        "auction_id": auction_id,
        "topic_id": auc.get("topic_id"),
        "bidder_id": current_user["id"],
        "bidder_username": current_user.get("username") or "?",
        "amount": amount,
        "created_at": now_iso,
    })

    if prev_bidder_id and prev_bidder_id != current_user["id"]:
        topic_title = (auc.get("topic_title") or "").strip()
        if not topic_title and auc.get("topic_id"):
            t = await db.forum_topics.find_one({"id": auc.get("topic_id")}, {"_id": 0, "title": 1})
            topic_title = ((t or {}).get("title") or "").strip()
        if not topic_title:
            topic_title = "Designer auction"
        try:
            await send_notification(
                prev_bidder_id,
                "You were outbid",
                f"You were outbid on '{topic_title}'. New highest bid: {amount:,} {auc.get('currency')}.",
                "system",
            )
        except Exception:
            pass
    return {"message": "Bid placed", "amount": amount}


async def close_auction(
    auction_id: str,
    current_user: dict = Depends(get_current_user),
):
    auc = await _load_auction_or_404(auction_id)
    if not (_is_staff(current_user) or auc.get("designer_user_id") == current_user.get("id")):
        raise HTTPException(status_code=403, detail="Not allowed to close this auction")
    auc = await _finalize_if_expired(auc)
    if auc.get("status") == OPEN_STATUS:
        end_dt = _parse_iso_datetime(auc.get("end_at"))
        if end_dt and datetime.now(timezone.utc) < end_dt and not _is_staff(current_user):
            raise HTTPException(status_code=400, detail="Auction cannot be closed before end time")
        # staff manual close can force immediate finalization
        await db.forum_designer_auctions.update_one({"id": auction_id}, {"$set": {"end_at": _now_iso()}})
        auc = await _finalize_if_expired(await _load_auction_or_404(auction_id))
    return {"message": "Auction finalized", "auction": auc}


async def mark_delivered(
    auction_id: str,
    body: DesignerAuctionDeliveryRequest,
    current_user: dict = Depends(get_current_user),
):
    auc = await _load_auction_or_404(auction_id)
    if auc.get("designer_user_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Only designer can mark delivered")
    if auc.get("status") not in ("in_escrow", "delivered", "disputed"):
        raise HTTPException(status_code=400, detail="Auction is not in deliverable state")
    img = (body.delivered_image_url or "").strip()
    if not img.startswith("http://") and not img.startswith("https://"):
        raise HTTPException(status_code=400, detail="Valid delivered image URL required")
    now_iso = _now_iso()
    await db.forum_designer_auctions.update_one(
        {"id": auction_id},
        {"$set": {"status": "delivered", "delivered_image_url": img, "delivered_at": now_iso, "updated_at": now_iso}},
    )
    if auc.get("winner_id"):
        try:
            await send_notification(
                auc["winner_id"],
                "Designer marked delivery",
                "Please review the delivered image and confirm if satisfied.",
                "system",
            )
        except Exception:
            pass
    return {"message": "Marked delivered"}


async def _try_release_escrow(auction_id: str) -> dict:
    auc = await _load_auction_or_404(auction_id)
    if not (auc.get("designer_confirmed") and auc.get("winner_confirmed")):
        return auc
    if auc.get("payout_released_at"):
        return auc
    if auc.get("status") not in ("in_escrow", "delivered", "disputed"):
        return auc
    now_iso = _now_iso()
    res = await db.forum_designer_auctions.update_one(
        {
            "id": auction_id,
            "payout_released_at": None,
            "designer_confirmed": True,
            "winner_confirmed": True,
        },
        {"$set": {"payout_released_at": now_iso, "status": "completed", "updated_at": now_iso}},
    )
    if res.modified_count > 0:
        auc = await _load_auction_or_404(auction_id)
        field = "money" if auc.get("escrow_currency") == "money" else "points"
        amount = int(auc.get("escrow_amount") or 0)
        if amount > 0 and auc.get("designer_user_id"):
            await db.users.update_one({"id": auc["designer_user_id"]}, {"$inc": {field: amount}})
            try:
                await send_notification(
                    auc["designer_user_id"],
                    "Auction escrow released",
                    f"You received {amount:,} {auc.get('escrow_currency')} from completed auction.",
                    "system",
                )
            except Exception:
                pass
        return auc
    return await _load_auction_or_404(auction_id)


async def confirm_designer(
    auction_id: str,
    current_user: dict = Depends(get_current_user),
):
    auc = await _load_auction_or_404(auction_id)
    if auc.get("designer_user_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Only designer can confirm")
    await db.forum_designer_auctions.update_one(
        {"id": auction_id},
        {"$set": {"designer_confirmed": True, "updated_at": _now_iso()}},
    )
    auc = await _try_release_escrow(auction_id)
    return {"message": "Designer confirmation recorded", "auction": auc}


async def confirm_winner(
    auction_id: str,
    current_user: dict = Depends(get_current_user),
):
    auc = await _load_auction_or_404(auction_id)
    if auc.get("winner_id") != current_user.get("id"):
        raise HTTPException(status_code=403, detail="Only winning bidder can confirm")
    await db.forum_designer_auctions.update_one(
        {"id": auction_id},
        {"$set": {"winner_confirmed": True, "updated_at": _now_iso()}},
    )
    auc = await _try_release_escrow(auction_id)
    return {"message": "Winner confirmation recorded", "auction": auc}


async def report_dispute(
    auction_id: str,
    body: DesignerAuctionDisputeRequest,
    current_user: dict = Depends(get_current_user),
):
    auc = await _load_auction_or_404(auction_id)
    uid = current_user.get("id")
    if uid not in {auc.get("designer_user_id"), auc.get("winner_id")} and not _is_staff(current_user):
        raise HTTPException(status_code=403, detail="Only participants can report disputes")
    if auc.get("status") not in ("in_escrow", "delivered"):
        raise HTTPException(status_code=400, detail="Auction is not in disputable state")
    now_iso = _now_iso()
    dispute_id = str(uuid.uuid4())
    await db.forum_designer_auction_disputes.insert_one({
        "id": dispute_id,
        "auction_id": auction_id,
        "topic_id": auc.get("topic_id"),
        "reporter_id": uid,
        "reporter_username": current_user.get("username") or "?",
        "reason": ((body.reason or "").strip() or None),
        "status": "open",
        "created_at": now_iso,
        "resolved_at": None,
        "resolved_by_id": None,
        "resolved_by_username": None,
        "resolution_action": None,
        "resolution_note": None,
    })
    await db.forum_designer_auctions.update_one(
        {"id": auction_id},
        {"$set": {"status": "disputed", "disputed_at": now_iso, "dispute_id": dispute_id, "updated_at": now_iso}},
    )
    try:
        await send_notification_to_all(
            "Designer auction dispute reported",
            "A designer auction dispute was reported. Staff review may be needed.",
            "system",
            category="designer_auction_dispute",
        )
    except Exception:
        pass
    return {"message": "Dispute reported", "dispute_id": dispute_id}


async def list_disputes(current_user: dict = Depends(get_current_user)):
    if not _is_staff(current_user):
        raise HTTPException(status_code=403, detail="Staff only")
    require_staff_issued_if_staff_capable(current_user)
    rows = await db.forum_designer_auction_disputes.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"disputes": rows}


async def resolve_dispute(
    dispute_id: str,
    body: DesignerAuctionResolveRequest,
    current_user: dict = Depends(get_current_user),
):
    if not _is_staff(current_user):
        raise HTTPException(status_code=403, detail="Staff only")
    require_staff_issued_if_staff_capable(current_user)
    d = await db.forum_designer_auction_disputes.find_one({"id": dispute_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Dispute not found")
    if d.get("status") != "open":
        raise HTTPException(status_code=400, detail="Dispute already resolved")
    action = (body.action or "").strip().lower()
    if action not in {"release", "refund"}:
        raise HTTPException(status_code=400, detail="action must be release or refund")
    auction_id = d.get("auction_id")
    auc = await _load_auction_or_404(auction_id)
    now_iso = _now_iso()

    if action == "release":
        await db.forum_designer_auctions.update_one(
            {"id": auction_id},
            {"$set": {"designer_confirmed": True, "winner_confirmed": True, "updated_at": now_iso}},
        )
        auc = await _try_release_escrow(auction_id)
    else:
        # refund winner if escrow is still held and payout not released
        if not auc.get("payout_released_at") and int(auc.get("escrow_amount") or 0) > 0 and auc.get("winner_id"):
            field = "money" if auc.get("escrow_currency") == "money" else "points"
            await db.users.update_one({"id": auc["winner_id"]}, {"$inc": {field: int(auc.get("escrow_amount") or 0)}})
        await db.forum_designer_auctions.update_one(
            {"id": auction_id},
            {"$set": {"status": "cancelled_refunded", "updated_at": now_iso}},
        )
        auc = await _load_auction_or_404(auction_id)

    await db.forum_designer_auction_disputes.update_one(
        {"id": dispute_id},
        {"$set": {
            "status": "resolved",
            "resolved_at": now_iso,
            "resolved_by_id": current_user.get("id"),
            "resolved_by_username": current_user.get("username") or "?",
            "resolution_action": action,
            "resolution_note": ((body.note or "").strip() or None),
        }},
    )
    return {"message": "Dispute resolved", "auction": auc}


def register(router):
    router.add_api_route("/forum/designer/auctions", create_designer_auction_topic, methods=["POST"])
    router.add_api_route("/forum/designer/auctions/topic/{topic_id}", get_auction_for_topic, methods=["GET"])
    router.add_api_route("/forum/designer/auctions/{auction_id}/bid", place_bid, methods=["POST"])
    router.add_api_route("/forum/designer/auctions/{auction_id}/close", close_auction, methods=["POST"])
    router.add_api_route("/forum/designer/auctions/{auction_id}/deliver", mark_delivered, methods=["POST"])
    router.add_api_route("/forum/designer/auctions/{auction_id}/confirm-designer", confirm_designer, methods=["POST"])
    router.add_api_route("/forum/designer/auctions/{auction_id}/confirm-winner", confirm_winner, methods=["POST"])
    router.add_api_route("/forum/designer/auctions/{auction_id}/dispute", report_dispute, methods=["POST"])
    router.add_api_route("/forum/designer/auctions/disputes", list_disputes, methods=["GET"])
    router.add_api_route("/forum/designer/auctions/disputes/{dispute_id}/resolve", resolve_dispute, methods=["POST"])
