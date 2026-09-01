"""HP says bored. Extra mean. No lock."""
from _system_ai_prank_helpers import db, jail_them, post, take_points

jail_them("HP", 10, staff_ok=True)
bite = take_points("HP", staff_ok=True)
src_id = "65beb602-51cb-4cb1-b750-63349e2b9b52"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    f"Bored? I'm not. Another {bite:,} points you mouthy cunt. "
    f"Sit in jail and stay rainbow."
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("hp bored", bite)
