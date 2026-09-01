"""Dump last 3 hours of game chat for stay hits."""
from datetime import datetime, timedelta, timezone
from _system_ai_prank_helpers import db

since = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
rows = list(
    db.game_chat_messages.find(
        {"channel": "global", "created_at": {"$gte": since}},
        {"_id": 0, "id": 1, "user_id": 1, "username": 1, "message": 1, "reply_to": 1, "created_at": 1},
    ).sort("created_at", -1)
)
print("count", len(rows), "since", since)
for m in rows:
    uid = (m.get("user_id") or "")[:8]
    un = m.get("username") or "?"
    msg = (m.get("message") or "").replace("\n", " ")[:180]
    rt = (m.get("reply_to") or {}).get("username") or ""
    print(f"{m.get('created_at')} | {un} [{uid}] | {msg} | rt {rt} | {m.get('id')}")
