"""Read-only: type-aware check of attacks / bodyguard kills tonight."""
import datetime
from collections import Counter
from pathlib import Path

from pymongo import MongoClient

env = {}
for line in Path("/opt/mafia-app/backend/.env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")

db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]

FREED = datetime.datetime(2026, 9, 3, 21, 17, 57, tzinfo=datetime.timezone.utc)
EVENING = datetime.datetime(2026, 9, 3, 17, 0, 0, tzinfo=datetime.timezone.utc)


def parse(raw):
    if isinstance(raw, datetime.datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=datetime.timezone.utc)
    try:
        d = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


latest = db.attack_attempts.find_one({}, {"_id": 0, "created_at": 1}, sort=[("_id", -1)])
print("latest attack_attempts.created_at:", repr(latest and latest.get("created_at")),
      type(latest and latest.get("created_at")).__name__)
print()

# Pull recent docs by _id order and filter in Python (type-agnostic).
recent = list(db.attack_attempts.find(
    {},
    {"_id": 0, "created_at": 1, "outcome": 1, "attacker_username": 1, "target_username": 1,
     "is_bodyguard_kill": 1, "bodyguard_owner_username": 1, "target_is_npc": 1,
     "bullets_used": 1, "attack_id": 1},
    sort=[("_id", -1)],
).limit(4000))

evening, in_window = [], []
for r in recent:
    dt = parse(r.get("created_at"))
    if not dt:
        continue
    if dt >= EVENING:
        evening.append((dt, r))
    if dt >= FREED:
        in_window.append((dt, r))

evening.sort()
in_window.sort()

print(f"=== attempts since 17:00 UTC: {len(evening)} ===")
print("outcomes:", dict(Counter(r.get("outcome") for _, r in evening)))
print("bodyguard kills:", sum(1 for _, r in evening if r.get("is_bodyguard_kill")))
print()

print(f"=== attempts AFTER timers were freed ({FREED.strftime('%H:%M:%S')}): {len(in_window)} ===")
if not in_window:
    print("  none - nobody attacked while the timers were freed")
for dt, r in in_window:
    print(f"  {dt.strftime('%H:%M:%S')} {str(r.get('outcome')):10s} "
          f"{str(r.get('attacker_username')):16s} -> {str(r.get('target_username')):26s} "
          f"bg_kill={bool(r.get('is_bodyguard_kill'))} owner={r.get('bodyguard_owner_username')}")

print()
print("=== bodyguard kills this evening (17:00+) ===")
for dt, r in evening:
    if r.get("is_bodyguard_kill"):
        print(f"  {dt.strftime('%H:%M:%S')} {r.get('attacker_username')} killed "
              f"{r.get('target_username')} (owner: {r.get('bodyguard_owner_username')})")

print()
print("=== owners currently below 4 bodyguards ===")
agg = list(db.bodyguards.aggregate([{"$group": {"_id": "$user_id", "n": {"$sum": 1}}}]))
counts = {a["_id"]: a["n"] for a in agg}
low = []
for uid, n in counts.items():
    if n < 4:
        u = db.users.find_one({"id": uid}, {"_id": 0, "username": 1, "is_dead": 1})
        if u and not u.get("is_dead"):
            low.append((u.get("username"), n))
for name, n in sorted(low, key=lambda x: x[1]):
    print(f"  {name}: {n}")
print("total owners with any bodyguards:", len(counts))
