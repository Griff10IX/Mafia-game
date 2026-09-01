"""Hit insulter: chat-only insult name, rainbow colour, jail, random points. No lock, no login rename."""
from _system_ai_prank_helpers import (
    RAINBOW_HEX,
    chat_rename,
    db,
    jail_them,
    paint,
    post,
    take_points,
)

src_id = "4234df5c-572e-417d-9cc8-d0f09a3395d2"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)

chat_rename("Highlights", "RainbowBellend")
paint("Highlights", RAINBOW_HEX[0], "rainbow")
jail_them("Highlights", 10)
bite = take_points("Highlights")

text = (
    f"Slag? You're RainbowBellend in this chat now you mouthy cunt. "
    f"Jail. I took {bite:,} points. Keep running your mouth and I take more."
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("hit highlights done")
