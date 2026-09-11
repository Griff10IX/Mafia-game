"""Top up 5545 to 4 robot bodyguards ONLY when nobody in his city is landing BG blocks.

Waits until:
  - 5545 alive
  - currently has exactly 1 filled bodyguard slot (or <4 empty slots to fill)
  - no found/executing hunters co-located with him
  - no bodyguard-outcome attack_attempts in a quiet window
  - N consecutive safe polls

Then fills empty slots 1-4 with new robot NPCs (does not replace existing).
Re-checks immediately before apply; aborts if risk returns mid-op.

Usage (on live):
  cd /opt/mafia-app && backend/venv/bin/python backend/scripts/_5545_topup_robot_bgs_safe.py
  # dry:
  ... --dry-run
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path("/opt/mafia-app/backend")
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(str(BACKEND_DIR / ".env"))

USERNAME = "5545"
TARGET_FILLED = 4
POLL_SEC = 1.5
QUIET_ATTEMPT_SEC = 12  # no BG-block / execute attempts this recent
SAFE_STREAK_NEEDED = 3  # ~4.5s consecutive safe
MAX_WAIT_SEC = 45 * 60
DRY = "--dry-run" in sys.argv


def _norm_city(v) -> str:
    return str(v or "").strip().lower()


def _as_utc(dt):
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except Exception:
            return None
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def load_target(db):
    return await db.users.find_one(
        {"username": {"$regex": f"^{USERNAME}$", "$options": "i"}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "current_state": 1,
            "is_dead": 1,
            "bodyguard_slots": 1,
            "traveling_to": 1,
            "travel_arrives_at": 1,
            "travel_from": 1,
            "travel_origin": 1,
            "from_state": 1,
        },
    )


async def filled_slots(db, uid: str):
    rows = await db.bodyguards.find(
        {"user_id": uid},
        {"_id": 0, "slot_number": 1, "is_robot": 1, "robot_name": 1, "bodyguard_user_id": 1, "hired_at": 1},
    ).sort("slot_number", 1).to_list(10)
    filled = [
        r
        for r in rows
        if r.get("bodyguard_user_id") or r.get("is_robot") or r.get("robot_name")
    ]
    occupied = {int(r.get("slot_number") or 0) for r in filled if int(r.get("slot_number") or 0) >= 1}
    empty = [s for s in range(1, TARGET_FILLED + 1) if s not in occupied]
    return filled, empty


def combat_cities(u: dict) -> set[str]:
    """City where someone can land BG-block feedback on this user.

    Mid-travel: current_state stays at origin until land — that is the only
    shootable city. Do NOT add traveling_to (destination) — hunters there cannot
    execute yet, and treating it as hot false-blocks top-ups.
    """
    cur = _norm_city(u.get("current_state"))
    return {cur} if cur else set()


async def colocated_found_hunters(db, tid: str, hot_cities: set[str]) -> list[dict]:
    """Found hunts where the attacker is physically in a hot city (can land BG blocks).

    Hunt location_state alone is NOT enough — stale found rows often keep the old city
    after the attacker leaves. Only attacker.current_state (or mid-travel origin) counts.
    """
    if not hot_cities:
        return []
    hunts = await db.attacks.find(
        {
            "target_id": tid,
            "status": {"$in": ["found", "traveling"]},
        },
        {
            "_id": 0,
            "attacker_id": 1,
            "attacker_username": 1,
            "status": 1,
            "location_state": 1,
        },
    ).to_list(50)

    out = []
    for h in hunts:
        aid = h.get("attacker_id")
        if not aid:
            continue
        au = await db.users.find_one(
            {"id": aid},
            {
                "_id": 0,
                "current_state": 1,
                "traveling_to": 1,
                "travel_arrives_at": 1,
                "travel_from": 1,
                "travel_origin": 1,
                "from_state": 1,
            },
        )
        if not au:
            continue
        attacker_cities = combat_cities(au)
        if attacker_cities & hot_cities:
            out.append(
                {
                    "attacker": h.get("attacker_username") or aid,
                    "status": h.get("status"),
                    "hunt_loc": h.get("location_state"),
                    "attacker_cities": sorted(attacker_cities),
                }
            )
    return out


def _since_query_values(since: datetime):
    """attack_attempts.created_at is often naive UTC — query both aware + naive."""
    aware = _as_utc(since) or since
    naive = aware.replace(tzinfo=None) if getattr(aware, "tzinfo", None) else aware
    return [aware, naive]


async def recent_bg_blocks(db, tid: str, since: datetime) -> list[dict]:
    rows = []
    seen = set()
    for since_v in _since_query_values(since):
        batch = (
            await db.attack_attempts.find(
                {
                    "target_id": tid,
                    "created_at": {"$gte": since_v},
                    "outcome": "bodyguard",
                },
                {
                    "_id": 1,
                    "created_at": 1,
                    "attacker_username": 1,
                    "attacker_id": 1,
                    "outcome": 1,
                    "player_message": 1,
                },
            )
            .sort("created_at", -1)
            .to_list(30)
        )
        for r in batch:
            rid = str(r.get("_id"))
            if rid in seen:
                continue
            seen.add(rid)
            rows.append(r)
    return rows


async def any_recent_attempts(db, tid: str, since: datetime) -> int:
    # Prefer naive (how live rows are stored)
    naive = (_as_utc(since) or since).replace(tzinfo=None)
    return await db.attack_attempts.count_documents(
        {"target_id": tid, "created_at": {"$gte": naive}}
    )


async def safety_snapshot(db, u: dict) -> dict:
    tid = u["id"]
    hot = combat_cities(u)
    since = datetime.now(timezone.utc) - timedelta(seconds=QUIET_ATTEMPT_SEC)
    hunters = await colocated_found_hunters(db, tid, hot)
    blocks = await recent_bg_blocks(db, tid, since)
    attempts = await any_recent_attempts(db, tid, since)
    filled, empty = await filled_slots(db, tid)
    # Extra: anyone with found hunt at all (even wrong city) is lower risk for *seeing*
    # new BGs only if they execute in-city — still flag colocated only for hard block.
    safe = (
        not u.get("is_dead")
        and len(hunters) == 0
        and len(blocks) == 0
        # If any execute attempts at all in quiet window, wait — might be non-BG outcomes
        # but means someone is on him in-city. Count only if hunters empty already.
        and attempts == 0
        and len(empty) > 0
        and len(filled) < TARGET_FILLED
    )
    return {
        "safe": safe,
        "dead": bool(u.get("is_dead")),
        "city": u.get("current_state"),
        "hot_cities": sorted(hot),
        "filled": len(filled),
        "empty": empty,
        "guards": [
            f"{r.get('slot_number')}:{r.get('robot_name') or r.get('bodyguard_user_id')}"
            for r in filled
        ],
        "colocated_hunters": hunters,
        "recent_bg_blocks": len(blocks),
        "recent_attempts": attempts,
        "block_sample": [
            {
                "at": str(b.get("created_at")),
                "who": b.get("attacker_username"),
                "outcome": b.get("outcome"),
            }
            for b in blocks[:3]
        ],
    }


async def apply_topup(db, u: dict, empty: list[int]) -> list[dict]:
    from routers.kill.bodyguards import _create_robot_bodyguard_user, _invalidate_bodyguards_cache

    tid = u["id"]
    uname = u.get("username") or USERNAME
    owner_state = u.get("current_state") or "Chicago"
    now_iso = datetime.now(timezone.utc).isoformat()
    created = []

    # Ensure slots capacity
    slots = int(u.get("bodyguard_slots") or 0)
    if slots < TARGET_FILLED:
        await db.users.update_one({"id": tid}, {"$set": {"bodyguard_slots": TARGET_FILLED}})

    for slot in empty:
        # Re-check safety before EACH hire
        fresh = await load_target(db)
        snap = await safety_snapshot(db, fresh)
        if not snap["safe"] and snap["colocated_hunters"]:
            raise RuntimeError(f"ABORT mid-apply: colocated hunters {snap['colocated_hunters']}")
        if snap["recent_bg_blocks"] or snap["recent_attempts"]:
            raise RuntimeError(
                f"ABORT mid-apply: recent activity blocks={snap['recent_bg_blocks']} attempts={snap['recent_attempts']}"
            )

        # Slot still empty?
        exists = await db.bodyguards.find_one(
            {"user_id": tid, "slot_number": slot},
            {"_id": 0, "id": 1, "bodyguard_user_id": 1, "is_robot": 1},
        )
        if exists and (exists.get("bodyguard_user_id") or exists.get("is_robot")):
            print(f"  skip slot {slot}: already filled", flush=True)
            continue

        robot_user_id, robot_name, _ = await _create_robot_bodyguard_user(fresh)
        await db.users.update_one(
            {"id": robot_user_id},
            {"$set": {"current_state": owner_state}},
        )
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": tid,
            "owner_username": uname,
            "slot_number": slot,
            "is_robot": True,
            "robot_name": robot_name,
            "bodyguard_user_id": robot_user_id,
            "health": 100,
            "armour_level": 0,
            "hired_at": now_iso,
            "hire_cost": 0,
            "hired_with_token": False,
            "staff_topup": "5545_safe_topup_to_4",
        }
        if exists:
            await db.bodyguards.update_one({"id": exists["id"]}, {"$set": doc})
            row_id = exists["id"]
        else:
            await db.bodyguards.insert_one(doc)
            row_id = doc["id"]

        await db.hitlist_bodyguard_events.insert_one(
            {
                "at": datetime.now(timezone.utc),
                "type": "bodyguard_hired",
                "owner_id": tid,
                "owner_username": uname,
                "slot": slot,
                "is_robot": True,
                "hire_cost": 0,
                "bodyguard_username": robot_name,
                "guard_user_id": robot_user_id,
                "bodyguard_slot_row_id": row_id,
                "staff_topup": "5545_safe_topup_to_4",
                "admin_note": "staff top-up while no colocated attackers",
            }
        )
        created.append({"slot": slot, "robot_name": robot_name, "robot_user_id": robot_user_id})
        print(f"  + slot {slot}: {robot_name}", flush=True)

    await db.users.update_one(
        {"id": tid},
        {
            "$set": {"bodyguard_slots": TARGET_FILLED},
            "$unset": {"bodyguard_robot_loss_hire_allowed_after": ""},
        },
    )
    _invalidate_bodyguards_cache(tid)
    return created


async def main():
    from server import db  # noqa: F401

    print(
        f"=== 5545 safe robot BG top-up to {TARGET_FILLED} "
        f"(dry={DRY} quiet={QUIET_ATTEMPT_SEC}s streak={SAFE_STREAK_NEEDED}) ===",
        flush=True,
    )
    start = time.time()
    streak = 0
    last_reason = ""

    while time.time() - start < MAX_WAIT_SEC:
        u = await load_target(db)
        if not u:
            print("5545 not found", flush=True)
            raise SystemExit(1)
        if u.get("is_dead"):
            print("5545 is dead — abort", flush=True)
            raise SystemExit(2)

        filled, empty = await filled_slots(db, u["id"])
        if len(filled) >= TARGET_FILLED:
            print(f"already at {len(filled)} guards: {filled}", flush=True)
            print("nothing to do", flush=True)
            return

        snap = await safety_snapshot(db, u)
        elapsed = int(time.time() - start)
        if snap["safe"]:
            streak += 1
            reason = f"SAFE streak={streak}/{SAFE_STREAK_NEEDED}"
        else:
            streak = 0
            if snap["colocated_hunters"]:
                reason = f"WAIT colocated={snap['colocated_hunters']}"
            elif snap["recent_bg_blocks"]:
                reason = f"WAIT bg_blocks={snap['recent_bg_blocks']} {snap['block_sample']}"
            elif snap["recent_attempts"]:
                reason = f"WAIT attempts={snap['recent_attempts']} in last {QUIET_ATTEMPT_SEC}s"
            else:
                reason = "WAIT other"

        if reason != last_reason or elapsed % 10 < POLL_SEC:
            print(
                f"[{elapsed:4d}s] city={snap['city']} hot={snap['hot_cities']} "
                f"guards={snap['filled']}/4 empty={snap['empty']} | {reason}",
                flush=True,
            )
            last_reason = reason

        if snap["safe"] and streak >= SAFE_STREAK_NEEDED:
            need = empty[: TARGET_FILLED - len(filled)]
            print(
                f"*** APPLYING top-up: add {len(need)} robots into slots {need} "
                f"(had {snap['guards']}) ***",
                flush=True,
            )
            if DRY:
                print("DRY RUN — not writing", flush=True)
                return
            # Final hard re-check
            u2 = await load_target(db)
            snap2 = await safety_snapshot(db, u2)
            if not snap2["safe"]:
                print(f"final check failed: {snap2} — continue waiting", flush=True)
                streak = 0
                await asyncio.sleep(POLL_SEC)
                continue
            try:
                created = await apply_topup(db, u2, need)
            except RuntimeError as e:
                print(str(e), flush=True)
                streak = 0
                await asyncio.sleep(POLL_SEC)
                continue

            filled_after, _ = await filled_slots(db, u2["id"])
            print(
                f"DONE created={len(created)} total_filled={len(filled_after)} "
                f"-> {[f.get('slot_number') for f in filled_after]}",
                flush=True,
            )
            for r in filled_after:
                print(
                    f"  slot {r.get('slot_number')}: {r.get('robot_name')} "
                    f"robot={r.get('is_robot')}",
                    flush=True,
                )
            if len(filled_after) < TARGET_FILLED:
                print("WARNING: still short after apply — will keep waiting", flush=True)
                streak = 0
                await asyncio.sleep(POLL_SEC)
                continue
            return

        await asyncio.sleep(POLL_SEC)

    print("TIMEOUT waiting for safe window", flush=True)
    raise SystemExit(3)


if __name__ == "__main__":
    asyncio.run(main())
