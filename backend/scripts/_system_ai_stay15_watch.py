"""Print only NEW game-chat rows every 5s. Refresh chat-only insult names. No posts."""
import time
from datetime import datetime, timedelta, timezone

from _system_ai_prank_helpers import db, refresh_chat_names

END = datetime.now(timezone.utc) + timedelta(minutes=15)
seen = set()
for m in db.game_chat_messages.find({"channel": "global"}, {"id": 1}).sort("created_at", -1).limit(80):
    seen.add(m["id"])
print("watch start", datetime.now(timezone.utc).isoformat(), "until", END.isoformat(), flush=True)

while datetime.now(timezone.utc) < END:
    refresh_chat_names(quiet=True)
    rows = list(
        db.game_chat_messages.find({"channel": "global"}, {"_id": 0})
        .sort("created_at", -1)
        .limit(25)
    )
    fresh = [m for m in reversed(rows) if m.get("id") not in seen]
    for m in fresh:
        seen.add(m["id"])
        uid = (m.get("user_id") or "")[:8]
        un = m.get("username") or "?"
        msg = (m.get("message") or "").replace("\n", " ")[:220]
        rt = (m.get("reply_to") or {}).get("username") or ""
        print(
            f"{m.get('created_at')} | {un} [{uid}] | {msg} | rt {rt} | {m.get('id')}",
            flush=True,
        )
    time.sleep(5)
print("watch end", datetime.now(timezone.utc).isoformat(), flush=True)
