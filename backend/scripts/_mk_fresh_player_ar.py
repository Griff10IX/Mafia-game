"""Create a normal-looking fresh player with Auto Rank (rank+booze on) and 4 robot BGs.
Looks like a standard registration — no staff flags / staff_topup markers.
"""
from __future__ import annotations

import asyncio
import os
import random
import secrets
import string
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path("/opt/mafia-app/backend")
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv

load_dotenv(str(BACKEND_DIR / ".env"))

FIRST = [
    "Rico", "Nico", "Vince", "Marco", "Dante", "Luca", "Enzo", "Sal", "Tony", "Frankie",
    "Carlo", "Rocco", "Vito", "Angelo", "Sonny", "Mickey", "Joey", "Pauly", "Dom", "Gino",
]
LAST = [
    "Moretti", "Romano", "Bianchi", "Esposito", "Conti", "Greco", "Russo", "Ferrari",
    "Lombardi", "Marino", "Costa", "Ricci", "Gallo", "Bruno", "DeLuca", "Vitale",
]


def _rand_username() -> str:
    base = random.choice(FIRST) + random.choice(LAST)
    if random.random() < 0.55:
        base += str(random.randint(10, 99))
    return base[:20]


def _rand_email(username: str) -> str:
    domains = ["gmail.com", "icloud.com", "outlook.com", "yahoo.com", "proton.me"]
    local = username.lower() + str(random.randint(100, 9999))
    local = "".join(c for c in local if c.isalnum() or c in "._")[:28]
    return f"{local}@{random.choice(domains)}"


def _rand_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "Mw!" + "".join(secrets.choice(alphabet) for _ in range(12))


