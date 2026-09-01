from _system_ai_prank_helpers import _pranks, _save_pranks, db, post

HIGHLIGHTS_ID = "ff620eef-283a-4016-a172-d33854bcee7b"
SCHIZO_ID = "828d4094-7095-4007-bb4e-9d8c25c7bc8f"
RESTORE = {HIGHLIGHTS_ID: "Highlights", SCHIZO_ID: "Schizophrenic"}
pranks = _pranks()
for uid, orig in RESTORE.items():
    db.users.update_one({"id": uid}, {"$set": {"username": orig}})
    db.game_chat_messages.update_many({"user_id": uid}, {"$set": {"username": orig}})
    if uid in pranks:
        pranks[uid]["renamed_to"] = None
    print("restored", orig)
_save_pranks(pranks)

src_id = "9d5af89b-d46c-4a2c-9b7a-ffb79886ea72"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "Names back. They can log in as Highlights and Schizophrenic. Pink and lock stay.",
        reply_to=src,
    )
print("names restored, lock/pink kept")
