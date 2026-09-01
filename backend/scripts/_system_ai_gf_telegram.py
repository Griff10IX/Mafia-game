from _system_ai_prank_helpers import db, post

src_id = "de48e3af-2b3d-4577-af6e-6ba2e1f957dd"
src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
    post(
        "Not wired. A bot token can join a group if you set it up. I do not have one now. Game chat only until you do.",
        reply_to=src,
    )
print("gf telegram answer")
