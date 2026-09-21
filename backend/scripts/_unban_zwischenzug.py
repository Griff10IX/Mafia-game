"""Unban Zwischenzug: clear IP prefix, account bans, revive blocks."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc).isoformat()
PREFIX = "2a01:4b00:b605:6000"
ZWISCH = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
PIECE = "8554e78f-c388-4cc2-9d47-1e505a1ade18"
WEISS = "e40117ff-096a-46c0-8d1a-851456098a0f"
INTER = "73928cc3-cfc0-4032-a6f9-67fba5c214b8"
UIDS = [ZWISCH, PIECE, WEISS, INTER]
NOTE = "unbanned by GhostFace 2026-09-21"

print("=== 1) Remove banned_ips prefix block ===")
r = db.banned_ips.delete_many({"ip": {"$regex": f"^{PREFIX}"}})
print(f"  deleted banned_ips: {r.deleted_count}")

print("=== 2) Deactivate ip_bans matching prefix / linked users ===")
active_all = list(db.ip_bans.find({"active": True}, {"_id": 1, "ip": 1, "source_user_id": 1, "source_username": 1, "reason": 1}))
ids = []
for doc in active_all:
    ip = str(doc.get("ip") or "")
    if ip == PREFIX or ip.startswith(PREFIX + ":") or ip.startswith(PREFIX):
        ids.append(doc["_id"])
        continue
    if doc.get("source_user_id") in UIDS:
        ids.append(doc["_id"])
        continue
    src = str(doc.get("source_username") or "").lower()
    if src in ("zwischenzug", "weiss", "intermezzo", "piece"):
        ids.append(doc["_id"])
        continue
    reason = str(doc.get("reason") or "").lower()
    if "zwischenzug" in reason or "piece lineage" in reason:
        ids.append(doc["_id"])

if ids:
    r2 = db.ip_bans.update_many(
        {"_id": {"$in": ids}},
        {"$set": {"active": False, "unbanned_at": now, "unban_note": NOTE}},
    )
    print(f"  deactivated ip_bans: {r2.modified_count} (matched {len(ids)})")
    for doc in active_all:
        if doc["_id"] in ids:
            print(f"    - {doc.get('ip')} src={doc.get('source_username')}")
else:
    print("  deactivated ip_bans: 0 (none active matched)")

print("=== 3) Deactivate account bans (db.bans) ===")
r3 = db.bans.update_many(
    {"user_id": {"$in": UIDS}, "active": True},
    {"$set": {"active": False, "unbanned_at": now, "unban_note": NOTE}},
)
print(f"  deactivated bans: {r3.modified_count}")

print("=== 4) Clear is_banned on users ===")
r4 = db.users.update_many(
    {"id": {"$in": UIDS}},
    {
        "$set": {
            "is_banned": False,
            "unbanned_at": now,
            "unban_note": NOTE,
            "revive_blocked": False,
            "dead_to_alive_blocked": False,
        },
        "$unset": {"ban_reason": "", "banned_at": "", "banned_by": ""},
    },
)
print(f"  users updated: {r4.modified_count}")

print("=== 5) Remove blocked_revives ===")
r5 = db.blocked_revives.delete_many({"user_id": {"$in": UIDS}})
print(f"  deleted blocked_revives: {r5.deleted_count}")

print("\n=== VERIFY ===")
print("banned_ips remaining:", list(db.banned_ips.find({}, {"_id": 0, "ip": 1, "username": 1})))
print("active bans for uids:", list(db.bans.find({"user_id": {"$in": UIDS}, "active": True}, {"_id": 0, "username": 1})))
active_pref = [
    d for d in db.ip_bans.find({"active": True}, {"_id": 0, "ip": 1, "source_username": 1})
    if str(d.get("ip") or "").startswith(PREFIX)
]
print("active ip_bans under prefix:", active_pref)
for u in db.users.find({"id": {"$in": UIDS}}, {"_id": 0, "username": 1, "is_banned": 1, "is_dead": 1, "revive_blocked": 1, "ban_reason": 1}):
    print("user", u)
print("DONE")
