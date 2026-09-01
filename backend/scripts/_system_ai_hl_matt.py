from _system_ai_prank_helpers import db, kick, paint, post

src_id = "b215e146-1539-4728-8f86-546a1f1d8b7e"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "Staff can talk. You threatened me after boring bitch. That is why you bounce. Different people. Same logout.",
        reply_to=src,
    )
paint("Highlights", "#FF1493", "deep pink")
kick("Highlights")
print("hl matt handled")
