"""
Piecewise-linear GBP pricing for custom point purchases between POINT_PACKAGES tiers.
Lazy-imports server.POINT_PACKAGES to avoid import cycles at module load.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional, Tuple

CUSTOM_POINTS_PACKAGE_ID = "custom"

# Match smallest / largest fixed point packs (mini / legend).
CUSTOM_POINTS_MIN = 1_000
CUSTOM_POINTS_MAX = 200_000

_RANK_PASS_ID = "rank_xp_pass_499"


def _sorted_knots() -> List[Tuple[int, float]]:
    import server as srv  # noqa: PLC0415 — lazy to avoid circular import

    tiers: List[Tuple[int, float]] = []
    for _pid, v in (srv.POINT_PACKAGES or {}).items():
        if _pid == _RANK_PASS_ID:
            continue
        pts = int(v.get("points") or 0)
        gbp = float(v.get("price_gbp") or 0)
        if pts <= 0 or gbp < 0:
            continue
        tiers.append((pts, gbp))
    tiers.sort(key=lambda x: x[0])
    return tiers


def price_gbp_for_points(points: int) -> float:
    """GBP price for an integer point amount (piecewise linear between tier knots)."""
    p = int(points)
    if p < CUSTOM_POINTS_MIN:
        p = CUSTOM_POINTS_MIN
    if p > CUSTOM_POINTS_MAX:
        p = CUSTOM_POINTS_MAX
    knots = _sorted_knots()
    if not knots:
        raise RuntimeError("POINT_PACKAGES has no point tiers")
    if p <= knots[0][0]:
        return float(knots[0][1])
    for i in range(len(knots) - 1):
        p0, g0 = knots[i]
        p1, g1 = knots[i + 1]
        if p0 <= p <= p1:
            if p1 == p0:
                return float(g0)
            t = (p - p0) / (p1 - p0)
            return float(g0 + t * (g1 - g0))
    return float(knots[-1][1])


def gbp_to_minor_pence(price_gbp: float) -> int:
    """Stripe-compatible minor units (pence); half-up rounding."""
    d = Decimal(str(price_gbp)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def minor_pence_to_gbp_display(minor: int) -> float:
    return round(int(minor) / 100.0, 2)


def points_and_price_for_gbp_budget(budget_gbp: float) -> Tuple[int, float]:
    """
    Largest integer points in [CUSTOM_POINTS_MIN, CUSTOM_POINTS_MAX] such that
    price_gbp_for_points(points) <= budget_gbp (player never pays more than budget).
    Returns (points, actual_price_gbp) where actual_price is price_gbp_for_points(points).
    """
    b = float(budget_gbp)
    min_price = price_gbp_for_points(CUSTOM_POINTS_MIN)
    if b < min_price - 1e-9:
        return (0, 0.0)
    cap_price = price_gbp_for_points(CUSTOM_POINTS_MAX)
    if b >= cap_price - 1e-9:
        return (CUSTOM_POINTS_MAX, cap_price)

    lo, hi = CUSTOM_POINTS_MIN, CUSTOM_POINTS_MAX
    best = CUSTOM_POINTS_MIN
    while lo <= hi:
        mid = (lo + hi) // 2
        pr = price_gbp_for_points(mid)
        if pr <= b + 1e-9:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return (best, price_gbp_for_points(best))


def validate_custom_points_input(points) -> Optional[str]:
    """Return error message or None if OK."""
    if isinstance(points, bool):
        return "Points must be a whole number"
    if isinstance(points, float) and not points.is_integer():
        return "Points must be a whole number"
    try:
        p = int(points)
    except (TypeError, ValueError):
        return "Points must be a whole number"
    if p < CUSTOM_POINTS_MIN:
        return f"Minimum custom purchase is {CUSTOM_POINTS_MIN:,} points"
    if p > CUSTOM_POINTS_MAX:
        return f"Maximum custom purchase is {CUSTOM_POINTS_MAX:,} points"
    return None


def validate_custom_gbp_budget(budget_gbp: float) -> Optional[str]:
    b = float(budget_gbp)
    if b <= 0:
        return "Enter a positive amount in GBP"
    min_price = price_gbp_for_points(CUSTOM_POINTS_MIN)
    if b < min_price - 1e-9:
        return f"Minimum spend is £{min_price:.2f} ({CUSTOM_POINTS_MIN:,} points tier)"
    max_price = price_gbp_for_points(CUSTOM_POINTS_MAX)
    if b > max_price + 1e-9:
        return f"Maximum spend is £{max_price:.2f} (top tier)"
    return None
