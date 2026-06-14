"""Global car dealership ownership (Buy Cars dealer + marketplace fee share)."""
from typing import Any, Dict, Optional

GARAGE_DEALERSHIP_ID = "main"
GARAGE_DEALERSHIP_CLAIM_COST_POINTS = 10_000
DEALER_OWNER_PROFIT_SHARE = 0.90
P2P_OWNER_PROFIT_SHARE = 0.10


def dealership_sale_profit(sale_price: int, catalog_value: int) -> int:
    """Markup over catalog value treated as profit for owner revenue splits."""
    return max(0, int(sale_price or 0) - int(catalog_value or 0))


def dealer_owner_profit_cut(profit: int) -> int:
    return int(profit * DEALER_OWNER_PROFIT_SHARE)


def p2p_owner_profit_cut(profit: int) -> int:
    return int(profit * P2P_OWNER_PROFIT_SHARE)


async def get_garage_dealership(db) -> Dict[str, Any]:
    doc = await db.garage_dealership.find_one({"id": GARAGE_DEALERSHIP_ID}, {"_id": 0})
    if doc:
        return doc
    doc = {
        "id": GARAGE_DEALERSHIP_ID,
        "owner_id": None,
        "owner_username": None,
        "owner_pending_profit": 0,
    }
    await db.garage_dealership.insert_one(dict(doc))
    return doc


async def credit_garage_dealership_profit(db, amount: int) -> None:
    amt = int(amount or 0)
    if amt <= 0:
        return
    await get_garage_dealership(db)
    await db.garage_dealership.update_one(
        {"id": GARAGE_DEALERSHIP_ID},
        {"$inc": {"owner_pending_profit": amt}},
    )


async def user_owns_garage_dealership(db, user_id: str) -> Optional[Dict[str, Any]]:
    uid = (user_id or "").strip()
    if not uid:
        return None
    doc = await db.garage_dealership.find_one({"owner_id": uid}, {"_id": 0, "owner_pending_profit": 1})
    if not doc:
        return None
    return {
        "type": "garage_dealership",
        "owner_pending_profit": int(doc.get("owner_pending_profit") or 0),
    }
