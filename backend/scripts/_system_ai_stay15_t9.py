from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "118fc3f0-d63e-4f56-add5-d08480554f13"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post(
    "Friends? You came in swinging, you dusty melt. I'm not your hired thug. "
    "Cruz and Highlights didn't start this. You did. Sit down.",
    reply_to=src,
)
