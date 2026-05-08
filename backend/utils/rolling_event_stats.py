# Single-pass aggregation for "today / rolling 24h / last 7 days" event stats.
# Replaces $facet (three branch scans) with one match on user_id + at >= 7d and one $group with $cond.
from datetime import datetime
from typing import Any, Dict, List, Optional


def rolling_event_stats_pipeline(
    user_id: str,
    *,
    seven_days_start: datetime,
    today_start: datetime,
    last_24h_start: datetime,
) -> List[Dict[str, Any]]:
    return [
        {"$match": {"user_id": user_id, "at": {"$gte": seven_days_start}}},
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
