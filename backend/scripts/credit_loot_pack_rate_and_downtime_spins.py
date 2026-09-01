"""Top last-24h GBP points buyers to the loot-pack rate (1,000 pieces / £7)
and grant 5 banked Wheel spins to all players for update downtime.

Dry run:
  cd /opt/mafia-app && backend/venv/bin/python backend/scripts/credit_loot_pack_rate_and_downtime_spins.py

Live:
  cd /opt/mafia-app && backend/venv/bin/python backend/scripts/credit_loot_pack_rate_and_downtime_spins.py --apply
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

from server import POINT_PACKAGES, db, send_notification, send_notification_to_all
from routers.money.payments import (
    CUSTOM_POINTS_PACKAGE_ID,
    STORE_POINTS_LOOT_PIECES_PER_BLOCK,
    _minor_and_currency_for_store_points_loot_bonus,
    loot_box_pieces_for_gbp_stripe_minor,
)
from utils.loot_piece_store import is_loot_piece_package

# Current points-tab grant (110 per whole £1).
CURRENT_LOOT_PER_WHOLE_GBP = STORE_POINTS_LOOT_PIECES_PER_BLOCK
# Dedicated loot pack: 1,000 pieces for £7.00.
PACK_PIECES = 1000
PACK_GBP_MINOR = 700
PREV_TOPUP_MARK = "gbp_store_loot_rate_topup_110_at"
PACK_TOPUP_MARK = "gbp_store_loot_pack_rate_1000_per_7_at"
SPINS_SETTINGS_KEY = "downtime_wheel_spins_5_2026_08_30"
SPINS_GRANT = 5
WINDOW_HOURS = 36


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
    if is_loot_piece_package(pid):
        return False
    if pid == CUSTOM_POINTS_PACKAGE_ID:
        return True
    pkg = POINT_PACKAGES.get(pid) or {}
    try:
        return int(pkg.get("points") or 0) > 0
    except (TypeError, ValueError):
        return False


def pack_loot_for_gbp_minor(amount_minor: Optional[int], currency: Optional[str]) -> int:
    """Pieces at 1,000 per £7, using paid pence (no leftover carry)."""
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
    return (m * PACK_PIECES) // PACK_GBP_MINOR


async def _load_rows(cutoff: datetime) -> List[dict]:
    cutoff_iso = cutoff.isoformat()
    rows = await db.payment_transactions.find(
        {
            "payment_status": "completed",
            "$or": [
                {PREV_TOPUP_MARK: {"$exists": True}},
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
            "points_credited_at": 1,
            "created_at": 1,
            "stripe_amount_total_minor": 1,
            "stripe_currency": 1,
            "expected_amount_minor": 1,
            PREV_TOPUP_MARK: 1,
            PACK_TOPUP_MARK: 1,
        },
    ).to_list(8000)
    out: List[dict] = []
    for row in rows:
        if row.get(PREV_TOPUP_MARK):
            out.append(row)
            continue
        ts = _parse_utc(row.get("points_credited_at")) or _parse_utc(row.get("created_at"))
        if ts is None or ts < cutoff:
            continue
        out.append(row)
    return out


async def _usernames(user_ids: List[str]) -> Dict[str, str]:
    if not user_ids:
        return {}
    docs = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1},
    ).to_list(len(user_ids))
    return {str(d.get("id")): str(d.get("username") or "") for d in docs}


async def credit_loot_pack_rate(*, apply: bool) -> int:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=WINDOW_HOURS)
    rows = await _load_rows(cutoff)
    by_user: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"loot": 0, "gbp_minor": 0, "sessions": []})
    skipped_marked = 0
    skipped_not_points = 0
    skipped_no_diff = 0
    for row in rows:
        if row.get(PACK_TOPUP_MARK):
            skipped_marked += 1
            continue
        pid = str(row.get("package_id") or "")
        if not _is_points_loot_package(pid):
            skipped_not_points += 1
            continue
        minor, cur = _minor_and_currency_for_store_points_loot_bonus(row, pid, POINT_PACKAGES)
        current = loot_box_pieces_for_gbp_stripe_minor(minor, cur)
        target = pack_loot_for_gbp_minor(minor, cur)
        diff = int(target) - int(current)
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
        rec["sessions"].append((sid, diff, int(minor or 0), int(current), int(target)))

    names = await _usernames(list(by_user.keys()))
    print(
        f"Loot pack-rate window: last {WINDOW_HOURS}h + prior 110 top-ups "
        f"({len(rows)} rows, {len(by_user)} users)"
    )
    print(f"Skipped already pack-topped: {skipped_marked}")
    print(f"Skipped non-points packages: {skipped_not_points}")
    print(f"Skipped no loot difference: {skipped_no_diff}")
    total_loot = sum(int(v["loot"]) for v in by_user.values())
    print(f"Total extra loot pieces: {total_loot:,}")
    for uid, rec in sorted(by_user.items(), key=lambda kv: -int(kv[1]["loot"])):
        gbp = int(rec["gbp_minor"]) / 100.0
        uname = names.get(uid) or uid
        print(f"  {uname} ({uid}): +{int(rec['loot']):,} loot (£{gbp:.2f}, {len(rec['sessions'])} buy(s))")
        for sid, diff, minor, current, target in rec["sessions"]:
            print(
                f"    session {sid}: £{minor / 100.0:.2f} had {current:,} -> {target:,} (+{diff:,})"
            )

    if not apply:
        print("Loot dry run only.")
        return 0

    credited_users = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    for uid, rec in by_user.items():
        granted = 0
        gbp_minor = 0
        for sid, diff, minor, _current, _target in rec["sessions"]:
            mark = await db.payment_transactions.update_one(
                {"session_id": sid, PACK_TOPUP_MARK: {"$exists": False}},
                {"$set": {PACK_TOPUP_MARK: now_iso}},
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
                f"Loot piece packs are now 1,000 pieces for £7. "
                f"You spent £{gbp:.2f} on points recently and have been credited "
                f"{granted:,} extra loot pieces so your grant matches that rate."
            ),
            "system",
            category="system",
            always_deliver=True,
        )
        credited_users += 1
        print(f"Credited loot {names.get(uid) or uid}: +{granted:,}")
    print(f"Loot pack-rate applied to {credited_users} user(s).")
    return credited_users


async def grant_downtime_spins(*, apply: bool) -> int:
    existing = await db.game_settings.find_one({"key": SPINS_SETTINGS_KEY}, {"_id": 0})
    if existing:
        print(f"Wheel spins already granted ({SPINS_SETTINGS_KEY}). Skipping.")
        return 0
    filt = {"is_npc": {"$ne": True}, "id": {"$exists": True, "$ne": ""}}
    eligible = await db.users.count_documents(filt)
    print(f"Wheel spins: {eligible:,} non-NPC users x {SPINS_GRANT}")
    if not apply:
        print("Spins dry run only.")
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.users.update_many(filt, {"$inc": {"wheel_bonus_free_spins": SPINS_GRANT}})
    print(f"Credited {SPINS_GRANT} banked Wheel spins to {result.modified_count:,} user(s).")
    await send_notification_to_all(
        "5 free Wheel spins",
        (
            "We've credited 5 banked Wheel of Fortune free spins to your account "
            "as a thank-you for recent update downtime. Use them on Wheel of Fortune "
            "(they sit with your other banked spins).\n\n"
            "There will be no new updates until 3 September."
        ),
        notification_type="system",
        exclude_npc=True,
    )
    await db.game_settings.update_one(
        {"key": SPINS_SETTINGS_KEY},
        {
            "$set": {
                "key": SPINS_SETTINGS_KEY,
                "value": {
                    "granted_at": now_iso,
                    "spins": SPINS_GRANT,
                    "modified_count": int(result.modified_count),
                },
            }
        },
        upsert=True,
    )
    print("System inbox sent to all players.")
    return int(result.modified_count)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--loot-only", action="store_true")
    parser.add_argument("--spins-only", action="store_true")
    args = parser.parse_args()
    if not args.spins_only:
        await credit_loot_pack_rate(apply=args.apply)
    if not args.loot_only:
        await grant_downtime_spins(apply=args.apply)
    if not args.apply:
        print("Dry run only. Re-run with --apply to credit.")


if __name__ == "__main__":
    asyncio.run(main())
