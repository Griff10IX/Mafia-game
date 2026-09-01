"""Jake allowed: lock Highlights 10 minutes as a prank."""
from datetime import datetime, timedelta, timezone

from _system_ai_prank_helpers import HIGHLIGHTS_ID, db, post

src_id = "a5ed7959-4912-4223-bc08-975246cc12c8"
now = datetime.now(timezone.utc)
until = now + timedelta(minutes=10)
until_iso = until.isoformat()

hl = db.users.find_one({"id": HIGHLIGHTS_ID}, {"_id": 0, "id": 1, "username": 1})
if not hl or (hl.get("username") or "") != "Highlights":
    raise SystemExit(f"Highlights mismatch {hl}")

db.users.update_one(
    {"id": HIGHLIGHTS_ID, "username": "Highlights"},
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
print("locked until", until_iso)

src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = "Heard. Highlights is locked for 10 minutes. Prank. Tennis ball and a timeout. It expires on its own."
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)
print("lock prank done")
