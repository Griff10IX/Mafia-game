# Missions: 2D map progression, stat-based and character-linked missions (1920s–30s mafia)
from fastapi import Depends, HTTPException, Body
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import (
    db,
    get_current_user,
    get_rank_info,
    maybe_process_rank_up,
    send_notification,
    STATES,
    RANKS,
)

# City order for map progression (same as STATES)
CITY_ORDER = list(STATES) if STATES else ["Chicago", "New York", "Las Vegas", "Atlantic City"]

# Mission definitions: id, city, area, order, type, requirements, title, description, rewards, unlocks_city, character_id
MISSIONS = [
    # Chicago
    {
        "id": "m_chicago_crimes",
        "city": "Chicago",
        "area": "Downtown",
        "order": 1,
        "type": "crime_count",
        "requirements": {"crimes": 5},
        "title": "Prove Your Nerve",
        "description": "Commit 5 crimes. The outfit wants to see you can handle the heat.",
        "reward_money": 500,
        "reward_points": 10,
        "unlocks_city": None,
        "character_id": "char_chicago_fixer",
    },
    {
        "id": "m_chicago_earn",
        "city": "Chicago",
        "area": "Docks",
        "order": 2,
        "type": "crime_profit",
        "requirements": {"crime_profit": 1000},
        "title": "Show Me the Money",
        "description": "Earn $1,000 from crimes. The Bookkeeper wants to see you can make it rain.",
        "reward_money": 300,
        "reward_points": 5,
        "unlocks_city": None,
        "character_id": "char_chicago_bookkeeper",
    },
    {
        "id": "m_chicago_attacks",
        "city": "Chicago",
        "area": "South Side",
        "order": 3,
        "type": "attack_wins",
        "requirements": {"attacks": 2},
        "title": "Collect a Debt",
        "description": "Win 2 attacks. Someone's behind on a debt — remind them.",
        "reward_money": 400,
        "reward_points": 8,
        "unlocks_city": None,
        "character_id": "char_chicago_enforcer",
    },
    {
        "id": "m_chicago_boss",
        "city": "Chicago",
        "area": "Downtown",
        "order": 4,
        "type": "special",
        "requirements": {"complete_missions": ["m_chicago_crimes", "m_chicago_earn", "m_chicago_attacks"]},
        "title": "See the Old Man",
        "description": "You've proven yourself. Report to the Old Man to get your ticket to New York.",
        "reward_money": 1000,
        "reward_points": 20,
        "unlocks_city": "New York",
        "character_id": "char_chicago_boss",
    },
    # New York (placeholder missions — can expand later)
    {
        "id": "m_ny_smuggle",
        "city": "New York",
        "area": "Waterfront",
        "order": 1,
        "type": "booze_sells",
        "requirements": {"booze_sells": 3},
        "title": "Run the Route",
        "description": "Complete 3 booze run deliveries. We need a driver who doesn't ask questions.",
        "reward_money": 600,
        "reward_points": 12,
        "unlocks_city": None,
        "character_id": "char_ny_smuggler",
    },
    {
        "id": "m_ny_busts",
        "city": "New York",
        "area": "Courthouse",
        "order": 2,
        "type": "jail_busts",
        "requirements": {"jail_busts": 2},
        "title": "Spring Him",
        "description": "Bust 2 players or NPCs out of the can. The Mouthpiece needs them on the street.",
        "reward_money": 500,
        "reward_points": 10,
        "unlocks_city": None,
        "character_id": "char_ny_mouthpiece",
    },
    {
        "id": "m_ny_gta",
        "city": "New York",
        "area": "Garage",
        "order": 3,
        "type": "gta_count",
        "requirements": {"gta": 3},
        "title": "Three Cars by Friday",
        "description": "Steal 3 cars. The Mechanic needs wheels.",
        "reward_money": 700,
        "reward_points": 14,
        "unlocks_city": None,
        "character_id": "char_ny_mechanic",
    },
    {
        "id": "m_ny_boss",
        "city": "New York",
        "area": "Downtown",
        "order": 4,
        "type": "special",
        "requirements": {"complete_missions": ["m_ny_smuggle", "m_ny_busts", "m_ny_gta"]},
        "title": "NY Boss",
        "description": "You're ready for Vegas. Report to the NY Boss.",
        "reward_money": 1500,
        "reward_points": 25,
        "unlocks_city": "Las Vegas",
        "character_id": "char_ny_boss",
    },
    # Las Vegas
    {
        "id": "m_vegas_earn",
        "city": "Las Vegas",
        "area": "Desert",
        "order": 1,
        "type": "earn_money",
        "requirements": {"money": 10000},
        "title": "Earn Your Share",
        "description": "Have $10,000 on hand. We're building something big out here.",
        "reward_money": 1000,
        "reward_points": 15,
        "unlocks_city": None,
        "character_id": "char_vegas_builder",
    },
    {
        "id": "m_vegas_crimes",
        "city": "Las Vegas",
        "area": "Card room",
        "order": 2,
        "type": "crime_count",
        "requirements": {"crimes": 15},
        "title": "High Stakes",
        "description": "Commit 15 crimes. The house always wins — unless you're with us.",
        "reward_money": 800,
        "reward_points": 12,
        "unlocks_city": None,
        "character_id": "char_vegas_gambler",
    },
    {
        "id": "m_vegas_boss",
        "city": "Las Vegas",
        "area": "Downtown",
        "order": 3,
        "type": "special",
        "requirements": {"complete_missions": ["m_vegas_earn", "m_vegas_crimes"]},
        "title": "Vegas Boss",
        "description": "Atlantic City's waiting. Report to the Vegas Boss.",
        "reward_money": 2000,
        "reward_points": 30,
        "unlocks_city": "Atlantic City",
        "character_id": "char_vegas_boss",
    },
    # Atlantic City
    {
        "id": "m_ac_rank",
        "city": "Atlantic City",
        "area": "Boardwalk",
        "order": 1,
        "type": "rank",
        "requirements": {"rank_id": 3},
        "title": "Prove You're Made",
        "description": "Reach Hustler rank. Last stop — show the Shore Boss you're made.",
        "reward_money": 1500,
        "reward_points": 20,
        "unlocks_city": None,
        "character_id": "char_ac_shore_boss",
    },
    {
        "id": "m_ac_busts",
        "city": "Atlantic City",
        "area": "Docks",
        "order": 2,
        "type": "jail_busts",
        "requirements": {"jail_busts": 5},
        "title": "Keep the Heat Off",
        "description": "Bust 5 people out of the can. Pay the right people, keep the law off our backs.",
        "reward_money": 1200,
        "reward_points": 18,
        "unlocks_city": None,
        "character_id": "char_ac_cop",
    },
    {
        "id": "m_ac_commission",
        "city": "Atlantic City",
        "area": "—",
        "order": 3,
        "type": "special",
        "requirements": {"complete_missions": ["m_ac_rank", "m_ac_busts"]},
        "title": "The Commission",
        "description": "You're made. Report to the Commission.",
        "reward_money": 3000,
        "reward_points": 50,
        "unlocks_city": None,
        "character_id": "char_ac_commission",
    },
]

