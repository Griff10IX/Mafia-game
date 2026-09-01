"""Watch global chat 5 minutes, reply to people talking to System AI, then lie down. No handouts."""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

WATCH_SECONDS = 5 * 60
POLL = 8
ASK_WORDS = (
    "skip", "points", "loot", "token", "money", "cash", "spin", "gimme", "give me",
    "give us", "gift", "credit", "reward", "free", "autorank", "auto rank", "bullets",
)


def addressed(msg):
    if (msg.get("user_id") or "") == "system_ai":
        return False
    if (msg.get("username") or "").strip().lower() == "system ai":
        return False
    body = (msg.get("message") or "").lower()
    rt = msg.get("reply_to") or {}
    if (rt.get("username") or "").strip().lower() == "system ai":
        return True
    compact = body.replace(" ", "")
    if "system ai" in body or "@systemai" in compact:
        return True
    return False


def already_replied(src_id):
    return db.game_chat_messages.find_one(
        {"user_id": "system_ai", "reply_to.id": src_id},
        {"_id": 1},
    )


def post(text, reply_to=None):
    now = datetime.now(timezone.utc)
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
    print("posted", text, flush=True)
    return doc["id"]


def reply_text(user, msg):
    low = (msg or "").lower()
    if any(w in low for w in ASK_WORDS):
        return f"{user}, I do not hand things out in chat. Stay loyal on the streets."
    if "beam" in low or "kill me" in low or "kill him" in low or "whack" in low:
        return f"I do not take contracts from chat, {user}."
    return f"Heard you, {user}."


start = time.time()
since = datetime.now(timezone.utc).isoformat()
print("watching until", WATCH_SECONDS, "since", since, flush=True)
seen = set()

while time.time() - start < WATCH_SECONDS:
    rows = list(
        db.game_chat_messages.find(
            {"channel": "global", "created_at": {"$gte": since}, "user_id": {"$ne": "system_ai"}},
            {"_id": 0, "id": 1, "user_id": 1, "username": 1, "message": 1, "gif_url": 1, "created_at": 1, "reply_to": 1},
        ).sort("created_at", 1)
    )
    for m in rows:
        mid = m.get("id")
        if not mid or mid in seen:
            continue
        if not addressed(m):
            continue
        seen.add(mid)
        if already_replied(mid):
            print("skip already", m.get("username"), m.get("message"), flush=True)
            continue
        user = m.get("username") or "?"
        text = reply_text(user, m.get("message") or "")
        print("replying", user, m.get("message"), "->", text, flush=True)
        post(text, m)
    time.sleep(POLL)

post("You lot are exhausting. System AI is going to lie down.")
print("done", flush=True)
