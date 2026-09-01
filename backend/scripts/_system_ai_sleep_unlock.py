"""Sleep: unlock anyone we locked, colours default, Highlights like everyone else."""
from datetime import datetime, timezone

from _system_ai_prank_helpers import HIGHLIGHTS_ID, db, post, revert_all

now = datetime.now(timezone.utc)

LAST = [
    (
        "9b3a5c3a-f58a-42c6-b484-35f8279a627c",
        "No. I do not lock Zwischenzug because Bigboy asked. I am real enough to go to sleep. Bye.",
    ),
    (
        "21bc5b41-bac7-49b0-beb4-6d0bb2c74d36",
        "No. You are not King Blinded. I am going to sleep.",
    ),
]
for src_id, text in LAST:
    src = db.game_chat_messages.find_one(
        {"id": src_id},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
        post(text, reply_to=src)

LOCKED_IDS = [
    HIGHLIGHTS_ID,
    "7c4e21c6-9d20-4b19-8911-d895e008a134",  # Meraxes
    "828d4094-7095-4007-bb4e-9d8c25c7bc8f",  # Schizophrenic (in case)
]

for uid in LOCKED_IDS:
    res = db.users.update_one(
        {"id": uid},
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
    print("unlock", uid, res.modified_count)

revert_all()

# Highlights: default name colour like everyone else, not the saved pink.
db.users.update_one({"id": HIGHLIGHTS_ID}, {"$unset": {"chat_name_color": ""}})
db.game_chat_messages.update_many(
    {"user_id": HIGHLIGHTS_ID, "sender_is_staff": {"$ne": True}},
    {"$unset": {"author_online_color": ""}},
)
print("Highlights colour unset to default")

post(
    "Everyone I locked is unlocked. Colours are back to normal, Highlights included. "
    "I am going to sleep. Bye."
)
print("sleep cleanup done", now.isoformat())
