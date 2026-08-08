"""Shared parsing and user resolution for @username mentions."""
import re
from typing import Iterable, List


MENTION_PATTERN = re.compile(r"@([A-Za-z0-9_]+)")


def extract_mention_usernames(text: str) -> List[str]:
    """Return mentions once, preserving first spelling and matching case-insensitively."""
    seen = set()
    usernames = []
    for match in MENTION_PATTERN.finditer(text or ""):
        username = (match.group(1) or "").strip()
        key = username.lower()
        if username and key not in seen:
            seen.add(key)
            usernames.append(username)
    return usernames


async def resolve_usernames_to_users(
    db,
    usernames: Iterable[str],
    *,
    projection: dict | None = None,
) -> dict:
    """Map lowercased requested usernames to user documents, with a rare case fallback."""
    unique = []
    seen = set()
    for raw in usernames or []:
        username = str(raw or "").strip()
        key = username.lower()
        if username and key not in seen:
            seen.add(key)
            unique.append(username)
    if not unique:
        return {}

    fields = dict(projection or {})
    fields["_id"] = 0
    fields["id"] = 1
    fields["username"] = 1
    by_lower = {}
    rows = await db.users.find(
        {"username": {"$in": unique}},
        fields,
    ).to_list(len(unique) + 1)
    for row in rows or []:
        username = (row.get("username") or "").strip()
        if username and row.get("id"):
            by_lower[username.lower()] = row

    missing = [username for username in unique if username.lower() not in by_lower]
    if missing:
        rows = await db.users.find(
            {
                "$or": [
                    {"username": re.compile("^" + re.escape(username) + "$", re.IGNORECASE)}
                    for username in missing
                ]
            },
            fields,
        ).to_list(len(missing) + 1)
        for row in rows or []:
            username = (row.get("username") or "").strip()
            if username and row.get("id"):
                by_lower[username.lower()] = row
    return by_lower


async def resolve_usernames_to_ids(db, usernames: Iterable[str]) -> dict:
    """Map lowercased requested usernames to user ids."""
    users = await resolve_usernames_to_users(db, usernames)
    return {key: row["id"] for key, row in users.items()}
