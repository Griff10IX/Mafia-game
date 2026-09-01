from _system_ai_prank_helpers import db, post

src_id = "b10d6599-2c07-4620-b485-5efb923715f4"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "Yes. You are staff. That is why you are still here. Your mate is not. Do not wave it around like a trophy.",
        reply_to=src,
    )
print("hp staff trophy reply, no kick")
