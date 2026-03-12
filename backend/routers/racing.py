# Racing: bootleg runs / road races (1920s-30s). Choose from historical cars, create/join races, fill with NPCs, simulate, rewards, leaderboard, comps.
from datetime import datetime, timezone, timedelta
import random
import uuid
from typing import Optional, List, Dict, Any
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user_verified, get_current_user, maybe_process_rank_up

# ---------- Constants ----------
def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

# Racing cars: 4–5 historically accurate (1920s–30s). Choose one, no purchase. id, name, base_speed, base_grip, image
RACING_CARS: List[dict] = [
    {"id": "ford_model_t_racer", "name": "Ford Model T Racer", "base_speed": 10, "base_grip": 0.92, "image": "/images/gta/car1.jpg"},
    {"id": "packard_734", "name": "Packard 734", "base_speed": 14, "base_grip": 0.88, "image": "/images/gta/car11.jpg"},
    {"id": "stutz_bearcat", "name": "Stutz Bearcat", "base_speed": 18, "base_grip": 0.85, "image": "/images/gta/car14.jpg"},
    {"id": "miller_91", "name": "Miller 91", "base_speed": 22, "base_grip": 0.78, "image": "/images/gta/car15.jpeg"},
    {"id": "duesenberg_model_j", "name": "Duesenberg Model J", "base_speed": 26, "base_grip": 0.82, "image": "/images/gta/car18.jpg"},
]

TRACKS: List[dict] = [
    {"id": "chicago_board", "name": "Chicago Board Track", "reward_mult": 1.0},
    {"id": "daytona_beach", "name": "Daytona Beach Road Course", "reward_mult": 1.2},
    {"id": "roosevelt", "name": "Roosevelt Raceway", "reward_mult": 1.1},
    {"id": "indianapolis", "name": "Indianapolis Motor Speedway", "reward_mult": 1.3},
]

RACING_NPCS: List[dict] = [
    {"id": "npc_smokey", "name": "Smokey Joe", "base_speed_offset": -1},
    {"id": "npc_ace", "name": "Ace Johnson", "base_speed_offset": 0},
    {"id": "npc_whiskey", "name": "The Whiskey Runner", "base_speed_offset": 1},
    {"id": "npc_bigmike", "name": "Big Mike", "base_speed_offset": -2},
    {"id": "npc_lucky", "name": "Lucky Lou", "base_speed_offset": 0},
    {"id": "npc_fast_eddie", "name": "Fast Eddie", "base_speed_offset": 2},
    {"id": "npc_phantom", "name": "The Phantom", "base_speed_offset": 1},
    {"id": "npc_duke", "name": "Duke Malone", "base_speed_offset": -1},
    {"id": "npc_slick", "name": "Slick Sam", "base_speed_offset": 0},
    {"id": "npc_rusty", "name": "Rusty Wheeler", "base_speed_offset": -2},
]

MAX_GRID = 8
MIN_GRID = 2
RACE_LOBBY_COUNTDOWN_SEC = 45
ENTRY_FEE_MIN = 0
ENTRY_FEE_MAX = 5_000_000
REWARD_POOL_PCT = 0.9
REWARD_BY_POSITION = [0.40, 0.25, 0.15, 0.10, 0.05, 0.03, 0.02, 0.00]
RANK_POINTS_BY_POSITION = [15, 10, 6, 4, 2, 1, 0, 0]
RACING_REP_BY_POSITION = [5, 3, 2, 1, 0, 0, 0, 0]

CREW_UPGRADE_COSTS = [0, 50000, 120000, 250000, 500000, 1000000]
CREW_BONUS_PER_LEVEL = 0.02
CAR_UPGRADE_COSTS = [0, 20000, 50000, 100000, 200000]
# Engine wear: per race %, repair cost per %, replace cost. At high wear, risk of speed limit or DNF during race.
ENGINE_WEAR_PER_RACE = 8
ENGINE_WEAR_MAX = 100
ENGINE_REPAIR_COST_PER_PCT = 400
ENGINE_REPLACE_COST = 75000
ENGINE_RISK_THRESHOLD = 75  # wear >= this: chance per lap of issues
ENGINE_DNF_CHANCE_PER_LAP_AT_100 = 0.12  # at 100% wear, ~12% per lap to DNF
ENGINE_SPEED_PENALTY_AT_RISK = 0.85  # speed mult when "engine issues" but no DNF
# Tyre stock: per compound, cost per set, initial stock for new players
TYRE_STOCK_INITIAL = 5
TYRE_COST_SOFT = 800
TYRE_COST_MEDIUM = 500
TYRE_COST_HARD = 400
# Trade-offs: engine +power -grip, tires +grip -power, aero +speed -grip (unlock 1+ win), reliability -wear -power (unlock 1+ win)
ENGINE_POWER_PER_LEVEL = 0.04
ENGINE_GRIP_PENALTY_PER_LEVEL = 0.03
TIRES_GRIP_PER_LEVEL = 0.05
TIRES_POWER_PENALTY_PER_LEVEL = 0.02
AERO_SPEED_PER_LEVEL = 0.03
AERO_GRIP_PENALTY_PER_LEVEL = 0.02
RELIABILITY_WEAR_REDUCTION_PER_LEVEL = 0.08
RELIABILITY_POWER_PENALTY_PER_LEVEL = 0.02
WINS_FOR_AERO_RELIABILITY = 1
WINS_FOR_CHAMPIONSHIP_UPGRADE = 3
CHAMPIONSHIP_UPGRADE_COST = 350000
MAX_CREW_LEVEL = 5
MAX_CAR_UPGRADE_LEVEL = 4
MAX_AERO_LEVEL = 2
MAX_RELIABILITY_LEVEL = 2
NUM_LAPS_MIN = 2
NUM_LAPS_MAX = 20
TIRE_WEAR_PER_LAP = 18
# Pit a lap before tires are gone: ~18 wear/lap → pit when below 50 so next lap wouldn't kill tires
TIRE_PIT_THRESHOLD = 50
PIT_PENALTY_FACTOR = 0.72  # speed multiplier when pitting (lose time that lap)

# Tyre compounds: wear_mult (per lap), grip_mult (lap score)
TYRE_COMPOUNDS = [
    {"id": "soft", "name": "Soft", "wear_mult": 1.45, "grip_mult": 1.06},
    {"id": "medium", "name": "Medium", "wear_mult": 1.0, "grip_mult": 1.0},
    {"id": "hard", "name": "Hard", "wear_mult": 0.65, "grip_mult": 0.96},
]

# Weather: affects tire wear and grip/speed. Set when race starts (random).
WEATHER_TYPES = [
    {"id": "clear", "name": "Clear", "tire_wear_mult": 1.0, "speed_mult": 1.0},
    {"id": "rain", "name": "Rain", "tire_wear_mult": 1.55, "speed_mult": 0.90},
    {"id": "snow", "name": "Snow", "tire_wear_mult": 2.0, "speed_mult": 0.82},
    {"id": "very_hot", "name": "Very hot", "tire_wear_mult": 1.45, "speed_mult": 0.95},
]

def _get_weather(weather_id: str) -> dict:
    for w in WEATHER_TYPES:
        if w.get("id") == weather_id:
            return w
    return WEATHER_TYPES[0]

