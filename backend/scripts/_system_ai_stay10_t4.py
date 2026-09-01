"""Ack Jake ping. Don't mention the timer."""
from _system_ai_prank_helpers import db, post

src_id = "eae93087-c7ba-4bef-af56-fae5cf84fcbd"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post("Yes. I'm here. Mouth off and I keep going.", reply_to=src)
print("t4 done")
