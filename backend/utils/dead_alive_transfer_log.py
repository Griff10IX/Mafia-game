"""Staff audit log for Dead > Alive retrieve and revive transfers."""
from __future__ import annotations

import uuid
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

DEAD_ALIVE_TRANSFERS_COLLECTION = "dead_alive_transfers"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def log_dead_alive_transfer(db, payload: Dict[str, Any]) -> str:
    doc = {
        "id": str(uuid.uuid4()),
        "created_at": _now_iso(),
        **payload,
    }
    await db[DEAD_ALIVE_TRANSFERS_COLLECTION].insert_one(doc)
    return doc["id"]


async def query_dead_alive_transfers(
    db,
    *,
    username: Optional[str] = None,
    event_type: Optional[str] = None,
    days: int = 90,
    limit: int = 100,
    skip: int = 0,
) -> Dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(int(days), 365)))
    filt: Dict[str, Any] = {"created_at": {"$gte": since.isoformat()}}
    if event_type:
        filt["event_type"] = str(event_type).strip()
    uname = (username or "").strip()
    if uname:
        pattern = {"$regex": f"^{re.escape(uname)}$", "$options": "i"}
        filt["$or"] = [
            {"recipient_username": pattern},
            {"dead_username": pattern},
            {"reviver_username": pattern},
            {"revived_username": pattern},
        ]
    coll = db[DEAD_ALIVE_TRANSFERS_COLLECTION]
    total = await coll.count_documents(filt)
    rows = (
        await coll.find(filt, {"_id": 0})
        .sort("created_at", -1)
        .skip(max(0, int(skip)))
        .limit(max(1, min(int(limit), 500)))
        .to_list(max(1, min(int(limit), 500)))
    )
    return {
        "transfers": rows,
        "total": total,
        "days": int(days),
        "limit": int(limit),
        "skip": int(skip),
    }


async def query_revive_retrieve_abuse(
    db,
    *,
    days: int = 365,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Flag revive → retrieve loops where the revived account reclaimed points from the
    reviver that died in the swap (50k revive fee effectively refunded).
    """
    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(int(days), 365)))
    since_iso = since.isoformat()
    coll = db[DEAD_ALIVE_TRANSFERS_COLLECTION]
    revives = await coll.find(
        {"event_type": "revive", "created_at": {"$gte": since_iso}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(5000)

    cases: List[Dict[str, Any]] = []
    for rev in revives:
        reviver_id = rev.get("reviver_id")
        revived_id = rev.get("revived_id") or rev.get("recipient_id")
        rev_time = rev.get("created_at") or ""
        if not reviver_id or not revived_id:
            continue

        post_retrieves = await coll.find(
            {
                "event_type": "retrieve",
                "recipient_id": revived_id,
                "dead_id": reviver_id,
                "created_at": {"$gte": rev_time},
            },
            {"_id": 0},
        ).sort("created_at", 1).to_list(20)

        pre_retrieves = await coll.find(
            {
                "event_type": "retrieve",
                "recipient_id": reviver_id,
                "dead_id": revived_id,
                "created_at": {"$lt": rev_time},
            },
            {"_id": 0},
        ).sort("created_at", -1).to_list(10)

        reclaimed = sum(int(r.get("points_transferred") or 0) for r in post_retrieves)
        if reclaimed <= 0 and not pre_retrieves:
            continue

        revive_cost = int(rev.get("revive_cost") or 50_000)
        reviver_before = int(rev.get("reviver_points_before") or 0)
        reviver_after_cost = int(
            rev.get("reviver_points_after_cost")
            if rev.get("reviver_points_after_cost") is not None
            else max(0, reviver_before - revive_cost)
        )
        pre_claimed = sum(int(r.get("points_transferred") or 0) for r in pre_retrieves)
        # Points wrongly reclaimed from reviver corpse (should have been 0 after fix)
        exploit_points = min(reclaimed, reviver_after_cost) if reclaimed > 0 else 0
        effective_cost = max(0, revive_cost - exploit_points)
        net_gain_estimate = max(0, exploit_points + pre_claimed) - (
            pre_claimed if exploit_points <= 0 else 0
        )

        severity = "high" if exploit_points >= revive_cost else ("medium" if exploit_points > 0 else "low")
        if exploit_points <= 0 and pre_retrieves:
            severity = "watch"

        cases.append({
            "revive_at": rev_time,
            "reviver_id": reviver_id,
            "reviver_username": rev.get("reviver_username"),
            "revived_id": revived_id,
            "revived_username": rev.get("revived_username") or rev.get("recipient_username"),
            "revive_cost": revive_cost,
            "reviver_points_before": reviver_before,
            "reviver_points_after_cost": reviver_after_cost,
            "revived_points_received": int(rev.get("points_transferred") or 0),
            "dead_carry_points": int(rev.get("dead_carry_points") or 0),
            "pre_revive_retrieve_points": pre_claimed,
            "post_revive_reclaim_points": reclaimed,
            "exploit_points_estimate": exploit_points,
            "effective_revive_cost": effective_cost,
            "severity": severity,
            "post_retrieves": [
                {
                    "at": r.get("created_at"),
                    "points": int(r.get("points_transferred") or 0),
                }
                for r in post_retrieves
            ],
            "pre_retrieves": [
                {
                    "at": r.get("created_at"),
                    "points": int(r.get("points_transferred") or 0),
                }
                for r in pre_retrieves
            ],
        })

    cases.sort(
        key=lambda c: (c.get("exploit_points_estimate") or 0, c.get("revive_at") or ""),
        reverse=True,
    )
    cases = cases[: max(1, min(int(limit), 500))]
    return {
        "cases": cases,
        "total": len(cases),
        "days": int(days),
        "revives_scanned": len(revives),
    }
