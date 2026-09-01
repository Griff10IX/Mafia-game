"""Inspect Meraxes close-context threads and whether those tickets still exist."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "7c4e21c6-9d20-4b19-8911-d895e008a134"

print("=== each close request ===")
for r in db.help_desk_hdo_point_requests.find({"hdo_user_id": UID}, {"_id": 0}).sort("created_at", 1):
    tid = r.get("ticket_id")
    t = db.help_desk_tickets.find_one({"id": tid}, {"_id": 0, "id": 1, "status": 1, "closed_by_id": 1, "replies": 1, "staff_views": 1, "subject": 1})
    ctx = r.get("close_context") or {}
    thread = ctx.get("thread") or []
    merax_msgs = [x for x in thread if str(x.get("author_username") or "").lower() == "meraxes" or x.get("author_id") == UID]
    print("---")
    print("status", r.get("status"), "when", r.get("created_at"), "player", r.get("ticket_owner_username"))
    print("subject", ctx.get("subject") or (t or {}).get("subject"))
    print("ticket exists", bool(t), "ticket status", (t or {}).get("status"), "closed_by", (t or {}).get("closed_by_id"))
    if t:
        print("  replies now", len(t.get("replies") or []), "views", len(t.get("staff_views") or []))
        print("  reply authors", [x.get("author_username") for x in (t.get("replies") or [])])
    print("  snapshot msgs from Meraxes", len(merax_msgs))
    for m in merax_msgs:
        print("   ", m.get("created_at"), (m.get("body") or "")[:120])
    if not merax_msgs and thread:
        print("  snapshot authors", [(x.get("author_username"), x.get("author_role")) for x in thread])
