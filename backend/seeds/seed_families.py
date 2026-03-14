"""
Seed script: creates 3 families with 5 members each (15 test users).
Run from backend dir: python seed_families.py
All test users have password: test1234
"""
import os
import sys
import uuid
from pathlib import Path
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    from pymongo import MongoClient
    import bcrypt
except ModuleNotFoundError as e:
    print("Missing dependency. Install with:")
    print("  pip install pymongo python-dotenv bcrypt")
    sys.exit(1)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

FAMILY_RACKETS = [
    {"id": "protection", "name": "Protection Racket", "cooldown_hours": 6, "base_income": 5000, "description": "Extortion from businesses"},
    {"id": "gambling", "name": "Gambling Operation", "cooldown_hours": 12, "base_income": 8000, "description": "Numbers & bookmaking"},
    {"id": "loansharking", "name": "Loan Sharking", "cooldown_hours": 24, "base_income": 12000, "description": "High-interest loans"},
    {"id": "labour", "name": "Labour Racketeering", "cooldown_hours": 8, "base_income": 6000, "description": "Union kickbacks"},
]

FAMILIES_CONFIG = [
    {"name": "Corleone", "tag": "CORL", "members": ["boss", "underboss", "consigliere", "capo", "soldier"]},
    {"name": "Baranco", "tag": "BARN", "members": ["boss", "underboss", "consigliere", "capo", "soldier"]},
    {"name": "Stracci", "tag": "STRC", "members": ["boss", "underboss", "consigliere", "capo", "soldier"]},
]

DEFAULT_HEALTH = 100
DEFAULT_GARAGE_BATCH_LIMIT = 6
TEST_PASSWORD = "test1234"


def make_user_doc(user_id: str, username: str, email: str, password_hash: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": user_id,
        "email": email,
        "username": username,
        "password_hash": password_hash,
        "rank": 1,
        "money": 1000.0,
        "points": 0,
        "rank_points": 0,
        "bodyguard_slots": 0,
        "bullets": 0,
        "avatar_url": None,
        "jail_busts": 0,
        "jail_bust_attempts": 0,
        "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
        "total_crimes": 0,
        "crime_profit": 0,
        "total_gta": 0,
        "current_state": "Chicago",
        "swiss_balance": 0,
        "swiss_limit": 50_000_000,
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
        "created_at": now,
    }


def run():
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("Set MONGO_URL and DB_NAME in .env")
        return

    client = MongoClient(mongo_url)
    db = client[db_name]

    password_hash = bcrypt.hashpw(TEST_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    created_users = []
    created_families = []

    for fam_cfg in FAMILIES_CONFIG:
        name, tag = fam_cfg["name"], fam_cfg["tag"]
        family_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        user_ids = []
        for i, role in enumerate(fam_cfg["members"]):
            user_id = str(uuid.uuid4())
            base = f"{tag.lower()}_{role}"
            username = f"{base}_{i}"
            email = f"{base}{i}@test.mafia"
            user_doc = make_user_doc(user_id, username, email, password_hash)
            db.users.insert_one(user_doc)
            created_users.append({"id": user_id, "username": username, "email": email, "role": role, "family": name})
            user_ids.append((user_id, role))

        boss_id = user_ids[0][0]

        db.families.insert_one({
            "id": family_id,
            "name": name,
            "tag": tag,
            "boss_id": boss_id,
            "treasury": 0,
            "created_at": now,
            "rackets": {r["id"]: {"level": 0, "last_collected_at": None} for r in FAMILY_RACKETS},
        })
        created_families.append({"id": family_id, "name": name, "tag": tag})

        for user_id, role in user_ids:
            db.family_members.insert_one({
                "id": str(uuid.uuid4()),
                "family_id": family_id,
                "user_id": user_id,
                "role": role,
                "joined_at": now,
            })
            db.users.update_one(
                {"id": user_id},
                {"$set": {"family_id": family_id, "family_role": role}},
            )

    print("Created 3 families with 5 members each.")
    print("\nTest users (password for all: test1234):")
    for u in created_users:
        print(f"  {u['email']}  |  {u['username']}  |  {u['family']} {u['role']}")
    print("\nFamilies:", [f"{f['name']} [{f['tag']}]" for f in created_families])


if __name__ == "__main__":
    run()
