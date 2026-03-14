# Payments: Stripe Checkout (redirect), status, webhook. Idempotent credit to prevent double-credit exploit.
import os
import asyncio
import logging
from datetime import datetime, timezone

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
    If preorder mode is active, stores points as pending instead of crediting.
    Use server-side points from POINT_PACKAGES only; do not trust client/metadata for amount.
    Logs points_before and points_after on the transaction for admin audit.
    """
    if not user_id or points <= 0:
        return {"credited": False, "preorder": False}
    
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    
    # Check for preorder mode
    settings = await db.game_settings.find_one({"_id": "main"})
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
            {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending"]}},
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
        {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending"]}},
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
                t2 = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0, "points": 1, "payment_status": 1, "preorder_release_date": 1})
                if t2:
                    if t2.get("payment_status") == "completed":
                        return {"status": "completed", "payment_status": "paid", "points_added": t2.get("points", points)}
                    if t2.get("payment_status") == "preorder_pending":
                        return {
                            "status": "preorder_pending",
                            "payment_status": "paid",
                            "points_added": t2.get("points", points),
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
        """List current user's payment transactions (for Store Payments section)."""
        cursor = db.payment_transactions.find(
            {"user_id": current_user["id"]},
            {"_id": 0, "session_id": 1, "package_id": 1, "points": 1, "payment_status": 1, "created_at": 1, "points_credited_at": 1},
        ).sort("created_at", -1).limit(50)
        items = await cursor.to_list(50)
        return {"transactions": items}

    @router.get("/payments/pending-points")
    async def get_pending_points(current_user: dict = Depends(get_current_user)):
        """Get user's pending preorder points that will be credited on release date."""
        pending_txns = await db.payment_transactions.find(
            {"user_id": current_user["id"], "payment_status": "preorder_pending"},
            {"_id": 0, "preorder_points": 1, "points": 1, "preorder_release_date": 1},
        ).to_list(100)
        total_pending = sum(t.get("preorder_points") or t.get("points", 0) for t in pending_txns)
        settings = await db.game_settings.find_one({"_id": "main"})
        release_date = settings.get("preorder_points_release_date") if settings else None
        return {
            "pending_points": total_pending,
            "transaction_count": len(pending_txns),
            "release_date": release_date,
        }

    @router.get("/admin/payments")
    async def admin_payment_log(current_user: dict = Depends(get_current_user)):
        """Admin only: list all payment transactions (donations) with username for audit."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cursor = db.payment_transactions.find(
            {},
            {"_id": 0, "session_id": 1, "user_id": 1, "package_id": 1, "points": 1, "payment_status": 1, "created_at": 1, "points_credited_at": 1, "points_before": 1, "points_after": 1},
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
