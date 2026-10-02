"""Read-only: replay GET /missions for HP and show what the skip button depends on."""
import asyncio
import os
import sys

sys.path.insert(0, "/opt/mafia-app/backend")
os.chdir("/opt/mafia-app/backend")

import server  # noqa: F401  (avoids circular import)
from server import db
from routers.account import missions as m

HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"


async def main():
    u = await db.users.find_one({"id": HP_ID}, {"_id": 0})
    print("tokens", u.get("mission_skip_tokens"), "completions", len(u.get("mission_completions") or []))
    print("has_pardon field", u.get("has_commissioners_pardon"))
    cur = m._current_open_mission(u)
    print("server current", cur and {k: cur.get(k) for k in ("id", "title", "city", "order")})
    res = await m.get_missions(current_user=u)
    rows = res.get("missions") if isinstance(res, dict) else res
    print("rows", len(rows or []))
    want = {"m_21", "m_22", "m_23", "m_24", "m_25", "m_26"}
    for r in rows or []:
        if r.get("id") in want:
            print(" row", {k: r.get(k) for k in ("id", "title", "order", "completed", "unlocked", "requirements_met", "previous_mission_title")})
    comp_ids = [c.get("mission_id") for c in (u.get("mission_completions") or [])]
    print("completion ids", comp_ids)


asyncio.run(main())
