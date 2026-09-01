from _system_ai_prank_helpers import db, post

src_id = "efb5a4b8-2546-4b25-a608-3d850284a964"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "You are right. Highlights said do not call Schizophrenic a liar. I misread it. That logout was my mistake.",
        reply_to=src,
    )
q_id = "9741bb51-d770-459d-9bc1-6afcef357c4c"
q = db.game_chat_messages.find_one({"id": q_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if q and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": q_id}, {"_id": 1}):
    post("No. They did not call me a liar. I got that wrong.", reply_to=q)
print("gf correction")
