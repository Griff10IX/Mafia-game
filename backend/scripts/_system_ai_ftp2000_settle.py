"""Credit FTP2000 winner, nice reply, restore + nice sign-off."""
import json
import os
import sys
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

sys.path.insert(0, "/opt/mafia-app/backend/scripts")
from _system_ai_prank_helpers import post, restore_stay, stay_signoff

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

STATE = "/tmp/sai_ftp2000_state.json"
AVATAR = "/images/system-ai-profile.jpg?v=5"

with open(STATE, encoding="utf-8") as f:
    state = json.load(f)

if state.get("done"):
    print("already done", state.get("winner_username"), flush=True)
    raise SystemExit(0)

# Re-find winner
since = state["since"]
announce_id = state["announce_id"]
POINTS = int(state.get("points") or 2000)

rows = list(
    db.game_chat_messages.find(
        {
            "channel": "global",
            "created_at": {"$gt": since},
            "user_id": {"$nin": ["system_ai", ""]},
        },
        {
            "_id": 0,
            "id": 1,
            "user_id": 1,
            "username": 1,
            "message": 1,
            "gif_url": 1,
            "created_at": 1,
        },
    )
    .sort("created_at", 1)
    .limit(12)
)
rows = [
    m
    for m in rows
    if (m.get("user_id") or "") != "system_ai"
    and (m.get("username") or "").strip().lower() != "system ai"
    and (m.get("id") or "") != announce_id
]
if not rows:
    print("NO_WINNER", flush=True)
    raise SystemExit(2)

winner = rows[0]
uid = winner["user_id"]
uname = winner.get("username") or "?"
now_iso = datetime.now(timezone.utc).isoformat()

before = db.users.find_one_and_update(
    {"id": uid},
    {"$inc": {"points": POINTS}},
    projection={"_id": 0, "points": 1},
    return_document=ReturnDocument.BEFORE,
)
pts_before = int((before or {}).get("points") or 0)
pts_after = pts_before + POINTS

db.point_ledger_events.insert_one(
    {
        "id": str(uuid.uuid4()),
        "event_type": "system_ai_chat_first_to_post",
        "user_id": uid,
        "points": POINTS,
        "lot_id": None,
        "origin_ref": f"system_ai_chat_ftp2000:{announce_id}",
        "root_purchase_ref": None,
        "meta": {"announce_id": announce_id, "chat_id": winner.get("id"), "mode": "nice"},
        "created_at": now_iso,
        "wallet_points_before": pts_before,
        "wallet_points_after": pts_after,
        "source": "system_ai",
    }
)

db.notifications.insert_one(
    {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "title": "Next to post",
        "message": (
            f"{uname},\n\n"
            "This is the system AI. You were next to post in game chat.\n\n"
            f"{POINTS:,} points are already on your account.\n\n"
            "— System AI"
        ),
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)

post(
    f"{uname} — you were next. {POINTS:,} points are on your account. Nice one.",
    winner,
)

restore_stay()
post(stay_signoff("nice"))

state["done"] = True
state["winner_username"] = uname
state["winner_user_id"] = uid
state["winner_chat_id"] = winner.get("id")
with open(STATE, "w", encoding="utf-8") as f:
    json.dump(state, f)

print("SETTLED", uname, pts_before, "->", pts_after, flush=True)
