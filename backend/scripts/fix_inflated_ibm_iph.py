"""One-off: find/fix illegal-business income_per_hour inflated by takeover+re-mission exploit.

Run on the live app host (uses backend/.env):
  cd /opt/mafia-app/backend
  ./venv/bin/python scripts/fix_inflated_ibm_iph.py --dry-run
  ./venv/bin/python scripts/fix_inflated_ibm_iph.py --apply
  ./venv/bin/python scripts/fix_inflated_ibm_iph.py --apply --username Schizophrenic
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

# Avoid importing live game modules (may be outdated on server). Core mults are the exploit vector.
INCOME_PER_HOUR_BASE = 700
KILL_TAKEOVER_INCOME_MULT = 1.05

# ibm_1..15 income_mult (must match illegal_business.IBM_MISSIONS_CORE)
CORE_MULTS = [
    ("ibm_1", 1.44),
    ("ibm_2", 1.38),
    ("ibm_3", 1.44),
    ("ibm_4", 1.48),
    ("ibm_5", 1.53),
    ("ibm_6", 1.50),
    ("ibm_7", 1.53),
    ("ibm_8", 1.58),
    ("ibm_9", 1.63),
    ("ibm_10", 1.63),
    ("ibm_11", 1.53),
    ("ibm_12", 1.73),
    ("ibm_13", 1.53),
    ("ibm_14", 1.73),
    ("ibm_15", 1.85),
]

# Extended ladder (ibm_31+) uses income_per_hour_add totaling ~76k + finale — load if available.
def _extended_iph_adds() -> Dict[str, int]:
    try:
        from utils.ibm_missions_extended import EXTENDED_IBM_MISSIONS
        out = {}
        for m in EXTENDED_IBM_MISSIONS:
            add = (m.get("rewards") or {}).get("income_per_hour_add")
            if add:
                out[m["id"]] = int(add)
        return out
    except Exception:
        return {}


def expected_iph_for_completions(completion_rows: List[dict], *, seized: bool) -> Tuple[int, int]:
    completed_ids = {c.get("mission_id") for c in (completion_rows or []) if c.get("mission_id")}
    iph = float(INCOME_PER_HOUR_BASE)
    n = 0
    for mid, mult in CORE_MULTS:
        if mid in completed_ids:
            iph *= float(mult)
            n += 1
    for mid, add in _extended_iph_adds().items():
        if mid in completed_ids:
            iph += int(add)
            n += 1
    # Also count non-income extended missions toward n for reporting
    for mid in completed_ids:
        if mid.startswith("ibm_") and mid not in dict(CORE_MULTS) and mid not in _extended_iph_adds():
            n += 1
    iph_i = max(INCOME_PER_HOUR_BASE, int(iph))
    if seized:
        iph_i = max(INCOME_PER_HOUR_BASE, int(round(iph_i * KILL_TAKEOVER_INCOME_MULT)))
    return iph_i, n


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Write corrections (default is dry-run)")
    ap.add_argument("--username", default=None, help="Only this username (case-insensitive)")
    ap.add_argument("--ratio", type=float, default=3.0)
    ap.add_argument("--min-iph", type=int, default=50_000)
    args = ap.parse_args()
    do_apply = bool(args.apply)

    mongo_url = (os.environ.get("MONGO_URL") or "").strip()
    db_name = (os.environ.get("DB_NAME") or "mafia_game").strip()
    if not mongo_url:
        raise SystemExit("MONGO_URL required")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    businesses = await db.illegal_businesses.find(
        {"income_per_hour": {"$gte": args.min_iph}},
        {"_id": 0},
    ).to_list(5000)
    print(f"DB={db_name}  businesses_scanned={len(businesses)}  min_iph={args.min_iph}")

    rows_out = []
    for biz in businesses:
        uid = biz.get("user_id")
        if not uid:
            continue
        user = await db.users.find_one(
            {"id": uid},
            {"_id": 0, "id": 1, "username": 1, "illegal_business_mission_completions": 1, "money": 1},
        )
        if not user:
            continue
        uname = (user.get("username") or "?").strip()
        if args.username and uname.lower() != args.username.strip().lower():
            continue
        seized = bool(biz.get("seized_from_user_id"))
        expected, n_missions = expected_iph_for_completions(
            user.get("illegal_business_mission_completions") or [],
            seized=seized,
        )
        actual = int(biz.get("income_per_hour") or 0)
        ratio = actual / max(expected, 1)
        needs_fix = ratio >= args.ratio
        if not args.username and not needs_fix:
            continue
        rows_out.append(
            {
                "username": uname,
                "user_id": uid,
                "business_id": biz.get("id"),
                "actual": actual,
                "expected": expected,
                "ratio": round(ratio, 2),
                "missions": n_missions,
                "seized": seized,
                "vault": int(biz.get("vault") or 0),
                "money": int(user.get("money") or 0),
                "needs_fix": needs_fix,
            }
        )

    rows_out.sort(key=lambda r: r["actual"], reverse=True)
    print(f"matched={len(rows_out)}")
    for r in rows_out:
        flag = "FIX" if r["needs_fix"] else "ok "
        print(
            f"  [{flag}] {r['username']}: {r['actual']:,}/hr -> {r['expected']:,}/hr "
            f"(x{r['ratio']}, missions={r['missions']}, seized={r['seized']}, vault=${r['vault']:,}, cash=${r['money']:,})"
        )

    to_fix = [r for r in rows_out if r["needs_fix"]]
    if not do_apply:
        print(f"\nDry-run. Would correct {len(to_fix)}. Re-run with --apply to write.")
        client.close()
        return

    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for r in to_fix:
        await db.illegal_businesses.update_one(
            {"id": r["business_id"], "user_id": r["user_id"]},
            {
                "$set": {
                    "income_per_hour": int(r["expected"]),
                    "iph_exploit_corrected_at": now_iso,
                    "iph_exploit_corrected_from": int(r["actual"]),
                    "iph_exploit_corrected_expected": int(r["expected"]),
                    "last_collected_at": now_iso,
                }
            },
        )
        print(f"  Applied {r['username']}: {r['actual']:,} -> {r['expected']:,}")

    print(f"\nDone. Corrected {len(to_fix)} businesses.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
