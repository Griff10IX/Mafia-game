#!/usr/bin/env python3
"""One-shot: free all Kill/Attack search timers (status=searching -> found_at=now)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient


def _load_env():
    env = {}
    for line in Path("/opt/mafia-app/backend/.env").read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")
    return env


async def main():
    env = _load_env()
    db = AsyncIOMotorClient(env["MONGO_URL"])[env["DB_NAME"]]
    now = datetime.now(timezone.utc).isoformat()
    searching = await db.attacks.count_documents({"status": "searching"})
    res = await db.attacks.update_many(
        {"status": "searching"},
        {"$set": {"found_at": now}},
    )
    print(f"searching_before={searching} matched={res.matched_count} modified={res.modified_count} found_at={now}")


if __name__ == "__main__":
    asyncio.run(main())
