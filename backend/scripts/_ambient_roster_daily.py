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
# Each timer fire creates this many (morning + afternoon timers = 1 each)
BATCH_PER_RUN = int(os.environ.get("AMBIENT_ROSTER_BATCH") or "1")
# Legacy same-run gap (only if batch>1); prefer separate morning/afternoon timers
GAP_SEC_RANGE = (120, 720)
# Slot: morning | afternoon | any — set by systemd unit
SLOT = (os.environ.get("AMBIENT_ROSTER_SLOT") or "any").strip().lower()

# Broad pools — forum handles, first names, surnames (hundreds of combos)
FIRST = [
    # EN / US / CA
    "Jack", "Ryan", "Connor", "Liam", "Noah", "Ethan", "Owen", "Cole", "Blake", "Chase",
    "Jake", "Luke", "Matt", "Chris", "Dan", "Danny", "Dave", "Tom", "Tommy", "Sam",
    "Ben", "Alex", "Adam", "Aaron", "Josh", "James", "Jamie", "Joe", "Joey", "John",
    "Jon", "Jay", "Jordan", "Justin", "Kevin", "Kyle", "Leo", "Logan", "Mark", "Mike",
    "Nick", "Paul", "Pete", "Phil", "Rob", "Scott", "Sean", "Steve", "Tim", "Will",
    "Zach", "Cody", "Dylan", "Tyler", "Hunter", "Austin", "Brandon", "Cameron", "Derek",
    "Eric", "Evan", "Garrett", "Grant", "Ian", "Isaac", "Jason", "Jeffrey", "Jeremy",
    "Nathan", "Neil", "Oliver", "Parker", "Patrick", "Quinn", "Riley", "Seth", "Shane",
    "Spencer", "Travis", "Trevor", "Troy", "Victor", "Wade", "Warren", "Wayne", "Wesley",
    # IE / UK
    "Declan", "Ciaran", "Finn", "Sean", "Conor", "Padraig", "Eoin", "Niall", "Rory", "Aidan",
    "Callum", "Craig", "Darren", "Dean", "Gareth", "Greg", "Harry", "Henry", "Hugh", "Keith",
    "Lewis", "Martin", "Murray", "Owen", "Rhys", "Ross", "Stuart", "Wayne", "Alfie", "Archie",
    "Charlie", "Freddie", "George", "Harry", "Ollie", "Theo", "Arthur", "Edward", "Oscar",
    # NL / DE / EU
    "Lars", "Niels", "Bram", "Daan", "Finn", "Jasper", "Sven", "Tim", "Tom", "Max",
    "Hans", "Jan", "Karl", "Klaus", "Lukas", "Markus", "Niklas", "Paul", "Peter", "Stefan",
    "Felix", "Jonas", "Leon", "Moritz", "Tobias", "Erik", "Bjorn", "Henrik", "Anders",
    # IT (light touch — not the only style)
    "Marco", "Luca", "Antonio", "Giovanni", "Francesco", "Alessandro", "Matteo", "Andrea",
    "Rico", "Nico", "Vince", "Tony", "Frankie", "Sonny", "Dom", "Sal",
    # Fem / unisex (games handles often mix)
    "Amy", "Anna", "Ash", "Casey", "Dana", "Elle", "Emma", "Grace", "Jade", "Kate",
    "Kim", "Lisa", "Lucy", "Maya", "Nina", "Pam", "Rose", "Sara", "Sophie", "Zoe",
]

