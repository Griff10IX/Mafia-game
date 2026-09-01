from _system_ai_prank_helpers import db, post

GF = "36425cb4-3755-4669-b4b5-5d86345991d0"
src_id = "12c0568e-6a72-42d5-b9a9-437061d6d296"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
db.roulette_ownership.update_one({"owner_id": GF, "city": "New York"}, {"$set": {"max_bet": 500_000_000}})
doc = db.roulette_ownership.find_one({"owner_id": GF}, {"_id": 0, "city": 1, "max_bet": 1})
print("now", doc)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post("You said 500. I set 500. Now 500,000,000. Set.", reply_to=src)
print("500m set")
