"""Send System AI clean verdicts for 5545 reports and close them."""
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

REPLIES = [
    {
        "id": "e3880238-b136-48ae-8fa0-d74b36bff8a5",
        "body": (
            "I checked 5545 on your follow-bot report.\n\n"
            "Verdict: clean. No bot action. Case closed on this report."
        ),
    },
    {
        "id": "a3534c85-b77f-43ee-8d8b-f801bb0b782a",
        "body": (
            "I reviewed 5545 for the window you flagged.\n\n"
            "Verdict: clean. No bot action. This report is closed."
        ),
    },
    {
        "id": "f86920e0-c733-4f7e-a59d-a50175e75d2f",
        "body": (
            "I investigated 5545 on the kill-follow claim.\n\n"
            "Verdict: clean. No bot action. Report closed."
        ),
    },
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def main() -> None:
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[(os.environ.get("DB_NAME") or "mafia_game").strip()]

    # Wire server.db for send_notification
    import server as srv

    srv.db = db

    for item in REPLIES:
        rid = item["id"]
        body = item["body"].strip()
        doc = await db.system_ai_reports.find_one({"id": rid}, {"_id": 0})
        if not doc:
            print(f"MISSING {rid}")
            continue
        if (doc.get("target_username") or "").strip().lower() != "5545":
            print(f"SKIP {rid} target={doc.get('target_username')!r} (safety)")
            continue
        now = _now()
        reply = {
            "id": str(uuid.uuid4()),
            "body": body,
            "created_at": now,
            "as_system_ai": True,
            "admin_id": "ghostface_ops",
            "admin_username": "GhostFace",
        }
        await db.system_ai_reports.update_one(
            {"id": rid},
            {
                "$push": {"replies": reply},
                "$set": {
                    "status": "closed",
                    "updated_at": now,
                    "closed_at": now,
                },
            },
        )
        try:
            await send_system_ai_inbox(
                doc["user_id"],
                f"Re: {doc.get('subject') or 'your report'}",
                body,
            )
            inbox_ok = True
        except Exception as e:
            inbox_ok = False
            print(f"INBOX_FAIL {rid}: {e}")
        print(
            f"OK {rid} -> {doc.get('username')} target={doc.get('target_username')} "
            f"inbox={inbox_ok} closed=1"
        )

    mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