DEFAULT_PROFILE = {
    "mechanic_level": 0,
    "pit_level": 0,
    "racing_rep": 0,
    "wins": 0,
    "races_completed": 0,
    "selected_racing_car_id": None,
    "tyre_stock_soft": TYRE_STOCK_INITIAL,
    "tyre_stock_medium": TYRE_STOCK_INITIAL,
    "tyre_stock_hard": TYRE_STOCK_INITIAL,
}


# ---------- Pydantic ----------
class CreateRaceRequest(BaseModel):
    track_id: str
    entry_fee: int = 0
    max_grid: int = 6
    laps: int = 3
    tyre_compound: str = "medium"  # soft, medium, hard
    weather_id: Optional[str] = None  # clear, rain, snow, very_hot; if omitted, random at create


class JoinRaceRequest(BaseModel):
    racing_car_instance_id: str
    tyre_compound: str = "medium"  # soft, medium, hard


class UpgradeCrewRequest(BaseModel):
    crew_type: str


class UpgradeCarRequest(BaseModel):
    racing_car_instance_id: str
    upgrade_type: str = "engine"  # engine | tires | aero | reliability | championship


class BuyRacingCarRequest(BaseModel):
    racing_car_id: str


class SetSelectedCarRequest(BaseModel):
    racing_car_instance_id: Optional[str] = None
    racing_car_id: Optional[str] = None


class RepairEngineRequest(BaseModel):
    racing_car_instance_id: str
    target_wear: Optional[float] = None  # default 0 = full repair


class ReplaceEngineRequest(BaseModel):
    racing_car_instance_id: str


class BuyTyresRequest(BaseModel):
    compound: str = "medium"  # soft, medium, hard
    quantity: int = 1


# ---------- Helpers ----------
def _get_racing_car(car_id: str) -> Optional[dict]:
    for c in RACING_CARS:
        if c.get("id") == car_id:
            return c
    return None


def _car_tier_index(car_id: str) -> int:
    """Index 0..len(RACING_CARS)-1 for similar-level NPC selection."""
    for i, c in enumerate(RACING_CARS):
        if c.get("id") == car_id:
            return i
    return 0


def _effective_speed_and_grip_display(entrant: dict, profile: Optional[dict], upgrades_map: Dict[str, dict]) -> tuple:
    """Deterministic (speed, grip) for replay display, no random."""
    car_def = _get_racing_car(entrant.get("racing_car_id") or "")
    base_speed = float(car_def.get("base_speed", 10)) if car_def else 10
    base_grip = float(car_def.get("base_grip", 0.85)) if car_def else 0.85
    offset = entrant.get("npc_speed_offset") or 0
    base_speed += offset
    up = upgrades_map.get(entrant.get("racing_car_instance_id") or entrant.get("id") or "") or {}
    engine = int(up.get("engine_level") or 0)
    tires = int(up.get("tires_level") or 0)
    aero = int(up.get("aero_level") or 0)
    reliability = int(up.get("reliability_level") or 0)
    championship = bool(up.get("championship_upgrade") or profile and profile.get("championship_upgrade_purchased"))
    speed = base_speed * (1.0 + engine * ENGINE_POWER_PER_LEVEL - tires * TIRES_POWER_PENALTY_PER_LEVEL + aero * AERO_SPEED_PER_LEVEL - reliability * RELIABILITY_POWER_PENALTY_PER_LEVEL)
    grip = base_grip + tires * TIRES_GRIP_PER_LEVEL - engine * ENGINE_GRIP_PENALTY_PER_LEVEL - aero * AERO_GRIP_PENALTY_PER_LEVEL
    if championship:
        speed *= 1.02
        grip = min(1.0, grip * 1.02)
    if profile and not entrant.get("is_npc"):
        mech = int(profile.get("mechanic_level") or 0)
        pit = int(profile.get("pit_level") or 0)
        speed *= 1.0 + (mech + pit) * CREW_BONUS_PER_LEVEL
    return (max(1.0, speed), max(0.5, min(1.0, grip)))


def _get_track(track_id: str) -> Optional[dict]:
    for t in TRACKS:
        if t.get("id") == track_id:
            return t
    return None


async def _ensure_racing_profile(user_id: str) -> dict:
    prof = await db.racing_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if prof:
        return prof
    doc = {"user_id": user_id, **DEFAULT_PROFILE}
    await db.racing_profiles.insert_one(doc)
    # Return a copy without _id (Motor may add _id to doc in place; ObjectId is not JSON-serializable)
    return {k: v for k, v in doc.items() if k != "_id"}


async def _get_user_racing_car(user_id: str, instance_id: str) -> Optional[dict]:
    doc = await db.user_racing_cars.find_one({"user_id": user_id, "id": instance_id}, {"_id": 0})
    return doc


def _effective_speed_and_grip(entrant: dict, profile: Optional[dict], upgrades_map: Dict[str, dict]) -> tuple:
    """Returns (effective_speed, effective_grip) with upgrade trade-offs: engine +power -grip, tires +grip -power, aero, reliability."""
    car_def = _get_racing_car(entrant.get("racing_car_id") or "")
    base_speed = float(car_def.get("base_speed", 10)) if car_def else 10
    base_grip = float(car_def.get("base_grip", 0.85)) if car_def else 0.85
    offset = entrant.get("npc_speed_offset") or 0
    base_speed += offset
    up = upgrades_map.get(entrant.get("racing_car_instance_id") or entrant.get("id") or "") or {}
    engine = int(up.get("engine_level") or 0)
    tires = int(up.get("tires_level") or 0)
    aero = int(up.get("aero_level") or 0)
    reliability = int(up.get("reliability_level") or 0)
    championship = bool(up.get("championship_upgrade"))
    speed = base_speed * (1.0 + engine * ENGINE_POWER_PER_LEVEL - tires * TIRES_POWER_PENALTY_PER_LEVEL + aero * AERO_SPEED_PER_LEVEL - reliability * RELIABILITY_POWER_PENALTY_PER_LEVEL)
    grip = base_grip + tires * TIRES_GRIP_PER_LEVEL - engine * ENGINE_GRIP_PENALTY_PER_LEVEL - aero * AERO_GRIP_PENALTY_PER_LEVEL
    if championship:
        speed *= 1.02
        grip = min(1.0, grip * 1.02)
    if profile and not entrant.get("is_npc"):
        mech = int(profile.get("mechanic_level") or 0)
        pit = int(profile.get("pit_level") or 0)
        speed *= 1.0 + (mech + pit) * CREW_BONUS_PER_LEVEL
    speed *= 0.97 + random.random() * 0.06
    speed = max(1.0, speed)
    grip = max(0.5, min(1.0, grip))
    return (speed, grip)


def _effective_speed(entrant: dict, profile: Optional[dict], upgrades_map: Dict[str, dict]) -> float:
    s, _ = _effective_speed_and_grip(entrant, profile, upgrades_map)
    return s


def _run_race_simulation(entrants: List[dict], profile_by_user: Dict[str, dict], upgrades_map: Dict[str, dict]) -> List[str]:
    ids = [e.get("user_id") or e.get("id") for e in entrants]
    speeds = [_effective_speed(e, profile_by_user.get((e.get("user_id") or e.get("id")) or ""), upgrades_map) for e in entrants]
    pairs = list(zip(ids, speeds))
    random.shuffle(pairs)
    pairs.sort(key=lambda x: -x[1])
    return [p[0] for p in pairs]


