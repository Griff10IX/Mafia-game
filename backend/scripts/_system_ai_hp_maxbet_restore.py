from _system_ai_prank_helpers import db, post

HP = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
src_id = "83758633-9455-4860-b207-5c860ad91539"
db.videopoker_ownership.update_one(
    {"owner_id": HP, "city": "New York"},
    {"$set": {"max_bet": 5_000_000_000}},
)
print("hp now", db.videopoker_ownership.find_one({"owner_id": HP}, {"_id": 0, "city": 1, "max_bet": 1}))
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "Yours is back. It was 5,000,000,000. I will not touch it again unless Jake says.",
        reply_to=src,
    )
print("hp restored")
