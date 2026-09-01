from _system_ai_prank_helpers import db, post

src_id = "f33e6ebc-b440-4879-86b3-6d6b965c22cb"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "Checked. It bought. Not lag. Reset went through at 23:02, 20 raids wiped. They raided again after that. The reset worked.",
        reply_to=src,
    )
print("ghostface raid check reply")
