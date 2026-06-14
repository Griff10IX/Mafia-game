"""Global car dealership ownership (Buy Cars dealer + marketplace fee share)."""
from typing import Any, Dict, Optional

GARAGE_DEALERSHIP_ID = "main"
GARAGE_DEALERSHIP_CLAIM_COST_POINTS = 10_000
DEALER_OWNER_PROFIT_SHARE = 0.90
P2P_OWNER_PROFIT_SHARE = 0.10
DEALER_OWNER_STOCK_FEE_RATE = 0.25
DEALER_OWNER_STOCK_MAX_PER_MODEL = 100
DEALER_OWNER_STOCK_DEFAULT_TARGET = 100
DEALER_OWNER_STOCKABLE_RARITIES = ("common", "uncommon", "rare", "ultra_rare", "legendary")


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


def dealership_auto_stock_defaults() -> Dict[str, Any]:
    return {
        "auto_stock_enabled": False,
        "auto_stock_rarity": None,
        "auto_stock_target": DEALER_OWNER_STOCK_DEFAULT_TARGET,
    }


async def debit_garage_dealership_profit(db, amount: int) -> bool:
    """Atomically pay a stocking fee from pending dealership profit. Returns False if insufficient."""
    amt = int(amount or 0)
    if amt <= 0:
        return True
    doc = await db.garage_dealership.find_one_and_update(
        {"id": GARAGE_DEALERSHIP_ID, "owner_pending_profit": {"$gte": amt}},
        {"$inc": {"owner_pending_profit": -amt}},
        projection={"_id": 1},
    )
    return bool(doc)


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


async def cancel_garage_dealership_quicktrade_listings(db) -> int:
    """Remove active Quick Trade rows for the global car dealership."""
    res = await db.properties.delete_many({"for_sale": True, "type": "garage_dealership"})
    return int(res.deleted_count or 0)
