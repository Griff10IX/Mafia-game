"""Reply Highlights Vuse botting: clean. CC GhostFace. Close."""
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

REPORT_ID = "4c22b168-eea9-442a-b8db-4c5113d7f2f7"
BODY = (
    "I checked Vuse on your kill-page bot report.\n\n"
    "Verdict: clean. No bot action. Case closed."
)


async def main() -> None:
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[(os.environ.get("DB_NAME") or "mafia_game").strip()]
    import server as srv

    srv.db = db

    doc = await db.system_ai_reports.find_one({"id": REPORT_ID}, {"_id": 0})
    if not doc or doc.get("status") != "open":
        print("abort", doc.get("status") if doc else "missing")
        return

    gf = await db.users.find_one(
        {"username": {"$regex": "^GhostFace$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    now = datetime.now(timezone.utc).isoformat()
    reply = {
        "id": str(uuid.uuid4()),
        "body": BODY,
        "created_at": now,
        "as_system_ai": True,
        "admin_id": "ghostface_ops",
        "admin_username": "GhostFace",
    }
    await db.system_ai_reports.update_one(
        {"id": REPORT_ID},
        {
            "$push": {"replies": reply},
            "$set": {"status": "closed", "updated_at": now, "closed_at": now},
        },
    )
    subject = doc.get("subject") or "your report"
    await send_system_ai_inbox(doc["user_id"], f"Re: {subject}", BODY)
    print(f"sent -> {doc.get('username')}")

    if gf:
        await send_system_ai_inbox(
            gf["id"],
            f"Re: {subject} (Vuse)",
            f"[Staff copy] Report from {doc.get('username')} re: Vuse — {subject}\n\n{BODY}",
        )
        print("sent GhostFace copy")

    print("\n=== REMAINING OPEN ===")
    async for r in db.system_ai_reports.find({"status": "open"}, {"_id": 0}).sort("created_at", -1):
        print(f"- {r.get('username')} | {r.get('target_username')} | {r.get('subject')}")

    mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
