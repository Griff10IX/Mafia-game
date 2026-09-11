"""Fix victim compensation PMs to render as proper System AI inbox cards."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

AVATAR = "/images/system-ai-profile.jpg?v=5"

# Match both broken and already-partially-fixed compensation notifs
filt = {
    "$or": [
        {"type": "system_ai_compensation"},
        {"title": "Point Compensation"},
        {"from_system_ai": True},
    ]
}

docs = list(db.notifications.find(filt, {"_id": 1, "user_id": 1, "title": 1, "system_ai": 1, "notification_type": 1, "avatar_url": 1, "type": 1}))
print(f"Found {len(docs)} compensation notifications to fix\n")
for d in docs:
    print(f"  user={d.get('user_id')} type={d.get('type')} notif_type={d.get('notification_type')} system_ai={d.get('system_ai')} avatar={d.get('avatar_url')}")

result = db.notifications.update_many(
    filt,
    {
        "$set": {
            "notification_type": "system",
            "category": "system",
            "system_ai": True,
            "avatar_url": AVATAR,
            "title": "Point Compensation",
        },
        "$unset": {
            "type": "",
            "from_system_ai": "",
        },
    },
)

print(f"\nFixed {result.modified_count} notifications")

sample = db.notifications.find_one({"title": "Point Compensation", "system_ai": True})
if sample:
    sample.pop("_id", None)
    print("\nSample after fix:")
    for k, v in sample.items():
        if k != "message":
            print(f"  {k}: {v}")
        else:
            print(f"  message: {str(v)[:80]}...")
