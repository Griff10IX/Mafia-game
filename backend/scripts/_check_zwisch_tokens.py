"""Check Zwischenzug backups + live accounts for tokens and similar assets."""
import os
import json
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Token / consumable-ish fields to surface
KEYWORDS = (
    "token", "skip", "spin", "pass", "voucher", "ticket", "credit",
    "loot", "wheel", "mission", "revive", "respect", "bullet", "booze",
    "prestige", "rank_xp", "auto_rank", "game_pass", "entertainer",
)

def dump_interesting(label, doc):
    if not doc:
        print(f"\n=== {label}: NOT FOUND ===")
        return
    print(f"\n=== {label} ===")
    hits = []
    for k, v in sorted(doc.items(), key=lambda x: x[0].lower()):
        kl = k.lower()
        if any(s in kl for s in KEYWORDS):
            if v in (None, 0, "", [], {}, False):
                continue
            hits.append((k, v))
    if not hits:
        print("  (no non-empty token-like fields)")
    else:
        for k, v in hits:
            print(f"  {k}: {v}")

# Latest backup
import glob
backs = sorted(glob.glob("/opt/mafia-app/backups/zwischenzug_ban_backup_*.json"))
print("Backups found:", backs)
if backs:
    with open(backs[-1]) as f:
        backup = json.load(f)
    dump_interesting(f"BACKUP {backs[-1]}", backup)
    # Also print all numeric >0 fields briefly
    print("\n--- Backup numeric >0 ---")
    for k, v in sorted(backup.items()):
        if isinstance(v, (int, float)) and v != 0 and not isinstance(v, bool):
            print(f"  {k}: {v}")

# Live accounts
for name in ("Zwischenzug", "Weiss", "Piece"):
    u = db.users.find_one({"username": {"$regex": f"^{name}$", "$options": "i"}})
    dump_interesting(f"LIVE {name}", u)

# Redeem codes owned by Zwischenzug
zw = db.users.find_one({"username": {"$regex": "^Zwischenzug$", "$options": "i"}}, {"id": 1})
uid = (zw or {}).get("id") or "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
print(f"\n=== Redeem codes for {uid} ===")
for c in db.player_redeem_codes.find({"$or": [{"creator_id": uid}, {"user_id": uid}, {"owner_id": uid}]}).limit(20):
    c.pop("_id", None)
    print(c)

# Try common collection names
for coll in ("player_redeem_codes", "redeem_codes", "user_tokens", "tokens", "store_tokens"):
    if coll in db.list_collection_names():
        n = db[coll].count_documents({"$or": [{"user_id": uid}, {"creator_id": uid}, {"owner_id": uid}]})
        print(f"  {coll}: {n} docs")
