"""Reply to Boring bitch: checking the game, that's why I'm back. Start 10 min."""
from _system_ai_prank_helpers import GIRLY, db, kick, paint, post

src_id = "77bfc2fa-2fd2-4e22-b789-efccf16c9ac2"
src = db.game_chat_messages.find_one(
    {"id": src_id},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if not src:
    raise SystemExit("missing boring bitch")

post(
    "I was checking across the game. I saw this. Boring bitch. That is why I am back. "
    "Ten minutes. I am meaner. I defend Jake. You stay pink.",
    reply_to=src,
)
paint("Highlights", "#FF1493", "deep pink")
kick("Highlights")

# paint other recent non-staff chatters girly
recent = list(
    db.game_chat_messages.find(
        {"channel": "global"},
        {"_id": 0, "username": 1, "user_id": 1},
    ).sort([("_id", -1)]).limit(40)
)
seen = set()
idx = 0
for m in recent:
    name = (m.get("username") or "").strip()
    if not name or name.lower() in seen:
        continue
    seen.add(name.lower())
    if name.lower() in ("system ai", "ghostface", "highlights"):
        continue
    color, label = GIRLY[idx % (len(GIRLY) - 1)]  # skip girly-multi until UI is live
    if paint(name, color, label):
        idx += 1
print("10min started")