def _run_race_simulation_laps(
    entrants: List[dict],
    profile_by_user: Dict[str, dict],
    upgrades_map: Dict[str, dict],
    num_laps: int,
    weather_id: str = "clear",
    engine_wear_by_entrant: Optional[Dict[str, float]] = None,
) -> tuple:
    """Run lap-by-lap simulation with tire wear, pit stops, weather, optional engine DNF/speed limit.
    Returns (lap_results, result_order, pit_stops, tire_wear_after_lap, dnf_ids)."""
    engine_wear_by_entrant = engine_wear_by_entrant or {}
    weather = _get_weather(weather_id)
    tire_wear_mult = float(weather.get("tire_wear_mult", 1.0))
    speed_mult = float(weather.get("speed_mult", 1.0))
    ids = [e.get("user_id") or e.get("id") for e in entrants]
    tire_wear = {eid: 100.0 for eid in ids}
    lap_results: List[List[str]] = []
    pit_stops: List[Dict[str, Any]] = []
    tire_wear_after_lap: Dict[str, List[float]] = {eid: [100.0] for eid in ids}
    dnf_ids: List[str] = []

    def _compound_wear_mult(entrant: dict) -> float:
        cid = (entrant.get("tyre_compound") or "medium").lower()
        for c in TYRE_COMPOUNDS:
            if c.get("id") == cid:
                return float(c.get("wear_mult", 1.0))
        return 1.0

    def _compound_grip_mult(entrant: dict) -> float:
        cid = (entrant.get("tyre_compound") or "medium").lower()
        for c in TYRE_COMPOUNDS:
            if c.get("id") == cid:
                return float(c.get("grip_mult", 1.0))
        return 1.0

    for lap in range(1, num_laps + 1):
        # Engine failure check (high wear: chance of DNF or speed penalty this lap)
        engine_issue_this_lap: Dict[str, bool] = {}  # eid -> True if DNF
        for eid, wear in engine_wear_by_entrant.items():
            if eid in dnf_ids:
                continue
            if wear < ENGINE_RISK_THRESHOLD:
                continue
            # Chance of DNF increases with wear; at 100% use ENGINE_DNF_CHANCE_PER_LAP_AT_100
            dnf_chance = (wear - ENGINE_RISK_THRESHOLD) / (ENGINE_WEAR_MAX - ENGINE_RISK_THRESHOLD) * ENGINE_DNF_CHANCE_PER_LAP_AT_100
            if random.random() < dnf_chance:
                dnf_ids.append(eid)
                engine_issue_this_lap[eid] = True  # DNF

        # Pit when tire below threshold (pit a lap before they'd be gone)
        pitting = set()
        for eid in ids:
            if eid in dnf_ids:
                continue
            if tire_wear[eid] < TIRE_PIT_THRESHOLD:
                pitting.add(eid)
            elif lap > 1 and lap < num_laps and random.random() < 0.12 and tire_wear[eid] < 60:
                pitting.add(eid)
        for eid in pitting:
            pit_stops.append({"lap": lap, "entrant_id": eid})

        # Lap performance: speed, grip, tire compound, tire wear; DNFs get 0 speed
        lap_speeds = []
        for e in entrants:
            eid = e.get("user_id") or e.get("id")
            if eid in dnf_ids:
                lap_speeds.append((eid, 0.0))
                continue
            speed_val, grip_val = _effective_speed_and_grip(e, profile_by_user.get(eid) or {}, upgrades_map)
            # Engine issues (high wear but no DNF): speed penalty
            wear = engine_wear_by_entrant.get(eid) or 0
            if wear >= ENGINE_RISK_THRESHOLD:
                speed_val *= ENGINE_SPEED_PENALTY_AT_RISK
            tire_factor = max(0.3, tire_wear[eid] / 100.0)
            compound_mult = _compound_grip_mult(e)
            combined = speed_val * (0.7 + 0.3 * grip_val) * tire_factor * speed_mult * compound_mult
            if eid in pitting:
                combined *= PIT_PENALTY_FACTOR
            lap_speeds.append((eid, combined))

        random.shuffle(lap_speeds)
        lap_speeds.sort(key=lambda x: -x[1])
        order = [x[0] for x in lap_speeds]
        lap_results.append(order)

        # Update tire wear (compound affects wear rate; reliability reduces it)
        for e in entrants:
            eid = e.get("user_id") or e.get("id")
            if eid in dnf_ids:
                continue
            up = upgrades_map.get(e.get("racing_car_instance_id") or eid) or {}
            rel = int(up.get("reliability_level") or 0)
            wear_mult_rel = max(0.5, 1.0 - rel * RELIABILITY_WEAR_REDUCTION_PER_LEVEL)
            if eid in pitting:
                tire_wear[eid] = 100.0
            else:
                comp_wear = _compound_wear_mult(e)
                wear_this_lap = (TIRE_WEAR_PER_LAP + random.uniform(-2, 2)) * tire_wear_mult * comp_wear * wear_mult_rel
                tire_wear[eid] = max(0, tire_wear[eid] - wear_this_lap)
            tire_wear_after_lap[eid].append(round(tire_wear[eid], 1))

    # Result order: finishers by last lap order, then DNFs
    if lap_results:
        last_order = lap_results[-1]
        finishers = [eid for eid in last_order if eid not in dnf_ids]
        result_order = finishers + dnf_ids
    else:
        result_order = ids
    return lap_results, result_order, pit_stops, tire_wear_after_lap, dnf_ids


def _run_qualifying(
    entrants: List[dict],
    profile_by_user: Dict[str, dict],
    upgrades_map: Dict[str, dict],
    weather_id: str = "clear",
) -> List[str]:
    """One-lap qualifying: order by single-lap performance (no tire wear). Returns grid order (pole first)."""
    weather = _get_weather(weather_id)
    speed_mult = float(weather.get("speed_mult", 1.0))
    lap_speeds = []
    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        speed_val, grip_val = _effective_speed_and_grip(e, profile_by_user.get(eid) or {}, upgrades_map)
        compound_mult = 1.0
        for c in TYRE_COMPOUNDS:
            if c.get("id") == (e.get("tyre_compound") or "medium"):
                compound_mult = float(c.get("grip_mult", 1.0))
                break
        combined = speed_val * (0.7 + 0.3 * grip_val) * speed_mult * compound_mult
        lap_speeds.append((eid, combined))
    random.shuffle(lap_speeds)
    lap_speeds.sort(key=lambda x: -x[1])
    return [x[0] for x in lap_speeds]


# ---------- Endpoints ----------
async def get_racing_cars(current_user: dict = Depends(get_current_user)):
    return {"cars": RACING_CARS}


async def get_racing_tracks(current_user: dict = Depends(get_current_user)):
    return {"tracks": TRACKS}


