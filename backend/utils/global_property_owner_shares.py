"""Admin-configurable owner profit share % for global car dealership and sports betting book."""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

GLOBAL_PROPERTY_OWNER_SHARES_KEY = "global_property_owner_shares"

DEFAULT_GLOBAL_PROPERTY_OWNER_SHARES: Dict[str, int] = {
    "dealer_owner_profit_share_pct": 25,
    "player_sale_owner_profit_share_pct": 10,
    "sports_betting_owner_profit_share_pct": 10,
}

KNOWN_KEYS = frozenset(DEFAULT_GLOBAL_PROPERTY_OWNER_SHARES.keys())


def _coerce_pct(v: Any, default: int) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return max(0, min(100, n))


def merge_global_property_owner_shares(raw: Optional[Dict[str, Any]]) -> Dict[str, int]:
    out = dict(DEFAULT_GLOBAL_PROPERTY_OWNER_SHARES)
    if not raw or not isinstance(raw, dict):
        return out
    for k in KNOWN_KEYS:
        if k in raw:
            out[k] = _coerce_pct(raw.get(k), out[k])
    return out


_shares_cache: Optional[tuple] = None  # (merged dict, expires_at_monotonic)


async def load_global_property_owner_shares(db, *, ttl_sec: float = 45.0) -> Dict[str, int]:
    global _shares_cache
    now = time.monotonic()
    if ttl_sec > 0 and _shares_cache is not None:
        cached, exp = _shares_cache
        if now < exp:
            return dict(cached)

    doc = await db.game_settings.find_one({"key": GLOBAL_PROPERTY_OWNER_SHARES_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    merged = merge_global_property_owner_shares(raw if isinstance(raw, dict) else None)
    if ttl_sec > 0:
        _shares_cache = (merged, now + ttl_sec)
    return dict(merged)


def invalidate_global_property_owner_shares_cache() -> None:
    global _shares_cache
    _shares_cache = None


def _share_frac(shares: Dict[str, int], key: str) -> float:
    merged = merge_global_property_owner_shares(shares)
    return merged[key] / 100.0


def dealer_owner_profit_cut(profit: int, shares: Dict[str, int]) -> int:
    return int(int(profit or 0) * _share_frac(shares, "dealer_owner_profit_share_pct"))


def p2p_owner_profit_cut(profit: int, shares: Dict[str, int]) -> int:
    return int(int(profit or 0) * _share_frac(shares, "player_sale_owner_profit_share_pct"))


def sports_betting_owner_share_for_profit(house_profit: int, shares: Dict[str, int]) -> int:
    hp = int(house_profit or 0)
    if hp <= 0:
        return 0
    return int(hp * _share_frac(shares, "sports_betting_owner_profit_share_pct"))
