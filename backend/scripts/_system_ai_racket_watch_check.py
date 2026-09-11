"""Poll for new Schizophrenic chat lines after racket ask. Print NONE or REPLY lines."""
import json
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

STATE = "/tmp/sai_racket_watch.json"
if not os.path.exists(STATE):
    print("NO_STATE", flush=True)
    raise SystemExit(1)

with open(STATE, encoding="utf-8") as f:
    state = json.load(f)

if state.get("done"):
    print("DONE", flush=True)
    raise SystemExit(0)

uid = state["watch_user_id"]
since = state["since"]
seen = set(state.get("seen_ids") or [])

rows = list(
    db.game_chat_messages.find(
        {
            "channel": "global",
            "user_id": uid,
            "created_at": {"$gt": since},
        },
        {"_id": 0, "id": 1, "username": 1, "message": 1, "created_at": 1, "reply_to": 1},
    )
    .sort("created_at", 1)
    .limit(20)
)
new = [r for r in rows if r.get("id") not in seen]
if not new:
    print("NONE", flush=True)
    raise SystemExit(0)

for r in new:
    seen.add(r["id"])
    msg = (r.get("message") or "").replace("\n", " ")
    print(f"REPLY|{r.get('created_at')}|{r.get('username')}|{msg}", flush=True)

state["seen_ids"] = list(seen)
# keep since as original ask time so we don't miss anything; seen_ids dedupes
with open(STATE, "w", encoding="utf-8") as f:
    json.dump(state, f)
