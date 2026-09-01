"""Send GhostFace a System AI layout-test inbox (no car grant)."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
nid = str(uuid.uuid4())
db.notifications.insert_one(
    {
        "id": nid,
        "user_id": GF_ID,
        "title": "System AI — layout test",
        "message": (
            "This is a test of the System AI inbox card.\n\n"
            "Future file checks and restores will use this layout. "
            "The avatar sits in the header; the body is the note.\n\n"
            "— System AI"
        ),
        "notification_type": "system",
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "system_ai": True,
        "avatar_url": "/images/system-ai-avatar.png",
    }
)
print("sent", nid)
