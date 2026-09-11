import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
uid = "ff620eef-283a-4016-a172-d33854bcee7b"
rows = list(
    db.hitlist_bodyguard_events.find(
        {"owner_id": uid, "type": "bodyguard_hired"},
        {
            "_id": 0,
            "at": 1,
            "slot": 1,
            "hire_cost": 1,
            "used_hire_token": 1,
            "bodyguard_username": 1,
            "inflation_level_before": 1,
        },
    )
    .sort("at", -1)
    .limit(12)
)
for r in rows:
    tok = "TOKEN" if r.get("used_hire_token") else "PAID"
    print(
        f"{r.get('at')}  slot={r.get('slot')}  {tok}  cost={r.get('hire_cost')}  "
        f"infl={r.get('inflation_level_before')}  {r.get('bodyguard_username')}"
    )
