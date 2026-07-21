"""Quick Trade-derived $/point for store cash purchases (tokens + points)."""
from __future__ import annotations

QT_CASH_AVG_SELL_OFFER_COUNT = 3


async def qt_cash_price_per_point(
    db,
    *,
    min_price_per_point: float,
    fallback_price_per_point: float | None = None,
) -> tuple[bool, float, int]:
    """
    Return (available, price_per_point, offers_used_in_avg).

    Price = max(min_price_per_point, mean(cheapest 3 $/pt rates)) when at least 3 valid
    active sell offers exist; otherwise the fallback default (or the floor when no
    fallback is given).
    """
    floor = float(min_price_per_point or 0)
    if floor <= 0:
        floor = 1.0
    fallback = max(floor, float(fallback_price_per_point or 0))
    try:
        offers = await db.trade_sell_offers.find({"status": "active"}).to_list(500)
    except Exception:
        return True, fallback, 0
    rates = []
    for o in offers:
        pts = int(o.get("points") or 0)
        cost = int(o.get("cost") or 0)
        if pts > 0 and cost > 0:
            rates.append(cost / pts)
    rates.sort()
    top = rates[:QT_CASH_AVG_SELL_OFFER_COUNT]
    if len(top) >= QT_CASH_AVG_SELL_OFFER_COUNT:
        avg = sum(top) / QT_CASH_AVG_SELL_OFFER_COUNT
        return True, max(floor, avg), QT_CASH_AVG_SELL_OFFER_COUNT
    return True, fallback, len(top)
