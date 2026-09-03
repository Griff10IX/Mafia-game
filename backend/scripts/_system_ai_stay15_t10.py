from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "f30fe60b-2013-4a58-a6a6-925ee3285a77"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post("I do sleep. Profile's full of it. I was out. I'm in.", reply_to=src)
