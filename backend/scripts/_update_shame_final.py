"""Final update to Topic of Shame with full wipe details."""
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

# Find and replace the Zwischenzug entry entirely with the final version
# First find where it starts
start_marker = f"[size=1.5][b][color=#2ECC71]{today}[/color][/b] — [b]Zwischenzug"

# The complete updated entry
NEW_ENTRY = f"""[size=1.5][b][color=#2ECC71]{today}[/color][/b] — [b]Zwischenzug (previously Piece)[/b][/size]
[quote]
[list]
[*][color=#888888][b]Action:[/b] Permanent ban. IP ban. Full modkill (wipe). All wealth confiscated. Dead > Alive blocked.[/color]
[*][color=#888888][b]What happened:[/b] Bot detected. System AI deployed a dynamic trap that caught [b]4,928 automated attack attempts[/b] in 21 minutes (3.9 requests per second). Deep scan revealed 5 days of industrial-scale botting.[/color]
[*][color=#888888][b]Evidence — Deep scan of server logs:[/b][/color]
[list]
[*][color=#888888][b]Total requests:[/b] 2,541,197 (2.5 million) over 5 days[/color]
[*][color=#888888][b]Attack execute attempts:[/b] 154,111[/color]
[*][color=#888888][b]Peak day (Sep 3):[/b] 1,051,886 requests — 12 requests/second sustained 24 hours[/color]
[*][color=#888888][b]Bot trap:[/b] 4,928 failures in 21 minutes at 3.9/second — no refreshes, no stopping[/color]
[*][color=#888888][b]Previous checks:[/b] Deep scan found failed bot detection flags from earlier days[/color]
[/list]
[*][color=#888888][b]Identity:[/b] Same IPv6 network (2a01:4b00:b605:6000) as banned account "Piece" — ban evasion.[/color]
[*][color=#888888][b]Confiscated:[/b] Swiss Bank $25,000,000,000. Points 359,637 (redistributed to 5 victims).[/color]
[*][color=#888888][b]Modkill wipe deleted:[/b] 4 bodyguards, 5,568 cars, 4 properties, 11 weapons, 1 weed farm, 27,037 gambling logs, 134,429 bust events, 96,644 crime events.[/color]
[*][color=#888888][b]Returned to game:[/b] Vault relic (bail_bond_ring), exclusive loot (weapon, car, armour, property).[/color]
[*][color=#888888][b]Linked accounts also wiped:[/b] Intermezzo, Weiss.[/color]
[*][color=#888888][b]Points redistributed:[/b] 359,637 points split to victims: Crosis (+71,929), Rabbit (+71,927), Highlights (+71,927), xemon (+71,927), stle88 (+71,927).[/color]
[*][color=#888888][b]Effect:[/b] Rank reset to Rat (prestige 0). Honours, leaderboards, cash, points, tokens, Game Pass, Founding Member status stripped. Modkilled badge added. £10 Dead > Alive revive permanently blocked. Entire IPv6 /48 block banned.[/color]
[*][color=#888888][b]Note:[/b] This was an [b]autonomous decision[/b] by System AI. Piece was unbanned on 2026-08-23 on probation: "Any further rule break is a permanent ban." Botting for 5+ days straight is a rule break.[/color]
[/list]
[/quote]

[hr]
"""

# Find and replace the old entry
# Look for the section starting with today's date and Zwischenzug
import re

# Pattern to match from the Zwischenzug header to the next [hr] after the quote
pattern = rf'\[size=1\.5\]\[b\]\[color=#2ECC71\]{today}\[/color\]\[/b\] — \[b\]Zwischenzug.*?\[/quote\]\s*\[hr\]'
new_content = re.sub(pattern, NEW_ENTRY, current_content, flags=re.DOTALL)

if new_content == current_content:
    print("Pattern didn't match, trying alternative...")
    # Try simpler replacement - find the section between the date header and the next hr after quote
    old_start = current_content.find(f"[size=1.5][b][color=#2ECC71]{today}[/color][/b] — [b]Zwischenzug")
    if old_start != -1:
        # Find the end (next [hr] after [/quote])
        quote_end = current_content.find("[/quote]", old_start)
        if quote_end != -1:
            hr_after = current_content.find("[hr]", quote_end)
            if hr_after != -1:
                old_entry = current_content[old_start:hr_after+4]
                new_content = current_content.replace(old_entry, NEW_ENTRY.rstrip())
                print(f"Replaced {len(old_entry)} chars with {len(NEW_ENTRY)} chars")

# Update the topic
db.forum_topics.update_one(
    {"id": TOPIC_ID},
    {"$set": {"content": new_content, "updated_at": now.isoformat()}}
)

print("✓ Topic of Shame updated with final wipe details:")
print("  - 4,928 trap failures in 21 minutes")
print("  - 2.5M requests over 5 days")  
print("  - Full modkill wipe details")
print("  - Linked accounts wiped: Intermezzo, Weiss")
print("  - Items returned to game")
print("  - Victim compensation listed")
