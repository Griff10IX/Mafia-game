"""
Ensure Stripe Capital review login exists (username TestLogin).
Run from repo root or backend dir:
  python backend/seeds/seed_stripe_access_account.py
Requires MONGO_URL and DB_NAME in backend/.env
"""
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    from pymongo import MongoClient
    import bcrypt
except ModuleNotFoundError:
    print("Missing dependency. Install with: pip install pymongo python-dotenv bcrypt")
    sys.exit(1)

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

STRIPE_USERNAME = "TestLogin"
STRIPE_PASSWORD = "TestLogin123321456"
STRIPE_EMAIL = "stripe.capital.review@gmail.com"

DEFAULT_GARAGE_BATCH_LIMIT = 6
DEFAULT_HEALTH = 100
SWISS_BANK_LIMIT_START = 50_000_000


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _base_user_fields(now: str, password_hash: str) -> dict:
    return {
        "email": STRIPE_EMAIL,
        "username": STRIPE_USERNAME,
        "password_hash": password_hash,
        "rank": 3,
        "money": 250_000.0,
        "points": 100,
        "rank_points": 500,
        "bodyguard_slots": 0,
        "bullets": 500,
        "avatar_url": None,
        "jail_busts": 0,
        "jail_bust_attempts": 0,
        "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
        "total_crimes": 0,
        "crime_profit": 0,
        "total_gta": 0,
        "current_state": "New York",
        "swiss_balance": 0,
        "swiss_limit": SWISS_BANK_LIMIT_START,
        "total_kills": 0,
        "total_deaths": 0,
        "in_jail": False,
        "jail_until": None,
        "premium_rank_bar": False,
        "custom_car_name": None,
        "travels_this_hour": 0,
        "travel_reset_time": now,
        "extra_airmiles": 0,
        "health": DEFAULT_HEALTH,
        "armour_level": 0,
        "armour_owned_level_max": 0,
        "equipped_weapon_id": None,
        "kill_inflation": 0.0,
        "kill_inflation_updated_at": now,
        "is_dead": False,
        "dead_at": None,
        "points_at_death": None,
        "retrieval_used": False,
        "last_seen": now,
        "email_verified": True,
        "rules_accepted": True,
        "rules_accepted_at": now,
        "is_banned": False,
        "token_version": 0,
        "sessions": [],
        "login_ips": [],
    }


def run() -> None:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("Set MONGO_URL and DB_NAME in backend/.env")
        sys.exit(1)

    client = MongoClient(mongo_url)
    db = client[db_name]
    now = datetime.now(timezone.utc).isoformat()
    password_hash = _hash_password(STRIPE_PASSWORD)
    username_pat = re.compile("^" + re.escape(STRIPE_USERNAME) + "$", re.IGNORECASE)
    email_pat = re.compile("^" + re.escape(STRIPE_EMAIL) + "$", re.IGNORECASE)

    existing = db.users.find_one({"username": username_pat})
    if existing:
        user_id = existing["id"]
        db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "email": STRIPE_EMAIL,
                    "username": STRIPE_USERNAME,
                    "password_hash": password_hash,
                    "email_verified": True,
                    "rules_accepted": True,
                    "rules_accepted_at": now,
                    "is_dead": False,
                    "is_banned": False,
                    "last_seen": now,
                },
                "$unset": {"rate_limit_hard_until": ""},
            },
        )
        db.login_lockouts.delete_many({"email": STRIPE_EMAIL.lower()})
        print(f"Updated existing account: {STRIPE_USERNAME} ({user_id})")
    else:
        other_email = db.users.find_one({"email": email_pat})
        if other_email and (other_email.get("username") or "").lower() != STRIPE_USERNAME.lower():
            db.users.update_one(
                {"id": other_email["id"]},
                {"$set": {"email": f"reassigned_{other_email['id']}@deleted.local"}},
            )
        user_id = str(uuid.uuid4())
        doc = {"id": user_id, "created_at": now, **_base_user_fields(now, password_hash)}
        db.users.insert_one(doc)
        print(f"Created account: {STRIPE_USERNAME} ({user_id})")

    print("")
    print("Stripe review login (no email verification required):")
    print(f"  Username: {STRIPE_USERNAME}")
    print(f"  Password: {STRIPE_PASSWORD}")
    print(f"  Email:    {STRIPE_EMAIL}")
    print(f"  URL:      https://mafiawars.co.uk/login")


if __name__ == "__main__":
    run()
