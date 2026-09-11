"""Calculate precise botting duration from logs."""
import os
import re
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient
import subprocess

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

print("=== PRECISE BOT TIMING ANALYSIS ===\n")

# Get the first and last bot_trap_fail log entries for Zwischenzug
result = subprocess.run(
    ["journalctl", "-u", "mafia-backend", "--no-pager", "--output=short-iso"],
    capture_output=True, text=True
)

lines = result.stdout.split("\n")
trap_failures = [l for l in lines if "bot_trap_fail" in l and "Zwischenzug" in l]

print(f"Total bot_trap_fail entries: {len(trap_failures)}")

if trap_failures:
    first_fail = trap_failures[0]
    last_fail = trap_failures[-1]
    
    print(f"\nFirst failure log:")
    print(f"  {first_fail[:100]}")
    
    print(f"\nLast failure log:")
    print(f"  {last_fail[:100]}")
    
    # Extract timestamps - format: 2026-09-04T00:19:15+0000
    ts_pattern = r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"
    
    first_match = re.search(ts_pattern, first_fail)
    last_match = re.search(ts_pattern, last_fail)
    
    if first_match and last_match:
        first_ts = datetime.fromisoformat(first_match.group(1))
        last_ts = datetime.fromisoformat(last_match.group(1))
        
        duration = last_ts - first_ts
        total_seconds = duration.total_seconds()
        minutes = total_seconds / 60
        hours = total_seconds / 3600
        
        print(f"\n=== PRECISE TIMING ===")
        print(f"First trap failure: {first_match.group(1)}")
        print(f"Last trap failure:  {last_match.group(1)}")
        print(f"Duration: {total_seconds:.0f} seconds = {minutes:.1f} minutes = {hours:.2f} hours")
        print(f"Failures: {len(trap_failures)}")
        print(f"Rate: {len(trap_failures) / minutes:.1f} failures/minute = {len(trap_failures) / total_seconds:.2f}/second")

# Also check his overall activity window today
print("\n=== TODAY'S ACTIVITY WINDOW ===")
zwisch_today = [l for l in lines if "Zwischenzug" in l and "Sep 04" in l]
if zwisch_today:
    first_activity = zwisch_today[0]
    last_activity = zwisch_today[-1]
    
    first_match = re.search(ts_pattern, first_activity)
    last_match = re.search(ts_pattern, last_activity)
    
    if first_match and last_match:
        print(f"First activity today: {first_match.group(1)}")
        print(f"Last activity today:  {last_match.group(1)}")
        
        first_ts = datetime.fromisoformat(first_match.group(1))
        last_ts = datetime.fromisoformat(last_match.group(1))
        duration = last_ts - first_ts
        print(f"Active for: {duration.total_seconds() / 60:.1f} minutes")
