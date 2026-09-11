"""Check Zwischenzug's full kill history and previous 'Piece' account."""
import os
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"

print("=== ALL-TIME KILL HISTORY ===")
all_kills = list(db.combat_attempts.find(
    {"attacker_id": USER_ID, "success": True},
    sort=[("created_at", -1)]
))
print(f"Total successful kills ever: {len(all_kills)}")

for kill in all_kills[:20]:
    target = kill.get("target_username", "Unknown")
    when = kill.get("created_at", "?")[:19] if kill.get("created_at") else "?"
    print(f"  {target} at {when}")

print("\n=== SEARCHING FOR 'PIECE' ACCOUNT ===")
piece = db.users.find_one({"username": {"$regex": "^piece$", "$options": "i"}})
if piece:
    print(f"Found: {piece.get('username')} - ID: {piece.get('id')}")
    print(f"  Banned: {piece.get('is_banned', False)}")
    print(f"  Points: {piece.get('points', 0):,}")
    print(f"  Email: {piece.get('email', 'N/A')}")
else:
    print("Not found by username, checking banned users...")
    banned = list(db.users.find({"is_banned": True, "username": {"$regex": "piece", "$options": "i"}}))
    for b in banned:
        print(f"  Found banned: {b.get('username')} - {b.get('email')}")

# Check if same email
zwisch = db.users.find_one({"id": USER_ID})
email = zwisch.get("email", "")
print(f"\n=== ACCOUNTS WITH SAME EMAIL ({email}) ===")
same_email = list(db.users.find({"email": email}))
for acc in same_email:
    print(f"  {acc.get('username')} - Banned: {acc.get('is_banned', False)} - Points: {acc.get('points', 0):,}")

# Check Topic of Shame posts
print("\n=== TOPIC OF SHAME POSTS MENTIONING PIECE/ZWISCHENZUG ===")
shame_posts = list(db.forum_posts.find({
    "$or": [
        {"content": {"$regex": "piece", "$options": "i"}},
        {"content": {"$regex": "zwischenzug", "$options": "i"}},
        {"title": {"$regex": "piece", "$options": "i"}},
        {"title": {"$regex": "zwischenzug", "$options": "i"}}
    ]
}, {"title": 1, "content": 1, "created_at": 1}).limit(5))

for post in shame_posts:
    print(f"  Title: {post.get('title', 'N/A')[:50]}")
    print(f"  Content: {post.get('content', 'N/A')[:100]}...")
    print()

# Check for Topic of Shame thread ID
print("\n=== TOPIC OF SHAME THREAD ===")
shame_thread = db.forum_threads.find_one({"title": {"$regex": "shame", "$options": "i"}})
if shame_thread:
    print(f"Thread ID: {shame_thread.get('id', shame_thread.get('_id'))}")
    print(f"Title: {shame_thread.get('title')}")
    print(f"Category: {shame_thread.get('category_id', shame_thread.get('category'))}")
else:
    print("Not found by title, checking categories...")
    cats = list(db.forum_categories.find({"name": {"$regex": "shame", "$options": "i"}}))
    for c in cats:
        print(f"  Category: {c.get('name')} - ID: {c.get('id', c.get('_id'))}")
