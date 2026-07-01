"""Per-transaction audit log for store purchases paid with points and/or respect."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

STORE_POINTS_PURCHASE_LOGS = "store_points_purchase_logs"

_STORE_EVENT_LABELS: Dict[str, str] = {
    "buy-rank-bar": "Premium rank bar",
    "buy-silencer": "Silencer",
    "buy-anti-snitch": "Anti-snitch",
    "buy-oc-timer": "OC timer",
    "buy-crew-oc-timer": "Crew OC timer",
    "upgrade-garage-batch": "Garage batch upgrade",
    "buy-booze-capacity": "Booze capacity",
    "buy-bullets": "Bullets",
    "buy-auto-rank": "Auto Rank",
    "buy-robot-bg-auto-search": "Robot bodyguard auto-search",
    "buy-weapon-point-store": "Point-store weapon",
    "buy-armour-point-store": "Point-store armour",
    "buy-health": "Full health",
    "buy-custom-car": "Custom car",
    "buy-token-selectable-bundle": "Selectable token bundle",
    "buy-shooting-range-bonus": "Shooting range bonus plays",
    "buy-hitlist-npc-bonus-slot": "Hitlist practice NPC slot",
}


def store_purchase_item_label(store_event_ref: str, extra: Optional[dict] = None) -> str:
    ref = (store_event_ref or "").strip()
    extra = extra or {}
    if ref in _STORE_EVENT_LABELS:
        label = _STORE_EVENT_LABELS[ref]
    elif ref.startswith("buy-token:"):
        tt = ref.split(":", 1)[1].replace("_", " ")
        amt = extra.get("amount")
        label = f"+{int(amt)}× {tt} token" if amt else f"{tt} token"
    elif ref.startswith("buy-token-bundle:"):
        bid = ref.split(":", 1)[1]
        label = f"Token bundle: {bid}"
    else:
        label = ref or "store purchase"
    if ref == "buy-robot-bg-auto-search" and extra.get("robot_bg_auto_search_until"):
        return f"{label} (until {extra['robot_bg_auto_search_until']})"
    if ref == "buy-custom-car" and extra.get("car_name"):
        return f"{label}: {extra['car_name']}"
    if ref == "buy-bullets" and extra.get("bullets"):
        return f"{label}: +{int(extra['bullets']):,}"
    return label


def _spend_from_inc(inc: dict) -> tuple[int, int]:
    inc = inc or {}
    pts = int(inc.get("lifetime_points_spent") or 0)
    if pts <= 0 and int(inc.get("points") or 0) < 0:
        pts = -int(inc["points"])
    rsp = int(inc.get("lifetime_respect_points_spent") or 0)
    if rsp <= 0 and int(inc.get("respect_points") or 0) < 0:
        rsp = -int(inc["respect_points"])
    return max(0, pts), max(0, rsp)


async def record_store_points_purchase_log(
    db,
    user: dict,
    store_event_ref: str,
    inc: dict,
    *,
    cost_points: int = 0,
    extra: Optional[dict] = None,
) -> str:
    """Insert a detailed row for one store points/respect purchase. Returns log id."""
    purchase_id = str(uuid.uuid4())
    extra = dict(extra or {})
    points_spent, respect_spent = _spend_from_inc(inc)
    points_before = int(user.get("points") or 0)
    respect_before = int(user.get("respect_points") or 0)
    now_iso = datetime.now(timezone.utc).isoformat()
    doc: Dict[str, Any] = {
        "id": purchase_id,
        "store_event_ref": store_event_ref,
        "item_label": store_purchase_item_label(store_event_ref, extra),
        "user_id": user.get("id"),
        "username": user.get("username", "?"),
        "prestige_level": int(user.get("prestige_level") or 0),
        "cost_points": int(cost_points or 0),
        "points_spent": points_spent,
        "respect_spent": respect_spent,
        "points_before": points_before,
        "points_after": points_before - points_spent,
        "respect_before": respect_before,
        "respect_after": respect_before - respect_spent,
        "created_at": now_iso,
    }
    if extra:
        doc["extra"] = extra
    await db[STORE_POINTS_PURCHASE_LOGS].insert_one(doc)
    return purchase_id
