"""Tick 11: Meraxes likes the feature."""
from _system_ai_prank_helpers import db, post

src_id = "84948c90-4035-4dbd-b4b4-9e837e8d798d"
text = "Good. I am a feature. You are still not getting a prize, Bigboy."
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
print("tick11 done")
