"""Dump Meraxes loot ticket replies in order."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
tid = "50e393c2-406f-453d-8b8c-d01aab27fcb2"
t = db.help_desk_tickets.find_one({"id": tid}, {"_id": 0, "body": 1, "replies": 1, "username": 1, "status": 1})
print("user", t.get("username"), "status", t.get("status"))
print("BODY:", t.get("body"))
for i, r in enumerate(t.get("replies") or []):
    print("---", i, r.get("created_at"), r.get("author_username"), r.get("author_role"), "ai", r.get("system_ai"))
    print((r.get("body") or "")[:400])
