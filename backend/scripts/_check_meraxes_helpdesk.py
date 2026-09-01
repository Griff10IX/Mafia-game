"""Meraxes help desk: viewed, replied, closed."""
import os
from collections import Counter
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

users = list(
    db.users.find(
        {"username": {"$regex": r"^meraxes$", "$options": "i"}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "is_help_desk_operator": 1,
            "is_admin": 1,
            "is_moderator": 1,
            "is_dead": 1,
        },
    )
)
print("users", users)
if not users:
    near = list(
        db.users.find(
            {"username": {"$regex": "merax", "$options": "i"}},
            {"_id": 0, "id": 1, "username": 1, "is_help_desk_operator": 1},
        ).limit(15)
    )
    print("near", near)
    raise SystemExit("no Meraxes")

for u in users:
    uid = u["id"]
    uname = u.get("username")
    print("\n========", uname, uid, "hdo=", u.get("is_help_desk_operator"), "mod=", u.get("is_moderator"), "dead=", u.get("is_dead"))

    viewed_tickets = list(
        db.help_desk_tickets.find(
            {"staff_views.user_id": uid},
            {"_id": 0, "id": 1, "status": 1, "category": 1, "subject": 1, "created_at": 1, "staff_views": 1, "replies": 1, "closed_by_id": 1, "user_id": 1},
        )
    )
    print("tickets opened/viewed (staff_views)", len(viewed_tickets))

    replied_ticket_ids = set()
    reply_count = 0
    reply_roles = Counter()
    first_reply = None
    last_reply = None
    cursor = db.help_desk_tickets.find({"replies.author_id": uid}, {"_id": 0, "id": 1, "replies": 1})
    for doc in cursor:
        n = 0
        for rep in doc.get("replies") or []:
            if rep.get("author_id") == uid:
                n += 1
                at = str(rep.get("created_at") or "")
                if at and (first_reply is None or at < first_reply):
                    first_reply = at
                if at and (last_reply is None or at > last_reply):
                    last_reply = at
                reply_roles[rep.get("author_role") or "?"] += 1
        if n:
            replied_ticket_ids.add(doc["id"])
            reply_count += n
    print("tickets replied on", len(replied_ticket_ids))
    print("total replies", reply_count)
    print("reply roles", dict(reply_roles))
    print("first reply", first_reply)
    print("last reply", last_reply)

    closed = db.help_desk_tickets.count_documents({"closed_by_id": uid, "status": "closed"})
    closed_any = db.help_desk_tickets.count_documents({"closed_by_id": uid})
    print("tickets closed by them (status closed)", closed, "closed_by any status", closed_any)

    helped = list(
        db.help_desk_tickets.aggregate(
            [
                {"$match": {"closed_by_id": uid, "status": "closed", "user_id": {"$ne": uid}}},
                {"$group": {"_id": "$user_id"}},
                {"$count": "n"},
            ]
        )
    )
    print("users helped (closed)", (helped[0]["n"] if helped else 0))

    viewed_not_replied = sum(1 for t in viewed_tickets if t["id"] not in replied_ticket_ids)
    print("viewed but never replied", viewed_not_replied)

    # view timestamps
    view_ats = []
    for t in viewed_tickets:
        for v in t.get("staff_views") or []:
            if v.get("user_id") == uid:
                view_ats.append(str(v.get("viewed_at") or ""))
    view_ats = [a for a in view_ats if a]
    if view_ats:
        print("first view", min(view_ats), "last view", max(view_ats))

    pr = list(db.help_desk_hdo_point_requests.find({"hdo_user_id": uid}, {"_id": 0, "status": 1, "amount": 1}))
    print("hdo point requests", len(pr), dict(Counter(r.get("status") for r in pr)))
    approved = sum(int(r.get("amount") or 0) for r in pr if r.get("status") == "approved")
    print("approved close-reward points", approved)

    # own tickets
    own = db.help_desk_tickets.count_documents({"user_id": uid})
    print("tickets they opened as player", own)
