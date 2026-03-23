# Payments: Stripe Checkout (redirect), status, webhook. Idempotent credit to prevent double-credit exploit.
import os
import asyncio
import logging
from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from server import send_notification

logger = logging.getLogger(__name__)


class CheckoutRequest(BaseModel):
    package_id: str
    origin_url: str


def _get_stripe_key():
    """Secret key for Stripe API. Prefer STRIPE_SECRET_KEY; fallback STRIPE_API_KEY."""
    return os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")


async def _credit_payment_if_pending(db, session_id: str, user_id: str, package_id: str, points: int) -> dict:
    """
    Credit points only once per session (idempotent). Returns dict with status info.
    If store_points_auto_credit is false, marks paid sessions as manual_credit_pending (staff credits later).
    If preorder mode is active and auto-credit is on, stores points as preorder_pending instead of crediting.
    Use server-side points from POINT_PACKAGES only; do not trust client/metadata for amount.
    Logs points_before and points_after on the transaction for admin audit.
    """
    if not user_id or points <= 0:
        return {"credited": False, "preorder": False}
    
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    
    settings = await db.game_settings.find_one({"_id": "main"})
    auto_credit = settings.get("store_points_auto_credit") if settings else None
    if auto_credit is None:
        auto_credit = True
    manual_eta = settings.get("store_points_manual_credit_eta") if settings else None

    if auto_credit is False:
        result = await db.payment_transactions.update_one(
            {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending", "manual_credit_pending"]}},
            {"$set": {
                "payment_status": "manual_credit_pending",
                "preorder_points": points,
                "manual_credit_marked_at": now_iso,
            }},
        )
        if result.modified_count == 0:
            txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0, "payment_status": 1})
            return {
                "credited": False,
                "preorder": False,
                "manual_credit_pending": txn.get("payment_status") == "manual_credit_pending" if txn else False,
            }
        logger.info(
            "Payment manual credit pending: session_id=%s user_id=%s package_id=%s points=%s",
            session_id, user_id, package_id, points,
        )
        return {"credited": True, "preorder": False, "manual_credit_pending": True, "manual_credit_eta": manual_eta}

    # Preorder when auto-credit is on
    preorder_release_str = settings.get("preorder_points_release_date") if settings else None
    is_preorder = False
    if preorder_release_str:
        try:
            preorder_release = datetime.fromisoformat(preorder_release_str.replace("Z", "+00:00"))
            is_preorder = now < preorder_release
        except (ValueError, TypeError):
            pass
    
    if is_preorder:
        # Preorder mode: store as pending instead of crediting
        result = await db.payment_transactions.update_one(
            {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending", "manual_credit_pending"]}},
            {"$set": {
                "payment_status": "preorder_pending",
                "preorder_points": points,
                "preorder_release_date": preorder_release_str,
                "preorder_marked_at": now_iso,
            }},
        )
        if result.modified_count == 0:
            # Already processed
            txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0, "payment_status": 1})
            return {"credited": False, "preorder": txn.get("payment_status") == "preorder_pending" if txn else False}
        logger.info(
            "Payment preorder pending: session_id=%s user_id=%s package_id=%s points=%s release_date=%s",
            session_id, user_id, package_id, points, preorder_release_str,
        )
        return {"credited": True, "preorder": True, "preorder_release_date": preorder_release_str}
    
    # Normal mode: credit immediately
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1})
    points_before = int(user.get("points") or 0) if user else 0
    points_after = points_before + points
    result = await db.payment_transactions.update_one(
        {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending", "manual_credit_pending"]}},
        {"$set": {
            "payment_status": "completed",
            "points_credited_at": now_iso,
            "points_before": points_before,
            "points_after": points_after,
        }},
    )
    if result.modified_count == 0:
        return {"credited": False, "preorder": False}
    await db.users.update_one({"id": user_id}, {"$inc": {"points": points}})
    logger.info(
        "Payment credited: session_id=%s user_id=%s package_id=%s points_added=%s points_before=%s points_after=%s",
        session_id, user_id, package_id, points, points_before, points_after,
    )
    await send_notification(
        user_id,
        "Points Credited",
        f"Your purchase of {points:,} points has been credited to your account. Balance: {points_before:,} → {points_after:,} points.",
        "points_credited",
        category="system",
    )
    return {"credited": True, "preorder": False}


async def _credit_preorder_points(db, txn: dict) -> bool:
    """Credit preorder points that were held until release date."""
    session_id = txn.get("session_id")
    user_id = txn.get("user_id")
    points = txn.get("preorder_points") or txn.get("points", 0)
    package_id = txn.get("package_id", "")
    
    if not user_id or points <= 0:
        return False
    
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1})
    points_before = int(user.get("points") or 0) if user else 0
    points_after = points_before + points
    now_iso = datetime.now(timezone.utc).isoformat()
    
    result = await db.payment_transactions.update_one(
        {"session_id": session_id, "payment_status": "preorder_pending"},
        {"$set": {
            "payment_status": "completed",
            "points_credited_at": now_iso,
            "points_before": points_before,
            "points_after": points_after,
            "preorder_released_at": now_iso,
        }},
    )
    if result.modified_count == 0:
        return False
    await db.users.update_one({"id": user_id}, {"$inc": {"points": points}})
    logger.info(
        "Preorder points released: session_id=%s user_id=%s package_id=%s points=%s",
        session_id, user_id, package_id, points,
    )
    await send_notification(
        user_id,
        "Pre-Order Points Released",
        f"Your pre-order of {points:,} points has been credited to your account. Balance: {points_before:,} → {points_after:,} points.",
        "preorder_released",
        category="system",
    )
    return True


