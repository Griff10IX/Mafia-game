"""Watch Tyskie + definite kill/bodyguard bots. Print BOT_WATCH lines. Do not lock here."""
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, "/opt/mafia-app/backend")
from utils.login_user_agent import login_user_agent_blocked

from _system_ai_prank_helpers import db

TID = "9849ec87-ff75-4109-aa40-6779e60e3156"

seen_att = set()
seen_hire = set()
seen_block = set()

for m in db.attack_attempts.find({}, {"_id": 1}).sort("created_at", -1).limit(80):
    seen_att.add(str(m["_id"]))
for m in db.bodyguard_hire_attempts.find({}, {"_id": 1}).sort("at", -1).limit(40):
    seen_hire.add(str(m["_id"]))
for m in db.bot_client_block_events.find({}, {"_id": 1}).sort("created_at", -1).limit(40):
    seen_block.add(str(m["_id"]))

u0 = db.users.find_one({"id": TID}, {"_id": 0, "last_seen": 1, "account_locked": 1})
print(
    "tyskie watch start",
    datetime.now(timezone.utc).isoformat(),
    "last_seen",
    (u0 or {}).get("last_seen"),
    "locked",
    (u0 or {}).get("account_locked"),
    flush=True,
)

while True:
    for a in db.attack_attempts.find({}).sort("created_at", -1).limit(25):
        oid = str(a.get("_id"))
        if oid in seen_att:
            continue
        seen_att.add(oid)
        aid = a.get("attacker_id")
        bot = bool(a.get("attacker_is_bot"))
        sig = a.get("attacker_client_signal")
        ua = a.get("user_agent") or ""
        defi, reason = login_user_agent_blocked(ua)
        if aid == TID or bot or defi or sig in ("script", "automation"):
            print(
                "BOT_WATCH attack",
                a.get("created_at"),
                "|",
                a.get("attacker_username"),
                "|",
                sig,
                a.get("attacker_bot_label"),
                "| bot",
                bot,
                "| def",
                defi,
                reason,
                "|",
                a.get("result") or a.get("outcome") or a.get("context"),
                flush=True,
            )
            if aid == TID and (bot or defi or sig in ("script", "automation")):
                print("BOT_WATCH TYSKIE_DEFINITE", flush=True)

    for h in db.bodyguard_hire_attempts.find({}).sort("at", -1).limit(15):
        oid = str(h.get("_id"))
        if oid in seen_hire:
            continue
        seen_hire.add(oid)
        uid = h.get("owner_id")
        ua = h.get("user_agent") or ""
        defi, reason = login_user_agent_blocked(ua)
        if uid == TID or defi:
            print(
                "BOT_WATCH hire",
                h.get("at"),
                "|",
                h.get("owner_username"),
                "|",
                h.get("outcome"),
                "| def",
                defi,
                reason,
                flush=True,
            )
            if uid == TID and defi:
                print("BOT_WATCH TYSKIE_DEFINITE", flush=True)

    for b in db.bot_client_block_events.find({}).sort("created_at", -1).limit(15):
        oid = str(b.get("_id"))
        if oid in seen_block:
            continue
        seen_block.add(oid)
        src = str(b.get("source") or b.get("path") or "")
        uid = b.get("user_id")
        if uid == TID or "attack" in src.lower() or "bodyguard" in src.lower():
            print(
                "BOT_WATCH block",
                b.get("created_at"),
                "|",
                b.get("username"),
                "|",
                src,
                "|",
                b.get("reason"),
                flush=True,
            )
            if uid == TID:
                print("BOT_WATCH TYSKIE_BLOCK", flush=True)

    if len(seen_att) > 400:
        seen_att = set(list(seen_att)[-200:])
    if len(seen_hire) > 200:
        seen_hire = set(list(seen_hire)[-100:])
    if len(seen_block) > 200:
        seen_block = set(list(seen_block)[-100:])
    time.sleep(8)
