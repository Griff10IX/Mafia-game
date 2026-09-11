"""Verify GhostFace can see new exclusives via local API."""
import asyncio
import os
import sys
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
    client = AsyncIOMotorClient(url)
    db = client[dbname]
    u = await db.users.find_one(
        {"username": {"$regex": "^ghostface$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1},
    )
    token = jwt.encode(
        {"sub": u["id"], "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        secret,
        algorithm="HS256",
    )
    if isinstance(token, bytes):
        token = token.decode()
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=60.0) as h:
        for path in ("/api/weapons", "/api/armour/options", "/api/inventory", "/api/missions/map"):
            r = await h.get(path, headers=headers)
            snippet = (r.text or "")[:180].replace("\n", " ")
            print(path, r.status_code, snippet)
        r = await h.get("/api/weapons", headers=headers)
        print("BAR visible:", "weapon_loot_bar" in r.text or "Browning" in r.text)
        r = await h.get("/api/armour/options", headers=headers)
        print("Brewster visible:", "Brewster" in r.text or '"level":8' in r.text)
        r = await h.get("/api/inventory", headers=headers)
        print("Pardon visible:", "Pardon" in r.text or "commissioners_pardon" in r.text)


if __name__ == "__main__":
    asyncio.run(main())
