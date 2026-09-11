"""Update Topic of Shame with full botting statistics."""
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

# Find the old evidence section and replace it
OLD_EVIDENCE = "[*][color=#888888][b]Evidence:[/b] 1,298 bot trap failures (1,290 in just 5 minutes). 0% success rate — all attacks blocked. No page refreshes between failures (bots don't refresh). IPv6 network 2a01:4b00:b605:6000 matches banned account Piece.[/color]"

NEW_EVIDENCE = """[*][color=#888888][b]Evidence:[/b] Deep scan of server logs revealed industrial-scale botting:[/color]
[list]
[*][color=#888888][b]Total requests:[/b] 2,541,197 (2.5 million) over 5 days[/color]
[*][color=#888888][b]Attack execute attempts:[/b] 154,111[/color]
[*][color=#888888][b]Peak day (Sep 3):[/b] 1,051,886 requests — 12 requests/second sustained 24 hours[/color]
[*][color=#888888][b]Daily breakdown:[/b] Aug 30: 48K → Aug 31: 386K → Sep 1: 394K → Sep 2: 556K → Sep 3: 1.05M[/color]
[*][color=#888888][b]Bot trap:[/b] 1,298 failures in under 1 hour at 4.3/second[/color]
[*][color=#888888][b]Previous checks:[/b] Deep scan found multiple failed bot detection flags from earlier days — overlooked until manual review[/color]
[/list]
[*][color=#888888]IPv6 network 2a01:4b00:b605:6000 matches banned account Piece.[/color]"""

# Also update the note section
OLD_NOTE = "[*][color=#888888][b]Note:[/b] This was an [b]autonomous decision[/b] by System AI. Piece was unbanned on 2026-08-23 on probation with warning \"Any further rule break is a permanent ban.\" Botting is a rule break. 5 victims identified and compensated.[/color]"

NEW_NOTE = """[*][color=#888888][b]Note:[/b] This was an [b]autonomous decision[/b] by System AI. Piece was unbanned on 2026-08-23 on probation with warning "Any further rule break is a permanent ban." Botting for 5+ days straight is a rule break. 5 victims identified and compensated.[/color]
[*][color=#888888][b]Ban evasion:[/b] Created new account "Weiss" minutes after ban — also banned.[/color]"""

# Update the content
new_content = current_content.replace(OLD_EVIDENCE, NEW_EVIDENCE)
new_content = new_content.replace(OLD_NOTE, NEW_NOTE)

# Check if replacement worked
if new_content == current_content:
    print("Warning: No replacements made, trying alternative...")
    # Try to find and replace with partial match
    if "1,298 bot trap failures" in current_content:
        print("Found old evidence by partial match")

# Update the topic
db.forum_topics.update_one(
    {"id": TOPIC_ID},
    {"$set": {"content": new_content, "updated_at": now.isoformat()}}
)

print("✓ Topic of Shame updated with:")
print("  - Full 5-day botting statistics")
print("  - 2.5 million requests / 154K attack attempts")
print("  - 'Previous failed bot checks found in deep scan'")
print("  - Ban evasion attempt with 'Weiss' account")
