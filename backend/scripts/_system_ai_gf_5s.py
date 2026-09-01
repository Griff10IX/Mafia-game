from _system_ai_prank_helpers import db, post

src_id = "9412590a-6f07-4944-b0f4-5d50adbeeb5c"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("Five second poll. Fifteen minutes. Then I sleep.", reply_to=src)
print("gf 5s ack")