# Mission characters (1920s–30s mafia style)
MISSION_CHARACTERS = [
    {"id": "char_chicago_fixer", "name": "The Fixer", "city": "Chicago", "area": "Downtown", "role": "fixer",
     "dialogue_intro": "The outfit's always looking for reliable people. You want in? Show me what you can do.",
     "dialogue_mission_offer": "Commit five jobs. No questions. Come back when it's done.",
     "dialogue_in_progress": "Come back when it's done.",
     "dialogue_complete": "You're good. Go see the Bookkeeper at the docks — he'll have more work."},
    {"id": "char_chicago_bookkeeper", "name": "The Bookkeeper", "city": "Chicago", "area": "Docks", "role": "bookkeeper",
     "dialogue_intro": "I don't care about names. I care about numbers. Show me you can make money.",
     "dialogue_mission_offer": "Earn a grand from the street. Bring the vig. Then we talk.",
     "dialogue_in_progress": "No vig, no talk. Get to work.",
     "dialogue_complete": "You'll do. The Enforcer on the South Side needs someone with nerve. Go."},
    {"id": "char_chicago_enforcer", "name": "The Enforcer", "city": "Chicago", "area": "South Side", "role": "enforcer",
     "dialogue_intro": "Someone's behind on a debt. I need a reminder delivered. You in?",
     "dialogue_mission_offer": "Win two fights. No excuses. Then the Old Man might see you.",
     "dialogue_in_progress": "Two. Not one. Come back when you're done.",
     "dialogue_complete": "You've got a mean streak. The Old Man wants to see you. Downtown."},
    {"id": "char_chicago_boss", "name": "The Old Man", "city": "Chicago", "area": "Downtown", "role": "boss",
     "dialogue_intro": "You've done good work. The big leagues are in New York. Finish what we asked and I'll get you a ticket.",
     "dialogue_mission_offer": "You know what to do. Crimes, cash, and two wins. Report back when it's all done.",
     "dialogue_in_progress": "Not yet. Finish the list.",
     "dialogue_complete": "You're ready. New York's waiting. Don't disappoint me."},
    {"id": "char_ny_smuggler", "name": "The Smuggler", "city": "New York", "area": "Waterfront", "role": "smuggler",
     "dialogue_intro": "We need a driver. Run the route, don't ask questions. You in?",
     "dialogue_mission_offer": "Three deliveries. Booze. Get it done.",
     "dialogue_in_progress": "Run the route. Come back when you're done.",
     "dialogue_complete": "Good. The Mouthpiece might have work for you."},
    {"id": "char_ny_mouthpiece", "name": "The Mouthpiece", "city": "New York", "area": "Courthouse", "role": "mouthpiece",
     "dialogue_intro": "One of ours is in the can. I need him out. You do the heavy lifting.",
     "dialogue_mission_offer": "Bust two out. Jail. You know the drill.",
     "dialogue_in_progress": "Two. Then we talk.",
     "dialogue_complete": "The Mechanic needs wheels. Garage. Go."},
    {"id": "char_ny_mechanic", "name": "The Mechanic", "city": "New York", "area": "Garage", "role": "mechanic",
     "dialogue_intro": "We need three cars by Friday. Clean jobs. You in?",
     "dialogue_mission_offer": "Steal three cars. Bring them in. That's it.",
     "dialogue_in_progress": "Three cars. Friday.",
     "dialogue_complete": "You're solid. The Boss wants to see you. Downtown."},
    {"id": "char_ny_boss", "name": "NY Boss", "city": "New York", "area": "Downtown", "role": "boss",
     "dialogue_intro": "Vegas is next. Prove yourself here first.",
     "dialogue_mission_offer": "Smuggler, Mouthpiece, Mechanic — do their jobs. Then come back.",
     "dialogue_in_progress": "Finish the work.",
     "dialogue_complete": "You're ready for Vegas. Don't look back."},
    {"id": "char_vegas_builder", "name": "The Builder", "city": "Las Vegas", "area": "Desert", "role": "builder",
     "dialogue_intro": "We're putting something big out here. Earn your share.",
     "dialogue_mission_offer": "Have ten grand on hand. Show me you're serious.",
     "dialogue_in_progress": "Ten thousand. Then we talk.",
     "dialogue_complete": "The Gambler has more work. Card room."},
    {"id": "char_vegas_gambler", "name": "The Gambler", "city": "Las Vegas", "area": "Card room", "role": "gambler",
     "dialogue_intro": "The house always wins. Unless you're with us. Prove it.",
     "dialogue_mission_offer": "Fifteen jobs. Crimes. Then the Boss sees you.",
     "dialogue_in_progress": "Fifteen. No less.",
     "dialogue_complete": "You're in. The Boss. Downtown."},
    {"id": "char_vegas_boss", "name": "Vegas Boss", "city": "Las Vegas", "area": "Downtown", "role": "boss",
     "dialogue_intro": "Atlantic City's the last stop. Do the work here first.",
     "dialogue_mission_offer": "Builder and Gambler. Finish their jobs. Then I'll get you to the shore.",
     "dialogue_in_progress": "Not yet.",
     "dialogue_complete": "Atlantic City. The Shore Boss is waiting. Don't disappoint."},
    {"id": "char_ac_shore_boss", "name": "The Shore Boss", "city": "Atlantic City", "area": "Boardwalk", "role": "shore_boss",
     "dialogue_intro": "Last stop. Prove you're made.",
     "dialogue_mission_offer": "Reach Hustler. Then we talk.",
     "dialogue_in_progress": "Hustler. That's the bar.",
     "dialogue_complete": "You're made. The Cop on the docks has one more test. Then the Commission."},
    {"id": "char_ac_cop", "name": "The Corrupt Cop", "city": "Atlantic City", "area": "Docks", "role": "cop",
     "dialogue_intro": "Keep the heat off. Pay the right people. Bust five out of the can.",
     "dialogue_mission_offer": "Bust five. Then the Commission will see you.",
     "dialogue_in_progress": "Five busts. Go.",
     "dialogue_complete": "You're in. The Commission. They're waiting."},
    {"id": "char_ac_commission", "name": "The Commission", "city": "Atlantic City", "area": "—", "role": "boss",
     "dialogue_intro": "You've come a long way. Finish the work on the shore. Then we'll talk.",
     "dialogue_mission_offer": "Shore Boss and the Cop. Do their jobs. Then you're one of us.",
     "dialogue_in_progress": "Not yet. Finish the list.",
     "dialogue_complete": "You're made. Welcome to the Commission."},
]


