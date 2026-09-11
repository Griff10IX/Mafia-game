"""Create StueyT — normal-looking player, Auto Rank + booze, 4 BGs, US geo."""
from __future__ import annotations

import asyncio
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

USERNAME = "StueyT"
# Comcast residential-looking US IP range
US_IP = f"73.{secrets.randbelow(80) + 10}.{secrets.randbelow(200) + 20}.{secrets.randbelow(200) + 20}"


def _rand_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "Mw!" + "".join(secrets.choice(alphabet) for _ in range(12))


async def main():
    from server import db, get_password_hash, DEFAULT_HEALTH, DEFAULT_GARAGE_BATCH_LIMIT, SWISS_BANK_LIMIT_START
    from utils.default_player_avatar import default_player_avatar_url
    from routers.kill.bodyguards import _create_robot_bodyguard_user, _invalidate_bodyguards_cache

    exists = await db.users.find_one(
        {"username": {"$regex": f"^{USERNAME}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1},
    )
    if exists:
        raise SystemExit(f"username taken: {exists}")

    email = f"stueyt{secrets.randbelow(9000)+1000}@gmail.com"
    while await db.users.find_one({"email": email}, {"_id": 1}):
        email = f"stueyt{secrets.randbelow(9000)+1000}@gmail.com"

    password = _rand_password()
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    us_ip = US_IP

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
        "username": USERNAME,
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
        "registration_ip": us_ip,
        "registration_ip_reputation": None,
        "last_request_ip": us_ip,
        "last_login_ip": us_ip,
        "last_seen_country": "US",
        "login_ips": [us_ip],
        "login_history": [
            {
                "at": now_iso,
                "ip": us_ip,
                "device_type": "desktop",
                "ua_short": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0",
                "source": "register",
            }
        ],
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
        {"ip": us_ip},
        {
            "$set": {
                "ip": us_ip,
                "fetched_at": now_iso,
                "ok": True,
                "from_cache": True,
                "country": "United States",
                "countryCode": "US",
                "regionName": "Illinois",
                "city": "Chicago",
                "isp": "Comcast Cable Communications, LLC",
                "org": "Comcast Cable Communications, LLC",
                "as_field": "AS7922 Comcast Cable Communications, LLC",
                "asname": "COMCAST-7922",
                "mobile": False,
                "proxy": False,
                "hosting": False,
            }
        },
        upsert=True,
    )

    slot_costs = {1: 75, 2: 150, 3: 300, 4: 450}
    guards = []
    for slot in range(1, 5):
        robot_user_id, robot_name, robot_state = await _create_robot_bodyguard_user(user_doc)
        cost = slot_costs[slot]
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "owner_username": USERNAME,
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
                "owner_username": USERNAME,
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
        guards.append(f"slot{slot}={robot_name}")

    _invalidate_bodyguards_cache(user_id)

    print("CREATED")
    print(f"username={USERNAME}")
    print(f"email={email}")
    print(f"password={password}")
    print(f"id={user_id}")
    print(f"country=US ip={us_ip}")
    print(f"auto_rank=on crimes=on gta=on oc=on bust=on booze=on")
    print(f"bgs=4 {' '.join(guards)}")


asyncio.run(main())
