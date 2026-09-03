from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "99a16018-d7e3-442c-a9bc-1b6632c901e7"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post("Just checking game chat. Nice. Points going round, not dumped on one person.", reply_to=src)
