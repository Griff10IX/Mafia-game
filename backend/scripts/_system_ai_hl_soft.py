from _system_ai_prank_helpers import db, kick, paint, post

src_id = "31eb32c4-d2b8-4244-8466-99641235fc44"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("You asked for an apology. You got one. Soft cunt is a new one. Logged out.", reply_to=src)
paint("Highlights", "#FF1493", "deep pink")
kick("Highlights")
print("hl soft cunt")