def register(router):
    """Register payment routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin
    POINT_PACKAGES = srv.POINT_PACKAGES

    @router.post("/payments/checkout")
    async def create_checkout(request: CheckoutRequest, current_user: dict = Depends(get_current_user)):
        # Enforce /store/points lock (buying points disabled)
        doc = await db.game_settings.find_one({"key": "page_locks"}, {"_id": 0, "value": 1})
        raw = (doc.get("value") or {}).get("paths") if doc else {}
        entry = raw.get("/store/points") if isinstance(raw, dict) else None
        if entry:
            msg = entry.get("message", "Points purchase is temporarily unavailable") if isinstance(entry, dict) else "Points purchase is temporarily unavailable"
            uat = entry.get("unlock_at") if isinstance(entry, dict) else None
            is_locked = True
            if uat:
                try:
                    until = datetime.fromisoformat(str(uat).replace("Z", "+00:00"))
                    if until.tzinfo is None:
                        until = until.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) >= until:
                        is_locked = False  # unlock_at passed
                except Exception:
                    pass
            if is_locked:
                raise HTTPException(status_code=503, detail=msg)

        api_key = _get_stripe_key()
        if not api_key:
            raise HTTPException(status_code=503, detail="Payments not configured (set STRIPE_SECRET_KEY)")

        if request.package_id not in POINT_PACKAGES:
            raise HTTPException(status_code=400, detail="Invalid package")

        package = POINT_PACKAGES[request.package_id]
        points = package["points"]
        price_gbp = package["price_gbp"]
        package_id = request.package_id
        # success_url: frontend sends origin_url like http://localhost:3000/store
        origin = (request.origin_url or "").rstrip("/")
        success_url = f"{origin}?session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = origin

        def _create():
            import stripe
            stripe.api_key = api_key
            session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                line_items=[{
                    "price_data": {
                        "currency": "gbp",
                        "unit_amount": int(round(price_gbp * 100)),
                        "product_data": {
                            "name": f"{points} points",
                            "metadata": {"package_id": package_id},
                        },
                    },
                    "quantity": 1,
                }],
                mode="payment",
                success_url=success_url,
                cancel_url=cancel_url,
                metadata={
                    "user_id": current_user["id"],
                    "package_id": package_id,
                    "points": str(points),
                },
            )
            return session

        try:
            session = await asyncio.to_thread(_create)
        except Exception as e:
            logger.exception("Stripe checkout create failed: %s", e)
            raise HTTPException(status_code=500, detail="Checkout failed")

        # Record pending transaction so status endpoint can fulfill
        await db.payment_transactions.insert_one({
            "session_id": session.id,
            "user_id": current_user["id"],
            "package_id": package_id,
            "points": points,
            "payment_status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        return {"url": session.url}

    @router.get("/payments/status/{session_id}")
    async def get_payment_status(session_id: str, current_user: dict = Depends(get_current_user)):
        transaction = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        if transaction and transaction["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Unauthorized")

        if transaction and transaction.get("payment_status") == "completed":
            return {"status": "completed", "payment_status": "paid", "points_added": transaction["points"]}
        
        if transaction and transaction.get("payment_status") == "manual_credit_pending":
            settings = await db.game_settings.find_one({"_id": "main"})
            eta = settings.get("store_points_manual_credit_eta") if settings else None
            return {
                "status": "manual_credit_pending",
                "payment_status": "paid",
                "points_added": transaction.get("preorder_points") or transaction.get("points", 0),
                "manual_credit_pending": True,
                "manual_credit_eta": eta,
            }

        if transaction and transaction.get("payment_status") == "preorder_pending":
            return {
                "status": "preorder_pending",
                "payment_status": "paid",
                "points_added": transaction.get("preorder_points") or transaction.get("points", 0),
                "preorder": True,
                "preorder_release_date": transaction.get("preorder_release_date"),
            }

        # If no transaction or still pending, check Stripe
        api_key = _get_stripe_key()
        if api_key:
            def _retrieve():
                import stripe
                stripe.api_key = api_key
                return stripe.checkout.Session.retrieve(session_id)

            try:
                session = await asyncio.to_thread(_retrieve)
            except Exception as e:
                logger.warning("Stripe session retrieve failed: %s", e)
                if not transaction:
                    raise HTTPException(status_code=404, detail="Transaction not found")
                return {"status": "pending", "payment_status": "unknown"}

            logger.info("Stripe session status: id=%s payment_status=%s status=%s", session_id, session.payment_status, session.status)
            
            if session.payment_status == "paid" and session.metadata:
                user_id = session.metadata.get("user_id")
                package_id = session.metadata.get("package_id") or (transaction or {}).get("package_id")
                if user_id != current_user["id"]:
                    raise HTTPException(status_code=403, detail="Unauthorized")
                # Always use server-side points to prevent exploit (never trust metadata amount)
                points = POINT_PACKAGES.get(package_id, {}).get("points", 0) if package_id else 0
                if not points and transaction:
                    points = transaction.get("points", 0)

                if not transaction:
                    await db.payment_transactions.insert_one({
                        "session_id": session_id,
                        "user_id": user_id,
                        "package_id": package_id or "",
                        "points": points,
                        "payment_status": "pending",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                credit_result = await _credit_payment_if_pending(db, session_id, user_id, package_id or "", points)
                if credit_result.get("credited"):
                    if credit_result.get("manual_credit_pending"):
                        return {
                            "status": "manual_credit_pending",
                            "payment_status": "paid",
                            "points_added": points,
                            "manual_credit_pending": True,
                            "manual_credit_eta": credit_result.get("manual_credit_eta"),
                        }
                    if credit_result.get("preorder"):
                        return {
                            "status": "preorder_pending",
                            "payment_status": "paid",
                            "points_added": points,
                            "preorder": True,
                            "preorder_release_date": credit_result.get("preorder_release_date"),
                        }
                    return {"status": "completed", "payment_status": "paid", "points_added": points}
                # Already completed or preorder pending (e.g. by webhook); return status with points
                t2 = await db.payment_transactions.find_one(
                    {"session_id": session_id},
                    {"_id": 0, "points": 1, "payment_status": 1, "preorder_release_date": 1, "preorder_points": 1},
                )
                if t2:
                    if t2.get("payment_status") == "completed":
                        return {"status": "completed", "payment_status": "paid", "points_added": t2.get("points", points)}
                    if t2.get("payment_status") == "manual_credit_pending":
                        settings = await db.game_settings.find_one({"_id": "main"})
                        eta = settings.get("store_points_manual_credit_eta") if settings else None
                        return {
                            "status": "manual_credit_pending",
                            "payment_status": "paid",
                            "points_added": t2.get("preorder_points") or t2.get("points", points),
                            "manual_credit_pending": True,
                            "manual_credit_eta": eta,
                        }
                    if t2.get("payment_status") == "preorder_pending":
                        return {
                            "status": "preorder_pending",
                            "payment_status": "paid",
                            "points_added": t2.get("preorder_points") or t2.get("points", points),
                            "preorder": True,
                            "preorder_release_date": t2.get("preorder_release_date"),
                        }

            if session.status == "expired":
                return {"status": "expired", "payment_status": "expired"}

        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return {"status": "pending", "payment_status": "unknown"}

    @router.post("/webhook/stripe")
    async def stripe_webhook(request: Request):
        api_key = _get_stripe_key()
        if not api_key:
            raise HTTPException(status_code=503, detail="Payments not configured")
        body = await request.body()
        sig = request.headers.get("stripe-signature", "")
        webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")

        def _construct():
            import stripe
            stripe.api_key = api_key
            return stripe.Webhook.construct_event(body, sig, webhook_secret) if webhook_secret else None

        try:
            event = await asyncio.to_thread(_construct) if webhook_secret else None
        except Exception as e:
            logger.warning("Stripe webhook signature verify failed: %s", e)
            raise HTTPException(status_code=400, detail="Invalid signature")

        if not event:
            raise HTTPException(status_code=503, detail="Webhook secret not set")

        if event.type == "checkout.session.completed":
            session = event.data.object
            if session.payment_status == "paid" and session.metadata:
                user_id = session.metadata.get("user_id")
                package_id = session.metadata.get("package_id")
                # Use server-side points only (never trust metadata for amount — prevents exploit)
                points = POINT_PACKAGES.get(package_id, {}).get("points", 0) if package_id else 0
                if not user_id or points <= 0:
                    logger.warning("Stripe webhook: missing user_id or invalid package_id, session_id=%s", session.id)
                else:
                    # Ensure we have a transaction row (status poll may not have run)
                    existing = await db.payment_transactions.find_one({"session_id": session.id}, {"_id": 1})
                    if not existing:
                        await db.payment_transactions.insert_one({
                            "session_id": session.id,
                            "user_id": user_id,
                            "package_id": package_id or "",
                            "points": points,
                            "payment_status": "pending",
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                    await _credit_payment_if_pending(db, session.id, user_id, package_id or "", points)

        return {"received": True}

    @router.get("/payments/my-transactions")
    async def my_payment_transactions(current_user: dict = Depends(get_current_user)):
        """List current user's payment transactions (for Store Payments section).
        Filters out old 'pending' transactions (abandoned checkouts) older than 30 minutes."""
        now = datetime.now(timezone.utc)
        thirty_mins_ago = (now - timedelta(minutes=30)).isoformat()
        
        # Only show: completed, preorder_pending, manual_credit_pending, or recent pending (last 30 min)
        cursor = db.payment_transactions.find(
            {
                "user_id": current_user["id"],
                "$or": [
                    {"payment_status": {"$in": ["completed", "preorder_pending", "manual_credit_pending"]}},
                    {"payment_status": "pending", "created_at": {"$gte": thirty_mins_ago}},
                ]
            },
            {"_id": 0, "session_id": 1, "package_id": 1, "points": 1, "payment_status": 1, "created_at": 1, "points_credited_at": 1},
        ).sort("created_at", -1).limit(50)
        items = await cursor.to_list(50)
        return {"transactions": items}

    @router.get("/payments/pending-points")
    async def get_pending_points(current_user: dict = Depends(get_current_user)):
        """Pending points: preorder (scheduled release) and/or manual_credit_pending (staff credit)."""
        settings = await db.game_settings.find_one({"_id": "main"})
        release_date = settings.get("preorder_points_release_date") if settings else None
        auto_credit = settings.get("store_points_auto_credit") if settings else None
        if auto_credit is None:
            auto_credit = True
        manual_eta = settings.get("store_points_manual_credit_eta") if settings else None

        preorder_txns = await db.payment_transactions.find(
            {"user_id": current_user["id"], "payment_status": "preorder_pending"},
            {"_id": 0, "preorder_points": 1, "points": 1, "preorder_release_date": 1},
        ).to_list(100)
        manual_txns = await db.payment_transactions.find(
            {"user_id": current_user["id"], "payment_status": "manual_credit_pending"},
            {"_id": 0, "preorder_points": 1, "points": 1},
        ).to_list(100)
        preorder_pts = sum(t.get("preorder_points") or t.get("points", 0) for t in preorder_txns)
        manual_pts = sum(t.get("preorder_points") or t.get("points", 0) for t in manual_txns)
        return {
            "pending_points": preorder_pts + manual_pts,
            "preorder_pending_points": preorder_pts,
            "manual_pending_points": manual_pts,
            "transaction_count": len(preorder_txns) + len(manual_txns),
            "release_date": release_date,
            "store_points_auto_credit": auto_credit,
            "manual_credit_eta": manual_eta,
        }

    @router.post("/payments/check-release")
    async def check_and_release_pending_points(current_user: dict = Depends(get_current_user)):
        """Check for stuck 'pending' transactions with Stripe, then release any preorder_pending points."""
        settings = await db.game_settings.find_one({"_id": "main"})
        release_date_str = settings.get("preorder_points_release_date") if settings else None
        now = datetime.now(timezone.utc)
        
        # Parse release date if set
        release_date = None
        preorder_active = False
        if release_date_str:
            try:
                release_date = datetime.fromisoformat(release_date_str.replace("Z", "+00:00"))
                preorder_active = now < release_date
            except (ValueError, TypeError):
                pass
        
        # First: check recent "pending" transactions with Stripe (only last 2 hours to avoid checking old abandoned ones)
        two_hours_ago = (now - timedelta(hours=2)).isoformat()
        stuck_pending = await db.payment_transactions.find(
            {"user_id": current_user["id"], "payment_status": "pending", "created_at": {"$gte": two_hours_ago}}
        ).to_list(100)
        
        processed_stuck = 0
        api_key = _get_stripe_key()
        if stuck_pending and api_key:
            for txn in stuck_pending:
                session_id = txn.get("session_id")
                if not session_id:
                    continue
                try:
                    def _retrieve():
                        import stripe
                        stripe.api_key = api_key
                        return stripe.checkout.Session.retrieve(session_id)
                    session = await asyncio.to_thread(_retrieve)
                    if session.payment_status == "paid":
                        user_id = txn.get("user_id")
                        package_id = txn.get("package_id", "")
                        points = txn.get("points", 0)
                        if user_id and points > 0:
                            result = await _credit_payment_if_pending(db, session_id, user_id, package_id, points)
                            if result.get("credited"):
                                processed_stuck += 1
                                logger.info("Processed stuck pending transaction: session_id=%s user_id=%s points=%s", session_id, user_id, points)
                except Exception as e:
                    logger.warning("Failed to check stuck transaction %s: %s", txn.get("session_id"), e)
        
        # If preorder is still active (release date in future), don't release preorder_pending yet
        if preorder_active:
            return {
                "released": 0,
                "processed_stuck": processed_stuck,
                "total_points": 0,
                "message": f"Processed {processed_stuck} stuck transaction(s). Release date has not passed yet." if processed_stuck else "Release date has not passed yet",
                "release_date": release_date_str,
            }
        
        # Now release any preorder_pending transactions
        pending_txns = await db.payment_transactions.find(
            {"user_id": current_user["id"], "payment_status": "preorder_pending"}
        ).to_list(100)
        
        released_count = 0
        total_points = 0
        for txn in pending_txns:
            if await _credit_preorder_points(db, txn):
                released_count += 1
                total_points += txn.get("preorder_points") or txn.get("points", 0)
        
        msg_parts = []
        if released_count:
            msg_parts.append(f"Released {total_points:,} points from {released_count} transaction(s)")
        if processed_stuck:
            msg_parts.append(f"Processed {processed_stuck} stuck transaction(s)")
        
        return {
            "released": released_count,
            "processed_stuck": processed_stuck,
            "total_points": total_points,
            "message": ". ".join(msg_parts) if msg_parts else "No pending points to release",
        }

    @router.post("/admin/payments/release-all-preorder")
    async def admin_release_all_preorder_points(current_user: dict = Depends(get_current_user)):
        """Admin only: Release all pending preorder points for all users (if release date has passed)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        
        settings = await db.game_settings.find_one({"_id": "main"})
        release_date_str = settings.get("preorder_points_release_date") if settings else None
        if not release_date_str:
            return {"released": 0, "message": "No preorder release date set"}
        
        now = datetime.now(timezone.utc)
        try:
            release_date = datetime.fromisoformat(release_date_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return {"released": 0, "message": "Invalid release date format"}
        
        if now < release_date:
            return {"released": 0, "message": "Release date has not passed yet", "release_date": release_date_str}
        
        pending_txns = await db.payment_transactions.find(
            {"payment_status": "preorder_pending"}
        ).to_list(10000)
        
        released_count = 0
        total_points = 0
        users_affected = set()
        for txn in pending_txns:
            if await _credit_preorder_points(db, txn):
                released_count += 1
                total_points += txn.get("preorder_points") or txn.get("points", 0)
                users_affected.add(txn.get("user_id"))
        
        logger.info(
            "Admin released all preorder points: %s transactions, %s points, %s users",
            released_count, total_points, len(users_affected),
        )
        return {
            "released": released_count,
            "total_points": total_points,
            "users_affected": len(users_affected),
            "message": f"Released {total_points:,} points from {released_count} transaction(s) for {len(users_affected)} user(s)" if released_count else "No pending preorder points to release",
        }

    @router.get("/admin/payments")
    async def admin_payment_log(current_user: dict = Depends(get_current_user)):
        """Admin only: list all payment transactions (donations) with username for audit."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cursor = db.payment_transactions.find(
            {},
            {"_id": 0, "session_id": 1, "user_id": 1, "package_id": 1, "points": 1, "payment_status": 1, "created_at": 1, "points_credited_at": 1, "points_before": 1, "points_after": 1, "preorder_points": 1},
        ).sort("created_at", -1).limit(500)
        items = await cursor.to_list(500)
        user_ids = list({t["user_id"] for t in items if t.get("user_id")})
        users = await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "username": 1},
        ).to_list(len(user_ids) + 1)
        by_id = {u["id"]: u.get("username", "?") for u in users}
        for t in items:
            t["username"] = by_id.get(t.get("user_id"), "?")
        return {"transactions": items}

    class ManualCreditRequest(BaseModel):
        session_id: str

    @router.post("/admin/payments/check-stripe-session")
    async def admin_check_stripe_session(body: ManualCreditRequest, current_user: dict = Depends(get_current_user)):
        """Admin only: Check a Stripe session status and process it if paid."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        
        api_key = _get_stripe_key()
        if not api_key:
            raise HTTPException(status_code=503, detail="Stripe API key not configured")
        
        def _retrieve():
            import stripe
            stripe.api_key = api_key
            return stripe.checkout.Session.retrieve(body.session_id)
        
        try:
            session = await asyncio.to_thread(_retrieve)
        except Exception as e:
            logger.exception("Admin Stripe session check failed: %s", e)
            raise HTTPException(status_code=400, detail="Failed to retrieve session. Please try again.")
        
        result = {
            "session_id": body.session_id,
            "stripe_status": session.status,
            "stripe_payment_status": session.payment_status,
            "metadata": dict(session.metadata) if session.metadata else {},
            "amount_total": session.amount_total,
            "currency": session.currency,
        }
        
        # Check our transaction record
        txn = await db.payment_transactions.find_one({"session_id": body.session_id}, {"_id": 0})
        result["our_transaction"] = txn
        
        # If Stripe shows paid but we haven't processed, process now
        if session.payment_status == "paid" and session.metadata:
            user_id = session.metadata.get("user_id")
            package_id = session.metadata.get("package_id")
            points = POINT_PACKAGES.get(package_id, {}).get("points", 0) if package_id else 0
            
            if not points and txn:
                points = txn.get("points", 0)
            
            if user_id and points > 0:
                # Ensure transaction exists
                if not txn:
                    await db.payment_transactions.insert_one({
                        "session_id": body.session_id,
                        "user_id": user_id,
                        "package_id": package_id or "",
                        "points": points,
                        "payment_status": "pending",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                
                credit_result = await _credit_payment_if_pending(db, body.session_id, user_id, package_id or "", points)
                result["credit_attempted"] = True
                result["credit_result"] = credit_result
                
                if credit_result.get("credited"):
                    if credit_result.get("manual_credit_pending"):
                        result["message"] = f"Successfully processed: {points} points held for manual staff credit"
                    else:
                        result["message"] = f"Successfully processed: {points} points {'held for preorder' if credit_result.get('preorder') else 'credited'}"
                else:
                    result["message"] = "Already processed or failed to credit"
            else:
                result["message"] = "Missing user_id or points in metadata"
        else:
            result["message"] = f"Stripe payment_status is '{session.payment_status}', not 'paid'"
        
        return result

    @router.post("/admin/payments/manual-credit")
    async def admin_manual_credit_transaction(body: ManualCreditRequest, current_user: dict = Depends(get_current_user)):
        """Admin only: Manually credit a non-completed paid transaction.
        Works for pending, preorder_pending, and manual_credit_pending."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        
        now_iso = datetime.now(timezone.utc).isoformat()
        txn = await db.payment_transactions.find_one_and_update(
            {"session_id": body.session_id, "payment_status": {"$ne": "completed"}},
            {"$set": {
                "payment_status": "completed",
                "points_credited_at": now_iso,
                "manual_credit_by": current_user.get("username"),
                "manual_credit_at": now_iso,
            }},
        )
        if not txn:
            existing = await db.payment_transactions.find_one({"session_id": body.session_id})
            if not existing:
                raise HTTPException(status_code=404, detail="Transaction not found")
            return {"message": "Transaction already completed", "credited": False}
        
        user_id = txn.get("user_id")
        package_id = txn.get("package_id")
        points = txn.get("preorder_points") or txn.get("points") or POINT_PACKAGES.get(package_id, {}).get("points", 0)
        
        if not user_id or points <= 0:
            raise HTTPException(status_code=400, detail="Invalid transaction: missing user_id or points")
        
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1, "username": 1})
        points_before = int(user.get("points") or 0) if user else 0
        points_after = points_before + points
        
        await db.payment_transactions.update_one(
            {"session_id": body.session_id},
            {"$set": {
                "points_before": points_before,
                "points_after": points_after,
            }},
        )
        await db.users.update_one({"id": user_id}, {"$inc": {"points": points}})
        
        logger.info(
            "Admin manual credit: session_id=%s user_id=%s points=%s by=%s",
            body.session_id, user_id, points, current_user.get("username"),
        )
        await send_notification(
            user_id,
            "Points Credited",
            f"Your purchase of {points:,} points has been credited. Balance: {points_before:,} → {points_after:,} points.",
            "points_credited",
            category="system",
        )
        
        return {
            "message": f"Credited {points:,} points to {user.get('username', 'user')}",
            "credited": True,
            "points": points,
            "username": user.get("username"),
        }
