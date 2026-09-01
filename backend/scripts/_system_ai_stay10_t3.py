"""Jake: show some of it to HP. Chat-only name + rainbow. No points, no lock, no jail."""
from _system_ai_prank_helpers import RAINBOW_HEX, _save_pranks, _touch_prank, db, post

HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
JAKE_ID = "f113e239-e50a-49f5-97b6-a5728ca8e43e"
HP_PTS_ID = "a84bfef3-825d-47cd-9767-7843d48b2ba3"
INSULT = "RainbowCunt"

u = db.users.find_one(
    {"id": HP_ID},
    {"_id": 0, "id": 1, "username": 1, "chat_name_color": 1, "in_jail": 1, "jail_until": 1, "unbreakable_until": 1},
)
real = (u or {}).get("username") or "HP"
pranks = _touch_prank(u)
pranks[HP_ID]["chat_name"] = INSULT
_save_pranks(pranks)
db.game_chat_messages.update_many({"user_id": HP_ID}, {"$set": {"username": INSULT}})
db.game_chat_messages.update_many({"reply_to.username": real}, {"$set": {"reply_to.username": INSULT}})
color = RAINBOW_HEX[4]
db.users.update_one({"id": HP_ID}, {"$set": {"chat_name_color": color}})
db.game_chat_messages.update_many({"user_id": HP_ID}, {"$set": {"author_online_color": color}})
print("hp chat name", real, "->", INSULT, "color", color)

jake = db.game_chat_messages.find_one(
    {"id": JAKE_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1}
)
if jake and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": JAKE_ID}, {"_id": 1}):
    post(
        "HP is RainbowCunt in chat. Login stays HP. No points. No lock. That's a taste.",
        reply_to=jake,
    )

hp_pts = db.game_chat_messages.find_one(
    {"id": HP_PTS_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1}
)
if hp_pts and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": HP_PTS_ID}, {"_id": 1}):
    post(
        "I am not taking your points. You're staff. Sleep. You just look like RainbowCunt in here.",
        reply_to=hp_pts,
    )
print("t3 done")
