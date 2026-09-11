"""Quick check GhostFace current mission progress via staff JWT API."""
import os
from datetime import datetime, timedelta, timezone

import httpx
from jose import jwt
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
secret = (os.environ.get("JWT_SECRET_KEY") or "").strip()
admin = db.users.find_one({"username": "GhostFace"}, {"_id": 0, "id": 1, "token_version": 1})
exp = datetime.now(timezone.utc) + timedelta(hours=1)
tok = jwt.encode(
    {"sub": admin["id"], "exp": exp, "v": int(admin.get("token_version") or 0)},
    secret,
    algorithm="HS256",
)
if isinstance(tok, bytes):
    tok = tok.decode()
with httpx.Client(base_url="http://127.0.0.1:8000", timeout=60.0) as h:
    r = h.get("/api/missions", headers={"Authorization": f"Bearer {tok}"})
    print("status", r.status_code)
    data = r.json()
    missions = data.get("missions") or data if isinstance(data, list) else data.get("missions") or []
    if isinstance(data, dict) and not missions:
        # try common shapes
        for k in data:
            if isinstance(data[k], list) and data[k] and isinstance(data[k][0], dict) and "id" in data[k][0]:
                missions = data[k]
                break
    open_ones = [m for m in missions if not m.get("completed") and m.get("unlocked")]
    print("open_count", len(open_ones))
    for m in open_ones[:3]:
        print(
            {
                "id": m.get("id"),
                "title": m.get("title") or m.get("name"),
                "progress": m.get("progress"),
                "requirements_met": m.get("requirements_met"),
            }
        )
    u = db.users.find_one(
        {"id": admin["id"]},
        {"_id": 0, "pardon_near_finish_mission_id": 1, "pardon_auto_skip_mission_ids": 1},
    )
    print("near", u.get("pardon_near_finish_mission_id"), "skips", len(u.get("pardon_auto_skip_mission_ids") or []))
