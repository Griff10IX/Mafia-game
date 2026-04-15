# Witness statements: P2P cash market (list / cancel / buy). Balance minted when players receive kill witness notifications.
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from server import db, get_current_user, _username_pattern


WITNESS_MAX_QTY_PER_LISTING = 10_000
WITNESS_MAX_ACTIVE_LISTINGS = 5

# Inbox + witness log match (case/spacing tolerant; must match send_notification title from kills).
_WITNESS_INBOX_TITLE = {"title": {"$regex": r"^\s*Witness\s+statement\s*$", "$options": "i"}}
_NOT_LISTED = {"$or": [{"listed_listing_id": {"$exists": False}}, {"listed_listing_id": None}]}


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
    seller_anonymous: bool = False

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


class WitnessStatementReconcileRequest(BaseModel):
    """Staff: set witness_statements to match inbox + active listing escrow (fixes mute/delete desync)."""

    username: Optional[str] = None
    user_id: Optional[str] = None
    dry_run: bool = True


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
                "seller_anonymous": bool(r.get("seller_anonymous")),
                "quantity": int(r.get("quantity") or 0),
                "price_cash": int(r.get("price_cash") or 0),
                "created_at": r.get("created_at"),
            }
            for r in listings
        ]
        notif_rows = await db.notifications.find(
            _WITNESS_INBOX_TITLE,
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

    @router.post("/admin/witness-statements-reconcile")
    async def admin_witness_statements_reconcile(
        req: WitnessStatementReconcileRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Set a player's witness_statements to the count of witness inbox rows not held in
        active Quick Trade escrow (matches list/cancel/buy invariants). Fixes ghost balance
        from muted attack notifications (historical) or deleted witness inbox rows.
        """
        from server import _is_admin, _is_moderator

        if not (_is_admin(current_user) or _is_moderator(current_user)):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")

        uid_in = (req.user_id or "").strip()
        uname_in = (req.username or "").strip()
        if not uid_in and not uname_in:
            raise HTTPException(status_code=400, detail="Provide user_id or username")

        if uid_in:
            target = await db.users.find_one(
                {"id": uid_in},
                {"_id": 0, "id": 1, "username": 1, "witness_statements": 1, "witness_nav_red": 1, "is_npc": 1, "is_bodyguard": 1},
            )
        else:
            pat = _username_pattern(uname_in)
            if not pat:
                raise HTTPException(status_code=404, detail="User not found")
            target = await db.users.find_one(
                {"username": pat},
                {"_id": 0, "id": 1, "username": 1, "witness_statements": 1, "witness_nav_red": 1, "is_npc": 1, "is_bodyguard": 1},
            )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        if target.get("is_npc") or target.get("is_bodyguard"):
            raise HTTPException(status_code=400, detail="Cannot reconcile NPC or bodyguard accounts")

        witness_base = {"user_id": uid, **_WITNESS_INBOX_TITLE}
        total_notifications = await db.notifications.count_documents(witness_base)

        escrow_ids: list[str] = []
        listing_rows = await db.witness_statement_listings.find(
            {"status": "active", "seller_id": uid},
            {"_id": 0, "notification_ids": 1},
        ).to_list(WITNESS_MAX_ACTIVE_LISTINGS + 2)
        for row in listing_rows:
            for nid in row.get("notification_ids") or []:
                s = str(nid).strip()
                if s:
                    escrow_ids.append(s)
        escrow_set = list(dict.fromkeys(escrow_ids))
        in_escrow = 0
        if escrow_set:
            in_escrow = await db.notifications.count_documents({**witness_base, "id": {"$in": escrow_set}})

        expected = max(0, int(total_notifications) - int(in_escrow))
        before = int(target.get("witness_statements") or 0)
        nav_before = int(target.get("witness_nav_red") or 0)
        delta = expected - before
        nav_after = min(nav_before, expected)

        staff_name = current_user.get("username") or current_user.get("id") or "?"
        msg = (
            f"Witness balance for {target.get('username') or '?'}: stored {before}, "
            f"expected {expected} ({total_notifications} inbox lines, {in_escrow} in active listing escrow)."
        )

        if req.dry_run:
            return {
                "dry_run": True,
                "applied": False,
                "user_id": uid,
                "username": target.get("username") or "?",
                "witness_statements_before": before,
                "witness_statements_after": expected,
                "witness_nav_red_before": nav_before,
                "witness_nav_red_after": nav_after,
                "delta": delta,
                "witness_notifications_total": total_notifications,
                "witness_notifications_in_escrow": in_escrow,
                "expected_balance": expected,
                "message": msg + " Dry run — no changes written.",
            }

        if delta == 0 and nav_after == nav_before:
            return {
                "dry_run": False,
                "applied": False,
                "user_id": uid,
                "username": target.get("username") or "?",
                "witness_statements_before": before,
                "witness_statements_after": before,
                "witness_nav_red_before": nav_before,
                "witness_nav_red_after": nav_before,
                "delta": 0,
                "witness_notifications_total": total_notifications,
                "witness_notifications_in_escrow": in_escrow,
                "expected_balance": expected,
                "message": msg + " Already in sync.",
            }

        await db.users.update_one(
            {"id": uid},
            {"$set": {"witness_statements": expected, "witness_nav_red": nav_after}},
        )
        try:
            from routers.game.notifications import _invalidate_list_cache

            _invalidate_list_cache(uid)
        except Exception:
            pass

        return {
            "dry_run": False,
            "applied": True,
            "user_id": uid,
            "username": target.get("username") or "?",
            "witness_statements_before": before,
            "witness_statements_after": expected,
            "witness_nav_red_before": nav_before,
            "witness_nav_red_after": nav_after,
            "delta": delta,
            "witness_notifications_total": total_notifications,
            "witness_notifications_in_escrow": in_escrow,
            "expected_balance": expected,
            "message": f"{msg} Updated by staff ({staff_name}).",
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
            anon = bool(r.get("seller_anonymous"))
            nids = r.get("notification_ids") or []
            qty = int(r.get("quantity") or 0) or len(nids)
            previews = _ordered_previews(nids, msg_by_id, redact=not is_own) if nids else []
            seller_username_out = r.get("seller_username") or "?"
            if not is_own and anon:
                seller_username_out = "Anonymous"
            out.append(
                {
                    "id": r.get("id"),
                    "seller_username": seller_username_out,
                    "quantity": qty,
                    "price_cash": int(r.get("price_cash") or 0),
                    "created_at": r.get("created_at"),
                    "is_own": is_own,
                    "seller_anonymous": anon,
                    "seller_profile_hidden": (not is_own) and anon,
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
                "seller_anonymous": bool(r.get("seller_anonymous")),
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
            {"user_id": uid, **_WITNESS_INBOX_TITLE},
            {"_id": 0, "id": 1, "message": 1, "created_at": 1, "read": 1, "listed_listing_id": 1},
        ).sort("created_at", -1).limit(100).to_list(100)
        return {"items": rows}

    @router.post("/witness-statements/nav-seen")
    async def witness_statements_nav_seen(current_user: dict = Depends(get_current_user)):
        """Clear sidebar badges: new witness count and market-since-visit reminder (opening Witness statements page)."""
        uid = current_user.get("id") or ""
        if not uid:
            raise HTTPException(status_code=401, detail="Not logged in")
        now = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": uid},
            {"$set": {"witness_nav_red": 0, "witness_market_nav_cleared_at": now}},
        )
        return {"ok": True}

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
        eligible = await db.notifications.find(
            {
                "id": {"$in": ids},
                "user_id": uid,
                **_WITNESS_INBOX_TITLE,
                **_NOT_LISTED,
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
            "seller_anonymous": bool(req.seller_anonymous),
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
                **_WITNESS_INBOX_TITLE,
                **_NOT_LISTED,
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
