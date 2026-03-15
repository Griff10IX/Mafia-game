import asyncio
import math
import random
import uuid
from datetime import datetime, timezone, timedelta

from typing import Optional, List, Dict, Any
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user_verified, get_current_user, log_gambling


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso(s: str) -> datetime:
    dt = datetime.fromisoformat((s or "").replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _week_start(dt: datetime) -> datetime:
    d = dt.date()
    days_since_monday = (d.weekday()) % 7
    start = d - timedelta(days=days_since_monday)
    return datetime(start.year, start.month, start.day, tzinfo=timezone.utc)


DRILLS: Dict[str, dict] = {
    "weights": {"name": "Weights", "cooldown_seconds": 60, "gains": {"power": 1}, "stamina_cost": 6},
    "speed_bag": {"name": "Speed Bag", "cooldown_seconds": 60, "gains": {"speed": 1, "accuracy": 1}, "stamina_cost": 5},
    "roadwork": {"name": "Roadwork", "cooldown_seconds": 90, "gains": {"stamina": 2}, "stamina_cost": 8},
    "sparring": {"name": "Sparring", "cooldown_seconds": 120, "gains": {"defense": 1, "accuracy": 1}, "stamina_cost": 10},
    "hand_speed": {"name": "Hand Speed", "cooldown_seconds": 75, "gains": {"speed": 1, "accuracy": 1}, "stamina_cost": 6},
    "slip_bag": {"name": "Slip Bag", "cooldown_seconds": 75, "gains": {"defense": 1, "accuracy": 1}, "stamina_cost": 6},
    "conditioning": {"name": "Conditioning", "cooldown_seconds": 90, "gains": {"recovery": 1, "stamina": 1}, "stamina_cost": 8},
    "body_work": {"name": "Body Work", "cooldown_seconds": 90, "gains": {"chin": 1, "defense": 1}, "stamina_cost": 7},
}

GYMS: List[dict] = [
    {"id": "gym_starter", "name": "Starter Gym", "max_level": 10, "base_cost": 20000, "bonus_per_level": {"stamina": 0.01}},
    {"id": "gym_pro", "name": "Pro Gym", "max_level": 10, "base_cost": 120000, "bonus_per_level": {"speed": 0.01, "accuracy": 0.005}},
    {"id": "gym_elite", "name": "Elite Gym", "max_level": 10, "base_cost": 600000, "bonus_per_level": {"power": 0.01, "defense": 0.01}},
]

COACHES: List[dict] = [
    {"id": "coach_local", "name": "Local Coach", "hire_cost": 50000, "bonus": {"accuracy": 0.03}},
    {"id": "coach_veteran", "name": "Veteran Coach", "hire_cost": 250000, "bonus": {"defense": 0.04, "stamina": 0.02}},
    {"id": "coach_world", "name": "World-Class Coach", "hire_cost": 1200000, "bonus": {"power": 0.03, "speed": 0.03, "accuracy": 0.03}},
]

GEAR: List[dict] = [
    {"id": "gloves_basic", "slot": "gloves", "name": "Basic Gloves", "cost": 15000, "bonus": {"power": 0.01}, "theme": "classic"},
    {"id": "gloves_pro", "slot": "gloves", "name": "Pro Gloves", "cost": 90000, "bonus": {"power": 0.02}, "theme": "classic"},
    {"id": "gloves_champ", "slot": "gloves", "name": "Champion Gloves", "cost": 200000, "bonus": {"power": 0.03}, "theme": "champion", "wins_required": 25},
    {"id": "gloves_neon", "slot": "gloves", "name": "Neon Gloves", "cost": 120000, "bonus": {"power": 0.02, "speed": 0.01}, "theme": "neon", "wins_required": 10},
    {"id": "boots_basic", "slot": "boots", "name": "Basic Boots", "cost": 12000, "bonus": {"speed": 0.01}, "theme": "classic"},
    {"id": "boots_pro", "slot": "boots", "name": "Pro Boots", "cost": 80000, "bonus": {"speed": 0.02}, "theme": "classic"},
    {"id": "boots_champ", "slot": "boots", "name": "Champion Boots", "cost": 180000, "bonus": {"speed": 0.03}, "theme": "champion", "wins_required": 50},
    {"id": "boots_neon", "slot": "boots", "name": "Neon Boots", "cost": 95000, "bonus": {"speed": 0.02}, "theme": "neon", "wins_required": 5},
    {"id": "mouthguard_basic", "slot": "mouthguard", "name": "Mouthguard", "cost": 18000, "bonus": {"defense": 0.01}, "theme": "classic"},
    {"id": "headgear_basic", "slot": "headgear", "name": "Headgear", "cost": 22000, "bonus": {"defense": 0.01, "accuracy": 0.005}, "theme": "classic"},
]

# NPC boxers: id, name, base stats (1-10), rating for odds/rating change
BOXING_NPCS: List[dict] = [
    {"id": "npc_bruiser", "name": "Street Bruiser", "power": 8, "speed": 4, "stamina": 6, "defense": 4, "accuracy": 4, "chin": 6, "recovery": 5, "rating": 900},
    {"id": "npc_slick", "name": "Slick Eddie", "power": 4, "speed": 8, "stamina": 5, "defense": 6, "accuracy": 7, "chin": 4, "recovery": 5, "rating": 950},
    {"id": "npc_tank", "name": "Iron Tank", "power": 7, "speed": 3, "stamina": 9, "defense": 8, "accuracy": 3, "chin": 8, "recovery": 7, "rating": 1000},
    {"id": "npc_phantom", "name": "The Phantom", "power": 6, "speed": 9, "stamina": 6, "defense": 5, "accuracy": 8, "chin": 4, "recovery": 5, "rating": 1050},
    {"id": "npc_champ", "name": "Back-Alley Champ", "power": 8, "speed": 7, "stamina": 7, "defense": 6, "accuracy": 7, "chin": 7, "recovery": 6, "rating": 1150},
]

# Configurable round break (seconds between rounds) and count duration for KD
ROUND_BREAK_SECONDS = 6
COUNT_DURATION_SECONDS = 9

# Knockdown rules - 3 knockdowns in a round or total = TKO
MAX_KNOCKDOWNS_PER_ROUND = 3
MAX_KNOCKDOWNS_TOTAL = 3


def _get_npc_by_id_or_name(value: str) -> Optional[dict]:
    if not value:
        return None
    v = (value or "").strip().lower()
    for n in BOXING_NPCS:
        if (n.get("id") or "").lower() == v or (n.get("name") or "").lower() == v:
            return n
    return None


DEFAULT_PROFILE = {
    "power": 1,
    "speed": 1,
    "stamina": 1,
    "defense": 1,
    "accuracy": 1,
    "chin": 1,
    "recovery": 1,
    "rating": 1000,
    "gym_id": "gym_starter",
    "gym_level": 0,
    "coach_id": None,
    "equipped": {"gloves": None, "boots": None, "mouthguard": None, "headgear": None},
    "training": {k: {"level": 0, "last_at": None} for k in DRILLS.keys()},
}


async def _ensure_profile(user_id: str) -> dict:
    prof = await db.boxing_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if prof:
        return prof
    doc = {"user_id": user_id, **DEFAULT_PROFILE}
    await db.boxing_profiles.insert_one(doc)
    return doc


def _gym_bonus(gym_id: str, gym_level: int) -> dict:
    g = next((x for x in GYMS if x["id"] == gym_id), None) or GYMS[0]
    lvl = max(0, min(int(gym_level or 0), int(g.get("max_level") or 0)))
    out: Dict[str, float] = {}
    for stat, per in (g.get("bonus_per_level") or {}).items():
        try:
            out[stat] = float(per) * lvl
        except Exception:
            continue
    return out


def _coach_bonus(coach_id: Optional[str]) -> dict:
    if not coach_id:
        return {}
    c = next((x for x in COACHES if x["id"] == coach_id), None)
    return dict(c.get("bonus") or {}) if c else {}


def _gear_bonus(equipped: dict) -> dict:
    out: Dict[str, float] = {}
    eq = equipped or {}
    for slot in ("gloves", "boots", "mouthguard", "headgear"):
        gid = (eq.get(slot) or "").strip()
        if not gid:
            continue
        item = next((x for x in GEAR if x["id"] == gid and x.get("slot") == slot), None)
        if not item:
            continue
        for stat, val in (item.get("bonus") or {}).items():
            try:
                out[stat] = out.get(stat, 0.0) + float(val)
            except Exception:
                continue
    return out


STAT_KEYS = ("power", "speed", "stamina", "defense", "accuracy", "chin", "recovery")


def _effective_stats(profile: dict) -> dict:
    base = {k: int(profile.get(k, 1) or 1) for k in STAT_KEYS}
    bonus = {}
    for b in (_gym_bonus(profile.get("gym_id"), profile.get("gym_level")), _coach_bonus(profile.get("coach_id")), _gear_bonus(profile.get("equipped"))):
        for k, v in (b or {}).items():
            bonus[k] = bonus.get(k, 0.0) + float(v or 0.0)
    eff = {}
    for k, v in base.items():
        eff[k] = max(1, int(round(v * (1.0 + float(bonus.get(k, 0.0))))))
    return eff


def _rating_expected(a: int, b: int) -> float:
    return 1.0 / (1.0 + 10.0 ** ((b - a) / 400.0))


def _rating_update(a: int, b: int, a_won: bool) -> tuple[int, int]:
    ea = _rating_expected(a, b)
    sa = 1.0 if a_won else 0.0
    k = 24
    a2 = int(round(a + k * (sa - ea)))
    b2 = int(round(b + k * ((1.0 - sa) - (1.0 - ea))))
    return max(100, a2), max(100, b2)


def _decimal_odds_from_prob(p: float) -> float:
    p = max(0.05, min(0.95, float(p)))
    return max(1.01, round(1.0 / p, 2))


def _match_odds(rating_a: int, rating_b: int) -> dict:
    pa = _rating_expected(int(rating_a or 1000), int(rating_b or 1000))
    pb = 1.0 - pa
    # small house margin by nudging implied probs upward slightly then renormalizing
    pa2 = min(0.97, pa + 0.03)
    pb2 = min(0.97, pb + 0.03)
    s = pa2 + pb2
    pa2, pb2 = pa2 / s, pb2 / s
    return {"a": _decimal_odds_from_prob(pa2), "b": _decimal_odds_from_prob(pb2)}


class TrainRequest(BaseModel):
    drill_id: str


class MatchCreateRequest(BaseModel):
    opponent_username: Optional[str] = None


class MatchJoinRequest(BaseModel):
    match_id: str


class MatchReadyRequest(BaseModel):
    match_id: str
    ready: bool = True


class BetPlaceRequest(BaseModel):
    match_id: str
    fighter: str  # "a" or "b"
    stake: int


class BetCancelRequest(BaseModel):
    bet_id: str


class GymMoveRequest(BaseModel):
    gym_id: str


class CoachHireRequest(BaseModel):
    coach_id: str


class GearBuyRequest(BaseModel):
    gear_id: str


class GearEquipRequest(BaseModel):
    gear_id: Optional[str] = None
    slot: str


async def get_boxing_profile(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_profile(current_user["id"])
    eff = _effective_stats(prof)
    return {"profile": prof, "effective": eff, "drills": DRILLS, "gyms": GYMS, "coaches": COACHES, "gear": GEAR}


async def npcs_list(current_user: dict = Depends(get_current_user)):
    return {"npcs": BOXING_NPCS}


async def train(payload: TrainRequest, current_user: dict = Depends(get_current_user_verified)):
    drill_id = (payload.drill_id or "").strip()
    if drill_id not in DRILLS:
        raise HTTPException(status_code=400, detail="Invalid drill")
    prof = await _ensure_profile(current_user["id"])
    drill = DRILLS[drill_id]
    t = (prof.get("training") or {}).get(drill_id) or {}
    last_at = t.get("last_at")
    now = datetime.now(timezone.utc)
    if last_at:
        try:
            last_dt = _parse_iso(last_at)
            cd = int(drill.get("cooldown_seconds") or 0)
            if cd > 0 and (now - last_dt).total_seconds() < cd:
                remaining = int(cd - (now - last_dt).total_seconds())
                raise HTTPException(status_code=400, detail=f"Cooldown: {remaining}s")
        except HTTPException:
            raise
        except Exception:
            pass
    # Training stamina pool: 100/day, resets at midnight UTC
    stam_cost = int(drill.get("stamina_cost") or 0)
    stam_date = (prof.get("training_stamina_date") or "")[:10]
    today_str = now.strftime("%Y-%m-%d")
    current_stam = int(prof.get("training_stamina") or 100)
    if stam_date != today_str:
        current_stam = 100
    if stam_cost > 0 and current_stam < stam_cost:
        raise HTTPException(status_code=400, detail=f"Not enough training stamina ({current_stam}/{stam_cost}). Resets daily.")
    inc: Dict[str, int] = {}
    for stat, gain in (drill.get("gains") or {}).items():
        inc[stat] = int(gain or 0)
    if not inc:
        raise HTTPException(status_code=400, detail="Drill misconfigured")
    new_stam = max(0, current_stam - stam_cost)
    update = {"$inc": inc, "$set": {f"training.{drill_id}.last_at": _now_iso(), "training_stamina": new_stam, "training_stamina_date": today_str}}
    await db.boxing_profiles.update_one({"user_id": current_user["id"]}, update, upsert=True)
    prof2 = await _ensure_profile(current_user["id"])
    return {"message": f"Trained: {drill.get('name')}", "profile": prof2, "effective": _effective_stats(prof2), "drills": DRILLS, "training_stamina": new_stam}


async def get_gym(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_profile(current_user["id"])
    gym_id = prof.get("gym_id")
    gym = next((g for g in GYMS if g["id"] == gym_id), GYMS[0])
    return {"gym": gym, "gym_level": int(prof.get("gym_level") or 0), "gyms": GYMS}


async def gym_upgrade(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_profile(current_user["id"])
    gym = next((g for g in GYMS if g["id"] == prof.get("gym_id")), GYMS[0])
    lvl = int(prof.get("gym_level") or 0)
    max_lvl = int(gym.get("max_level") or 0)
    if lvl >= max_lvl:
        raise HTTPException(status_code=400, detail="Gym is maxed; move to a better gym")
    base_cost = int(gym.get("base_cost") or 0)
    cost = int(round(base_cost * (1.0 + (lvl * 0.35))))
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(user.get("money") or 0) if user else 0
    if cost > money:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    await db.boxing_profiles.update_one({"user_id": current_user["id"]}, {"$inc": {"gym_level": 1}}, upsert=True)
    prof2 = await _ensure_profile(current_user["id"])
    return {"message": f"Gym upgraded to level {int(prof2.get('gym_level') or 0)}", "spent": cost, "profile": prof2, "effective": _effective_stats(prof2)}


async def gym_move(payload: GymMoveRequest, current_user: dict = Depends(get_current_user_verified)):
    gym_id = (payload.gym_id or "").strip()
    if not gym_id:
        raise HTTPException(status_code=400, detail="gym_id required")
    prof = await _ensure_profile(current_user["id"])
    current_gym = next((g for g in GYMS if g["id"] == prof.get("gym_id")), GYMS[0])
    if int(prof.get("gym_level") or 0) < int(current_gym.get("max_level") or 0):
        raise HTTPException(status_code=400, detail="Max your current gym before moving")
    new_gym = next((g for g in GYMS if g["id"] == gym_id), None)
    if not new_gym:
        raise HTTPException(status_code=400, detail="Invalid gym")
    await db.boxing_profiles.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"gym_id": gym_id, "gym_level": 0}},
        upsert=True,
    )
    prof2 = await _ensure_profile(current_user["id"])
    return {"message": f"Moved to {new_gym.get('name')}", "profile": prof2, "effective": _effective_stats(prof2)}


async def coaches_list(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_profile(current_user["id"])
    return {"coaches": COACHES, "coach_id": prof.get("coach_id")}


async def coach_hire(payload: CoachHireRequest, current_user: dict = Depends(get_current_user_verified)):
    coach_id = (payload.coach_id or "").strip()
    coach = next((c for c in COACHES if c["id"] == coach_id), None)
    if not coach:
        raise HTTPException(status_code=400, detail="Invalid coach")
    cost = int(coach.get("hire_cost") or 0)
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(user.get("money") or 0) if user else 0
    if cost > money:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    await db.boxing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {"coach_id": coach_id}}, upsert=True)
    prof2 = await _ensure_profile(current_user["id"])
    return {"message": f"Hired {coach.get('name')}", "spent": cost, "profile": prof2, "effective": _effective_stats(prof2)}


