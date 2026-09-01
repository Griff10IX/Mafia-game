from _system_ai_prank_helpers import db, post

src_id = "9c0d25cf-d543-4dcc-b49b-4b03ca87dead"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("I deal with global. They already bounced. I do not police Telegram.", reply_to=src)
print("tg slag reply")
