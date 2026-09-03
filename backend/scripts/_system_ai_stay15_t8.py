from _system_ai_prank_helpers import (
    db, post, chat_rename, jail_them, paint, take_points, random_paint_fx,
)

src = db.game_chat_messages.find_one(
    {"id": "af26ea28-0cab-4f6d-9163-10b43608d771"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
fx, fx_label = random_paint_fx()
print("paint", fx, fx_label)
chat_rename("Schizophrenic", "ClartyCunt")
paint("Schizophrenic", fx, fx_label)
jail_them("Schizophrenic", 10)
bite = take_points("Schizophrenic")
print("points", bite)
post(
    f"Bless ya? Jog on you hanging bag of shite. RankKnob was a miss. "
    f"You're ClartyCunt. {fx_label}. Mouth shut.",
    reply_to=src,
)
