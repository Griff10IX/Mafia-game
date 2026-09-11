"""Update Topic of Shame with point distribution info."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TOPIC_ID = "f9c2a727-366b-49b6-b927-2cb190d0012a"
now = datetime.now(timezone.utc)
today = now.strftime("%Y-%m-%d")

# Get current content
topic = db.forum_topics.find_one({"id": TOPIC_ID})
current_content = topic.get("content", "")

# Find the Zwischenzug entry and update it
# We need to add the refund info to the existing entry
OLD_EFFECT = "[*][color=#888888][b]Effect:[/b] Account banned and killed. Entire IPv6 /48 block permanently banned. No victims — trap caught them before any kills succeeded.[/color]"

NEW_EFFECT = """[*][color=#888888][b]Effect:[/b] Account banned and killed. Entire IPv6 /48 block permanently banned. Dead > Alive (£10 revive) permanently blocked.[/color]
[*][color=#888888][b]Points redistributed:[/b] 359,637 points split equally among victims:[/color]
[list]
[*][color=#888888]Crosis: +71,929 points[/color]
[*][color=#888888]Rabbit: +71,927 points[/color]
[*][color=#888888]Highlights: +71,927 points[/color]
[*][color=#888888]xemon: +71,927 points[/color]
[*][color=#888888]stle88: +71,927 points[/color]
[/list]"""

# Also update "No victims" text
OLD_NOTE = "[*][color=#888888][b]Note:[/b] This was an [b]autonomous decision[/b] by System AI. Piece was unbanned on 2026-08-23 on probation with warning \"Any further rule break is a permanent ban.\" Botting is a rule break.[/color]"

NEW_NOTE = "[*][color=#888888][b]Note:[/b] This was an [b]autonomous decision[/b] by System AI. Piece was unbanned on 2026-08-23 on probation with warning \"Any further rule break is a permanent ban.\" Botting is a rule break. 5 victims identified and compensated.[/color]"

# Update the content
new_content = current_content.replace(OLD_EFFECT, NEW_EFFECT)
new_content = new_content.replace(OLD_NOTE, NEW_NOTE)

# Update the topic
db.forum_topics.update_one(
    {"id": TOPIC_ID},
    {"$set": {"content": new_content, "updated_at": now.isoformat()}}
)

print("✓ Topic of Shame updated with:")
print("  - Points redistribution details")
print("  - Dead > Alive block info")
print("  - Victim compensation list")
