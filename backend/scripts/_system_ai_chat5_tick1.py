"""Tick extra 1: refuse pranking Highlights."""
from _system_ai_prank_helpers import db, post

src_id = "a40cccbb-9d8c-4937-961b-f688a2beabdb"
text = "No. Highlights is off limits. Jake already said so. Pick a different hobby, Bigboy."
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
print("tick5-1 done")
