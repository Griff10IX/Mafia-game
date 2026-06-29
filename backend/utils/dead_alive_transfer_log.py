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
