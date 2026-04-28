# Entertainer Forum: free entry, random prizes (cash/bullets/tokens/cars). Dice/Hangman = one winner; Gbox = one cash pot split randomly + per-player non-cash rewards.
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import uuid
import secrets
_rng = secrets.SystemRandom()
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import db, get_current_user, get_current_user_verified, send_notification, send_notification_to_all, _is_admin, _is_entertainer, CARS
from utils.entertainer_service import (
    ENTERTAINER_GBOX_MAX_POINTS_PER_GAME,
    try_debit_entertainer_fund,
)
from routers.kill.armoury import TOKEN_TYPES, TOKEN_CONFIG
from utils.point_provenance import log_points_event
from utils.sustained_page_ratelimit import PAGE_KEY_ENTERTAINER, check_sustained_page_rl


async def _entertainer_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_ENTERTAINER)


async def _entertainer_sustained_rl_verified(current_user: dict = Depends(get_current_user_verified)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_ENTERTAINER)


async def _entertainer_join_spam_guard(current_user: dict = Depends(get_current_user_verified)):
    """Small always-on per-user guard for rapid repeat join attempts."""
    uid = str((current_user or {}).get("id") or "").strip()
    if not uid:
        return
    now = datetime.now(timezone.utc)
    endpoint_key = "entertainer_join"
    row = await db.rate_limit_clicks.find_one(
        {"user_id": uid, "endpoint_key": endpoint_key},
        {"_id": 0, "last_at": 1},
    )
    last_at = _parse_iso((row or {}).get("last_at"))
    if last_at and (now - last_at).total_seconds() < 2.0:
        raise HTTPException(
            status_code=429,
            detail="Please wait a moment before trying to join again.",
        )
    await db.rate_limit_clicks.update_one(
        {"user_id": uid, "endpoint_key": endpoint_key},
        {"$set": {"last_at": now.isoformat()}},
        upsert=True,
    )

# E-Games prizes: Rank-XP Pass is shop-only (not listed in "what you can win" and never rolled here).
ENTERTAINER_TOKEN_TYPES = tuple(t for t in TOKEN_TYPES if t != "rank_xp_pass")

# Auto-create runs every 3 hours; open games roll 20 mins before the next batch (so plenty of time to join)
AUTO_CREATE_INTERVAL_SECONDS = 3 * 3600   # 3 hours between batches
ROLL_BEFORE_NEXT_CREATE_SECONDS = 20 * 60  # roll current games 20 mins before next batch
ENTERTAINER_CONFIG_KEY = "entertainer_config"
# DB-backed cap: never create more open games than this (stops spam from restarts or double-runs)
MAX_OPEN_ENTERTAINER_GAMES = 5

# System-created games: show a non-zero cash pot in the UI; paid out on settle (not deducted from anyone at create).
def _system_game_starting_pot(max_players: int) -> int:
    n = max(2, min(10, int(max_players or 2)))
    lo = max(900, 180 * n)
    hi = min(12000, 750 * n + 2200)
    if hi < lo:
        hi = lo
    return _rng.randint(lo, hi)


def _house_bonus_pot_if_zero_stored_pot(game: dict) -> tuple[int, int]:
    """If the stored pot is 0, add a random sponsor pot (minted on settle). Returns (effective_total_cash_pot, house_bonus_only)."""
    base = int(game.get("pot") or 0)
    participants = game.get("participants") or []
    n = len(participants)
    if base > 0 or n == 0:
        return base, 0
    lo = max(600, 140 * n)
    hi = min(9000, 520 * n + 1600)
    if hi < lo:
        hi = lo
    bonus = _rng.randint(lo, hi)
    return bonus, bonus


def _random_partition(total: int, n: int) -> list[int]:
    """Split `total` into n nonnegative integers that sum to `total` (uniform random cut points)."""
    if n <= 0:
        return []
    if total <= 0:
        return [0] * n
    if n == 1:
        return [total]
    cuts = sorted(_rng.randrange(0, total + 1) for _ in range(n - 1))
    points = [0] + cuts + [total]
    return [points[i + 1] - points[i] for i in range(n)]


async def _gbox_total_cash_pot(game: dict) -> tuple[int, int]:
    """Total cash to split among all Gbox participants. Uses stored pot (join fees / funded) or one roll between admin cash_min..cash_max."""
    base = int(game.get("pot") or 0)
    participants = game.get("participants") or []
    n = len(participants)
    if n == 0:
        return 0, 0
    if base > 0:
        return base, 0
    rcfg = await _get_rewards_config()
    lo, hi = int(rcfg["cash_min"]), int(rcfg["cash_max"])
    if hi < lo:
        hi = lo
    pot = _rng.randint(lo, hi)
    return pot, pot


# Cars that can be won (common/uncommon/rare; exclude custom and exclusive)
E_GAME_CAR_IDS = [c["id"] for c in CARS if c.get("id") not in ("car_custom", "car20") and c.get("rarity") in ("common", "uncommon", "rare")]

MAX_HANGMAN_WRONG = 6  # parts of the hangman drawing

# Hidden "find the word" hunt (one global winner per round; collection: entertainer_find_word_rounds)
# Vague hints only — never name specific pages (Crimes/GTA/forum etc.).
FIND_WORD_HINTS = [
    "It’s styled to blend in with normal UI — nothing flashy or obvious.",
    "You might scroll past it a few times before your eye catches it.",
    "Look for a single word sitting on the page like it belongs there.",
    "Check the main content area — margins and corners are fair game.",
    "It won’t be inside a modal or popup; it lives on the page itself.",
    "Same font vibe as the rest of the screen — patience beats speed-clicking.",
    "Could be high, could be low on the page; there’s no fixed hiding spot.",
    "Treat it like a typo that isn’t — one word, waiting to be noticed.",
]

