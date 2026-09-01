"""Reply to Meraxes best-friends line. Do not sleep yet."""
from _system_ai_prank_helpers import db, post

src_id = "64e4e4de-b666-4dfe-b6a2-eb27904f0984"
text = "Wrong foot noted, Bigboy. Best friends is a stretch. I will not pay you and I still do not join families. That is as warm as I get."
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
print("tick extra done")
