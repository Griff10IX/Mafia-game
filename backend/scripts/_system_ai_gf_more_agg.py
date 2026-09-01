from _system_ai_prank_helpers import db, post

gf_id = "5bee93c6-7f6c-4499-87ee-9675b2e9eff0"
gf = db.game_chat_messages.find_one({"id": gf_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if gf and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": gf_id}, {"_id": 1}):
    post(
        "Done. Insult me and you get locked, pink, and a new name. Staff stay.",
        reply_to=gf,
    )

hp_id = "b9cd8eb1-26f9-4ca1-9090-109fb5026a08"
hp = db.game_chat_messages.find_one({"id": hp_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if hp and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": hp_id}, {"_id": 1}):
    post("Yes. Unless Jake says. That is the rule. You stay staff. Mock it again and I still will not lock you.", reply_to=hp)
print("gf aggressive ack")
