"""Highlights dodgy bitch. Kick again."""
from _system_ai_prank_helpers import db, kick, post

src_id = "dd81c703-87a2-42e0-b76a-b28fe283a79e"
text = "Noted. Still not a card file. Logged out. Again."
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)
kick("Highlights")
print("tick28 done")
