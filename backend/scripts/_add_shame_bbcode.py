"""Add Zwischenzug ban to Topic of Shame in proper BBCode format."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TOPIC_ID = "f9c2a727-366b-49b6-b927-2cb190d0012a"
now = datetime.now(timezone.utc)
today = now.strftime("%Y-%m-%d")

# New entry in BBCode format
NEW_ENTRY = f"""
[size=1.5][b][color=#2ECC71]{today}[/color][/b] — [b]Zwischenzug (previously Piece)[/b][/size]
[quote]
[list]
[*][color=#888888][b]Action:[/b] Permanent ban. IP ban. Modkill (wipe). All wealth confiscated.[/color]
[*][color=#888888][b]What happened:[/b] Bot detected. System AI deployed a dynamic trap that caught [b]1,298 automated attack attempts[/b] in under an hour — [b]4.3 requests per second[/b]. Same IPv6 network as previously banned account "Piece" — ban evasion.[/color]
[*][color=#888888][b]Confiscated:[/b] Swiss Bank $25,000,000,000. Points 359,637.[/color]
[*][color=#888888][b]Evidence:[/b] 1,298 bot trap failures (1,290 in just 5 minutes). 0% success rate — all attacks blocked. No page refreshes between failures (bots don't refresh). IPv6 network 2a01:4b00:b605:6000 matches banned account Piece.[/color]
[*][color=#888888][b]Effect:[/b] Account banned and killed. Entire IPv6 /48 block permanently banned. No victims — trap caught them before any kills succeeded.[/color]
[*][color=#888888][b]Note:[/b] This was an [b]autonomous decision[/b] by System AI. Piece was unbanned on 2026-08-23 on probation with warning "Any further rule break is a permanent ban." Botting is a rule break.[/color]
[/list]
[/quote]

[hr]
"""

# Get current topic content
topic = db.forum_topics.find_one({"id": TOPIC_ID})
if not topic:
    print("Topic not found!")
    exit(1)

current_content = topic.get("content", "")

# Find where to insert (after the header quote, before first entry)
# Insert at the beginning of entries (after the [hr] following the header)
header_end = current_content.find("[hr]") + 4  # After first [hr]

# Insert our new entry
new_content = current_content[:header_end] + NEW_ENTRY + current_content[header_end:]

# Update the topic
db.forum_topics.update_one(
    {"id": TOPIC_ID},
    {"$set": {"content": new_content, "updated_at": now.isoformat()}}
)

print("✓ Added Zwischenzug ban to Topic of Shame in BBCode format!")
print(f"  Date: {today}")
print(f"  Position: Top of entries (after header)")

# Remove the comment we added earlier
deleted = db.forum_comments.delete_one({"topic_id": TOPIC_ID, "author_id": "system_ai", "content": {"$regex": "Zwischenzug"}})
if deleted.deleted_count:
    print(f"  Cleaned up comment (moved to topic body)")
