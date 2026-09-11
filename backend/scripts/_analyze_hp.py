"""Deep analysis of HP's activity."""
import os
import re
import subprocess
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

print("=" * 60)
print("DEEP ANALYSIS: HP")
print("=" * 60)

# Get HP's user info
user = db.users.find_one({"username": {"$regex": "^HP$", "$options": "i"}})
if user:
    print(f"\n=== ACCOUNT INFO ===")
    print(f"Username: {user.get('username')}")
    print(f"ID: {user.get('id')}")
    print(f"Points: {user.get('points', 0):,}")
    print(f"Cash: ${user.get('cash', 0):,}")
    print(f"Swiss: ${user.get('swiss_balance', 0):,}")
    print(f"Kills: {user.get('kills', 0)}")
    print(f"Created: {user.get('created_at')}")
    print(f"Last IP: {user.get('last_login_ip')}")
    
    user_id = user.get('id')
else:
    print("HP not found!")
    exit()

# Check request patterns over last hour
print(f"\n=== REQUEST ANALYSIS (last 1 hour) ===")
result = subprocess.run(
    ["journalctl", "-u", "mafia-backend", "--no-pager", "--since", "1 hour ago"],
    capture_output=True, text=True
)

lines = [l for l in result.stdout.split("\n") if " HP" in l or "/HP" in l]
hp_lines = [l for l in lines if re.search(r"\b(GET|POST)\b.+\bHP\b", l)]

print(f"Total requests in last hour: {len(hp_lines)}")
print(f"Requests per minute: {len(hp_lines) / 60:.1f}")

# Endpoint breakdown
endpoints = defaultdict(int)
for line in hp_lines:
    match = re.search(r"(GET|POST) (/api/[^ ]+)", line)
    if match:
        ep = f"{match.group(1)} {match.group(2).split('?')[0]}"
        endpoints[ep] += 1

print(f"\nTop endpoints:")
for ep, count in sorted(endpoints.items(), key=lambda x: -x[1])[:10]:
    print(f"  {count:5d}x {ep}")

# Attack-specific analysis
attack_count = sum(c for ep, c in endpoints.items() if "attack" in ep.lower())
print(f"\nAttack-related requests: {attack_count}")

# Check timing patterns
print(f"\n=== TIMING ANALYSIS ===")
timestamps = []
for line in hp_lines[-500:]:  # Last 500 requests
    ts_match = re.search(r"(\d{2}:\d{2}:\d{2})", line)
    if ts_match:
        timestamps.append(ts_match.group(1))

if len(timestamps) > 10:
    # Count requests per second
    per_second = defaultdict(int)
    for ts in timestamps:
        per_second[ts] += 1
    
    max_per_sec = max(per_second.values())
    avg_per_sec = sum(per_second.values()) / len(per_second)
    
    print(f"Max requests in one second: {max_per_sec}")
    print(f"Avg requests per second: {avg_per_sec:.1f}")
    
    # Show busiest seconds
    print(f"\nBusiest seconds:")
    for ts, count in sorted(per_second.items(), key=lambda x: -x[1])[:5]:
        print(f"  {ts}: {count} requests")

# Check if they have auto-rank
print(f"\n=== AUTO-RANK STATUS ===")
print(f"Auto-rank enabled: {user.get('auto_rank_enabled', False)}")
print(f"Auto-rank purchased: {user.get('auto_rank_purchased', False)}")

# Recent kills
print(f"\n=== RECENT KILLS (last 24h) ===")
day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
kills = list(db.combat_attempts.find(
    {"attacker_id": user_id, "success": True, "created_at": {"$gte": day_ago}},
    sort=[("created_at", -1)]
))
print(f"Kills in last 24h: {len(kills)}")
for k in kills[:10]:
    print(f"  {k.get('target_username', 'Unknown')} at {k.get('created_at', '?')[:19]}")

print("\n" + "=" * 60)
print("VERDICT")
print("=" * 60)
if attack_count > 500 and max_per_sec > 10:
    print("⚠️  HIGH SUSPICION - Consider adding bot trap")
elif attack_count > 200:
    print("⚠️  MODERATE SUSPICION - Monitor closely")
else:
    print("✓ Activity within normal bounds (possibly active player or auto-rank)")
