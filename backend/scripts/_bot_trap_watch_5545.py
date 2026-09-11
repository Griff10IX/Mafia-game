"""Bot trap check for 5545 — same as Zwischenzug. Rotate challenge randomly for ~5 min."""
from __future__ import annotations

import os
import secrets
import time
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USERNAME = "5545"
WATCH_SECONDS = 5 * 60
ROTATE_MIN = 35
ROTATE_MAX = 75


def find_user():
    return db.users.find_one(
        {"username": {"$regex": f"^{USERNAME}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "is_banned": 1, "last_seen": 1},
    )


def set_trap(user: dict, *, keep_counters: bool = False, start_failures: int = 10) -> dict:
    prev = db.bot_traps.find_one({"user_id": user["id"]}) or {}
    # Start at >=10 so /attack/list polling cannot wipe the trap (bots poll list constantly).
    failures = int(prev.get("failures") or 0) if keep_counters else int(start_failures)
    successes = int(prev.get("successes") or 0) if keep_counters else 0
    field = f"x_{secrets.token_hex(4)}"
    value = secrets.token_hex(8)
    doc = {
        "user_id": user["id"],
        "username": user.get("username") or USERNAME,
        "challenge_field": field,
        "challenge_value": value,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
        "failures": failures,
        "successes": successes,
        "active": True,
        "watch_target": "5545_human_check",
        "failures_at_arm": int(start_failures) if not keep_counters else int(prev.get("failures_at_arm") or start_failures),
    }
    db.bot_traps.update_one({"user_id": user["id"]}, {"$set": doc}, upsert=True)
    return doc


def snap(user_id: str) -> dict:
    t = db.bot_traps.find_one({"user_id": user_id}) or {}
    return {
        "active": bool(t.get("active")),
        "failures": int(t.get("failures") or 0),
        "successes": int(t.get("successes") or 0),
        "field": t.get("challenge_field"),
        "exists": bool(t),
    }


def recent_attacks(user_id: str, since: datetime) -> int:
    # attack_attempts / combat_attempts vary; count both loosely
    n = 0
    for coll in ("attack_attempts", "combat_attempts", "attacks"):
        try:
            n += db[coll].count_documents(
                {
                    "attacker_id": user_id,
                    "created_at": {"$gte": since},
                }
            )
        except Exception:
            pass
    return n


def verdict(failures: int, successes: int, trap_cleared: bool, fail_delta: int, elapsed: float, arm_failures: int = 10) -> str:
    # Successes mean client sent the rotating field (official UI does not) — treat carefully.
    if successes > 0 and fail_delta < 5 and successes >= fail_delta:
        return "LIKELY_HUMAN"
    if trap_cleared and failures < 10 and fail_delta < 30:
        return "LIKELY_HUMAN"
    # Net new fails after arm baseline
    net = max(0, failures - arm_failures)
    if net >= 50 or fail_delta >= 40:
        return "LIKELY_BOT"
    if net >= 15 and elapsed >= 60:
        return "LIKELY_BOT"
    if net == 0 and successes == 0 and elapsed >= 180:
        return "INACTIVE_OR_NOT_ATTACKING"
    return "UNCLEAR"


def main() -> None:
    user = find_user()
    if not user:
        print("USER_NOT_FOUND 5545")
        return
    uid = user["id"]
    print(f"=== BOT TRAP WATCH: {user.get('username')} ({uid}) ===")
    print(f"dead={user.get('is_dead')} banned={user.get('is_banned')} last_seen={user.get('last_seen')}")
    print(f"duration={WATCH_SECONDS}s rotate={ROTATE_MIN}-{ROTATE_MAX}s")

    trap = set_trap(user, keep_counters=False, start_failures=10)
    print(f"TRAP_ON field={trap['challenge_field']} failures={trap['failures']} successes=0")
    print("NOTE: live trap code redeployed. Arm failures=10 so list polling cannot clear trap.")
    print("Human signal: stops after errors / no hammer. Bot: failures climb fast on execute.")

    start = time.time()
    baseline = snap(uid)
    arm_failures = baseline["failures"]
    next_rotate = start + secrets.randbelow(ROTATE_MAX - ROTATE_MIN + 1) + ROTATE_MIN
    last_print = 0.0
    watch_start = datetime.now(timezone.utc)

    while True:
        now = time.time()
        elapsed = now - start
        if elapsed >= WATCH_SECONDS:
            break

        if now >= next_rotate:
            trap = set_trap(user, keep_counters=True)
            print(
                f"[{int(elapsed):4d}s] ROTATE field={trap['challenge_field']} "
                f"fail={trap['failures']} ok={trap['successes']}"
            )
            next_rotate = now + secrets.randbelow(ROTATE_MAX - ROTATE_MIN + 1) + ROTATE_MIN

        s = snap(uid)
        fail_delta = s["failures"] - baseline["failures"]
        trap_cleared = not s["exists"]
        v = verdict(s["failures"], s["successes"], trap_cleared, fail_delta, elapsed, arm_failures)

        if now - last_print >= 20 or v in ("LIKELY_HUMAN", "LIKELY_BOT"):
            atk = recent_attacks(uid, watch_start)
            print(
                f"[{int(elapsed):4d}s] fail={s['failures']} ok={s['successes']} "
                f"delta_fail={fail_delta} net={s['failures'] - arm_failures} "
                f"trap={'GONE' if trap_cleared else 'ON'} "
                f"attacks_since_start~={atk} -> {v}"
            )
            last_print = now

        if v == "LIKELY_HUMAN":
            print("\n=== STOP: looks human ===")
            print(f"failures={s['failures']} successes={s['successes']} trap_cleared={trap_cleared}")
            db.bot_traps.delete_one({"user_id": uid})
            print("Trap removed. Verdict: NOT a bot (human-like recovery / success).")
            return

        if v == "LIKELY_BOT" and elapsed >= 45:
            print("\n=== STOP EARLY: bot pattern ===")
            print(f"failures={s['failures']} successes={s['successes']} delta_fail={fail_delta}")
            print("Leaving trap ACTIVE.")
            return

        time.sleep(5)

    s = snap(uid)
    fail_delta = s["failures"] - baseline["failures"]
    trap_cleared = not s["exists"]
    v = verdict(s["failures"], s["successes"], trap_cleared, fail_delta, WATCH_SECONDS, arm_failures)
    print("\n=== 5 MIN COMPLETE ===")
    print(f"failures={s['failures']} successes={s['successes']} delta_fail={fail_delta} trap_cleared={trap_cleared}")
    print(f"VERDICT: {v}")
    if v == "LIKELY_HUMAN":
        db.bot_traps.delete_one({"user_id": uid})
        print("Trap removed.")
    elif v == "INACTIVE_OR_NOT_ATTACKING":
        db.bot_traps.delete_one({"user_id": uid})
        print("No execute pressure on trap — cleared so he isn't stuck idle.")
    else:
        print("Trap left as-is for review.")


if __name__ == "__main__":
    main()
