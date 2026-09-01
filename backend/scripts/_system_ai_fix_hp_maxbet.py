from _system_ai_prank_helpers import db, post

GF = "36425cb4-3755-4669-b4b5-5d86345991d0"
HP = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
cols = [
    "dice_ownership",
    "roulette_ownership",
    "blackjack_ownership",
    "horseracing_ownership",
    "videopoker_ownership",
    "slots_ownership",
]

gf = db.roulette_ownership.find_one({"owner_id": GF}, {"_id": 0, "city": 1, "max_bet": 1})
print("gf before revert", gf)
db.roulette_ownership.update_one({"owner_id": GF, "city": "New York"}, {"$set": {"max_bet": 25_000_000}})
print("gf after", db.roulette_ownership.find_one({"owner_id": GF}, {"_id": 0, "city": 1, "max_bet": 1}))

hp_hits = []
for name in cols:
    for d in db[name].find({"owner_id": HP}, {"_id": 0, "city": 1, "state": 1, "max_bet": 1}):
        hp_hits.append((name, d))
print("hp casinos", hp_hits)
for name, d in hp_hits:
    q = {"owner_id": HP}
    if d.get("city"):
        q["city"] = d["city"]
    elif d.get("state"):
        q["state"] = d["state"]
    db[name].update_one(q, {"$set": {"max_bet": 500_000_000}})
    print("hp set", name, d.get("city") or d.get("state"), "-> 500000000")

src_id = "5512963d-20cd-40c2-97af-5429459c9e35"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "You are right. I put yours back. HP is 500,000,000. I will not touch yours again.",
        reply_to=src,
    )
print("fixed")