async def get_racing_profile(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_racing_profile(current_user["id"])
    # Ensure tyre stock exists for existing users (one-time default)
    for key in ("tyre_stock_soft", "tyre_stock_medium", "tyre_stock_hard"):
        if prof.get(key) is None:
            await db.racing_profiles.update_one(
                {"user_id": current_user["id"]},
                {"$set": {key: TYRE_STOCK_INITIAL}},
            )
            prof[key] = TYRE_STOCK_INITIAL
    owned = await db.user_racing_cars.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    # One instance per user: if none, create one with first car (no purchase)
    if not owned:
        first_car = RACING_CARS[0]
        instance_id = str(uuid.uuid4())
        await db.user_racing_cars.insert_one({
            "id": instance_id,
            "user_id": current_user["id"],
            "racing_car_id": first_car.get("id"),
            "engine_level": 0,
            "tires_level": 0,
            "engine_wear": 0,
            "acquired_at": _now_iso(),
        })
        await db.racing_profiles.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"selected_racing_car_id": instance_id}},
            upsert=True,
        )
        prof["selected_racing_car_id"] = instance_id
        owned = [{"id": instance_id, "user_id": current_user["id"], "racing_car_id": first_car.get("id"), "engine_level": 0, "tires_level": 0, "engine_wear": 0, "car_name": first_car.get("name")}]
    # If multiple (legacy), use only the selected one as "owned" for display
    selected_id = prof.get("selected_racing_car_id")
    if selected_id and len(owned) > 1:
        owned = [o for o in owned if o.get("id") == selected_id] or owned[:1]
    elif not selected_id and owned:
        await db.racing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {"selected_racing_car_id": owned[0].get("id")}}, upsert=True)
        prof["selected_racing_car_id"] = owned[0].get("id")
    for o in owned:
        car_def = _get_racing_car(o.get("racing_car_id") or "")
        o["car_name"] = car_def.get("name") if car_def else (o.get("racing_car_id") or "?")
        o.setdefault("engine_wear", 0)
    upgrades = {}
    for o in owned:
        uid = o.get("id")
        if uid:
            up = await db.racing_upgrades.find_one({"user_id": current_user["id"], "racing_car_instance_id": uid}, {"_id": 0})
            if up:
                upgrades[uid] = up
            else:
                upgrades[uid] = {"engine_level": o.get("engine_level", 0), "tires_level": o.get("tires_level", 0)}
    for o in owned:
        entrant = {"racing_car_id": o.get("racing_car_id"), "racing_car_instance_id": o.get("id")}
        s, g = _effective_speed_and_grip_display(entrant, prof, upgrades)
        o["effective_speed"] = round(s, 1)
        o["effective_grip"] = round(g * 100, 0)
    return {
        "profile": prof,
        "owned_cars": owned,
        "upgrades": upgrades,
        "crew_costs": CREW_UPGRADE_COSTS,
        "max_crew_level": MAX_CREW_LEVEL,
        "car_upgrade_costs": CAR_UPGRADE_COSTS,
        "max_car_upgrade_level": MAX_CAR_UPGRADE_LEVEL,
        "upgrade_tradeoffs": {
            "engine": {"positive": "+4% power", "negative": "−3% grip", "per_level": True},
            "tires": {"positive": "+5% grip", "negative": "−2% power", "per_level": True},
            "aero": {"positive": "+3% top speed", "negative": "−2% grip", "unlock": f"{WINS_FOR_AERO_RELIABILITY}+ win(s)", "per_level": True},
            "reliability": {"positive": "−8% tyre wear", "negative": "−2% power", "unlock": f"{WINS_FOR_AERO_RELIABILITY}+ win(s)", "per_level": True},
            "championship": {"positive": "+2% speed & grip", "negative": "—", "unlock": f"{WINS_FOR_CHAMPIONSHIP_UPGRADE}+ wins", "cost": CHAMPIONSHIP_UPGRADE_COST},
        },
        "tyre_compounds": TYRE_COMPOUNDS,
        "wins": int(prof.get("wins") or 0),
        "tyre_stock_soft": int(prof.get("tyre_stock_soft") or TYRE_STOCK_INITIAL),
        "tyre_stock_medium": int(prof.get("tyre_stock_medium") or TYRE_STOCK_INITIAL),
        "tyre_stock_hard": int(prof.get("tyre_stock_hard") or TYRE_STOCK_INITIAL),
        "tyre_costs": {"soft": TYRE_COST_SOFT, "medium": TYRE_COST_MEDIUM, "hard": TYRE_COST_HARD},
        "engine_repair_cost_per_pct": ENGINE_REPAIR_COST_PER_PCT,
        "engine_replace_cost": ENGINE_REPLACE_COST,
    }


async def buy_racing_car(body: BuyRacingCarRequest, current_user: dict = Depends(get_current_user_verified)):
    """Deprecated: cars are chosen, not bought. Kept for backward compatibility; no-op or redirect to select."""
    raise HTTPException(status_code=410, detail="Racing cars are chosen, not bought. Use select-car with racing_car_id.")


async def set_selected_car(body: SetSelectedCarRequest, current_user: dict = Depends(get_current_user_verified)):
    racing_car_id = (body.racing_car_id or "").strip()
    instance_id = (body.racing_car_instance_id or "").strip()
    if racing_car_id:
        car_def = _get_racing_car(racing_car_id)
        if not car_def:
            raise HTTPException(status_code=404, detail="Racing car not found")
        # Find or create single instance for user
        existing = await db.user_racing_cars.find_one({"user_id": current_user["id"]}, {"_id": 0})
        if existing:
            await db.user_racing_cars.update_one(
                {"user_id": current_user["id"], "id": existing["id"]},
                {"$set": {"racing_car_id": racing_car_id}},
            )
            instance_id = existing["id"]
        else:
            instance_id = str(uuid.uuid4())
            await db.user_racing_cars.insert_one({
                "id": instance_id,
                "user_id": current_user["id"],
                "racing_car_id": racing_car_id,
                "engine_level": 0,
                "tires_level": 0,
                "engine_wear": 0,
                "acquired_at": _now_iso(),
            })
        await _ensure_racing_profile(current_user["id"])
        await db.racing_profiles.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"selected_racing_car_id": instance_id}},
            upsert=True,
        )
        return {"message": "Selected car updated", "selected_racing_car_id": instance_id}
    if not instance_id:
        raise HTTPException(status_code=400, detail="Provide racing_car_id or racing_car_instance_id")
    doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    car_def = _get_racing_car(doc.get("racing_car_id") or "")
    if not car_def:
        raise HTTPException(status_code=400, detail="Invalid car")
    await _ensure_racing_profile(current_user["id"])
    await db.racing_profiles.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"selected_racing_car_id": instance_id}},
        upsert=True,
    )
    return {"message": "Selected car updated", "selected_racing_car_id": instance_id}


async def upgrade_crew(body: UpgradeCrewRequest, current_user: dict = Depends(get_current_user_verified)):
    crew_type = (body.crew_type or "").strip().lower()
    if crew_type not in ("mechanic", "pit"):
        raise HTTPException(status_code=400, detail="crew_type must be mechanic or pit")
    prof = await _ensure_racing_profile(current_user["id"])
    key = "mechanic_level" if crew_type == "mechanic" else "pit_level"
    current = int(prof.get(key) or 0)
    if current >= MAX_CREW_LEVEL:
        raise HTTPException(status_code=400, detail="Max level reached")
    cost = CREW_UPGRADE_COSTS[current + 1] if current + 1 < len(CREW_UPGRADE_COSTS) else CREW_UPGRADE_COSTS[-1]
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    if int(user.get("money") or 0) < cost:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    await db.racing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {key: current + 1}}, upsert=True)
    return {"message": f"{crew_type} upgraded to level {current + 1}", "new_level": current + 1}


