"""Yama protection + Highlights attacks around the BG losses."""
from datetime import datetime, timedelta, timezone
from _system_ai_prank_helpers import db

YID = "b71ceb68-54f9-44f4-8077-7380a38be072"
HID = "ff620eef-283a-4016-a172-d33854bcee7b"

u = db.users.find_one({"id": YID}, {"_id": 0})
keys = sorted(k for k in (u or {}) if any(x in k.lower() for x in ("protect", "civilian", "new_player", "safe", "immune", "shield")))
print("=== YAMA PROTECTION FIELDS ===")
for k in keys:
    print(k, ":", u.get(k))
print("created_at", u.get("created_at"))
print("username", u.get("username"), "bodyguard_slots", u.get("bodyguard_slots"))

print("\n=== CURRENT BODYGUARDS ===")
for b in db.bodyguards.find({"user_id": YID}, {"_id": 0}).sort("slot_number", 1):
    print(b)

print("\n=== ALL YAMA BG EVENTS ===")
for e in db.hitlist_bodyguard_events.find({"owner_id": YID}, {"_id": 0}).sort("at", 1):
    print(e.get("at"), e.get("type"), e.get("guard_username") or e.get("bodyguard_username"), "killer", e.get("killer_username") or e.get("killer_id"), "via", e.get("via"), "bullets", e.get("bullets_used"), "hire", e.get("hire_cost"))

print("\n=== ACTIVITY: protection / civilian ===")
for a in db.activity_log.find({"user_id": YID, "action": {"$regex": "protect|civilian|bodyguard|hitman|attack", "$options": "i"}}).sort("created_at", -1).limit(40):
    print(a.get("created_at"), a.get("action"), str(a.get("details") or a.get("meta") or "")[:160])

print("\n=== HIGHLIGHTS attacks Sep 3 20:20-20:40 ===")
# mixed date types
q = {"attacker_id": HID, "$or": [
    {"created_at": {"$gte": datetime(2026,9,3,20,20), "$lte": datetime(2026,9,3,20,40)}},
    {"created_at": {"$gte": "2026-09-03T20:20:00", "$lte": "2026-09-03T20:40:00"}},
]}
for a in db.attack_attempts.find(q, {"_id": 0}).sort("created_at", 1).limit(30):
    print(a.get("created_at"), a.get("outcome"), a.get("target_username"), "bg", a.get("is_bodyguard_kill"), "owner", a.get("bodyguard_owner_id"), "hitman", a.get("is_hitman_kill"), "hidden", a.get("make_public"), "bullets", a.get("bullets_used"))

print("\n=== YAMA as attacker Sep 3 afternoon/eve ===")
q2 = {"attacker_id": YID, "$or": [
    {"created_at": {"$gte": datetime(2026,9,3,12,0)}},
    {"created_at": {"$gte": "2026-09-03T12:00:00"}},
]}
for a in db.attack_attempts.find(q2, {"_id": 0}).sort("created_at", -1).limit(25):
    print(a.get("created_at"), a.get("outcome"), a.get("target_username"), "bg", a.get("is_bodyguard_kill"), "owner", a.get("bodyguard_owner_username") or a.get("bodyguard_owner_id"), "bullets", a.get("bullets_used"))

print("\n=== HITMAN EVENTS Yama / Highlights ===")
for h in db.hitman_events.find({"$or": [{"hirer_id": HID}, {"target_owner_id": YID}, {"owner_id": YID}]}).sort("_id", -1).limit(10):
    print(h)
