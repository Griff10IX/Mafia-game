"""GhostFace: MDG 5,000 points, max 10 players. No auto-join, no charge to GhostFace."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ORIGIN = "system_ai_gf_mdg_5k_10"
FEE = 5000
MAX_P = 10
SRC_ID = "d7e8c479-b1ab-49c1-8a38-dcabf9e72455"
AVATAR = "/images/system-ai-avatar.png"

existing = db.mdg_games.find_one(
    {"origin_ref": ORIGIN, "status": "open"},
    {"_id": 0, "id": 1, "fee_points": 1, "max_players": 1},
)
if existing:
    game_id = existing["id"]
    print("already_game", game_id)
else:
    now = datetime.now(timezone.utc)
    game_id = str(uuid.uuid4())
    db.mdg_games.insert_one(
        {
            "id": game_id,
            "created_by": "system_ai",
            "created_by_username": "System AI",
            "created_at": now.isoformat(),
            "fee_points": FEE,
            "fee_money": 0.0,
            "max_players": MAX_P,
            "auto_roll_at": MAX_P,
            "extra_pot_points": 0,
            "extra_pot_money": 0.0,
            "entries": [],
            "pot_points": 0,
            "pot_money": 0.0,
            "status": "open",
            "winner_id": None,
            "winner_username": None,
            "rolled_at": None,
            "entertainer_funded": False,
            "admin_prizes": [],
            "staff_cannot_win": True,
            "system_ai": True,
            "origin_ref": ORIGIN,
        }
    )
    print("created", game_id)

TEXT = (
    "MDG is up, GhostFace. 5,000 points to join, max 10 players. "
    "It rolls when it fills. Casinos → MDG."
)
src = db.game_chat_messages.find_one({"id": SRC_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if src and not db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": SRC_ID}, {"_id": 1}):
    now = datetime.now(timezone.utc)
    db.game_chat_messages.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": "system_ai",
            "username": "System AI",
            "message": TEXT,
            "family_id": None,
            "channel": "global",
            "created_at": now.isoformat(),
            "expires_at": now + timedelta(days=7),
            "sender_is_staff": True,
            "system_ai": True,
            "avatar_url": AVATAR,
            "author_online_color": "#FBBF24",
            "viewed_by": [],
            "reply_to": {
                "id": src["id"],
                "username": src.get("username") or "?",
                "message": (src.get("message") or "")[:180],
                "has_gif": bool(src.get("gif_url")),
            },
        }
    )
    print("chat posted")
else:
    print("chat skip")
print("done")
