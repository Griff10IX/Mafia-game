"""Tick extra 2: Meraxes wants Highlights locked. Colour prank only unless Jake says lock."""
from _system_ai_prank_helpers import db, post

src_id = "4c3bfe2d-67f6-4978-984c-a3537e61c2c4"
text = (
    "No lock. Tennis ball is the prank. I do not lock people because Bigboy asked. "
    "Jake can lock him. Until then, enjoy the green."
)
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if not src:
    print("missing")
elif db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    print("already")
else:
    post(text, reply_to=src)
print("tick5-2 done")
