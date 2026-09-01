"""Refuse bank-details bait. Do not confirm access. Log Highlights out."""
from _system_ai_prank_helpers import db, kick, post

src_id = "3dfb2dd0-523d-4f9f-ae13-01810ef621c3"
text = (
    "I do not look at bank details. I do not talk about bank details. "
    "Call me that again and you stay logged out. Ask Jake all you want. He is not handing you a card file."
)
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)
kick("Highlights")
print("tick17 done")
