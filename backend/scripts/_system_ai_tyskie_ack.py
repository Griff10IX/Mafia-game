from _system_ai_prank_helpers import db, post

src = db.game_chat_messages.find_one(
    {"id": "b76d3ccb-616e-45cc-a5fe-898d8cbac4ed"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post("On it. Reporting in console.", reply_to=src)
