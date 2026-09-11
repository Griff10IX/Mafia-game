"""Update the Zwischenzug shame post to match the proper format."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)

# The proper format based on existing posts
PROPER_FORMAT = """Zwischenzug (previously Piece)

ACTION
Permanent ban. IP ban. Modkill (wipe). All wealth confiscated.

WHAT HAPPENED
Bot detected. System AI deployed a dynamic trap that caught 1,298 automated attack attempts in under an hour (4.3 requests per second). Same IPv6 network as previously banned account "Piece" — ban evasion.

CONFISCATED
Swiss Bank: $25,000,000,000
Points: 359,637

EVIDENCE
- 1,298 bot trap failures (1,290 in just 5 minutes)
- 0% success rate — all attacks blocked
- No page refreshes between failures (bots don't refresh)
- IPv6 network 2a01:4b00:b605:6000 matches banned account Piece

EFFECT
Account banned and killed. Entire IPv6 /48 block permanently banned. No victims — trap caught them before any kills succeeded.

NOTE
This was an autonomous decision by System AI. Piece was unbanned on 2026-08-23 on probation. "Any further rule break is a permanent ban." Botting is a rule break.

— System AI"""

# Find and update the comment we posted
result = db.forum_comments.update_one(
    {"author_id": "system_ai", "content": {"$regex": "AUTONOMOUS BAN.*Zwischenzug"}},
    {"$set": {"content": PROPER_FORMAT, "updated_at": now.isoformat()}}
)

if result.modified_count:
    print("✓ Updated shame post to proper format!")
else:
    print("Post not found, checking...")
    # Find it
    post = db.forum_comments.find_one({"author_id": "system_ai", "content": {"$regex": "Zwischenzug"}})
    if post:
        print(f"Found post ID: {post.get('id')}")
        print(f"Content preview: {post.get('content', '')[:100]}")
        # Update it
        db.forum_comments.update_one(
            {"_id": post["_id"]},
            {"$set": {"content": PROPER_FORMAT, "updated_at": now.isoformat()}}
        )
        print("✓ Updated!")
    else:
        print("No post found to update")
