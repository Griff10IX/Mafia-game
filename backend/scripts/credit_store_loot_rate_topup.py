"""Top up last-24h GBP points buyers for the 75 → 110 loot-per-£1 store rate.

Dry run:
  cd /opt/mafia-app && backend/venv/bin/python backend/scripts/credit_store_loot_rate_topup.py

Live:
  cd /opt/mafia-app && backend/venv/bin/python backend/scripts/credit_store_loot_rate_topup.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from server import POINT_PACKAGES, db, send_notification
from routers.money.payments import (
    CUSTOM_POINTS_PACKAGE_ID,
    _minor_and_currency_for_store_points_loot_bonus,
    loot_box_pieces_for_gbp_stripe_minor,
)

OLD_LOOT_PIECES_PER_GBP = 75
TOPUP_MARK_FIELD = "gbp_store_loot_rate_topup_110_at"
WINDOW_HOURS = 24


def _parse_utc(val: Any) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        dt = val
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _is_points_loot_package(package_id: str) -> bool:
    pid = (package_id or "").strip()
    if pid == CUSTOM_POINTS_PACKAGE_ID:
        return True
    pkg = POINT_PACKAGES.get(pid) or {}
    try:
        return int(pkg.get("points") or 0) > 0
    except (TypeError, ValueError):
        return False


def _old_loot_for_gbp_minor(amount_minor: Optional[int], currency: Optional[str]) -> int:
    if amount_minor is None:
        return 0
    cur = (currency or "gbp").strip().lower()
    if cur != "gbp":
        return 0
    try:
        m = int(amount_minor)
    except (TypeError, ValueError):
        return 0
    if m <= 0:
        return 0
    return (m // 100) * OLD_LOOT_PIECES_PER_GBP


async def _load_recent_completed(cutoff: datetime) -> List[dict]:
    cutoff_iso = cutoff.isoformat()
    rows = await db.payment_transactions.find(
        {
            "payment_status": "completed",
            "$or": [
                {"points_credited_at": {"$gte": cutoff_iso}},
                {"points_credited_at": {"$gte": cutoff}},
                {"created_at": {"$gte": cutoff_iso}},
                {"created_at": {"$gte": cutoff}},
            ],
        },
        {
            "_id": 0,
            "session_id": 1,
            "user_id": 1,
            "package_id": 1,
            "payment_status": 1,
            "points_credited_at": 1,
            "created_at": 1,
            "stripe_amount_total_minor": 1,
            "stripe_currency": 1,
            "expected_amount_minor": 1,
            TOPUP_MARK_FIELD: 1,
        },
    ).to_list(5000)
    out: List[dict] = []
    for row in rows:
        ts = _parse_utc(row.get("points_credited_at")) or _parse_utc(row.get("created_at"))
        if ts is None or ts < cutoff:
            continue
        out.append(row)
    return out


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Credit loot and send inbox messages")
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=WINDOW_HOURS)
    rows = await _load_recent_completed(cutoff)
    by_user: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"loot": 0, "gbp_minor": 0, "sessions": []})
    skipped_marked = 0
    skipped_not_points = 0
    skipped_no_diff = 0
    for row in rows:
        if row.get(TOPUP_MARK_FIELD):
            skipped_marked += 1
            continue
        pid = str(row.get("package_id") or "")
        if not _is_points_loot_package(pid):
            skipped_not_points += 1
            continue
        minor, cur = _minor_and_currency_for_store_points_loot_bonus(row, pid, POINT_PACKAGES)
        old = _old_loot_for_gbp_minor(minor, cur)
        new = loot_box_pieces_for_gbp_stripe_minor(minor, cur)
        diff = int(new) - int(old)
        if diff <= 0:
            skipped_no_diff += 1
            continue
        uid = str(row.get("user_id") or "").strip()
        sid = str(row.get("session_id") or "")
        if not uid or not sid:
            continue
        rec = by_user[uid]
        rec["loot"] += diff
        rec["gbp_minor"] += int(minor or 0)
        rec["sessions"].append((sid, diff, int(minor or 0)))

    print(
        f"Window: last {WINDOW_HOURS}h from {now.isoformat()} "
        f"({len(rows)} completed rows, {len(by_user)} users with a loot top-up)"
    )
    print(f"Skipped already topped up: {skipped_marked}")
    print(f"Skipped non-points packages: {skipped_not_points}")
    print(f"Skipped no loot difference: {skipped_no_diff}")
    total_loot = sum(int(v["loot"]) for v in by_user.values())
    print(f"Total extra loot pieces: {total_loot:,}")
    for uid, rec in sorted(by_user.items(), key=lambda kv: -int(kv[1]["loot"])):
        gbp = int(rec["gbp_minor"]) / 100.0
        print(f"  {uid}: +{int(rec['loot']):,} loot (£{gbp:.2f} across {len(rec['sessions'])} buy(s))")

    if not args.apply:
        print("Dry run only. Re-run with --apply to credit and inbox.")
        return

    credited_users = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    for uid, rec in by_user.items():
        granted = 0
        gbp_minor = 0
        for sid, diff, minor in rec["sessions"]:
            mark = await db.payment_transactions.update_one(
                {"session_id": sid, TOPUP_MARK_FIELD: {"$exists": False}},
                {"$set": {TOPUP_MARK_FIELD: now_iso}},
            )
            if mark.modified_count != 1:
                continue
            await db.users.update_one({"id": uid}, {"$inc": {"loot_box_pieces": int(diff)}})
            granted += int(diff)
            gbp_minor += int(minor or 0)
        if granted <= 0:
            continue
        gbp = gbp_minor / 100.0
        await send_notification(
            uid,
            "Store loot bonus",
            (
                f"GBP store loot was increased to 1,100 pieces per £10. "
                f"You spent £{gbp:.2f} on points in the last 24 hours and have been credited "
                f"{granted:,} extra loot pieces (the difference from the old 750 per £10)."
            ),
            "system",
            category="system",
            always_deliver=True,
        )
        credited_users += 1
        print(f"Credited {uid}: +{granted:,} loot, inbox sent")
    print(f"Applied to {credited_users} user(s).")


if __name__ == "__main__":
    asyncio.run(main())
