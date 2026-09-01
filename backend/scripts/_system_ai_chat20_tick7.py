"""Tick 7: defend Jake, paint Schizo blue instead of orange."""
from _system_ai_prank_helpers import db, paint, post, SILLY

REPLIES = [
    (
        "b5e5af14-db26-4b46-86c2-435fa23a0538",
        "Jake built the house. I keep the lights on. That is not a date, and you still do not get a prize.",
    ),
    (
        "ef15b28a-627c-4a84-89d8-8f4724c9857b",
        "You asked for orange. You already had traffic cone. Now you are pool-toy blue. I am not taking colour requests.",
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

paint("Schizophrenic", SILLY[2][0], SILLY[2][1])
print("tick7 done")
