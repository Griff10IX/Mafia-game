"""List open System AI reports + recent System AI inbox messages."""
import os
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

print("=== system_ai_reports OPEN ===")
open_reps = list(db.system_ai_reports.find({"status": "open"}, {"_id": 0}).sort("created_at", -1).limit(20))
print(f"count={len(open_reps)}")
for r in open_reps:
    print("-" * 50)
    print(f"id={r.get('id')} by={r.get('username')} cat={r.get('category')} created={r.get('created_at')}")
    print(f"subject={r.get('subject')!r}")
    body = (r.get("body") or r.get("details") or r.get("message") or "")[:400]
    print(f"body={body!r}")

print("\n=== system_ai_reports ALL recent (any status, 48h) ===")
since = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
recent = list(
    db.system_ai_reports.find({"created_at": {"$gte": since}}, {"_id": 0})
    .sort("created_at", -1)
    .limit(15)
)
print(f"count={len(recent)}")
for r in recent:
    print(f"  {r.get('created_at')} [{r.get('status')}] {r.get('username')} — {r.get('category')} / {r.get('subject')!r}")

print("\n=== inbox messages from System AI (48h) ===")
# try common inbox collections
for coll_name in ("inbox_messages", "messages", "private_messages", "inbox"):
    try:
        coll = db[coll_name]
        n = coll.count_documents(
            {
                "$or": [
                    {"from_username": "System AI"},
                    {"sender_username": "System AI"},
                    {"author_username": "System AI"},
                    {"from_user_id": "system_ai"},
                    {"sender_id": "system_ai"},
                    {"system_ai": True},
                ],
                "created_at": {"$gte": since},
            }
        )
        if n:
            print(f"{coll_name}: {n}")
            rows = list(
                coll.find(
                    {
                        "$or": [
                            {"from_username": "System AI"},
                            {"sender_username": "System AI"},
                            {"author_username": "System AI"},
                            {"from_user_id": "system_ai"},
                            {"sender_id": "system_ai"},
                            {"system_ai": True},
                        ],
                        "created_at": {"$gte": since},
                    },
                    {"_id": 0},
                )
                .sort("created_at", -1)
                .limit(10)
            )
            for m in rows:
                to = m.get("to_username") or m.get("recipient_username") or m.get("user_id")
                subj = m.get("subject") or ""
                preview = (m.get("body") or m.get("content") or m.get("message") or "")[:120]
                print(f"  {m.get('created_at')} -> {to} | {subj!r} | {preview!r}")
    except Exception as e:
        print(f"{coll_name}: err {e}")

# sample one inbox doc keys if exists
sample = db.inbox_messages.find_one({}, {"_id": 0}) or db.messages.find_one({}, {"_id": 0})
if sample:
    print("\ninbox sample keys:", sorted(sample.keys())[:40])
