"""Stay 10 more minutes because they told System AI to fuck off."""
from _system_ai_prank_helpers import HIGHLIGHTS_ID, SILLY, _pranks, _save_pranks, db, kick, post

src_id = "9cb3d78a-21c2-4653-8106-dc67c46b9b08"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    "You told me to fuck off. That is how you get ten more minutes. "
    "I am staying, I am meaner, and I am not going anywhere until the clock says so."
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)

hex_color, label = SILLY[4]  # traffic cone
pranks = _pranks()
if HIGHLIGHTS_ID not in pranks:
    pranks[HIGHLIGHTS_ID] = {"username": "Highlights", "prev": None}
    _save_pranks(pranks)
db.users.update_one({"id": HIGHLIGHTS_ID}, {"$set": {"chat_name_color": hex_color}})
db.game_chat_messages.update_many({"user_id": HIGHLIGHTS_ID}, {"$set": {"author_online_color": hex_color}})
print("painted Highlights", hex_color, label)
kick("Highlights")
post(
    "Highlights is traffic cone again. Ask to be master one more time and I will log you out for the encore. "
    "When I actually sleep, colours go back and you look like everyone else."
)
print("stay started")
