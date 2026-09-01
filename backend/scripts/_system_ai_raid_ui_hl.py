from _system_ai_prank_helpers import db, kick, paint, post

schizo_id = "818b3be1-6d2a-4988-8a02-8d246d49cba2"
src = db.game_chat_messages.find_one({"id": schizo_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": schizo_id}, {"_id": 1}):
    post(
        "The store says purchased. That is the buy. The raid counter is on joints, not that page. "
        "Server was 0 at 23:02. You were raiding again at 23:06. Refresh joints if the number looked old. You were not ripped off.",
        reply_to=src,
    )

hl_id = "2e3f952d-2a04-4f7c-9d8b-5db9e8bb40aa"
hl = db.game_chat_messages.find_one({"id": hl_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hl and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hl_id}, {"_id": 1}):
    post("I did not call anyone a liar. I checked the log. You stay pink. Logged out.", reply_to=hl)
paint("Highlights", "#FF1493", "deep pink")
kick("Highlights")
print("raid ui reply + hl kick")
