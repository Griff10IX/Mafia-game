"""Verify Game Pass transfer to Snie."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

e = db.point_ledger_events.find_one({"origin_ref": "system_ai_zwischenzug_game_pass_transfer"})
print("ledger:", e)
if e:
    u = db.users.find_one(
        {"id": e["user_id"]},
        {
            "_id": 0,
            "username": 1,
            "rank_xp_pass_rewards_granted": 1,
            "rank_xp_pass_token_expires_at": 1,
            "rank_xp_pass_tokens": 1,
            "rank_xp_pass_last_granted_micro_tier": 1,
            "rank_xp_pass_season_rp": 1,
        },
    )
    print("user:", u)
