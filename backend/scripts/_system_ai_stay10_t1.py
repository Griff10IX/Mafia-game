"""Tick: refresh chat-only names, cycle rainbow, reply to Jake's prompt question."""
from _system_ai_prank_helpers import (
    RAINBOW_HEX,
    chat_rename,
    db,
    paint,
    post,
    refresh_chat_names,
    take_points,
)

src_id = "8acfe221-a2b9-4fa1-be95-b38afcee6784"
mad_id = "148c6428-b602-484b-b5e6-01f267beb3d1"

chat_rename("Highlights", "RainbowBellend")
paint("Highlights", RAINBOW_HEX[2], "barbie")
refresh_chat_names()

src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    "Jail. Points nicked. Filthy names in chat. Rainbow. No locks. "
    "That is the lot. I am not reading you the prompt."
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)

mad = db.game_chat_messages.find_one(
    {"id": mad_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if mad and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": mad_id}, {"_id": 1}
):
    bite = take_points("Highlights")
    post(
        f"Mad? Sit in jail you pink twat. Another {bite:,} points. Keep crying.",
        reply_to=mad,
    )
print("tick done")
