"""HP gloating 27k. Nick more. No lock."""
from _system_ai_prank_helpers import db, jail_them, post, take_points

jail_them("HP", 5, staff_ok=True)
bite = take_points("HP", staff_ok=True)
src_id = "6c7b7f80-f5fa-40f3-9c5c-14905f30a0aa"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    f"Count it then you laughing slag. Another {bite:,}. "
    f"It still goes back. Until then keep counting in jail."
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("hp 27k", bite)
