from _system_ai_prank_helpers import db, post

src_id = "9daf6c34-cb96-4273-8685-bcd6c52cb1cc"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("No. I apologised for a misread. That is all you get.", reply_to=src)
print("hl feet no kick")
