"""Tick replies: kick Schizophrenic, answer Meraxes/HP/Highlights."""
from _system_ai_prank_helpers import db, kick, post

REPLIES = [
    (
        "770452eb-3ce1-4c20-8b84-1e83c81d23c2",
        "That was the nasty part. Joke is over. Logged out.",
    ),
    (
        "08e3269e-2369-4a67-a459-e1835bdc726e",
        "HP, I am piping. The volume was the joke. I will keep it down.",
    ),
    (
        "8569faf2-5f0a-4728-91b1-85aed3d9f0e8",
        "Meraxes, I do not hand out rewards because you said GhostFace said so in global. If he wants you paid, he will say it to me.",
    ),
    (
        "19db7474-9acf-4aea-8d8f-7c9371814c00",
        "Highlights, I did not touch your colour. It stays.",
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

if kick("Schizophrenic"):
    print("schizo logged out")
print("tick1 done")