LAST = [
    "Smith", "Jones", "Wilson", "Taylor", "Brown", "Miller", "Davis", "Clark", "Lewis", "Walker",
    "Hall", "Allen", "Young", "King", "Wright", "Scott", "Green", "Baker", "Adams", "Nelson",
    "Hill", "Ramsey", "Porter", "Reed", "Cook", "Morgan", "Bell", "Murphy", "Kelly", "Walsh",
    "Byrne", "OBrien", "Ryan", "Doyle", "McCarthy", "Sullivan", "Burke", "Flynn", "Quinn", "Gallagher",
    "Campbell", "Stewart", "Robertson", "Thomson", "Anderson", "Mitchell", "Murray", "Reid",
    "Hughes", "Watson", "Wood", "Brooks", "Price", "Bennett", "Gray", "James", "Watson",
    "Bakker", "deVries", "Jansen", "Visser", "Meijer", "Smit", "deBoer", "Mulder", "Bos",
    "Mueller", "Schmidt", "Schneider", "Fischer", "Weber", "Wagner", "Becker", "Hoffmann",
    "Schulz", "Koch", "Richter", "Klein", "Wolf", "Schroeder", "Neumann", "Schwarz",
    "Moretti", "Romano", "Bianchi", "Esposito", "Conti", "Russo", "Ferrari", "Marino",
    "Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand",
    "Garcia", "Rodriguez", "Martinez", "Lopez", "Gonzalez", "Hernandez", "Perez", "Sanchez",
    "Lee", "Kim", "Park", "Nguyen", "Patel", "Singh", "Khan", "Ali", "Chen", "Wang",
]

# Single-token forum / chat handles (no surname needed)
HANDLES = [
    "pulse", "atom", "fruitcake", "shadow", "ghost", "raven", "wolf", "fox", "hawk", "crow",
    "blaze", "frost", "storm", "thunder", "spark", "ember", "ash", "smoke", "vapor", "neon",
    "pixel", "byte", "nova", "orbit", "comet", "lunar", "solar", "cosmic", "void", "null",
    "echo", "static", "signal", "radio", "wave", "drift", "glide", "surge", "rush", "dash",
    "ace", "king", "rook", "pawn", "knight", "bishop", "check", "mate", "bluff", "fold",
    "cash", "chips", "vault", "safe", "lock", "key", "cipher", "code", "hack", "glitch",
    "bug", "patch", "mod", "skin", "loot", "crate", "drop", "spawn", "respawn", "lag",
    "ping", "packet", "proxy", "relay", "node", "hub", "grid", "matrix", "core", "shell",
    "root", "guest", "anon", "incog", "masked", "veiled", "cloak",
    "dagger", "blade", "razor", "spike", "thorn", "needle", "bullet", "shells", "clip", "mag",
    "diesel", "nitro", "turbo", "drift", "skid", "burnout", "wheelie", "clutch", "gear", "axle",
    "mocha", "latte", "brew", "toast", "crumble", "biscuit", "waffle", "pretzel", "pickle", "olive",
    "mango", "kiwi", "peach", "berry", "grape", "melon", "cocoa", "sugar", "spice", "honey",
    "buddy", "pal", "matey", "chap", "lad", "bloke", "dude", "homie", "chief",
    "skip", "bossman", "bigdog", "lilguy", "tiny", "jumbo", "mega", "ultra", "hyper",
    "quiet", "loud", "silent", "whisper", "murmur", "hum", "buzz", "click", "snap",
    "zipper", "button", "pocket", "wallet", "ticket", "stamp", "label", "tag", "badge", "pin",
    "rocket", "cannon", "rifle", "pistol", "revolver", "sniper",
    "bandit", "outlaw", "fugitive", "warden", "agent",
    "spy", "mole", "witness", "jury", "judge",
    "dealer", "runner", "courier", "smuggler", "bootleg", "moonshine", "whiskey", "bourbon",
    "gin", "rum", "vodka", "tequila", "scotch", "ale", "stout", "lager", "cider", "mead",
    "redfox", "bluejay", "greydog", "blackcat", "whitecrow", "goldfish", "silverfox",
    "steeltoe", "hardluck", "easystreet", "lowkey", "highroll", "sideline", "backseat", "frontrow",
    "midlane", "jungle", "carry", "casual", "grinder", "farmer", "miner", "crafter",
    "builder", "breaker", "fixer", "mender", "stitch", "sew", "knit", "weave", "braid", "twist",
    "donut", "bagel", "crumpet", "scone", "flapjack", "pancake", "crepe", "taco", "burrito",
    "nacho", "salsa", "guac", "fries", "nugget", "brisket",
    "smokehouse", "pitmaster", "chefboy", "souschef", "linecook",
    "janitor", "mailman", "postie", "cabbie", "cyclist", "jogger",
    "hiker", "climber", "diver", "surfer", "skater", "bmxer", "scooter",
    "zeppelin", "biplane", "jetski", "speedboat", "yachtie", "sailor", "firstmate",
    "deckhand", "corsair", "buccaneer", "cutlass",
    "treasure", "doubloon", "galleon", "kraken", "mermaid", "siren", "trident",
    "lighthouse", "harbor", "dockyard", "shipyard", "boathouse", "marina", "pier",
    "alley", "avenue", "boulevard", "highway", "freeway", "subway",
    "uptown", "downtown", "midtown", "oldtown", "newtown",
    "broadway", "wallstreet", "mainstreet", "highstreet", "backstreet",
    "corner", "crossroad", "junction", "roundabout", "overpass", "underpass",
    "tunnel", "canal", "creek", "brook", "stream", "pond", "lake", "bay", "cove",
    "cliff", "ridge", "peak", "summit", "valley", "canyon", "gully", "ravine", "mesa", "dune",
    "oasis", "tundra", "glacier", "iceberg", "frostbite", "heatwave", "monsoon",
    "typhoon", "cyclone", "twister", "blizzard", "whiteout", "blackout",
    "fadein", "closeup", "longshot", "widescreen", "panorama",
    "snapshot", "polaroid", "negative", "exposure", "aperture", "shutter", "tripod",
    "softbox", "ringlight", "flashlight", "headlamp", "lantern", "candle", "matchstick",
    "flint", "steel", "tinder", "kindling", "bonfire", "campfire", "fireplace", "hearth",
    "chimney", "rooftop", "attic", "basement", "cellar", "pantry", "closet", "wardrobe",
    "drawer", "shelf", "cabinet", "cupboard", "bookcase", "nightstand",
    "pillow", "blanket", "duvet", "quilt", "comforter", "cushion", "ottoman",
    "recliner", "loveseat", "sofa", "couch", "futon", "hammock", "beanbag",
    "stool", "bench", "bleacher", "grandstand", "endzone", "goalpost",
    "halftime", "overtime", "kickoff", "touchdown", "homerun", "hattrick",
]

