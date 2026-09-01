"""Dump Meraxes HDO point requests and username-based helpdesk hits."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
UNAME = "Meraxes"

print("=== hdo point requests ===")
for r in db.help_desk_hdo_point_requests.find({"hdo_user_id": UID}, {"_id": 0}).sort("created_at", 1):
    print({k: r.get(k) for k in ("id", "ticket_id", "status", "amount", "created_at", "action", "hdo_username")})

print("\n=== replies by username ===")
n_tickets = 0
n_replies = 0
for doc in db.help_desk_tickets.find({"replies.author_username": {"$regex": r"^meraxes$", "$options": "i"}}, {"_id": 0, "id": 1, "status": 1, "replies": 1, "closed_by_id": 1}):
    n_tickets += 1
    for rep in doc.get("replies") or []:
        if str(rep.get("author_username") or "").lower() == "meraxes" or rep.get("author_id") == UID:
            n_replies += 1
            print(" ticket", doc["id"], "status", doc.get("status"), "author_id", rep.get("author_id"), "role", rep.get("author_role"), "at", rep.get("created_at"), "body", str(rep.get("body") or "")[:80])
print("tickets", n_tickets, "replies", n_replies)

print("\n=== staff_views by username ===")
nv = 0
for t in db.help_desk_tickets.find({"staff_views.username": {"$regex": r"^meraxes$", "$options": "i"}}, {"_id": 0, "id": 1, "staff_views": 1}):
    nv += 1
    for v in t.get("staff_views") or []:
        if str(v.get("username") or "").lower() == "meraxes" or v.get("user_id") == UID:
            print(" viewed", t["id"], v)
print("viewed tickets", nv)

print("\n=== sample ticket keys ===")
one = db.help_desk_tickets.find_one({}, {"_id": 0})
print(sorted((one or {}).keys()))
print("point request keys sample")
pr = db.help_desk_hdo_point_requests.find_one({"hdo_user_id": UID}, {"_id": 0})
print(sorted((pr or {}).keys()))
print(pr)
