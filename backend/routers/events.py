# Events: active daily event, flash news (ticker)
from datetime import datetime, timezone

from fastapi import Depends

from server import db, get_current_user, get_effective_event, get_events_enabled
from routers.booze_run import get_booze_rotation_interval_seconds, get_booze_rotation_index


async def get_active_event(current_user: dict = Depends(get_current_user)):
    """Current game-wide daily event when enabled; otherwise null."""
    enabled = await get_events_enabled()
    event = await get_effective_event() if enabled else None
    return {"event": event, "events_enabled": enabled}


async def get_flash_news(current_user: dict = Depends(get_current_user)):
    """Recent flash news: wars, booze price changes, etc. For the top-bar ticker."""
    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    items = []
    try:
        ev = await get_effective_event()
        if ev.get("id") != "none":
            event_start_iso = datetime.now(timezone.utc).date().isoformat()
            items.append({
                "id": f"event_{ev.get('id', '')}_{event_start_iso}",
                "type": "game_event",
                "message": ev.get("message") or f"Today: {ev.get('name', 'Event')}",
                "at": event_start_iso + "T00:00:00+00:00",
            })
    except Exception:
        pass
    try:
        interval = get_booze_rotation_interval_seconds()
        rotation_index = get_booze_rotation_index()
        rotation_start_ts = rotation_index * interval
        rotation_start_iso = datetime.fromtimestamp(rotation_start_ts, tz=timezone.utc).isoformat()
        if now_ts - rotation_start_ts < interval:
            items.append({
                "id": f"booze_rotation_{rotation_index}",
                "type": "booze_prices",
                "message": "Booze prices just changed! Check Booze Run for new rates.",
                "at": rotation_start_iso,
            })
    except Exception:
        pass
    wars = await db.family_wars.find({}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    family_ids = set()
    for w in wars:
        family_ids.add(w.get("family_a_id"))
        family_ids.add(w.get("family_b_id"))
    families = await db.families.find({"id": {"$in": list(family_ids)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}).to_list(50)
    family_map = {f["id"]: f for f in families}
    for w in wars:
        fa = family_map.get(w.get("family_a_id"), {})
        fb = family_map.get(w.get("family_b_id"), {})
        a_name = fa.get("name") or "?"
        b_name = fb.get("name") or "?"
        status = w.get("status")
        ended_at = w.get("ended_at")
        created_at = w.get("created_at") or ""
        if status in ("active", "truce_offered"):
            items.append({"id": w.get("id"), "type": "war_started", "message": f"War: {a_name} vs {b_name}", "at": created_at})
        elif ended_at:
            winner_id = w.get("winner_family_id")
            loser_id = w.get("loser_family_id")
            if status == "truce":
                items.append({"id": w.get("id") + "_truce", "type": "war_ended", "message": f"War ended: {a_name} vs {b_name} — truce", "at": ended_at})
            elif winner_id and loser_id:
                winner = family_map.get(winner_id, {})
                loser = family_map.get(loser_id, {})
                wn = winner.get("name") or "?"
                ln = loser.get("name") or "?"
                items.append({"id": w.get("id") + "_end", "type": "war_ended", "message": f"War ended: {wn} defeated {ln}", "at": ended_at})
            else:
                items.append({"id": w.get("id") + "_end", "type": "war_ended", "message": f"War ended: {a_name} vs {b_name}", "at": ended_at})
    items.sort(key=lambda x: x["at"], reverse=True)
    return {"items": items[:10]}


def register(router):
    router.add_api_route("/events/active", get_active_event, methods=["GET"])
    router.add_api_route("/news/flash", get_flash_news, methods=["GET"])
