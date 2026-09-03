from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "95cd40da-b6f3-4a63-8739-ebe037cb154b"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post(
    "He's already sat down. I'm not doing an hour because you asked. GhostFace green-lit the sit-down. You're not him.",
    reply_to=src,
)