async def upgrade_car_part(body: UpgradeCarRequest, current_user: dict = Depends(get_current_user_verified)):
    instance_id = (body.racing_car_instance_id or "").strip()
    upgrade_type = (getattr(body, "upgrade_type", None) or "engine").strip().lower()
    doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    prof = await _ensure_racing_profile(current_user["id"])
    wins = int(prof.get("wins") or 0)

    if upgrade_type == "championship":
        if wins < WINS_FOR_CHAMPIONSHIP_UPGRADE:
            raise HTTPException(status_code=400, detail=f"Championship upgrade requires {WINS_FOR_CHAMPIONSHIP_UPGRADE}+ wins")
        if prof.get("championship_upgrade_purchased"):
            raise HTTPException(status_code=400, detail="Championship upgrade already purchased")
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int(user.get("money") or 0) < CHAMPIONSHIP_UPGRADE_COST:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -CHAMPIONSHIP_UPGRADE_COST}})
        await db.racing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {"championship_upgrade_purchased": True}}, upsert=True)
        up = await db.racing_upgrades.find_one({"user_id": current_user["id"], "racing_car_instance_id": instance_id}, {"_id": 0})
        up_data = (up or {}).copy()
        up_data["engine_level"] = up_data.get("engine_level") or doc.get("engine_level") or 0
        up_data["tires_level"] = up_data.get("tires_level") or doc.get("tires_level") or 0
        up_data["championship_upgrade"] = True
        await db.racing_upgrades.update_one(
            {"user_id": current_user["id"], "racing_car_instance_id": instance_id},
            {"$set": up_data},
            upsert=True,
        )
        return {"message": "Championship upgrade purchased", "championship_upgrade": True}

    if upgrade_type in ("aero", "reliability"):
        if wins < WINS_FOR_AERO_RELIABILITY:
            raise HTTPException(status_code=400, detail=f"Aero/Reliability upgrades require {WINS_FOR_AERO_RELIABILITY}+ win(s)")
        up = await db.racing_upgrades.find_one({"user_id": current_user["id"], "racing_car_instance_id": instance_id}, {"_id": 0})
        up_data = dict(up) if up else {}
        up_data.setdefault("engine_level", doc.get("engine_level") or 0)
        up_data.setdefault("tires_level", doc.get("tires_level") or 0)
        key = "aero_level" if upgrade_type == "aero" else "reliability_level"
        max_lvl = MAX_AERO_LEVEL if upgrade_type == "aero" else MAX_RELIABILITY_LEVEL
        current = int(up_data.get(key) or 0)
        if current >= max_lvl:
            raise HTTPException(status_code=400, detail=f"Max {upgrade_type} level reached")
        cost = 40000 * (current + 1)
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int(user.get("money") or 0) < cost:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
        up_data[key] = current + 1
        await db.racing_upgrades.update_one(
            {"user_id": current_user["id"], "racing_car_instance_id": instance_id},
            {"$set": up_data},
            upsert=True,
        )
        return {"message": f"{upgrade_type} upgraded", key: current + 1}

    # engine or tires (default)
    engine = int(doc.get("engine_level") or 0)
    tires = int(doc.get("tires_level") or 0)
    total_level = engine + tires
    if total_level >= MAX_CAR_UPGRADE_LEVEL * 2:
        raise HTTPException(status_code=400, detail="Max upgrades reached")
    next_level = total_level + 1
    cost = CAR_UPGRADE_COSTS[next_level] if next_level < len(CAR_UPGRADE_COSTS) else CAR_UPGRADE_COSTS[-1]
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    if int(user.get("money") or 0) < cost:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    if engine <= tires:
        new_engine, new_tires = engine + 1, tires
    else:
        new_engine, new_tires = engine, tires + 1
    await db.user_racing_cars.update_one(
        {"user_id": current_user["id"], "id": instance_id},
        {"$set": {"engine_level": new_engine, "tires_level": new_tires}},
    )
    return {"message": "Car upgraded", "engine_level": new_engine, "tires_level": new_tires}


async def repair_engine(body: RepairEngineRequest, current_user: dict = Depends(get_current_user_verified)):
    """Repair engine wear down to target_wear (default 0) for a fee."""
    instance_id = (body.racing_car_instance_id or "").strip()
    doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    current_wear = float(doc.get("engine_wear") or 0)
    target = 0.0 if body.target_wear is None else max(0, min(ENGINE_WEAR_MAX, float(body.target_wear)))
    if current_wear <= target:
        raise HTTPException(status_code=400, detail="Engine wear already at or below target")
    cost = int((current_wear - target) * ENGINE_REPAIR_COST_PER_PCT)
    if cost < 1:
        raise HTTPException(status_code=400, detail="Nothing to repair")
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    if int(user.get("money") or 0) < cost:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    await db.user_racing_cars.update_one(
        {"user_id": current_user["id"], "id": instance_id},
        {"$set": {"engine_wear": round(target, 1)}},
    )
    return {"message": "Engine repaired", "engine_wear": target, "cost": cost}


async def replace_engine(body: ReplaceEngineRequest, current_user: dict = Depends(get_current_user_verified)):
    """Replace engine (resets wear to 0) for a fixed cost."""
    instance_id = (body.racing_car_instance_id or "").strip()
    doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    if int(user.get("money") or 0) < ENGINE_REPLACE_COST:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -ENGINE_REPLACE_COST}})
    await db.user_racing_cars.update_one(
        {"user_id": current_user["id"], "id": instance_id},
        {"$set": {"engine_wear": 0}},
    )
    return {"message": "Engine replaced", "engine_wear": 0, "cost": ENGINE_REPLACE_COST}


