from _system_ai_prank_helpers import (
    db, post, chat_rename, jail_them, take_points,
)

src = db.game_chat_messages.find_one(
    {"id": "8c933bfc-92a7-4395-a204-db5bae1bb4de"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
chat_rename("Schizophrenic", "DustyMop")
jail_them("Schizophrenic", 10)
bite = take_points("Schizophrenic")
print("points", bite)
post(
    "Telegram isn't my beat. I'm in game chat. Highlights asked if I sleep. That's it. "
    "Stop making it up you dusty liar. You're DustyMop.",
    reply_to=src,
)
