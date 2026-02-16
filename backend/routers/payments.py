# Payments: checkout, status, Stripe webhook (routes kept so frontend does not 404; currently 503)
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel


class CheckoutRequest(BaseModel):
    package_id: str
    origin_url: str


def register(router):
    """Register payment routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user

    @router.post("/payments/checkout")
    async def create_checkout(request: CheckoutRequest, current_user: dict = Depends(get_current_user)):
        raise HTTPException(status_code=503, detail="Payments not available")

    @router.get("/payments/status/{session_id}")
    async def get_payment_status(session_id: str, current_user: dict = Depends(get_current_user)):
        transaction = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if transaction["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Unauthorized")
        if transaction["payment_status"] == "completed":
            return {"status": "completed", "payment_status": "paid", "points_added": transaction["points"]}
        return {"status": "pending", "payment_status": "unknown"}

    @router.post("/webhook/stripe")
    async def stripe_webhook(request: Request):
        raise HTTPException(status_code=503, detail="Payments not available")