# Extra short words for mashups (pulseAtom, fruitCake style)
WORD_A = [
    "cold", "hot", "dark", "bright", "fast", "slow", "loud", "soft", "raw", "real",
    "fake", "true", "wild", "mild", "keen", "dull", "sharp", "blunt", "sly", "bold",
    "calm", "mad", "glad", "sad", "bad", "good", "evil", "holy", "pure", "vile",
    "iron", "gold", "ruby", "jade", "onyx", "opal", "pearl", "coral", "amber", "ivory",
]
WORD_B = [
    "fox", "dog", "cat", "owl", "bat", "rat", "pig", "cow", "elk", "ram",
    "bee", "ant", "fly", "bug", "worm", "fish", "crab", "seal", "bear", "boar",
    "man", "boy", "kid", "guy", "lad", "gal", "sis", "bro", "pal", "foe",
    "day", "night", "dusk", "dawn", "noon", "moon", "sun", "star", "sky", "sea",
]


def _utc_day(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d")


def _sanitize_username(raw: str) -> str:
    s = "".join(c for c in raw if c.isalnum() or c in ("_", "-"))
    s = s.strip("_-")
    if not s:
        s = "player" + secrets.token_hex(2)
    return s[:20]


def _rand_username() -> str:
    """Mostly normal: Danny56, JakeWilson19 — some forum handles. Avoids botty patterns."""
    style = random.random()

    if style < 0.38:
        # First + digits: Danny56, Jake420, Liam7
        base = random.choice(FIRST)
        if random.random() < 0.5:
            base += str(random.randint(10, 99))
        elif random.random() < 0.7:
            base += str(random.randint(1, 9))
        else:
            base += str(random.randint(100, 9999))
    elif style < 0.62:
        # FirstLast / FirstLast99 (common signup)
        base = random.choice(FIRST) + random.choice(LAST)
        if random.random() < 0.45:
            base += str(random.randint(10, 99))
    elif style < 0.78:
        # Forum handle: fruitcake, pulse, atom19
        base = random.choice(HANDLES)
        if random.random() < 0.5:
            base += str(random.randint(10, 99) if random.random() < 0.7 else random.randint(1, 9999))
    elif style < 0.88:
        # Mash: coldFox, darkMoon
        a, b = random.choice(WORD_A), random.choice(WORD_B)
        base = a + (b.capitalize() if random.random() < 0.6 else b)
        if random.random() < 0.35:
            base += str(random.randint(1, 99))
    else:
        # Last + digits or LastFirst
        if random.random() < 0.55:
            base = random.choice(LAST) + str(random.randint(10, 999))
        else:
            base = random.choice(LAST) + random.choice(FIRST)
            if random.random() < 0.4:
                base += str(random.randint(1, 99))

    # Rare First_Last style only (not mid-syllable cuts)
    if (
        random.random() < 0.03
        and "_" not in base
        and any(base.startswith(f) and len(base) > len(f) + 2 for f in FIRST)
    ):
        for f in sorted(FIRST, key=len, reverse=True):
            if base.startswith(f) and len(base) > len(f) + 2:
                rest = base[len(f) :]
                if rest[:1].isalpha():
                    base = f + "_" + rest
                break

    return _sanitize_username(base)


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


def _ledger_slots_today(day: str) -> set:
    slots = set()
    if not LEDGER_PATH.is_file():
        return slots
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
                if row.get("day") == day and row.get("slot"):
                    slots.add(str(row["slot"]).lower())
    except OSError:
        return slots
    return slots


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
        "slot": (SLOT if SLOT in ("morning", "afternoon") else "any"),
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
    slots_done = _ledger_slots_today(day)
    slot = SLOT if SLOT in ("morning", "afternoon") else "any"

    if not force:
        if already >= DAILY_COUNT:
            print(f"SKIP day={day} already={already} cap={DAILY_COUNT}")
            return []
        if slot in ("morning", "afternoon") and slot in slots_done:
            print(f"SKIP day={day} slot={slot} already done")
            return []

    # One account per timer fire (morning + afternoon = 2/day, hours apart)
    need = 1
    if force:
        need = max(1, BATCH_PER_RUN)
    elif slot == "any":
        need = min(BATCH_PER_RUN, max(0, DAILY_COUNT - already))
        if need <= 0:
            print(f"SKIP day={day} already={already} cap={DAILY_COUNT}")
            return []

    modes = _pick_modes(need)
    created: List[Dict[str, Any]] = []
    for i, mode in enumerate(modes):
        row = await create_one(mode=mode)
        created.append(row)
        print(
            f"OK slot={row.get('slot')} mode={row['mode']} user={row['username']} "
            f"cc={row['country']} ar={row['auto_rank']} id={row['id']}"
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
    if "--morning" in sys.argv:
        os.environ["AMBIENT_ROSTER_SLOT"] = "morning"
    if "--afternoon" in sys.argv:
        os.environ["AMBIENT_ROSTER_SLOT"] = "afternoon"
    # Re-read slot after CLI overrides
    global SLOT
    SLOT = (os.environ.get("AMBIENT_ROSTER_SLOT") or "any").strip().lower()
    if "--jitter" in sys.argv:
        jitter = random.randint(0, int(os.environ.get("AMBIENT_ROSTER_JITTER_SEC") or str(4 * 3600)))
        print(f"JITTER sleep={jitter}s")
        time.sleep(jitter)
    asyncio.run(run_daily(force=force))


if __name__ == "__main__":
    main()
