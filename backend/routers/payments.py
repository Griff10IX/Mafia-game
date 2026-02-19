# Payments: Stripe Checkout (redirect), status, webhook
import os
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class CheckoutRequest(BaseModel):
    package_id: str
    origin_url: str


def _get_stripe_key():
    """Secret key for Stripe API. Prefer STRIPE_SECRET_KEY; fallback STRIPE_API_KEY."""
    return os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")


def register(router):
    """Register payment routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    POINT_PACKAGES = srv.POINT_PACKAGES

    @router.post("/payments/checkout")
    async def create_checkout(request: CheckoutRequest, current_user: dict = Depends(get_current_user)):
        api_key = _get_stripe_key()
        if not api_key:
            raise HTTPException(status_code=503, detail="Payments not configured (set STRIPE_SECRET_KEY)")

        if request.package_id not in POINT_PACKAGES:
            raise HTTPException(status_code=400, detail="Invalid package")

        package = POINT_PACKAGES[request.package_id]
        points = package["points"]
        price_usd = package["price"]
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
                        "currency": "usd",
                        "unit_amount": int(round(price_usd * 100)),
                        "product_data": {
                            "name": f"{points} points",
                            "metadata": {"package_id": request.package_id},
                        },
                    },
                    "quantity": 1,
                }],
                mode="payment",
                success_url=success_url,
                cancel_url=cancel_url,
                metadata={
                    "user_id": current_user["id"],
                    "package_id": request.package_id,
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
            "package_id": request.package_id,
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
                package_id = session.metadata.get("package_id")
                if user_id != current_user["id"]:
                    raise HTTPException(status_code=403, detail="Unauthorized")
                points = POINT_PACKAGES.get(package_id, {}).get("points", 0) if package_id else (transaction or {}).get("points", 0)

                if transaction and transaction.get("payment_status") != "completed":
                    await db.payment_transactions.update_one(
                        {"session_id": session_id},
                        {"$set": {"payment_status": "completed"}},
                    )
                    await db.users.update_one({"id": user_id}, {"$inc": {"points": points}})
                    return {"status": "completed", "payment_status": "paid", "points_added": points}

                if not transaction:
                    await db.payment_transactions.insert_one({
                        "session_id": session_id,
                        "user_id": user_id,
                        "package_id": package_id or "",
                        "points": points,
                        "payment_status": "completed",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                    await db.users.update_one({"id": user_id}, {"$inc": {"points": points}})
                    return {"status": "completed", "payment_status": "paid", "points_added": points}

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
                points = POINT_PACKAGES.get(package_id, {}).get("points", 0)
                await db.payment_transactions.update_one(
                    {"session_id": session.id},
                    {"$set": {"payment_status": "completed"}},
                )
                await db.users.update_one({"id": user_id}, {"$inc": {"points": points}})

        return {"received": True}
