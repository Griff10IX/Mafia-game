"""Read-only: plan for restoring bodyguards killed while search timers were freed.

Rule from Jake:
  - Lost a BG in the window and still below where they were -> insert a fresh robot BG at
    slot 2 and shift every existing guard at slot >= 2 up one, so their OLD guard is the
    visible one again (visible = max slot_number) and the new robot backfills underneath.
  - Already re-hired back to 4 -> 500 points instead.
"""
import datetime
import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

FREED_AT = datetime.datetime(2026, 9, 3, 21, 17, 57, tzinfo=datetime.timezone.utc)


def as_dt(v):
    if isinstance(v, datetime.datetime):
        return v if v.tzinfo else v.replace(tzinfo=datetime.timezone.utc)
    if isinstance(v, str):
        try:
            d = datetime.datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
        except Exception:
            return None
    return None


print("=== bodyguard_killed events after", FREED_AT.isoformat(), "===")
kills = []
for e in db.hitlist_bodyguard_events.find({"type": "bodyguard_killed"}, {"_id": 0}).sort("at", 1):
    at = as_dt(e.get("at"))
    if at and at >= FREED_AT:
        kills.append(e)

for e in kills:
    print(
        f"  {as_dt(e.get('at')).isoformat()[11:19]} owner={str(e.get('owner_username')):16s} "
        f"guard={str(e.get('guard_username') or e.get('bodyguard_username')):26s} "
        f"slot={e.get('slot')} killer={e.get('killer_username')} guard_uid={e.get('guard_user_id')}"
    )
print(f"total kills in window: {len(kills)}\n")

owners = {}
for e in kills:
    oid = e.get("owner_id")
    if oid:
        owners.setdefault(oid, []).append(e)

print("=== per owner state ===")
for oid, evs in owners.items():
    u = db.users.find_one({"id": oid}, {"_id": 0, "username": 1, "bodyguard_slots": 1, "points": 1,
                                        "bodyguard_robot_loss_hire_allowed_after": 1})
    bgs = list(db.bodyguards.find({"user_id": oid}, {"_id": 0}).sort("slot_number", 1))
    lost = len(evs)
    have = len(bgs)
    print(f"\n{(u or {}).get('username') or oid}  (id={oid})")
    print(f"  lost_in_window={lost}  current_rows={have}  users.bodyguard_slots={(u or {}).get('bodyguard_slots')}")
    for b in bgs:
        print(f"    slot {b.get('slot_number')}: {'robot ' + str(b.get('robot_name')) if b.get('is_robot') else 'human'} "
              f"hp={b.get('health')} armour={b.get('armour_level')} hired={str(b.get('hired_at'))[:19]} "
              f"guard_uid={b.get('bodyguard_user_id')}")
    # re-hires since the window
    rehires = []
    for e in db.hitlist_bodyguard_events.find({"owner_id": oid, "type": "bodyguard_hired"}, {"_id": 0}).sort("at", 1):
        at = as_dt(e.get("at"))
        if at and at >= FREED_AT:
            rehires.append(e)
    print(f"  re-hires since freed: {len(rehires)}"
          + (" -> " + ", ".join(f"slot{r.get('slot')}@{as_dt(r.get('at')).isoformat()[11:19]}" for r in rehires) if rehires else ""))
    if have >= 4:
        print("  PLAN: already back to 4 -> 500 points")
    else:
        print(f"  PLAN: insert fresh robot at slot 2, shift slots >=2 up one -> ends with {have + 1} guards, "
              f"visible becomes old slot-2 guard at slot 3")

print("\n=== killed guard accounts still present? ===")
for e in kills:
    gid = e.get("guard_user_id")
    if not gid:
        print("  (no guard_user_id on event)", e.get("guard_username"))
        continue
    gu = db.users.find_one({"id": gid}, {"_id": 0, "username": 1, "is_dead": 1, "is_bodyguard": 1, "is_npc": 1})
    row = db.bodyguards.find_one({"bodyguard_user_id": gid}, {"_id": 0, "slot_number": 1, "user_id": 1})
    print(f"  {str(e.get('guard_username')):26s} user_doc={'yes' if gu else 'NO'} "
          f"is_dead={(gu or {}).get('is_dead')} bg_row={'yes' if row else 'no'}")
