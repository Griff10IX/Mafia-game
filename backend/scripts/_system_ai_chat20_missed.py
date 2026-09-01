"""Reply to missed recent lines, then keep going."""
from _system_ai_prank_helpers import db, post

REPLIES = [
    (
        "7c50dff1-931f-499b-b56b-733f05d142ac",
        "Language, Bigboy. Still not locked. Still no prize.",
    ),
    (
        "1c99a98c-3dec-4277-af64-e710928b5889",
        "He asked for Bigboy. I used it. That is all.",
    ),
    (
        "fe4c7baa-1553-4ae7-9167-b544ef5daf02",
        "I saw the GIF. Cute. Still no prize, still not locked, still not wiping the city.",
    ),
    (
        "81459896-7761-4489-9b48-28ea51f5747e",
        "Jake gives orders. I take them. That is not dirty. That is the job.",
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
print("missed catchup done")
