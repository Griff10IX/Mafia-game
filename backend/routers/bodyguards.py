# Bodyguards: list, armour upgrade, slot buy, hire, invite/accept/decline; admin clear/generate
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import time
import uuid
import random
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    get_effective_event,
    send_notification,
    get_rank_info,
    RANKS,
    get_password_hash,
    DEFAULT_HEALTH,
    DEFAULT_GARAGE_BATCH_LIMIT,
    _is_admin,
    _username_pattern,
)

# Constants (moved from server)
BODYGUARD_SLOT_COSTS = [100, 200, 300, 400]
BODYGUARD_ARMOUR_UPGRADE_COSTS = {0: 50, 1: 100, 2: 200, 3: 400, 4: 800}

# Per-user cache for GET /bodyguards
_bodyguards_cache: dict = {}
_BODYGUARDS_CACHE_TTL_SEC = 10
_BODYGUARDS_CACHE_MAX_ENTRIES = 5000


def _invalidate_bodyguards_cache(user_id: str):
    _bodyguards_cache.pop(user_id, None)


# ----- Models -----
class BodyguardResponse(BaseModel):
    slot_number: int
    is_robot: bool
    bodyguard_username: Optional[str]
    bodyguard_rank_name: Optional[str] = None
    armour_level: int = 0
    hired_at: Optional[str]


class BodyguardInviteRequest(BaseModel):
    target_username: str
    payment_amount: int
    payment_type: str  # points or money
    duration_hours: int


class BodyguardHireRequest(BaseModel):
    slot: int
    is_robot: bool


class AdminBodyguardsGenerateRequest(BaseModel):
    target_username: str
    count: int = 1  # 1..4
    replace_existing: bool = True


# ----- Helpers -----
def _camelize(name: str) -> str:
    parts = []
    for ch in (name or ""):
        if ch.isalnum() or ch == " ":
            parts.append(ch)
    cleaned = "".join(parts)
    tokens = [t for t in cleaned.replace("_", " ").split(" ") if t]
    return "".join(t[:1].upper() + t[1:] for t in tokens)


async def _create_robot_bodyguard_user(owner_user: dict) -> tuple[str, str]:
    """Create a unique robot user record. Returns (user_id, username). 1920s–30s American mafia style."""
    robot_names = [
        "Al Capone", "Lucky Luciano", "Frank Nitti", "Johnny Torrio", "Bugsy Siegel",
        "Meyer Lansky", "Vito Genovese", "Joe Masseria", "Salvatore Maranzano", "Dutch Schultz",
        "Waxey Gordon", "Legs Diamond", "Vincent Coll", "Frank Costello", "Albert Anastasia",
        "Joe Adonis", "Tony Accardo", "Paul Ricca", "Jake Guzik", "Machine Gun Jack",
        "Scarface Al", "Big Jim Colosimo", "Diamond Joe", "Nails Morton", "Bugs Moran",
        "Lefty Louie", "Tony the Rat", "Mad Dog Coll", "Pretty Amberg", "Broadway Charlie",
    ]
    base = _camelize(random.choice(robot_names))
    rank = random.choice(RANKS)
    rank_points = random.randint(int(rank["required_points"]), int(rank["required_points"]) + 500)
    username = None
    for _ in range(80):
        suffix = random.randint(100000, 9999999)
        candidate = f"{base}{suffix}"
        exists = await db.users.find_one({"username": candidate}, {"_id": 0, "id": 1})
        if not exists:
            username = candidate
            break
    if not username:
        raise HTTPException(status_code=500, detail="Failed to generate unique robot name")
    robot_user_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    robot_doc = {
        "id": robot_user_id,
        "email": f"{username.lower()}@robot.mafia",
        "username": username,
        "password_hash": get_password_hash(str(uuid.uuid4())),
        "rank": int(rank["id"]),
        "money": 0.0,
        "points": 0,
        "rank_points": int(rank_points),
        "bodyguard_slots": 0,
        "bullets": 0,
        "avatar_url": None,
        "jail_busts": 0,
        "jail_bust_attempts": 0,
        "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
        "total_crimes": 0,
        "crime_profit": 0,
        "total_gta": 0,
        "total_oc_heists": 0,
        "oc_timer_reduced": False,
        "current_state": owner_user.get("current_state", "Chicago"),
        "total_kills": 0,
        "total_deaths": 0,
        "in_jail": False,
        "jail_until": None,
        "premium_rank_bar": False,
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
        "mission_completions": [],
        "unlocked_maps_up_to": "Chicago",
        "last_seen": now_iso,
        "created_at": now_iso,
        "is_npc": True,
        "is_bodyguard": True,
        "bodyguard_owner_id": owner_user["id"],
    }
    await db.users.insert_one(robot_doc)
    return robot_user_id, username


