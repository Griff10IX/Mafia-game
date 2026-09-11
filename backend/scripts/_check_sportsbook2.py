from dotenv import load_dotenv
import os
from pymongo import MongoClient
load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
print("collections sports-related:")
for c in sorted(db.list_collection_names()):
    if "sport" in c.lower() or "odds" in c.lower() or "template" in c.lower():
        print(" ", c, db[c].count_documents({}))
print("THE_ODDS_API_KEY set?", bool((os.environ.get("THE_ODDS_API_KEY") or "").strip()))
# check .env
for line in open("/opt/mafia-app/backend/.env"):
    if "ODDS" in line.upper() or "SPORT" in line.upper():
        k=line.split("=",1)[0]
        print("env", k, "len", len(line.split("=",1)[1].strip()) if "=" in line else 0)
