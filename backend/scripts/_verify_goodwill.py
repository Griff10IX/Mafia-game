"""Spot-check the Cloudflare goodwill grant landed on wallets, inboxes and chat."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ORIGIN = "system_ai_cloudflare_goodwill_2026_09_03"
TITLE = "Cloudflare issue - resolved"

evs = list(db.point_ledger_events.find({"origin_ref": ORIGIN}, {"_id": 0, "user_id": 1}))
print("ledger events:", len(evs))
print("inbox cards:", db.notifications.count_documents({"title": TITLE, "system_ai": True}))
print("chat posts:", db.game_chat_messages.count_documents({"user_id": "system_ai", "channel": "global"}))

print("\nwallet sample:")
for e in evs[:6]:
    u = db.users.find_one(
        {"id": e["user_id"]},
        {"_id": 0, "username": 1, "points": 1, "loot_box_pieces": 1, "wheel_bonus_free_spins": 1},
    )
    print(f"  {str((u or {}).get('username')):16s} points={(u or {}).get('points')} "
          f"loot={(u or {}).get('loot_box_pieces')} spins={(u or {}).get('wheel_bonus_free_spins')}")

msg = db.game_chat_messages.find_one({"user_id": "system_ai", "channel": "global"}, {"_id": 0}, sort=[("created_at", -1)])
print("\nlatest system_ai chat post:")
print(" ", (msg or {}).get("created_at"), "|", ((msg or {}).get("message") or "")[:120])