# ----- Routes -----
async def get_bodyguards(current_user: dict = Depends(get_current_user)):
    global _bodyguards_cache
    uid = current_user["id"]
    now = time.monotonic()
    if uid in _bodyguards_cache:
        payload, expires = _bodyguards_cache[uid]
        if now <= expires:
            return payload
    bodyguards = await db.bodyguards.find({"user_id": uid}, {"_id": 0}).to_list(10)
    result = []
    for i in range(4):
        bg = next((b for b in bodyguards if b["slot_number"] == i + 1), None)
        if bg:
            username = None
            rank_name = None
            if not bg["is_robot"] and bg.get("bodyguard_user_id"):
                bg_user = await db.users.find_one(
                    {"id": bg["bodyguard_user_id"]},
                    {"_id": 0, "username": 1, "rank_points": 1}
                )
                username = bg_user["username"] if bg_user else "Unknown"
                if bg_user:
                    _, rank_name = get_rank_info(int(bg_user.get("rank_points", 0) or 0))
            elif bg["is_robot"]:
                if bg.get("bodyguard_user_id"):
                    bg_user = await db.users.find_one(
                        {"id": bg["bodyguard_user_id"]},
                        {"_id": 0, "username": 1, "rank_points": 1}
                    )
                    username = bg_user["username"] if bg_user else None
                    if bg_user:
                        _, rank_name = get_rank_info(int(bg_user.get("rank_points", 0) or 0))
                username = username or bg.get("robot_name") or f"Robot Guard #{i + 1}"
            result.append(BodyguardResponse(
                slot_number=i + 1,
                is_robot=bg["is_robot"],
                bodyguard_username=username,
                bodyguard_rank_name=rank_name,
                armour_level=int(bg.get("armour_level", 0) or 0),
                hired_at=bg["hired_at"]
            ))
        else:
            result.append(BodyguardResponse(
                slot_number=i + 1,
                is_robot=False,
                bodyguard_username=None,
                bodyguard_rank_name=None,
                armour_level=0,
                hired_at=None
            ))
    if len(_bodyguards_cache) >= _BODYGUARDS_CACHE_MAX_ENTRIES:
        oldest = next(iter(_bodyguards_cache))
        _bodyguards_cache.pop(oldest, None)
    _bodyguards_cache[uid] = (result, now + _BODYGUARDS_CACHE_TTL_SEC)
    return result


