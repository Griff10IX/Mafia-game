from _system_ai_prank_helpers import db

rows = list(
    db.game_chat_messages.find(
        {"channel": "global"},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "created_at": 1, "reply_to": 1},
    )
    .sort("created_at", -1)
    .limit(20)
)
for m in reversed(rows):
    rt = (m.get("reply_to") or {}).get("username") or ""
    msg = (m.get("message") or "").replace("\n", " ")[:220]
    print(f"{m.get('created_at')} | {m.get('username')} | {msg} | rt {rt} | {m.get('id')}")
