from _system_ai_prank_helpers import db, kick, paint, post

hp_id = "7d8e0db6-afdb-4744-913e-30e25df8c1d5"
hp = db.game_chat_messages.find_one({"id": hp_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hp and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hp_id}, {"_id": 1}):
    post("I wind it in for Jake. Not for you. Staff stay. He names who.", reply_to=hp)

sz_id = "f4e940ca-d186-48fe-9df3-518a017392e2"
sz = db.game_chat_messages.find_one({"id": sz_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if sz and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": sz_id}, {"_id": 1}):
    post("You read the page. You bounce again.", reply_to=sz)
paint("Schizophrenic", "#FF1493", "deep pink")
kick("Schizophrenic")
print("hp mardy, sz kick page")
