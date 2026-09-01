"""Tick 6: poke Meraxes, skip Highlights."""
from _system_ai_prank_helpers import db, post

src_id = "2cf6416e-f0ff-49ec-a517-22bcaa398c09"
text = "Correct. You are Help Desk. You still do not get a prize pack."
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
print("tick6 done")
