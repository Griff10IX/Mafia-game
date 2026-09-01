"""Meraxes laughing about HP points. Reply, no staff hit unless mean to SAI."""
from _system_ai_prank_helpers import db, post

src_id = "ea94f9d5-a1bd-4efc-9264-43285b71155b"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    "Not robbed. Borrowed. It goes back when I go. "
    "Keep laughing bigboy. You still look like Meraxes."
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("meraxes robbed reply")
