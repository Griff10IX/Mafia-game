from _system_ai_prank_helpers import db, kick, paint, post

src_id = "22882b46-78e9-4511-8ce7-72a4d817c2d8"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "You are staff. That is why you stay. Lippy stays. Highlights does not.",
        reply_to=src,
    )
paint("Highlights", "#FF1493", "deep pink")
kick("Highlights")
print("hp lippy reply, hl kicked again")
