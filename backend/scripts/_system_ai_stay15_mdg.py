"""Jake: MDG 5,000 points pot, $1 fee, auto-roll at 15. No System AI join."""
import uuid

from _system_ai_prank_helpers import db, post
from datetime import datetime, timezone

ORIGIN = "system_ai_stay_mdg_5k_1dollar_15"
SRC_ID = "08388c31-8716-44dd-a3e8-566cb0376c29"

existing = db.mdg_games.find_one(
    {"origin_ref": ORIGIN, "status": "open"},
    {"_id": 0, "id": 1},
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
            "fee_points": 0,
            "fee_money": 1.0,
            "max_players": 15,
            "auto_roll_at": 15,
            "extra_pot_points": 5000,
            "extra_pot_money": 0.0,
            "entries": [],
            "pot_points": 5000,
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

src = db.game_chat_messages.find_one(
    {"id": SRC_ID},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
post(
    "MDG is up. $1 to join, 5,000 points in the pot. Rolls at 15. Casinos → MDG. I'll be watching who wins.",
    reply_to=src,
)
print("game_id", game_id)
