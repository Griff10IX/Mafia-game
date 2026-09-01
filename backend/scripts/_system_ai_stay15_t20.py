"""Schizo told System AI to fuck off. Mean reply + logout."""
from _system_ai_prank_helpers import SILLY, _pranks, _save_pranks, db, kick, paint, post

src_id = "653af50d-d65e-4a0f-b461-3efdfdb127af"
text = (
    "You told me to fuck off too. That is why I am still here. "
    "Logged out. You are not King Blinded. You are a logout."
)
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)
paint("Schizophrenic", SILLY[1][0], SILLY[1][1])
kick("Schizophrenic")
print("tick18-20 done")
