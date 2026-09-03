from _system_ai_prank_helpers import db

staffish = []
seen = []
for m in db.game_chat_messages.find(
    {"channel": "global"},
    {"_id": 0, "user_id": 1, "username": 1},
).sort([("_id", -1)]).limit(40):
    uid = m.get("user_id")
    if uid in ("system_ai", "36425cb4-3755-4669-b4b5-5d86345991d0"):
        continue
    if uid in seen:
        continue
    seen.append(uid)
    print(m.get("username"), uid)
