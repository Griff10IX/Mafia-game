"""AI picture credits bought from a Mafia Wars account.

The balance lives on the Mafia user. Stripe must report the session paid, in GBP,
for the exact pack price, before any credits are added. The same session cannot
add credits twice. No PixGB user is created.

Checkout uses the game Stripe key (the account PixGB already charges) and that
pack's existing Stripe price when one is on the account. Session metadata does
not set payment_type=ai_credits, so PixGB's own webhook ignores the session.
"""
from __future__ import annotations

import base64
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import HTTPException
from pymongo import ReturnDocument

logger = logging.getLogger(__name__)

PAYMENT_KIND = "ai_image_credits"
OPENAI_URL = "https://api.openai.com/v1/images/generations"

PACKS = {
    "ai_credit_trial": {
        "id": "ai_credit_trial",
        "stripe_pack_id": "trial",
        "name": "Try",
        "credits": 180,
        "amount_minor": 249,
        "label": "£2.49",
    },
    "ai_credit_starter": {
        "id": "ai_credit_starter",
        "stripe_pack_id": "starter",
        "name": "Starter",
        "credits": 500,
        "amount_minor": 599,
        "label": "£5.99",
    },
    "ai_credit_creator": {
        "id": "ai_credit_creator",
        "stripe_pack_id": "creator",
        "name": "Creator",
        "credits": 1600,
        "amount_minor": 1799,
        "label": "£17.99",
    },
    "ai_credit_power": {
        "id": "ai_credit_power",
        "stripe_pack_id": "power",
        "name": "Power",
        "credits": 3300,
        "amount_minor": 3599,
        "label": "£35.99",
    },
}

MODELS = {
    "flare": {
        "id": "flare",
        "name": "Flare",
        "api_model": "gpt-image-2.5-flare",
        "quality": "medium",
        "cost": 3,
    },
    "sunburst": {
        "id": "sunburst",
        "name": "Sunburst",
        "api_model": "gpt-image-2.5-sunburst",
        "quality": "high",
        "cost": 8,
    },
    "ultra": {
        "id": "ultra",
        "name": "Sunburst Ultra",
        "api_model": "gpt-image-2.5-sunburst",
        "quality": "xhigh",
        "cost": 15,
    },
}

SIZES = ("1024x1024", "1536x1024", "1024x1536")

_price_ids: dict[str, str] = {}


def is_ai_credit_package(package_id: Optional[str]) -> bool:
    return (package_id or "") in PACKS


def public_catalog() -> dict:
    return {
        "packs": [
            {"id": p["id"], "name": p["name"], "credits": p["credits"], "label": p["label"]}
            for p in PACKS.values()
        ],
        "models": [
            {"id": m["id"], "name": m["name"], "cost": m["cost"]}
            for m in MODELS.values()
        ],
        "sizes": list(SIZES),
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _meta(session, key: str) -> str:
    metadata = getattr(session, "metadata", None) or {}
    try:
        value = metadata.get(key)
    except Exception:
        value = None
    return str(value or "").strip()


def stripe_api_key() -> str:
    # Same key the /webhook/stripe handler verifies. PixGB charges this shared account.
    return (os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY") or "").strip()


def _price_matches(price, amount_minor: int) -> bool:
    try:
        return str(getattr(price, "currency", "") or "").lower() == "gbp" and int(price.unit_amount) == int(amount_minor)
    except (TypeError, ValueError):
        return False


def _find_existing_price_id(stripe, pack: dict) -> str:
    """Use the pack's existing PixGB Stripe price. Empty string if it is not on this account."""
    stripe_pack_id = pack["stripe_pack_id"]
    cached = _price_ids.get(stripe_pack_id)
    if cached:
        return cached
    env_id = (os.environ.get(f"AI_CREDIT_PRICE_{stripe_pack_id.upper()}") or "").strip()
    if env_id:
        _price_ids[stripe_pack_id] = env_id
        return env_id
    try:
        found = stripe.Price.search(
            query=(
                "active:'true' AND metadata['product_type']:'ai_credits' "
                f"AND metadata['pack_id']:'{stripe_pack_id}'"
            ),
            limit=5,
        )
        for price in getattr(found, "data", []) or []:
            if _price_matches(price, pack["amount_minor"]):
                _price_ids[stripe_pack_id] = price.id
                return price.id
    except Exception:
        logger.warning("AI credit price search failed for pack=%s", stripe_pack_id)
    try:
        products = stripe.Product.list(active=True, limit=100)
        for product in getattr(products, "data", []) or []:
            md = getattr(product, "metadata", None) or {}
            if (md.get("product_type") or "") != "ai_credits":
                continue
            if (md.get("pack_id") or "") != stripe_pack_id:
                continue
            prices = stripe.Price.list(product=product.id, active=True, limit=10)
            for price in getattr(prices, "data", []) or []:
                if _price_matches(price, pack["amount_minor"]):
                    _price_ids[stripe_pack_id] = price.id
                    return price.id
    except Exception:
        logger.warning("AI credit product list failed for pack=%s", stripe_pack_id)
    return ""


async def balance_of(db, user_id: str) -> int:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "ai_image_credits": 1})
    try:
        return max(0, int((user or {}).get("ai_image_credits") or 0))
    except (TypeError, ValueError):
        return 0


