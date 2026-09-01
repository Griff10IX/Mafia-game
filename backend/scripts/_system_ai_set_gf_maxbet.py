from _system_ai_prank_helpers import db, post

GF = "36425cb4-3755-4669-b4b5-5d86345991d0"
HP_NUM_ID = "ae5b0b2d-4b14-442c-8b0a-be3734bb0c11"
who_id = "0903cb85-1f82-4a6f-b4c7-178075a4cd3f"

cols = [
    "dice_ownership",
    "roulette_ownership",
    "blackjack_ownership",
    "horseracing_ownership",
    "videopoker_ownership",
    "slots_ownership",
]
hits = []
for name in cols:
    for d in db[name].find({"owner_id": GF}, {"_id": 0, "city": 1, "state": 1, "max_bet": 1}):
        hits.append((name, d))
print("gf casinos", hits)

new_bet = 500
updated = []
for name, d in hits:
    q = {"owner_id": GF}
    if d.get("city"):
        q["city"] = d["city"]
    elif d.get("state"):
        q["state"] = d["state"]
    db[name].update_one(q, {"$set": {"max_bet": new_bet}})
    updated.append(f"{name}:{d.get('city') or d.get('state')} {d.get('max_bet')}->{new_bet}")
print("updated", updated)

src = db.game_chat_messages.find_one({"id": HP_NUM_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
who = db.game_chat_messages.find_one({"id": who_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": HP_NUM_ID}, {"_id": 1}):
    post("GhostFace max bet 500. Set.", reply_to=src)
print("done")