def _user_unlocked_cities(user: dict) -> List[str]:
    """Return list of cities the user has unlocked (in order). Default: Chicago only."""
    up_to = (user.get("unlocked_maps_up_to") or "").strip() or "Chicago"
    out = []
    for c in CITY_ORDER:
        out.append(c)
        if c == up_to:
            break
    return out


def _user_completed_mission_ids(user: dict) -> set:
    comp = user.get("mission_completions") or []
    return {x.get("mission_id") for x in comp if x.get("mission_id")}


def _get_user_progress_value(user: dict, req_key: str) -> int:
    if req_key == "crimes":
        return int(user.get("total_crimes") or 0)
    if req_key == "crime_profit":
        return int(user.get("crime_profit") or 0)
    if req_key == "attacks":
        return int(user.get("total_kills") or 0)
    if req_key == "money":
        return int(user.get("money") or 0)
    if req_key == "gta":
        return int(user.get("total_gta") or 0)
    if req_key == "jail_busts":
        return int(user.get("jail_busts") or 0)
    if req_key == "rank_id":
        rp = int(user.get("rank_points") or 0)
        mult = float(user.get("prestige_rank_multiplier") or 1.0)
        rid, _ = get_rank_info(rp, mult)
        return rid
    if req_key == "booze_sells":
        return int(user.get("booze_runs_count") or 0)
    return 0


