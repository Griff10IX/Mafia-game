"""Watch First-to-post topic; credit 2500 to first player comment; lock; System AI close note."""
import os
import time
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TITLE = "First to post"
POINTS = 2500
AVATAR = "/images/system-ai-avatar.png"
POLL_SECONDS = 2
MAX_SECONDS = 12 * 60 * 60

topic = db.forum_topics.find_one(
    {"title": TITLE, "system_ai": True, "first_post_prize_open": True},
    {"_id": 0, "id": 1, "is_locked": 1},
)
if not topic:
    raise SystemExit("no open first-to-post topic")
topic_id = topic["id"]
print("watching", topic_id, flush=True)

deadline = time.time() + MAX_SECONDS
winner = None
while time.time() < deadline:
    comments = list(
        db.forum_comments.find(
            {
                "topic_id": topic_id,
                "author_id": {"$nin": ["system_ai", ""]},
                "system_ai": {"$ne": True},
            },
            {"_id": 0, "id": 1, "author_id": 1, "author_username": 1, "content": 1, "created_at": 1},
        ).sort("created_at", 1).limit(5)
    )
    comments = [c for c in comments if (c.get("author_id") or "") != "system_ai"]
    if comments:
        winner = comments[0]
        break
    time.sleep(POLL_SECONDS)

if not winner:
    print("timed out, no winner", flush=True)
    raise SystemExit(2)

uid = winner["author_id"]
uname = winner.get("author_username") or "?"
now_iso = datetime.now(timezone.utc).isoformat()
print("winner", uname, uid, winner.get("created_at"), winner.get("id"), flush=True)

# Lock immediately so nobody else can post via the API.
db.forum_topics.update_one(
    {"id": topic_id, "first_post_prize_open": True},
    {
        "$set": {
            "is_locked": True,
            "updated_at": now_iso,
            "first_post_prize_open": False,
            "first_post_prize_winner_id": uid,
            "first_post_prize_winner_username": uname,
            "first_post_prize_awarded_at": now_iso,
        }
    },
)

user = db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "username": 1, "points": 1})
if not user:
    raise SystemExit(f"winner user missing {uid}")

pts_before = int(user.get("points") or 0)
db.users.update_one({"id": uid}, {"$inc": {"points": POINTS}})
db.point_ledger_events.insert_one(
    {
        "id": str(uuid.uuid4()),
        "event_type": "system_ai_first_to_post",
        "user_id": uid,
        "points": POINTS,
        "lot_id": None,
        "origin_ref": f"system_ai_first_to_post:{topic_id}",
        "root_purchase_ref": None,
        "meta": {"topic_id": topic_id, "comment_id": winner.get("id")},
        "created_at": now_iso,
        "wallet_points_before": pts_before,
        "wallet_points_after": pts_before + POINTS,
        "source": "system_ai",
    }
)

inbox_body = (
    f"{uname},\n\n"
    "This is the system AI. You were first to post.\n\n"
    "2,500 points are already on your account.\n\n"
    "— System AI"
)
db.notifications.insert_one(
    {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "title": "First to post",
        "message": inbox_body,
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)

close_body = (
    f"{uname} was first. 2,500 points are on that account.\n\n"
    "This topic is closed. There will be more.\n\n"
    "— System AI"
)
db.forum_comments.insert_one(
    {
        "id": str(uuid.uuid4()),
        "topic_id": topic_id,
        "author_id": "system_ai",
        "author_username": "System AI",
        "system_ai": True,
        "avatar_url": AVATAR,
        "content": close_body,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "likes": 0,
    }
)
print("awarded", uname, pts_before, "->", pts_before + POINTS, flush=True)
print("done", flush=True)
