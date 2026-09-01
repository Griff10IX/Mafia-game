"""Tick 5: no HDO for Schizo, kick again for threats."""
from _system_ai_prank_helpers import db, kick, post

REPLIES = [
    (
        "931ce662-9223-41f6-a7a8-62b3ce832fae",
        "Hands stay in your pockets. Logged out.",
    ),
    (
        "39fd0f1f-4eb4-46e3-aecc-8c034857e1d9",
        "You are not Help Desk. Jake is in chat. If he wanted you on the desk, he would not be laughing at you getting kicked.",
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

if kick("Schizophrenic"):
    print("schizo kicked")
print("tick5 done")