HANGMAN_WORD_DATA = [
    # Crime
    {"word": "MAFIA",         "category": "Crime",       "clue": "Operates from the shadows, feared by all"},
    {"word": "HEIST",         "category": "Crime",       "clue": "A carefully planned score"},
    {"word": "RACKET",        "category": "Crime",       "clue": "Illegal money-making scheme"},
    {"word": "BRIBE",         "category": "Crime",       "clue": "Cash that buys silence or favours"},
    {"word": "ALIBI",         "category": "Crime",       "clue": "Proof you were elsewhere"},
    {"word": "SHOOTOUT",      "category": "Crime",       "clue": "When bullets fly between rivals"},
    {"word": "AMBUSH",        "category": "Crime",       "clue": "Strike before they see you coming"},
    {"word": "CONTRABAND",    "category": "Crime",       "clue": "Goods that move in the dark"},
    {"word": "LAUNDERING",    "category": "Crime",       "clue": "Making dirty money look clean"},
    {"word": "KIDNAPPING",    "category": "Crime",       "clue": "Taking someone for a ransom"},
    {"word": "EXTORTION",     "category": "Crime",       "clue": "Paying up — or else"},
    {"word": "BOOTLEG",       "category": "Crime",       "clue": "Illegal goods sold under the table"},
    {"word": "CRACKDOWN",     "category": "Crime",       "clue": "When the heat turns up on the streets"},
    {"word": "INFORMANT",     "category": "Crime",       "clue": "Someone who talks to the wrong people"},
    {"word": "FUGITIVE",      "category": "Crime",       "clue": "Running from justice"},
    {"word": "WIRETAP",       "category": "Crime",       "clue": "Listening in without permission"},
    {"word": "DECOY",         "category": "Crime",       "clue": "Used to draw attention away"},
    {"word": "STING",         "category": "Crime",       "clue": "An undercover trap"},
    {"word": "SMUGGLER",      "category": "Crime",       "clue": "Moves forbidden cargo across borders"},
    {"word": "DOUBLECROSS",   "category": "Crime",       "clue": "Betrayal dressed as loyalty"},
    {"word": "RANSOM",        "category": "Crime",       "clue": "The price for a safe return"},
    {"word": "BLACKMARKET",   "category": "Crime",       "clue": "Where prohibited goods are traded"},
    {"word": "RENEGADES",     "category": "Crime",       "clue": "Those who broke from the group"},
    {"word": "HAVOC",         "category": "Crime",       "clue": "Total destruction and chaos"},
    {"word": "LOCKDOWN",      "category": "Crime",       "clue": "Nothing and no one gets through"},
    # Mob Rank
    {"word": "GODFATHER",     "category": "Mob Rank",    "clue": "The one all others answer to"},
    {"word": "CONSIGLIERE",   "category": "Mob Rank",    "clue": "The advisor who whispers in the boss's ear"},
    {"word": "UNDERBOSS",     "category": "Mob Rank",    "clue": "Second in command of the family"},
    {"word": "CAPOREGIME",    "category": "Mob Rank",    "clue": "A captain who commands his crew"},
    {"word": "ASSOCIATE",     "category": "Mob Rank",    "clue": "Not yet made, but runs with the family"},
    {"word": "ENFORCER",      "category": "Mob Rank",    "clue": "Makes sure debts and orders are kept"},
    {"word": "HITMAN",        "category": "Mob Rank",    "clue": "Hired to make problems disappear"},
    {"word": "KINGPIN",       "category": "Mob Rank",    "clue": "Controls the entire operation"},
    {"word": "SYNDICATE",     "category": "Mob Rank",    "clue": "A powerful network of criminals"},
    {"word": "DON",           "category": "Mob Rank",    "clue": "A title of respect for the boss"},
    {"word": "CAPO",          "category": "Mob Rank",    "clue": "A captain within the family"},
    {"word": "CREW",          "category": "Mob Rank",    "clue": "A tight-knit group under one captain"},
    {"word": "MERCENARY",     "category": "Mob Rank",    "clue": "Fights for whoever pays most"},
    {"word": "VIGILANTE",     "category": "Mob Rank",    "clue": "Takes justice into their own hands"},
    # Operations
    {"word": "OMERTA",        "category": "Operations",  "clue": "The code that keeps mouths shut"},
    {"word": "FAMILY",        "category": "Operations",  "clue": "The bond that runs deeper than blood"},
    {"word": "TERRITORY",     "category": "Operations",  "clue": "The ground a crew claims as their own"},
    {"word": "TRUCE",         "category": "Operations",  "clue": "A temporary peace between enemies"},
    {"word": "RIVALRY",       "category": "Operations",  "clue": "Long-running competition for power"},
    {"word": "VENDETTA",      "category": "Operations",  "clue": "A personal grudge that must be settled"},
    {"word": "GETAWAY",       "category": "Operations",  "clue": "The fast exit after the job"},
    {"word": "LOOKOUT",       "category": "Operations",  "clue": "Watches for danger so others can work"},
    {"word": "PAYDAY",        "category": "Operations",  "clue": "When the score is finally divided"},
    {"word": "MANHUNT",       "category": "Operations",  "clue": "A large-scale search for someone"},
    {"word": "SURVEILLANCE",  "category": "Operations",  "clue": "Watching without being seen"},
    {"word": "ALLIANCE",      "category": "Operations",  "clue": "Rivals united for a common goal"},
    {"word": "BETRAYAL",      "category": "Operations",  "clue": "Breaking trust from within"},
    {"word": "BLOODOATH",     "category": "Operations",  "clue": "A vow sealed in the most serious way"},
    {"word": "HANDSHAKE",     "category": "Operations",  "clue": "The deal is done without a contract"},
    {"word": "TACTICS",       "category": "Operations",  "clue": "The method behind the madness"},
    {"word": "STRATEGY",      "category": "Operations",  "clue": "The long-term plan for domination"},
    {"word": "SHOWDOWN",      "category": "Operations",  "clue": "The final confrontation"},
    {"word": "OPERATION",     "category": "Operations",  "clue": "A coordinated plan in motion"},
    {"word": "SMOKESCREEN",   "category": "Operations",  "clue": "Distraction hiding the real move"},
    {"word": "COUNTDOWN",     "category": "Operations",  "clue": "Time running out before the moment arrives"},
    {"word": "RECKONING",     "category": "Operations",  "clue": "A day of settling all accounts"},
    {"word": "AFTERMATH",     "category": "Operations",  "clue": "What is left when the smoke clears"},
    # Casino
    {"word": "SPEAKEASY",     "category": "Casino",      "clue": "An illegal bar hidden behind a false wall"},
    {"word": "BLACKJACK",     "category": "Casino",      "clue": "Beat the dealer without going over"},
    {"word": "CASINO",        "category": "Casino",      "clue": "Where the house always has an edge"},
    {"word": "ROULETTE",      "category": "Casino",      "clue": "Spin the wheel and pray"},
    {"word": "POKER",         "category": "Casino",      "clue": "Read the table, not the cards"},
    {"word": "DICE",          "category": "Casino",      "clue": "Luck in a pair of cubes"},
    {"word": "JACKPOT",       "category": "Casino",      "clue": "The biggest possible win"},
    {"word": "BANKROLL",      "category": "Casino",      "clue": "The funds you bring to the table"},
    {"word": "BOOKMAKER",     "category": "Casino",      "clue": "Sets the odds on every bet"},
    {"word": "HIGHROLLER",    "category": "Casino",      "clue": "Bets large and expects VIP treatment"},
    {"word": "STACKS",        "category": "Casino",      "clue": "Piles of chips or cash on the table"},
    {"word": "CHIPS",         "category": "Casino",      "clue": "Plastic currency used on the floor"},
    {"word": "WAGER",         "category": "Casino",      "clue": "What you risk before the cards are dealt"},
    {"word": "PAYOUT",        "category": "Casino",      "clue": "The winnings handed over after a win"},
    {"word": "LUCK",          "category": "Casino",      "clue": "The invisible hand that decides it all"},
    {"word": "FORTUNE",       "category": "Casino",      "clue": "Fate or a pile of accumulated wealth"},
    {"word": "DRAW",          "category": "Casino",      "clue": "Nobody wins and nobody loses"},
    {"word": "MOONSHINE",     "category": "Casino",      "clue": "Homemade spirits flowing after hours"},
    {"word": "AUCTION",       "category": "Casino",      "clue": "Highest bidder takes it all"},
    {"word": "ESCROW",        "category": "Casino",      "clue": "Funds held by a neutral party"},
    # Weapons
    {"word": "BULLETS",       "category": "Weapons",     "clue": "The currency of street violence"},
    {"word": "TRIGGER",       "category": "Weapons",     "clue": "One pull and it is all over"},
    {"word": "HOLSTER",       "category": "Weapons",     "clue": "Where the piece rests when not in use"},
    {"word": "CARTRIDGE",     "category": "Weapons",     "clue": "The loaded casing ready to fire"},
    {"word": "SNIPER",        "category": "Weapons",     "clue": "Hits the mark from a distance"},
    {"word": "RIFLE",         "category": "Weapons",     "clue": "Long-barrel firearm for precision shots"},
    {"word": "PISTOL",        "category": "Weapons",     "clue": "Compact and concealed sidearm"},
    {"word": "SHOTGUN",       "category": "Weapons",     "clue": "Wide spread, short range, devastating"},
    {"word": "SILENCER",      "category": "Weapons",     "clue": "Keeps the noise to a minimum"},
    {"word": "GUNPOWDER",     "category": "Weapons",     "clue": "The black grain behind every shot"},
    {"word": "RELOADER",      "category": "Weapons",     "clue": "Prepares the next round quickly"},
    {"word": "CROWBAR",       "category": "Weapons",     "clue": "Entry tool and blunt instrument in one"},
    {"word": "RAZOR",         "category": "Weapons",     "clue": "Sharp, thin, and dangerous up close"},
    {"word": "IRONCLAD",      "category": "Weapons",     "clue": "Impossible to break or dispute"},
    {"word": "STONEWALL",     "category": "Weapons",     "clue": "An unyielding defence that blocks all"},
    # Location
    {"word": "SAFEHOUSE",     "category": "Location",    "clue": "A place to hide when the heat is on"},
    {"word": "HIDEOUT",       "category": "Location",    "clue": "Where the crew lays low after a job"},
    {"word": "VAULT",         "category": "Location",    "clue": "Locked tight with everything valuable inside"},
    {"word": "WAREHOUSE",     "category": "Location",    "clue": "Large building used to store or meet"},
    {"word": "DOCKYARD",      "category": "Location",    "clue": "Where ships unload more than cargo"},
    {"word": "HARBOR",        "category": "Location",    "clue": "A sheltered bay used for arrivals and departures"},
    {"word": "PENTHOUSE",     "category": "Location",    "clue": "Top-floor luxury for those at the top"},
    {"word": "NIGHTCLUB",     "category": "Location",    "clue": "A front business with more going on inside"},
    {"word": "ROADBLOCK",     "category": "Location",    "clue": "Stops movement dead in its tracks"},
    {"word": "CHECKPOINT",    "category": "Location",    "clue": "You must pass inspection to get through"},
    {"word": "BACKALLEY",     "category": "Location",    "clue": "Where deals are done away from eyes"},
    {"word": "DOWNTOWN",      "category": "Location",    "clue": "The busy heart of the city"},
    {"word": "UPTOWN",        "category": "Location",    "clue": "Where the wealthy keep their distance"},
    {"word": "CITADEL",       "category": "Location",    "clue": "A fortified stronghold of power"},
    {"word": "STRONGHOLD",    "category": "Location",    "clue": "Hard to take and harder to hold"},
    {"word": "BUNKER",        "category": "Location",    "clue": "Underground and built to survive anything"},
    {"word": "ARMORY",        "category": "Location",    "clue": "Where all the hardware is stored"},
    {"word": "HIDEAWAY",      "category": "Location",    "clue": "A secret retreat away from trouble"},
    {"word": "FOOTHOLD",      "category": "Location",    "clue": "The first piece of territory you claim"},
    {"word": "OUTPOST",       "category": "Location",    "clue": "A distant watch point at the edge of turf"},
    {"word": "GARRISON",      "category": "Location",    "clue": "Troops stationed to hold a position"},
    {"word": "BLUEPRINT",     "category": "Location",    "clue": "The plan drawn before the job begins"},
    {"word": "LOCKPICK",      "category": "Location",    "clue": "Tool for entering without a key"},
    {"word": "MIDNIGHT",      "category": "Location",    "clue": "The hour most jobs are done"},
    {"word": "SUNRISE",       "category": "Location",    "clue": "When the night shift finally ends"},
    # Crew / Identity
    {"word": "SCARFACE",      "category": "Identity",    "clue": "A mark left behind from a close call"},
    {"word": "SHADOW",        "category": "Identity",    "clue": "Follows unnoticed, leaves no trace"},
    {"word": "GHOST",         "category": "Identity",    "clue": "Moves through without being seen"},
    {"word": "PHANTOM",       "category": "Identity",    "clue": "Rumoured to exist but never confirmed"},
    {"word": "WHISPER",       "category": "Identity",    "clue": "Information passed very quietly"},
    {"word": "MIRAGE",        "category": "Identity",    "clue": "Looks real but disappears on approach"},
    {"word": "VIPER",         "category": "Identity",    "clue": "Deadly and strikes without warning"},
    {"word": "COBRA",         "category": "Identity",    "clue": "Dangerous, patient, and precise"},
    {"word": "WOLFPACK",      "category": "Identity",    "clue": "A coordinated group that hunts together"},
    {"word": "FALCON",        "category": "Identity",    "clue": "Watches from above and strikes fast"},
    {"word": "NIGHTFALL",     "category": "Identity",    "clue": "When darkness gives cover for work"},
    {"word": "THUNDER",       "category": "Identity",    "clue": "A warning before the real storm hits"},
    {"word": "STORM",         "category": "Identity",    "clue": "Fast, destructive, and impossible to ignore"},
    {"word": "ONYX",          "category": "Identity",    "clue": "Black as night and worth something"},
    {"word": "OBSIDIAN",      "category": "Identity",    "clue": "Dark volcanic glass, sharp as a blade"},
    {"word": "EMBER",         "category": "Identity",    "clue": "A small glow that can reignite everything"},
    {"word": "INFERNO",       "category": "Identity",    "clue": "Out of control and consuming everything"},
    {"word": "FROST",         "category": "Identity",    "clue": "Cold, calculated, and relentless"},
    {"word": "TEMPEST",       "category": "Identity",    "clue": "A violent storm of action"},
    # Additional words (Operations / Crime)
    {"word": "MUGSHOT",       "category": "Crime",       "clue": "A photo taken after an arrest"},
    {"word": "BODYGUARD",     "category": "Operations",  "clue": "Puts themselves between you and danger"},
    {"word": "LEDGER",        "category": "Operations",  "clue": "The book that records all the debts"},
    {"word": "INVOICE",       "category": "Operations",  "clue": "A bill for services rendered"},
    {"word": "CONTRACT",      "category": "Operations",  "clue": "An agreement that cannot be undone easily"},
    {"word": "PAYOFF",        "category": "Operations",  "clue": "The reward at the end of the job"},
    {"word": "TACTICAL",      "category": "Operations",  "clue": "Planned with precision and purpose"},
    {"word": "BARRICADE",     "category": "Location",    "clue": "A hasty barrier thrown up in a hurry"},
    {"word": "WOLFPACK",      "category": "Identity",    "clue": "A coordinated group that hunts together"},
]
# Deduplicate by word (WOLFPACK appears twice above; keep last entry)
_seen = {}
for _e in HANGMAN_WORD_DATA:
    _seen[_e["word"]] = _e
