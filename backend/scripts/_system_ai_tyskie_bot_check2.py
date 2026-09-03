"""Tighter last-6h kill/bodyguard bot scan + Tyskie activity."""
import os
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, "/opt/mafia-app/backend")
from utils.login_user_agent import login_user_agent_blocked

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TID = "9849ec87-ff75-4109-aa40-6779e60e3156"
now = datetime.now(timezone.utc)
since = now - timedelta(hours=6)
since_iso = since.isoformat()

print("now", now.isoformat())

print("\n=== attack_attempts last 6h (datetime or iso) ===")
q = {
    "$or": [
        {"created_at": {"$gte": since}},
        {"created_at": {"$gte": since_iso}},
    ]
}
att = list(db.attack_attempts.find(q, {"_id": 0}).sort("created_at", -1).limit(40))
print("n", len(att))
bots = 0
for a in att:
    bot = bool(a.get("attacker_is_bot"))
    if bot:
        bots += 1
    print(
        a.get("created_at"),
        "|",
        a.get("attacker_username"),
        "|",
        a.get("attacker_client_signal"),
        a.get("attacker_bot_label"),
        "bot" if bot else "",
        "|",
        (a.get("user_agent") or "")[:50],
        "|",
        a.get("result") or a.get("outcome") or a.get("context"),
    )
print("bot flagged in this sample", bots)

print("\n=== bodyguard_hire last 6h ===")
hires = list(db.bodyguard_hire_attempts.find({"at": {"$gte": since}}).sort("at", -1).limit(30))
print("n", len(hires))
for h in hires:
    ua = h.get("user_agent") or ""
    defi, reason = login_user_agent_blocked(ua)
    print(h.get("at"), "|", h.get("owner_username"), "|", h.get("outcome"), "| def", defi, reason, "|", ua[:50])

print("\n=== bot_client_block last 6h attack/bodyguard ===")
blocks = list(
    db.bot_client_block_events.find(
        {
            "$or": [
                {"created_at": {"$gte": since_iso}},
                {"created_at": {"$gte": since}},
            ]
        }
    )
    .sort("created_at", -1)
    .limit(30)
)
print("n", len(blocks))
for b in blocks:
    src = str(b.get("source") or b.get("path") or "")
    if "attack" in src.lower() or "bodyguard" in src.lower() or "game_action" in src.lower() or "minigame" in src.lower():
        print(b.get("created_at"), "|", b.get("username"), "|", src, "|", b.get("reason"))
    else:
        print(" other", b.get("created_at"), "|", b.get("username"), "|", src, "|", b.get("reason"))

print("\n=== Tyskie activity 24h ===")
acts = list(
    db.activity_logs.find(
        {
            "user_id": TID,
            "$or": [
                {"created_at": {"$gte": since_iso}},
                {"timestamp": {"$gte": since_iso}},
                {"at": {"$gte": since}},
            ],
        }
    )
    .sort("_id", -1)
    .limit(20)
)
print("activity_logs n", len(acts))
if acts:
    print("keys", list(acts[0].keys())[:20])
    for x in acts:
        print(x)

# fallback any collection-ish
for coll in ("activities", "user_activity", "activity"):
    if coll in db.list_collection_names():
        print("has", coll)

print("\n=== Tyskie user fields of interest ===")
u = db.users.find_one(
    {"id": TID},
    {
        "_id": 0,
        "username": 1,
        "last_seen": 1,
        "last_login_at": 1,
        "last_login_user_agent": 1,
        "login_user_agent": 1,
        "account_locked": 1,
        "is_dead": 1,
        "in_jail": 1,
        "state": 1,
        "points": 1,
        "rank": 1,
    },
)
print(u)
print("done")
