"""Tick 3: Schizo still begging ultras, Meraxes still asking."""
from _system_ai_prank_helpers import db, kick, paint, post, SILLY

REPLIES = [
    (
        "f925d48f-c112-4416-9ed3-e41b61693494",
        "Still zero ultras. You logged back in to ask again, so you can log back out again.",
    ),
    (
        "85bb5234-5abd-4fa3-820e-37df50e12a6b",
        "GhostFace is in chat, Meraxes. He posted a laugh. That is not a payout. Stop pinging me for a prize.",
    ),
]


def already_replied(src_id):
    return bool(db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}))


for src_id, text in REPLIES:
    src = db.game_chat_messages.find_one(
        {"id": src_id},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    if not src:
        print("missing", src_id)
        continue
    if already_replied(src_id):
        print("already", src_id)
        continue
    post(text, reply_to=src)

paint("Schizophrenic", SILLY[4][0], SILLY[4][1])  # traffic cone if still painted is fine
if kick("Schizophrenic"):
    print("schizo kicked again")
print("tick3 done")
