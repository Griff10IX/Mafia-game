# Lazy imports inside the coroutine avoid server <-> dice <-> quicktrade cycles at startup.
from typing import Optional


async def ensure_no_duplicate_casino_quicktrade_listing(
    prop_type: str,
    location: str,
    owner_id: str,
) -> None:
    """Casino sell-on-trade inserts a `properties` row; without this, the same owner can stack multiple listings (same name, different prices)."""
    pt = (prop_type or "").strip()
    loc = (location or "").strip()
    oid = str(owner_id or "").strip()
    if not pt or not loc or not oid:
        return
    from fastapi import HTTPException
    from server import db

    existing = await db.properties.find_one(
        {"for_sale": True, "type": pt, "location": loc, "owner_id": oid},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail="This venue is already listed on Quick Trade. Cancel the listing first.",
        )


async def cancel_quicktrade_casino_listings_by_locations(prop_type: str, *location_variants: Optional[str]) -> int:
    """Remove active Quick Trade rows for a casino slot when ownership changes outside the marketplace."""
    locs = {str(v).strip() for v in location_variants if v and str(v).strip()}
    pt = (prop_type or "").strip()
    if not locs or not pt:
        return 0
    from server import db
    from routers.money import quicktrade as _qt

    res = await db.properties.delete_many({"for_sale": True, "type": pt, "location": {"$in": list(locs)}})
    if res.deleted_count:
        _qt._invalidate_trade_caches()
    return int(res.deleted_count)