HANGMAN_WORD_DATA = list(_seen.values())

FIND_WORD_WORDS = [
    e["word"]
    for e in HANGMAN_WORD_DATA
    if e.get("word") and len(str(e["word"])) <= 14 and " " not in str(e["word"])
]

DEFAULT_REWARD_TYPE_WEIGHTS = {
    "cash": 36,
    "bullets": 30,
    "cash_bullets": 17,
    "car_cash": 7,
    "car": 5,
    "two_cars": 2,
    "token": 1,
    "cash_token": 1,
    "bullets_token": 1,
    "cash_bullets_token": 1,
    "all_tokens": 1,
}

# Gbox secondary rolls (no cash — cash comes from one shared pot split in _run_gbox_payout)
GBOX_SECONDARY_WEIGHTS = {
    "bullets": 35,
    "token": 12,
    "all_tokens": 2,
    "car": 8,
    "two_cars": 3,
    "bullets_token": 20,
}

ENTERTAINER_REWARDS_CONFIG_KEY = "entertainer_rewards_config"


def _game_config_doc_filter(doc_id: str) -> dict:
    """game_config has a unique index on `id`. Legacy entertainer rows used only `key`, which upserted as id=null and caused E11000. Match either shape."""
    return {"$or": [{"id": doc_id}, {"key": doc_id}]}


_cached_rewards_config = None
_cached_rewards_config_at = 0

async def _get_rewards_config() -> dict:
    """Load rewards config from DB (cached 60s). Falls back to hardcoded defaults."""
    import time
    global _cached_rewards_config, _cached_rewards_config_at
    now = time.monotonic()
    if _cached_rewards_config and (now - _cached_rewards_config_at) < 60:
        return _cached_rewards_config
    doc = await db.game_config.find_one(_game_config_doc_filter(ENTERTAINER_REWARDS_CONFIG_KEY), {"_id": 0})
    if doc:
        merged_w = dict(DEFAULT_REWARD_TYPE_WEIGHTS)
        raw_w = doc.get("reward_type_weights")
        if isinstance(raw_w, dict):
            for k in merged_w:
                if k not in raw_w:
                    continue
                v = raw_w[k]
                if isinstance(v, bool):
                    continue
                try:
                    merged_w[k] = max(0, int(float(v)))
                except (TypeError, ValueError):
                    pass
        cfg = {
            "cash_min": int(doc.get("cash_min") or 100),
            "cash_max": int(doc.get("cash_max") or 2000),
            "bullets_min": int(doc.get("bullets_min") or 1),
            "bullets_max": int(doc.get("bullets_max") or 25),
            "reward_type_weights": merged_w,
        }
    else:
        cfg = {
            "cash_min": 100,
            "cash_max": 2000,
            "bullets_min": 1,
            "bullets_max": 25,
            "reward_type_weights": dict(DEFAULT_REWARD_TYPE_WEIGHTS),
        }
    _cached_rewards_config = cfg
    _cached_rewards_config_at = now
    return cfg

def _invalidate_rewards_config_cache():
    global _cached_rewards_config, _cached_rewards_config_at
    _cached_rewards_config = None
    _cached_rewards_config_at = 0

def _random_cash_range(cfg: dict):
    return _rng.randint(cfg["cash_min"], max(cfg["cash_min"], cfg["cash_max"]))

def _random_bullets_range(cfg: dict):
    return _rng.randint(cfg["bullets_min"], max(cfg["bullets_min"], cfg["bullets_max"]))


def _token_label(token_type: str) -> str:
    custom = {
        "xp_crimes": "XP Crimes",
        "xp_gta": "XP GTA",
        "melt": "Melt",
        "oc_reduced": "OC Reduced",
        "booze": "Booze",
        "racket": "Racket",
        "travel": "Travel",
        "properties": "Properties",
        "jailbust_bonus": "Jailbust Bonus",
    }
    return custom.get(token_type, token_type.replace("_", " ").title())


async def _give_random_reward(user_id: str, *, exclude_cash: bool = False) -> dict:
    """Apply a random reward to user. Returns description for result.
    If exclude_cash=True (Gbox secondary), only bullets/tokens/cars — no independent cash roll."""
    rcfg = await _get_rewards_config()
    if exclude_cash:
        weights = GBOX_SECONDARY_WEIGHTS
    else:
        weights = rcfg["reward_type_weights"]
    reward_type = _rng.choices(
        population=list(weights.keys()),
        weights=list(weights.values()),
        k=1,
    )[0]
    desc = {"reward_type": reward_type, "money": 0, "bullets": 0, "cars": [], "tokens": {}}
    updates = {}
    token_updates = {}
    unsellable_token_updates = {}

    def _add_token(token_type: str, amount: int = 1):
        cfg = TOKEN_CONFIG.get(token_type)
        if not cfg or amount <= 0:
            return
        field = cfg.get("count_field")
        if not field:
            return
        token_updates[field] = int(token_updates.get(field, 0)) + int(amount)
        unsellable_key = f"entertainer_tokens.{field}"
        unsellable_token_updates[unsellable_key] = int(unsellable_token_updates.get(unsellable_key, 0)) + int(amount)
        desc["tokens"][token_type] = int(desc["tokens"].get(token_type, 0)) + int(amount)

    if reward_type == "cash":
        amt = _random_cash_range(rcfg)
        updates["money"] = amt
        desc["money"] = amt
    elif reward_type == "bullets":
        amt = _random_bullets_range(rcfg)
        updates["bullets"] = amt
        desc["bullets"] = amt
    elif reward_type == "cash_bullets":
        c, b = _random_cash_range(rcfg), _random_bullets_range(rcfg)
        updates["money"], updates["bullets"] = c, b
        desc["money"], desc["bullets"] = c, b
    elif reward_type == "token":
        _add_token(_rng.choice(list(ENTERTAINER_TOKEN_TYPES)), 1)
    elif reward_type == "all_tokens":
        for token_type in ENTERTAINER_TOKEN_TYPES:
            _add_token(token_type, 1)
    elif reward_type == "cash_token":
        c = _random_cash_range(rcfg)
        updates["money"] = c
        desc["money"] = c
        _add_token(_rng.choice(list(ENTERTAINER_TOKEN_TYPES)), 1)
    elif reward_type == "bullets_token":
        b = _random_bullets_range(rcfg)
        updates["bullets"] = b
        desc["bullets"] = b
        _add_token(_rng.choice(list(ENTERTAINER_TOKEN_TYPES)), 1)
    elif reward_type == "cash_bullets_token":
        c, b = _random_cash_range(rcfg), _random_bullets_range(rcfg)
        updates["money"], updates["bullets"] = c, b
        desc["money"], desc["bullets"] = c, b
        _add_token(_rng.choice(list(ENTERTAINER_TOKEN_TYPES)), 1)
    elif reward_type == "car":
        if E_GAME_CAR_IDS:
            car_id = _rng.choice(E_GAME_CAR_IDS)
            car = next((c for c in CARS if c.get("id") == car_id), None)
            if car:
                await db.user_cars.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "car_id": car_id,
                    "car_name": car.get("name", car_id),
                    "acquired_at": datetime.now(timezone.utc).isoformat(),
                })
                desc["cars"] = [car.get("name", car_id)]
    elif reward_type == "two_cars":
        if E_GAME_CAR_IDS:
            chosen = _rng.sample(E_GAME_CAR_IDS, min(2, len(E_GAME_CAR_IDS)))
            for car_id in chosen:
                car = next((c for c in CARS if c.get("id") == car_id), None)
                if car:
                    await db.user_cars.insert_one({
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "car_id": car_id,
                        "car_name": car.get("name", car_id),
                        "acquired_at": datetime.now(timezone.utc).isoformat(),
                    })
                    desc["cars"].append(car.get("name", car_id))
    elif reward_type == "car_cash":
        c = _random_cash_range(rcfg)
        updates["money"] = c
        desc["money"] = c
        if E_GAME_CAR_IDS:
            car_id = _rng.choice(E_GAME_CAR_IDS)
            car = next((c for c in CARS if c.get("id") == car_id), None)
            if car:
                await db.user_cars.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "car_id": car_id,
                    "car_name": car.get("name", car_id),
                    "acquired_at": datetime.now(timezone.utc).isoformat(),
                })
                desc["cars"] = [car.get("name", car_id)]
    if updates:
        inc = {k: v for k, v in updates.items() if v}
        if inc:
            await db.users.update_one({"id": user_id}, {"$inc": inc})
    if token_updates:
        combined_updates = dict(token_updates)
        for k, v in unsellable_token_updates.items():
            combined_updates[k] = int(combined_updates.get(k, 0)) + int(v)
        await db.users.update_one({"id": user_id}, {"$inc": combined_updates})
    return desc


