"""CC GhostFace only — 5545 clean verdicts already sent to reporters."""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, "/opt/mafia-app/backend")
os.chdir("/opt/mafia-app/backend")

from dotenv import load_dotenv

load_dotenv("/opt/mafia-app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient
from utils.system_ai_inbox import send_system_ai_inbox

COPIES = [
    {
        "reporter": "Schizophrenic",
        "subject": "Follow bot",
        "body": (
            "I checked 5545 on your follow-bot report.\n\n"
            "Verdict: clean. No bot action. Case closed on this report."
        ),
    },
    {
        "reporter": "Highlights",
        "subject": "Using a bot now",
        "body": (
            "I reviewed 5545 for the window you flagged.\n\n"
            "Verdict: clean. No bot action. This report is closed."
        ),
    },
    {
        "reporter": "Meraxes",
        "subject": "Using kill bot",
        "body": (
            "I investigated 5545 on the kill-follow claim.\n\n"
            "Verdict: clean. No bot action. Report closed."
        ),
    },
]


async def main() -> None:
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[(os.environ.get("DB_NAME") or "mafia_game").strip()]
    import server as srv

    srv.db = db

    gf = await db.users.find_one(
        {"username": {"$regex": "^GhostFace$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1},
    )
    if not gf:
        print("GhostFace not found")
        return
    print(f"GhostFace={gf.get('username')} id={gf['id']}")

    for c in COPIES:
        gf_body = (
            f"[Staff copy] Report from {c['reporter']} re: 5545 — {c['subject']}\n\n{c['body']}"
        )
        await send_system_ai_inbox(gf["id"], f"Re: {c['subject']} (5545)", gf_body)
        print(f"sent GhostFace copy: {c['reporter']} / {c['subject']}")

    mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
