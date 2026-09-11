"""Find and update Topic of Shame with Zwischenzug ban."""
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

# Find Topic of Shame - check multiple possible locations
print("=== SEARCHING FOR TOPIC OF SHAME ===")

# Check forum_threads for shame
shame_thread = db.forum_threads.find_one({
    "$or": [
        {"title": {"$regex": "shame", "$options": "i"}},
        {"slug": {"$regex": "shame", "$options": "i"}},
        {"category": {"$regex": "shame", "$options": "i"}},
    ]
})

# Check forum_categories
shame_cat = db.forum_categories.find_one({
    "$or": [
        {"name": {"$regex": "shame", "$options": "i"}},
        {"slug": {"$regex": "shame", "$options": "i"}},
    ]
})

# Check forum_topics
shame_topic = db.forum_topics.find_one({
    "$or": [
        {"title": {"$regex": "shame", "$options": "i"}},
        {"name": {"$regex": "shame", "$options": "i"}},
    ]
})

# List all collections to find forum structure
print("\nCollections with 'forum':")
for coll in db.list_collection_names():
    if 'forum' in coll.lower():
        print(f"  {coll}: {db[coll].count_documents({})}")

print("\nShame thread found:", shame_thread.get("title") if shame_thread else None)
print("Shame category found:", shame_cat.get("name") if shame_cat else None)
print("Shame topic found:", shame_topic.get("title") if shame_topic else None)

# Let's look at all threads
print("\n=== ALL FORUM THREADS ===")
threads = list(db.forum_threads.find({}, {"title": 1, "id": 1, "category_id": 1, "category": 1}).limit(20))
for t in threads:
    print(f"  {t.get('title', 'N/A')[:50]} - cat: {t.get('category_id', t.get('category', 'N/A'))}")

# Check forum_posts collection
print("\n=== FORUM_POSTS COLLECTION ===")
posts = list(db.forum_posts.find({}).limit(5))
for p in posts:
    print(f"  {p.get('title', p.get('thread_title', 'N/A'))[:40]}")

# If we have Piece mentioned anywhere in forum
print("\n=== EXISTING PIECE MENTIONS IN FORUM ===")
piece_mentions = list(db.forum_threads.find({"content": {"$regex": "piece", "$options": "i"}}).limit(5))
for p in piece_mentions:
    print(f"  Thread: {p.get('title', 'N/A')[:50]}")

piece_posts = list(db.forum_posts.find({"content": {"$regex": "piece", "$options": "i"}}).limit(5))
for p in piece_posts:
    print(f"  Post: {p.get('content', 'N/A')[:50]}")
