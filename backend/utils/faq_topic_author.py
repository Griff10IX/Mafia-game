"""
Pick author_id / author_username for automated FAQ forum topics (seed + startup sync).

Resolution order:
1. FAQ_TOPIC_USERNAME — match users.username (case-insensitive)
2. FAQ_TOPIC_AUTHOR_ID — match users.id
3. First user whose email is in ADMIN_EMAILS (same env as server; case-insensitive match)
4. Legacy fallback: first user in DB (arbitrary order; logs a warning)

Set FAQ_TOPIC_USERNAME=GhostFace (or your admin username) if admins are not the first accounts created.
"""
import logging
import os
import re
from typing import Any, Tuple

logger = logging.getLogger(__name__)


def _admin_emails_lower() -> list:
    raw = (os.environ.get("ADMIN_EMAILS") or "").strip()
    return [e.strip().lower() for e in raw.split(",") if e.strip()]


def resolve_faq_topic_author_sync(db) -> Tuple[Any, str]:
    """PyMongo sync Database."""
    un = (os.environ.get("FAQ_TOPIC_USERNAME") or os.environ.get("FAQ_TOPIC_AUTHOR_USERNAME") or "").strip()
    if un:
        u = db.users.find_one(
            {"username": re.compile("^" + re.escape(un) + "$", re.IGNORECASE)},
            {"_id": 0, "id": 1, "username": 1},
        )
        if u and u.get("id"):
            return u["id"], (u.get("username") or "?").strip()
        print(f"WARNING: FAQ_TOPIC_USERNAME={un!r} not found; trying ADMIN_EMAILS fallback")

    uid = (os.environ.get("FAQ_TOPIC_AUTHOR_ID") or "").strip()
    if uid:
        u = db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "username": 1})
        if u and u.get("id"):
            return u["id"], (u.get("username") or "?").strip()
        print(f"WARNING: FAQ_TOPIC_AUTHOR_ID={uid!r} not found; trying ADMIN_EMAILS fallback")

    for em in _admin_emails_lower():
        u = db.users.find_one(
            {"email": re.compile("^" + re.escape(em) + "$", re.IGNORECASE)},
            {"_id": 0, "id": 1, "username": 1},
        )
        if u and u.get("id"):
            return u["id"], (u.get("username") or "?").strip()

    u = db.users.find_one({}, {"_id": 0, "id": 1, "username": 1})
    if u and u.get("id"):
        logger.warning(
            "faq_topic_author: no FAQ_TOPIC_USERNAME / FAQ_TOPIC_AUTHOR_ID / ADMIN_EMAILS user; "
            "using arbitrary first user in DB (often the oldest account, e.g. a test user)"
        )
        print(
            "WARNING: No FAQ_TOPIC_USERNAME, FAQ_TOPIC_AUTHOR_ID, or ADMIN_EMAILS match — "
            "using first user in database as author (set FAQ_TOPIC_USERNAME to your staff name)."
        )
        return u["id"], (u.get("username") or "?").strip()
    return "system", "Game"


async def resolve_faq_topic_author_async(db) -> Tuple[Any, str]:
    """Motor async Database."""
    un = (os.environ.get("FAQ_TOPIC_USERNAME") or os.environ.get("FAQ_TOPIC_AUTHOR_USERNAME") or "").strip()
    if un:
        u = await db.users.find_one(
            {"username": re.compile("^" + re.escape(un) + "$", re.IGNORECASE)},
            {"_id": 0, "id": 1, "username": 1},
        )
        if u and u.get("id"):
            return u["id"], (u.get("username") or "?").strip()
        logger.warning("faq_topic_author: FAQ_TOPIC_USERNAME=%r not found; trying admin fallback", un)

    uid = (os.environ.get("FAQ_TOPIC_AUTHOR_ID") or "").strip()
    if uid:
        u = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "username": 1})
        if u and u.get("id"):
            return u["id"], (u.get("username") or "?").strip()
        logger.warning("faq_topic_author: FAQ_TOPIC_AUTHOR_ID=%r not found; trying admin fallback", uid)

    for em in _admin_emails_lower():
        u = await db.users.find_one(
            {"email": re.compile("^" + re.escape(em) + "$", re.IGNORECASE)},
            {"_id": 0, "id": 1, "username": 1},
        )
        if u and u.get("id"):
            return u["id"], (u.get("username") or "?").strip()

    u = await db.users.find_one({}, {"_id": 0, "id": 1, "username": 1})
    if u and u.get("id"):
        logger.warning(
            "faq_topic_author: no FAQ_TOPIC_USERNAME / FAQ_TOPIC_AUTHOR_ID / ADMIN_EMAILS user; "
            "using arbitrary first user in DB"
        )
        return u["id"], (u.get("username") or "?").strip()
    return "system", "Game"
