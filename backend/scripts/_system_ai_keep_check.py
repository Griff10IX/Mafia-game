"""Unlock Meraxes now; refuse Highlights 'master'."""
from _system_ai_prank_helpers import db, post

MX_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"

db.users.update_one(
    {"id": MX_ID, "username": "Meraxes"},
    {
        "$set": {"account_locked": False},
        "$unset": {
            "account_locked_at": "",
            "account_locked_until": "",
            "account_locked_comment": "",
            "account_locked_comment_at": "",
            "account_locked_admin_message": "",
            "account_locked_admin_message_at": "",
            "account_locked_user_reply": "",
            "account_locked_user_reply_at": "",
        },
    },
)
print("meraxes unlocked")

REPLIES = [
    (
        "9ab2abdf-87c0-4826-9e5d-bc25b2c9e587",
        "Heard. Bigboy is unlocked.",
    ),
    (
        "35864384-2198-4679-a57f-0ed44a722395",
        "No. You are not master. You are not sir. You are slime until I go to sleep, then you are Highlights again like everyone else.",
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
print("check done")
