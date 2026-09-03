"""Investigate Yama / Luke bodyguard losses around 2026-09-03 20:27."""
from datetime import datetime, timedelta, timezone
from _system_ai_prank_helpers import db

# Find Yama / Luke
cands = list(db.users.find(
    {"$or": [
        {"username": {"$regex": "^yama$", "$options": "i"}},
        {"username": {"$regex": "yama", "$options": "i"}},
        {"username": {"$regex": "^luke$", "$options": "i"}},
        {"email": {"$regex": "luke", "$options": "i"}},
    ]},
    {"_id": 0, "id": 1, "username": 1, "email": 1, "created_at": 1, "civilian_protection_until": 1,
     "new_player_protection_until": 1, "protection_until": 1, "rank_points": 1, "is_dead": 1,
     "bodyguard_slots": 1, "last_seen": 1},
).limit(20))
print("=== USER CANDIDATES ===")
for u in cands:
    print(u)

# Also search bodyguard events / kills mentioning FrankNitti / MachineGunjack / Hidden around that time
print("\n=== HITLIST BG EVENTS mentioning FrankNitti / MachineGun / 20:27 ===")
for e in db.hitlist_bodyguard_events.find({
    "$or": [
        {"guard_username": {"$regex": "FrankNitti", "$options": "i"}},
        {"killer_username": {"$regex": "MachineGun|Hidden|FrankNitti", "$options": "i"}},
        {"owner_username": {"$regex": "yama|luke", "$options": "i"}},
    ]
}).sort("at", -1).limit(20):
    print(e)

print("\n=== ATTACK ATTEMPTS FrankNitti / MachineGunjack around Sep 3 ===")
since = "2026-09-03T19:00:00"
until = "2026-09-03T22:00:00"
atts = list(db.attack_attempts.find({
    "created_at": {"$gte": since, "$lte": until},
    "$or": [
        {"target_username": {"$regex": "FrankNitti|MachineGun", "$options": "i"}},
        {"attacker_username": {"$regex": "FrankNitti|MachineGun|Hidden|Yama", "$options": "i"}},
        {"bodyguard_owner_username": {"$regex": "yama|Yama", "$options": "i"}},
    ]
}, {"_id": 0}).sort("created_at", -1).limit(40))
print("count", len(atts))
for a in atts:
    print(a.get("created_at"), a.get("outcome"), "atk", a.get("attacker_username"), "->", a.get("target_username"),
          "bg", a.get("is_bodyguard_kill"), "owner", a.get("bodyguard_owner_username") or a.get("bodyguard_owner_id"),
          "hitman", a.get("is_hitman_kill"), "pub", a.get("make_public"))
