# Witness statements: P2P cash market (list / cancel / buy). Balance minted when players receive kill witness notifications.
import uuid
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from server import db, get_current_user


WITNESS_MAX_QTY_PER_LISTING = 10_000
WITNESS_MAX_ACTIVE_LISTINGS = 5


class WitnessListRequest(BaseModel):
    quantity: int = Field(..., ge=1, le=WITNESS_MAX_QTY_PER_LISTING)
    price_cash: int = Field(..., ge=1)


class WitnessListingIdRequest(BaseModel):
    listing_id: str


def register(router):
    _PLAYER_MATCH = {"is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}}

    @router.get("/admin/witness-statements-overview")
    async def admin_witness_statements_overview(current_user: dict = Depends(get_current_user)):
        """Staff: balances, marketplace, and recent witness inbox deliveries."""
        from server import _is_admin, _is_moderator

        if not (_is_admin(current_user) or _is_moderator(current_user)):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        now = datetime.now(timezone.utc).isoformat()
        agg = await db.users.aggregate(
            [
                {"$match": _PLAYER_MATCH},
                {"$group": {"_id": None, "circulating": {"$sum": {"$ifNull": ["$witness_statements", 0]}}}},
            ]
        ).to_list(1)
        circulating = int((agg[0] or {}).get("circulating") or 0) if agg else 0
        holders_with_balance = await db.users.count_documents({**_PLAYER_MATCH, "witness_statements": {"$gt": 0}})
        top = await db.users.find(
            {**_PLAYER_MATCH, "witness_statements": {"$gt": 0}},
            {"_id": 0, "id": 1, "username": 1, "witness_statements": 1, "is_dead": 1, "last_seen": 1},
        ).sort("witness_statements", -1).limit(50).to_list(50)
        top_holders = [
            {
                "user_id": r.get("id"),
                "username": r.get("username") or "?",
                "balance": int(r.get("witness_statements") or 0),
                "is_dead": bool(r.get("is_dead")),
                "last_seen": r.get("last_seen"),
            }
            for r in top
        ]
        listings = await db.witness_statement_listings.find(
            {"status": "active"},
            {"_id": 0},
        ).sort("created_at", -1).to_list(100)
        active_listings = [
            {
                "id": r.get("id"),
                "seller_id": r.get("seller_id"),
                "seller_username": r.get("seller_username") or "?",
                "quantity": int(r.get("quantity") or 0),
                "price_cash": int(r.get("price_cash") or 0),
                "created_at": r.get("created_at"),
            }
            for r in listings
        ]
        notif_rows = await db.notifications.find(
            {"title": "Witness statement"},
            {"_id": 0, "id": 1, "user_id": 1, "message": 1, "created_at": 1},
        ).sort("created_at", -1).limit(50).to_list(50)
        nuids = list({n.get("user_id") for n in notif_rows if n.get("user_id")})
        unames = {}
        if nuids:
            async for u in db.users.find({"id": {"$in": nuids}}, {"_id": 0, "id": 1, "username": 1}):
                unames[u["id"]] = u.get("username") or "?"
        recent_notifications = []
        for n in notif_rows:
            uid = n.get("user_id")
            msg = (n.get("message") or "").replace("\n", " ")
            if len(msg) > 160:
                msg = msg[:157] + "..."
            recent_notifications.append(
                {
                    "id": n.get("id"),
                    "user_id": uid,
                    "username": unames.get(uid, "?"),
                    "created_at": n.get("created_at"),
                    "message_preview": msg,
                }
            )
        return {
            "generated_at": now,
            "circulating_total": circulating,
            "holders_with_balance": holders_with_balance,
            "active_listings_count": len(active_listings),
            "top_holders": top_holders,
            "active_listings": active_listings,
            "recent_witness_notifications": recent_notifications,
        }

    @router.get("/witness-statements/listings")
    async def witness_listings(current_user: dict = Depends(get_current_user)):
        me = current_user.get("id") or ""
        rows = await db.witness_statement_listings.find(
            {"status": "active"},
            {"_id": 0},
        ).sort("created_at", -1).to_list(200)
        return [
            {
                "id": r.get("id"),
                "seller_username": r.get("seller_username") or "?",
                "quantity": int(r.get("quantity") or 0),
                "price_cash": int(r.get("price_cash") or 0),
                "created_at": r.get("created_at"),
                "is_own": r.get("seller_id") == me,
            }
            for r in rows
        ]

    @router.get("/witness-statements/my-listings")
    async def witness_my_listings(current_user: dict = Depends(get_current_user)):
        me = current_user.get("id") or ""
        rows = await db.witness_statement_listings.find(
            {"status": "active", "seller_id": me},
            {"_id": 0},
        ).sort("created_at", -1).to_list(20)
        return [
            {
                "id": r.get("id"),
                "quantity": int(r.get("quantity") or 0),
                "price_cash": int(r.get("price_cash") or 0),
                "created_at": r.get("created_at"),
            }
            for r in rows
        ]

    @router.post("/witness-statements/list")
    async def witness_list(req: WitnessListRequest, current_user: dict = Depends(get_current_user)):
        uid = current_user.get("id") or ""
        if not uid:
            raise HTTPException(status_code=401, detail="Not logged in")
        qty = int(req.quantity)
        price = int(req.price_cash)
        active = await db.witness_statement_listings.count_documents({"status": "active", "seller_id": uid})
        if active >= WITNESS_MAX_ACTIVE_LISTINGS:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {WITNESS_MAX_ACTIVE_LISTINGS} active listings. Cancel one first.",
            )
        seller_res = await db.users.update_one(
            {"id": uid, "witness_statements": {"$gte": qty}},
            {"$inc": {"witness_statements": -qty}},
        )
        if seller_res.modified_count == 0:
            raise HTTPException(status_code=400, detail="Not enough witness statements to list.")
        listing_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": listing_id,
            "seller_id": uid,
            "seller_username": current_user.get("username") or "?",
            "quantity": qty,
            "price_cash": price,
            "created_at": now,
            "status": "active",
        }
        try:
            await db.witness_statement_listings.insert_one(doc)
        except Exception:
            await db.users.update_one({"id": uid}, {"$inc": {"witness_statements": qty}})
            raise HTTPException(status_code=500, detail="Could not create listing. Your statements were returned.")
        return {"message": "Listed.", "listing_id": listing_id}

    @router.post("/witness-statements/cancel")
    async def witness_cancel(req: WitnessListingIdRequest, current_user: dict = Depends(get_current_user)):
        uid = current_user.get("id") or ""
        lid = (req.listing_id or "").strip()
        if not lid:
            raise HTTPException(status_code=400, detail="listing_id required")
        row = await db.witness_statement_listings.find_one({"id": lid, "status": "active"})
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        if row.get("seller_id") != uid:
            raise HTTPException(status_code=403, detail="Not your listing")
        qty = int(row.get("quantity") or 0)
        dr = await db.witness_statement_listings.delete_one({"id": lid, "status": "active"})
        if dr.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Listing not found")
        await db.users.update_one({"id": uid}, {"$inc": {"witness_statements": qty}})
        return {"message": "Listing cancelled. Statements returned to you."}

    @router.post("/witness-statements/buy")
    async def witness_buy(req: WitnessListingIdRequest, current_user: dict = Depends(get_current_user)):
        buyer_id = current_user.get("id") or ""
        lid = (req.listing_id or "").strip()
        if not lid:
            raise HTTPException(status_code=400, detail="listing_id required")
        row = await db.witness_statement_listings.find_one_and_delete({"id": lid, "status": "active"})
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found or already sold")
        seller_id = row.get("seller_id")
        if seller_id == buyer_id:
            row.pop("_id", None)
            await db.witness_statement_listings.insert_one(row)
            raise HTTPException(status_code=400, detail="You cannot buy your own listing")
        qty = int(row.get("quantity") or 0)
        price = int(row.get("price_cash") or 0)
        price_f = float(price)
        row.pop("_id", None)

        charged = await db.users.update_one(
            {"id": buyer_id, "money": {"$gte": price_f}},
            {"$inc": {"money": -price_f}},
        )
        if charged.modified_count == 0:
            await db.witness_statement_listings.insert_one(row)
            raise HTTPException(status_code=400, detail="Insufficient cash on hand")
        pay = await db.users.update_one({"id": seller_id}, {"$inc": {"money": price_f}})
        if pay.modified_count == 0:
            await db.users.update_one({"id": buyer_id}, {"$inc": {"money": price_f}})
            await db.witness_statement_listings.insert_one(row)
            raise HTTPException(status_code=400, detail="Seller no longer exists; your cash was refunded")
        cred = await db.users.update_one({"id": buyer_id}, {"$inc": {"witness_statements": qty}})
        if cred.modified_count == 0:
            await db.users.update_one({"id": buyer_id}, {"$inc": {"money": price_f}})
            await db.users.update_one({"id": seller_id}, {"$inc": {"money": -price_f}})
            await db.witness_statement_listings.insert_one(row)
            raise HTTPException(status_code=400, detail="Could not credit statements; trade reverted")
        return {"message": f"Bought {qty} witness statement(s).", "quantity": qty, "price_cash": price}
