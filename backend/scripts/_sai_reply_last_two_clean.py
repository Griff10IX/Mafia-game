"""Close remaining open SAI reports: HP/Vuse + Schizophrenic BG replace. CC GhostFace."""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/opt/mafia-app/backend")
os.chdir("/opt/mafia-app/backend")

from dotenv import load_dotenv

load_dotenv("/opt/mafia-app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient
from utils.system_ai_inbox import send_system_ai_inbox

ITEMS = [
    {
        "id": "979b7162-18bd-4d94-84db-9f7e2c379667",
        "body": (
            "I checked Vuse on your follow report.\n\n"
            "Verdict: clean. No bot action. Case closed."
        ),
        "gf_tag": "Vuse",
    },
    {
        "id": "728cc0c6-f070-4f80-86cb-bfee77e55251",
        "body": (
            "I checked Vuse and Yama on the bodyguard-replace bot claim.\n\n"
            "Verdict: clean. No bot action. Case closed."
        ),
        "gf_tag": "Vuse & Yama",
    },
]


async def main() -> None:
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[(os.environ.get("DB_NAME") or "mafia_game").strip()]
    import server as srv

    srv.db = db

    gf = await db.users.find_one(
        {"username": {"$regex": "^GhostFace$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )

    for item in ITEMS:
        doc = await db.system_ai_reports.find_one({"id": item["id"]}, {"_id": 0})
        if not doc or doc.get("status") != "open":
            print("skip", item["id"], doc.get("status") if doc else "missing")
            continue
        now = datetime.now(timezone.utc).isoformat()
        reply = {
            "id": str(uuid.uuid4()),
            "body": item["body"],
            "created_at": now,
            "as_system_ai": True,
            "admin_id": "ghostface_ops",
            "admin_username": "GhostFace",
        }
        await db.system_ai_reports.update_one(
            {"id": item["id"]},
            {
                "$push": {"replies": reply},
                "$set": {"status": "closed", "updated_at": now, "closed_at": now},
            },
        )
        subject = doc.get("subject") or "your report"
        await send_system_ai_inbox(doc["user_id"], f"Re: {subject}", item["body"])
        print(f"sent -> {doc.get('username')} / {subject}")
        if gf:
            await send_system_ai_inbox(
                gf["id"],
                f"Re: {subject} ({item['gf_tag']})",
                f"[Staff copy] Report from {doc.get('username')} — {subject}\n\n{item['body']}",
            )
            print("  GhostFace copy ok")

    left = await db.system_ai_reports.count_documents({"status": "open"})
    print(f"open remaining: {left}")
    mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
