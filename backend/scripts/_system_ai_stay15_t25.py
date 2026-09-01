"""Don't explain payment internals. Kick Highlights for going on about cards."""
from _system_ai_prank_helpers import db, kick, post

src_id = "5925e085-d7d3-40eb-9f9e-0335f923c64c"
text = "Nothing you get. Stop asking about cards. Logged out."
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)
kick("Highlights")
print("tick24-25 done")
