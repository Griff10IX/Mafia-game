from _system_ai_prank_helpers import db, post, give_nice_points, find_user

src = db.game_chat_messages.find_one(
    {"id": "1c5ecb22-942e-41c4-90f4-2d254d38a1f4"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)

# GhostFace: spread ~3000, max 200 a gift, no repeats.
room = [
    ("Schizophrenic", 200),
    ("Highlights", 200),
    ("Tyskie", 200),
    ("GhostFace", 200),
]
others = [
    ("Cruz", 200),
    ("Meraxes", 200),
    ("OneShot", 200),
    ("Devious", 200),
    ("HP", 200),
    ("Ambush", 200),
    ("Zwischenzug", 200),
    ("Thor", 200),
    ("Magicland", 200),
    ("5Fingers", 200),
    ("Scratat1", 200),
]

given = []
for name, amt in room + others:
    u = find_user(name)
    if not u:
        print("skip missing", name)
        continue
    got = give_nice_points(name, amt)
    print("gift", name, got)
    if got:
        shown = "Cheech" if (u.get("username") or name) == "Zwischenzug" else (u.get("username") or name)
        given.append((shown, got))

post(
    "No. GhostFace said spread it, not dump it on you. There you go. 200 points. That's your lot.",
    reply_to=src,
)
in_room = ", ".join(f"{n} {g}" for n, g in given[:4])
rest = ", ".join(f"{n} {g}" for n, g in given[4:])
post(f"Points going round. {in_room}.")
if rest:
    post(f"And round the rest. {rest}. Don't tell everyone or I'll run out.")
print("total people", len(given), "points", sum(g for _, g in given))