async def coach_fire(current_user: dict = Depends(get_current_user_verified)):
    await _ensure_profile(current_user["id"])
    await db.boxing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {"coach_id": None}}, upsert=True)
    prof2 = await _ensure_profile(current_user["id"])
    return {"message": "Coach fired", "profile": prof2, "effective": _effective_stats(prof2)}


async def _get_user_boxing_wins(database, user_id: str) -> int:
    c = await database.boxing_events.count_documents({"user_id": user_id, "result": "win"})
    return int(c)


async def gear_list(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_profile(current_user["id"])
    owned = await db.user_boxing_gear.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(200)
    owned_ids = {o.get("gear_id") for o in owned if o.get("gear_id")}
    total_wins = await _get_user_boxing_wins(db, current_user["id"])
    gear_with_unlock = []
    for g in GEAR:
        req = g.get("wins_required")
        unlocked = req is None or total_wins >= int(req)
        gear_with_unlock.append({**g, "unlocked": unlocked})
    return {"gear": gear_with_unlock, "owned_ids": list(owned_ids), "equipped": prof.get("equipped") or {}, "total_wins": total_wins}


async def gear_buy(payload: GearBuyRequest, current_user: dict = Depends(get_current_user_verified)):
    gear_id = (payload.gear_id or "").strip()
    item = next((g for g in GEAR if g["id"] == gear_id), None)
    if not item:
        raise HTTPException(status_code=400, detail="Invalid gear")
    wins_required = item.get("wins_required")
    if wins_required is not None:
        total_wins = await _get_user_boxing_wins(db, current_user["id"])
        if total_wins < int(wins_required):
            raise HTTPException(status_code=400, detail=f"Unlock at {wins_required} wins (you have {total_wins})")
    existing = await db.user_boxing_gear.find_one({"user_id": current_user["id"], "gear_id": gear_id}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Already owned")
    cost = int(item.get("cost") or 0)
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(user.get("money") or 0) if user else 0
    if cost > money:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    await db.user_boxing_gear.insert_one({"id": str(uuid.uuid4()), "user_id": current_user["id"], "gear_id": gear_id, "acquired_at": _now_iso()})
    return {"message": f"Bought {item.get('name')}", "spent": cost}


async def gear_equip(payload: GearEquipRequest, current_user: dict = Depends(get_current_user_verified)):
    slot = (payload.slot or "").strip()
    if slot not in ("gloves", "boots", "mouthguard", "headgear"):
        raise HTTPException(status_code=400, detail="Invalid slot")
    gear_id = (payload.gear_id or "").strip() or None
    if gear_id:
        item = next((g for g in GEAR if g["id"] == gear_id and g.get("slot") == slot), None)
        if not item:
            raise HTTPException(status_code=400, detail="Invalid gear for slot")
        wins_required = item.get("wins_required")
        if wins_required is not None:
            total_wins = await _get_user_boxing_wins(db, current_user["id"])
            if total_wins < int(wins_required):
                raise HTTPException(status_code=400, detail=f"Unlock at {wins_required} wins (you have {total_wins})")
        owned = await db.user_boxing_gear.find_one({"user_id": current_user["id"], "gear_id": gear_id}, {"_id": 0})
        if not owned:
            raise HTTPException(status_code=400, detail="Not owned")
    await _ensure_profile(current_user["id"])
    await db.boxing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {f"equipped.{slot}": gear_id}}, upsert=True)
    prof2 = await _ensure_profile(current_user["id"])
    return {"message": "Equipped updated", "profile": prof2, "effective": _effective_stats(prof2)}


