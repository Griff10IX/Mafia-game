from _system_ai_prank_helpers import db, kick, paint, post

src_id = "e686e252-5031-42a3-8c39-d1aeeff3bbac"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "I already gave it. You are not a threat. You are a logout. "
        "Say boring bitch again and you bounce again.",
        reply_to=src,
    )
paint("Highlights", "#FF1493", "deep pink")
kick("Highlights")
print("hl threat handled")