def _check_mission_requirements(user: dict, mission: dict) -> tuple[bool, Dict[str, Any]]:
    """Return (met: bool, progress: dict with current/target/description)."""
    req = mission.get("requirements") or {}
    comp = _user_completed_mission_ids(user)
    progress = {}

    if "complete_missions" in req:
        needed = set(req["complete_missions"])
        done = comp & needed
        met = needed <= done
        progress["current"] = len(done)
        progress["target"] = len(needed)
        progress["description"] = f"Complete {len(needed)} missions ({', '.join(needed)})"
        return met, progress

    for key, target in req.items():
        current = _get_user_progress_value(user, key)
        if key == "rank_id":
            progress["current"] = current
            progress["target"] = target
            rank_name = next((r["name"] for r in RANKS if r["id"] == target), str(target))
            progress["description"] = f"Reach {rank_name}"
        else:
            progress["current"] = current
            progress["target"] = target
            progress["description"] = f"{current}/{target}"
        met = current >= target
        return met, progress
    return False, progress


async def get_missions(current_user: dict = Depends(get_current_user), city: Optional[str] = None):
    """List missions for unlocked cities with completion status and progress."""
    unlocked = _user_unlocked_cities(current_user)
    completed_ids = _user_completed_mission_ids(current_user)
    missions_out = []
    for m in MISSIONS:
        if m["city"] not in unlocked:
            continue
        if city and m["city"] != city:
            continue
        met, progress = _check_mission_requirements(current_user, m)
        missions_out.append({
            "id": m["id"],
            "city": m["city"],
            "area": m["area"],
            "order": m["order"],
            "type": m["type"],
            "title": m["title"],
            "description": m["description"],
            "reward_money": m.get("reward_money", 0),
            "reward_points": m.get("reward_points", 0),
            "unlocks_city": m.get("unlocks_city"),
            "character_id": m.get("character_id"),
            "completed": m["id"] in completed_ids,
            "requirements_met": met,
            "progress": progress,
        })
    missions_out.sort(key=lambda x: (CITY_ORDER.index(x["city"]) if x["city"] in CITY_ORDER else 999, x["order"]))
    return {"missions": missions_out, "unlocked_cities": unlocked}