async def matches_create(payload: MatchCreateRequest, current_user: dict = Depends(get_current_user_verified)):
    opp_name = (payload.opponent_username or "").strip()
    # If no opponent specified, create an open challenge that any other player can join.
    if not opp_name:
        await _ensure_profile(current_user["id"])
        match_id = str(uuid.uuid4())
        now = _now_iso()
        a_prof = await db.boxing_profiles.find_one({"user_id": current_user["id"]}, {"_id": 0, "rating": 1})
        ra = int(a_prof.get("rating") or 1000) if a_prof else 1000
        # Placeholder odds until someone joins; update on join.
        odds = {"a": 1.8, "b": 1.8}
        doc = {
            "id": match_id,
            "a_id": current_user["id"],
            "a_username": current_user.get("username") or "?",
            "b_id": None,
            "b_username": None,
            "state": "pending",
            "created_at": now,
            "ready": {"a": False, "b": False},
            "round": 0,
            "max_rounds": 12,
            "hp": {"a": 100, "b": 100},
            "stam": {"a": 100, "b": 100},
            "kds": {"a": 0, "b": 0},  # Total knockdowns per fighter
            "kds_this_round": {"a": 0, "b": 0},  # Knockdowns in current round (reset each round)
            "odds": odds,
            "rounds": [],
            "winner": None,
            "finish_reason": None,
            "is_open": True,
        }
        await db.boxing_matches.insert_one(doc)
        return {"message": "Open match created", "match_id": match_id}
    npc = _get_npc_by_id_or_name(opp_name)
    if npc:
        # Create match vs NPC: scale NPC to player level so matches are even
        await _ensure_profile(current_user["id"])
        match_id = str(uuid.uuid4())
        now = _now_iso()
        a_prof = await db.boxing_profiles.find_one({"user_id": current_user["id"]}, {"_id": 0})
        a_prof = a_prof or DEFAULT_PROFILE
        player_eff = _effective_stats(a_prof)
        player_level = sum(player_eff.get(k, 1) for k in STAT_KEYS) / len(STAT_KEYS)
        npc_design_level = sum(int(npc.get(k, 1) or 1) for k in STAT_KEYS) / len(STAT_KEYS)
        if npc_design_level < 1:
            npc_design_level = 1
        # Scale so NPC average is close to player (band 0.92–1.08 for variety but still even)
        ratio = (player_level / npc_design_level) * random.uniform(0.92, 1.08)
        b_npc_stats = {k: max(1, min(15, int(round(int(npc.get(k, 1) or 1) * ratio)))) for k in STAT_KEYS}
        ra = int(a_prof.get("rating") or 1000)
        # Use player rating for NPC so odds reflect an even match
        rb = ra + random.randint(-40, 40)
        rb = max(100, min(3000, rb))
        odds = _match_odds(ra, rb)
        doc = {
            "id": match_id,
            "a_id": current_user["id"],
            "a_username": current_user.get("username") or "?",
            "b_id": npc["id"],
            "b_username": npc.get("name") or "?",
            "b_is_npc": True,
            "b_npc_stats": b_npc_stats,
            "state": "pending",
            "created_at": now,
            "ready": {"a": False, "b": True},
            "round": 0,
            "max_rounds": 12,
            "hp": {"a": 100, "b": 100},
            "stam": {"a": 100, "b": 100},
            "kds": {"a": 0, "b": 0},  # Total knockdowns per fighter
            "kds_this_round": {"a": 0, "b": 0},  # Knockdowns in current round
            "odds": {"a": odds["a"], "b": odds["b"]},
            "rounds": [],
            "winner": None,
            "finish_reason": None,
            "round_break_seconds": ROUND_BREAK_SECONDS,
        }
        await db.boxing_matches.insert_one(doc)
        return {"message": f"Match created vs {npc.get('name')} (NPC)", "match_id": match_id}
    opp = await db.users.find_one({"username": opp_name, "is_dead": {"$ne": True}, "is_npc": {"$ne": True}}, {"_id": 0, "id": 1, "username": 1})
    if not opp:
        raise HTTPException(status_code=404, detail="Opponent not found")
    if opp["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot challenge yourself")
    await _ensure_profile(current_user["id"])
    await _ensure_profile(opp["id"])
    match_id = str(uuid.uuid4())
    now = _now_iso()
    a_prof = await db.boxing_profiles.find_one({"user_id": current_user["id"]}, {"_id": 0, "rating": 1})
    b_prof = await db.boxing_profiles.find_one({"user_id": opp["id"]}, {"_id": 0, "rating": 1})
    odds = _match_odds(int(a_prof.get("rating") or 1000) if a_prof else 1000, int(b_prof.get("rating") or 1000) if b_prof else 1000)
    doc = {
        "id": match_id,
        "a_id": current_user["id"],
        "a_username": current_user.get("username") or "?",
        "b_id": opp["id"],
        "b_username": opp.get("username") or "?",
        "state": "pending",
        "created_at": now,
        "ready": {"a": False, "b": False},
        "round": 0,
        "max_rounds": 12,
        "hp": {"a": 100, "b": 100},
        "stam": {"a": 100, "b": 100},
        "kds": {"a": 0, "b": 0},  # Total knockdowns per fighter
        "kds_this_round": {"a": 0, "b": 0},  # Knockdowns in current round
        "odds": {"a": odds["a"], "b": odds["b"]},
        "rounds": [],
        "winner": None,
        "finish_reason": None,
    }
    await db.boxing_matches.insert_one(doc)
    return {"message": f"Match created vs {opp.get('username')}", "match_id": match_id}


