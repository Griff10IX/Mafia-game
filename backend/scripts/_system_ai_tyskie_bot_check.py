"""Bodyguard/kill bot check + Tyskie snapshot. Report to console only."""
import os
import re
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, "/opt/mafia-app/backend")
from utils.login_user_agent import login_user_agent_blocked

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
since = now - timedelta(hours=24)
since_iso = since.isoformat()


def definite_ua(ua):
    blocked, reason = login_user_agent_blocked(ua or "")
    return blocked, reason


print("=== Tyskie ===")
tyskie = list(
    db.users.find(
        {"username": re.compile(r"^tyskie$", re.I), "is_npc": {"$ne": True}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "last_seen": 1,
            "last_login_user_agent": 1,
            "user_agent": 1,
            "account_locked": 1,
            "account_locked_until": 1,
            "is_dead": 1,
            "in_jail": 1,
            "state": 1,
            "current_state": 1,
        },
    )
)
if not tyskie:
    tyskie = list(
        db.users.find(
            {"username": re.compile("tyskie", re.I), "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}},
            {"_id": 0, "id": 1, "username": 1, "last_seen": 1, "last_login_user_agent": 1, "account_locked": 1},
        ).limit(10)
    )
print("matches", [(u.get("id"), u.get("username"), u.get("last_seen"), (u.get("last_login_user_agent") or "")[:80], u.get("account_locked")) for u in tyskie])
t = tyskie[0] if tyskie else None
tid = (t or {}).get("id")
tname = (t or {}).get("username")

print("\n=== bot_client_block_events 24h ===")
blocks = list(
    db.bot_client_block_events.find(
        {"created_at": {"$gte": since_iso}},
        {"_id": 0},
    )
    .sort("created_at", -1)
    .limit(40)
)
if not blocks:
    blocks = list(db.bot_client_block_events.find({}).sort("created_at", -1).limit(20))
print("n", len(blocks))
for b in blocks[:25]:
    print(
        b.get("created_at") or b.get("at"),
        "|",
        b.get("username") or b.get("user_id"),
        "|",
        b.get("source") or b.get("path"),
        "|",
        b.get("reason"),
        "|",
        (b.get("user_agent") or "")[:70],
    )

print("\n=== attack_attempts attacker_is_bot 24h ===")
att = list(
    db.attack_attempts.find(
        {
            "$or": [
                {"attacker_is_bot": True},
                {"created_at": {"$gte": since_iso}, "attacker_bot_label": {"$exists": True, "$nin": ["", None]}},
            ]
        },
        {
            "_id": 0,
            "created_at": 1,
            "attacker_username": 1,
            "attacker_id": 1,
            "attacker_is_bot": 1,
            "attacker_bot_label": 1,
            "attacker_client_signal": 1,
            "user_agent": 1,
            "context": 1,
        },
    )
    .sort("created_at", -1)
    .limit(30)
)
print("n", len(att))
for a in att:
    print(
        a.get("created_at"),
        "|",
        a.get("attacker_username"),
        "|",
        a.get("attacker_client_signal"),
        a.get("attacker_bot_label"),
        "| bot",
        a.get("attacker_is_bot"),
        "|",
        (a.get("user_agent") or "")[:60],
    )

print("\n=== bodyguard_hire_attempts 24h outcomes ===")
hires = list(db.bodyguard_hire_attempts.find({"at": {"$gte": since}}).sort("at", -1).limit(40))
if not hires:
    hires = list(db.bodyguard_hire_attempts.find({}).sort("at", -1).limit(20))
print("n", len(hires))
for h in hires[:25]:
    ua = h.get("user_agent") or ""
    defi, reason = definite_ua(ua)
    print(
        h.get("at"),
        "|",
        h.get("owner_username"),
        "|",
        h.get("outcome"),
        "| def",
        defi,
        reason,
        "|",
        ua[:60],
    )

if tid:
    print("\n=== Tyskie attack_attempts 24h ===")
    ta = list(
        db.attack_attempts.find({"attacker_id": tid}, {"_id": 0})
        .sort("created_at", -1)
        .limit(15)
    )
    print("n", len(ta))
    for a in ta:
        print(
            a.get("created_at"),
            "|",
            a.get("attacker_client_signal"),
            a.get("attacker_bot_label"),
            a.get("attacker_is_bot"),
            "|",
            (a.get("user_agent") or "")[:70],
            "|",
            a.get("context") or a.get("result") or a.get("outcome"),
        )
    print("\n=== Tyskie bodyguard_hire_attempts ===")
    th = list(db.bodyguard_hire_attempts.find({"owner_id": tid}).sort("at", -1).limit(15))
    print("n", len(th))
    for h in th:
        ua = h.get("user_agent") or ""
        defi, reason = definite_ua(ua)
        print(h.get("at"), "|", h.get("outcome"), "| def", defi, reason, "|", ua[:70])
    print("\n=== Tyskie bot_client_block_events ===")
    tb = list(
        db.bot_client_block_events.find(
            {"$or": [{"user_id": tid}, {"username": tname}]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(15)
    )
    print("n", len(tb))
    for b in tb:
        print(b.get("created_at") or b.get("at"), "|", b.get("source") or b.get("path"), "|", b.get("reason"), "|", (b.get("user_agent") or "")[:70])

print("\ndone")
