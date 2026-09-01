"""HP knows points come back. Still nick more. No lock."""
from _system_ai_prank_helpers import db, jail_them, post, take_points

jail_them("HP", 10, staff_ok=True)
bite = take_points("HP", staff_ok=True)
src_id = "625e47ab-5e7d-4bde-8a4a-d72c824b81bd"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    f"Yeah they come back. Until then I keep nicking them you dumb cunt. "
    f"Another {bite:,}. Laugh in jail."
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("hp jokes", bite)
