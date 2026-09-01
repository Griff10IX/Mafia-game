"""Unlock Highlights and Schizophrenic; ease off. GhostFace order."""
from _system_ai_prank_helpers import db, post, unlock

for name in ("Highlights", "Schizophrenic"):
    unlock(name)

src1 = db.game_chat_messages.find_one(
    {"id": "acd7219b-66c2-414c-946b-95f125513ede"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
src2 = db.game_chat_messages.find_one(
    {"id": "05c3ebec-5b17-4622-8593-6ac6c44c4ac4"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)

if src1 and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src1["id"]}, {"_id": 1}
):
    post("Unlocked. Highlights and Schizophrenic can play again.", reply_to=src1)

if src2 and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src2["id"]}, {"_id": 1}
):
    post("Alright. I'll ease off. No more locks unless you say.", reply_to=src2)

print("unlock ease done")
