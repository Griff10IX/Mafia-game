"""Read-only: Devious says 100 scrapped cars didn't count toward his mission."""
import asyncio
import os
import re
import sys

sys.path.insert(0, "/opt/mafia-app/backend")
os.chdir("/opt/mafia-app/backend")

import server  # noqa: F401
from server import db
from routers.account import missions as m


async def main():
    u = await db.users.find_one({"username": {"$regex": "^devious$", "$options": "i"}}, {"_id": 0})
    if not u:
        print("not found")
        return
    print("user", u["username"], u["id"], "completions", len(u.get("mission_completions") or []))
    for k in ("cars_melted", "uncommon_cars_scrapped", "cars_scrapped"):
        print(" ", k, u.get(k))
    cur = m._current_open_mission(u)
    print("current", cur and {k: cur.get(k) for k in ("id", "title", "requirements")})
    if cur:
        met, prog = m._check_mission_requirements(u, cur)
        print("met", met, "progress", prog)
        print("baselines", (u.get("mission_baselines") or {}).get(cur["id"]))
    last = (u.get("mission_completions") or [])[-1:]
    print("last completion", last)
    async for a in db.activity_log.find(
        {"user_id": u["id"], "action": {"$regex": "melt|scrap", "$options": "i"}},
        {"_id": 0, "action": 1, "created_at": 1, "details.scrapped_count": 1, "details.melted_count": 1},
    ).sort("created_at", -1).limit(6):
        print("activity", a)


asyncio.run(main())
