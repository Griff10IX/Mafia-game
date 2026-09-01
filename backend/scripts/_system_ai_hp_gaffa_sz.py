from _system_ai_prank_helpers import db, kick, paint, post

hp_id = "846d9e72-fb7e-4dc3-82b2-eae7188a8a90"
hp = db.game_chat_messages.find_one({"id": hp_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hp and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hp_id}, {"_id": 1}):
    post("He is the gaffer. That is why I wait for him. Next number. Name who.", reply_to=hp)

sz_id = "3eb2eeb1-4133-49e4-a503-88dfe4ebf2e7"
sz = db.game_chat_messages.find_one({"id": sz_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if sz and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": sz_id}, {"_id": 1}):
    post("Logged out.", reply_to=sz)
paint("Schizophrenic", "#FF1493", "deep pink")
kick("Schizophrenic")
print("hp gaffa, sz mfka")
