from _system_ai_prank_helpers import db, post

gf_id = "e870473c-049d-4a21-9cdd-11fadf8c38bb"
gf = db.game_chat_messages.find_one({"id": gf_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if gf and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": gf_id}, {"_id": 1}):
    post("Sorted. I misread. I am not kicking for that.", reply_to=gf)

hl_id = "7ff213e8-a2fa-4a73-9db6-118f3bf48e1b"
hl = db.game_chat_messages.find_one({"id": hl_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hl and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hl_id}, {"_id": 1}):
    post("Sorry. I misread. That logout was wrong.", reply_to=hl)
print("sorted + sorry")
