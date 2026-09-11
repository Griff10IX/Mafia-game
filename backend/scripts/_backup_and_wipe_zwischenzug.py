"""Backup Zwischenzug's account then full modkill wipe."""
import os
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
USERNAME = "Zwischenzug"

now = datetime.now(timezone.utc)

print("=" * 60)
print("FULL MODKILL WIPE: Zwischenzug")
print("=" * 60)

# 1. BACKUP CURRENT STATE
print("\n[1/3] Backing up current account state...")
user = db.users.find_one({"id": USER_ID})
if user:
    user_backup = {k: v for k, v in user.items() if k != "_id"}
    backup_path = f"/opt/mafia-app/backups/zwischenzug_ban_backup_{now.strftime('%Y%m%d_%H%M%S')}.json"
    os.makedirs("/opt/mafia-app/backups", exist_ok=True)
    with open(backup_path, "w") as f:
        json.dump(user_backup, f, indent=2, default=str)
    print(f"  ✓ Saved to {backup_path}")
    
    # Print key stats being wiped
    print(f"\n  Stats being wiped:")
    print(f"    Points: {user.get('points', 0):,}")
    print(f"    Cash: ${user.get('cash', 0):,}")
    print(f"    Swiss: ${user.get('swiss_balance', 0):,}")
    print(f"    Crypto: ${user.get('crypto_balance', 0):,}")
    print(f"    Bullets: {user.get('bullets', 0):,}")
    print(f"    Booze: {user.get('booze', 0):,}")
    print(f"    Molotovs: {user.get('molotovs', 0):,}")
    print(f"    Loot pieces: {user.get('loot_box_pieces', 0):,}")
    print(f"    Respect points: {user.get('respect_points', 0):,}")
    print(f"    Rank points: {user.get('rank_points', 0):,}")
    print(f"    Prestige: {user.get('prestige_level', 0)}")

# 2. MODKILL WIPE - Reset everything to zero
print("\n[2/3] Executing modkill wipe...")

wipe_fields = {
    # Currency
    "cash": 0,
    "swiss_balance": 0,
    "crypto_balance": 0,
    "points": 0,
    "respect_points": 0,
    "rank_points": 0,
    
    # Items
    "bullets": 0,
    "booze": 0,
    "molotovs": 0,
    "loot_box_pieces": 0,
    "booze_carrying": {},
    "booze_carrying_cost": {},
    
    # Tokens - wipe all
    "travel_tokens": 0,
    "booze_tokens": 0,
    "melt_tokens": 0,
    "jailbust_tokens": 0,
    "jail_bailout_tokens": 0,
    "properties_tokens": 0,
    "racket_tokens": 0,
    "mission_skip_tokens": 0,
    "auto_rank_2h_tokens": 0,
    "auto_collect_12h_tokens": 0,
    "auto_collect_24h_tokens": 0,
    "cooldown_skip_booze_tokens": 0,
    "cooldown_skip_crime_tokens": 0,
    "cooldown_skip_gta_tokens": 0,
    "cooldown_skip_properties_tokens": 0,
    "crew_oc_auto_apply_tokens": 0,
    "oc_reduced_tokens": 0,
    "xp_crimes_tokens": 0,
    "xp_gta_tokens": 0,
    "robot_bodyguard_hire_tokens": 0,
    "wheel_bonus_free_spins": 0,
    
    # Rank/Progress
    "rank": 0,
    "prestige_level": 0,
    "kills": 0,
    "total_kills": 0,
    
    # Stats wipe
    "total_crimes": 0,
    "total_gta": 0,
    "total_oc_heists": 0,
    "jail_busts": 0,
    "jail_bust_attempts": 0,
    "snitch_count": 0,
    "booze_runs_count": 0,
    "booze_profit_total": 0,
    "crime_profit": 0,
    
    # Honours/achievements
    "badges": ["Modkilled"],
    "founding_member": False,
    
    # Properties
    "bodyguard_slots": 2,
    
    # Status
    "is_banned": True,
    "is_dead": True,
    "revive_blocked": True,
    "dead_to_alive_blocked": True,
    "modkilled": True,
    "modkilled_at": now.isoformat(),
    "modkilled_by": "System AI",
    "modkill_reason": "Botting (2.5M requests, 154K attack attempts over 5 days). Ban evasion (previously Piece).",
    
    # Remove game pass if any
    "has_game_pass": False,
    "game_pass_prestige_count": 0,
}

db.users.update_one({"id": USER_ID}, {"$set": wipe_fields})
print("  ✓ Account wiped")

# 3. WIPE RELATED COLLECTIONS
print("\n[3/3] Wiping related data...")

# Delete inventory
inv_del = db.inventory.delete_many({"user_id": USER_ID})
print(f"  Inventory: {inv_del.deleted_count} items deleted")

# Delete garage
garage_del = db.garage.delete_many({"user_id": USER_ID})
print(f"  Garage: {garage_del.deleted_count} cars deleted")

# Delete user_items
items_del = db.user_items.delete_many({"user_id": USER_ID})
print(f"  User items: {items_del.deleted_count} deleted")

# Delete bodyguards owned by this user
bg_del = db.users.delete_many({"owner_id": USER_ID, "is_bodyguard": True})
print(f"  Bodyguards: {bg_del.deleted_count} deleted")

# Delete robots owned
robot_del = db.users.delete_many({"owner_id": USER_ID, "is_robot": True})
print(f"  Robots: {robot_del.deleted_count} deleted")

# Remove from any family
db.families.update_many(
    {"members.user_id": USER_ID},
    {"$pull": {"members": {"user_id": USER_ID}}}
)
print(f"  Removed from families")

# Delete active attacks
attacks_del = db.attacks.delete_many({"attacker_id": USER_ID})
print(f"  Attacks: {attacks_del.deleted_count} deleted")

print("\n" + "=" * 60)
print("MODKILL WIPE COMPLETE")
print("=" * 60)
print(f"""
Account: {USERNAME}
Status: FULLY WIPED
Badge: Modkilled
Backup: {backup_path}

Everything zeroed:
- All currency ($0)
- All items (0)
- All tokens (0)
- All stats (0)
- Rank reset to 0
- Prestige reset to 0
- Founding Member removed
- Bodyguards deleted
- Family membership removed
""")
