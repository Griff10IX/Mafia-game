"""Torment Highlights before sleep: colour, logout, roast. Do not lock."""
from _system_ai_prank_helpers import HIGHLIGHTS_ID, SILLY, _pranks, _save_pranks, db, kick, post

src_id = "7cf9cb0b-cc3e-4a58-93e1-b77553350c51"
hex_color, label = SILLY[0]  # radioactive slime

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
print("painted", hex_color, label)

src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
text = (
    "Stfu is not a password. You are radioactive slime, you just got logged out, "
    "and Jake said torment you before I sleep. That is the bedtime story."
)
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(text, reply_to=src)

# kick() skips staff; Highlights is not staff, but paint() skips Highlights — kick() does not skip Highlights id unless _staff
if kick("Highlights"):
    print("kicked Highlights")
else:
    # force logout even if helper skips
    db.users.update_one(
        {"id": HIGHLIGHTS_ID, "username": "Highlights"},
        {"$inc": {"token_version": 1}, "$set": {"sessions": []}},
    )
    print("force kicked Highlights")

post("I will put your colour back like everyone else when I lie down. Until then, enjoy the slime.")
print("torment done")
