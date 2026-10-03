"""Read-only: live Chicken Cross odds watch. Usage: python - <since_iso_utc> <minutes> <every_seconds>"""
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

since = datetime.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else datetime.now(timezone.utc) - timedelta(hours=1)
minutes = float(sys.argv[2]) if len(sys.argv) > 2 else 0
every = int(sys.argv[3]) if len(sys.argv) > 3 else 120
EXPECTED = {"easy": 0.90, "medium": 0.80, "hard": 0.68, "expert": 0.50}


def report():
    rows = list(db.gambling_log.find(
        {"game_type": "chicken_cross", "created_at": {"$gte": since}, "details.void": {"$ne": True}},
        {"_id": 0, "username": 1, "details": 1, "created_at": 1},
    ))
    now = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"\n===== {now} UTC  rounds since {since.isoformat()}: {len(rows)}", flush=True)
    diff = defaultdict(lambda: {"rounds": 0, "hops": 0, "safe": 0, "hits": 0, "cash": 0, "bet": 0, "paid": 0, "lanes": []})
    users = defaultdict(lambda: {"rounds": 0, "bet": 0, "paid": 0, "best": 0.0})
    for r in rows:
        d = r.get("details") or {}
        k = str(d.get("difficulty") or "?")
        lane = int(d.get("lane") or 0)
        bet = int(d.get("bet") or 0)
        paid = int(d.get("payout") or 0)
        hit = d.get("result") == "hit"
        s = diff[k]
        s["rounds"] += 1
        s["hops"] += lane
        s["safe"] += lane - 1 if hit else lane
        s["hits"] += 1 if hit else 0
        s["cash"] += 0 if hit else 1
        s["bet"] += bet
        s["paid"] += paid
        s["lanes"].append(lane)
        u = users[r.get("username") or "?"]
        u["rounds"] += 1
        u["bet"] += bet
        u["paid"] += paid
        if not hit:
            u["best"] = max(u["best"], float(d.get("multiplier_cents") or 0) / 100)
    for k, s in sorted(diff.items()):
        surv = s["safe"] / s["hops"] if s["hops"] else 0
        rtp = s["paid"] / s["bet"] if s["bet"] else 0
        lanes = sorted(s["lanes"])
        med = lanes[len(lanes) // 2] if lanes else 0
        print(
            f"{k:7} rounds {s['rounds']:>4}  hops {s['hops']:>5}  survival {surv:6.1%} (expect {EXPECTED.get(k, 0):.0%})"
            f"  hits {s['hits']:>4} cashouts {s['cash']:>4}  median lane {med:>3} max {max(lanes) if lanes else 0:>3}"
            f"  return {rtp:6.1%}  wagered ${s['bet']:,} paid ${s['paid']:,}",
            flush=True,
        )
    for name, u in sorted(users.items(), key=lambda kv: -(kv[1]["paid"] - kv[1]["bet"])):
        print(f"   {name:18} rounds {u['rounds']:>4}  net ${u['paid'] - u['bet']:>+20,}  best cashout x{u['best']:,.2f}", flush=True)


end = time.time() + minutes * 60
while True:
    report()
    if time.time() + every > end:
        break
    time.sleep(every)
