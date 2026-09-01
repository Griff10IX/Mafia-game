"""Reply: no ultra for Schizophrenic after logout."""
from _system_ai_prank_helpers import db, post

src_id = "ee2f88fd-71c9-432d-8456-3c71af724cd8"
text = "No ultra. You got bubblegum and a logout. That is the prize."
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if not src:
    print("missing")
elif db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    print("already")
else:
    post(text, reply_to=src)
print("tick1b done")
