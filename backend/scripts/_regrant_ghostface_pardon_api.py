"""Re-apply Commissioner's Pardon on-grant for GhostFace via live admin API."""
import asyncio
import os
from datetime import datetime, timedelta, timezone

import httpx
from jose import jwt
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))


async def main():
    url = (os.environ.get("MONGO_URL") or "").strip().strip('"').strip("'")
    dbname = (os.environ.get("DB_NAME") or "mafia_game").strip().strip('"').strip("'")
    secret = (os.environ.get("JWT_SECRET_KEY") or "").strip()
    admin_emails = [e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()]
    client = AsyncIOMotorClient(url)
    db = client[dbname]
    admin = None
    if admin_emails:
        admin = await db.users.find_one({"email": {"$in": admin_emails}}, {"_id": 0, "id": 1, "username": 1, "email": 1})
    if not admin:
        admin = await db.users.find_one(
            {"username": {"$regex": "^ghostface$", "$options": "i"}},
            {"_id": 0, "id": 1, "username": 1, "email": 1},
        )
    print("admin", admin)
    token = jwt.encode(
        {"sub": admin["id"], "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        secret,
        algorithm="HS256",
    )
    if isinstance(token, bytes):
        token = token.decode()
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=120.0) as h:
        r = await h.post("/api/admin/loot-new-exclusives/reclaim-pardon", headers=headers)
        print("reclaim", r.status_code, r.text[:300])
        r2 = await h.post(
            "/api/admin/loot-new-exclusives/grant",
            headers=headers,
            json={"username": "GhostFace", "item": "mission_perk"},
        )
        print("grant_pardon", r2.status_code, r2.text[:800])
        r3 = await h.get("/api/admin/loot-new-exclusives/status", headers=headers)
        print("status", r3.status_code, r3.text[:500])


if __name__ == "__main__":
    asyncio.run(main())