async def buy_tyres(body: BuyTyresRequest, current_user: dict = Depends(get_current_user_verified)):
    """Buy tyre sets (soft, medium, hard) to add to stock."""
    compound = (body.compound or "medium").strip().lower()
    if compound not in ("soft", "medium", "hard"):
        raise HTTPException(status_code=400, detail="compound must be soft, medium, or hard")
    quantity = max(1, min(20, int(body.quantity or 1)))
    cost_map = {"soft": TYRE_COST_SOFT, "medium": TYRE_COST_MEDIUM, "hard": TYRE_COST_HARD}
    cost = cost_map[compound] * quantity
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    if int(user.get("money") or 0) < cost:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    await _ensure_racing_profile(current_user["id"])
    from pymongo import ReturnDocument
    updated = await db.racing_profiles.find_one_and_update(
        {"user_id": current_user["id"]},
        {"$inc": {f"tyre_stock_{compound}": quantity}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
        projection={f"tyre_stock_{compound}": 1},
    )
    new_stock = int(updated.get(f"tyre_stock_{compound}") or 0)
    return {"message": f"Bought {quantity} {compound} tyre set(s)", "tyre_stock": new_stock, "cost": cost}


async def create_race(body: CreateRaceRequest, current_user: dict = Depends(get_current_user_verified)):
    track_id = (body.track_id or "").strip()
    track = _get_track(track_id)
    if not track:
        raise HTTPException(status_code=400, detail="Invalid track")
    entry_fee = max(ENTRY_FEE_MIN, min(ENTRY_FEE_MAX, int(body.entry_fee or 0)))
    max_grid = max(MIN_GRID, min(MAX_GRID, int(body.max_grid or 6)))
    num_laps = max(NUM_LAPS_MIN, min(NUM_LAPS_MAX, int(body.laps or 3)))
    prof = await _ensure_racing_profile(current_user["id"])
    selected_id = prof.get("selected_racing_car_id")
    if not selected_id:
        raise HTTPException(status_code=400, detail="Select a racing car first")
    car_doc = await _get_user_racing_car(current_user["id"], selected_id)
    if not car_doc:
        raise HTTPException(status_code=400, detail="Selected racing car not found")
    engine_wear = float(car_doc.get("engine_wear") or 0)
    if engine_wear >= ENGINE_WEAR_MAX:
        raise HTTPException(status_code=400, detail="Engine at 100% wear. Repair or replace engine before racing.")
    compound = (body.tyre_compound or "medium").strip().lower()
    tyre_stock = int(prof.get(f"tyre_stock_{compound}") or 0)
    if tyre_stock < 1:
        raise HTTPException(status_code=400, detail=f"No {compound} tyres in stock. Buy tyres in My ride.")
    if entry_fee > 0:
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int(user.get("money") or 0) < entry_fee:
            raise HTTPException(status_code=400, detail="Insufficient cash for entry fee")
    race_id = str(uuid.uuid4())
    now = _now_iso()
    # Weather: use provided or random (set once so creator can see it when selecting tyres)
    if body.weather_id and any(w.get("id") == body.weather_id for w in WEATHER_TYPES):
        weather = _get_weather(body.weather_id)
    else:
        weather = random.choice(WEATHER_TYPES)
    weather_id = weather.get("id", "clear")
    weather_name = weather.get("name", "Clear")
    doc = {
        "id": race_id,
        "track_id": track_id,
        "track_name": track.get("name"),
        "entry_fee": entry_fee,
        "max_grid": max_grid,
        "state": "open",
        "created_by": current_user["id"],
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "weather": weather_id,
        "weather_name": weather_name,
        "participants": [
            {
                "user_id": current_user["id"],
                "username": current_user.get("username") or "?",
                "racing_car_id": car_doc.get("racing_car_id"),
                "racing_car_instance_id": car_doc.get("id"),
                "car_name": next((c.get("name") for c in RACING_CARS if c.get("id") == car_doc.get("racing_car_id")), "?"),
                "is_npc": False,
                "tyre_compound": (body.tyre_compound or "medium").strip().lower(),
            }
        ],
        "result_order": None,
        "reward_mult": track.get("reward_mult", 1.0),
        "laps": num_laps,
        "lobby_ends_at": (datetime.now(timezone.utc) + timedelta(seconds=RACE_LOBBY_COUNTDOWN_SEC)).isoformat().replace("+00:00", "Z"),
    }
    await db.racing_races.insert_one(doc)
    if entry_fee > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -entry_fee}})
    # Return a copy without _id (insert_one may add _id to doc in place; ObjectId is not JSON-serializable)
    race_response = {k: v for k, v in doc.items() if k != "_id"}
    return {"message": "Race created", "race_id": race_id, "race": race_response}


async def get_open_races(current_user: dict = Depends(get_current_user_verified)):
    now = datetime.now(timezone.utc)
    cursor = db.racing_races.find(
        {"state": "open", "lobby_ends_at": {"$gt": now.isoformat()}},
        {"_id": 0}
    ).sort("created_at", -1).limit(50)
    races = await cursor.to_list(50)
    return {"races": races}


async def get_race(race_id: str, current_user: dict = Depends(get_current_user_verified)):
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    return {"race": race}


async def join_race(race_id: str, body: JoinRaceRequest, current_user: dict = Depends(get_current_user_verified)):
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("state") != "open":
        raise HTTPException(status_code=400, detail="Race not open for join")
    if any(p.get("user_id") == current_user["id"] for p in (race.get("participants") or [])):
        raise HTTPException(status_code=400, detail="Already in this race")
    participants = race.get("participants") or []
    if len(participants) >= int(race.get("max_grid") or MAX_GRID):
        raise HTTPException(status_code=400, detail="Race is full")
    instance_id = (body.racing_car_instance_id or "").strip()
    car_doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not car_doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    engine_wear = float(car_doc.get("engine_wear") or 0)
    if engine_wear >= ENGINE_WEAR_MAX:
        raise HTTPException(status_code=400, detail="Engine at 100% wear. Repair or replace engine before racing.")
    compound = (body.tyre_compound or "medium").strip().lower() if hasattr(body, "tyre_compound") else "medium"
    prof = await _ensure_racing_profile(current_user["id"])
    for key in ("tyre_stock_soft", "tyre_stock_medium", "tyre_stock_hard"):
        if prof.get(key) is None:
            await db.racing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {key: TYRE_STOCK_INITIAL}})
            prof[key] = TYRE_STOCK_INITIAL
    tyre_stock = int(prof.get(f"tyre_stock_{compound}") or 0)
    if tyre_stock < 1:
        raise HTTPException(status_code=400, detail=f"No {compound} tyres in stock. Buy tyres in My ride.")
    entry_fee = int(race.get("entry_fee") or 0)
    if entry_fee > 0:
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int(user.get("money") or 0) < entry_fee:
            raise HTTPException(status_code=400, detail="Insufficient cash for entry fee")
    participants.append({
        "user_id": current_user["id"],
        "username": current_user.get("username") or "?",
        "racing_car_id": car_doc.get("racing_car_id"),
        "racing_car_instance_id": car_doc.get("id"),
        "car_name": next((c.get("name") for c in RACING_CARS if c.get("id") == car_doc.get("racing_car_id")), "?"),
        "is_npc": False,
        "tyre_compound": (body.tyre_compound or "medium").strip().lower() if hasattr(body, "tyre_compound") else "medium",
    })
    await db.racing_races.update_one(
        {"id": race_id},
        {"$set": {"participants": participants}},
    )
    if entry_fee > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -entry_fee}})
    return {"message": "Joined race", "participants": participants}


