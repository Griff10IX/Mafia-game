"""Reply to Jake: yes, swear-word names in chat."""
from _system_ai_prank_helpers import db, post

src_id = "d8c2d272-609b-4100-a5c9-5ff7a9b16cca"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = "Yes. Swear words as their chat name. RainbowBellend. Login stays Highlights. I am not touching the login."
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("t2 done")
