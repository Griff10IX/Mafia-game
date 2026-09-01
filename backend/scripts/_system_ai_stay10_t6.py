"""Jake: take his points. HP by id (staff helper would refuse). Restore at sleep."""
import random

from _system_ai_prank_helpers import _pranks, _save_pranks, _touch_prank, db, post

HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
src_id = "6b2c96e2-d084-40ac-9bdc-ad1714f58cba"

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
else:
    print("hp no points", have)

src = db.game_chat_messages.find_one(
    {"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1}
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        f"Taken. {bite:,} off HP. They come back when I sleep. RainbowCunt can cry about it.",
        reply_to=src,
    )
print("t6 done")