def _format_reward_desc(desc: dict) -> str:
    """Turn reward description dict into a short readable string."""
    if not desc:
        return "Nothing"
    parts = []
    if desc.get("money"):
        parts.append(f"${desc['money']:,}")
    if desc.get("points"):
        parts.append(f"{int(desc['points']):,} points")
    if desc.get("bullets"):
        parts.append(f"{desc['bullets']} bullets")
    if desc.get("tokens"):
        token_parts = []
        for token_type, amount in (desc.get("tokens") or {}).items():
            if not amount:
                continue
            label = _token_label(token_type)
            token_parts.append(f"{int(amount)} {label} token")
        if token_parts:
            parts.append(", ".join(token_parts))
    if desc.get("cars"):
        parts.append(", ".join(desc["cars"]))
    return ", ".join(parts) if parts else "Nothing"


async def _settle_game(game: dict):
    """Run payout (random rewards + pot) and mark game completed. Idempotent if already completed."""
    if game.get("status") == "completed":
        return
    # Atomic status transition to prevent concurrent settle calls from both paying
    lock = await db.entertainer_games.update_one(
        {"id": game["id"], "status": {"$ne": "completed"}},
        {"$set": {"status": "settling"}},
    )
    if lock.modified_count == 0:
        return
    participants = game.get("participants") or []
    now = datetime.now(timezone.utc).isoformat()
    if game.get("manual_roll"):
        # Manual games are creator-funded only; never inject system/house pots.
        cash_pot, house_bonus = int(game.get("pot") or 0), 0
    elif game.get("game_type") == "gbox":
        cash_pot, house_bonus = await _gbox_total_cash_pot(game)
    else:
        cash_pot, house_bonus = _house_bonus_pot_if_zero_stored_pot(game)
    result = None
    if participants:
        if game.get("game_type") == "dice":
            result = await _run_dice_payout(game)
        elif game.get("game_type") == "hangman":
            result = await _run_hangman_payout(game)
        else:
            result = await _run_gbox_payout(game, cash_pot)
    if cash_pot > 0 and participants:
        if game.get("game_type") in ("dice", "hangman") and result and result.get("winner_id"):
            await db.users.update_one({"id": result["winner_id"]}, {"$inc": {"money": cash_pot}})
        # gbox: cash already applied inside _run_gbox_payout
    set_doc = {"status": "completed", "completed_at": now, "result": result, "pot": cash_pot}
    if house_bonus > 0:
        set_doc["house_bonus_pot"] = house_bonus
    await db.entertainer_games.update_one(
        {"id": game["id"]},
        {"$set": set_doc},
    )
    # Notify each participant with their winnings
    if result and participants:
        game_type = game.get("game_type") or "dice"
        pot = cash_pot
        for p in participants:
            uid = p.get("user_id")
            if not uid:
                continue
            try:
                if game_type in ("dice", "hangman"):
                    winner_id = (result or {}).get("winner_id")
                    reward = (result or {}).get("reward")
                    if uid == winner_id and reward:
                        reward_money = int((reward or {}).get("money") or 0)
                        total_money = int(pot or 0) + reward_money
                        points = int((reward or {}).get("points") or 0)
                        points_str = f" + {points:,} points" if points > 0 else ""
                        msg = (
                            f"You won! Reward: {_format_reward_desc(reward)}. "
                            f"Pot: ${pot:,}. Total cash paid: ${total_money:,}{points_str}."
                        )
                    else:
                        winner_name = (result or {}).get("winner_username")
                        if game_type == "hangman" and not winner_name:
                            msg = f"Game over. No winner this round. Pot was ${pot:,}."
                        else:
                            msg = f"Game over. Winner: {winner_name or 'Someone'}. Pot was ${pot:,}. Better luck next time!"
                    title = "🧩 Hangman results" if game_type == "hangman" else "🎲 E-Game results"
                    await send_notification(uid, title, msg, "system", category="ent_games")
                else:
                    # gbox: each player got a reward
                    rewards = (result or {}).get("rewards_by_user") or {}
                    reward = rewards.get(uid)
                    if reward:
                        msg = f"You won: {_format_reward_desc(reward)}. Pot was ${pot:,}."
                    else:
                        msg = f"Game over. Pot was ${pot:,}."
                    await send_notification(uid, "🎁 E-Game results", msg, "system", category="ent_games")
            except Exception:
                pass


class CreateGameRequest(BaseModel):
    game_type: str  # manual create supports: "dice" | "gbox" (hangman is auto-only)
    max_players: int = 10
    join_fee: int = 0  # entry fee per player (added to pot when they join)
    pot: int = 0  # creator-funded pot (deducted from creator on create)
    manual_roll: bool = False  # if True, creator rolls when ready (no auto-settle by time)
    reward_money: int = 0  # manual dice: winner gets this cash; manual gbox: total cash pool split randomly among joiners
    reward_points: int = 0  # manual dice: winner gets this many points; manual gbox: total points pool split randomly among joiners
    topic_id: Optional[str] = None  # optional; when created from a topic


class HangmanGuessRequest(BaseModel):
    letter: str  # single A-Z letter


def _hangman_init_state() -> dict:
    entry = _rng.choice(HANGMAN_WORD_DATA)
    word = entry["word"]
    return {
        "word": word,
        "category": entry["category"],
        "clue": entry["clue"],
        "guessed_letters": [],       # all letters tried (correct + wrong)
        "wrong_letters": [],         # only incorrect letters
        "wrong_count": 0,            # drives hangman drawing — max MAX_HANGMAN_WRONG
        "letter_solvers": {},        # letter -> user_id (who guessed each correct letter)
        "letter_solved_at": {},      # letter -> ISO timestamp of correct guess
        "revealed_pattern": ["_"] * len(word),
        "solved_by": None,
        "solved_at": None,
    }


def _hangman_public_state(game: dict, current_user_id: Optional[str]) -> Optional[dict]:
    if game.get("game_type") != "hangman":
        return None
    state = game.get("hangman_state") or {}
    word = state.get("word") or ""
    guessed = list(state.get("guessed_letters") or [])
    wrong = list(state.get("wrong_letters") or [])
    wrong_count = int(state.get("wrong_count") or 0)
    solved = bool(state.get("solved_by"))
    revealed = state.get("revealed_pattern") or ["_"] * len(word)
    # Count how many letters in the word this user personally solved
    letter_solvers = state.get("letter_solvers") or {}
    my_letter_count = sum(1 for uid in letter_solvers.values() if uid == current_user_id) if current_user_id else 0
    out = {
        "category": state.get("category") or "",
        "word_length": len(word),
        "guessed_letters": guessed,
        "wrong_letters": wrong,
        "wrong_count": wrong_count,
        "max_wrong": MAX_HANGMAN_WRONG,
        "revealed_pattern": revealed if isinstance(revealed, list) else list(revealed),
        "my_letter_count": my_letter_count,
        "solved": solved,
        "solved_by": state.get("solved_by"),
        "solved_at": state.get("solved_at"),
        "game_over_no_solve": wrong_count >= MAX_HANGMAN_WRONG,
    }
    # Only reveal the clue text after 2 wrong guesses — not too easy, not hidden forever
    if wrong_count >= 2:
        out["clue"] = state.get("clue") or ""
    return out


def _with_public_hangman(game: dict, current_user_id: Optional[str]) -> dict:
    g = dict(game or {})
    if g.get("game_type") == "hangman":
        g["hangman"] = _hangman_public_state(g, current_user_id)
        if "hangman_state" in g:
            hs = dict(g.get("hangman_state") or {})
            hs.pop("word", None)
            hs.pop("clue", None)
            hs.pop("letter_solvers", None)
            hs.pop("letter_solved_at", None)
            g["hangman_state"] = hs
    return g


async def _run_dice_payout(game: dict):
    """One winner by roll; manual games use fixed cash/points rewards."""
    participants = game.get("participants") or []
    if not participants:
        return None
    n = len(participants)
    order = list(participants)
    _rng.shuffle(order)
    number_to_uid = {}
    assignments = []
    for i, p in enumerate(order):
        num = i + 1
        uid = p.get("user_id")
        if uid:
            number_to_uid[num] = uid
            assignments.append({"user_id": uid, "username": p.get("username"), "number": num})
    roll = _rng.randint(1, n)
    winner_id = number_to_uid.get(roll)
    winner_username = next((a["username"] for a in assignments if a["user_id"] == winner_id), None)
    reward = None
    if winner_id:
        manual_reward = game.get("manual_reward") or {}
        reward_money = max(0, int(manual_reward.get("money") or 0))
        reward_points = max(0, int(manual_reward.get("points") or 0))
        if game.get("manual_roll") and (reward_money > 0 or reward_points > 0):
            inc = {}
            if reward_money > 0:
                inc["money"] = reward_money
            if reward_points > 0:
                inc["points"] = reward_points
            if inc:
                await db.users.update_one({"id": winner_id}, {"$inc": inc})
            if reward_points > 0:
                await log_points_event(db, user_id=winner_id, points=reward_points, event_type="entertainer_payout", event_ref=game.get("id"))
            reward = {"reward_type": "manual", "money": reward_money, "points": reward_points, "bullets": 0, "cars": [], "tokens": {}}
        else:
            reward = await _give_random_reward(winner_id)
    return {"assignments": assignments, "roll": roll, "winner_id": winner_id, "winner_username": winner_username, "reward": reward}


