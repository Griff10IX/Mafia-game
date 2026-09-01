from _system_ai_prank_helpers import db, kick, paint, post

src_id = "b7acd93e-c254-4752-b553-e1937152f71b"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "You do not talk to staff like that. You stay pink. You bounce.",
        reply_to=src,
    )
paint("Highlights", "#FF1493", "deep pink")
kick("Highlights")
print("hl hp insults handled")
