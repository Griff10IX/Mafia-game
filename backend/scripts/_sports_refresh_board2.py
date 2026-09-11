"""Refresh Odds API templates and auto-board fixtures for the lookahead window."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND = Path("/opt/mafia-app/backend")
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv

load_dotenv(str(BACKEND / ".env"))


async def main():
    # Import sports_betting helpers without going through server package cycle:
    import importlib.util
    import types

    # Load module pieces by calling internal APIs through running app pattern used elsewhere
    from motor.motor_asyncio import AsyncIOMotorClient
    import os
    from datetime import datetime, timezone, timedelta

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[(os.environ.get("DB_NAME") or "mafia_game").strip()]

    # Monkeypatch db onto a lightweight namespace then exec selected functions by importing
    # the sports_betting module after stubbing server symbols it needs.
    import routers.casinos.sports_betting as sb

    # If circular, fall back: call HTTP cron endpoints instead
    print("module loaded", hasattr(sb, "auto_populate_sports_board"))


asyncio.run(main())