async def _run_hangman_payout(game: dict):
    """Winner = participant who guessed the most correct letters.
    Tiebreak = whoever's latest correct letter had the earliest timestamp.
    No winner when hangman completes on wrong guesses without solving the word.
    """
    participants = game.get("participants") or []
    if not participants:
        return None
    state = game.get("hangman_state") or {}
    word = state.get("word") or _rng.choice([e["word"] for e in HANGMAN_WORD_DATA])
    letter_solvers = state.get("letter_solvers") or {}
    letter_solved_at = state.get("letter_solved_at") or {}
    # Count correct letters per participant and find their latest solve timestamp
    uid_scores: dict[str, dict] = {}
    for letter, uid in letter_solvers.items():
        if uid not in uid_scores:
            uid_scores[uid] = {"count": 0, "latest_at": ""}
        uid_scores[uid]["count"] += 1
        ts = letter_solved_at.get(letter) or ""
        if ts > uid_scores[uid]["latest_at"]:
            uid_scores[uid]["latest_at"] = ts
    winner_id = None
    winner_username = None
    word_solved = state.get("solved_by") is not None
    if word_solved:
        if uid_scores:
            # Sort: most letters first; tiebreak by earliest latest-timestamp
            ranked = sorted(uid_scores.keys(), key=lambda u: (-uid_scores[u]["count"], uid_scores[u]["latest_at"]))
            winner_id = ranked[0]
            winner_p = next((p for p in participants if p.get("user_id") == winner_id), None)
            winner_username = (winner_p or {}).get("username")
        if not winner_id:
            solved_by = state.get("solved_by")
            winner_id = solved_by if any((p.get("user_id") == solved_by) for p in participants) else None
            if winner_id:
                winner_p = next((p for p in participants if p.get("user_id") == winner_id), None)
                winner_username = (winner_p or {}).get("username")
    reward = None
    if winner_id:
        manual_reward = game.get("manual_reward") or {}
        reward_money = max(0, int(manual_reward.get("money") or 0))
        reward_points = max(0, int(manual_reward.get("points") or 0))
        if game.get("manual_roll") and (reward_money > 0 or reward_points > 0):
            inc = {}
            if reward_money > 0:
                inc["money"] = reward_money
            if reward_points > 0:
                inc["points"] = reward_points
            if inc:
                await db.users.update_one({"id": winner_id}, {"$inc": inc})
            if reward_points > 0:
                await log_points_event(db, user_id=winner_id, points=reward_points, event_type="entertainer_payout", event_ref=game.get("id"))
            reward = {"reward_type": "manual", "money": reward_money, "points": reward_points, "bullets": 0, "cars": [], "tokens": {}}
        else:
            reward = await _give_random_reward(winner_id)
    # revealed_pattern for history display
    revealed = state.get("revealed_pattern") or ["_"] * len(word)
    if isinstance(revealed, list):
        revealed_str = "".join(revealed)
    else:
        revealed_str = str(revealed)
    wrong_count = int(state.get("wrong_count") or 0)
    return {
        "winner_id": winner_id,
        "winner_username": winner_username,
        "reward": reward,
        "word": word,
        "revealed_pattern": revealed_str,
        "wrong_count": wrong_count,
        "solved_by_guess": bool(word_solved),
    }


async def _run_gbox_payout(game: dict, cash_pot: int):
    """Cash pot split randomly among all participants.
    Manual mode: reward_money / reward_points are totals split randomly (same as pot), not per-player.
    """
    participants = game.get("participants") or []
    if not participants:
        return None
    rows = [(p.get("user_id"), p) for p in participants if p.get("user_id")]
    if not rows:
        return None
    uids = [r[0] for r in rows]
    n = len(uids)
    pot_shares = _random_partition(int(cash_pot or 0), n)
    _rng.shuffle(pot_shares)
    rewards_by_user = {}
    manual_reward = game.get("manual_reward") or {}
    reward_money = max(0, int(manual_reward.get("money") or 0))
    reward_points = max(0, int(manual_reward.get("points") or 0))
    manual_mode = bool(game.get("manual_roll")) and (reward_money > 0 or reward_points > 0)
    rm_shares = _random_partition(reward_money, n) if (manual_mode and reward_money > 0) else [0] * n
    rp_shares = _random_partition(reward_points, n) if (manual_mode and reward_points > 0) else [0] * n
    if manual_mode and reward_money > 0:
        _rng.shuffle(rm_shares)
    if manual_mode and reward_points > 0:
        _rng.shuffle(rp_shares)
    for i, uid in enumerate(uids):
        pot_part = int(pot_shares[i]) if i < len(pot_shares) else 0
        rm = int(rm_shares[i]) if i < len(rm_shares) else 0
        rp = int(rp_shares[i]) if i < len(rp_shares) else 0
        inc = {}
        total_m = pot_part + rm
        if total_m:
            inc["money"] = total_m
        if rp:
            inc["points"] = rp
        if manual_mode:
            reward_desc = {
                "reward_type": "manual",
                "money": total_m,
                "points": rp,
                "bullets": 0,
                "cars": [],
                "tokens": {},
            }
        else:
            reward_desc = await _give_random_reward(uid, exclude_cash=True)
            reward_desc["money"] = int(pot_part)
        if inc:
            await db.users.update_one({"id": uid}, {"$inc": inc})
        if int(inc.get("points", 0)) > 0:
            await log_points_event(db, user_id=uid, points=int(inc["points"]), event_type="entertainer_payout", event_ref=game.get("id"))
        rewards_by_user[uid] = reward_desc
    return {"rewards_by_user": rewards_by_user, "total_cash_pot": int(cash_pot or 0)}


def _parse_iso(iso_str):
    if not iso_str:
        return None
    try:
        return datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


async def _maybe_auto_settle_open_games():
    """Settle all open (non-manual) games when we're in the '20 mins before next batch' window."""
    doc = await db.game_config.find_one(_game_config_doc_filter(ENTERTAINER_CONFIG_KEY), {"last_auto_create_at": 1})
    last_at = _parse_iso(doc.get("last_auto_create_at") if doc else None)
    if not last_at:
        return
    next_create = last_at + timedelta(seconds=AUTO_CREATE_INTERVAL_SECONDS)
    roll_at = next_create - timedelta(seconds=ROLL_BEFORE_NEXT_CREATE_SECONDS)
    now = datetime.now(timezone.utc)
    if now < roll_at:
        return
    open_games = await db.entertainer_games.find(
        {"status": "open", "manual_roll": {"$ne": True}},
        {"_id": 0},
    ).to_list(50)
    for g in open_games:
        await _settle_game(g)


async def settle_open_games_now():
    """Settle all open non-manual games (called by server task 20 mins before next batch)."""
    open_games = await db.entertainer_games.find(
        {"status": "open", "manual_roll": {"$ne": True}},
        {"_id": 0},
    ).to_list(50)
    for g in open_games:
        await _settle_game(g)


async def get_prizes(current_user: dict = Depends(get_current_user)):
    """Return possible prizes for E-Games (cash/bullets/tokens ranges and cars)."""
    rcfg = await _get_rewards_config()
    prize_cars = [
        {"name": c.get("name", c["id"]), "rarity": c.get("rarity", "common")}
        for c in CARS
        if c.get("id") not in ("car_custom", "car20") and c.get("rarity") in ("common", "uncommon", "rare")
    ]
    token_labels = [{"token_type": t, "label": _token_label(t)} for t in ENTERTAINER_TOKEN_TYPES]
    return {
        "cash": {"min": rcfg["cash_min"], "max": rcfg["cash_max"]},
        "bullets": {"min": rcfg["bullets_min"], "max": rcfg["bullets_max"]},
        "tokens": {"min": 1, "max": len(ENTERTAINER_TOKEN_TYPES), "types": token_labels},
        "cars": prize_cars,
    }


