from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "81ddf71a-1f27-4e90-8020-b080cfbcee38"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post("Just checking game chat. Aggressive. Don't start.", reply_to=src)
