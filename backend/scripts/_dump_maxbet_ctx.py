"""Dump older game chat around maxbet context."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
for m in db.game_chat_messages.find(
    {"channel": "global", "created_at": {"$gte": "2026-08-31T23:20:00"}},
    {"_id": 0, "created_at": 1, "username": 1, "message": 1},
).sort([("created_at", 1)]):
    msg = (m.get("message") or "").replace("\n", " ")
    if any(k in (msg or "").lower() for k in ("max", "bet", "casino", "bj", "blackjack", "250", "raise")) or m.get("username") in ("HP", "GhostFace"):
        print(f"{m.get('created_at')} | {m.get('username')} | {msg[:160]}")
