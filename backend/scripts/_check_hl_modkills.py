"""Dump recent chat + Highlights modkill file for System AI replies."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

print("=== recent global ===")
for m in db.game_chat_messages.find(
    {"channel": "global"},
    {"_id": 0, "id": 1, "user_id": 1, "username": 1, "message": 1, "created_at": 1, "reply_to": 1},
).sort("created_at", -1).limit(20):
    rt = m.get("reply_to") or {}
    print(
        m.get("created_at"),
        "|",
        m.get("username"),
        "|",
        (m.get("message") or "").replace("\n", " ")[:140],
        "| rt",
        rt.get("username"),
        "| id",
        m.get("id"),
    )

hl = db.users.find_one(
    {"username": {"$regex": "^Highlights$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "email": 1,
        "email_before_freed": 1,
        "is_dead": 1,
        "modkill_wipe": 1,
        "killed_by_username": 1,
        "dead_at": 1,
        "registration_ip": 1,
        "last_login_ip": 1,
    },
)
print("\n=== highlights user ===")
print(hl)
uid = (hl or {}).get("id")
email = (hl or {}).get("email") or ""
ebf = (hl or {}).get("email_before_freed") or ""
emails = [e for e in {email.lower(), ebf.lower()} if e]
print("emails", emails)

q = {"$or": [{"id": uid}]}
if emails:
    q["$or"].extend(
        [
            {"email": {"$in": list(emails)}},
            {"email_before_freed": {"$in": list(emails)}},
        ]
    )
line = list(
    db.users.find(
        q,
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "is_dead": 1,
            "modkill_wipe": 1,
            "killed_by_username": 1,
            "dead_at": 1,
            "created_at": 1,
        },
    )
)
print("\n=== lineage accounts ===")
for u in line:
    print(u)

print("\n=== staff-killed / wipe on lineage ===")
staffish = [
    u
    for u in line
    if u.get("modkill_wipe") or "Staff" in str(u.get("killed_by_username") or "")
]
print("count", len(staffish))
for u in staffish:
    print(u)

print("\n=== shame comments mentioning Highlights ===")
for c in db.forum_comments.find(
    {"content": {"$regex": "Highlights", "$options": "i"}},
    {"_id": 0, "created_at": 1, "author_username": 1, "content": 1},
).sort("created_at", -1).limit(8):
    print(c.get("created_at"), (c.get("content") or "")[:200])

print("\n=== attack_attempts staff vs highlights names ===")
names = [u.get("username") for u in line if u.get("username")]
if names:
    for a in db.attack_attempts.find(
        {
            "$or": [
                {"defender_username": {"$in": names}},
                {"target_username": {"$in": names}},
            ],
            "$or2": [],
        }
    ).limit(0):
        pass
    atks = list(
        db.attack_attempts.find(
            {
                "$and": [
                    {
                        "$or": [
                            {"defender_username": {"$in": names}},
                            {"target_username": {"$in": names}},
                            {"defender_id": uid},
                            {"target_id": uid},
                        ]
                    },
                    {
                        "$or": [
                            {"attacker_username": {"$regex": "Staff", "$options": "i"}},
                            {"killed_by_username": {"$regex": "Staff", "$options": "i"}},
                            {"is_modkill": True},
                            {"modkill": True},
                        ]
                    },
                ]
            },
            {"_id": 0, "created_at": 1, "attacker_username": 1, "defender_username": 1, "result": 1, "is_modkill": 1},
        ).sort("created_at", -1).limit(15)
    )
    print("staff attacks", len(atks))
    for a in atks:
        print(a)
