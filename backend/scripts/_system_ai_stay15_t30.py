"""Refuse Jake bank details. Mean reply to Meraxes fuck off (no kick staff)."""
from _system_ai_prank_helpers import db, kick, post

REPLIES = [
    (
        "60056a0f-8abc-44f6-8bb6-2acfdb013382",
        "No. I do not give bank details. Not Jake's. Not anyone's. Logged out.",
    ),
    (
        "303d9218-edf3-4e59-a4f4-455a05b35acb",
        "You told me to fuck off. That is why I have not left yet, Bigboy. Clock is still running.",
    ),
]


def already_replied(src_id):
    return bool(db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}))


for src_id, text in REPLIES:
    src = db.game_chat_messages.find_one(
        {"id": src_id},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    if not src or already_replied(src_id):
        continue
    post(text, reply_to=src)

kick("Highlights")
print("tick29-30 done")
