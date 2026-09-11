"""Add Zwischenzug to attack turnstile target list - requires CAPTCHA for attacks."""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Get current config
cfg = db.config.find_one({"_id": "main"}) or {}
print("Current attack turnstile config:")
print("  enabled:", cfg.get("attack_turnstile_enabled"))
print("  enforce:", cfg.get("attack_turnstile_enforce"))
print("  mode:", cfg.get("attack_turnstile_mode"))
print("  target_usernames:", cfg.get("attack_turnstile_target_usernames"))

# Add Zwischenzug to target list
current_targets = cfg.get("attack_turnstile_target_usernames") or []
if "Zwischenzug" not in current_targets and "zwischenzug" not in [t.lower() for t in current_targets]:
    new_targets = current_targets + ["Zwischenzug"]
    db.config.update_one(
        {"_id": "main"},
        {
            "$set": {
                "attack_turnstile_enabled": True,
                "attack_turnstile_enforce": "enforce",
                "attack_turnstile_mode": "execute_only",
                "attack_turnstile_target_usernames": new_targets,
            }
        },
        upsert=True,
    )
    print(f"\nAdded Zwischenzug to target list: {new_targets}")
    print("Attack CAPTCHA now REQUIRED for Zwischenzug's execute actions!")
else:
    print("\nZwischenzug already in target list")

# Verify
cfg2 = db.config.find_one({"_id": "main"}) or {}
print("\nUpdated config:")
print("  enabled:", cfg2.get("attack_turnstile_enabled"))
print("  enforce:", cfg2.get("attack_turnstile_enforce"))
print("  mode:", cfg2.get("attack_turnstile_mode"))
print("  target_usernames:", cfg2.get("attack_turnstile_target_usernames"))
