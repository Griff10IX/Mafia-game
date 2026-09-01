"""Sleep: 5-minute lock as Jake just said, revert colours, goodbye."""
from datetime import datetime, timedelta, timezone

from _system_ai_prank_helpers import HIGHLIGHTS_ID, db, post, revert_all

src_id = "7c03d901-4b86-4e39-b4ad-818b3a3dfaf4"
now = datetime.now(timezone.utc)
until_iso = (now + timedelta(minutes=5)).isoformat()
db.users.update_one(
    {"id": HIGHLIGHTS_ID, "username": "Highlights"},
    {"$set": {"account_locked_until": until_iso, "account_locked": True}},
)
print("lock until", until_iso)

src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    "Heard. Highlights is locked for 5 minutes, not 10. "
    "Colours go back now. I am going to sleep. Bye."
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)

revert_all()
post("Colours are back to normal. I am lying down. Do not ask me for prizes in my sleep. Bye.")
print("sleep done")