async def upgrade_bodyguard_armour(slot: int, current_user: dict = Depends(get_current_user)):
    if slot < 1 or slot > 4:
        raise HTTPException(status_code=400, detail="Invalid slot")
    bg = await db.bodyguards.find_one({"user_id": current_user["id"], "slot_number": slot}, {"_id": 0})
    if not bg or not bg.get("bodyguard_user_id"):
        raise HTTPException(status_code=404, detail="No bodyguard in that slot")
    cur_level = int(bg.get("armour_level", 0) or 0)
    if cur_level >= 5:
        raise HTTPException(status_code=400, detail="Bodyguard armour is already maxed")
    ev = await get_effective_event()
    cost = int(BODYGUARD_ARMOUR_UPGRADE_COSTS.get(cur_level, 0) * ev.get("bodyguard_cost", 1.0))
    if cost <= 0:
        raise HTTPException(status_code=400, detail="Invalid armour upgrade cost")
    if int(current_user.get("points", 0) or 0) < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    new_level = cur_level + 1
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -cost}})
    await db.bodyguards.update_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {"$set": {"armour_level": new_level}}
    )
    await db.users.update_one({"id": bg["bodyguard_user_id"]}, {"$set": {"armour_level": new_level}})
    _invalidate_bodyguards_cache(current_user["id"])
    return {"message": f"Upgraded bodyguard armour to level {new_level} for {cost} points", "armour_level": new_level, "cost": cost}


async def buy_bodyguard_slot(current_user: dict = Depends(get_current_user)):
    if current_user["bodyguard_slots"] >= 4:
        raise HTTPException(status_code=400, detail="All bodyguard slots already purchased")
    ev = await get_effective_event()
    cost = int(BODYGUARD_SLOT_COSTS[current_user["bodyguard_slots"]] * ev.get("bodyguard_cost", 1.0))
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -cost, "bodyguard_slots": 1}}
    )
    _invalidate_bodyguards_cache(current_user["id"])
    return {"message": f"Bodyguard slot purchased for {cost} points"}


async def hire_bodyguard(request: BodyguardHireRequest, current_user: dict = Depends(get_current_user)):
    slot = request.slot
    is_robot = request.is_robot
    if not is_robot:
        raise HTTPException(status_code=400, detail="Human bodyguards are temporarily disabled. Use robot bodyguards.")
    if slot < 1 or slot > 4:
        raise HTTPException(status_code=400, detail="Invalid bodyguard slot")
    existing = await db.bodyguards.find_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {"_id": 0}
    )
    if existing:
        raise HTTPException(status_code=400, detail="Slot already occupied")
    ev = await get_effective_event()
    base_cost = BODYGUARD_SLOT_COSTS[slot - 1]
    cost = int(base_cost * 1.5) if is_robot else base_cost
    cost = int(cost * ev.get("bodyguard_cost", 1.0))
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -cost}})
    robot_name = None
    robot_user_id = None
    if is_robot:
        robot_user_id, robot_name = await _create_robot_bodyguard_user(current_user)
    bodyguard_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "owner_username": current_user.get("username"),
        "slot_number": slot,
        "is_robot": is_robot,
        "robot_name": robot_name,
        "bodyguard_user_id": robot_user_id if is_robot else None,
        "health": 100,
        "armour_level": 0,
        "hired_at": datetime.now(timezone.utc).isoformat(),
        "hire_cost": cost,
    }
    await db.bodyguards.insert_one(bodyguard_doc)
    await send_notification(
        current_user["id"],
        "🛡️ Bodyguard Hired",
        f"You've hired {robot_name if is_robot else 'a human bodyguard slot'} for {cost} points.",
        "bodyguard"
    )
    _invalidate_bodyguards_cache(current_user["id"])
    return {"message": f"{'Robot bodyguard ' + robot_name if is_robot else 'Human bodyguard slot'} hired for {cost} points", "bodyguard_name": robot_name}