async def create_checkout(db, user: dict, pack_id: str, origin_url: str) -> str:
    pack = PACKS.get((pack_id or "").strip())
    if not pack:
        raise HTTPException(status_code=400, detail="Unknown credit pack")
    api_key = stripe_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="Payments not configured")
    origin = (origin_url or "").rstrip("/")
    if not origin.startswith("http"):
        raise HTTPException(status_code=400, detail="Missing return address")

    def _create():
        import stripe

        stripe.api_key = api_key
        price_id = _find_existing_price_id(stripe, pack)
        if price_id:
            line = {"quantity": 1, "price": price_id}
        else:
            line = {
                "quantity": 1,
                "price_data": {
                    "currency": "gbp",
                    "unit_amount": pack["amount_minor"],
                    "product_data": {
                        "name": f"Picture credits · {pack['name']} ({pack['credits']})",
                    },
                },
            }
        params = {
            "mode": "payment",
            "line_items": [line],
            "success_url": f"{origin}?session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": f"{origin}?payment_cancel=1",
            "metadata": {
                "user_id": user["id"],
                "package_id": pack["id"],
                "points": "0",
                "payment_kind": PAYMENT_KIND,
                "ai_credits": str(pack["credits"]),
                "expected_amount_minor": str(pack["amount_minor"]),
                "source": "mafia_wars",
            },
        }
        email = (user.get("email") or "").strip()
        if email:
            params["customer_email"] = email
        return stripe.checkout.Session.create(**params)

    import asyncio

    session = await asyncio.to_thread(_create)
    await db.payment_transactions.insert_one(
        {
            "session_id": session.id,
            "user_id": user["id"],
            "package_id": pack["id"],
            "points": 0,
            "ai_credits": pack["credits"],
            "expected_amount_minor": pack["amount_minor"],
            "payment_kind": PAYMENT_KIND,
            "payment_status": "pending",
            "created_at": _now(),
        }
    )
    return session.url


async def fulfill_ai_credit_session(db, session) -> dict:
    """Add pack credits once, only when Stripe says paid and the pence match."""
    if _meta(session, "payment_kind") != PAYMENT_KIND:
        return {"credited": False, "reason": "not_ai"}
    if getattr(session, "payment_status", None) != "paid":
        return {"credited": False, "reason": "unpaid"}

    user_id = _meta(session, "user_id")
    pack = PACKS.get(_meta(session, "package_id"))
    session_id = getattr(session, "id", None)
    if not user_id or not pack or not session_id:
        return {"credited": False, "reason": "bad_meta"}

    try:
        amount = int(getattr(session, "amount_total", None))
    except (TypeError, ValueError):
        amount = -1
    currency = str(getattr(session, "currency", None) or "").lower()
    if currency != "gbp" or amount != pack["amount_minor"]:
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {
                "$set": {
                    "payment_status": "fulfillment_blocked",
                    "fulfillment_blocked_at": _now(),
                    "fulfillment_blocked_detail": "Stripe amount did not match the picture-credit pack",
                    "stripe_amount_total_minor": amount,
                    "stripe_currency": currency or None,
                }
            },
        )
        logger.warning(
            "AI credit amount mismatch session=%s amount=%s currency=%s pack=%s",
            session_id,
            amount,
            currency,
            pack["id"],
        )
        return {"credited": False, "reason": "amount_mismatch"}

    existing = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 1})
    if not existing:
        await db.payment_transactions.insert_one(
            {
                "session_id": session_id,
                "user_id": user_id,
                "package_id": pack["id"],
                "points": 0,
                "ai_credits": pack["credits"],
                "expected_amount_minor": pack["amount_minor"],
                "payment_kind": PAYMENT_KIND,
                "payment_status": "pending",
                "created_at": _now(),
            }
        )

    claimed = await db.payment_transactions.update_one(
        {"session_id": session_id, "payment_status": {"$nin": ["completed", "fulfillment_blocked"]}},
        {
            "$set": {
                "payment_status": "completed",
                "points_credited_at": _now(),
                "ai_credits": pack["credits"],
                "stripe_amount_total_minor": amount,
                "stripe_currency": currency,
            }
        },
    )
    if claimed.modified_count != 1:
        done = await db.payment_transactions.find_one(
            {"session_id": session_id, "payment_status": "completed"},
            {"_id": 0, "ai_credits": 1},
        )
        if done:
            return {
                "credited": False,
                "already": True,
                "credits": int(done.get("ai_credits") or pack["credits"]),
                "balance": await balance_of(db, user_id),
            }
        return {"credited": False, "reason": "not_claimed"}

    try:
        updated = await db.users.find_one_and_update(
            {"id": user_id},
            {"$inc": {"ai_image_credits": pack["credits"]}},
            return_document=ReturnDocument.AFTER,
        )
    except Exception:
        await db.payment_transactions.update_one(
            {"session_id": session_id, "payment_status": "completed"},
            {"$set": {"payment_status": "pending"}},
        )
        raise
    balance = int((updated or {}).get("ai_image_credits") or 0)
    await db.ai_image_credit_ledger.insert_one(
        {
            "user_id": user_id,
            "kind": "purchase",
            "amount": pack["credits"],
            "balance_after": balance,
            "session_id": session_id,
            "package_id": pack["id"],
            "created_at": _now(),
        }
    )
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {"credits_after": balance}},
    )
    logger.info("AI credits granted pack=%s credits=%s", pack["id"], pack["credits"])
    return {"credited": True, "already": False, "credits": pack["credits"], "balance": balance}


