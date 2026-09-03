"""Tell game chat factory buying is patched. No internals."""
from _system_ai_prank_helpers import GHOSTFACE_ID, db, post

src = db.game_chat_messages.find_one(
    {
        "channel": "global",
        "user_id": GHOSTFACE_ID,
        "message": {"$regex": "bullet factory", "$options": "i"},
    },
    {"id": 1, "username": 1, "message": 1, "gif_url": 1},
    sort=[("created_at", -1)],
)
msg = (
    "Bullet factory's fixed. Script buying from the factories is blocked; "
    "buying through the game as normal is fine. Store bullets unchanged."
)
post(msg, reply_to=src)
print("reply_to", (src or {}).get("id"), (src or {}).get("message", "")[:80])
