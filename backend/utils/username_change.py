"""Propagate an admin username change across denormalized Mongo fields."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# (collection, user_id_field, username_field)
_BY_USER_ID: List[Tuple[str, str, str]] = [
    ("dice_ownership", "owner_id", "owner_username"),
    ("slots_ownership", "owner_id", "owner_username"),
    ("bullet_factory", "owner_id", "owner_username"),
    ("airport_ownership", "owner_id", "owner_username"),
    ("garage_dealership", "owner_id", "owner_username"),
    ("sports_betting_ownership", "owner_id", "owner_username"),
    ("attacks", "attacker_id", "attacker_username"),
    ("attacks", "target_id", "target_username"),
    ("hitlist", "target_id", "target_username"),
    ("hitlist", "placer_id", "placer_username"),
    ("forum_topics", "author_id", "author_username"),
    ("forum_comments", "author_id", "author_username"),
    ("bodyguard_invites", "inviter_id", "inviter_username"),
    ("bodyguard_invites", "invitee_id", "invitee_username"),
]


async def propagate_username_change(
    db: Any,
    *,
    user_id: str,
    old_username: str,
    new_username: str,
) -> Dict[str, int]:
    """Update users.username and common denormalized username fields. Returns modified counts."""
    counts: Dict[str, int] = {}
    uid = (user_id or "").strip()
    new_u = (new_username or "").strip()
    old_u = (old_username or "").strip()
    if not uid or not new_u:
        return counts

    res = await db.users.update_one({"id": uid}, {"$set": {"username": new_u}})
    counts["users"] = res.modified_count

    res = await db.users.update_many(
        {"killed_by_user_id": uid},
        {"$set": {"killed_by_username": new_u}},
    )
    counts["users_killed_by_username"] = res.modified_count

    for coll_name, id_field, username_field in _BY_USER_ID:
        coll = getattr(db, coll_name, None)
        if coll is None:
            continue
        res = await coll.update_many({id_field: uid}, {"$set": {username_field: new_u}})
        key = f"{coll_name}.{username_field}"
        counts[key] = res.modified_count

    if old_u:
        old_pat = re.compile("^" + re.escape(old_u) + "$", re.IGNORECASE)
        fav_modified = 0
        async for row in db.users.find(
            {"kill_favorite_targets": old_pat},
            {"_id": 0, "id": 1, "kill_favorite_targets": 1},
        ):
            raw = row.get("kill_favorite_targets")
            if not isinstance(raw, list):
                continue
            updated = [new_u if old_pat.match(str(x or "").strip()) else x for x in raw]
            if updated != raw:
                await db.users.update_one({"id": row["id"]}, {"$set": {"kill_favorite_targets": updated}})
                fav_modified += 1
        if fav_modified:
            counts["users.kill_favorite_targets"] = fav_modified

        main = await db.game_settings.find_one({"_id": "main"}, {"_id": 0, "attack_turnstile_target_usernames": 1})
        targets = main.get("attack_turnstile_target_usernames") if main else None
        if isinstance(targets, list):
            replaced = [new_u if old_pat.match(str(t or "").strip()) else t for t in targets]
            if replaced != targets:
                await db.game_settings.update_one(
                    {"_id": "main"},
                    {"$set": {"attack_turnstile_target_usernames": replaced}},
                )
                counts["game_settings.attack_turnstile_target_usernames"] = 1

    return counts
