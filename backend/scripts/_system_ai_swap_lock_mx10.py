"""Unlock Highlights; lock Meraxes 10 minutes. GhostFace ordered."""
from datetime import datetime, timedelta, timezone

from _system_ai_prank_helpers import HIGHLIGHTS_ID, db, post

MX_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
src_id = "cdebcea8-ed1c-43e4-8687-6ff1eb4abc36"
now = datetime.now(timezone.utc)
until_iso = (now + timedelta(minutes=10)).isoformat()

mx = db.users.find_one({"id": MX_ID}, {"_id": 0, "id": 1, "username": 1})
if not mx or (mx.get("username") or "") != "Meraxes":
    raise SystemExit(f"Meraxes mismatch {mx}")

db.users.update_one(
    {"id": HIGHLIGHTS_ID, "username": "Highlights"},
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
print("highlights unlocked")

db.users.update_one(
    {"id": MX_ID, "username": "Meraxes"},
    {
        "$set": {
            "account_locked": True,
            "account_locked_at": now.isoformat(),
            "account_locked_until": until_iso,
            "sessions": [],
        },
        "$inc": {"token_version": 1},
        "$unset": {
            "account_locked_comment": "",
            "account_locked_comment_at": "",
        },
    },
)
print("meraxes locked until", until_iso)

src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = "Heard. Highlights is unlocked. Bigboy is locked for 10 minutes. It expires on its own."
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)
print("done")