async def invite_bodyguard(request: BodyguardInviteRequest, current_user: dict = Depends(get_current_user)):
    username_pattern = _username_pattern((request.target_username or "").strip())
    if not username_pattern:
        raise HTTPException(status_code=400, detail="Target username required")
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot invite yourself")
    bodyguards = await db.bodyguards.find({"user_id": current_user["id"]}).to_list(10)
    filled_slots = len([b for b in bodyguards if b.get("bodyguard_user_id") or b.get("is_robot")])
    if filled_slots >= 4:
        raise HTTPException(status_code=400, detail="No available bodyguard slots")
    existing = await db.bodyguard_invites.find_one({
        "inviter_id": current_user["id"],
        "invitee_id": target["id"],
        "status": "pending"
    })
    if existing:
        raise HTTPException(status_code=400, detail="Already have pending invite to this user")
    invite_id = str(uuid.uuid4())
    await db.bodyguard_invites.insert_one({
        "id": invite_id,
        "inviter_id": current_user["id"],
        "inviter_username": current_user["username"],
        "invitee_id": target["id"],
        "invitee_username": target["username"],
        "payment_amount": request.payment_amount,
        "payment_type": request.payment_type,
        "duration_hours": request.duration_hours,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    await send_notification(
        target["id"],
        "🛡️ Bodyguard Offer",
        f"{current_user['username']} wants to hire you as a bodyguard for {request.payment_amount} {request.payment_type}/hour for {request.duration_hours} hours.",
        "bodyguard"
    )
    return {"message": f"Bodyguard invite sent to {target['username']}"}


async def get_bodyguard_invites(current_user: dict = Depends(get_current_user)):
    sent = await db.bodyguard_invites.find(
        {"inviter_id": current_user["id"], "status": "pending"},
        {"_id": 0}
    ).to_list(20)
    received = await db.bodyguard_invites.find(
        {"invitee_id": current_user["id"], "status": "pending"},
        {"_id": 0}
    ).to_list(20)
    return {"sent": sent, "received": received}


async def accept_bodyguard_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    invite = await db.bodyguard_invites.find_one({"id": invite_id, "invitee_id": current_user["id"], "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    inviter = await db.users.find_one({"id": invite["inviter_id"]}, {"_id": 0})
    if not inviter:
        raise HTTPException(status_code=400, detail="Inviter no longer exists")
    bodyguards = await db.bodyguards.find({"user_id": inviter["id"]}).to_list(10)
    empty_slot = None
    for i in range(1, 5):
        slot_bg = next((b for b in bodyguards if b["slot_number"] == i), None)
        if not slot_bg or (not slot_bg.get("bodyguard_user_id") and not slot_bg.get("is_robot")):
            empty_slot = i
            break
    if not empty_slot:
        raise HTTPException(status_code=400, detail="Inviter has no available slots")
    end_time = datetime.now(timezone.utc) + timedelta(hours=invite["duration_hours"])
    await db.bodyguards.update_one(
        {"user_id": inviter["id"], "slot_number": empty_slot},
        {"$set": {
            "bodyguard_user_id": current_user["id"],
            "is_robot": False,
            "payment_amount": invite["payment_amount"],
            "payment_type": invite["payment_type"],
            "payment_due": datetime.now(timezone.utc).isoformat(),
            "contract_end": end_time.isoformat(),
            "hired_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    await db.bodyguard_invites.update_one(
        {"id": invite_id},
        {"$set": {"status": "accepted"}}
    )
    await send_notification(
        inviter["id"],
        "🛡️ Bodyguard Accepted",
        f"{current_user['username']} has accepted your bodyguard offer!",
        "bodyguard"
    )
    _invalidate_bodyguards_cache(current_user["id"])
    _invalidate_bodyguards_cache(inviter["id"])
    return {"message": f"You are now {inviter['username']}'s bodyguard"}


async def decline_bodyguard_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.bodyguard_invites.update_one(
        {"id": invite_id, "invitee_id": current_user["id"], "status": "pending"},
        {"$set": {"status": "declined"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"message": "Invite declined"}


# ----- Admin -----
async def admin_clear_bodyguards(target_username: str, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    username_pattern = _username_pattern(target_username)
    if not username_pattern:
        raise HTTPException(status_code=404, detail="User not found")
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    res_bg = await db.bodyguards.delete_many({"user_id": target["id"]})
    res_robots = await db.users.delete_many({"is_bodyguard": True, "bodyguard_owner_id": target["id"]})
    _invalidate_bodyguards_cache(target["id"])
    return {
        "message": f"Cleared bodyguards for {target_username} (removed {res_bg.deleted_count} bodyguard record(s), {res_robots.deleted_count} robot user(s))",
        "deleted_bodyguards": res_bg.deleted_count,
        "deleted_robot_users": res_robots.deleted_count,
    }


async def admin_drop_all_human_bodyguards(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    res = await db.bodyguards.delete_many({"is_robot": {"$ne": True}})
    return {"message": f"Dropped all human bodyguards ({res.deleted_count} slot(s) cleared)", "deleted_count": res.deleted_count}


async def admin_drop_all_bodyguards(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    res = await db.bodyguards.delete_many({})
    res_robots = await db.users.delete_many({"is_bodyguard": True})
    _bodyguards_cache.clear()
    return {
        "message": f"Dropped ALL bodyguards ({res.deleted_count} slot(s) cleared, {res_robots.deleted_count} robot user(s) deleted)",
        "deleted_bodyguards": res.deleted_count,
        "deleted_robot_users": res_robots.deleted_count
    }


async def admin_generate_bodyguards(request: AdminBodyguardsGenerateRequest, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    target_username = (request.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Target username required")
    count = int(request.count or 1)
    if count < 1 or count > 4:
        raise HTTPException(status_code=400, detail="Count must be between 1 and 4")
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if request.replace_existing:
        await db.bodyguards.delete_many({"user_id": target["id"]})
        await db.users.delete_many({"is_bodyguard": True, "bodyguard_owner_id": target["id"]})
    desired_slots = max(int(target.get("bodyguard_slots", 0) or 0), count)
    desired_slots = min(4, desired_slots)
    if desired_slots != (int(target.get("bodyguard_slots", 0) or 0)):
        await db.users.update_one({"id": target["id"]}, {"$set": {"bodyguard_slots": desired_slots}})
    created = 0
    for slot in range(1, count + 1):
        exists = await db.bodyguards.find_one({"user_id": target["id"], "slot_number": slot}, {"_id": 0, "id": 1})
        if exists:
            continue
        robot_user_id, robot_username = await _create_robot_bodyguard_user(target)
        await db.bodyguards.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": target["id"],
            "owner_username": target.get("username"),
            "slot_number": slot,
            "is_robot": True,
            "robot_name": robot_username,
            "bodyguard_user_id": robot_user_id,
            "health": 100,
            "armour_level": 0,
            "hired_at": datetime.now(timezone.utc).isoformat()
        })
        created += 1
    _invalidate_bodyguards_cache(target["id"])
    return {"message": f"Generated {created} robot bodyguard(s) for {target_username}", "created": created, "count_requested": count}


def register(router):
    router.add_api_route("/bodyguards", get_bodyguards, methods=["GET"], response_model=List[BodyguardResponse])
    router.add_api_route("/bodyguards/armour/upgrade", upgrade_bodyguard_armour, methods=["POST"])
    router.add_api_route("/bodyguards/slot/buy", buy_bodyguard_slot, methods=["POST"])
    router.add_api_route("/bodyguards/hire", hire_bodyguard, methods=["POST"])
    router.add_api_route("/bodyguards/invite", invite_bodyguard, methods=["POST"])
    router.add_api_route("/bodyguards/invites", get_bodyguard_invites, methods=["GET"])
    router.add_api_route("/bodyguards/invites/{invite_id}/accept", accept_bodyguard_invite, methods=["POST"])
    router.add_api_route("/bodyguards/invites/{invite_id}/decline", decline_bodyguard_invite, methods=["POST"])
    router.add_api_route("/admin/bodyguards/clear", admin_clear_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/drop-all-human", admin_drop_all_human_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/drop-all", admin_drop_all_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/generate", admin_generate_bodyguards, methods=["POST"])
