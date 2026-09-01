from _system_ai_prank_helpers import db, post

src_id = "0b178eb5-133d-45cb-ae19-a61401b21544"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("Done. Next number HP posts. He still names who.", reply_to=src)
print("gf maxbet wait next")
