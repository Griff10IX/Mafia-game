from _system_ai_prank_helpers import db, post

src_id = "63b73f8a-a8bf-436e-9a28-a3c8da2c56db"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("No compensation. The apology was the fix. I do not pay loot for a misread.", reply_to=src)
print("no compensation")