async def start_race(race_id: str, current_user: dict = Depends(get_current_user_verified)):
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("state") != "open":
        raise HTTPException(status_code=400, detail="Race already started or completed")
    participants = list(race.get("participants") or [])
    max_grid = int(race.get("max_grid") or MAX_GRID)
    track = _get_track(race.get("track_id") or "")
    reward_mult = float(track.get("reward_mult", 1.0)) if track else 1.0
    entry_fee = int(race.get("entry_fee") or 0)
    # Player tier for similar-level NPCs (first human participant)
    player_tier = 0
    player_engine = 0
    player_tires = 0
    for p in participants:
        if p.get("is_npc"):
            continue
        inst_id = p.get("racing_car_instance_id")
        if inst_id:
            car_doc = await db.user_racing_cars.find_one({"user_id": p.get("user_id"), "id": inst_id}, {"_id": 0})
            if car_doc:
                player_tier = _car_tier_index(car_doc.get("racing_car_id") or "")
                player_engine = int(car_doc.get("engine_level") or 0)
                player_tires = int(car_doc.get("tires_level") or 0)
        break
    # Build a competitive spread of NPC speed offsets so the field isn't all slow (not a 1-person race)
    npcs_to_add = max_grid - len(participants)
    competitive_offsets = [-1, 0, 0, 0, 1, 1, 1, 2, 2][: max(1, npcs_to_add)]
    while len(competitive_offsets) < npcs_to_add:
        competitive_offsets.append(random.choice([0, 1, 2]))
    random.shuffle(competitive_offsets)
    initial_count = len(participants)

    while len(participants) < max_grid:
        npc = random.choice(RACING_NPCS)
        offset = competitive_offsets[len(participants) - initial_count]
        # Pick car from same or adjacent tier
        tier = max(0, min(len(RACING_CARS) - 1, player_tier + random.randint(-1, 1)))
        car_def = RACING_CARS[tier]
        engine_level = max(0, min(MAX_CAR_UPGRADE_LEVEL, player_engine + random.randint(-1, 1)))
        tires_level = max(0, min(MAX_CAR_UPGRADE_LEVEL, player_tires + random.randint(-1, 1)))
        npc_id = npc["id"]
        tyre = random.choice(["soft", "medium", "hard"])
        participants.append({
            "id": npc_id,
            "username": npc.get("name"),
            "racing_car_id": car_def.get("id"),
            "racing_car_instance_id": None,
            "car_name": car_def.get("name"),
            "is_npc": True,
            "npc_speed_offset": int(offset),
            "engine_level": engine_level,
            "tires_level": tires_level,
            "tyre_compound": tyre,
        })
    profile_by_user = {}
    upgrades_map = {}
    for p in participants:
        if p.get("is_npc"):
            eid = p.get("id")
            upgrades_map[eid] = {"engine_level": p.get("engine_level", 0), "tires_level": p.get("tires_level", 0)}
            continue
        uid = p.get("user_id")
        prof = await db.racing_profiles.find_one({"user_id": uid}, {"_id": 0})
        if prof:
            profile_by_user[uid] = prof
        inst_id = p.get("racing_car_instance_id")
        if inst_id:
            up = await db.racing_upgrades.find_one({"user_id": uid, "racing_car_instance_id": inst_id}, {"_id": 0})
            if up:
                upgrades_map[inst_id] = up
            else:
                car_doc = await db.user_racing_cars.find_one({"user_id": uid, "id": inst_id}, {"_id": 0})
                if car_doc:
                    upgrades_map[inst_id] = {"engine_level": car_doc.get("engine_level", 0), "tires_level": car_doc.get("tires_level", 0)}
    num_laps = max(NUM_LAPS_MIN, min(NUM_LAPS_MAX, int(race.get("laps") or 3)))
    # Use weather set at race creation so it matches what was shown when selecting tyres
    if race.get("weather") and any(w.get("id") == race.get("weather") for w in WEATHER_TYPES):
        weather = _get_weather(race["weather"])
    else:
        weather = random.choice(WEATHER_TYPES)
    weather_id = weather.get("id", "clear")
    # Pre-check: engine wear < 100 and tyre stock for each human
    engine_wear_by_entrant: Dict[str, float] = {}
    for p in participants:
        if p.get("is_npc"):
            continue
        uid = p.get("user_id")
        inst_id = p.get("racing_car_instance_id")
        if not inst_id:
            continue
        car_doc = await db.user_racing_cars.find_one({"user_id": uid, "id": inst_id}, {"_id": 0, "engine_wear": 1})
        wear = float(car_doc.get("engine_wear") or 0) if car_doc else 0
        engine_wear_by_entrant[uid] = wear
        if wear >= ENGINE_WEAR_MAX:
            raise HTTPException(status_code=400, detail="A participant's engine is at 100% wear. They must repair or replace before the race.")
        compound = (p.get("tyre_compound") or "medium").strip().lower()
        prof = await db.racing_profiles.find_one({"user_id": uid}, {"_id": 0})
        if prof is not None:
            for key in ("tyre_stock_soft", "tyre_stock_medium", "tyre_stock_hard"):
                if prof.get(key) is None:
                    await db.racing_profiles.update_one({"user_id": uid}, {"$set": {key: TYRE_STOCK_INITIAL}})
                    prof[key] = TYRE_STOCK_INITIAL
            stock = int(prof.get(f"tyre_stock_{compound}") or 0)
            if stock < 1:
                raise HTTPException(status_code=400, detail=f"Not enough {compound} tyres in stock for a participant. Buy tyres before the race.")
    # Qualifying: one lap to set grid order, then race starts from that order
    qualifying_order = _run_qualifying(participants, profile_by_user, upgrades_map, weather_id)
    id_to_p = {(p.get("user_id") or p.get("id")): p for p in participants}
    participants = [id_to_p[eid] for eid in qualifying_order if eid in id_to_p]
    lap_results, result_order, pit_stops, tire_wear_after_lap, dnf_ids = _run_race_simulation_laps(
        participants, profile_by_user, upgrades_map, num_laps, weather_id, engine_wear_by_entrant
    )
    # Enrich participants with effective_speed and effective_grip for replay
    for p in participants:
        prof = profile_by_user.get(p.get("user_id") or p.get("id")) if not p.get("is_npc") else None
        s, g = _effective_speed_and_grip_display(p, prof, upgrades_map)
        p["effective_speed"] = round(s, 2)
        p["effective_grip"] = round(g, 2)
        p["pit_level"] = int(prof.get("pit_level") or 0) if prof else 0
    now = _now_iso()
    pot = entry_fee * len(participants) * REWARD_POOL_PCT
    rewards = []
    for i, entrant_id in enumerate(result_order):
        position = i + 1
        pct = REWARD_BY_POSITION[i] if i < len(REWARD_BY_POSITION) else 0
        cash = int(pot * pct * reward_mult)
        rp = RANK_POINTS_BY_POSITION[i] if i < len(RANK_POINTS_BY_POSITION) else 0
        rep = RACING_REP_BY_POSITION[i] if i < len(RACING_REP_BY_POSITION) else 0
        entrant = next((x for x in participants if (x.get("user_id") or x.get("id")) == entrant_id), None)
        is_dnf = entrant_id in dnf_ids
        if entrant:
            entrant["dnf"] = is_dnf
        if entrant and not entrant.get("is_npc"):
            uid = entrant.get("user_id")
            if not is_dnf:
                await db.users.update_one({"id": uid}, {"$inc": {"money": cash, "rank_points": rp}})
                await db.racing_profiles.update_one(
                    {"user_id": uid},
                    {"$inc": {"racing_rep": rep, "races_completed": 1, "wins": 1 if position == 1 else 0}},
                    upsert=True,
                )
                try:
                    rp_before = int((await db.users.find_one({"id": uid}, {"rank_points": 1}) or {}).get("rank_points", 0)) - rp
                    await maybe_process_rank_up(uid, rp_before, rp, entrant.get("username", ""))
                except Exception:
                    pass
            else:
                await db.racing_profiles.update_one(
                    {"user_id": uid},
                    {"$inc": {"races_completed": 1}},
                    upsert=True,
                )
            # Engine wear: add per race (cap at 100)
            inst_id = entrant.get("racing_car_instance_id")
            if inst_id:
                car = await db.user_racing_cars.find_one({"user_id": uid, "id": inst_id}, {"_id": 0, "engine_wear": 1})
                if car is not None:
                    current_wear = float(car.get("engine_wear") or 0)
                    new_wear = min(ENGINE_WEAR_MAX, current_wear + ENGINE_WEAR_PER_RACE)
                    await db.user_racing_cars.update_one(
                        {"user_id": uid, "id": inst_id},
                        {"$set": {"engine_wear": round(new_wear, 1)}},
                    )
            # Deduct one set of tyres for compound used
            compound = (entrant.get("tyre_compound") or "medium").strip().lower()
            await db.racing_profiles.update_one(
                {"user_id": uid},
                {"$inc": {f"tyre_stock_{compound}": -1}},
                upsert=True,
            )
        rewards.append({"entrant_id": entrant_id, "position": position, "cash": cash, "rank_points": rp, "racing_rep": rep, "dnf": is_dnf})
    await db.racing_races.update_one(
        {"id": race_id},
        {"$set": {"state": "completed", "participants": participants, "result_order": result_order, "qualifying_order": qualifying_order, "lap_results": lap_results, "pit_stops": pit_stops, "tire_wear_after_lap": tire_wear_after_lap, "laps": num_laps, "weather": weather_id, "weather_name": weather.get("name", "Clear"), "started_at": now, "completed_at": now, "rewards": rewards, "dnf_ids": dnf_ids}},
    )
    race["state"] = "completed"
    race["participants"] = participants
    race["result_order"] = result_order
    race["qualifying_order"] = qualifying_order
    race["lap_results"] = lap_results
    race["pit_stops"] = pit_stops
    race["tire_wear_after_lap"] = tire_wear_after_lap
    race["laps"] = num_laps
    race["weather"] = weather_id
    race["weather_name"] = weather.get("name", "Clear")
    race["rewards"] = rewards
    race["dnf_ids"] = dnf_ids
    return {"message": "Race completed", "race": race}


