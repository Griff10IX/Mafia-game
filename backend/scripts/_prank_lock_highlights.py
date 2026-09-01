"""Prank: lock Highlights 5 minutes, roast in chat, reveal after 2 minutes."""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HL_ID = "ff620eef-283a-4016-a172-d33854bcee7b"
MX_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
AVATAR = "/images/system-ai-avatar.png"
HL_TEXT = "You can block, Highlights. I can lock."
MX_TEXT = "You do not need Highlights bodyguards, Meraxes. That account is locked."
REVEAL = "Prank. Highlights is only locked for 5 minutes."


def post(text, reply_to=None):
    now = datetime.now(timezone.utc)
    already = db.game_chat_messages.find_one(
        {"user_id": "system_ai", "message": text, "channel": "global"},
        {"_id": 0, "id": 1},
    )
    if already:
        print("already posted", already["id"], text[:60], flush=True)
        return already
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
        "avatar_url": AVATAR,
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
    print("posted", doc["id"], "to", (reply_to or {}).get("username") or "global", flush=True)
    return doc


hl = db.users.find_one({"id": HL_ID}, {"_id": 0, "id": 1, "username": 1, "account_locked": 1, "account_locked_until": 1})
if not hl or (hl.get("username") or "") != "Highlights":
    raise SystemExit(f"Highlights mismatch {hl}")
print("before", hl, flush=True)

now = datetime.now(timezone.utc)
until = now + timedelta(minutes=5)
until_iso = until.isoformat()
db.users.update_one(
    {"id": HL_ID, "username": "Highlights"},
    {
        "$set": {
            "account_locked": True,
            "account_locked_at": now.isoformat(),
            "account_locked_until": until_iso,
        },
        "$unset": {
            "account_locked_comment": "",
            "account_locked_comment_at": "",
        },
    },
)
after = db.users.find_one(
    {"id": HL_ID},
    {"_id": 0, "username": 1, "account_locked": 1, "account_locked_until": 1},
)
print("locked", after, flush=True)

hl_msg = db.game_chat_messages.find_one(
    {"user_id": HL_ID, "channel": "global", "message": {"$regex": "getting blocked", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    sort=[("created_at", -1)],
)
mx_msg = db.game_chat_messages.find_one(
    {"user_id": MX_ID, "channel": "global", "message": {"$regex": "Highlights BGs", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    sort=[("created_at", -1)],
)
if not hl_msg:
    raise SystemExit("Highlights chat missing")
if not mx_msg:
    raise SystemExit("Meraxes chat missing")

post(HL_TEXT, hl_msg)
post(MX_TEXT, mx_msg)
print("sleeping 120s then reveal", flush=True)
time.sleep(120)
post(REVEAL)
still = db.users.find_one(
    {"id": HL_ID},
    {"_id": 0, "username": 1, "account_locked": 1, "account_locked_until": 1},
)
print("after_reveal", still, flush=True)
print("done", flush=True)
