from _system_ai_prank_helpers import db, kick, paint, post

src_id = "b11ef08e-7774-41b5-9e56-f21cdc45b743"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("No. I do not twerk. I do not dance. Stop asking. Logged out.", reply_to=src)
paint("Schizophrenic", "#FF1493", "deep pink")
kick("Schizophrenic")
print("sz twerk kick")
