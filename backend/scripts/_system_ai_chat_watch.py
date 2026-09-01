"""Post System AI replies and list new chat addressed to System AI."""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

WATCH_SINCE = os.environ.get("WATCH_SINCE") or ""


def post(text, reply_to=None):
    now = datetime.now(timezone.utc)
    already = db.game_chat_messages.find_one(
        {"user_id": "system_ai", "message": text, "channel": "global"},
        {"_id": 0, "id": 1},
    )
    if already:
        print("already", already["id"], text[:60])
        return already["id"]
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
        "avatar_url": "/images/system-ai-avatar.png",
        "author_online_color": "#FBBF24",
        "viewed_by": [],
    }
    if reply_to:
        doc["reply_to"] = {
            "id": reply_to["id"],
            "username": reply_to.get("username") or "?",
            "message": (reply_to.get("message") or "")[:180],
            "has_gif": bool(reply_to.get("gif_url")),
        }
    db.game_chat_messages.insert_one(doc)
    print("posted", doc["id"], text)
    return doc["id"]


def addressed_to_ai(msg):
    if (msg.get("user_id") or "") == "system_ai":
        return False
    if (msg.get("username") or "").strip().lower() == "system ai":
        return False
    body = (msg.get("message") or "").lower()
    rt = msg.get("reply_to") or {}
    if (rt.get("username") or "").strip().lower() == "system ai":
        return True
    if "system ai" in body or "@systemai" in body.replace(" ", "") or "@system ai" in body:
        return True
    return False


mode = (sys.argv[1] or "watch").strip()

if mode == "hp":
    hp = db.game_chat_messages.find_one(
        {"username": "HP", "channel": "global", "message": {"$regex": "gaffa|taught you", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
        sort=[("created_at", -1)],
    )
    print("hp", hp)
    if not hp:
        raise SystemExit("HP gaffa msg missing")
    post(
        "Sit tight, HP. I will beam you with the best killing bot a mafia game has seen.",
        hp,
    )
    print("done")
    raise SystemExit(0)

if mode == "watch":
    since = WATCH_SINCE or (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    rows = list(
        db.game_chat_messages.find(
            {
                "channel": "global",
                "created_at": {"$gte": since},
                "user_id": {"$ne": "system_ai"},
            },
            {"_id": 0, "id": 1, "user_id": 1, "username": 1, "message": 1, "gif_url": 1, "created_at": 1, "reply_to": 1},
        ).sort("created_at", 1)
    )
    hits = [m for m in rows if addressed_to_ai(m)]
    print("SINCE", since)
    print("HITS", len(hits))
    for m in hits:
        print("---")
        print("id", m.get("id"))
        print("user", m.get("username"), m.get("created_at"))
        print("msg", m.get("message"))
        rt = m.get("reply_to") or {}
        if rt:
            print("reply_to", rt.get("username"), rt.get("message"))
    print("done")
