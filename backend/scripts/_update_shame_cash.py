"""Update Topic of Shame with correct confiscated cash amount."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TOPIC_ID = "f9c2a727-366b-49b6-b927-2cb190d0012a"
now = datetime.now(timezone.utc)

# Get current content
topic = db.forum_topics.find_one({"id": TOPIC_ID})
current_content = topic.get("content", "")

# Find and replace the confiscated line
OLD_CONFISCATED = "[*][color=#888888][b]Confiscated:[/b] Swiss Bank $25,000,000,000. Points 359,637 (redistributed to 5 victims).[/color]"

NEW_CONFISCATED = "[*][color=#888888][b]Confiscated:[/b] $481,337,850,034 total wealth. Points 359,637 (redistributed to 5 victims).[/color]"

new_content = current_content.replace(OLD_CONFISCATED, NEW_CONFISCATED)

if new_content == current_content:
    print("Exact match not found, trying partial...")
    # Try partial match
    if "Swiss Bank $25,000,000,000" in current_content:
        new_content = current_content.replace(
            "Swiss Bank $25,000,000,000",
            "$481,337,850,034 total wealth"
        )
        print("Replaced via partial match")

db.forum_topics.update_one(
    {"id": TOPIC_ID},
    {"$set": {"content": new_content, "updated_at": now.isoformat()}}
)

print("✓ Topic of Shame updated:")
print("  Confiscated: $481,337,850,034 (~$481B)")
