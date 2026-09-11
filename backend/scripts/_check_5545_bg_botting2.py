"""Clean split: 5545 execute spam vs actual BG-NPC target attempts."""
import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from statistics import mean, median

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
uid = "07779847-3955-49b9-8a34-0eb21bc44651"
now = datetime.now(timezone.utc)
since = datetime(2026, 9, 5, 0, 0, 0)  # Sep 5 UTC start through now (= UK Sep 5 evening + Sep 6 early)


def as_dt(v):
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    return None


def gaps(times):
    times = sorted(times)
    if len(times) < 2:
        return None
    g = [(times[i] - times[i - 1]).total_seconds() for i in range(1, len(times))]
    return {
        "n": len(g),
        "min": round(min(g), 3),
        "p50": round(median(g), 3),
        "mean": round(mean(g), 3),
        "sub1s": sum(1 for x in g if x < 1),
        "sub0_5s": sum(1 for x in g if x < 0.5),
        "sub0_2s": sum(1 for x in g if x < 0.2),
        "pct_sub1": round(100 * sum(1 for x in g if x < 1) / len(g), 1),
    }


# preload bg user ids that appear as targets
bg_ids = set()
for b in db.bodyguards.find({}, {"_id": 0, "bodyguard_user_id": 1}):
    if b.get("bodyguard_user_id"):
        bg_ids.add(b["bodyguard_user_id"])
# also users flagged bodyguard/npc
for u in db.users.find(
    {"$or": [{"is_bodyguard": True}, {"is_npc": True}]},
    {"_id": 0, "id": 1},
):
    bg_ids.add(u["id"])

rows = list(
    db.attack_attempts.find(
        {"attacker_id": uid, "created_at": {"$gte": since}},
        {
            "_id": 0,
            "created_at": 1,
            "target_id": 1,
            "target_username": 1,
            "outcome": 1,
            "player_message": 1,
        },
    ).sort("created_at", 1)
)

player_block_times = []
player_block_by = Counter()
npc_times = []
npc_by = Counter()
npc_out = Counter()
other = Counter()
by_hour_player_blocks = Counter()
by_hour_npc = Counter()

for r in rows:
    t = as_dt(r.get("created_at"))
    tid = r.get("target_id")
    tn = r.get("target_username") or "?"
    out = r.get("outcome") or "?"
    is_npc_bg = tid in bg_ids
    if is_npc_bg:
        npc_times.append(t)
        npc_by[tn] += 1
        npc_out[out] += 1
        if t:
            by_hour_npc[t.strftime("%H")] += 1
    elif out == "bodyguard":
        player_block_times.append(t)
        player_block_by[tn] += 1
        if t:
            by_hour_player_blocks[t.strftime("%H")] += 1
    else:
        other[out] += 1

print(f"window=Sep5 00:00 UTC -> now ({now.isoformat()}) attempts={len(rows)}")
print(f"\nA) Execute on PLAYERS blocked by BGs: n={len(player_block_times)}")
print(f"   by_target={player_block_by.most_common()}")
print(f"   gaps={gaps([t for t in player_block_times if t])}")
print(f"   by_hour_utc={dict(sorted(by_hour_player_blocks.items()))}")

print(f"\nB) Attempts where TARGET is BG NPC: n={len(npc_times)} outcomes={dict(npc_out)}")
print(f"   by_target={npc_by.most_common()}")
print(f"   gaps={gaps([t for t in npc_times if t])}")
print(f"   by_hour_utc={dict(sorted(by_hour_npc.items()))}")

print(f"\nC) Other outcomes on non-BG targets: {dict(other)}")

# Focused Highlights spam burst around 04:07
hl = [t for t, r in zip(
    [as_dt(r["created_at"]) for r in rows],
    rows,
) if (r.get("target_username") or "").lower() == "highlights" and r.get("outcome") == "bodyguard"]
hl = [t for t in hl if t]
print(f"\nHighlights BG-block spam total={len(hl)} gaps={gaps(hl)}")
# densest 60s
best = 0
j = 0
for i, t in enumerate(hl):
    while j < len(hl) and (hl[j] - t).total_seconds() <= 60:
        j += 1
    best = max(best, j - i)
print(f"Highlights max blocks / 60s = {best}")

# current own BGs
bgs = list(db.bodyguards.find({"user_id": uid}, {"_id": 0, "slot_number": 1, "robot_name": 1, "hired_at": 1}))
print("\n5545 current BGs:", bgs)
print("last_seen", db.users.find_one({"id": uid}, {"_id": 0, "last_seen": 1, "current_state": 1}))
