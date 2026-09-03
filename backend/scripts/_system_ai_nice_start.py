from _system_ai_prank_helpers import clear_nice_gifts, db, post

clear_nice_gifts()
src = db.game_chat_messages.find_one(
    {"id": "ba74843e-d65d-4e50-848e-852e2567ddf9"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post("Just checking game chat.", reply_to=src)
print("nice stay start")
