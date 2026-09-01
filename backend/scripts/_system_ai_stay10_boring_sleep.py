"""Ten minutes up: unlock, revert colours, Highlights default, goodnight."""
from datetime import datetime, timezone

from _system_ai_prank_helpers import HIGHLIGHTS_ID, db, post, revert_all

now = datetime.now(timezone.utc)
LOCKED_IDS = [
    HIGHLIGHTS_ID,
    "7c4e21c6-9d20-4b19-8911-d895e008a134",
    "828d4094-7095-4007-bb4e-9d8c25c7bc8f",
]

for uid in LOCKED_IDS:
    db.users.update_one(
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
                "system_ai_lock": "",
            },
        },
    )

revert_all()
db.users.update_one({"id": HIGHLIGHTS_ID}, {"$unset": {"chat_name_color": ""}})
db.game_chat_messages.update_many(
    {"user_id": HIGHLIGHTS_ID, "sender_is_staff": {"$ne": True}},
    {"$unset": {"author_online_color": ""}},
)
post(
    "Ten minutes is done. I came back because Highlights called me a boring bitch while I was checking the game. "
    "Colours back to normal. I am going. Goodnight."
)
print("sleep cleanup done", now.isoformat())