async def main():
    from server import db, get_password_hash, DEFAULT_HEALTH, DEFAULT_GARAGE_BATCH_LIMIT, SWISS_BANK_LIMIT_START
    from utils.default_player_avatar import default_player_avatar_url
    from routers.kill.bodyguards import _create_robot_bodyguard_user, _invalidate_bodyguards_cache

    # unique username/email
    username = None
    email = None
    for _ in range(40):
        cand = _rand_username()
        exists = await db.users.find_one(
            {"username": {"$regex": f"^{cand}$", "$options": "i"}},
            {"_id": 1},
        )
        if not exists:
            username = cand
            break
    if not username:
        username = "Player" + secrets.token_hex(3)
    for _ in range(40):
        cand = _rand_email(username)
        exists = await db.users.find_one({"email": cand.lower()}, {"_id": 1})
        if not exists:
            email = cand.lower()
            break
    if not email:
        email = f"{secrets.token_hex(6)}@gmail.com"

    password = _rand_password()
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    # Soft Canada-looking IP (Bell/Rogers-ish) — override via FRESH_PLAYER_IP_REGION=us|ca|uk
    region = (os.environ.get("FRESH_PLAYER_IP_REGION") or "ca").strip().lower()
    if region == "us":
        reg_ip = f"73.162.{random.randint(10, 240)}.{random.randint(10, 250)}"
        country_code = "US"
        country_name = "United States"
        region_name, city = "California", "Los Angeles"
        isp = org = "Comcast Cable Communications, LLC"
        as_field, asname = "AS7922 Comcast Cable Communications, LLC", "COMCAST-7922"
    elif region == "uk":
        reg_ip = f"82.132.{random.randint(200, 245)}.{random.randint(10, 250)}"
        country_code = "GB"
        country_name = "United Kingdom"
        region_name, city = "England", "London"
        isp = org = "EE Limited"
        as_field, asname = "AS12576 EE Limited", "EE Limited"
    else:
        reg_ip = f"99.232.{random.randint(10, 240)}.{random.randint(10, 250)}"
        country_code = "CA"
        country_name = "Canada"
        region_name, city = "Ontario", "Toronto"
        isp = org = "Rogers Communications Canada Inc."
        as_field, asname = "AS812 Rogers Communications Canada Inc.", "ROGERS-COMMUNICATIONS"

    theme = {
        "colourId": "sky",
        "buttonColourId": "sky",
        "textureId": "modern-soft",
        "themeVariant": "modern",
        "sidebarLayout": "categorized_classic",
        "mobileNavStyle": "bottom",
        "mobileStatsDisplay": "right_sidebar",
        "fontId": "clean",
    }

    user_doc = {
        "id": user_id,
        "email": email,
        "username": username,
        "password_hash": get_password_hash(password),
        "rank": 1,
        "money": 1000.0,
        "points": 0,
        "rank_points": 0,
        "bodyguard_slots": 4,
        "bullets": 0,
        "avatar_url": default_player_avatar_url(user_id),
        "jail_busts": 0,
        "jail_bust_attempts": 0,
        "jail_busts_npc": 0,
        "snitch_count": 0,
        "cars_melted": 0,
        "cars_purchased_from_dealership": 0,
        "cars_purchased_dealership_uncommon": 0,
        "cars_purchased_dealership_rare": 0,
        "cars_purchased_dealership_ultra_rare": 0,
        "cars_purchased_dealership_legendary": 0,
        "bullets_purchased_from_armoury": 0,
        "uncommon_cars_scrapped": 0,
        "uncommon_cars_stolen": 0,
        "total_interest_deposited": 0,
        "tribute_bullets": 0,
        "tribute_loot_box_pieces": 0,
        "loot_box_pieces": 0,
        "property_portfolio_kill_income_boost_percent": 0,
        "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
        "total_crimes": 0,
        "crime_profit": 0,
        "total_gta": 0,
        "total_oc_heists": 0,
        "oc_timer_reduced": False,
        "current_state": "Chicago",
        "swiss_balance": 0,
        "swiss_limit": SWISS_BANK_LIMIT_START,
        "total_kills": 0,
        "total_kills_excludes_npc_v1": True,
        "total_deaths": 0,
        "in_jail": False,
        "jail_until": None,
        "premium_rank_bar": False,
        "has_silencer": False,
        "custom_car_name": None,
        "travels_this_hour": 0,
        "travel_reset_time": now_iso,
        "extra_airmiles": 0,
        "health": DEFAULT_HEALTH,
        "armour_level": 0,
        "armour_owned_level_max": 0,
        "equipped_weapon_id": None,
        "kill_inflation": 0.0,
        "kill_inflation_updated_at": now_iso,
        "is_dead": False,
        "dead_at": None,
        "points_at_death": None,
        "retrieval_used": False,
        "last_seen": now_iso,
        "created_at": now_iso,
        "registration_ip": reg_ip,
        "registration_ip_reputation": {
            "verdict": "ok",
            "country_code": country_code,
            "isp": isp,
            "org": org,
            "proxy": False,
            "hosting": False,
            "mobile": False,
        },
        "login_ips": [reg_ip],
        "login_history": [
            {
                "at": now_iso,
                "ip": reg_ip,
                "device_type": "desktop",
                "ua_short": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0",
                "source": "register",
            }
        ],
        "last_request_ip": reg_ip,
        "last_login_ip": reg_ip,
        "last_seen_country": country_code,
        "last_login_ip_reputation": {
            "verdict": "ok",
            "country_code": country_code,
            "isp": isp,
            "org": org,
            "proxy": False,
            "hosting": False,
            "mobile": False,
        },
        "email_verified": True,
        "rules_accepted": False,
        "rules_accepted_at": None,
        "tutorial_status": "pending",
        "tutorial_step": None,
        "tutorial_crime_done": False,
        "tutorial_gta_done": False,
        "tutorial_theme_done": False,
        "tutorial_rewards_granted": False,
        "tutorial_ineligible_reason": None,
        "loot_box_free_rare_opens": 0,
        "loot_box_free_ultra_opens": 0,
        "rank_xp_pass_tokens": 0,
        "rank_xp_pass_bonus_until": None,
        "rank_xp_pass_token_expires_at": None,
        "rank_xp_pass_tier_snapshot": None,
        "rank_xp_pass_pending_tier_snapshot": None,
        "rank_xp_pass_last_granted_micro_tier": 0,
        "game_pass_season_id": None,
        "rank_xp_pass_season_rp": 0,
        "rank_xp_pass_rewards_granted": False,
        # Auto Rank — looks purchased, all main rank + booze toggles on
        "auto_rank_purchased": True,
        "auto_rank_permanent": True,
        "auto_rank_trial": False,
        "auto_rank_enabled": True,
        "auto_rank_crimes": True,
        "auto_rank_gta": True,
        "auto_rank_bust_every_5_sec": True,
        "auto_rank_oc": True,
        "auto_rank_booze": True,
        "auto_rank_melt": False,
        "auto_rank_scrap": False,
        "auto_rank_telegram_notify": True,
        "auto_rank_use_skip_tokens": False,
        "mission_completions": [],
        "unlocked_maps_up_to": "Chicago",
        "theme_preferences": dict(theme),
        "theme_preferences_pc": dict(theme),
        "is_admin": False,
        "is_moderator": False,
        "is_npc": False,
        "is_bodyguard": False,
    }

    await db.users.insert_one(user_doc)

    await db.ip_geodata_cache.update_one(
        {"ip": reg_ip},
        {
            "$set": {
                "ip": reg_ip,
                "fetched_at": now_iso,
                "ok": True,
                "from_cache": True,
                "country": country_name,
                "countryCode": country_code,
                "regionName": region_name,
                "city": city,
                "isp": isp,
                "org": org,
                "as_field": as_field,
                "asname": asname,
                "mobile": False,
                "proxy": False,
                "hosting": False,
            }
        },
        upsert=True,
    )

    # 4 robot bodyguards — normal hire shape, slot costs like a real buy
    slot_costs = {1: 75, 2: 150, 3: 300, 4: 450}
    guards = []
    for slot in range(1, 5):
        robot_user_id, robot_name, robot_state = await _create_robot_bodyguard_user(user_doc)
        cost = slot_costs[slot]
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "owner_username": username,
            "slot_number": slot,
            "is_robot": True,
            "robot_name": robot_name,
            "bodyguard_user_id": robot_user_id,
            "health": 100,
            "armour_level": 0,
            "hired_at": now_iso,
            "hire_cost": cost,
            "hired_with_token": False,
        }
        await db.bodyguards.insert_one(doc)
        await db.hitlist_bodyguard_events.insert_one(
            {
                "at": now,
                "type": "bodyguard_hired",
                "owner_id": user_id,
                "owner_username": username,
                "slot": slot,
                "is_robot": True,
                "hire_cost": cost,
                "listed_cost": cost,
                "used_hire_token": False,
                "bodyguard_username": robot_name,
                "guard_user_id": robot_user_id,
                "bodyguard_slot_row_id": doc["id"],
                "inflation_level_before": 0,
                "robot_initial_state": robot_state,
            }
        )
        guards.append({"slot": slot, "name": robot_name, "cost": cost})

    _invalidate_bodyguards_cache(user_id)

    # Verify
    check = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "username": 1,
            "email": 1,
            "auto_rank_enabled": 1,
            "auto_rank_permanent": 1,
            "auto_rank_crimes": 1,
            "auto_rank_gta": 1,
            "auto_rank_booze": 1,
            "auto_rank_oc": 1,
            "auto_rank_bust_every_5_sec": 1,
            "bodyguard_slots": 1,
            "is_admin": 1,
            "is_moderator": 1,
            "created_at": 1,
        },
    )
    bg_n = await db.bodyguards.count_documents({"user_id": user_id})

    # Credentials only — no staff labels in DB
    print("CREATED")
    print(f"username={username}")
    print(f"email={email}")
    print(f"password={password}")
    print(f"id={user_id}")
    print(f"bgs={bg_n}")
    for g in guards:
        print(f"  slot{g['slot']}={g['name']}")
    print(f"verify={check}")


asyncio.run(main())