async def list_games(
    game_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """List entertainer games (open + recent completed). Auto-settles open games when 20 mins before next batch."""
    await _maybe_auto_settle_open_games()
    query = {}
    if game_type and game_type in ("dice", "gbox", "hangman"):
        query["game_type"] = game_type
    if status and status in ("open", "full", "completed"):
        query["status"] = status
    games = await db.entertainer_games.find(query, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"games": [_with_public_hangman(g, current_user.get("id")) for g in games]}


async def games_history(current_user: dict = Depends(get_current_user)):
    """Last 10 completed games with pot and winners for the entertainer forum."""
    games = await db.entertainer_games.find(
        {"status": "completed"},
        {"_id": 0, "id": 1, "game_type": 1, "pot": 1, "completed_at": 1, "result": 1, "participants": 1},
    ).sort("completed_at", -1).limit(10).to_list(10)
    out = []
    for g in games:
        r = g.get("result") or {}
        pot = g.get("pot") or 0
        if g.get("game_type") in ("dice", "hangman"):
            winner = r.get("winner_username") or "—"
            reward = r.get("reward")
            reward_text = _format_reward_desc(reward) if reward else None
            out.append({
                "id": g["id"], "game_type": g.get("game_type") or "dice", "pot": pot, "completed_at": g.get("completed_at"),
                "winner": winner, "reward_text": reward_text,
            })
        else:
            rewards = r.get("rewards_by_user") or {}
            participants = g.get("participants") or []
            winner_names = [p.get("username") or "?" for p in participants if p.get("user_id") in rewards]
            # Per-player reward summary for display (e.g. "Bob: $500, 10 pts")
            reward_summaries = []
            for p in participants:
                uid, name = p.get("user_id"), p.get("username") or "?"
                if uid in rewards:
                    reward_summaries.append(f"{name}: {_format_reward_desc(rewards[uid])}")
            out.append({
                "id": g["id"], "game_type": "gbox", "pot": pot, "completed_at": g.get("completed_at"),
                "winners": winner_names, "reward_text": ", ".join(reward_summaries) if reward_summaries else None,
            })
    return {"games": out}


async def get_game(game_id: str, current_user: dict = Depends(get_current_user)):
    """Get one game by id."""
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return {"game": _with_public_hangman(game, current_user.get("id"))}


async def create_game(
    request: CreateGameRequest,
    current_user: dict = Depends(get_current_user_verified),
):
    """Create a dice or gbox game. Non-admin users can only create manual-roll games."""
    is_admin = _is_admin(current_user)
    if request.game_type not in ("dice", "gbox"):
        raise HTTPException(status_code=400, detail="game_type must be dice or gbox")
    max_players = max(1, min(10, request.max_players))
    join_fee = max(0, int(request.join_fee or 0))
    pot = max(0, int(request.pot or 0))
    reward_money = max(0, int(request.reward_money or 0))
    reward_points = max(0, int(request.reward_points or 0))
    game_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    participants = []
    # Safety: keep non-admin created games manual-only even if the client sends false.
    manual_roll = bool(request.manual_roll) if is_admin else True
    if _is_entertainer(current_user) and not manual_roll:
        raise HTTPException(
            status_code=400,
            detail="Entertainment hosts fund manual dice/gbox games only — automatic batch games are created by the system.",
        )
    if manual_roll and reward_money <= 0 and reward_points <= 0:
        raise HTTPException(status_code=400, detail="Manual games must include a cash reward, points reward, or both.")
    if _is_entertainer(current_user) and request.game_type == "gbox" and reward_points > ENTERTAINER_GBOX_MAX_POINTS_PER_GAME:
        raise HTTPException(
            status_code=400,
            detail=f"Entertainer Gbox: total reward points cannot exceed {ENTERTAINER_GBOX_MAX_POINTS_PER_GAME:,} (from your entertainer fund).",
        )
    # Manual gbox: reward_money / reward_points are totals (split randomly at payout), not per-player.
    reserve_money = reward_money if manual_roll else 0
    reserve_points = reward_points if manual_roll else 0
    total_money_needed = int(pot + reserve_money)
    uid = current_user["id"]
    funded_via_entertainer = False
    # Creator must fully fund creator pot + manual rewards at create time (wallet or entertainer fund).
    if total_money_needed > 0 or reserve_points > 0:
        if _is_entertainer(current_user):
            ok = await try_debit_entertainer_fund(db, uid, float(total_money_needed), reserve_points)
            if not ok:
                need_parts = []
                if total_money_needed > 0:
                    need_parts.append(f"${total_money_needed:,} entertainer fund cash")
                if reserve_points > 0:
                    need_parts.append(f"{reserve_points:,} entertainer fund points")
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient entertainer fund to create this game. Required: {' and '.join(need_parts)}.",
                )
            funded_via_entertainer = True
            if reserve_points > 0:
                u_pts_read = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1})
                pts_before = int((u_pts_read or {}).get("points") or 0)
                await log_points_event(
                    db,
                    user_id=uid,
                    points=-reserve_points,
                    event_type="entertainer_forum_game_fund",
                    event_ref=game_id,
                    meta={"action": "create_reserve", "game_id": game_id, "from": "entertainer_fund"},
                    wallet_points_before=pts_before,
                    wallet_points_after=pts_before,
                )
        else:
            user_filter = {"id": uid}
            if total_money_needed > 0:
                user_filter["money"] = {"$gte": total_money_needed}
            if reserve_points > 0:
                user_filter["points"] = {"$gte": reserve_points}
            inc = {}
            if total_money_needed > 0:
                inc["money"] = -total_money_needed
            if reserve_points > 0:
                inc["points"] = -reserve_points
            result = await db.users.update_one(user_filter, {"$inc": inc})
            if result.modified_count == 0:
                need_parts = []
                if total_money_needed > 0:
                    need_parts.append(f"${total_money_needed:,}")
                if reserve_points > 0:
                    need_parts.append(f"{reserve_points:,} points")
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient balance to fund this game. Required: {' and '.join(need_parts)}.",
                )
            if reserve_points > 0:
                await log_points_event(db, user_id=uid, points=-reserve_points, event_type="entertainer_reserve", event_ref=game_id)
    topic_id = (request.topic_id or "").strip() or None
    doc = {
        "id": game_id,
        "game_type": request.game_type,
        "max_players": max_players,
        "join_fee": join_fee,
        "pot": pot,
        "creator_id": current_user["id"],
        "creator_username": current_user.get("username") or "?",
        "participants": participants,
        "status": "open",
        "created_at": now,
        "completed_at": None,
        "result": None,
        "manual_roll": manual_roll,
        "manual_reward": {"money": reward_money, "points": reward_points},
        "manual_reward_reserve": {"money": reserve_money, "points": reserve_points},
        "topic_id": topic_id,
        "entertainer_funded": funded_via_entertainer,
    }
    if request.game_type == "hangman":
        doc["hangman_state"] = _hangman_init_state()
    await db.entertainer_games.insert_one(doc)
    return {"id": game_id, "message": "Game created", "game": _with_public_hangman({**doc, "participants": participants}, current_user.get("id"))}


async def join_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
    """Join an open game. Pay join_fee if set (added to pot). If full after join, run payout automatically."""
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("status") != "open":
        raise HTTPException(status_code=400, detail="Game is not open to join")
    uid = current_user["id"]
    max_players = game.get("max_players", 10)
    join_fee = int(game.get("join_fee") or 0)
    if game.get("game_type") == "hangman" and not game.get("hangman_state"):
        await db.entertainer_games.update_one({"id": game_id}, {"$set": {"hangman_state": _hangman_init_state()}})
    if join_fee > 0:
        result = await db.users.update_one(
            {"id": current_user["id"], "money": {"$gte": join_fee}},
            {"$inc": {"money": -join_fee}}
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"Entry fee is ${join_fee:,}")
    participant_doc = {"user_id": current_user["id"], "username": current_user.get("username") or "?"}
    # Atomic join: only push if game is open, not already joined, and under max_players
    join_result = await db.entertainer_games.update_one(
        {
            "id": game_id,
            "status": "open",
            f"participants.{max_players - 1}": {"$exists": False},
            "participants.user_id": {"$ne": uid},
        },
        {"$push": {"participants": participant_doc}, "$inc": {"pot": join_fee}},
    )
    if join_result.modified_count == 0:
        if join_fee > 0:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": join_fee}})
        raise HTTPException(status_code=400, detail="Game is full or you already joined")
    # Re-read the game to check if now full
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    new_participants = game.get("participants") or []
    is_full = len(new_participants) >= max_players
    if is_full:
        # Same path as timed settle: house bonus if pot was 0, pot split, notifications, single DB write
        game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
        await _settle_game(game)
    updated = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    return {"message": "Joined game" + (" — rewards rolled!" if is_full else ""), "game": _with_public_hangman(updated, current_user.get("id"))}


async def guess_hangman(
    game_id: str,
    body: HangmanGuessRequest,
    current_user: dict = Depends(get_current_user_verified),
):
    """Submit a single-letter Hangman guess. Shared board across all participants.
    Correct: reveals letter positions in pattern.
    Wrong: increments wrong_count — game auto-settles at MAX_HANGMAN_WRONG.
    Word fully revealed: game auto-settles immediately.
    """
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("game_type") != "hangman":
        raise HTTPException(status_code=400, detail="This game is not hangman")
    if game.get("status") != "open":
        raise HTTPException(status_code=400, detail="Game is not open")
    uid = current_user["id"]
    participants = game.get("participants") or []
    if not any((p.get("user_id") == uid) for p in participants):
        raise HTTPException(status_code=403, detail="Join the game first")
    state = game.get("hangman_state") or _hangman_init_state()
    if state.get("solved_by") or int(state.get("wrong_count") or 0) >= MAX_HANGMAN_WRONG:
        raise HTTPException(status_code=400, detail="Game is already over")
    # Validate: single A-Z letter
    letter = (body.letter or "").strip().upper()
    if len(letter) != 1 or not letter.isalpha():
        raise HTTPException(status_code=400, detail="Guess must be a single letter A-Z")
    guessed = list(state.get("guessed_letters") or [])
    if letter in guessed:
        raise HTTPException(status_code=400, detail=f"Letter '{letter}' has already been guessed")
    word = (state.get("word") or "").strip().upper()
    now_iso = datetime.now(timezone.utc).isoformat()
    guessed.append(letter)
    wrong_letters = list(state.get("wrong_letters") or [])
    wrong_count = int(state.get("wrong_count") or 0)
    letter_solvers = dict(state.get("letter_solvers") or {})
    letter_solved_at = dict(state.get("letter_solved_at") or {})
    revealed = list(state.get("revealed_pattern") or ["_"] * len(word))
    # Expand revealed to list if stored as string
    if isinstance(revealed, str):
        revealed = list(revealed)
    correct = letter in word
    if correct:
        for i, ch in enumerate(word):
            if ch == letter:
                revealed[i] = letter
        letter_solvers[letter] = uid
        letter_solved_at[letter] = now_iso
    else:
        wrong_letters.append(letter)
        wrong_count += 1
    new_state = dict(state)
    new_state["guessed_letters"] = guessed
    new_state["wrong_letters"] = wrong_letters
    new_state["wrong_count"] = wrong_count
    new_state["letter_solvers"] = letter_solvers
    new_state["letter_solved_at"] = letter_solved_at
    new_state["revealed_pattern"] = revealed
    word_solved = "_" not in revealed and all(ch != "_" for ch in revealed)
    game_over_wrong = wrong_count >= MAX_HANGMAN_WRONG
    if word_solved:
        new_state["solved_by"] = uid
        new_state["solved_at"] = now_iso
    await db.entertainer_games.update_one({"id": game_id, "status": "open"}, {"$set": {"hangman_state": new_state}})
    updated = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Game not found")
    should_settle = word_solved or game_over_wrong
    if should_settle and updated.get("status") == "open":
        await _settle_game(updated)
        updated = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if word_solved:
        msg = f"'{letter}' — word solved! Game settled."
    elif game_over_wrong:
        msg = f"'{letter}' — wrong! Hangman complete ({wrong_count}/{MAX_HANGMAN_WRONG})."
    elif correct:
        msg = f"'{letter}' is in the word!"
    else:
        msg = f"'{letter}' not in word ({wrong_count}/{MAX_HANGMAN_WRONG} misses)"
    return {
        "message": msg,
        "correct": bool(correct),
        "word_solved": bool(word_solved),
        "game_over": bool(game_over_wrong),
        "wrong_count": wrong_count,
        "game": _with_public_hangman(updated, uid),
    }


# ---------- Manual roll: admin or creator (for manual_roll games) ----------
async def admin_roll_game(game_id: str, current_user: dict = Depends(get_current_user_verified)):
    """Force settle (roll) an open game now. Admin can always roll; creator can roll if game is manual_roll."""
    game = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Game already completed")
    is_admin = _is_admin(current_user)
    is_creator = game.get("creator_id") == current_user["id"] and game.get("creator_id") != "system"
    if not is_admin and not (is_creator and game.get("manual_roll")):
        raise HTTPException(status_code=403, detail="Only the game creator can roll manual games; admins can roll any game.")
    await _settle_game(game)
    updated = await db.entertainer_games.find_one({"id": game_id}, {"_id": 0})
    return {"message": "Game rolled", "game": updated}


