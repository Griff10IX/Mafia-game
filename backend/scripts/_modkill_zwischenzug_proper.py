"""Proper modkill wipe for Zwischenzug using the official utility."""
import os
import sys
import json
import asyncio
from datetime import datetime, timezone

# Add backend to path
sys.path.insert(0, "/opt/mafia-app/backend")

from dotenv import load_dotenv
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/opt/mafia-app/backend/.env")

# Sync client for backup
sync_db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
USERNAME = "Zwischenzug"

now = datetime.now(timezone.utc)

print("=" * 60)
print("MODKILL WIPE: Zwischenzug (using official utility)")
print("=" * 60)

# 1. BACKUP CURRENT STATE (sync)
print("\n[1/2] Backing up current account state...")
user = sync_db.users.find_one({"id": USER_ID})
backup_path = None
if user:
    user_backup = {k: v for k, v in user.items() if k != "_id"}
    backup_path = f"/opt/mafia-app/backups/zwischenzug_ban_backup_{now.strftime('%Y%m%d_%H%M%S')}.json"
    os.makedirs("/opt/mafia-app/backups", exist_ok=True)
    with open(backup_path, "w") as f:
        json.dump(user_backup, f, indent=2, default=str)
    print(f"  ✓ Saved to {backup_path}")
    
    print(f"\n  Stats being wiped:")
    print(f"    Points: {user.get('points', 0):,}")
    print(f"    Cash: ${user.get('cash', 0):,}")
    print(f"    Swiss: ${user.get('swiss_balance', 0):,}")
    print(f"    Bullets: {user.get('bullets', 0):,}")
    print(f"    Booze: {user.get('booze', 0):,}")
    print(f"    Loot pieces: {user.get('loot_box_pieces', 0):,}")
    print(f"    Respect points: {user.get('respect_points', 0):,}")
    print(f"    Rank points: {user.get('rank_points', 0):,}")
    print(f"    Prestige: {user.get('prestige_level', 0)}")
    print(f"    Founding Member: {user.get('founding_member', False)}")

# 2. Apply official modkill wipe
async def do_wipe():
    from utils.modkill_wipe import apply_modkill_wipe_after_kill
    
    # Connect async
    mongo_url = os.environ.get("MONGO_URL")
    db_name = (os.environ.get("DB_NAME") or "mafia_game").strip()
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    
    print("\n[2/2] Applying official modkill wipe...")
    
    reason = "Botting (2.5M requests, 154K attack attempts over 5 days). Ban evasion (previously Piece). Permanent."
    
    wipe_summary = await apply_modkill_wipe_after_kill(
        db,
        user_id=USER_ID,
        username=USERNAME,
        reason=reason,
        staff_username="System AI",
        post_shame=False,  # We already updated it
    )
    
    print(f"\n  Wipe Summary:")
    for k, v in wipe_summary.items():
        print(f"    {k}: {v}")
    
    client.close()
    return wipe_summary

# Run the async wipe
result = asyncio.run(do_wipe())

print("\n" + "=" * 60)
print("MODKILL WIPE COMPLETE")
print("=" * 60)
print(f"""
Account: {USERNAME}
Status: FULLY WIPED (official modkill)
Backup: {backup_path}
""")