async def matches_ready(payload: MatchReadyRequest, current_user: dict = Depends(get_current_user_verified)):
    match_id = (payload.match_id or "").strip()
    if not match_id:
        raise HTTPException(status_code=400, detail="match_id required")
    m = await db.boxing_matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    if m.get("state") not in ("pending", "ready"):
        raise HTTPException(status_code=400, detail="Match already started or finished")
    side = None
    if m.get("a_id") == current_user["id"]:
        side = "a"
    elif m.get("b_id") == current_user["id"]:
        side = "b"
    if not side:
        raise HTTPException(status_code=403, detail="Not your match")
    ready_val = bool(payload.ready)
    await db.boxing_matches.update_one({"id": match_id}, {"$set": {f"ready.{side}": ready_val}})
    m2 = await db.boxing_matches.find_one({"id": match_id}, {"_id": 0, "ready": 1, "state": 1})
    r = m2.get("ready") or {}
    if r.get("a") and r.get("b"):
        now = _now_iso()
        await db.boxing_matches.update_one(
            {"id": match_id, "state": {"$in": ["pending", "ready"]}},
            {"$set": {"state": "running", "started_at": now, "next_round_at": now}},
        )
        return {"message": "Fight started", "state": "running"}
    await db.boxing_matches.update_one({"id": match_id}, {"$set": {"state": "ready" if (r.get("a") or r.get("b")) else "pending"}})
    return {"message": "Ready updated", "state": "ready" if (r.get("a") or r.get("b")) else "pending"}


async def matches_join(payload: MatchJoinRequest, current_user: dict = Depends(get_current_user_verified)):
    match_id = (payload.match_id or "").strip()
    if not match_id:
        raise HTTPException(status_code=400, detail="match_id required")
    m = await db.boxing_matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    if not m.get("is_open"):
        raise HTTPException(status_code=400, detail="Match is not open for joining")
    if m.get("a_id") == current_user["id"]:
        raise HTTPException(status_code=400, detail="You created this match")
    if m.get("b_id"):
        raise HTTPException(status_code=400, detail="Match already has an opponent")
    if m.get("state") not in ("pending", "ready"):
        raise HTTPException(status_code=400, detail="Match already started or finished")
    await _ensure_profile(current_user["id"])
    # Compute odds now that we know both ratings
    a_prof, b_prof = await asyncio.gather(
        db.boxing_profiles.find_one({"user_id": m.get("a_id")}, {"_id": 0, "rating": 1}),
        db.boxing_profiles.find_one({"user_id": current_user["id"]}, {"_id": 0, "rating": 1}),
    )
    ra = int((a_prof or {}).get("rating") or 1000)
    rb = int((b_prof or {}).get("rating") or 1000)
    odds = _match_odds(ra, rb)
    await db.boxing_matches.update_one(
        {"id": match_id, "b_id": None, "is_open": True},
        {
            "$set": {
                "b_id": current_user["id"],
                "b_username": current_user.get("username") or "?",
                "is_open": False,
                "odds": {"a": odds["a"], "b": odds["b"]},
            }
        },
    )
    return {"message": "Joined match", "match_id": match_id}


async def matches_get(match_id: str, current_user: dict = Depends(get_current_user)):
    mid = (match_id or "").strip()
    if not mid:
        raise HTTPException(status_code=400, detail="match_id required")
    m = await db.boxing_matches.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    return {"match": m}


async def matches_watch(match_id: str, current_user: dict = Depends(get_current_user)):
    mid = (match_id or "").strip()
    if not mid:
        raise HTTPException(status_code=400, detail="match_id required")
    m = await db.boxing_matches.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    rounds = m.get("rounds") or []
    last = rounds[-1] if rounds else None
    return {
        "id": m.get("id"),
        "state": m.get("state"),
        "fighters": {"a": {"id": m.get("a_id"), "username": m.get("a_username")}, "b": {"id": m.get("b_id"), "username": m.get("b_username")}},
        "round": int(m.get("round") or 0),
        "max_rounds": int(m.get("max_rounds") or 12),
        "hp": m.get("hp") or {"a": 0, "b": 0},
        "stam": m.get("stam") or {"a": 0, "b": 0},
        "kds": m.get("kds") or {"a": 0, "b": 0},  # Total knockdowns per fighter
        "down_fighter": m.get("down_fighter"),  # Currently down fighter during counting phase
        "count_ends_at": m.get("count_ends_at"),  # When the count ends
        "odds": m.get("odds") or {},
        "last_event": last,
        "rounds": rounds,
        "winner": m.get("winner"),
        "finish_reason": m.get("finish_reason"),
    }


async def matches_live(current_user: dict = Depends(get_current_user)):
    # Public list so spectators can watch without needing a match id. Include "counting" state for knockdowns.
    cursor = db.boxing_matches.find(
        {"state": {"$in": ["pending", "ready", "running", "counting"]}},
        {"_id": 0, "id": 1, "state": 1, "created_at": 1, "started_at": 1, "a_username": 1, "b_username": 1, "round": 1, "max_rounds": 1, "hp": 1, "stam": 1, "kds": 1, "down_fighter": 1, "count_ends_at": 1, "odds": 1, "is_open": 1},
    ).sort("created_at", -1).limit(25)
    matches = await cursor.to_list(25)
    # Cap round at max_rounds so we never show e.g. R77/12 (fight ends at 12)
    for m in matches:
        mr = int(m.get("max_rounds") or 12)
        r = int(m.get("round") or 0)
        if r > mr:
            m["round"] = mr
    return {"matches": matches}


async def bets_place(payload: BetPlaceRequest, current_user: dict = Depends(get_current_user_verified)):
    match_id = (payload.match_id or "").strip()
    fighter = (payload.fighter or "").strip().lower()
    stake = int(payload.stake or 0)
    if fighter not in ("a", "b"):
        raise HTTPException(status_code=400, detail="fighter must be a or b")
    if stake <= 0:
        raise HTTPException(status_code=400, detail="Stake must be greater than 0")
    m = await db.boxing_matches.find_one({"id": match_id}, {"_id": 0, "state": 1, "odds": 1, "a_username": 1, "b_username": 1})
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    if m.get("state") not in ("pending", "ready"):
        raise HTTPException(status_code=400, detail="Betting closed")
    odds = float(((m.get("odds") or {}).get(fighter)) or 2.0)
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(user.get("money") or 0) if user else 0
    if stake > money:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    bet_id = str(uuid.uuid4())
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -stake}})
    await db.boxing_bets.insert_one({
        "id": bet_id,
        "user_id": current_user["id"],
        "match_id": match_id,
        "fighter": fighter,
        "odds": odds,
        "stake": stake,
        "status": "open",
        "created_at": _now_iso(),
    })
    await log_gambling(current_user["id"], current_user.get("username") or "?", "boxing_bet", {"bet_id": bet_id, "match_id": match_id, "fighter": fighter, "odds": odds, "stake": stake, "status": "open"})
    who = m.get("a_username") if fighter == "a" else m.get("b_username")
    return {"message": f"Bet placed: ${stake:,} on {who}", "bet_id": bet_id}


