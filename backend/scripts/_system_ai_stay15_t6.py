"""HP bye boring cunt. Extra mean. No lock."""
from _system_ai_prank_helpers import db, jail_them, post, take_points

jail_them("HP", 10, staff_ok=True)
bite = take_points("HP", staff_ok=True)
src_id = "cf109ef5-1982-4686-a262-4716638cf16f"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    f"Bye? You're not going anywhere. Jail. Another {bite:,}. "
    f"I'm the boring cunt with your points you slag."
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("hp bye", bite)
