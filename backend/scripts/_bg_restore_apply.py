"""Restore bodyguards lost while the kill search timers were freed.

Owners still short a guard: shift every guard at slot >= 2 up one (top-down so the
target slot is always free), then drop a fresh robot into slot 2. Visible guard is
max(slot_number), so their old guard stays the visible one and the new robot backfills.

Owners who already re-hired back to 4: 500 points instead.

Usage:
    python _bg_restore_apply.py            # dry run
    python _bg_restore_apply.py --apply
"""
import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path("/opt/mafia-app/backend")
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(str(BACKEND_DIR / ".env"))

APPLY = "--apply" in sys.argv
SNAPSHOT = BACKEND_DIR / "scripts" / "_bg_restore_snapshot.json"

# From _bg_restore_plan.py against the live data.
RESTORE = [
    "8da33080-23f3-410e-87df-d22c147409e9",  # Vuse        3 -> 4
    "198d7467-75d4-4aa9-a74f-aa47a260fbe0",  # OneShot     2 -> 3
    "8e61bd9a-bc71-4abb-b490-7fbf7e33283c",  # Zwischenzug 2 -> 3
    "ccabedb7-e6bd-4b7c-bd59-d0d7053f80c2",  # Rabbit      3 -> 4
]
POINTS = [
    "b71ceb68-54f9-44f4-8077-7380a38be072",  # Yama
    "ff620eef-283a-4016-a172-d33854bcee7b",  # Highlights
    "828d4094-7095-4007-bb4e-9d8c25c7bc8f",  # Schizophrenic
]
POINTS_AWARD = 500
REASON = "bodyguard lost during the Cloudflare search-timer incident"


async def main():
    from server import db  # noqa: F401  (shared motor handle)
    from routers.kill.bodyguards import _create_robot_bodyguard_user, _invalidate_bodyguards_cache
    from utils.point_provenance import log_points_event

    snapshot = {"at": datetime.now(timezone.utc).isoformat(), "restore": [], "points": []}

    print("=== SLOT RESTORE ===")
    for oid in RESTORE:
        u = await db.users.find_one({"id": oid}, {"_id": 0, "id": 1, "username": 1, "bodyguard_slots": 1})
        if not u:
            print(f"  !! user {oid} not found")
            continue
        rows = await db.bodyguards.find({"user_id": oid}, {"_id": 0}).sort("slot_number", 1).to_list(10)
        before = [{"id": r["id"], "slot_number": r.get("slot_number"), "robot_name": r.get("robot_name")} for r in rows]
        shift = sorted([r for r in rows if int(r.get("slot_number") or 0) >= 2],
                       key=lambda r: int(r.get("slot_number") or 0), reverse=True)
        new_total = len(rows) + 1
        print(f"\n{u.get('username')}: {len(rows)} -> {new_total} guards")
        for r in shift:
            s = int(r["slot_number"])
            print(f"  move slot {s} -> {s + 1}  ({r.get('robot_name')})")
        print(f"  new robot -> slot 2")
        print(f"  bodyguard_slots {u.get('bodyguard_slots')} -> {new_total}")

        if not APPLY:
            continue

        for r in shift:
            s = int(r["slot_number"])
            await db.bodyguards.update_one({"id": r["id"]}, {"$set": {"slot_number": s + 1}})
        robot_user_id, robot_name, robot_state = await _create_robot_bodyguard_user(u)
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": oid,
            "owner_username": u.get("username"),
            "slot_number": 2,
            "is_robot": True,
            "robot_name": robot_name,
            "bodyguard_user_id": robot_user_id,
            "health": 100,
            "armour_level": 0,
            "hired_at": datetime.now(timezone.utc).isoformat(),
            "hire_cost": 0,
            "hired_with_token": False,
            "restored_incident": "search_timer_freed_2026_09_03",
        }
        await db.bodyguards.insert_one(doc)
        await db.users.update_one(
            {"id": oid},
            {"$set": {"bodyguard_slots": new_total},
             "$unset": {"bodyguard_robot_loss_hire_allowed_after": ""}},
        )
        await db.hitlist_bodyguard_events.insert_one({
            "at": datetime.now(timezone.utc),
            "type": "bodyguard_hired",
            "owner_id": oid,
            "owner_username": u.get("username") or "",
            "slot": 2,
            "is_robot": True,
            "hire_cost": 0,
            "bodyguard_username": robot_name,
            "guard_user_id": robot_user_id,
            "bodyguard_slot_row_id": doc["id"],
            "restored_incident": "search_timer_freed_2026_09_03",
        })
        _invalidate_bodyguards_cache(oid)
        snapshot["restore"].append({
            "owner_id": oid, "username": u.get("username"),
            "bodyguard_slots_before": u.get("bodyguard_slots"), "bodyguard_slots_after": new_total,
            "rows_before": before, "new_row_id": doc["id"], "new_robot_user_id": robot_user_id,
            "new_robot_name": robot_name, "new_robot_state": robot_state,
        })
        after = await db.bodyguards.find({"user_id": oid}, {"_id": 0, "slot_number": 1, "robot_name": 1}).sort("slot_number", 1).to_list(10)
        print("  now: " + ", ".join(f"{r['slot_number']}:{r.get('robot_name')}" for r in after))

    print("\n=== 500 POINTS ===")
    for oid in POINTS:
        u = await db.users.find_one({"id": oid}, {"_id": 0, "id": 1, "username": 1, "points": 1})
        if not u:
            print(f"  !! user {oid} not found")
            continue
        before_pts = int(u.get("points") or 0)
        print(f"  {u.get('username')}: {before_pts} -> {before_pts + POINTS_AWARD}")
        if not APPLY:
            continue
        await db.users.update_one({"id": oid}, {"$inc": {"points": POINTS_AWARD}})
        await log_points_event(
            db, user_id=oid, points=POINTS_AWARD, event_type="admin_compensation",
            event_ref="search_timer_freed_2026_09_03",
            meta={"reason": REASON, "already_rehired_to_4": True},
            wallet_points_before=before_pts, wallet_points_after=before_pts + POINTS_AWARD,
            source="script:_bg_restore_apply",
        )
        snapshot["points"].append({"owner_id": oid, "username": u.get("username"),
                                   "points_before": before_pts, "awarded": POINTS_AWARD})

    if APPLY:
        SNAPSHOT.write_text(json.dumps(snapshot, indent=2))
        print(f"\nsnapshot -> {SNAPSHOT}")
    else:
        print("\nDRY RUN — nothing written. Re-run with --apply")


asyncio.run(main())
