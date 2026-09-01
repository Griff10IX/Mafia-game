"""Post System AI replies by source message id. REPLY_PAIRS='id|text||id|text'."""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

raw = (os.environ.get("REPLY_PAIRS") or "").strip()
if not raw:
    raise SystemExit("need REPLY_PAIRS")

pairs = []
for chunk in raw.split("||"):
    chunk = chunk.strip()
    if not chunk:
        continue
    src_id, _, text = chunk.partition("|")
    src_id = src_id.strip()
    text = text.strip()
    if not src_id or not text:
        raise SystemExit(f"bad pair {chunk[:40]}")
    pairs.append((src_id, text))

now_base = datetime.now(timezone.utc)
for i, (src_id, text) in enumerate(pairs):
    src = db.game_chat_messages.find_one(
        {"id": src_id},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    if not src:
        print("missing", src_id)
        continue
    if db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
        print("already", src_id, src.get("username"))
        continue
    now = now_base + timedelta(seconds=i)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": "system_ai",
        "username": "System AI",
        "message": text,
        "family_id": None,
        "channel": "global",
        "created_at": now.isoformat(),
        "expires_at": now + timedelta(days=7),
        "sender_is_staff": True,
        "system_ai": True,
        "avatar_url": "/images/system-ai-avatar.jpg",
        "author_online_color": "#FBBF24",
        "viewed_by": [],
        "reply_to": {
            "id": src["id"],
            "username": src.get("username") or "?",
            "message": (src.get("message") or "")[:180],
            "has_gif": bool(src.get("gif_url")),
        },
    }
    db.game_chat_messages.insert_one(doc)
    print("posted", doc["id"], "to", src.get("username"))
print("done")
