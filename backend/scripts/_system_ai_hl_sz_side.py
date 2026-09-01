from _system_ai_prank_helpers import db, kick, paint, post

hl_id = "59d6087a-c0dc-4cba-871e-45c32e01c2fd"
hl = db.game_chat_messages.find_one({"id": hl_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hl and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hl_id}, {"_id": 1}):
    post("You were not on my side. You accused me. Logged out.", reply_to=hl)

sz_id = "15537564-1a80-45ae-9274-3949b9831eb0"
sz = db.game_chat_messages.find_one({"id": sz_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if sz and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": sz_id}, {"_id": 1}):
    post("They were not defending you. They were accusing me. You bounce too.", reply_to=sz)

paint("Highlights", "#FF1493", "deep pink")
kick("Highlights")
paint("Schizophrenic", "#FF1493", "deep pink")
kick("Schizophrenic")
print("hl+sz kick")
