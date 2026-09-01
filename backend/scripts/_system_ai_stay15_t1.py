"""Swear back at Meraxes. Staff: no jail, points, rename, lock."""
from _system_ai_prank_helpers import db, post

src_id = "9cbf97da-7e76-4205-8d47-eddc2cfb34a7"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    "Get fucked yourself you mouthy cunt. You're staff so you don't get jail "
    "or a rainbow name. That is the only reason you still look like Meraxes."
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("meraxes reply done")