async def get_missions_map(current_user: dict = Depends(get_current_user)):
    """Map state: current city, unlocked cities, areas and missions per city."""
    unlocked = _user_unlocked_cities(current_user)
    current_city = (current_user.get("current_state") or "").strip() or "Chicago"
    if current_city not in CITY_ORDER:
        current_city = CITY_ORDER[0] if CITY_ORDER else "Chicago"
    completed_ids = _user_completed_mission_ids(current_user)
    by_city = {}
    for m in MISSIONS:
        if m["city"] not in unlocked:
            continue
        if m["city"] not in by_city:
            by_city[m["city"]] = {"areas": {}, "missions": []}
        area = m.get("area") or "—"
        if area not in by_city[m["city"]]["areas"]:
            by_city[m["city"]]["areas"][area] = []
        met, progress = _check_mission_requirements(current_user, m)
        entry = {
            "id": m["id"],
            "area": m["area"],
            "order": m["order"],
            "title": m["title"],
            "description": m["description"],
            "reward_money": m.get("reward_money", 0),
            "reward_points": m.get("reward_points", 0),
            "unlocks_city": m.get("unlocks_city"),
            "character_id": m.get("character_id"),
            "completed": m["id"] in completed_ids,
            "requirements_met": met,
            "progress": progress,
        }
        by_city[m["city"]]["areas"][area].append(entry)
        by_city[m["city"]]["missions"].append(entry)
    for c in by_city:
        for area in by_city[c]["areas"]:
            by_city[c]["areas"][area].sort(key=lambda x: x["order"])
    return {
        "current_city": current_city,
        "unlocked_cities": unlocked,
        "cities": list(unlocked),
        "by_city": by_city,
    }


class CompleteMissionRequest(BaseModel):
    mission_id: str


async def complete_mission(
    request: CompleteMissionRequest = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """Check requirements and, if met, mark mission complete and grant rewards. Unlock next city if applicable."""
    mission_id = (request.mission_id or "").strip()
    if not mission_id:
        raise HTTPException(status_code=400, detail="mission_id required")
    mission = next((m for m in MISSIONS if m["id"] == mission_id), None)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    unlocked = _user_unlocked_cities(current_user)
    if mission["city"] not in unlocked:
        raise HTTPException(status_code=403, detail="City not unlocked")
    completed_ids = _user_completed_mission_ids(current_user)
    if mission_id in completed_ids:
        raise HTTPException(status_code=400, detail="Mission already completed")
    met, _ = _check_mission_requirements(current_user, mission)
    if not met:
        raise HTTPException(status_code=400, detail="Requirements not met")
    user_id = current_user["id"]
    reward_money = int(mission.get("reward_money") or 0)
    reward_points = int(mission.get("reward_points") or 0)
    unlocks_city = mission.get("unlocks_city")
    completion_doc = {"mission_id": mission_id, "completed_at": datetime.now(timezone.utc).isoformat()}
    update = {"$push": {"mission_completions": completion_doc}}
    if reward_money:
        update["$inc"] = update.get("$inc") or {}
        update["$inc"]["money"] = reward_money
    if reward_points:
        update["$inc"] = update.get("$inc") or {}
        update["$inc"]["rank_points"] = reward_points
    if unlocks_city:
        update["$set"] = update.get("$set") or {}
        update["$set"]["unlocked_maps_up_to"] = unlocks_city
    await db.users.update_one({"id": user_id}, update)
    try:
        if reward_points:
            rp_before = int(current_user.get("rank_points") or 0)
            await maybe_process_rank_up(user_id, rp_before, reward_points, current_user.get("username", ""))
    except Exception:
        pass
    if unlocks_city:
        await send_notification(
            user_id,
            "Missions",
            f"You've unlocked {unlocks_city}. The map is yours.",
            "system",
            category="missions",
        )
    return {
        "completed": True,
        "mission_id": mission_id,
        "reward_money": reward_money,
        "reward_points": reward_points,
        "unlocked_city": unlocks_city,
    }


async def get_missions_characters(current_user: dict = Depends(get_current_user), city: Optional[str] = None):
    """Return mission characters for the map (optionally filtered by city)."""
    unlocked = _user_unlocked_cities(current_user)
    out = []
    for c in MISSION_CHARACTERS:
        if c["city"] not in unlocked:
            continue
        if city and c["city"] != city:
            continue
        out.append({
            "id": c["id"],
            "name": c["name"],
            "city": c["city"],
            "area": c["area"],
            "role": c["role"],
            "dialogue_intro": c.get("dialogue_intro"),
            "dialogue_mission_offer": c.get("dialogue_mission_offer"),
            "dialogue_in_progress": c.get("dialogue_in_progress"),
            "dialogue_complete": c.get("dialogue_complete"),
        })
    return {"characters": out}


def register(router):
    router.add_api_route("/missions", get_missions, methods=["GET"])
    router.add_api_route("/missions/map", get_missions_map, methods=["GET"])
    router.add_api_route("/missions/complete", complete_mission, methods=["POST"])
    router.add_api_route("/missions/characters", get_missions_characters, methods=["GET"])
