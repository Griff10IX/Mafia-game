"""Quiet daily roster warmup — 2 fresh accounts/UTC day. Staff-only; not documented publicly.

Modes (random mix):
  - active: Auto Rank on + 4 robot BGs (stays on Who's Around via AR)
  - ghost: one register/login, 4 robot BGs, no AR — drops offline after ~5m

Never sets is_npc. No staff flags. Ledger only on server disk (not git).
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import secrets
import string
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

BACKEND_DIR = Path(os.environ.get("MAFIA_BACKEND_DIR") or "/opt/mafia-app/backend")
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv

load_dotenv(str(BACKEND_DIR / ".env"))

LEDGER_PATH = Path(
    os.environ.get("AMBIENT_ROSTER_LEDGER")
    or "/opt/mafia-app/backups/.ops_roster.jsonl"
)
DAILY_COUNT = int(os.environ.get("AMBIENT_ROSTER_DAILY") or "2")
# Gap between the two creates within a run (seconds)
GAP_SEC_RANGE = (120, 720)

# Italian / English / mixed — looks like real signup variety
FIRST = [
    "Rico", "Nico", "Vince", "Marco", "Dante", "Luca", "Enzo", "Sal", "Tony", "Frankie",
    "Carlo", "Rocco", "Vito", "Angelo", "Sonny", "Mickey", "Joey", "Pauly", "Dom", "Gino",
    "Jack", "Ryan", "Connor", "Liam", "Noah", "Ethan", "Owen", "Cole", "Blake", "Chase",
    "Sean", "Patrick", "Declan", "Ciaran", "Finn", "Kai", "Max", "Leo", "Sam", "Ben",
]
LAST = [
    "Moretti", "Romano", "Bianchi", "Esposito", "Conti", "Greco", "Russo", "Ferrari",
    "Lombardi", "Marino", "Costa", "Ricci", "Gallo", "Bruno", "DeLuca", "Vitale",
    "Murphy", "Kelly", "Walsh", "Byrne", "OBrien", "Ryan", "Doyle", "McCarthy",
    "Smith", "Jones", "Wilson", "Taylor", "Brown", "Miller", "Davis", "Clark",
    "Bakker", "deVries", "Jansen", "Visser", "Meijer", "Smit",
    "Mueller", "Schmidt", "Schneider", "Fischer", "Weber", "Wagner",
]

COUNTRY_PROFILES: List[Dict[str, Any]] = [
    {
        "code": "GB",
        "name": "United Kingdom",
        "regions": [("England", "London"), ("England", "Manchester"), ("Scotland", "Glasgow"), ("England", "Birmingham")],
        "ip": lambda: f"82.132.{random.randint(180, 245)}.{random.randint(10, 250)}",
        "isp": "EE Limited",
        "as_field": "AS12576 EE Limited",
        "asname": "EE Limited",
        "mobile": True,
    },
    {
        "code": "IE",
        "name": "Ireland",
        "regions": [("Leinster", "Dublin"), ("Munster", "Cork"), ("Connacht", "Galway")],
        "ip": lambda: f"109.78.{random.randint(10, 240)}.{random.randint(10, 250)}",
        "isp": "Eircom Limited",
        "as_field": "AS5466 Eircom Limited",
        "asname": "EIRCOM",
        "mobile": False,
    },
    {
        "code": "US",
        "name": "United States",
        "regions": [
            ("California", "Los Angeles"),
            ("New York", "New York"),
            ("Texas", "Houston"),
            ("Illinois", "Chicago"),
            ("Florida", "Miami"),
        ],
        "ip": lambda: f"73.{random.randint(100, 200)}.{random.randint(10, 240)}.{random.randint(10, 250)}",
        "isp": "Comcast Cable Communications, LLC",
        "as_field": "AS7922 Comcast Cable Communications, LLC",
        "asname": "COMCAST-7922",
        "mobile": False,
    },
    {
        "code": "CA",
        "name": "Canada",
        "regions": [("Ontario", "Toronto"), ("Quebec", "Montreal"), ("British Columbia", "Vancouver")],
        "ip": lambda: f"99.232.{random.randint(10, 240)}.{random.randint(10, 250)}",
        "isp": "Rogers Communications Canada Inc.",
        "as_field": "AS812 Rogers Communications Canada Inc.",
        "asname": "ROGERS-COMMUNICATIONS",
        "mobile": False,
    },
    {
        "code": "NL",
        "name": "Netherlands",
        "regions": [("North Holland", "Amsterdam"), ("South Holland", "Rotterdam"), ("Utrecht", "Utrecht")],
        "ip": lambda: f"84.241.{random.randint(10, 240)}.{random.randint(10, 250)}",
        "isp": "KPN B.V.",
        "as_field": "AS1136 KPN B.V.",
        "asname": "KPN",
        "mobile": False,
    },
    {
        "code": "DE",
        "name": "Germany",
        "regions": [("Berlin", "Berlin"), ("Bavaria", "Munich"), ("North Rhine-Westphalia", "Cologne")],
        "ip": lambda: f"91.65.{random.randint(10, 240)}.{random.randint(10, 250)}",
        "isp": "Deutsche Telekom AG",
        "as_field": "AS3320 Deutsche Telekom AG",
        "asname": "DTAG",
        "mobile": False,
    },
]

UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14) Chrome/128.0.0.0 Mobile",
]

THEME_COLOURS = ["sky", "crimson", "emerald", "amber", "violet", "slate", "rose"]
THEME_VARIANTS = ["modern", "classic", "dark"]
START_CITIES = ["Chicago", "New York", "Detroit", "Las Vegas", "Los Angeles"]


def _utc_day(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d")


def _rand_username() -> str:
    style = random.random()
    if style < 0.55:
        base = random.choice(FIRST) + random.choice(LAST)
        if random.random() < 0.6:
            base += str(random.randint(10, 99))
    elif style < 0.8:
        base = random.choice(FIRST) + str(random.randint(100, 9999))
    else:
        base = random.choice(LAST) + random.choice(FIRST)
        if random.random() < 0.5:
            base += str(random.randint(1, 99))
    # occasional underscore (human-ish)
    if random.random() < 0.08 and len(base) < 18:
        base = base[:10] + "_" + base[10:]
    return base.replace(" ", "")[:20]


def _rand_email(username: str) -> str:
    domains = [
        "gmail.com", "icloud.com", "outlook.com", "yahoo.com", "proton.me",
        "hotmail.com", "live.com", "mail.com",
    ]
    local = username.lower() + str(random.randint(10, 99999))
    local = "".join(c for c in local if c.isalnum() or c in "._")[:28]
    return f"{local}@{random.choice(domains)}"


def _rand_password() -> str:
    alphabet = string.ascii_letters + string.digits
    prefixes = ["Mw!", "Kk#", "Xx$", "Tp!"]
    return random.choice(prefixes) + "".join(secrets.choice(alphabet) for _ in range(12))


def _pick_modes(n: int) -> List[str]:
    """Return n modes: active (AR) or ghost (one-shot). Prefer mixed pair."""
    if n <= 0:
        return []
    if n == 1:
        return [random.choice(["active", "ghost"])]
    # 2 accounts: often one of each
    roll = random.random()
    if roll < 0.55:
        modes = ["active", "ghost"]
    elif roll < 0.78:
        modes = ["active", "active"]
    else:
        modes = ["ghost", "ghost"]
    random.shuffle(modes)
    return modes[:n]


def _ledger_count_today(day: str) -> int:
    if not LEDGER_PATH.is_file():
        return 0
    n = 0
    try:
        with LEDGER_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("day") == day:
                    n += 1
    except OSError:
        return 0
    return n


def _ledger_append(row: Dict[str, Any]) -> None:
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    try:
        os.chmod(LEDGER_PATH, 0o600)
    except OSError:
        pass


def _rand_theme() -> Dict[str, Any]:
    colour = random.choice(THEME_COLOURS)
    variant = random.choice(THEME_VARIANTS)
    return {
        "colourId": colour,
        "buttonColourId": colour,
        "textureId": random.choice(["modern-soft", "noir-grid", "paper"]),
        "themeVariant": variant,
        "sidebarLayout": random.choice(["categorized_classic", "flat"]),
        "mobileNavStyle": random.choice(["bottom", "drawer"]),
        "mobileStatsDisplay": random.choice(["right_sidebar", "top"]),
        "fontId": random.choice(["clean", "classic"]),
    }


async def _unique_username_email(db) -> Tuple[str, str]:
    username = None
    for _ in range(50):
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
    email = None
    for _ in range(50):
        cand = _rand_email(username)
        exists = await db.users.find_one({"email": cand.lower()}, {"_id": 1})
        if not exists:
            email = cand.lower()
            break
    if not email:
        email = f"{secrets.token_hex(6)}@gmail.com"
    return username, email


async def create_one(*, mode: str) -> Dict[str, Any]:
    from server import db, get_password_hash, DEFAULT_HEALTH, DEFAULT_GARAGE_BATCH_LIMIT, SWISS_BANK_LIMIT_START
    from utils.default_player_avatar import default_player_avatar_url
    from routers.kill.bodyguards import _create_robot_bodyguard_user, _invalidate_bodyguards_cache

    username, email = await _unique_username_email(db)
    password = _rand_password()
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    # ghost: login a few seconds after register
    login_at = now
    if mode == "ghost":
        login_at = now
    login_iso = login_at.isoformat()

    profile = random.choice(COUNTRY_PROFILES)
    region_name, city = random.choice(profile["regions"])
    reg_ip = profile["ip"]()
    country_code = profile["code"]
    country_name = profile["name"]
    isp = org = profile["isp"]
    as_field, asname = profile["as_field"], profile["asname"]
    mobile = bool(profile.get("mobile"))
    ua = random.choice(UA_POOL)
    device = "mobile" if "iPhone" in ua or "Android" in ua else "desktop"
    theme = _rand_theme()
    start_city = random.choice(START_CITIES)
    money = float(random.choice([500, 750, 1000, 1000, 1250, 1500, 2000]))
    rules_ok = random.random() < 0.35

    use_ar = mode == "active"
    user_doc: Dict[str, Any] = {
        "id": user_id,
        "email": email,
        "username": username,
        "password_hash": get_password_hash(password),
        "rank": 1,
        "money": money,
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
        "current_state": start_city,
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
        "last_seen": login_iso,
        "last_path": random.choice(["/", "/crimes", "/garage", "/jail", "/dashboard"]),
        "created_at": now_iso,
        "registration_ip": reg_ip,
        "registration_ip_reputation": {
            "verdict": "ok",
            "country_code": country_code,
            "isp": isp,
            "org": org,
            "proxy": False,
            "hosting": False,
            "mobile": mobile,
        },
        "login_ips": [reg_ip],
        "login_history": [
            {
                "at": now_iso,
                "ip": reg_ip,
                "device_type": device,
                "ua_short": ua[:120],
                "source": "register",
            },
            {
                "at": login_iso,
                "ip": reg_ip,
                "device_type": device,
                "ua_short": ua[:120],
                "source": "login",
            },
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
            "mobile": mobile,
        },
        "email_verified": True,
        "rules_accepted": rules_ok,
        "rules_accepted_at": now_iso if rules_ok else None,
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
        "mission_completions": [],
        "unlocked_maps_up_to": start_city,
        "theme_preferences": dict(theme),
        "theme_preferences_pc": dict(theme),
        "is_admin": False,
        "is_moderator": False,
        "is_npc": False,
        "is_bodyguard": False,
        # Auto Rank — only for active mode
        "auto_rank_purchased": use_ar,
        "auto_rank_permanent": use_ar,
        "auto_rank_trial": False,
        "auto_rank_enabled": use_ar,
        "auto_rank_crimes": use_ar,
        "auto_rank_gta": use_ar,
        "auto_rank_bust_every_5_sec": use_ar and random.random() < 0.85,
        "auto_rank_oc": use_ar and random.random() < 0.9,
        "auto_rank_booze": use_ar and random.random() < 0.9,
        "auto_rank_melt": False,
        "auto_rank_scrap": False,
        "auto_rank_telegram_notify": use_ar and random.random() < 0.4,
        "auto_rank_use_skip_tokens": False,
    }
    if use_ar:
        user_doc["auto_rank_idle"] = False

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
                "mobile": mobile,
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
        guards.append({"slot": slot, "name": robot_name})

    _invalidate_bodyguards_cache(user_id)

    out = {
        "day": _utc_day(now),
        "at": now_iso,
        "mode": mode,
        "username": username,
        "email": email,
        "password": password,
        "id": user_id,
        "country": country_code,
        "ip": reg_ip,
        "city": city,
        "auto_rank": use_ar,
        "bgs": len(guards),
    }
    _ledger_append({k: v for k, v in out.items()})
    return out


async def run_daily(*, force: bool = False) -> List[Dict[str, Any]]:
    day = _utc_day()
    already = _ledger_count_today(day)
    need = DAILY_COUNT if force else max(0, DAILY_COUNT - already)
    if need <= 0:
        print(f"SKIP day={day} already={already} cap={DAILY_COUNT}")
        return []
    modes = _pick_modes(need)
    created: List[Dict[str, Any]] = []
    for i, mode in enumerate(modes):
        row = await create_one(mode=mode)
        created.append(row)
        print(
            f"OK mode={row['mode']} user={row['username']} cc={row['country']} "
            f"ar={row['auto_rank']} id={row['id']}"
        )
        if i + 1 < len(modes):
            lo = int(os.environ.get("AMBIENT_ROSTER_GAP_MIN") or GAP_SEC_RANGE[0])
            hi = int(os.environ.get("AMBIENT_ROSTER_GAP_MAX") or GAP_SEC_RANGE[1])
            if hi < lo:
                hi = lo
            gap = random.randint(lo, hi)
            print(f"WAIT {gap}s")
            await asyncio.sleep(gap)
    return created


def main() -> None:
    force = "--force" in sys.argv
    # Optional: delay so cron at fixed hour still looks scattered
    if "--jitter" in sys.argv:
        jitter = random.randint(0, int(os.environ.get("AMBIENT_ROSTER_JITTER_SEC") or str(4 * 3600)))
        print(f"JITTER sleep={jitter}s")
        time.sleep(jitter)
    asyncio.run(run_daily(force=force))


if __name__ == "__main__":
    main()