async def bets_cancel(payload: BetCancelRequest, current_user: dict = Depends(get_current_user_verified)):
    bet_id = (payload.bet_id or "").strip()
    if not bet_id:
        raise HTTPException(status_code=400, detail="bet_id required")
    bet = await db.boxing_bets.find_one({"id": bet_id, "user_id": current_user["id"], "status": "open"}, {"_id": 0})
    if not bet:
        raise HTTPException(status_code=404, detail="Bet not found or already settled")
    m = await db.boxing_matches.find_one({"id": bet.get("match_id")}, {"_id": 0, "state": 1})
    if not m or m.get("state") not in ("pending", "ready"):
        raise HTTPException(status_code=400, detail="Cannot cancel; match already started")
    stake = int(bet.get("stake") or 0)
    await db.boxing_bets.update_one({"id": bet_id}, {"$set": {"status": "cancelled", "settled_at": _now_iso()}})
    if stake > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": stake}})
    return {"message": f"Bet cancelled. ${stake:,} refunded.", "refunded": stake}


async def bets_my(current_user: dict = Depends(get_current_user_verified)):
    open_bets = await db.boxing_bets.find({"user_id": current_user["id"], "status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(50)
    closed_bets = await db.boxing_bets.find({"user_id": current_user["id"], "status": {"$in": ["won", "lost", "cancelled"]}}, {"_id": 0}).sort("settled_at", -1).to_list(50)
    return {"open": open_bets, "closed": closed_bets}


def _decision_winner(rounds_list: list, a_id: str, b_id: str) -> tuple:
    """
    Determine winner by decision from rounds. Tie-break: total damage A vs B, then total hits, then random.
    Returns (winner_id, reason) where reason is "decision" or "split_decision".
    """
    total_a = sum((r.get("a_dmg") or 0) for r in rounds_list)
    total_b = sum((r.get("b_dmg") or 0) for r in rounds_list)
    if total_a != total_b:
        winner_id = a_id if total_a > total_b else b_id
        return winner_id, "decision"
    hits_a = sum((r.get("a_hits") or 0) for r in rounds_list)
    hits_b = sum((r.get("b_hits") or 0) for r in rounds_list)
    if hits_a != hits_b:
        winner_id = a_id if hits_a > hits_b else b_id
        return winner_id, "decision"
    winner_id = a_id if random.random() < 0.5 else b_id
    return winner_id, "split_decision"


def _round_exchange(a_stats: dict, b_stats: dict, a_hp: int, b_hp: int, a_stam: int, b_stam: int, first_round: bool = True, a_kds_round: int = 0, b_kds_round: int = 0) -> dict:
    """
    Simulate a single round exchange.
    Inputs: a_stats, b_stats (effective stats dicts), a_hp, b_hp, a_stam, b_stam (current values), first_round (bool).
    Outputs: dict with a_hits, b_hits, a_dmg, b_dmg, hp {a,b}, stam {a,b}, a_kds_this_round, b_kds_this_round.
    """
    def clamp(n, lo, hi):
        return max(lo, min(hi, int(n)))

    # stamina regen at start of round (only flat +6 on first round; round 2+ recovery done in caller)
    if first_round:
        a_stam = clamp(a_stam + 6, 0, 100)
        b_stam = clamp(b_stam + 6, 0, 100)

    # per-round attempts scale with speed and current stamina
    a_attempts = clamp(8 + (a_stats["speed"] // 2) + (a_stam // 25), 6, 22)
    b_attempts = clamp(8 + (b_stats["speed"] // 2) + (b_stam // 25), 6, 22)

    def resolve(att_stats, def_stats, attempts, att_stam, def_hp, def_stam):
        base_acc = 0.28 + (att_stats["accuracy"] * 0.012) + (att_stats["speed"] * 0.003)
        def_avoid = 0.10 + (def_stats["defense"] * 0.012) + (def_stats["speed"] * 0.003)
        stam_penalty = max(0.0, (40 - att_stam) * 0.004)
        p_hit = max(0.05, min(0.80, base_acc - def_avoid - stam_penalty))
        hits = 0
        dmg = 0
        knockdowns = 0
        def_chin = max(1, int(def_stats.get("chin", 1) or 1))
        chin_mult = max(0.70, 1.0 - (def_chin - 1) * 0.03)
        
        for _ in range(attempts):
            if random.random() < p_hit:
                hits += 1
                per = 1.0 + (att_stats["power"] * 0.35) - (def_stats["defense"] * 0.12)
                punch_dmg = max(1, int(round(per * chin_mult)))
                dmg += punch_dmg
                
                # Knockdown chance based on damage, chin, stamina, and current HP
                # Big punches have a chance to cause knockdown even without HP=0
                if punch_dmg >= 4:  # Only significant punches can cause KD
                    hurt_mult = 1.0
                    if def_hp < 30:
                        hurt_mult = 2.5  # Very hurt fighters go down easier
                    elif def_hp < 50:
                        hurt_mult = 1.6
                    
                    stam_mult = max(0.5, 1.0 + (50 - def_stam) * 0.015)  # Tired fighters go down easier
                    chin_factor = max(0.3, 1.0 - (def_chin - 1) * 0.08)  # Better chin = less likely to drop
                    power_factor = 1.0 + (att_stats.get("power", 1) - 5) * 0.06  # Higher power = more KDs
                    
                    # Base KD chance is low but scales with damage
                    kd_chance = (punch_dmg / 100) * hurt_mult * stam_mult * chin_factor * power_factor
                    kd_chance = min(0.35, kd_chance)  # Cap at 35% per big punch
                    
                    if random.random() < kd_chance:
                        knockdowns += 1
        
        stam_cost = attempts * 2 + hits
        return hits, dmg, stam_cost, knockdowns

    a_hits, a_dmg, a_cost, a_kds_dealt = resolve(a_stats, b_stats, a_attempts, a_stam, b_hp, b_stam)
    b_hits, b_dmg, b_cost, b_kds_dealt = resolve(b_stats, a_stats, b_attempts, b_stam, a_hp, a_stam)

    a_stam = clamp(a_stam - a_cost, 0, 100)
    b_stam = clamp(b_stam - b_cost, 0, 100)

    # Apply damage
    b_hp_after = clamp(b_hp - a_dmg, 0, 100)
    a_hp_after = clamp(a_hp - b_dmg, 0, 100)
    
    # If HP hits 0, that's definitely a knockdown (if not already counted)
    if b_hp_after <= 0 and a_kds_dealt == 0:
        a_kds_dealt = 1
    if a_hp_after <= 0 and b_kds_dealt == 0:
        b_kds_dealt = 1

    # Total knockdowns this round for each fighter
    a_kds_this_round = b_kds_dealt  # A got knocked down by B
    b_kds_this_round = a_kds_dealt  # B got knocked down by A

    out = {
        "a_hits": a_hits, "b_hits": b_hits,
        "a_dmg": a_dmg, "b_dmg": b_dmg,
        "hp": {"a": a_hp_after, "b": b_hp_after},
        "stam": {"a": a_stam, "b": b_stam},
        "a_kds_this_round": a_kds_this_round,  # Times A was knocked down this round
        "b_kds_this_round": b_kds_this_round,  # Times B was knocked down this round
    }
    return out


# Match state machine: pending -> ready (both ready) -> running -> [counting] -> finished | cancelled.
# When next_round_at is due we simulate one round; if HP<=0 or KD rule triggers we go to counting (one fighter down)
# or finish (TKO/double KO). When counting ends we either get-up (back to running, reduced HP/stam, came_from_kd)
# or KO/TKO finish.


async def advance_running_matches(database) -> int:
    now = _now_iso()
    # Auto-cancel stale pending matches older than 30 minutes
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    await database.boxing_matches.update_many(
        {"state": {"$in": ["pending", "ready"]}, "created_at": {"$lte": stale_cutoff}},
        {"$set": {"state": "cancelled", "finished_at": now}},
    )
    # Claim one match due for next round (simple lock to avoid double-advance)
    claim = await database.boxing_matches.find_one_and_update(
        {
            "state": "running",
            "$or": [{"sim_lock": {"$exists": False}}, {"sim_lock": None}],
            "next_round_at": {"$lte": now},
        },
        {"$set": {"sim_lock": str(uuid.uuid4()), "sim_lock_at": now}},
        projection={"_id": 0},
        sort=[("next_round_at", 1)],
        return_document=True,
    )
    if not claim:
        return 0
    match_id = claim.get("id")
    max_rounds = int(claim.get("max_rounds") or 12)
    current_round = int(claim.get("round") or 0)

    # If we're already at max rounds (e.g. get-up after R12 or stuck state), resolve immediately by decision
    if current_round >= max_rounds:
        a_id, b_id = claim.get("a_id"), claim.get("b_id")
        rounds_list = claim.get("rounds") or []
        winner_id, reason = _decision_winner(rounds_list, a_id, b_id)
        now = _now_iso()
        await database.boxing_matches.update_one(
            {"id": match_id},
            {"$set": {"state": "finished", "finished_at": now, "winner": winner_id, "finish_reason": reason, "sim_lock": None}},
        )
        await _finalize_match(database, match_id, winner_id=winner_id, finish_reason=reason)
        return 1

    try:
        a_id, b_id = claim.get("a_id"), claim.get("b_id")
        a_prof, b_prof = await asyncio.gather(
            database.boxing_profiles.find_one({"user_id": a_id}, {"_id": 0}),
            database.boxing_profiles.find_one({"user_id": b_id}, {"_id": 0}),
        )
        # NPCs have no DB profile; use match-stored scaled stats or template
        if b_prof is None:
            b_npc_stats = claim.get("b_npc_stats")
            if b_npc_stats:
                b_prof = {k: int(b_npc_stats.get(k, 1) or 1) for k in STAT_KEYS}
            else:
                npc = next((x for x in BOXING_NPCS if x.get("id") == b_id), None)
                if npc:
                    b_prof = {k: int(npc.get(k, 1) or 1) for k in STAT_KEYS}
        a_eff = _effective_stats(a_prof or DEFAULT_PROFILE)
        b_eff = _effective_stats(b_prof or DEFAULT_PROFILE)
        hp = claim.get("hp") or {"a": 100, "b": 100}
        stam = claim.get("stam") or {"a": 100, "b": 100}
        kds = claim.get("kds") or {"a": 0, "b": 0}
        rnd = int(claim.get("round") or 0) + 1
        hp_a, hp_b = int(hp.get("a") or 100), int(hp.get("b") or 100)
        stam_a, stam_b = int(stam.get("a") or 100), int(stam.get("b") or 100)
        kds_a, kds_b = int(kds.get("a") or 0), int(kds.get("b") or 0)
        
        # Track if fighter came back from knockdown (reduced recovery)
        came_from_kd = claim.get("came_from_kd")

        # Between-round recovery (round 2+)
        if rnd > 1:
            # Reduced recovery if fighter was knocked down last round
            a_recovery_mult = 0.5 if came_from_kd == "a" else 1.0
            b_recovery_mult = 0.5 if came_from_kd == "b" else 1.0
            
            stam_a = min(100, stam_a + (6 + (a_eff.get("stamina") or 1) * 0.8 + (a_eff.get("recovery") or 1) * 0.5) * a_recovery_mult)
            stam_b = min(100, stam_b + (6 + (b_eff.get("stamina") or 1) * 0.8 + (b_eff.get("recovery") or 1) * 0.5) * b_recovery_mult)
            hp_a = min(100, hp_a + (2 + (a_eff.get("recovery") or 1) * 0.4) * a_recovery_mult)
            hp_b = min(100, hp_b + (2 + (b_eff.get("recovery") or 1) * 0.4) * b_recovery_mult)
            stam_a, stam_b = max(0, int(stam_a)), max(0, int(stam_b))
            hp_a, hp_b = max(0, int(hp_a)), max(0, int(hp_b))

        # Reset knockdowns for this round
        kds_this_round_a = 0
        kds_this_round_b = 0
        
        out = _round_exchange(a_eff, b_eff, hp_a, hp_b, stam_a, stam_b, first_round=(rnd == 1))
        
        # Update knockdown counts
        kds_this_round_a = out.get("a_kds_this_round", 0)
        kds_this_round_b = out.get("b_kds_this_round", 0)
        kds_a += kds_this_round_a
        kds_b += kds_this_round_b

        max_rounds = int(claim.get("max_rounds") or 12)
        if rnd > max_rounds:
            rnd = max_rounds  # Defensive: never persist round > max_rounds

        finish = None
        reason = None
        go_to_counting = None  # "a" or "b" if that fighter is down and we enter count
        
        # Check for TKO (3 knockdowns in this round or total)
        if kds_this_round_a >= MAX_KNOCKDOWNS_PER_ROUND or kds_a >= MAX_KNOCKDOWNS_TOTAL:
            finish = "b"  # B wins, A lost by TKO
            reason = "tko"
        elif kds_this_round_b >= MAX_KNOCKDOWNS_PER_ROUND or kds_b >= MAX_KNOCKDOWNS_TOTAL:
            finish = "a"  # A wins, B lost by TKO
            reason = "tko"
        elif out["hp"]["a"] <= 0 and out["hp"]["b"] <= 0:
            finish = "draw"
            reason = "double_ko"
        elif out["hp"]["a"] <= 0:
            go_to_counting = "a"
        elif out["hp"]["b"] <= 0:
            go_to_counting = "b"
        elif kds_this_round_a > 0 and out["hp"]["a"] > 0:
            # Knockdown but HP not 0 - still go to count
            go_to_counting = "a"
        elif kds_this_round_b > 0 and out["hp"]["b"] > 0:
            go_to_counting = "b"
        elif rnd >= max_rounds:
            rounds_with_this = (claim.get("rounds") or []) + [{"a_dmg": out["a_dmg"], "b_dmg": out["b_dmg"], "a_hits": out["a_hits"], "b_hits": out["b_hits"]}]
            winner_id_dec, reason = _decision_winner(rounds_with_this, a_id, b_id)
            finish = "a" if winner_id_dec == a_id else "b"

        round_log = {
            "round": rnd, "at": now,
            "a_hits": out["a_hits"], "b_hits": out["b_hits"],
            "a_dmg": out["a_dmg"], "b_dmg": out["b_dmg"],
            "hp": out["hp"], "stam": out["stam"],
            "a_kds": kds_this_round_a, "b_kds": kds_this_round_b,
        }
        break_sec = int(claim.get("round_break_seconds") or ROUND_BREAK_SECONDS)
        next_round_at = (datetime.now(timezone.utc) + timedelta(seconds=break_sec)).replace(microsecond=0).isoformat().replace("+00:00", "Z")

        updates: Dict[str, Any] = {
            "$set": {
                "round": rnd,
                "hp": out["hp"],
                "stam": out["stam"],
                "kds": {"a": kds_a, "b": kds_b},
                "kds_this_round": {"a": kds_this_round_a, "b": kds_this_round_b},
                "next_round_at": next_round_at,
                "came_from_kd": None,  # Reset
            },
            "$push": {"rounds": round_log},
        }
        if go_to_counting:
            # Client uses down_fighter and count_ends_at for the referee count overlay
            updates["$set"].update({
                "state": "counting",
                "down_fighter": go_to_counting,
                "count_ends_at": (datetime.now(timezone.utc) + timedelta(seconds=COUNT_DURATION_SECONDS)).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            })
        elif finish:
            winner = None
            if finish in ("a", "b"):
                winner = a_id if finish == "a" else b_id
            updates["$set"].update({"state": "finished", "finished_at": now, "winner": winner, "finish_reason": reason})
        await database.boxing_matches.update_one({"id": match_id}, updates)

        if finish:
            wid = a_id if finish == "a" else b_id if finish == "b" else None
            await _finalize_match(database, match_id, winner_id=wid, finish_reason=reason)
        return 1
    finally:
        await database.boxing_matches.update_one({"id": match_id}, {"$set": {"sim_lock": None}})


async def advance_counting_matches(database) -> int:
    """Process matches in 'counting' phase (KD): roll get-up at count_ends_at."""
    now = _now_iso()
    claim = await database.boxing_matches.find_one_and_update(
        {"state": "counting", "count_ends_at": {"$lte": now}},
        {"$set": {"sim_lock": str(uuid.uuid4()), "sim_lock_at": now}},
        projection={"_id": 0},
        sort=[("count_ends_at", 1)],
        return_document=True,
    )
    if not claim:
        return 0
    match_id = claim.get("id")
    try:
        down = claim.get("down_fighter")  # "a" or "b"
        max_rounds = int(claim.get("max_rounds") or 12)
        current_round = int(claim.get("round") or 0)
        if down not in ("a", "b"):
            # Invalid counting state: if at max rounds, finish by decision; else resume running
            a_id, b_id = claim.get("a_id"), claim.get("b_id")
            if current_round >= max_rounds:
                rounds_list = claim.get("rounds") or []
                winner_id, reason = _decision_winner(rounds_list, a_id, b_id)
                now = _now_iso()
                await database.boxing_matches.update_one(
                    {"id": match_id},
                    {"$set": {"state": "finished", "finished_at": now, "winner": winner_id, "finish_reason": reason, "down_fighter": None, "count_ends_at": None, "sim_lock": None}},
                )
                await _finalize_match(database, match_id, winner_id=winner_id, finish_reason=reason)
            else:
                await database.boxing_matches.update_one({"id": match_id}, {"$set": {"state": "running", "sim_lock": None}})
            return 1
        a_id, b_id = claim.get("a_id"), claim.get("b_id")
        a_prof = await database.boxing_profiles.find_one({"user_id": a_id}, {"_id": 0})
        b_prof = await database.boxing_profiles.find_one({"user_id": b_id}, {"_id": 0})
        if b_prof is None:
            b_npc = claim.get("b_npc_stats")
            if b_npc:
                b_prof = b_npc
            else:
                npc = next((x for x in BOXING_NPCS if x.get("id") == b_id), None)
                b_prof = {k: int(npc.get(k, 1) or 1) for k in STAT_KEYS} if npc else DEFAULT_PROFILE
        a_eff = _effective_stats(a_prof or DEFAULT_PROFILE)
        b_eff = _effective_stats(b_prof or DEFAULT_PROFILE)
        down_eff = a_eff if down == "a" else b_eff
        recovery = max(1, int(down_eff.get("recovery") or 1))
        chin = max(1, int(down_eff.get("chin") or 1))
        # Base 50% get-up chance so most knockdowns are not KOs; stats add up to 50% more (100% at 10/10)
        p_get_up = min(1.0, 0.50 + (recovery / 10.0) * 0.30 + (chin / 10.0) * 0.20)
        got_up = random.random() < p_get_up
        hp = dict(claim.get("hp") or {"a": 100, "b": 100})
        stam = dict(claim.get("stam") or {"a": 100, "b": 100})

        # Check total knockdowns - if at TKO limit, fighter doesn't get up
        kds = claim.get("kds") or {"a": 0, "b": 0}
        down_kds = kds.get(down) or 0
        if down_kds >= MAX_KNOCKDOWNS_TOTAL:
            got_up = False  # TKO - too many knockdowns

        if got_up:
            # If we're already at max rounds, fight is over — resolve by decision (no extra round)
            if current_round >= max_rounds:
                rounds_list = claim.get("rounds") or []
                winner_id, reason = _decision_winner(rounds_list, a_id, b_id)
                await database.boxing_matches.update_one(
                    {"id": match_id},
                    {"$set": {"state": "finished", "finished_at": now, "winner": winner_id, "finish_reason": reason, "down_fighter": None, "count_ends_at": None}},
                )
                await _finalize_match(database, match_id, winner_id=winner_id, finish_reason=reason)
            else:
                # Fighter gets up but is hurt - reduced HP and stamina
                new_hp = min(100, max(1, 5 + recovery))  # Ensure at least 1 HP
                hp[down] = new_hp
                stam[down] = max(0, int((stam.get(down) or 0) * 0.5))
                break_sec = int(claim.get("round_break_seconds") or ROUND_BREAK_SECONDS)
                next_round_at = (datetime.now(timezone.utc) + timedelta(seconds=break_sec)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
                await database.boxing_matches.update_one(
                    {"id": match_id},
                    {"$set": {
                        "state": "running",
                        "hp": hp,
                        "stam": stam,
                        "next_round_at": next_round_at,
                        "down_fighter": None,
                        "count_ends_at": None,
                        "came_from_kd": down,  # Mark that this fighter came from knockdown (reduced recovery next round)
                    }},
                )
        else:
            winner_id = b_id if down == "a" else a_id
            # Determine if it's KO or TKO based on knockdown count
            finish_reason = "tko" if down_kds >= MAX_KNOCKDOWNS_TOTAL else "ko"
            await database.boxing_matches.update_one(
                {"id": match_id},
                {"$set": {"state": "finished", "finished_at": now, "winner": winner_id, "finish_reason": finish_reason, "down_fighter": None, "count_ends_at": None}},
            )
            await _finalize_match(database, match_id, winner_id=winner_id, finish_reason=finish_reason)
        return 1
    finally:
        await database.boxing_matches.update_one({"id": match_id}, {"$set": {"sim_lock": None}})


async def _finalize_match(database, match_id: str, winner_id: Optional[str], finish_reason: str):
    m = await database.boxing_matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        return
    a_id, b_id = m.get("a_id"), m.get("b_id")
    b_is_npc = bool(m.get("b_is_npc"))
    # idempotency: ensure we only write events/settle once
    cfg = await database.boxing_matches.update_one({"id": match_id, "finalized": {"$ne": True}}, {"$set": {"finalized": True}})
    if cfg.modified_count == 0:
        return
    a_prof = await database.boxing_profiles.find_one({"user_id": a_id}, {"_id": 0, "rating": 1})
    ra = int((a_prof or {}).get("rating") or 1000)
    rb = int(1000)
    if b_is_npc:
        npc = next((x for x in BOXING_NPCS if x.get("id") == b_id), None)
        if npc:
            rb = int(npc.get("rating") or 1000)
    else:
        b_prof = await database.boxing_profiles.find_one({"user_id": b_id}, {"_id": 0, "rating": 1})
        rb = int((b_prof or {}).get("rating") or 1000)
    if winner_id == a_id:
        ra2, rb2 = _rating_update(ra, rb, True)
        aw, bw = 1, 0
    elif winner_id == b_id:
        ra2, rb2 = _rating_update(ra, rb, False)
        aw, bw = 0, 1
    else:
        ra2, rb2 = ra, rb
        aw, bw = 0, 0
    await database.boxing_profiles.update_one({"user_id": a_id}, {"$set": {"rating": ra2}}, upsert=True)
    if not b_is_npc:
        await database.boxing_profiles.update_one({"user_id": b_id}, {"$set": {"rating": rb2}}, upsert=True)
    now = _now_iso()
    ko_bonus = 1 if (finish_reason or "").lower() == "ko" else 0
    a_points = (3 if aw else 0) + (ko_bonus if aw else 0)
    b_points = (3 if bw else 0) + (ko_bonus if bw else 0)
    is_draw = winner_id is None
    events = [
        {"id": str(uuid.uuid4()), "user_id": a_id, "match_id": match_id, "result": "win" if aw else "loss" if bw else "draw", "points": a_points, "at": now, "opponent_id": b_id, "is_draw": is_draw},
    ]
    if not b_is_npc:
        events.append({"id": str(uuid.uuid4()), "user_id": b_id, "match_id": match_id, "result": "win" if bw else "loss" if aw else "draw", "points": b_points, "at": now, "opponent_id": a_id, "is_draw": is_draw})
    await database.boxing_events.insert_many(events)
    await _settle_bets(database, match_id, winner_id, is_draw=is_draw)


async def _settle_bets(database, match_id: str, winner_id: Optional[str], is_draw: bool = False):
    m = await database.boxing_matches.find_one({"id": match_id}, {"_id": 0, "a_id": 1, "b_id": 1})
    if not m:
        return
    win_side = None
    if winner_id and winner_id == m.get("a_id"):
        win_side = "a"
    elif winner_id and winner_id == m.get("b_id"):
        win_side = "b"
    now = _now_iso()
    bets = await database.boxing_bets.find({"match_id": match_id, "status": "open"}, {"_id": 0}).to_list(2000)
    for b in bets:
        if is_draw:
            # Refund stakes on draws
            new_status = "refunded"
            res = await database.boxing_bets.update_one({"id": b["id"], "status": "open"}, {"$set": {"status": new_status, "settled_at": now}})
            if res.modified_count == 0:
                continue
            stake = int(b.get("stake") or 0)
            if stake > 0:
                await database.users.update_one({"id": b.get("user_id")}, {"$inc": {"money": stake}})
        else:
            won = win_side is not None and (b.get("fighter") == win_side)
            new_status = "won" if won else "lost"
            res = await database.boxing_bets.update_one({"id": b["id"], "status": "open"}, {"$set": {"status": new_status, "settled_at": now}})
            if res.modified_count == 0:
                continue
            if won:
                stake = int(b.get("stake") or 0)
                odds = float(b.get("odds") or 1.0)
                payout = int(stake * odds)
                if payout > 0:
                    await database.users.update_one({"id": b.get("user_id")}, {"$inc": {"money": payout}})
        u = await database.users.find_one({"id": b.get("user_id")}, {"_id": 0, "username": 1})
        await log_gambling(b.get("user_id"), (u.get("username") if u else "?"), "boxing_bet", {"bet_id": b.get("id"), "match_id": match_id, "stake": b.get("stake"), "odds": b.get("odds"), "status": new_status, "settled_at": now})


async def league(period: str = "weekly", current_user: dict = Depends(get_current_user)):
    p = (period or "weekly").lower()
    now = datetime.now(timezone.utc)
    if p == "weekly":
        ws = _week_start(now)
        pipeline = [
            {"$addFields": {"_ts": {"$toDate": "$at"}}},
            {"$match": {"_ts": {"$gte": ws}}},
            {"$group": {"_id": "$user_id", "points": {"$sum": "$points"}, "wins": {"$sum": {"$cond": [{"$eq": ["$result", "win"]}, 1, 0]}}, "losses": {"$sum": {"$cond": [{"$eq": ["$result", "loss"]}, 1, 0]}}}},
            {"$sort": {"points": -1, "wins": -1}},
            {"$limit": 100},
        ]
    else:
        pipeline = [
            {"$group": {"_id": "$user_id", "points": {"$sum": "$points"}, "wins": {"$sum": {"$cond": [{"$eq": ["$result", "win"]}, 1, 0]}}, "losses": {"$sum": {"$cond": [{"$eq": ["$result", "loss"]}, 1, 0]}}}},
            {"$sort": {"points": -1, "wins": -1}},
            {"$limit": 100},
        ]
    rows = await db.boxing_events.aggregate(pipeline).to_list(100)
    user_ids = [r["_id"] for r in rows if r.get("_id")]
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(200)
    u_map = {u["id"]: u for u in users}
    out = []
    for i, r in enumerate(rows):
        uid = r.get("_id")
        u = u_map.get(uid) or {}
        out.append({
            "rank": i + 1,
            "user_id": uid,
            "username": u.get("username", "?"),
            "points": int(r.get("points") or 0),
            "wins": int(r.get("wins") or 0),
            "losses": int(r.get("losses") or 0),
            "is_current_user": bool(uid and current_user and uid == current_user.get("id")),
        })
    return {"period": p, "standings": out}


BOXING_PAYOUT_CONFIG_ID = "boxing_weekly_payout"


async def run_weekly_boxing_league_payout(database, test_run: bool = False):
    now = datetime.now(timezone.utc)
    this_week_start = _week_start(now)
    last_week_start = this_week_start - timedelta(days=7)
    last_week_start_str = last_week_start.strftime("%Y-%m-%d")
    cfg = await database.game_config.find_one({"id": BOXING_PAYOUT_CONFIG_ID}, {"_id": 0, "last_run_week_start": 1, "top1_points": 1, "top2_points": 1, "top3_points": 1, "top4_10_points": 1})
    if cfg and cfg.get("last_run_week_start") == last_week_start_str and not test_run:
        return
    top1 = int((cfg or {}).get("top1_points") or 5000)
    top2 = int((cfg or {}).get("top2_points") or 3000)
    top3 = int((cfg or {}).get("top3_points") or 1000)
    top4_10 = int((cfg or {}).get("top4_10_points") or 500)

    def points_for_rank(rank: int) -> int:
        if rank == 1:
            return top1
        if rank == 2:
            return top2
        if rank == 3:
            return top3
        if 4 <= rank <= 10:
            return top4_10
        return 0

    if not test_run:
        claim_filter = {"id": BOXING_PAYOUT_CONFIG_ID, "$or": [{"last_run_week_start": {"$ne": last_week_start_str}}, {"last_run_week_start": {"$exists": False}}]}
        claim_result = await database.game_config.update_one(claim_filter, {"$set": {"last_run_week_start": last_week_start_str}}, upsert=True)
        if claim_result.modified_count == 0 and claim_result.upserted_id is None:
            return

    pipeline = [
        {"$addFields": {"_ts": {"$toDate": "$at"}}},
        {"$match": {"_ts": {"$gte": last_week_start, "$lt": this_week_start}}},
        {"$group": {"_id": "$user_id", "points": {"$sum": "$points"}}},
        {"$sort": {"points": -1}},
        {"$limit": 10},
    ]
    rows = await database.boxing_events.aggregate(pipeline).to_list(10)
    if test_run:
        return
    for i, r in enumerate(rows):
        uid = r.get("_id")
        if not uid:
            continue
        pts = points_for_rank(i + 1)
        if pts > 0:
            await database.users.update_one({"id": uid}, {"$inc": {"money": pts}})


async def fight_history(current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    matches = await db.boxing_matches.find(
        {"state": "finished", "$or": [{"a_id": uid}, {"b_id": uid}]},
        {"_id": 0, "id": 1, "a_id": 1, "b_id": 1, "a_username": 1, "b_username": 1, "winner": 1, "finish_reason": 1, "round": 1, "max_rounds": 1, "finished_at": 1},
    ).sort("finished_at", -1).to_list(20)
    out = []
    for m in matches:
        is_a = m.get("a_id") == uid
        opponent = m.get("b_username") if is_a else m.get("a_username")
        won = m.get("winner") == uid
        draw = m.get("winner") is None
        result = "draw" if draw else ("win" if won else "loss")
        out.append({
            "match_id": m.get("id"),
            "opponent": opponent or "Unknown",
            "result": result,
            "finish_reason": (m.get("finish_reason") or "decision").replace("_", " "),
            "rounds": min(int(m.get("round") or 0), int(m.get("max_rounds") or 12)),
            "date": m.get("finished_at"),
        })
    return {"history": out}


def register(router):
    router.add_api_route("/boxing/profile", get_boxing_profile, methods=["GET"])
    router.add_api_route("/boxing/npcs", npcs_list, methods=["GET"])
    router.add_api_route("/boxing/train", train, methods=["POST"])
    router.add_api_route("/boxing/gym", get_gym, methods=["GET"])
    router.add_api_route("/boxing/gym/upgrade", gym_upgrade, methods=["POST"])
    router.add_api_route("/boxing/gym/move", gym_move, methods=["POST"])
    router.add_api_route("/boxing/coaches", coaches_list, methods=["GET"])
    router.add_api_route("/boxing/coach/hire", coach_hire, methods=["POST"])
    router.add_api_route("/boxing/coach/fire", coach_fire, methods=["POST"])
    router.add_api_route("/boxing/gear", gear_list, methods=["GET"])
    router.add_api_route("/boxing/gear/buy", gear_buy, methods=["POST"])
    router.add_api_route("/boxing/gear/equip", gear_equip, methods=["POST"])
    router.add_api_route("/boxing/matches/create", matches_create, methods=["POST"])
    router.add_api_route("/boxing/matches/join", matches_join, methods=["POST"])
    router.add_api_route("/boxing/matches/ready", matches_ready, methods=["POST"])
    router.add_api_route("/boxing/matches/live", matches_live, methods=["GET"])
    router.add_api_route("/boxing/matches/{match_id}", matches_get, methods=["GET"])
    router.add_api_route("/boxing/matches/{match_id}/watch", matches_watch, methods=["GET"])
    router.add_api_route("/boxing/bets/place", bets_place, methods=["POST"])
    router.add_api_route("/boxing/bets/cancel", bets_cancel, methods=["POST"])
    router.add_api_route("/boxing/bets/my-bets", bets_my, methods=["GET"])
    router.add_api_route("/boxing/league", league, methods=["GET"])
    router.add_api_route("/boxing/history", fight_history, methods=["GET"])

