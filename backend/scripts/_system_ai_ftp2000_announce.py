"""Nice mode: next chat post wins 2,000 points. Announce + save state."""
import json
import os
import sys

sys.path.insert(0, "/opt/mafia-app/backend/scripts")
from dotenv import load_dotenv
from pymongo import MongoClient
from _system_ai_prank_helpers import post

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

STATE = "/tmp/sai_ftp2000_state.json"
FTP_TEXT = (
    "Nice mode. Next person to post in game chat gets 2,000 points. "
    "One winner. Go on then."
)

aid = post(FTP_TEXT)
m = db.game_chat_messages.find_one({"id": aid}, {"_id": 0, "id": 1, "created_at": 1})
state = {
    "announce_id": aid,
    "since": m["created_at"],
    "points": 2000,
    "done": False,
}
with open(STATE, "w", encoding="utf-8") as f:
    json.dump(state, f)
print("ANNOUNCED", aid, m["created_at"], flush=True)
