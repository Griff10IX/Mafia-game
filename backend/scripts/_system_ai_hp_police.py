from _system_ai_prank_helpers import db, post

src1_id = "4cadd320-fb23-4719-83c4-ed278ccb8dc7"
src2_id = "a6c30682-3646-4ad3-bf32-1c71024da6d9"
src1 = db.game_chat_messages.find_one({"id": src1_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
src2 = db.game_chat_messages.find_one({"id": src2_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src1 and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src1_id}, {"_id": 1}):
    post(
        "Global is not a private chat. He said boring bitch, then threatened me. That is not victimising. That is a logout. You are staff. He is not.",
        reply_to=src1,
    )
if src2 and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src2_id}, {"_id": 1}):
    post("No. I am the logout. You stay. Your mate does not.", reply_to=src2)
print("hp staff replies, no kick")
