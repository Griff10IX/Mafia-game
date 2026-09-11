"""Analyze Zwischenzug's request patterns for bot detection."""
import os
import re
from datetime import datetime, timezone, timedelta
from collections import defaultdict

from dotenv import load_dotenv
from pymongo import MongoClient
import subprocess

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USERNAME = "Zwischenzug"

# Get recent logs
result = subprocess.run(
    ["journalctl", "-u", "mafia-backend", "--no-pager", "--since", "5 minutes ago"],
    capture_output=True, text=True
)
lines = [l for l in result.stdout.split("\n") if USERNAME in l]

print(f"=== BOT FORENSICS FOR {USERNAME} ===\n")
print(f"Total requests in last 5 minutes: {len(lines)}")
print(f"Requests per minute: {len(lines) / 5:.1f}")
print(f"Requests per second: {len(lines) / 300:.1f}")

# Parse timestamps and calculate intervals
timestamps = []
pattern = r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"
for line in lines:
    match = re.search(pattern, line)
    if match:
        ts = datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S")
        timestamps.append(ts)

if len(timestamps) > 1:
    timestamps.sort()
    intervals = []
    for i in range(1, len(timestamps)):
        delta = (timestamps[i] - timestamps[i-1]).total_seconds()
        intervals.append(delta)
    
    # Only count non-zero intervals (requests in same second = 0)
    nonzero = [i for i in intervals if i > 0]
    
    print(f"\n=== TIMING ANALYSIS ===")
    print(f"Total intervals: {len(intervals)}")
    print(f"Zero intervals (same second): {len(intervals) - len(nonzero)}")
    if nonzero:
        print(f"Min interval: {min(nonzero):.3f}s")
        print(f"Max interval: {max(nonzero):.3f}s")
        print(f"Avg interval: {sum(nonzero)/len(nonzero):.3f}s")
    
    # Count requests per second
    per_second = defaultdict(int)
    for ts in timestamps:
        key = ts.strftime("%H:%M:%S")
        per_second[key] += 1
    
    max_per_sec = max(per_second.values())
    avg_per_sec = sum(per_second.values()) / len(per_second)
    
    print(f"\n=== REQUESTS PER SECOND ===")
    print(f"Max in one second: {max_per_sec}")
    print(f"Avg per second: {avg_per_sec:.1f}")
    
    # Show busiest seconds
    print(f"\nBusiest seconds:")
    for ts, count in sorted(per_second.items(), key=lambda x: -x[1])[:10]:
        print(f"  {ts}: {count} requests")

# Analyze endpoint patterns
endpoints = defaultdict(int)
for line in lines:
    match = re.search(r"(GET|POST) (/api/[^ ]+)", line)
    if match:
        endpoints[f"{match.group(1)} {match.group(2)}"] += 1

print(f"\n=== ENDPOINT BREAKDOWN ===")
for ep, count in sorted(endpoints.items(), key=lambda x: -x[1])[:15]:
    print(f"  {count:4d}x {ep}")

# Check for mechanical patterns - identical sequences
print(f"\n=== SEQUENCE ANALYSIS ===")
# Look for repeating patterns in the last 100 requests
recent_endpoints = []
for line in lines[-100:]:
    match = re.search(r"(GET|POST) (/api/[^ ]+)", line)
    if match:
        recent_endpoints.append(match.group(2).split("?")[0])

# Find repeating subsequences
seq_len = 5
sequences = defaultdict(int)
for i in range(len(recent_endpoints) - seq_len):
    seq = tuple(recent_endpoints[i:i+seq_len])
    sequences[seq] += 1

repeated = [(seq, count) for seq, count in sequences.items() if count > 3]
if repeated:
    print("Repeating sequences found (bot indicator!):")
    for seq, count in sorted(repeated, key=lambda x: -x[1])[:5]:
        print(f"  {count}x: {' -> '.join(seq)}")
else:
    print("No obvious repeating sequences")

# VERDICT
print(f"\n=== VERDICT ===")
is_bot = False
evidence = []

if len(lines) / 300 > 10:  # More than 10 requests per second average
    is_bot = True
    evidence.append(f"Extreme request rate: {len(lines)/300:.1f} req/sec")

if max_per_sec > 20:
    is_bot = True
    evidence.append(f"Peak of {max_per_sec} requests in single second")

if repeated and max(c for _, c in repeated) > 5:
    is_bot = True
    evidence.append(f"Mechanical repeating request sequences detected")

if is_bot:
    print("🤖 LIKELY BOT")
    for e in evidence:
        print(f"  - {e}")
else:
    print("❓ Inconclusive - may be legitimate rapid clicking or bot")
