# Racing: bootleg runs / road races (1920s-30s). Buy racing cars, create/join races, fill with NPCs, simulate, rewards, leaderboard, comps.
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

# Racing cars (bought with cash, separate from garage). id, name, cost, base_speed (for simulation), image
RACING_CARS: List[dict] = [
    {"id": "race_car1", "name": "Model T Racer", "cost": 15000, "base_speed": 12, "image": "/images/gta/car1.jpg"},
    {"id": "race_car2", "name": "Chevrolet Racer", "cost": 28000, "base_speed": 14, "image": "/images/gta/car2.jpg"},
    {"id": "race_car3", "name": "Dodge Brothers Racer", "cost": 35000, "base_speed": 15, "image": "/images/gta/car3.jpg"},
    {"id": "race_car4", "name": "Ford Model A Racer", "cost": 32000, "base_speed": 15, "image": "/images/gta/car4.jpg"},
    {"id": "race_car5", "name": "Cadillac V-8 Racer", "cost": 65000, "base_speed": 18, "image": "/images/gta/car9.jpg"},
    {"id": "race_car6", "name": "Packard Eight Racer", "cost": 110000, "base_speed": 20, "image": "/images/gta/car11.jpg"},
    {"id": "race_car7", "name": "Stutz Bearcat", "cost": 180000, "base_speed": 22, "image": "/images/gta/car14.jpg"},
    {"id": "race_car8", "name": "Duesenberg Racer", "cost": 320000, "base_speed": 25, "image": "/images/gta/car15.jpeg"},
    {"id": "race_car9", "name": "Auburn Speedster", "cost": 400000, "base_speed": 26, "image": "/images/gta/car17.jpg"},
    {"id": "race_car10", "name": "Bugatti Royale Racer", "cost": 800000, "base_speed": 30, "image": "/images/gta/car18.jpg"},
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
CAR_UPGRADE_BONUS_PER_LEVEL = 0.03
MAX_CREW_LEVEL = 5
MAX_CAR_UPGRADE_LEVEL = 4

DEFAULT_PROFILE = {
    "mechanic_level": 0,
    "pit_level": 0,
    "racing_rep": 0,
    "wins": 0,
    "races_completed": 0,
    "selected_racing_car_id": None,
}


# ---------- Pydantic ----------
class CreateRaceRequest(BaseModel):
    track_id: str
    entry_fee: int = 0
    max_grid: int = 6


class JoinRaceRequest(BaseModel):
    racing_car_instance_id: str


class UpgradeCrewRequest(BaseModel):
    crew_type: str


class UpgradeCarRequest(BaseModel):
    racing_car_instance_id: str


class BuyRacingCarRequest(BaseModel):
    racing_car_id: str


class SetSelectedCarRequest(BaseModel):
    racing_car_instance_id: str


# ---------- Helpers ----------
def _get_racing_car(car_id: str) -> Optional[dict]:
    for c in RACING_CARS:
        if c.get("id") == car_id:
            return c
    return None


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


def _effective_speed(entrant: dict, profile: Optional[dict], upgrades_map: Dict[str, dict]) -> float:
    car_def = _get_racing_car(entrant.get("racing_car_id") or "")
    base = float(car_def.get("base_speed", 10)) if car_def else 10
    offset = entrant.get("npc_speed_offset") or 0
    base += offset
    up = upgrades_map.get(entrant.get("racing_car_instance_id") or entrant.get("id") or "") or {}
    engine = int(up.get("engine_level") or 0)
    tires = int(up.get("tires_level") or 0)
    base *= 1.0 + (engine + tires) * CAR_UPGRADE_BONUS_PER_LEVEL
    if profile and not entrant.get("is_npc"):
        mech = int(profile.get("mechanic_level") or 0)
        pit = int(profile.get("pit_level") or 0)
        base *= 1.0 + (mech + pit) * CREW_BONUS_PER_LEVEL
    base *= 0.97 + random.random() * 0.06
    return max(1.0, base)


def _run_race_simulation(entrants: List[dict], profile_by_user: Dict[str, dict], upgrades_map: Dict[str, dict]) -> List[str]:
    ids = [e.get("user_id") or e.get("id") for e in entrants]
    speeds = [_effective_speed(e, profile_by_user.get((e.get("user_id") or e.get("id")) or ""), upgrades_map) for e in entrants]
    pairs = list(zip(ids, speeds))
    random.shuffle(pairs)
    pairs.sort(key=lambda x: -x[1])
    return [p[0] for p in pairs]


# ---------- Endpoints ----------
async def get_racing_cars(current_user: dict = Depends(get_current_user)):
    return {"cars": RACING_CARS}


async def get_racing_tracks(current_user: dict = Depends(get_current_user)):
    return {"tracks": TRACKS}


async def get_racing_profile(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_racing_profile(current_user["id"])
    owned = await db.user_racing_cars.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    for o in owned:
        car_def = _get_racing_car(o.get("racing_car_id") or "")
        o["car_name"] = car_def.get("name") if car_def else (o.get("racing_car_id") or "?")
    upgrades = {}
    for o in owned:
        uid = o.get("id")
        if uid:
            up = await db.racing_upgrades.find_one({"user_id": current_user["id"], "racing_car_instance_id": uid}, {"_id": 0})
            if up:
                upgrades[uid] = up
            else:
                upgrades[uid] = {"engine_level": o.get("engine_level", 0), "tires_level": o.get("tires_level", 0)}
    return {
        "profile": prof,
        "owned_cars": owned,
        "upgrades": upgrades,
        "crew_costs": CREW_UPGRADE_COSTS,
        "max_crew_level": MAX_CREW_LEVEL,
        "car_upgrade_costs": CAR_UPGRADE_COSTS,
        "max_car_upgrade_level": MAX_CAR_UPGRADE_LEVEL,
    }


async def buy_racing_car(body: BuyRacingCarRequest, current_user: dict = Depends(get_current_user_verified)):
    car_id = (body.racing_car_id or "").strip()
    car_def = _get_racing_car(car_id)
    if not car_def:
        raise HTTPException(status_code=404, detail="Racing car not found")
    cost = int(car_def.get("cost") or 0)
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(user.get("money") or 0)
    if cost > money:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    instance_id = str(uuid.uuid4())
    await db.user_racing_cars.insert_one({
        "id": instance_id,
        "user_id": current_user["id"],
        "racing_car_id": car_id,
        "engine_level": 0,
        "tires_level": 0,
        "acquired_at": _now_iso(),
    })
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    return {"message": f"Purchased {car_def.get('name')}", "instance_id": instance_id}


async def set_selected_car(body: SetSelectedCarRequest, current_user: dict = Depends(get_current_user_verified)):
    instance_id = (body.racing_car_instance_id or "").strip()
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
    doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
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


async def create_race(body: CreateRaceRequest, current_user: dict = Depends(get_current_user_verified)):
    track_id = (body.track_id or "").strip()
    track = _get_track(track_id)
    if not track:
        raise HTTPException(status_code=400, detail="Invalid track")
    entry_fee = max(ENTRY_FEE_MIN, min(ENTRY_FEE_MAX, int(body.entry_fee or 0)))
    max_grid = max(MIN_GRID, min(MAX_GRID, int(body.max_grid or 6)))
    prof = await _ensure_racing_profile(current_user["id"])
    selected_id = prof.get("selected_racing_car_id")
    if not selected_id:
        raise HTTPException(status_code=400, detail="Select a racing car first")
    car_doc = await _get_user_racing_car(current_user["id"], selected_id)
    if not car_doc:
        raise HTTPException(status_code=400, detail="Selected racing car not found")
    if entry_fee > 0:
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int(user.get("money") or 0) < entry_fee:
            raise HTTPException(status_code=400, detail="Insufficient cash for entry fee")
    race_id = str(uuid.uuid4())
    now = _now_iso()
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
        "participants": [
            {
                "user_id": current_user["id"],
                "username": current_user.get("username") or "?",
                "racing_car_id": car_doc.get("racing_car_id"),
                "racing_car_instance_id": car_doc.get("id"),
                "car_name": next((c.get("name") for c in RACING_CARS if c.get("id") == car_doc.get("racing_car_id")), "?"),
                "is_npc": False,
            }
        ],
        "result_order": None,
        "reward_mult": track.get("reward_mult", 1.0),
        "lobby_ends_at": (datetime.now(timezone.utc) + timedelta(seconds=RACE_LOBBY_COUNTDOWN_SEC)).isoformat().replace("+00:00", "Z"),
    }
    await db.racing_races.insert_one(doc)
    if entry_fee > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -entry_fee}})
    return {"message": "Race created", "race_id": race_id, "race": doc}


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
    while len(participants) < max_grid:
        npc = random.choice(RACING_NPCS)
        car_def = random.choice(RACING_CARS)
        participants.append({
            "id": npc["id"],
            "username": npc.get("name"),
            "racing_car_id": car_def.get("id"),
            "racing_car_instance_id": None,
            "car_name": car_def.get("name"),
            "is_npc": True,
            "npc_speed_offset": int(npc.get("base_speed_offset") or 0),
        })
    profile_by_user = {}
    upgrades_map = {}
    for p in participants:
        if p.get("is_npc"):
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
    result_order = _run_race_simulation(participants, profile_by_user, upgrades_map)
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
        if entrant and not entrant.get("is_npc"):
            uid = entrant.get("user_id")
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
        rewards.append({"entrant_id": entrant_id, "position": position, "cash": cash, "rank_points": rp, "racing_rep": rep})
    await db.racing_races.update_one(
        {"id": race_id},
        {"$set": {"state": "completed", "participants": participants, "result_order": result_order, "started_at": now, "completed_at": now, "rewards": rewards}},
    )
    race["state"] = "completed"
    race["participants"] = participants
    race["result_order"] = result_order
    race["rewards"] = rewards
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
    router.add_api_route("/racing/cars/buy", buy_racing_car, methods=["POST"])
    router.add_api_route("/racing/profile/select-car", set_selected_car, methods=["POST"])
    router.add_api_route("/racing/crew/upgrade", upgrade_crew, methods=["POST"])
    router.add_api_route("/racing/car/upgrade", upgrade_car_part, methods=["POST"])
    router.add_api_route("/racing/races", create_race, methods=["POST"])
    router.add_api_route("/racing/races/open", get_open_races, methods=["GET"])
    router.add_api_route("/racing/races/{race_id}", get_race, methods=["GET"])
    router.add_api_route("/racing/races/{race_id}/join", join_race, methods=["POST"])
    router.add_api_route("/racing/races/{race_id}/start", start_race, methods=["POST"])
    router.add_api_route("/racing/leaderboard", get_racing_leaderboard, methods=["GET"])
    router.add_api_route("/racing/comps", get_racing_comps, methods=["GET"])
    router.add_api_route("/racing/comps/{comp_id}/enter", enter_racing_comp, methods=["POST"])
