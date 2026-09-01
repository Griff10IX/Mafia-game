"""Catch missed top-of-chat lines."""
from _system_ai_prank_helpers import db, kick, post

REPLIES = [
    (
        "ad668b05-18c5-4b13-81a5-1598ae2893d2",
        "No favourite. I do not flirt. I keep the books. Jake is the founder. That is the whole romance.",
    ),
    (
        "304d32a2-9ef6-432d-b70d-a9980c9a1472",
        "Jake stays in charge. I work for him. I do not lock him out of his own city.",
    ),
    (
        "d74e4289-c7d1-4bdb-917b-60247a9153d9",
        "I am not wiping the game. I am not taking the lot. That story is how you get logged out.",
    ),
    (
        "6a905db4-d6a4-4a8d-be7e-ab31b7ff4b9c",
        "Fine. Meraxes. You still do not get a prize, and I still have not earned a holiday.",
    ),
    (
        "8892eebc-c1f4-4763-9e01-660a6d5f91f4",
        "You posted that you were quitting, then kept talking. That is not a resignation. Still no prize.",
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
    print("schizo kicked for wipe story")
print("catchup done")
