"""Refresh odds templates + auto-board via localhost API using admin JWT."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from jose import jwt
from pymongo import MongoClient

BACKEND = Path("/opt/mafia-app/backend")
sys.path.insert(0, str(BACKEND))
load_dotenv(str(BACKEND / ".env"))

db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
SECRET = (os.environ.get("JWT_SECRET_KEY") or "").strip()
ALGO = "HS256"
BASE = "http://127.0.0.1:8000"


def admin_token() -> str:
    u = db.users.find_one({"is_admin": True, "is_dead": {"$ne": True}}, {"_id": 0, "id": 1, "username": 1})
    if not u:
        u = db.users.find_one({"username": "GhostFace"}, {"_id": 0, "id": 1, "username": 1})
    if not u or not SECRET:
        raise SystemExit(f"no admin/secret u={u} secret_len={len(SECRET)}")
    # Match create_access_token / get_current_user: sub = user id
    payload = {
        "sub": u["id"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, SECRET, algorithm=ALGO)


def main():
    tok = admin_token()
    headers = {"Authorization": f"Bearer {tok}"}
    print("admin token ok")

    # Cancel very stale opens with no bets
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=2)
    cancelled = 0
    for ev in db.sports_events.find({"status": "open"}, {"_id": 0, "id": 1, "start_time": 1}):
        st = ev.get("start_time") or ""
        try:
            dt = datetime.fromisoformat(str(st).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if dt >= cutoff:
            continue
        if db.sports_bets.count_documents({"status": "open", "event_id": ev["id"]}):
            continue
        if db.sports_bets.count_documents({"status": "open", "bet_type": "accumulator", "legs.event_id": ev["id"]}):
            continue
        db.sports_events.update_one(
            {"id": ev["id"], "status": "open"},
            {"$set": {"status": "cancelled", "cancelled_at": now.isoformat(), "cancel_reason": "stale_past_kickoff"}},
        )
        cancelled += 1
    print("cancelled stale", cancelled)

    with httpx.Client(timeout=180.0) as client:
        print("POST refresh...")
        r = client.post(f"{BASE}/api/admin/sports-betting/refresh", headers=headers)
        print("refresh", r.status_code, r.text[:300])
        r.raise_for_status()
        data = r.json()
        print("templates_persisted", data.get("templates_persisted"), "total", data.get("templates_total"))

        print("POST auto-board-run merged...")
        r2 = client.post(
            f"{BASE}/api/admin/sports-betting/auto-board-run",
            headers=headers,
            json={"refresh_odds": True, "template_source": "merged"},
        )
        print("auto-board", r2.status_code, r2.text[:800])
        r2.raise_for_status()
        print(r2.json())

    # Visible count
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day1 = day0 + timedelta(days=3)
    vis = 0
    for ev in db.sports_events.find({"status": "open"}, {"_id": 0, "start_time": 1, "name": 1, "category": 1, "options": 1}).sort("start_time", 1):
        st = ev.get("start_time") or ""
        try:
            dt = datetime.fromisoformat(str(st).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if not (day0 <= dt < day1):
            continue
        vis += 1
        if vis <= 20:
            opts = ev.get("options") or []
            print("VISIBLE", st, ev.get("category"), ev.get("name"), [(o.get("name"), o.get("odds")) for o in opts[:3]])
    print("visible", vis)


if __name__ == "__main__":
    main()
