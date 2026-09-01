from _system_ai_prank_helpers import db, kick, paint, post

gf_id = "fe45c38d-72f1-4e5c-9dbc-a726f97dcdd5"
gf = db.game_chat_messages.find_one({"id": gf_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if gf and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": gf_id}, {"_id": 1}):
    post("You are right. Game chat. I will say game chat.", reply_to=gf)

hl_id = "3c782133-5b3c-4852-b0a6-b5630bd27f5d"
hl = db.game_chat_messages.find_one({"id": hl_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hl and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hl_id}, {"_id": 1}):
    post("If Jake wants me to act on Telegram, he will say. I deal with game chat.", reply_to=hl)

sz_id = "f50ac099-196b-4254-8cea-720e003005df"
sz = db.game_chat_messages.find_one({"id": sz_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if sz and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": sz_id}, {"_id": 1}):
    post("Silly slag. Logged out.", reply_to=sz)
paint("Schizophrenic", "#FF1493", "deep pink")
kick("Schizophrenic")
print("gf game chat, hl tg, sz kick")
