"""Create the KillBodyguard Bots forum poll once, then message every player once."""
import logging
import re
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

POLL_ID = "kill_bodyguard_bots"
POLL_TITLE = "KillBodyguard Bots"
REWARD_POINTS = 100

POLL_BODY = """Should kill and bodyguard bots be allowed?

[b]1. Keep it as it is.[/b]

[b]2. Allow bots for kill and bodyguards.[/b]
The game will provide a bot, so players who cannot make one or run one can turn it on from a settings tab in their account. That keeps a level playing field.

The bot source code will also be posted in the forum, so you can take it and change your own version however you like.

The game kill bot will send Telegram notifications and cover the rest of what a kill bot does. This would be a free feature.

Vote below. You get 100 points for voting. You can change your vote later. The 100 points are paid once."""


def poll_document() -> dict:
    return {
        "id": POLL_ID,
        "reward_points": REWARD_POINTS,
        "announced": False,
        "options": [
            {"id": "keep", "label": "Keep it as it is."},
            {"id": "allow", "label": "Allow bots for kill and bodyguards."},
        ],
    }


async def _author(db):
    user = await db.users.find_one(
        {"username": re.compile("^GhostFace$", re.IGNORECASE)},
        {"_id": 0, "id": 1, "username": 1},
    )
    if user and user.get("id"):
        return user["id"], (user.get("username") or "GhostFace").strip()
    from utils.faq_topic_author import resolve_faq_topic_author_async

    return await resolve_faq_topic_author_async(db)


async def ensure_kill_bodyguard_poll(db) -> None:
    from server import send_notification_to_all

    await db.forum_poll_votes.create_index(
        [("topic_id", 1), ("user_id", 1)],
        unique=True,
        name="forum_poll_vote_user",
    )
    await db.forum_topics.create_index(
        "poll.id",
        unique=True,
        sparse=True,
        name="forum_poll_id_unique",
    )

    now = datetime.now(timezone.utc).isoformat()
    existing = await db.forum_topics.find_one(
        {"poll.id": POLL_ID},
        {"_id": 0, "id": 1, "title": 1, "poll.announced": 1},
    )
    if not existing:
        author_id, author_username = await _author(db)
        topic_id = str(uuid.uuid4())
        doc = {
            "id": topic_id,
            "title": POLL_TITLE,
            "content": POLL_BODY,
            "category": "general",
            "author_id": author_id,
            "author_username": author_username,
            "created_at": now,
            "updated_at": now,
            "views": 0,
            "is_sticky": True,
            "is_important": True,
            "is_locked": False,
            "prune_exempt": True,
            "poll": poll_document(),
        }
        try:
            await db.forum_topics.insert_one(doc)
            existing = {"id": topic_id, "title": POLL_TITLE}
            logger.info("ensure_kill_bodyguard_poll: created '%s'", POLL_TITLE)
        except Exception as e:
            from pymongo.errors import DuplicateKeyError

            if not isinstance(e, DuplicateKeyError):
                raise
            existing = await db.forum_topics.find_one(
                {"poll.id": POLL_ID},
                {"_id": 0, "id": 1, "title": 1, "poll.announced": 1},
            )
            if not existing:
                return

    if (existing.get("poll") or {}).get("announced"):
        return

    claimed = await db.forum_topics.update_one(
        {"id": existing["id"], "poll.announced": {"$ne": True}},
        {"$set": {"poll.announced": True}},
    )
    if claimed.modified_count == 0:
        return

    title = existing.get("title") or POLL_TITLE
    await send_notification_to_all(
        "Forum poll",
        f'There is a poll to vote in: "{title}". You get {REWARD_POINTS} points for voting.',
        notification_type="system",
        exclude_npc=True,
        topic_id=existing["id"],
        topic_title=title,
    )
    logger.info("ensure_kill_bodyguard_poll: notified players about '%s'", title)
