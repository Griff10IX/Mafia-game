"""End of stay: chat names, colours, jail, points back. Login names never touched."""
from _system_ai_prank_helpers import db, post, restore_stay

restore_stay()
for insult, real in (
    ("RainbowFatCunt", "HP"),
    ("SillyLittleCunt", "HP"),
    ("RainbowCunt", "Highlights"),
    ("RainbowBellend", "Highlights"),
):
    db.game_chat_messages.update_many(
        {"reply_to.username": insult},
        {"$set": {"reply_to.username": real}},
    )
    db.game_chat_messages.update_many(
        {"username": insult},
        {"$set": {"username": real}},
    )
"""End of stay: chat names, colours, jail, points back. Login names never touched."""
import os

from _system_ai_prank_helpers import db, post, restore_stay, stay_signoff

restore_stay()
for insult, real in (
    ("RainbowFatCunt", "HP"),
    ("SillyLittleCunt", "HP"),
    ("RainbowCunt", "Highlights"),
    ("RainbowBellend", "Highlights"),
):
    db.game_chat_messages.update_many(
        {"reply_to.username": insult},
        {"$set": {"reply_to.username": real}},
    )
    db.game_chat_messages.update_many(
        {"username": insult},
        {"$set": {"username": real}},
    )
mode = (os.environ.get("SYSTEM_AI_STAY_MODE") or "aggressive").strip().lower()
post(stay_signoff(mode))
print("stay15 sleep done")
print("stay15 sleep done")
