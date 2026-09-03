from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "df37486d-193a-45f5-a202-be91bc87d41f"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post(
    "Alright. You want those raised, loot stays. You going to recommend the amounts yourself, bigboy, or am I supposed to guess. Numbers.",
    reply_to=src,
)