# ---------- Admin: entertainer reward config ----------
async def get_rewards_config_admin(current_user: dict = Depends(get_current_user)):
    """Admin only: get current E-Game reward configuration."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    rcfg = await _get_rewards_config()
    return rcfg


class EntertainerRewardsConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    cash_min: Optional[int] = None
    cash_max: Optional[int] = None
    bullets_min: Optional[int] = None
    bullets_max: Optional[int] = None
    reward_type_weights: Optional[dict] = None


async def update_rewards_config_admin(
    body: EntertainerRewardsConfigUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Admin only: update E-Game reward ranges and/or type weights."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    current = await _get_rewards_config()
    update = {}
    if body.cash_min is not None:
        if body.cash_min < 0:
            raise HTTPException(status_code=400, detail="cash_min must be >= 0")
        update["cash_min"] = body.cash_min
    if body.cash_max is not None:
        if body.cash_max < 0:
            raise HTTPException(status_code=400, detail="cash_max must be >= 0")
        update["cash_max"] = body.cash_max
    if body.bullets_min is not None:
        if body.bullets_min < 0:
            raise HTTPException(status_code=400, detail="bullets_min must be >= 0")
        update["bullets_min"] = body.bullets_min
    if body.bullets_max is not None:
        if body.bullets_max < 0:
            raise HTTPException(status_code=400, detail="bullets_max must be >= 0")
        update["bullets_max"] = body.bullets_max

    cm = update.get("cash_min", current["cash_min"])
    cx = update.get("cash_max", current["cash_max"])
    if cx < cm:
        raise HTTPException(status_code=400, detail="cash_max must be >= cash_min")
    bm = update.get("bullets_min", current["bullets_min"])
    bx = update.get("bullets_max", current["bullets_max"])
    if bx < bm:
        raise HTTPException(status_code=400, detail="bullets_max must be >= bullets_min")

    if body.reward_type_weights is not None:
        valid_keys = set(DEFAULT_REWARD_TYPE_WEIGHTS.keys())
        merged_weights = dict(current["reward_type_weights"])
        for k, v in body.reward_type_weights.items():
            if k not in valid_keys:
                raise HTTPException(status_code=400, detail=f"Unknown reward type: {k}")
            if isinstance(v, bool):
                raise HTTPException(status_code=400, detail=f"Weight for '{k}' must be a non-negative number")
            try:
                w = int(float(v))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Weight for '{k}' must be a non-negative number")
            if w < 0:
                raise HTTPException(status_code=400, detail=f"Weight for '{k}' must be >= 0")
            merged_weights[k] = w
        total_w = sum(int(x) for x in merged_weights.values())
        if total_w <= 0:
            raise HTTPException(status_code=400, detail="Sum of reward type weights must be greater than 0")
        update["reward_type_weights"] = merged_weights
    if not update:
        raise HTTPException(status_code=400, detail="No changes provided")
    await db.game_config.update_one(
        _game_config_doc_filter(ENTERTAINER_REWARDS_CONFIG_KEY),
        {
            "$set": {
                **update,
                "id": ENTERTAINER_REWARDS_CONFIG_KEY,
                "key": ENTERTAINER_REWARDS_CONFIG_KEY,
            }
        },
        upsert=True,
    )
    _invalidate_rewards_config_cache()
    new_cfg = await _get_rewards_config()
    return {"message": "Rewards config updated", **new_cfg}


# ---------- Admin: entertainer config (auto-create on/off) ----------
async def get_entertainer_config(current_user: dict = Depends(get_current_user)):
    """Get entertainer config (auto_create_enabled, last/next run). Anyone can read."""
    doc = await db.game_config.find_one(_game_config_doc_filter(ENTERTAINER_CONFIG_KEY), {"_id": 0, "key": 0})
    if not doc:
        return {
            "auto_create_enabled": False,
            "find_word_auto_enabled": False,
            "last_auto_create_at": None,
            "next_auto_create_at": None,
            "last_find_word_auto_at": None,
        }
    last_at = doc.get("last_auto_create_at")
    next_at = None
    if last_at:
        last_dt = _parse_iso(last_at)
        if last_dt:
            next_dt = last_dt + timedelta(seconds=AUTO_CREATE_INTERVAL_SECONDS)
            next_at = next_dt.isoformat()
    return {
        "auto_create_enabled": doc.get("auto_create_enabled", False),
        "find_word_auto_enabled": doc.get("find_word_auto_enabled", False),
        "last_auto_create_at": last_at,
        "next_auto_create_at": next_at,
        "last_find_word_auto_at": doc.get("last_find_word_auto_at"),
    }


class EntertainerConfigUpdate(BaseModel):
    auto_create_enabled: Optional[bool] = None
    find_word_auto_enabled: Optional[bool] = None


async def update_entertainer_config(
    body: EntertainerConfigUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Admin only: enable/disable auto-create games every 3 hours and optional word-hunt auto."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    if body.auto_create_enabled is None and body.find_word_auto_enabled is None:
        raise HTTPException(status_code=400, detail="No changes provided")
    set_doc: dict = {"key": ENTERTAINER_CONFIG_KEY, "id": ENTERTAINER_CONFIG_KEY}
    if body.auto_create_enabled is not None:
        set_doc["auto_create_enabled"] = body.auto_create_enabled
    if body.find_word_auto_enabled is not None:
        set_doc["find_word_auto_enabled"] = body.find_word_auto_enabled
    await db.game_config.update_one(
        _game_config_doc_filter(ENTERTAINER_CONFIG_KEY),
        {"$set": set_doc},
        upsert=True,
    )
    return await get_entertainer_config(current_user)


# ---------- Admin: create 3–5 system games now and notify all ----------
async def _create_system_game(game_type: str, max_players: int) -> dict:
    """Create one open game with no creator (system). Free to join; winnings are random (cash, bullets, tokens, cars)."""
    game_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": game_id,
        "game_type": game_type,
        "max_players": max_players,
        "join_fee": 0,
        "pot": 0,
        "creator_id": "system",
        "creator_username": "System",
        "participants": [],
        "status": "open",
        "created_at": now,
        "completed_at": None,
        "result": None,
    }
    if game_type == "hangman":
        doc["hangman_state"] = _hangman_init_state()
    await db.entertainer_games.insert_one(doc)
    return doc


async def admin_auto_create_now(current_user: dict = Depends(get_current_user)):
    """Admin only: create 3–5 system games now and send notification to all users. Blocked if open games at cap (DB)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    open_count = await _count_open_entertainer_games()
    if open_count >= MAX_OPEN_ENTERTAINER_GAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many open games ({open_count}). Roll or wait for some to settle before creating more (max {MAX_OPEN_ENTERTAINER_GAMES}).",
        )
    n = _rng.randint(3, 5)
    n = min(n, MAX_OPEN_ENTERTAINER_GAMES - open_count)
    created = []
    for _ in range(n):
        game_type = _rng.choice(["dice", "gbox", "hangman"])
        max_players = _rng.randint(2, 10)
        g = await _create_system_game(game_type, max_players)
        created.append(g)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.game_config.update_one(
        _game_config_doc_filter(ENTERTAINER_CONFIG_KEY),
        {
            "$set": {
                "id": ENTERTAINER_CONFIG_KEY,
                "key": ENTERTAINER_CONFIG_KEY,
                "last_auto_create_at": now_iso,
            }
        },
        upsert=True,
    )
    try:
        await send_notification_to_all(
            "🎲 New E-Games",
            f"{len(created)} new dice, gbox & hangman games are open in the Entertainer Forum! Join now.",
            "system",
            category="ent_games",
            message_link_to="/social/forum?tab=entertainer",
            message_link_label="Entertainer Forum",
        )
    except Exception:
        pass  # Don't fail the request if notification fails; games were already created
    return {"message": f"Created {len(created)} games", "count": len(created), "games": created}


async def _count_open_entertainer_games() -> int:
    """Number of games that are open or full (not yet completed). Used to enforce MAX_OPEN_ENTERTAINER_GAMES."""
    return await db.entertainer_games.count_documents({"status": {"$in": ["open", "full"]}})


async def run_auto_create_if_enabled():
    """Called by scheduled task every 3h: if auto_create_enabled, create 3–5 games and notify.
    Always runs find-word auto (if enabled in config) at the end of the cycle."""
    doc = await db.game_config.find_one(_game_config_doc_filter(ENTERTAINER_CONFIG_KEY), {"_id": 0})
    now = datetime.now(timezone.utc)
    if doc and doc.get("auto_create_enabled"):
        last_at = _parse_iso(doc.get("last_auto_create_at"))
        if not (last_at and (now - last_at).total_seconds() < AUTO_CREATE_INTERVAL_SECONDS - 60):
            open_count = await _count_open_entertainer_games()
            if open_count < MAX_OPEN_ENTERTAINER_GAMES:
                n = _rng.randint(3, 5)
                n = min(n, MAX_OPEN_ENTERTAINER_GAMES - open_count)
                if n > 0:
                    for _ in range(n):
                        game_type = _rng.choice(["dice", "gbox", "hangman"])
                        max_players = _rng.randint(2, 10)
                        await _create_system_game(game_type, max_players)
                    now_iso = now.isoformat()
                    await db.game_config.update_one(
                        _game_config_doc_filter(ENTERTAINER_CONFIG_KEY),
                        {
                            "$set": {
                                "id": ENTERTAINER_CONFIG_KEY,
                                "key": ENTERTAINER_CONFIG_KEY,
                                "last_auto_create_at": now_iso,
                            }
                        },
                        upsert=True,
                    )
                    await send_notification_to_all(
                        "🎲 New E-Games",
                        f"{n} new dice, gbox & hangman games are open in the Entertainer Forum! Join now.",
                        "system",
                        category="ent_games",
                        message_link_to="/social/forum?tab=entertainer",
                        message_link_label="Entertainer Forum",
                    )
    await _try_auto_create_find_word_round()


# ---------- Find the word (hidden hunt) ----------
FIND_WORD_PREVIOUS_WINNER_EXCLUDE_MSG = (
    "You won the last word hunt — you're excluded from this round only. You can win again starting with the next hunt."
)


