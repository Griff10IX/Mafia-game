# Single-pass aggregation for "today / rolling 24h / last 7 days" event stats.
# Replaces $facet (three branch scans) with one match on user_id + at >= 7d and one $group with $cond.
# Short per-user TTL cache avoids spamming Mongo with the same heavy scan (Crimes page silent
# refetches, cooldown sync, /stats/me warm, etc.). Index: (user_id, at).
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

_ROLLING_STATS_CACHE: Dict[str, tuple[Dict[str, Any], float]] = {}
_ROLLING_STATS_CACHE_TTL_SEC = 20.0
_ROLLING_STATS_CACHE_MAX = 8000


def rolling_event_stats_pipeline(
    user_id: str,
    *,
    seven_days_start: datetime,
    today_start: datetime,
    last_24h_start: datetime,
) -> List[Dict[str, Any]]:
    return [
        {"$match": {"user_id": user_id, "at": {"$gte": seven_days_start}}},
        # Slim docs before $group — event rows carry unused fields (crime_name, city, …).
        {"$project": {"_id": 0, "at": 1, "success": 1, "profit": 1}},
        {
            "$group": {
                "_id": None,
                "count_week": {"$sum": 1},
                "success_week": {"$sum": {"$cond": ["$success", 1, 0]}},
                "profit_week": {"$sum": {"$ifNull": ["$profit", 0]}},
                "count_today": {"$sum": {"$cond": [{"$gte": ["$at", today_start]}, 1, 0]}},
                "success_today": {
                    "$sum": {"$cond": [{"$and": [{"$gte": ["$at", today_start]}, "$success"]}, 1, 0]}
                },
                "profit_today": {
                    "$sum": {"$cond": [{"$gte": ["$at", today_start]}, {"$ifNull": ["$profit", 0]}, 0]}
                },
                "profit_24h": {
                    "$sum": {"$cond": [{"$gte": ["$at", last_24h_start]}, {"$ifNull": ["$profit", 0]}, 0]}
                },
            }
        },
    ]


def rolling_stats_response_from_doc(doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Shared shape for /gta/stats and /jail stats endpoints."""
    doc = doc or {}
    p24 = int(doc.get("profit_24h", 0))
    return {
        "count_today": int(doc.get("count_today", 0)),
        "count_week": int(doc.get("count_week", 0)),
        "success_today": int(doc.get("success_today", 0)),
        "success_week": int(doc.get("success_week", 0)),
        "profit_today": int(doc.get("profit_today", 0)),
        "profit_24h": p24,
        "profit_week": int(doc.get("profit_week", 0)),
    }


def invalidate_rolling_event_stats_cache(collection_name: str, user_id: str) -> None:
    _ROLLING_STATS_CACHE.pop(f"{collection_name}:{user_id}", None)


def _cache_get(key: str) -> Optional[Dict[str, Any]]:
    hit = _ROLLING_STATS_CACHE.get(key)
    if not hit:
        return None
    payload, exp = hit
    if time.monotonic() >= exp:
        _ROLLING_STATS_CACHE.pop(key, None)
        return None
    return payload


def _cache_set(key: str, payload: Dict[str, Any]) -> None:
    if len(_ROLLING_STATS_CACHE) >= _ROLLING_STATS_CACHE_MAX:
        # Drop ~10% oldest-by-expiry (cheap sweep).
        cutoff = time.monotonic()
        stale = [k for k, (_, exp) in _ROLLING_STATS_CACHE.items() if exp <= cutoff]
        for k in stale:
            _ROLLING_STATS_CACHE.pop(k, None)
        if len(_ROLLING_STATS_CACHE) >= _ROLLING_STATS_CACHE_MAX:
            for k in list(_ROLLING_STATS_CACHE.keys())[: max(1, _ROLLING_STATS_CACHE_MAX // 10)]:
                _ROLLING_STATS_CACHE.pop(k, None)
    _ROLLING_STATS_CACHE[key] = (payload, time.monotonic() + _ROLLING_STATS_CACHE_TTL_SEC)


async def fetch_rolling_event_stats(coll, user_id: str, *, collection_name: str) -> Dict[str, Any]:
    """Run the rolling stats aggregate with a short per-user cache."""
    uid = (user_id or "").strip()
    if not uid:
        return rolling_stats_response_from_doc(None)
    cache_key = f"{collection_name}:{uid}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return dict(cached)

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    last_24h_start = now - timedelta(hours=24)
    seven_days_start = now - timedelta(days=7)
    pipeline = rolling_event_stats_pipeline(
        uid,
        seven_days_start=seven_days_start,
        today_start=today_start,
        last_24h_start=last_24h_start,
    )
    result = await coll.aggregate(pipeline).to_list(1)
    out = rolling_stats_response_from_doc(result[0] if result else None)
    _cache_set(cache_key, out)
    return dict(out)
