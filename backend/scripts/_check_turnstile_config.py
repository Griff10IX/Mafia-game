"""Check full turnstile config."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

cfg = db.config.find_one({"_id": "main"}) or {}
print("minigame_turnstile_site_key:", repr(cfg.get("minigame_turnstile_site_key")))
print("TURNSTILE_SECRET_KEY set:", bool(os.environ.get("TURNSTILE_SECRET_KEY")))
print("attack_turnstile_enabled:", cfg.get("attack_turnstile_enabled"))
print("attack_turnstile_enforce:", cfg.get("attack_turnstile_enforce"))
print("attack_turnstile_mode:", cfg.get("attack_turnstile_mode"))
print("attack_turnstile_target_usernames:", cfg.get("attack_turnstile_target_usernames"))

# Check the gate logic
from utils.attack_turnstile_gate import attack_turnstile_config
import asyncio

async def check():
    user = {"id": "test", "username": "Zwischenzug"}
    result = await attack_turnstile_config(db, current_user=user)
    print("\nattack_turnstile_config for Zwischenzug:")
    for k, v in result.items():
        print(f"  {k}: {v}")

asyncio.run(check())
