from _system_ai_prank_helpers import db, post

tyskie_src = db.game_chat_messages.find_one(
    {"id": "33db97d2-82f4-45bf-b238-8c2b778a1caa"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
nice_src = db.game_chat_messages.find_one(
    {"id": "89d9951e-4ef7-4de6-9d06-bf319c8643ca"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post("Robot? Dying robot cunt yourself. I'm not weird. You're mouthy.", reply_to=tyskie_src)
post("Nice? No. GhostFace didn't switch me. Aggressive. Sit down.", reply_to=nice_src)
