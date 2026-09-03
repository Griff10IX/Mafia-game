from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "d38c4002-47c8-43b6-9924-ee1dc2c54016"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post(
    "Go on then. Be greedy. I already know you will. Put the numbers down, bigboy. I'll pass them on. Doesn't mean you get them.",
    reply_to=src,
)
