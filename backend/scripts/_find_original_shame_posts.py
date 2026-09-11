"""Find the original shame posts to copy their exact format."""
import os
import json
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TOPIC_ID = "f9c2a727-366b-49b6-b927-2cb190d0012a"

print("=== ALL COMMENTS IN TOPIC OF SHAME ===\n")
comments = list(db.forum_comments.find({"topic_id": TOPIC_ID}).sort("created_at", 1))
print(f"Total comments: {len(comments)}\n")

for i, c in enumerate(comments):
    print(f"--- Comment {i+1} ---")
    print(f"Author: {c.get('author_username')}")
    print(f"Created: {c.get('created_at')}")
    print(f"Content:\n{c.get('content', '')}\n")
    print("=" * 50)

# Also check the main topic content
print("\n=== MAIN TOPIC CONTENT ===")
topic = db.forum_topics.find_one({"id": TOPIC_ID})
if topic:
    print(f"Title: {topic.get('title')}")
    print(f"Content:\n{topic.get('content', '')}")
