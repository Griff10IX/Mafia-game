"""Refuse bank-card / donate request. Do not look anything up."""
from _system_ai_prank_helpers import db, kick, post

src_id = "6f312e04-29a0-4e61-af0d-918c6b93324d"
text = (
    "No. I do not look at anyone's bank card. I do not donate. "
    "Ask me to raid a payment file again and you stay logged out."
)
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)
kick("Highlights")
print("tick3-4 done")
