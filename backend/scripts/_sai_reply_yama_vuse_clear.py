"""Reply Meraxes Yama/Vuse report: not sharing, clear. CC GhostFace. Close."""
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

REPORT_ID = "79bccc2c-6a52-440e-b744-51f7ee093bbd"
BODY = (
    "I checked Yama and Vuse on your report.\n\n"
    "They are not sharing accounts. Everything else on this report is clear.\n\n"
    "Case closed."
)


async def main() -> None:
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[(os.environ.get("DB_NAME") or "mafia_game").strip()]
    import server as srv

    srv.db = db

    doc = await db.system_ai_reports.find_one({"id": REPORT_ID}, {"_id": 0})
    if not doc:
        print("MISSING report")
        return
    if doc.get("status") != "open":
        print(f"status={doc.get('status')} — abort")
        return

    gf = await db.users.find_one(
        {"username": {"$regex": "^GhostFace$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1},
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
    print(f"sent -> {doc.get('username')} closed=1")

    if gf:
        gf_body = (
            f"[Staff copy] Report from {doc.get('username')} re: "
            f"{doc.get('target_username')} — {subject}\n\n{BODY}"
        )
        await send_system_ai_inbox(gf["id"], f"Re: {subject} (Yama & Vuse)", gf_body)
        print(f"sent GhostFace copy")

    mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
