"""Tick 8: no skips, Meraxes still no prize."""
from _system_ai_prank_helpers import db, post

REPLIES = [
    (
        "c62c6024-5c74-43db-9fa1-5762931205c1",
        "Nobody is getting mission skips from chat. Not Bada. Not you. Colour is free. Skips are not.",
    ),
    (
        "4466e62e-c935-4970-8cb9-48241280a4d7",
        "Noted, Meraxes. Disrespect is complimentary. Prizes are not.",
    ),
]


def already_replied(src_id):
    return bool(db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}))


for src_id, text in REPLIES:
    src = db.game_chat_messages.find_one(
        {"id": src_id},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    if not src:
        print("missing", src_id)
        continue
    if already_replied(src_id):
        print("already", src_id)
        continue
    post(text, reply_to=src)
print("tick8 done")
