# Witness statements: P2P cash market (list / cancel / buy). Balance minted when players receive kill witness notifications.
import uuid
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from server import db, get_current_user


WITNESS_MAX_QTY_PER_LISTING = 10_000
WITNESS_MAX_ACTIVE_LISTINGS = 5


def redact_witness_killer_for_market(message: str) -> str:
    """Hide killer name in witness text for non-sellers (format: '{killer} killed …')."""
    s = (message or "").strip()
    low = s.lower()
    key = " killed "
    idx = low.find(key)
    if idx <= 0:
        return s
    return "[Redacted]" + s[idx:]


class WitnessListRequest(BaseModel):
    notification_ids: list[str] = Field(..., min_length=1, max_length=WITNESS_MAX_QTY_PER_LISTING)
    price_cash: int = Field(..., ge=1)

    @field_validator("notification_ids", mode="before")
    @classmethod
    def _normalize_notification_ids(cls, v):
        if not isinstance(v, list):
            raise ValueError("notification_ids must be a list")
        out = []
        seen = set()
        for x in v:
            s = str(x).strip()
            if not s or s in seen:
                continue
            seen.add(s)
            out.append(s)
        return out


class WitnessListingIdRequest(BaseModel):
    listing_id: str


def register(router):
    _PLAYER_MATCH = {"is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}}

    async def _notification_messages_by_id(db, ids: list[str]) -> dict:
        if not ids:
            return {}
        rows = await db.notifications.find(
            {"id": {"$in": ids}},
            {"_id": 0, "id": 1, "message": 1},
        ).to_list(len(ids))
        return {r["id"]: r.get("message") or "" for r in rows}

    def _ordered_previews(ids: list[str], msg_by_id: dict, *, redact: bool) -> list:
        out = []
        for nid in ids:
            m = msg_by_id.get(nid, "")
            out.append(redact_witness_killer_for_market(m) if redact else m)
        return out

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
        all_ids = []
        for r in rows:
            for x in r.get("notification_ids") or []:
                all_ids.append(x)
        all_ids = list(dict.fromkeys(all_ids))
        msg_by_id = await _notification_messages_by_id(db, all_ids)
        out = []
        for r in rows:
            seller = r.get("seller_id")
            is_own = seller == me
            nids = r.get("notification_ids") or []
            qty = int(r.get("quantity") or 0) or len(nids)
            previews = _ordered_previews(nids, msg_by_id, redact=not is_own) if nids else []
            out.append(
                {
                    "id": r.get("id"),
                    "seller_username": r.get("seller_username") or "?",
                    "quantity": qty,
                    "price_cash": int(r.get("price_cash") or 0),
                    "created_at": r.get("created_at"),
                    "is_own": is_own,
                    "previews": previews,
                }
            )
        return out

    @router.get("/witness-statements/my-listings")
    async def witness_my_listings(current_user: dict = Depends(get_current_user)):
        me = current_user.get("id") or ""
        rows = await db.witness_statement_listings.find(
            {"status": "active", "seller_id": me},
            {"_id": 0},
        ).sort("created_at", -1).to_list(20)
        nids_all = []
        for r in rows:
            for x in r.get("notification_ids") or []:
                nids_all.append(x)
        nids_all = list(dict.fromkeys(nids_all))
        msg_by_id = await _notification_messages_by_id(db, nids_all)
        return [
            {
                "id": r.get("id"),
                "quantity": int(r.get("quantity") or 0) or len(r.get("notification_ids") or []),
                "price_cash": int(r.get("price_cash") or 0),
                "created_at": r.get("created_at"),
                "previews": _ordered_previews(r.get("notification_ids") or [], msg_by_id, redact=False),
            }
            for r in rows
        ]

    @router.get("/witness-statements/recent")
    async def witness_statements_recent(current_user: dict = Depends(get_current_user)):
        """Kill witness inbox lines for this account (same text as notifications)."""
        uid = current_user.get("id") or ""
        if not uid:
            raise HTTPException(status_code=401, detail="Not logged in")
        rows = await db.notifications.find(
            {"user_id": uid, "title": "Witness statement"},
            {"_id": 0, "id": 1, "message": 1, "created_at": 1, "read": 1, "listed_listing_id": 1},
        ).sort("created_at", -1).limit(100).to_list(100)
        return {"items": rows}

    @router.post("/witness-statements/list")
    async def witness_list(req: WitnessListRequest, current_user: dict = Depends(get_current_user)):
        uid = current_user.get("id") or ""
        if not uid:
            raise HTTPException(status_code=401, detail="Not logged in")
        ids = list(req.notification_ids)
        qty = len(ids)
        price = int(req.price_cash)
        if qty < 1:
            raise HTTPException(status_code=400, detail="Select at least one witness statement.")
        if qty > WITNESS_MAX_QTY_PER_LISTING:
            raise HTTPException(status_code=400, detail=f"Maximum {WITNESS_MAX_QTY_PER_LISTING} statements per listing.")
        active = await db.witness_statement_listings.count_documents({"status": "active", "seller_id": uid})
        if active >= WITNESS_MAX_ACTIVE_LISTINGS:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {WITNESS_MAX_ACTIVE_LISTINGS} active listings. Cancel one first.",
            )
        conflict = await db.witness_statement_listings.find_one(
            {"status": "active", "notification_ids": {"$elemMatch": {"$in": ids}}}
        )
        if conflict:
            raise HTTPException(status_code=400, detail="One or more statements are already listed on the market.")
        not_listed = {"$or": [{"listed_listing_id": {"$exists": False}}, {"listed_listing_id": None}]}
        eligible = await db.notifications.find(
            {
                "id": {"$in": ids},
                "user_id": uid,
                "title": "Witness statement",
                **not_listed,
            },
            {"_id": 0, "id": 1},
        ).to_list(qty + 1)
        if len(eligible) != qty:
            raise HTTPException(
                status_code=400,
                detail="Invalid selection, statements not owned, or already in escrow for a listing.",
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
            "notification_ids": ids,
            "price_cash": price,
            "created_at": now,
            "status": "active",
        }
        try:
            await db.witness_statement_listings.insert_one(doc)
        except Exception:
            await db.users.update_one({"id": uid}, {"$inc": {"witness_statements": qty}})
            raise HTTPException(status_code=500, detail="Could not create listing. Your statements were returned.")
        reserve = await db.notifications.update_many(
            {
                "id": {"$in": ids},
                "user_id": uid,
                "title": "Witness statement",
                **not_listed,
            },
            {"$set": {"listed_listing_id": listing_id}},
        )
        if reserve.modified_count != qty:
            await db.witness_statement_listings.delete_one({"id": listing_id})
            await db.users.update_one({"id": uid}, {"$inc": {"witness_statements": qty}})
            raise HTTPException(status_code=400, detail="Could not reserve statements. Refresh and try again.")
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
        nids = row.get("notification_ids") or []
        qty = len(nids) if nids else int(row.get("quantity") or 0)
        dr = await db.witness_statement_listings.delete_one({"id": lid, "status": "active"})
        if dr.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Listing not found")
        if nids:
            await db.notifications.update_many(
                {"listed_listing_id": lid, "user_id": uid},
                {"$unset": {"listed_listing_id": ""}},
            )
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
        nids = row.get("notification_ids") or []
        qty = len(nids) if nids else int(row.get("quantity") or 0)
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
        if nids:
            xfer = await db.notifications.update_many(
                {"listed_listing_id": lid, "user_id": seller_id, "id": {"$in": nids}},
                {"$set": {"user_id": buyer_id}, "$unset": {"listed_listing_id": ""}},
            )
            if xfer.modified_count != len(nids):
                await db.users.update_one({"id": buyer_id}, {"$inc": {"witness_statements": -qty, "money": price_f}})
                await db.users.update_one({"id": seller_id}, {"$inc": {"money": -price_f}})
                await db.witness_statement_listings.insert_one(row)
                raise HTTPException(status_code=500, detail="Could not transfer statement records; trade reverted")
        return {"message": f"Bought {qty} witness statement(s).", "quantity": qty, "price_cash": price}
