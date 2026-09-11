"""Dump remaining Zwischenzug token leftovers across all even-split recipients."""
import os
import uuid
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ORIGIN_TOKENS = "system_ai_zwischenzug_token_share"
ORIGIN_LEFTOVER = "system_ai_zwischenzug_token_leftovers"
ORIGIN_REMAIN = "system_ai_zwischenzug_token_remainders"
BACKUP = "/opt/mafia-app/backups/zwischenzug_ban_backup_20260904_010940.json"
AVATAR = "/images/system-ai-profile.jpg?v=5"

TOKEN_FIELDS = [
    "auto_collect_12h_tokens", "auto_collect_24h_tokens", "auto_rank_2h_tokens", "booze_tokens",
    "cooldown_skip_booze_tokens", "cooldown_skip_crime_tokens", "cooldown_skip_gta_tokens",
    "cooldown_skip_properties_tokens", "crew_oc_auto_apply_tokens", "jail_bailout_tokens",
    "jailbust_tokens", "melt_tokens", "mission_skip_tokens", "oc_reduced_tokens",
    "properties_tokens", "racket_tokens", "robot_bodyguard_hire_tokens", "travel_tokens",
    "xp_crimes_tokens", "xp_gta_tokens", "loot_box_pieces", "wheel_bonus_free_spins",
]

now_iso = datetime.now(timezone.utc).isoformat()

with open(BACKUP) as f:
    backup = json.load(f)

n = db.point_ledger_events.count_documents({"origin_ref": ORIGIN_TOKENS})
pool = {f: int(backup.get(f) or 0) for f in TOKEN_FIELDS}

# How many already given: floor share * n + leftovers already applied
given = {}
for f in TOKEN_FIELDS:
    given[f] = (pool[f] // n) * n  # even split portion

# Add leftover grants
for e in db.point_ledger_events.find({"origin_ref": ORIGIN_LEFTOVER}, {"_id": 0, "meta": 1}):
    for f, amt in (e.get("meta") or {}).get("extras", {}).items():
        given[f] = given.get(f, 0) + int(amt)

remain = {f: pool[f] - given.get(f, 0) for f in TOKEN_FIELDS}
remain = {f: v for f, v in remain.items() if v > 0}
print("Still remaining:", remain)

if not remain:
    print("Nothing left")
    raise SystemExit(0)

if db.point_ledger_events.find_one({"origin_ref": ORIGIN_REMAIN}):
    print("Remainders already sent")
    raise SystemExit(0)

# Recipients who got even split, order by username for fairness
ids = [e["user_id"] for e in db.point_ledger_events.find({"origin_ref": ORIGIN_TOKENS}, {"_id": 0, "user_id": 1})]
users = list(db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "username": 1}))
users.sort(key=lambda u: (u.get("username") or "").lower())

extra_by = {u["id"]: {} for u in users}
idx = 0
for field, count in remain.items():
    for i in range(count):
        u = users[idx % len(users)]
        extra_by[u["id"]][field] = extra_by[u["id"]].get(field, 0) + 1
        idx += 1

for u in users:
    uid = u["id"]
    name = u.get("username")
    extras = {k: v for k, v in extra_by[uid].items() if v > 0}
    if not extras:
        continue
    db.users.update_one({"id": uid}, {"$inc": extras})
    db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_token_remainders",
            "user_id": uid,
            "points": 0,
            "lot_id": None,
            "origin_ref": ORIGIN_REMAIN,
            "root_purchase_ref": None,
            "meta": {"extras": extras},
            "created_at": now_iso,
            "source": "system_ai",
        }
    )
    print(f"  remain → {name}: {extras}")

print("DONE — full pool should now be exhausted")
