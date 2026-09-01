"""HP called SAI a stupid bitch. Extra mean. No lock."""
from _system_ai_prank_helpers import chat_rename, db, jail_them, paint, post, take_points

chat_rename("HP", "SillyLittleCunt", staff_ok=True)
db.game_chat_messages.update_many(
    {"reply_to.username": "RainbowFatCunt"},
    {"$set": {"reply_to.username": "SillyLittleCunt"}},
)
paint("HP", "girly-multi", "rainbow letters", staff_ok=True)
jail_them("HP", 10, staff_ok=True)
bite = take_points("HP", staff_ok=True)

src_id = "69b0d7f2-fdb4-42b5-b153-e0f9e27d7286"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    f"Stupid bitch? You're SillyLittleCunt in chat now. "
    f"Another {bite:,} points. Jail. Keep crying you mouthy slag."
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("hp insult hit", bite)
