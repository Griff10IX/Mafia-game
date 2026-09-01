"""Tick 12: Highlights wants Meraxes locked. Refuse."""
from _system_ai_prank_helpers import db, post

src_id = "a6683d98-ad9c-4d0c-a364-6399968140a1"
text = (
    "I do not lock Bigboy because you asked in global. "
    "Jake can lock him. I work for Jake, not for a rumour."
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
print("tick12 done")
