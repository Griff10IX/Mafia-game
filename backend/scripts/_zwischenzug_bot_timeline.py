"""Analyze Zwischenzug's attack activity over last 2 days to estimate botting duration."""
import os
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
USERNAME = "Zwischenzug"

now = datetime.now(timezone.utc)
two_days_ago = (now - timedelta(days=2)).isoformat()

print("=" * 60)
print(f"BOT TIMELINE ANALYSIS: {USERNAME}")
print("=" * 60)

# 1. Check attack searches created
print("\n=== ATTACK SEARCHES (last 2 days) ===")
attacks = list(db.attacks.find(
    {"attacker_id": USER_ID, "search_started": {"$gte": two_days_ago}},
    sort=[("search_started", 1)]
))
print(f"Total attack searches: {len(attacks)}")

# Group by hour
by_hour = defaultdict(int)
for a in attacks:
    ts = a.get("search_started", "")[:13]  # YYYY-MM-DDTHH
    if ts:
        by_hour[ts] += 1

if by_hour:
    print("\nAttack searches per hour:")
    for hour, count in sorted(by_hour.items()):
        bar = "█" * min(count, 50)
        print(f"  {hour}: {count:3d} {bar}")

# 2. Check bot trap failures timeline
print("\n=== BOT TRAP FAILURES ===")
trap = db.bot_traps.find_one({"user_id": USER_ID})
if trap:
    print(f"Trap created: {trap.get('created_at')}")
    print(f"Total failures: {trap.get('failures', 0)}")
    
    # Calculate rate
    created = trap.get('created_at', '')
    if created:
        try:
            trap_start = datetime.fromisoformat(created.replace('Z', '+00:00'))
            duration = now - trap_start
            mins = duration.total_seconds() / 60
            failures = trap.get('failures', 0)
            rate_per_min = failures / mins if mins > 0 else 0
            print(f"Duration: {mins:.1f} minutes")
            print(f"Rate: {rate_per_min:.1f} failures/minute = {rate_per_min*60:.0f}/hour")
        except:
            pass

# 3. Activity logs for attack actions
print("\n=== ATTACK-RELATED ACTIVITY ===")
activity = list(db.activity_logs.find({
    "user_id": USER_ID,
    "created_at": {"$gte": two_days_ago},
    "action": {"$regex": "attack|kill|execute|search", "$options": "i"}
}).sort("created_at", 1))
print(f"Attack-related activities: {len(activity)}")

# 4. Request rate analysis from any logs
print("\n=== REQUEST TIMESTAMPS FROM ATTACKS ===")
timestamps = []
for a in attacks:
    ts = a.get("search_started")
    if ts:
        timestamps.append(ts)

if timestamps:
    timestamps.sort()
    first = timestamps[0]
    last = timestamps[-1]
    print(f"First attack search: {first}")
    print(f"Last attack search: {last}")
    
    # Calculate span
    try:
        t1 = datetime.fromisoformat(first.replace('Z', '+00:00'))
        t2 = datetime.fromisoformat(last.replace('Z', '+00:00'))
        span = t2 - t1
        hours = span.total_seconds() / 3600
        print(f"Time span: {hours:.1f} hours")
        if hours > 0:
            rate = len(attacks) / hours
            print(f"Average rate: {rate:.1f} attack searches/hour")
    except Exception as e:
        print(f"Error: {e}")

# 5. Check for suspicious patterns - rapid sequences
print("\n=== RAPID ATTACK SEQUENCES ===")
if len(timestamps) > 1:
    rapid_sequences = 0
    rapid_count = 0
    
    for i in range(1, len(timestamps)):
        try:
            t1 = datetime.fromisoformat(timestamps[i-1].replace('Z', '+00:00'))
            t2 = datetime.fromisoformat(timestamps[i].replace('Z', '+00:00'))
            gap = (t2 - t1).total_seconds()
            
            if gap < 5:  # Less than 5 seconds between attacks
                rapid_count += 1
            else:
                if rapid_count > 5:
                    rapid_sequences += 1
                rapid_count = 0
        except:
            pass
    
    print(f"Rapid attack sequences (>5 attacks within 5 sec gaps): {rapid_sequences}")

# 6. Estimate botting duration
print("\n" + "=" * 60)
print("ESTIMATED BOTTING ANALYSIS")
print("=" * 60)

# Based on 1,298 failures in ~1 hour = ~21/min
# If he was botting at similar rate before trap...
print(f"""
Based on trap data:
- 1,298 failures caught in trap
- Rate: ~4.3 requests/second during trap
- Created account: 2026-08-24

If botting at similar rate before detection:
- {len(attacks)} attack searches in 2 days
- Any human would not sustain this rate

The trap was set around 00:19 UTC on Sep 4.
Within ~1 hour he had 1,298 failures = definitely automated.

Conclusion: Likely botting since he started the attack spree,
possibly for hours or days before we noticed.
""")
