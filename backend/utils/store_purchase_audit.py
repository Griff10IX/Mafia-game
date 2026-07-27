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
    "buy-founding-member": "Founding Member badge",
    "buy-robot-bg-auto-search": "Robot bodyguard auto-search",
    "buy-bodyguard-find-time": "Bodyguard find clock (7 days)",
    "buy-slow-kill-inflation": "Slow Kill Inflation (30 days)",
    "buy-slow-bodyguard-hire-inflation": "Slow Bodyguard Hire Inflation (30 days)",
    "buy-weapon-point-store": "Point-store weapon",
    "buy-armour-point-store": "Point-store armour",
    "buy-health": "Full health",
    "buy-custom-car": "Custom car",
    "buy-token-selectable-bundle": "Selectable token bundle",
    "buy-shooting-range-bonus": "Shooting range bonus plays",
    "buy-hitlist-npc-bonus-slot": "Hitlist practice NPC slot",
    "buy-custom-profile-badge": "Custom profile badge",
    "buy-profile-glow-7d": "Profile glow + border (7 days)",
    "buy-profile-glow-permanent": "Profile glow + border (permanent)",
    "buy-family-crest-upgrade": "Family crest upgrade",
    "buy-family-safe-deposit-tier": "Family safe deposit tier",
    "buy-family-event-token": "Family event token",
    "buy-jail-bailout-token": "Jail bailout token",
    "buy-weed-daily-cap": "Weed daily sell cap +$250M",
    "buy-weed-safety-deposit": "Weed Safety Deposit unlock",
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
    if ref == "buy-token-selectable-bundle-cash" or ref == "buy-token-selectable-bundle":
        sel = extra.get("selected_tokens")
        if sel:
            parts = [f"{int(t.get('amount') or 0)}× {(t.get('token_type') or '?').replace('_', ' ')}" for t in sel]
            return "Selectable bundle: " + ", ".join(parts)
    if ref == "buy-robot-bg-auto-search" and extra.get("robot_bg_auto_search_until"):
        return f"{label} (until {extra['robot_bg_auto_search_until']})"
    if ref == "buy-bodyguard-find-time" and extra.get("bodyguard_find_time_until"):
        return f"{label} (until {extra['bodyguard_find_time_until']})"
    if ref == "buy-slow-kill-inflation" and extra.get("slow_kill_inflation_until"):
        return f"{label} (until {extra['slow_kill_inflation_until']})"
    if ref == "buy-slow-bodyguard-hire-inflation" and extra.get("slow_bodyguard_hire_inflation_until"):
        return f"{label} (until {extra['slow_bodyguard_hire_inflation_until']})"
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
