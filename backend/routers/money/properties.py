# Properties endpoints: list, buy, collect income
# Progression: buy in order; first property pays least, last pays most. Must max previous to unlock next.
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from pydantic import BaseModel
import secrets
_rng = secrets.SystemRandom()

from fastapi import Depends, HTTPException

from server import db, get_current_user


def _parse_iso_datetime(s):
    """Parse ISO datetime string safely; return timezone-aware datetime or None."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


class PropertiesListResponse(BaseModel):
    properties: List["PropertyResponse"]
    property_income_perk_until: Optional[str] = None  # When 10% property income loot perk expires (ISO)


class PropertyResponse(BaseModel):
    id: str
    name: str
    property_type: str
    price: int
    income_per_hour: int
    max_level: int
    owned: bool
    level: int
    available_income: float
    locked: bool = False
    required_property_name: Optional[str] = None
    # Optional extras for UI
    collection_streak_days: int = 0
    streak_bonus_mult: float = 1.0
    hours_since_collect: float = 0.0
    risk_flag: Optional[str] = None
    buff_label: Optional[str] = None
    # Stacking: how many of this property type user owns
    owned_count: int = 1
    stack_bonus_pct: int = 0  # e.g., 50 = +50% bonus from stacking


# Stacking bonus: +25% per additional property of same type (after first)
STACK_BONUS_PER_EXTRA = 0.25
# Max properties of same type that can stack (extras are auto-sold)
MAX_STACK_COUNT = 3  # Max +50% bonus


def calculate_property_value(prop: dict, level: int) -> int:
    """Calculate total value of a property (base price + all upgrade costs).
    Upgrades cost: price * level_number for each level.
    Total = price * (1 + 2 + 3 + ... + level) = price * level * (level + 1) / 2
    """
    base_price = prop.get("price", 0)
    if level <= 1:
        return base_price
    # Sum of 1 + 2 + 3 + ... + level = level * (level + 1) / 2
    return int(base_price * level * (level + 1) / 2)


# Streak: +1% income per day collected, up to 7% bonus
MAX_STREAK_DAYS = 7
STREAK_BONUS_PER_DAY = 0.01

# Risk events when income sits at cap for a long time
RISK_HOURS_THRESHOLD = 24.0
RISK_EVENT_CHANCE = 0.20  # 20% when at cap
RISK_LOSS_MIN = 0.10      # 10% loss
RISK_LOSS_MAX = 0.25      # 25% loss

# Reinvest/buff: +10% income for 24h in exchange for points
BUFF_INCOME_MULT = 0.10
BUFF_DURATION_HOURS = 24
BUFF_COST_POINTS = 100


def _property_order(properties: list) -> list:
    """Return properties in progression order (first = worst pay, last = best)."""
    # Filter out any properties missing required "id" field
    properties = [p for p in properties if p.get("id")]
    by_id = {p["id"]: p for p in properties}
    ordered = []
    next_id = None
    for _ in range(len(properties) + 1):
        if next_id is None:
            for p in properties:
                if p.get("required_property_id") is None:
                    ordered.append(p)
                    next_id = p.get("id")
                    break
        else:
            for p in properties:
                if p.get("required_property_id") == next_id:
                    ordered.append(p)
                    next_id = p.get("id")
                    break
            else:
                break
    # Append any not in chain (e.g. legacy props)
    for p in properties:
        if p not in ordered:
            ordered.append(p)
    return ordered


async def get_properties(current_user: dict = Depends(get_current_user)):
    properties = await db.properties.find({}, {"_id": 0}).to_list(100)
    properties = _property_order(properties)
    user_properties = await db.user_properties.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    # Group user properties by property_id to count duplicates (from kills)
    properties_by_id = {}
    for up in user_properties:
        pid = up["property_id"]
        if pid not in properties_by_id:
            properties_by_id[pid] = []
        properties_by_id[pid].append(up)
    result = []
    for prop in properties:
        user_props_list = properties_by_id.get(prop["id"], [])
        owned_count = len(user_props_list)
        owned = owned_count > 0
        # Use the first (or best) property for display; sum income from all
        user_prop = user_props_list[0] if owned else None
        # Calculate total level and available income across all owned copies
        total_level = sum(max(0, int(up.get("level") or 0)) for up in user_props_list) if owned else 0
        level = user_prop["level"] if owned else 0  # Display level of first one
        available_income = 0.0
        hours_since_collect = 0.0
        streak_days = int(user_prop.get("collection_streak_days") or 0) if owned else 0
        buff_label = None
        # Stack bonus: +25% per extra property beyond the first
        stack_bonus_pct = int((owned_count - 1) * STACK_BONUS_PER_EXTRA * 100) if owned_count > 1 else 0
        stack_mult = 1.0 + (owned_count - 1) * STACK_BONUS_PER_EXTRA if owned_count > 1 else 1.0
        # Calculate available income from ALL owned copies of this property
        for up in user_props_list:
            up_level = max(0, int(up.get("level") or 0))
            last_collected = _parse_iso_datetime(up.get("last_collected"))
            if not last_collected:
                last_collected = datetime.now(timezone.utc)
            up_hours = max(0.0, (datetime.now(timezone.utc) - last_collected).total_seconds() / 3600)
            up_income = min(
                up_hours * prop["income_per_hour"] * up_level,
                prop["income_per_hour"] * up_level * 24,
            )
            available_income += up_income
            if up == user_prop:
                hours_since_collect = up_hours
        # Apply stack bonus to available income
        available_income *= stack_mult
        # Buff metadata (per-property income buff) - check first property
        income_buff_until = None
        if owned:
            income_buff_until = _parse_iso_datetime(user_prop.get("income_buff_until"))
        if income_buff_until and income_buff_until > datetime.now(timezone.utc):
            buff_label = "+10% reinvest bonus"
        if stack_bonus_pct > 0:
            buff_label = (buff_label + f" +{stack_bonus_pct}% stack" if buff_label else f"+{stack_bonus_pct}% stack bonus")
        required_property_id = prop.get("required_property_id")
        required_property_name = None
        locked = False
        if required_property_id:
            req_prop = next((p for p in properties if p["id"] == required_property_id), None)
            required_property_name = req_prop["name"] if req_prop else required_property_id
            req_user_list = properties_by_id.get(required_property_id, [])
            req_max_level = sum(max(0, int(up.get("level") or 0)) for up in req_user_list)
            if not req_user_list or req_max_level < (req_prop["max_level"] if req_prop else 0):
                locked = True
        # Effective income/hr = base * total_level * stack_mult (so stacking shows increased rate)
        effective_income_per_hour = int(prop["income_per_hour"] * total_level * stack_mult) if owned and total_level >= 1 else prop["income_per_hour"]
        streak_bonus_mult = 1.0 + min(MAX_STREAK_DAYS, max(0, streak_days)) * STREAK_BONUS_PER_DAY if owned else 1.0
        result.append(PropertyResponse(
            id=prop["id"],
            name=prop["name"],
            property_type=prop["property_type"],
            price=prop["price"],
            income_per_hour=effective_income_per_hour,
            max_level=prop["max_level"],
            owned=owned,
            level=total_level,  # Show total level across all copies
            available_income=available_income,
            locked=locked,
            required_property_name=required_property_name,
            collection_streak_days=streak_days,
            streak_bonus_mult=streak_bonus_mult,
            hours_since_collect=hours_since_collect,
            buff_label=buff_label,
            owned_count=owned_count,
            stack_bonus_pct=stack_bonus_pct,
        ))
    return PropertiesListResponse(
        properties=result,
        property_income_perk_until=current_user.get("property_income_perk_until"),
    )


async def buy_property(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    user_prop = await db.user_properties.find_one(
        {"user_id": current_user["id"], "property_id": property_id},
        {"_id": 0}
    )
    if user_prop:
        if user_prop["level"] >= prop["max_level"]:
            raise HTTPException(status_code=400, detail="Property already at max level")
        cost = prop["price"] * (user_prop["level"] + 1)
    else:
        # First-time buy: must have previous property at max level
        required_property_id = prop.get("required_property_id")
        if required_property_id:
            req_prop = await db.properties.find_one({"id": required_property_id}, {"_id": 0, "name": 1, "max_level": 1})
            req_user = await db.user_properties.find_one(
                {"user_id": current_user["id"], "property_id": required_property_id},
                {"_id": 0, "level": 1}
            )
            if not req_user or req_user["level"] < (req_prop["max_level"] if req_prop else 0):
                name = req_prop["name"] if req_prop else required_property_id
                raise HTTPException(
                    status_code=403,
                    detail=f"Max out {name} (reach max level) to unlock this property.",
                )
        cost = prop["price"]
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": cost}},
        {"$inc": {"money": -cost}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient money")
    if user_prop:
        await db.user_properties.update_one(
            {"user_id": current_user["id"], "property_id": property_id},
            {"$inc": {"level": 1}}
        )
    else:
        await db.user_properties.insert_one({
            "user_id": current_user["id"],
            "property_id": property_id,
            "level": 1,
            "last_collected": datetime.now(timezone.utc).isoformat()
        })
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.economy_events.insert_one({
        "at": now_iso,
        "type": "property_buy",
        "user_id": current_user["id"],
        "username": current_user.get("username") or "",
        "property_id": property_id,
        "property_name": (prop or {}).get("name") or property_id,
        "cost": cost,
        "level": 1 if not user_prop else (user_prop.get("level") or 0) + 1,
    })
    return {"message": f"Successfully purchased/upgraded {prop['name']}"}


async def collect_property_income(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    # Find ALL copies of this property type owned by user (from kills)
    user_props_list = await db.user_properties.find(
        {"user_id": current_user["id"], "property_id": property_id},
    ).to_list(100)
    if not user_props_list:
        raise HTTPException(status_code=404, detail="You don't own this property")
    owned_count = len(user_props_list)
    now_utc = datetime.now(timezone.utc)
    # Calculate stack bonus: +25% per extra property
    stack_mult = 1.0 + (owned_count - 1) * STACK_BONUS_PER_EXTRA if owned_count > 1 else 1.0
    # Calculate total income from ALL copies
    total_income = 0.0
    total_base_cap = 0.0
    max_hours_passed = 0.0
    now_iso = now_utc.isoformat()
    first_user_prop = None
    for ref in user_props_list:
        # Atomically swap last_collected to claim this property's income window;
        # returns the pre-update document so a concurrent request sees ~0 hours.
        user_prop = await db.user_properties.find_one_and_update(
            {"_id": ref["_id"], "user_id": current_user["id"]},
            {"$set": {"last_collected": now_iso}},
        )
        if not user_prop:
            continue
        if first_user_prop is None:
            first_user_prop = user_prop
        last_collected = _parse_iso_datetime(user_prop.get("last_collected"))
        if not last_collected:
            last_collected = now_utc
        hours_passed = (now_utc - last_collected).total_seconds() / 3600
        max_hours_passed = max(max_hours_passed, hours_passed)
        level = max(0, int(user_prop.get("level") or 0))
        base_income_cap = prop["income_per_hour"] * level * 24
        total_base_cap += base_income_cap
        up_income = min(hours_passed * prop["income_per_hour"] * level, base_income_cap)
        total_income += up_income
    if not first_user_prop:
        raise HTTPException(status_code=404, detail="You don't own this property")
    if total_income < 1:
        raise HTTPException(status_code=400, detail="No income to collect yet")
    # Apply stack bonus
    income = total_income * stack_mult
    perk_until = _parse_iso_datetime(current_user.get("property_income_perk_until"))
    if perk_until and now_utc < perk_until:
        income = income * 1.1
    properties_until = _parse_iso_datetime(current_user.get("properties_until"))
    if properties_until and now_utc < properties_until:
        income = income * 3
    # Streak bonus: +1% income per consecutive day (up to MAX_STREAK_DAYS) - use first property's streak
    streak_days = int(first_user_prop.get("collection_streak_days") or 0)
    hours_passed = max_hours_passed  # Use max hours for streak calculation
    # First ever collection: start streak at 1
    if streak_days <= 0:
        streak_days = 1
    else:
        # Use hours to avoid abusing tiny frequent collects:
        # - If between 24–48h since last collect: streak can increase
        # - If >48h: streak resets to 1
        # - If <24h: streak is maintained but does not increase
        if hours_passed >= 24.0 and hours_passed <= 48.0:
            streak_days = min(MAX_STREAK_DAYS, streak_days + 1)
        elif hours_passed > 48.0:
            streak_days = 1
    if streak_days > 0:
        income *= 1.0 + streak_days * STREAK_BONUS_PER_DAY
    # Per-property reinvest buff (check first property)
    buff_until_dt = _parse_iso_datetime(first_user_prop.get("income_buff_until"))
    buff_active = False
    if buff_until_dt and now_utc < buff_until_dt:
        income *= 1.0 + BUFF_INCOME_MULT
        buff_active = True
    # Risk event: if money has been capped for a while, chance to lose a slice
    risk_event = None
    if hours_passed >= RISK_HOURS_THRESHOLD and total_income >= total_base_cap * 0.99:
        if _rng.random() < RISK_EVENT_CHANCE:
            loss_pct = _rng.uniform(RISK_LOSS_MIN, RISK_LOSS_MAX)
            loss_amount = income * loss_pct
            income -= loss_amount
            risk_event = {
                "loss_pct": round(loss_pct * 100, 1),
                "loss_amount": round(loss_amount, 2),
                "message": f"A raid hit {prop['name']}. You lost ${loss_amount:,.0f} ({loss_pct*100:.1f}% of stored income).",
            }
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": income}}
    )
    await db.user_properties.update_many(
        {"user_id": current_user["id"], "property_id": property_id},
        {"$set": {"collection_streak_days": streak_days}}
    )
    message = f"Collected ${income:,.2f}"
    if owned_count > 1:
        message += f" from {owned_count}x {prop['name']} (+{int((owned_count - 1) * STACK_BONUS_PER_EXTRA * 100)}% stack bonus)"
    if streak_days > 1:
        message += f" (streak {streak_days} days)"
    if buff_active:
        message += " with reinvest bonus."
    if risk_event and risk_event.get("message"):
        message += f" {risk_event['message']}"
    return {
        "message": message,
        "streak_days": streak_days,
        "risk_event": risk_event,
        "buff_active": buff_active,
        "owned_count": owned_count,
        "stack_bonus_pct": int((owned_count - 1) * STACK_BONUS_PER_EXTRA * 100) if owned_count > 1 else 0,
    }


def register(router):
    import server as srv
    get_current_user = srv.get_current_user
    _user_owns_any_casino = srv._user_owns_any_casino
    _user_owns_any_property = srv._user_owns_any_property

    async def get_my_properties(current_user: dict = Depends(get_current_user)):
        """Return current user's one casino (if any) and one property (if any). Rule: max 1 casino, max 1 property."""
        user_id = current_user["id"]
        casino = await _user_owns_any_casino(user_id)
        property_ = await _user_owns_any_property(user_id)
        return {"casino": casino, "property": property_}

    async def reinvest_property(property_id: str, current_user: dict = Depends(get_current_user)):
        """Spend points to boost a property's income for 24 hours."""
        prop = await db.properties.find_one({"id": property_id}, {"_id": 0})
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")
        user_prop = await db.user_properties.find_one(
            {"user_id": current_user["id"], "property_id": property_id},
            {"_id": 0},
        )
        if not user_prop:
            raise HTTPException(status_code=404, detail="You don't own this property")
        points = int(current_user.get("points") or 0)
        if points < BUFF_COST_POINTS:
            raise HTTPException(
                status_code=400,
                detail=f"You need {BUFF_COST_POINTS:,} points to reinvest in this business.",
            )
        now_utc = datetime.now(timezone.utc)
        buff_until = now_utc + timedelta(hours=BUFF_DURATION_HOURS)
        result = await db.users.update_one(
            {"id": current_user["id"], "points": {"$gte": BUFF_COST_POINTS}},
            {"$inc": {"points": -BUFF_COST_POINTS}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail="Insufficient points")
        await db.user_properties.update_one(
            {"user_id": current_user["id"], "property_id": property_id},
            {"$set": {"income_buff_until": buff_until.isoformat()}},
        )
        return {
            "message": f"Reinvested {BUFF_COST_POINTS:,} points into {prop['name']} — income +10% for 24 hours.",
            "buff_until": buff_until.isoformat(),
        }

    router.add_api_route("/properties", get_properties, methods=["GET"], response_model=PropertiesListResponse)
    router.add_api_route("/properties/{property_id}/buy", buy_property, methods=["POST"])
    router.add_api_route("/properties/{property_id}/collect", collect_property_income, methods=["POST"])
    router.add_api_route("/properties/{property_id}/reinvest", reinvest_property, methods=["POST"])
    router.add_api_route("/my-properties", get_my_properties, methods=["GET"])
