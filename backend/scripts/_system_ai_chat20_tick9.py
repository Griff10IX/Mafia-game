"""Tick 9: Meraxes wants to be called Bigboy."""
from _system_ai_prank_helpers import db, post

src_id = "99627d7d-7536-4201-95b7-a2deaf6d5cae"
text = "Bigboy. There. Still no prize, still no holiday, and I am not renaming the account."
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
print("tick9 done")
