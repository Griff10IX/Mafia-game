"""Check the actual structure of Topic of Shame posts."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Get the Topic of Shame
shame_topic = db.forum_topics.find_one({"title": {"$regex": "shame", "$options": "i"}})
topic_id = shame_topic.get("id") if shame_topic else None
print(f"Topic of Shame ID: {topic_id}")
print(f"Topic structure: {list(shame_topic.keys()) if shame_topic else 'N/A'}")

# Check if posts are stored IN the topic itself
if shame_topic:
    print(f"\nTopic has 'posts' field: {'posts' in shame_topic}")
    print(f"Topic has 'content' field: {'content' in shame_topic}")
    print(f"Topic has 'comments' field: {'comments' in shame_topic}")
    if shame_topic.get('posts'):
        print(f"Posts in topic: {len(shame_topic.get('posts', []))}")
        for p in shame_topic.get('posts', [])[:2]:
            print(f"  Post keys: {list(p.keys()) if isinstance(p, dict) else type(p)}")

# Get comments for this topic
print(f"\n=== COMMENTS FOR TOPIC {topic_id} ===")
comments = list(db.forum_comments.find({"topic_id": topic_id}).sort("created_at", -1).limit(5))
print(f"Found {len(comments)} comments")
for c in comments:
    print(f"\n  ID: {c.get('id')}")
    print(f"  Author: {c.get('author_username')}")
    print(f"  Content preview: {c.get('content', '')[:100]}...")
    print(f"  Keys: {list(c.keys())}")

# Check if there's a different collection for topic posts
print(f"\n=== ALL COLLECTIONS ===")
for coll in sorted(db.list_collection_names()):
    if 'forum' in coll.lower() or 'topic' in coll.lower() or 'shame' in coll.lower():
        count = db[coll].count_documents({})
        print(f"  {coll}: {count}")

# Look at the "Piece" unban post to see its structure
print(f"\n=== LOOKING FOR PIECE UNBAN POST ===")
piece_post = db.forum_comments.find_one({"content": {"$regex": "Piece.*unbanned", "$options": "i"}})
if piece_post:
    print(f"Found in forum_comments:")
    print(f"  Keys: {list(piece_post.keys())}")
    print(f"  Content: {piece_post.get('content', '')[:200]}")
else:
    # Check in forum_topics content
    piece_topic = db.forum_topics.find_one({"content": {"$regex": "Piece", "$options": "i"}})
    if piece_topic:
        print(f"Found in forum_topics content field")
