"""Remove 5545 bot trap and print last stats."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
uid = "07779847-3955-49b9-8a34-0eb21bc44651"
t = db.bot_traps.find_one({"user_id": uid})
if t:
    print(f"before failures={t.get('failures')} successes={t.get('successes')} field={t.get('challenge_field')}")
else:
    print("before: no trap")
r = db.bot_traps.delete_one({"user_id": uid})
print(f"trap_deleted={r.deleted_count}")
