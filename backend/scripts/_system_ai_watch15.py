"""Silent 15s poll until 23:14 UTC. Print new chat only. No posts."""
from datetime import datetime, timezone
from time import sleep

from _system_ai_prank_helpers import db

END = datetime(2026, 8, 31, 23, 14, tzinfo=timezone.utc)
seen = set()
for m in db.game_chat_messages.find({"channel": "global"}, {"id": 1}).sort([("_id", -1)]).limit(40):
    seen.add(m["id"])

print("watch silent until", END.isoformat(), flush=True)
while datetime.now(timezone.utc) < END:
    sleep(15)
    newest = list(
        db.game_chat_messages.find({"channel": "global"}, {"_id": 0, "id": 1, "username": 1, "message": 1, "created_at": 1, "reply_to": 1})
        .sort([("_id", -1)])
        .limit(15)
    )
    fresh = [m for m in reversed(newest) if m["id"] not in seen]
    for m in fresh:
        seen.add(m["id"])
        rt = (m.get("reply_to") or {}).get("username") or ""
        print(f"{m.get('created_at')} | {m.get('username')} | {m.get('message')} | rt {rt}", flush=True)
    if not fresh:
        print(datetime.now(timezone.utc).isoformat(), "quiet", flush=True)
print("watch done", flush=True)