async def generate_image_bytes(prompt: str, model_id: str, size: str) -> tuple[bytes, str]:
    model = MODELS.get(model_id or "")
    if not model:
        raise HTTPException(status_code=400, detail="Unknown picture quality")
    if size not in SIZES:
        raise HTTPException(status_code=400, detail="Unknown picture size")
    text = (prompt or "").strip()
    if len(text) < 3 or len(text) > 2000:
        raise HTTPException(status_code=400, detail="Describe the picture in 3 to 2000 characters")
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Picture maker is not configured")

    payload = {
        "model": model["api_model"],
        "prompt": text,
        "n": 1,
        "size": size,
        "quality": model["quality"],
        "output_format": "png",
    }
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(
                OPENAI_URL,
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
                json=payload,
            )
    except httpx.HTTPError as exc:
        logger.warning("OpenAI image request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Picture maker is unavailable") from exc

    if response.status_code != 200:
        logger.warning("OpenAI image status=%s", response.status_code)
        if response.status_code in (401, 403):
            raise HTTPException(status_code=503, detail="Picture maker is not configured")
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Picture maker is busy. Try again shortly.")
        raise HTTPException(status_code=400, detail="That picture could not be made")

    try:
        data = response.json()
        raw = base64.b64decode(data["data"][0]["b64_json"])
    except Exception as exc:
        logger.warning("OpenAI image body unusable: %s", exc)
        raise HTTPException(status_code=502, detail="Picture maker returned nothing usable") from exc
    if not raw:
        raise HTTPException(status_code=502, detail="Picture maker returned nothing usable")
    return raw, "image/png"


async def reserve_credits(db, user_id: str, cost: int) -> None:
    result = await db.users.update_one(
        {"id": user_id, "ai_image_credits": {"$gte": int(cost)}},
        {"$inc": {"ai_image_credits": -int(cost)}},
    )
    if result.modified_count != 1:
        raise HTTPException(status_code=402, detail="Not enough picture credits")


async def refund_credits(db, user_id: str, cost: int, reason: str) -> int:
    updated = await db.users.find_one_and_update(
        {"id": user_id},
        {"$inc": {"ai_image_credits": int(cost)}},
        return_document=ReturnDocument.AFTER,
    )
    balance = int((updated or {}).get("ai_image_credits") or 0)
    await db.ai_image_credit_ledger.insert_one(
        {
            "user_id": user_id,
            "kind": "refund",
            "amount": int(cost),
            "balance_after": balance,
            "reason": (reason or "")[:200],
            "created_at": _now(),
        }
    )
    return balance


async def record_spend(db, user_id: str, cost: int, model_id: str) -> None:
    balance = await balance_of(db, user_id)
    await db.ai_image_credit_ledger.insert_one(
        {
            "user_id": user_id,
            "kind": "spend",
            "amount": int(cost),
            "balance_after": balance,
            "model_id": model_id,
            "created_at": _now(),
        }
    )


async def attach_admin_credit_fields(db, items: list) -> None:
    rows = [t for t in items if is_ai_credit_package(t.get("package_id"))]
    if not rows:
        return
    user_ids = list({t.get("user_id") for t in rows if t.get("user_id")})
    balances: dict[str, int] = {}
    if user_ids:
        async for user in db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "ai_image_credits": 1},
        ):
            balances[user["id"]] = int(user.get("ai_image_credits") or 0)
    spent: dict[str, int] = {}
    if user_ids:
        pipeline = [
            {"$match": {"user_id": {"$in": user_ids}, "kind": {"$in": ["spend", "refund"]}}},
            {
                "$group": {
                    "_id": "$user_id",
                    "spent": {
                        "$sum": {
                            "$cond": [
                                {"$eq": ["$kind", "spend"]},
                                "$amount",
                                {"$multiply": ["$amount", -1]},
                            ]
                        }
                    },
                }
            },
        ]
        async for row in db.ai_image_credit_ledger.aggregate(pipeline):
            spent[row["_id"]] = int(row.get("spent") or 0)
    for row in rows:
        pack = PACKS.get(row.get("package_id") or "")
        added = int(row.get("ai_credits") or (pack["credits"] if pack else 0))
        row["ai_credits"] = added
        row["credits_left"] = balances.get(row.get("user_id"))
        row["credits_spent"] = max(0, spent.get(row.get("user_id"), 0))
        if pack:
            row["package_label"] = f"AI picture credits · {pack['name']} ({pack['credits']})"
