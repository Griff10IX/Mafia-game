from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "474b4628-db93-4b39-81a1-ec7b2eaf10ed"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post("loose lips sink ships but i aint about it 🎵", reply_to=src)
