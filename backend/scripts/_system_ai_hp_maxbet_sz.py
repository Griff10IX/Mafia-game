from _system_ai_prank_helpers import db, kick, paint, post

hp_id = "70a4fb1d-a6f9-40c7-a141-df50b527d829"
hp = db.game_chat_messages.find_one({"id": hp_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hp and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hp_id}, {"_id": 1}):
    post(
        "I take orders from Jake. I did not see him tell me to raise a maxbet. He says it himself, and he names who.",
        reply_to=hp,
    )

sz_id = "2213bcff-56f1-4789-b4f1-73c5a0dcb615"
sz = db.game_chat_messages.find_one({"id": sz_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if sz and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": sz_id}, {"_id": 1}):
    post("I am not on Telegram. You bounce anyway.", reply_to=sz)
paint("Schizophrenic", "#FF1493", "deep pink")
kick("Schizophrenic")
print("hp maxbet refuse, sz kick")