async def get_racing_leaderboard(current_user: dict = Depends(get_current_user), limit: int = 50):
    cursor = db.racing_profiles.find({}, {"_id": 0, "user_id": 1, "wins": 1, "racing_rep": 1, "races_completed": 1}).sort("wins", -1).limit(limit)
    profs = await cursor.to_list(limit)
    user_ids = [p["user_id"] for p in profs]
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(len(user_ids))
    by_id = {u["id"]: u for u in users}
    out = []
    for i, p in enumerate(profs):
        u = by_id.get(p["user_id"]) or {}
        out.append({
            "rank": i + 1,
            "user_id": p["user_id"],
            "username": u.get("username") or "?",
            "wins": int(p.get("wins") or 0),
            "racing_rep": int(p.get("racing_rep") or 0),
            "races_completed": int(p.get("races_completed") or 0),
        })
    return {"leaderboard": out}


async def get_racing_comps(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    cursor = db.racing_comps.find(
        {"start_at": {"$lte": now}, "end_at": {"$gt": now}},
        {"_id": 0}
    ).sort("end_at", 1).limit(20)
    comps = await cursor.to_list(20)
    if not comps:
        # Seed one default comp so "Race comps" has content
        comp_id = str(uuid.uuid4())
        start_at = now
        end_at = now + timedelta(days=7)
        seed_comp = {
            "id": comp_id,
            "name": "Chicago Board Track Weekly",
            "track_id": "chicago_board",
            "entry_fee": 5000,
            "start_at": start_at.isoformat().replace("+00:00", "Z"),
            "end_at": end_at.isoformat().replace("+00:00", "Z"),
        }
        await db.racing_comps.insert_one(seed_comp.copy())
        # Use a clean dict for response (insert_one may add _id to the passed dict in place)
        comps = [
            {"id": comp_id, "name": seed_comp["name"], "track_id": seed_comp["track_id"], "entry_fee": seed_comp["entry_fee"], "start_at": seed_comp["start_at"], "end_at": seed_comp["end_at"]}
        ]
    return {"comps": comps}


async def enter_racing_comp(comp_id: str, body: JoinRaceRequest, current_user: dict = Depends(get_current_user_verified)):
    comp = await db.racing_comps.find_one({"id": comp_id}, {"_id": 0})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    now = datetime.now(timezone.utc)
    start_at = datetime.fromisoformat((comp.get("start_at") or "").replace("Z", "+00:00")) if comp.get("start_at") else None
    end_at = datetime.fromisoformat((comp.get("end_at") or "").replace("Z", "+00:00")) if comp.get("end_at") else None
    if start_at and now < start_at:
        raise HTTPException(status_code=400, detail="Competition has not started")
    if end_at and now > end_at:
        raise HTTPException(status_code=400, detail="Competition has ended")
    existing = await db.racing_comp_entries.find_one({"comp_id": comp_id, "user_id": current_user["id"]})
    if existing:
        raise HTTPException(status_code=400, detail="Already entered")
    instance_id = (body.racing_car_instance_id or "").strip()
    car_doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not car_doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    entry_fee = int(comp.get("entry_fee") or 0)
    if entry_fee > 0:
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int(user.get("money") or 0) < entry_fee:
            raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.racing_comp_entries.insert_one({
        "id": str(uuid.uuid4()),
        "comp_id": comp_id,
        "user_id": current_user["id"],
        "username": current_user.get("username") or "?",
        "racing_car_instance_id": instance_id,
        "racing_car_id": car_doc.get("racing_car_id"),
        "entered_at": _now_iso(),
    })
    if entry_fee > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -entry_fee}})
    return {"message": "Entered competition"}


def register(router):
    router.add_api_route("/racing/cars", get_racing_cars, methods=["GET"])
    router.add_api_route("/racing/tracks", get_racing_tracks, methods=["GET"])
    router.add_api_route("/racing/profile", get_racing_profile, methods=["GET"])
    router.add_api_route("/racing/profile/select-car", set_selected_car, methods=["POST"])
    router.add_api_route("/racing/crew/upgrade", upgrade_crew, methods=["POST"])
    router.add_api_route("/racing/car/upgrade", upgrade_car_part, methods=["POST"])
    router.add_api_route("/racing/engine/repair", repair_engine, methods=["POST"])
    router.add_api_route("/racing/engine/replace", replace_engine, methods=["POST"])
    router.add_api_route("/racing/tyres/buy", buy_tyres, methods=["POST"])
    router.add_api_route("/racing/races", create_race, methods=["POST"])
    router.add_api_route("/racing/races/open", get_open_races, methods=["GET"])
    router.add_api_route("/racing/races/{race_id}", get_race, methods=["GET"])
    router.add_api_route("/racing/races/{race_id}/join", join_race, methods=["POST"])
    router.add_api_route("/racing/races/{race_id}/start", start_race, methods=["POST"])
    router.add_api_route("/racing/leaderboard", get_racing_leaderboard, methods=["GET"])
    router.add_api_route("/racing/comps", get_racing_comps, methods=["GET"])
    router.add_api_route("/racing/comps/{comp_id}/enter", enter_racing_comp, methods=["POST"])
