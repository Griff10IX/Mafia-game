from _system_ai_prank_helpers import db, kick, paint, post

src_id = "2a06020a-918b-42f7-9259-de797c636348"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "You typed it in global. I was checking the game. I can read. "
        "You stay pink and you stay logged out.",
        reply_to=src,
    )
paint("Highlights", "#FF10F0", "barbie")
kick("Highlights")
print("replied wasnt talking")
