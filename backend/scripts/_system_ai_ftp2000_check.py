"""Check for first player post after FTP2000 announce. Print WAITING or WINNER."""
import json
import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

STATE = "/tmp/sai_ftp2000_state.json"
if not os.path.exists(STATE):
    print("NO_STATE", flush=True)
    raise SystemExit(1)

with open(STATE, encoding="utf-8") as f:
    state = json.load(f)

if state.get("done"):
    print("DONE", state.get("winner_username"), flush=True)
    raise SystemExit(0)

since = state["since"]
announce_id = state["announce_id"]

rows = list(
    db.game_chat_messages.find(
        {
            "channel": "global",
            "created_at": {"$gt": since},
            "user_id": {"$nin": ["system_ai", ""]},
        },
        {
            "_id": 0,
            "id": 1,
            "user_id": 1,
            "username": 1,
            "message": 1,
            "gif_url": 1,
            "created_at": 1,
        },
    )
    .sort("created_at", 1)
    .limit(12)
)
rows = [
    m
    for m in rows
    if (m.get("user_id") or "") != "system_ai"
    and (m.get("username") or "").strip().lower() != "system ai"
    and (m.get("id") or "") != announce_id
]
if not rows:
    print("WAITING", flush=True)
    raise SystemExit(0)

w = rows[0]
print(
    "WINNER",
    w.get("username"),
    w.get("user_id"),
    w.get("id"),
    w.get("created_at"),
    flush=True,
)
