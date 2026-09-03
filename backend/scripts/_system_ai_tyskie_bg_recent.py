"""Tyskie recent bodyguard hire logs — bot shape vs manual. Live DB only."""
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
since = now - timedelta(hours=48)

u = db.users.find_one(
    {"id": TID},
    {
        "_id": 0,
        "username": 1,
        "last_seen": 1,
        "last_login_user_agent": 1,
        "account_locked": 1,
        "account_locked_until": 1,
        "is_dead": 1,
        "in_jail": 1,
        "current_state": 1,
    },
)
print("now", now.isoformat())
print("user", (u or {}).get("username"), "last_seen", (u or {}).get("last_seen"))
print("locked", (u or {}).get("account_locked"), (u or {}).get("account_locked_until"))
print("dead", (u or {}).get("is_dead"), "jail", (u or {}).get("in_jail"), "state", (u or {}).get("current_state"))
ua_login = (u or {}).get("last_login_user_agent") or ""
blocked, reason = login_user_agent_blocked(ua_login)
print("login_ua_blocked", blocked, reason)
print("login_ua", ua_login[:160])

hires = list(
    db.bodyguard_hire_attempts.find({"owner_id": TID, "at": {"$gte": since}}).sort("at", -1)
)
print("\n=== bodyguard_hire_attempts last 48h n", len(hires), "===")
if not hires:
    hires = list(db.bodyguard_hire_attempts.find({"owner_id": TID}).sort("at", -1).limit(25))
    print("no 48h rows; showing latest", len(hires), "ever")

outcomes = {}
gaps = []
prev = None
chrono = list(reversed(hires))
for h in chrono:
    at = h.get("at")
    if prev is not None and at is not None:
        try:
            dt = (at - prev).total_seconds() if hasattr(at, "total_seconds") else None
            if dt is None:
                pass
            else:
                gaps.append(dt)
        except Exception:
            pass
    prev = at
    oc = h.get("outcome") or "?"
    outcomes[oc] = outcomes.get(oc, 0) + 1

print("outcomes", outcomes)
if gaps:
    print(
        "gaps_sec min/med/max",
        round(min(gaps), 2),
        round(sorted(gaps)[len(gaps) // 2], 2),
        round(max(gaps), 2),
        "sub2s",
        sum(1 for g in gaps if g < 2),
        "sub5s",
        sum(1 for g in gaps if g < 5),
    )

print("\n--- newest first ---")
for h in hires[:40]:
    ua = h.get("user_agent") or ""
    defi, rsn = login_user_agent_blocked(ua)
    extra_keys = [k for k in h.keys() if k not in ("_id", "id", "at", "owner_id", "owner_username", "outcome", "gate", "user_agent", "client_ip", "slot", "is_robot")]
    print(
        h.get("at"),
        "|",
        h.get("outcome"),
        "| slot",
        h.get("slot"),
        "| robot",
        h.get("is_robot"),
        "| def",
        defi,
        rsn or "-",
        "| extra",
        extra_keys,
        "| ua",
        ua[:90],
    )

print("\n=== bot_client_block_events Tyskie last 48h ===")
blocks = list(
    db.bot_client_block_events.find(
        {
            "$and": [
                {"$or": [{"user_id": TID}, {"username": (u or {}).get("username")}]},
                {
                    "$or": [
                        {"created_at": {"$gte": since.isoformat()}},
                        {"created_at": {"$gte": since}},
                    ]
                },
            ]
        }
    )
    .sort("created_at", -1)
    .limit(20)
)
print("n", len(blocks))
for b in blocks:
    print(b.get("created_at") or b.get("at"), "|", b.get("source") or b.get("path"), "|", b.get("reason"), "|", (b.get("user_agent") or "")[:70])

print("\n=== activity_log bodyguard-ish last 48h ===")
acts = list(
    db.activity_log.find(
        {
            "user_id": TID,
            "$or": [
                {"created_at": {"$gte": since.isoformat()}},
                {"created_at": {"$gte": since}},
            ],
        },
        {"_id": 0, "created_at": 1, "action": 1, "details": 1, "message": 1},
    )
    .sort("created_at", -1)
    .limit(40)
)
print("activity_log n", len(acts))
for a in acts:
    act = str(a.get("action") or "")
    if "body" in act.lower() or "guard" in act.lower() or "hire" in act.lower():
        print(a.get("created_at"), "|", act, "|", str(a.get("details") or a.get("message") or "")[:120])
if acts and not any("body" in str(a.get("action") or "").lower() or "guard" in str(a.get("action") or "").lower() for a in acts):
    print("(no bodyguard actions in last 40 activity_log rows; showing actions)")
    for a in acts[:12]:
        print(a.get("created_at"), "|", a.get("action"))

print("done")