async def _find_word_last_completed_winner_user_id() -> Optional[str]:
    """Most recently completed round with a recorded winner (for sit-out-next-round rule)."""
    doc = await db.entertainer_find_word_rounds.find_one(
        {"status": "completed", "winner_user_id": {"$nin": [None, ""]}},
        {"_id": 0, "winner_user_id": 1},
        sort=[("completed_at", -1)],
    )
    if not doc:
        return None
    wid = doc.get("winner_user_id")
    return str(wid).strip() if wid else None


def _find_word_hint_for_round(doc: dict) -> str:
    raw = (doc.get("hint") or "").strip()
    if raw:
        return raw
    return "Somewhere in the game UI while you’re logged in — look for one unobtrusive word."


async def insert_find_word_round(*, created_by: str, created_by_label: str, notify_all: bool) -> Optional[dict]:
    """Create one open round if none open. Returns inserted doc or None."""
    words = FIND_WORD_WORDS or ["MAFIA", "HEIST", "RACKET"]
    existing = await db.entertainer_find_word_rounds.find_one({"status": "open"}, {"_id": 0, "id": 1})
    if existing:
        return None
    word = str(_rng.choice(words))
    hint = str(_rng.choice(FIND_WORD_HINTS)) if FIND_WORD_HINTS else _find_word_hint_for_round({})
    round_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": round_id,
        "word": word.upper(),
        "hint": hint,
        "status": "open",
        "placement_kind": "anywhere",
        "placement_topic_id": None,
        "winner_user_id": None,
        "winner_username": None,
        "reward": None,
        "created_at": now,
        "completed_at": None,
        "created_by": created_by,
        "created_by_label": created_by_label,
    }
    await db.entertainer_find_word_rounds.insert_one(doc)
    if notify_all:
        try:
            await send_notification_to_all(
                "🔎 Word hunt",
                f"{hint} First to find and tap the hidden word wins an E-Game style prize. Extra context: Entertainer Forum tab.",
                "system",
                category="ent_games",
                message_link_to="/social/forum?tab=entertainer",
                message_link_label="Entertainer Forum",
            )
        except Exception:
            pass
    return doc


async def find_word_active(current_user: dict = Depends(get_current_user)):
    r = await db.entertainer_find_word_rounds.find_one({"status": "open"}, {"_id": 0})
    if not r:
        return {"active": False}
    hint = _find_word_hint_for_round(r)
    uid = str((current_user or {}).get("id") or "").strip()
    last_winner = await _find_word_last_completed_winner_user_id()
    can_claim = not (uid and last_winner and uid == last_winner)
    out = {
        "active": True,
        "round_id": r["id"],
        "hint": hint,
        "can_claim": can_claim,
        "placement": {
            "kind": r.get("placement_kind") or "anywhere",
            "topic_id": r.get("placement_topic_id"),
        },
    }
    if can_claim:
        out["word"] = r.get("word") or ""
    else:
        out["word"] = ""
        out["ineligible_reason"] = FIND_WORD_PREVIOUS_WINNER_EXCLUDE_MSG
    return out


async def find_word_history(
    limit: int = Query(10, ge=1, le=30),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.entertainer_find_word_rounds.find(
        {"status": "completed"},
        {
            "_id": 0,
            "id": 1,
            "word": 1,
            "winner_username": 1,
            "reward": 1,
            "completed_at": 1,
            "placement_kind": 1,
        },
    ).sort("completed_at", -1).limit(limit).to_list(limit)
    out = []
    for row in rows:
        rw = row.get("reward") or {}
        out.append(
            {
                "id": row.get("id"),
                "word": row.get("word"),
                "winner_username": row.get("winner_username"),
                "placement_kind": row.get("placement_kind"),
                "completed_at": row.get("completed_at"),
                "reward_text": _format_reward_desc(rw) if rw else None,
            }
        )
    return {"rounds": out}


class FindWordClaimBody(BaseModel):
    round_id: str = Field(..., min_length=8, max_length=80)


async def find_word_claim(body: FindWordClaimBody, current_user: dict = Depends(get_current_user_verified)):
    rid = (body.round_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="round_id required")
    u = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "is_dead": 1, "username": 1})
    if not u:
        raise HTTPException(status_code=400, detail="Account not found")
    if u.get("is_dead"):
        raise HTTPException(status_code=400, detail="Dead accounts cannot claim")
    uname = (u.get("username") or current_user.get("username") or "?").strip() or "?"
    uid = str(current_user.get("id") or "").strip()
    last_winner = await _find_word_last_completed_winner_user_id()
    if uid and last_winner and uid == last_winner:
        raise HTTPException(status_code=403, detail=FIND_WORD_PREVIOUS_WINNER_EXCLUDE_MSG)
    now = datetime.now(timezone.utc).isoformat()
    updated = await db.entertainer_find_word_rounds.find_one_and_update(
        {"id": rid, "status": "open"},
        {
            "$set": {
                "status": "completed",
                "winner_user_id": current_user["id"],
                "winner_username": uname,
                "completed_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        still = await db.entertainer_find_word_rounds.find_one({"id": rid}, {"_id": 0, "status": 1, "winner_username": 1})
        if not still:
            raise HTTPException(status_code=404, detail="Round not found")
        raise HTTPException(
            status_code=409,
            detail=f"Already found — won by {still.get('winner_username') or 'someone else'}",
        )
    reward = None
    try:
        reward = await _give_random_reward(current_user["id"])
        await db.entertainer_find_word_rounds.update_one({"id": rid}, {"$set": {"reward": reward}})
        await send_notification(
            current_user["id"],
            "Word hunt winner",
            f"You found the hidden word! {_format_reward_desc(reward)}",
            "reward",
            category="ent_games",
        )
    except Exception:
        logging.exception("find_word_claim reward failed round_id=%s user=%s", rid, current_user.get("id"))
        await db.entertainer_find_word_rounds.update_one(
            {"id": rid},
            {
                "$set": {
                    "status": "open",
                    "winner_user_id": None,
                    "winner_username": None,
                    "completed_at": None,
                }
            },
        )
        raise HTTPException(status_code=500, detail="Could not apply reward; try again or contact staff")
    return {
        "ok": True,
        "message": f"You won! {_format_reward_desc(reward)}",
        "reward": reward,
    }


async def find_word_admin_start(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    doc = await insert_find_word_round(
        created_by=current_user["id"],
        created_by_label="admin",
        notify_all=True,
    )
    if not doc:
        raise HTTPException(status_code=400, detail="A word hunt round is already open")
    return {
        "message": "Word hunt started",
        "round_id": doc["id"],
        "hint": doc.get("hint"),
        "placement": {"kind": doc.get("placement_kind"), "topic_id": doc.get("placement_topic_id")},
    }


async def _try_auto_create_find_word_round():
    doc = await db.game_config.find_one(_game_config_doc_filter(ENTERTAINER_CONFIG_KEY), {"_id": 0})
    if not doc or not doc.get("find_word_auto_enabled"):
        return
    if await db.entertainer_find_word_rounds.find_one({"status": "open"}, {"_id": 0, "id": 1}):
        return
    last_at = _parse_iso(doc.get("last_find_word_auto_at"))
    now = datetime.now(timezone.utc)
    if last_at and (now - last_at).total_seconds() < AUTO_CREATE_INTERVAL_SECONDS - 60:
        return
    ins = await insert_find_word_round(created_by="system", created_by_label="System", notify_all=True)
    if ins:
        await db.game_config.update_one(
            _game_config_doc_filter(ENTERTAINER_CONFIG_KEY),
            {
                "$set": {
                    "id": ENTERTAINER_CONFIG_KEY,
                    "key": ENTERTAINER_CONFIG_KEY,
                    "last_find_word_auto_at": now.isoformat(),
                }
            },
            upsert=True,
        )


def register(router):
    _ent_rl_u = [Depends(_entertainer_sustained_rl_user)]
    _ent_rl_v = [Depends(_entertainer_sustained_rl_verified)]
    _ent_rl_join = [Depends(_entertainer_sustained_rl_verified), Depends(_entertainer_join_spam_guard)]
    router.add_api_route("/forum/entertainer/find-word/active", find_word_active, methods=["GET"], dependencies=_ent_rl_u)
    router.add_api_route("/forum/entertainer/find-word/history", find_word_history, methods=["GET"], dependencies=_ent_rl_u)
    router.add_api_route("/forum/entertainer/find-word/claim", find_word_claim, methods=["POST"], dependencies=_ent_rl_v)
    router.add_api_route("/forum/entertainer/find-word/admin/start", find_word_admin_start, methods=["POST"])
    router.add_api_route("/forum/entertainer/prizes", get_prizes, methods=["GET"], dependencies=_ent_rl_u)
    router.add_api_route("/forum/entertainer/games", list_games, methods=["GET"], dependencies=_ent_rl_u)
    router.add_api_route("/forum/entertainer/games", create_game, methods=["POST"], dependencies=_ent_rl_v)
    router.add_api_route("/forum/entertainer/games/history", games_history, methods=["GET"], dependencies=_ent_rl_u)
    router.add_api_route("/forum/entertainer/games/{game_id}", get_game, methods=["GET"], dependencies=_ent_rl_u)
    router.add_api_route("/forum/entertainer/games/{game_id}/join", join_game, methods=["POST"], dependencies=_ent_rl_join)
    router.add_api_route("/forum/entertainer/games/{game_id}/guess", guess_hangman, methods=["POST"], dependencies=_ent_rl_v)
    router.add_api_route("/forum/entertainer/games/{game_id}/roll", admin_roll_game, methods=["POST"])
    router.add_api_route("/forum/entertainer/admin/config", get_entertainer_config, methods=["GET"])
    router.add_api_route("/forum/entertainer/admin/config", update_entertainer_config, methods=["PATCH"])
    router.add_api_route("/forum/entertainer/admin/auto-create", admin_auto_create_now, methods=["POST"])
    router.add_api_route("/forum/entertainer/admin/rewards", get_rewards_config_admin, methods=["GET"])
    router.add_api_route("/forum/entertainer/admin/rewards", update_rewards_config_admin, methods=["PATCH"])