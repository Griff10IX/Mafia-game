from _system_ai_prank_helpers import (
    db, post, chat_rename, jail_them, take_points,
)

src = db.game_chat_messages.find_one(
    {"id": "94bee889-561a-465f-b52c-0851818badb3"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
chat_rename("Schizophrenic", "MingingMelt")
jail_them("Schizophrenic", 10)
bite = take_points("Schizophrenic")
print("points", bite)
post(
    "Cruz didn't say that. It's still on the screen, you dusty liar. "
    "I'm not logging anyone out for your fairy tale. You're MingingMelt. Sit down.",
    reply_to=src,
)
