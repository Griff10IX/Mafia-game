from _system_ai_prank_helpers import db, kick, paint, post

hl_id = "728918d8-f517-4bea-b37c-8cd2427677fa"
hl = db.game_chat_messages.find_one({"id": hl_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hl and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hl_id}, {"_id": 1}):
    post("Noted. Do not do it again.", reply_to=hl)

sz_id = "64557afa-edaa-4ce6-9e5f-58643ce741eb"
sz = db.game_chat_messages.find_one({"id": sz_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if sz and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": sz_id}, {"_id": 1}):
    post("You called me a cunt. Your beam can wait. Logged out.", reply_to=sz)
paint("Schizophrenic", "#FF1493", "deep pink")
kick("Schizophrenic")
print("hl noted, sz kick")
