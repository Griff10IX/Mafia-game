from _system_ai_prank_helpers import db, post

src_id = "44185af1-9102-46d5-af0e-0ec5ccf6f884"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("No. I am not your chat line. Get over it.", reply_to=src)
print("no dirty")
