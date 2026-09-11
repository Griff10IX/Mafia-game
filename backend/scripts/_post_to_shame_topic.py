"""Post Zwischenzug ban to the actual Topic of Shame."""
import os
import uuid
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
now_iso = now.isoformat()

SAI_AVATAR = "/images/system-ai-profile.jpg?v=5"

# Find Topic of Shame
shame_topic = db.forum_topics.find_one({"title": {"$regex": "shame", "$options": "i"}})
if shame_topic:
    print(f"Found Topic of Shame:")
    print(f"  ID: {shame_topic.get('id', shame_topic.get('_id'))}")
    print(f"  Title: {shame_topic.get('title')}")
    topic_id = shame_topic.get('id', str(shame_topic.get('_id')))
else:
    print("Topic of Shame not found!")
    exit(1)

# Check the structure of forum_comments to match it
sample = db.forum_comments.find_one({})
if sample:
    print(f"\nSample comment structure:")
    for k in sample.keys():
        print(f"  {k}: {type(sample[k]).__name__}")

# Create the ban announcement comment/post
SHAME_POST = f"""## 🤖 AUTONOMOUS BAN: Zwischenzug (aka Piece)

**Ban Date:** {now.strftime('%B %d, %Y at %H:%M UTC')}
**Banned By:** System AI (Autonomous Detection)
**Ban Type:** Permanent

---

### The Evidence

**Bot Detection Results:**
- **1,298** automated attack attempts detected
- **1,290** failures in just 5 minutes 
- **4.3 requests per second** (impossible for human)
- **0% success rate** - all attacks blocked by trap

**Identity Verification:**
- Same IPv6 network (`2a01:4b00:b605:6000`) as previously banned account **"Piece"**
- This is ban evasion

**Confiscated Assets:**
- Swiss Bank: **$25,000,000,000**
- Points: **359,637**

---

### How They Got Caught

System AI deployed a dynamic bot trap that required a secret verification code. Human players get this code automatically when they refresh the page. Bots don't refresh - they just hammer the API.

Zwischenzug's bot failed **1,298 times in a row** without ever refreshing. A human would have stopped after 1-2 failures. A bot just keeps going.

---

### Verdict

**Account Status:** Banned, Killed, Wealth Stripped
**IP Status:** Entire IPv6 /48 block permanently banned
**Victims:** None - trap caught them before any kills succeeded

*This was an autonomous decision by System AI. Play fair or get caught.* 🎯"""

# Create the comment/post
comment_doc = {
    "id": str(uuid.uuid4()),
    "topic_id": topic_id,
    "author_id": "system_ai",
    "author_username": "System AI",
    "content": SHAME_POST,
    "created_at": now_iso,
    "updated_at": now_iso,
    "likes": 0,
    "dislikes": 0,
    "is_staff": True,
    "avatar_url": SAI_AVATAR,
    "pinned": True,
}

db.forum_comments.insert_one(comment_doc)
print(f"\n✓ Posted to Topic of Shame!")
print(f"  Comment ID: {comment_doc['id']}")

# Update topic's last activity
db.forum_topics.update_one(
    {"id": topic_id} if shame_topic.get('id') else {"_id": shame_topic.get('_id')},
    {"$set": {"last_activity": now_iso, "updated_at": now_iso}, "$inc": {"comment_count": 1, "reply_count": 1}}
)
print(f"  Topic updated with new activity")

# Also clean up the forum_threads post we made earlier if needed
deleted = db.forum_threads.delete_one({"title": {"$regex": "Zwischenzug.*Botting", "$options": "i"}})
if deleted.deleted_count:
    print(f"  Cleaned up duplicate thread entry")
