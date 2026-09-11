"""Reclaim+regrant GhostFace pardon via API with staff portal token (token_version aware)."""
import os
from datetime import datetime, timedelta, timezone

import httpx
from jose import jwt
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
secret = (os.environ.get("JWT_SECRET_KEY") or "").strip()
alg = (os.environ.get("JWT_ALGORITHM") or "HS256").strip()

admin = db.users.find_one(
    {"username": {"$regex": "^ghostface$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "token_version": 1},
)
print("admin", admin)
tv = int(admin.get("token_version") or 0)
exp = datetime.now(timezone.utc) + timedelta(hours=1)

user_jwt = jwt.encode(
    {"sub": admin["id"], "exp": exp, "v": tv, "staff_issued": True},
    secret,
    algorithm=alg,
)
if isinstance(user_jwt, bytes):
    user_jwt = user_jwt.decode()

portal_jwt = jwt.encode(
    {"sub": admin["id"], "typ": "staff_portal", "exp": exp},
    secret,
    algorithm=alg,
)
if isinstance(portal_jwt, bytes):
    portal_jwt = portal_jwt.decode()

headers = {
    "Authorization": f"Bearer {user_jwt}",
    "X-Staff-Portal-Token": portal_jwt,
}

with httpx.Client(base_url="http://127.0.0.1:8000", timeout=120.0) as h:
    gf = db.users.find_one(
        {"id": admin["id"]},
        {"_id": 0, "mission_completions": 1, "pardon_auto_skip_mission_ids": 1, "pardon_near_finish_mission_id": 1},
    )
    print(
        "before",
        {
            "completed": len(gf.get("mission_completions") or []),
            "skips": len(gf.get("pardon_auto_skip_mission_ids") or []),
            "near": gf.get("pardon_near_finish_mission_id"),
        },
    )

    r = h.post("/api/admin/loot-new-exclusives/reclaim-pardon", headers=headers)
    print("reclaim", r.status_code, r.text[:400])
    r2 = h.post(
        "/api/admin/loot-new-exclusives/grant",
        headers=headers,
        json={"username": "GhostFace", "item": "mission_perk"},
    )
    print("grant", r2.status_code, r2.text[:2000])

gf2 = db.users.find_one(
    {"id": admin["id"]},
    {
        "_id": 0,
        "mission_completions": 1,
        "pardon_auto_skip_mission_ids": 1,
        "pardon_near_finish_mission_id": 1,
        "has_commissioners_pardon": 1,
    },
)
print(
    "after",
    {
        "completed": len(gf2.get("mission_completions") or []),
        "skips": len(gf2.get("pardon_auto_skip_mission_ids") or []),
        "skip_sample": (gf2.get("pardon_auto_skip_mission_ids") or [])[:10],
        "near": gf2.get("pardon_near_finish_mission_id"),
        "has": gf2.get("has_commissioners_pardon"),
    },
)
