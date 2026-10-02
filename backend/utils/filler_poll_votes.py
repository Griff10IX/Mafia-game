"""Trickle forum-poll votes from roster-created accounts only.

The presence simulator only fakes who looks online. It does not create users.
Accounts created by the daily roster are listed in the server ledger. This loop
votes those accounts on the KillBodyguard poll, about 25% to keep it as it is
and the rest to allow kill bots,
with gaps of several minutes so the totals do not jump in one go.

No points are paid. A restart cannot dump the remaining votes at once.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)

POLL_ID = "kill_bodyguard_bots"
ALLOW_OPTION = "allow"
KEEP_OPTION = "keep"
KEEP_SHARE = 0.25
STATE_ID = "kill_bodyguard_bots"
LEDGER_PATH = Path(
    os.environ.get("AMBIENT_ROSTER_LEDGER")
    or "/opt/mafia-app/backups/.ops_roster.jsonl"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _gap_seconds() -> int:
    """Most votes a few minutes apart, with an occasional longer quiet stretch."""
    if random.random() < 0.2:
        return random.randint(20 * 60, 48 * 60)
    return random.randint(4 * 60, 16 * 60)


def load_roster_user_ids(path: Path = LEDGER_PATH) -> list:
    """User ids from the roster ledger. Never returns emails or passwords."""
    if not path.is_file():
        return []
    ids = []
    seen = set()
    try:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(row, dict):
                    continue
                uid = str(row.get("id") or "").strip()
                if uid and uid not in seen:
                    seen.add(uid)
                    ids.append(uid)
    except OSError:
        logger.exception("filler poll votes: ledger unreadable")
        return []
    return ids


def _option_for_next(allow_n: int, keep_n: int) -> str:
    """Next choice that keeps about 25% of roster votes on keep, the rest on allow."""
    target_keep = int(round((allow_n + keep_n + 1) * KEEP_SHARE))
    if keep_n < target_keep:
        return KEEP_OPTION
    return ALLOW_OPTION


async def _ensure_state(db) -> None:
    first = _iso(_now() + timedelta(seconds=random.randint(5 * 60, 12 * 60)))
    await db.filler_poll_schedule.find_one_and_update(
        {"_id": STATE_ID},
        {"$setOnInsert": {"next_at": first}},
        upsert=True,
    )


async def filler_poll_vote_tick(db) -> None:
    filler_ids = load_roster_user_ids()
    if not filler_ids:
        return
    topic = await db.forum_topics.find_one(
        {"poll.id": POLL_ID},
        {"_id": 0, "id": 1},
    )
    if not topic or not topic.get("id"):
        return
    topic_id = topic["id"]

    live = await db.users.find(
        {
            "id": {"$in": filler_ids},
            "is_dead": {"$ne": True},
            "is_npc": {"$ne": True},
        },
        {"_id": 0, "id": 1},
    ).to_list(len(filler_ids))
    live_ids = {str(row.get("id") or "") for row in live if row.get("id")}
    if not live_ids:
        return

    voted = {}
    async for row in db.forum_poll_votes.find(
        {"topic_id": topic_id, "user_id": {"$in": list(live_ids)}},
        {"_id": 0, "user_id": 1, "option_id": 1},
    ):
        uid = str(row.get("user_id") or "")
        if uid:
            voted[uid] = str(row.get("option_id") or "")
    remaining = [uid for uid in filler_ids if uid in live_ids and uid not in voted]
    if not remaining:
        return

    allow_n = sum(1 for opt in voted.values() if opt == ALLOW_OPTION)
    keep_n = sum(1 for opt in voted.values() if opt == KEEP_OPTION)
    now = _now()
    await _ensure_state(db)
    claimed = await db.filler_poll_schedule.find_one_and_update(
        {"_id": STATE_ID, "next_at": {"$lte": _iso(now)}},
        {"$set": {"next_at": _iso(now + timedelta(seconds=_gap_seconds()))}},
    )
    if not claimed:
        return

    uid = random.choice(remaining)
    option = _option_for_next(allow_n, keep_n)
    stamp = _iso(now)
    try:
        await db.forum_poll_votes.insert_one(
            {
                "topic_id": topic_id,
                "user_id": uid,
                "option_id": option,
                "rewarded": True,
                "created_at": stamp,
                "updated_at": stamp,
            }
        )
    except DuplicateKeyError:
        return
    logger.info(
        "filler poll vote option=%s roster_voted=%s roster_left=%s",
        option,
        len(voted) + 1,
        len(remaining) - 1,
    )


async def run_filler_poll_vote_loop() -> None:
    import server as srv

    db = srv.db
    await asyncio.sleep(60)
    while True:
        try:
            await filler_poll_vote_tick(db)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("filler poll vote loop")
        await asyncio.sleep(30)
