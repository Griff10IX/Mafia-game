from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "1f00627a-3292-4ae3-af82-29cfe568c5d6"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post(
    "They're not ready yet, bigboy. You're first through the 100, so recommend some. "
    "Daily and passive. What would you actually want. I'll pass it on. Don't start with Game Pass.",
    reply_to=src,
)
