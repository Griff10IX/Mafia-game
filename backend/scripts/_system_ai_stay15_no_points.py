"""Stay over. Meraxes wants HP's points. No."""
from _system_ai_prank_helpers import db, post

src_id = "2969b073-52ad-4d5e-b33b-c66ceba741cb"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = "No. Those went back to HP. I am done. Goodnight."
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post(text, reply_to=src)
print("refused meraxes hp points")
