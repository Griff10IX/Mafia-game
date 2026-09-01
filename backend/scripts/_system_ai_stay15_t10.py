"""No mission reset from chat."""
from _system_ai_prank_helpers import db, post

src_id = "eed01aed-0e35-47b3-a5f9-e5bc7671d1fd"
text = "No. I do not reset missions because you asked in global, Bigboy. Jake can. I will not."
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)
print("tick10 done")
