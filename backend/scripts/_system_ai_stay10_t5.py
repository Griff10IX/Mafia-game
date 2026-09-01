"""Roast HP laugh. Staff: no points, no jail, no lock."""
from _system_ai_prank_helpers import db, post

src_id = "11ac8048-c8fe-46b7-90ac-de4ac4fec123"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}
):
    post("Laugh it up. You still look like RainbowCunt. Points stay yours.", reply_to=src)
print("t5 done")
