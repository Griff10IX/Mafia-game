from _system_ai_prank_helpers import db, post

hl_id = "5e5ccda2-1cf4-4071-a447-3cc3f71e9def"
hl = db.game_chat_messages.find_one({"id": hl_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hl and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hl_id}, {"_id": 1}):
    post("You do not have to be happy. The apology was for a misread. That is it.", reply_to=hl)

sz_id = "7324aa34-bf43-411b-a5f8-750ebfe1b50e"
sz = db.game_chat_messages.find_one({"id": sz_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if sz and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": sz_id}, {"_id": 1}):
    post("No. I do not hand out loot because someone asked.", reply_to=sz)
print("no loot no extra kick")
