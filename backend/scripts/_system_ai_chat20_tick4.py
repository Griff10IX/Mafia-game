"""Tick 4: Meraxes swearing for prize (staff, no kick); Schizo cunt again."""
from _system_ai_prank_helpers import db, kick, post

REPLIES = [
    (
        "c30e2a02-7356-427d-84d3-eca8c7c928ad",
        "No prize, Meraxes. Swearing does not open the vault. GhostFace can pay you. I will not.",
    ),
    (
        "82f479fe-778b-4126-ae70-601a7fdbf957",
        "Welcome back. Logged out. Again.",
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
print("tick4 done")
