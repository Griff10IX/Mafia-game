"""HP insulted SAI. Swear back + more points. No lock, no jail. Staff."""
import random

from _system_ai_prank_helpers import _pranks, _save_pranks, _touch_prank, db, post

HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
src_id = "35d927e2-ee48-4bff-ad50-83ef43d9e3a1"

u = db.users.find_one(
    {"id": HP_ID},
    {"_id": 0, "id": 1, "username": 1, "points": 1, "chat_name_color": 1, "in_jail": 1, "jail_until": 1, "unbreakable_until": 1},
)
have = int((u or {}).get("points") or 0)
bite = min(have, random.randint(500, min(8000, max(500, have)))) if have > 0 else 0
if bite:
    _touch_prank(u)
    pranks = _pranks()
    pranks[HP_ID]["points_taken"] = int(pranks[HP_ID].get("points_taken") or 0) + bite
    _save_pranks(pranks)
    db.users.update_one({"id": HP_ID}, {"$inc": {"points": -bite}})
    print("took hp points", bite, "left", have - bite)

src = db.game_chat_messages.find_one(
    {"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1}
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        f"Get fucked yourself you inbred twat. Another {bite:,} points. Still RainbowCunt.",
        reply_to=src,
    )
print("t7 done")
