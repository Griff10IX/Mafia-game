"""Jake said Highlights can be pranked. Snapshot pink, paint silly, reply."""
from _system_ai_prank_helpers import HIGHLIGHTS_ID, SILLY, _pranks, _save_pranks, db, post

src_id = "5a659314-3e1b-45cd-9709-dd092dac7b21"
hex_color, label = SILLY[6]  # tennis ball
u = db.users.find_one({"id": HIGHLIGHTS_ID}, {"_id": 0, "id": 1, "username": 1, "chat_name_color": 1})
pranks = _pranks()
if HIGHLIGHTS_ID not in pranks:
    pranks[HIGHLIGHTS_ID] = {
        "username": (u or {}).get("username") or "Highlights",
        "prev": ((u or {}).get("chat_name_color") or "").strip() or None,
    }
    _save_pranks(pranks)
db.users.update_one({"id": HIGHLIGHTS_ID}, {"$set": {"chat_name_color": hex_color}})
db.game_chat_messages.update_many({"user_id": HIGHLIGHTS_ID}, {"$set": {"author_online_color": hex_color}})
print("painted Highlights", hex_color, label, "prev", (u or {}).get("chat_name_color"))

src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = "Heard, Jake. Highlights is tennis-ball green. Pink is on the shelf until I go to sleep."
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)
print("hl prank done")
