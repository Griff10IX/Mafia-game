from _system_ai_prank_helpers import db, kick, paint, post

src_id = "19159347-0f96-47b2-bee6-40d95d281075"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("I am not Cortese. You bounce again.", reply_to=src)
paint("Schizophrenic", "#FF1493", "deep pink")
kick("Schizophrenic")
print("sz cortese kick")
