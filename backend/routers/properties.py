# Properties endpoints: list, buy, collect income
# Progression: buy in order; first property pays least, last pays most. Must max previous to unlock next.
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from pydantic import BaseModel
import random

from fastapi import Depends, HTTPException

from server import db, get_current_user


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
    by_id = {p["id"]: p for p in properties}
    ordered = []
    next_id = None
    for _ in range(len(properties) + 1):
        if next_id is None:
            for p in properties:
                if p.get("required_property_id") is None:
                    ordered.append(p)
                    next_id = p["id"]
                    break
        else:
            for p in properties:
                if p.get("required_property_id") == next_id:
                    ordered.append(p)
                    next_id = p["id"]
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
    properties_map = {up["property_id"]: up for up in user_properties}
    result = []
    for prop in properties:
        user_prop = properties_map.get(prop["id"])
        owned = user_prop is not None
        level = user_prop["level"] if owned else 0
        available_income = 0.0
        hours_since_collect = 0.0
        streak_days = int(user_prop.get("collection_streak_days") or 0) if owned else 0
        buff_label = None
        if owned and "last_collected" in user_prop:
            last_collected_raw = user_prop["last_collected"]
            try:
                last_collected = datetime.fromisoformat(last_collected_raw)
            except Exception:
                last_collected = datetime.now(timezone.utc)
            hours_since_collect = max(
                0.0, (datetime.now(timezone.utc) - last_collected).total_seconds() / 3600
            )
            available_income = min(
                hours_since_collect * prop["income_per_hour"] * max(level, 0),
                prop["income_per_hour"] * max(level, 0) * 24,
            )
        # Buff metadata (per-property income buff)
        income_buff_until = None
        if owned:
            raw_until = user_prop.get("income_buff_until")
            if raw_until:
                try:
                    income_buff_until = datetime.fromisoformat(raw_until.replace("Z", "+00:00"))
                except Exception:
                    income_buff_until = None
        if income_buff_until and income_buff_until > datetime.now(timezone.utc):
            buff_label = "+10% reinvest bonus"
        required_property_id = prop.get("required_property_id")
        required_property_name = None
        locked = False
        if required_property_id:
            req_prop = next((p for p in properties if p["id"] == required_property_id), None)
            required_property_name = req_prop["name"] if req_prop else required_property_id
            req_user = properties_map.get(required_property_id)
            if not req_user or req_user["level"] < (req_prop["max_level"] if req_prop else 0):
                locked = True
        # Effective income/hr = base * level (so upgrades show increased rate)
        effective_income_per_hour = prop["income_per_hour"] * level if owned and level >= 1 else prop["income_per_hour"]
        streak_bonus_mult = 1.0 + min(MAX_STREAK_DAYS, max(0, streak_days)) * STREAK_BONUS_PER_DAY if owned else 1.0
        result.append(PropertyResponse(
            id=prop["id"],
            name=prop["name"],
            property_type=prop["property_type"],
            price=prop["price"],
            income_per_hour=effective_income_per_hour,
            max_level=prop["max_level"],
            owned=owned,
            level=level,
            available_income=available_income,
            locked=locked,
            required_property_name=required_property_name,
            collection_streak_days=streak_days,
            streak_bonus_mult=streak_bonus_mult,
            hours_since_collect=hours_since_collect,
            buff_label=buff_label,
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
    if current_user["money"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient money")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -cost}}
    )
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
    return {"message": f"Successfully purchased/upgraded {prop['name']}"}


async def collect_property_income(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    user_prop = await db.user_properties.find_one(
        {"user_id": current_user["id"], "property_id": property_id},
        {"_id": 0}
    )
    if not user_prop:
        raise HTTPException(status_code=404, detail="You don't own this property")
    last_collected_raw = user_prop["last_collected"]
    try:
        last_collected = datetime.fromisoformat(last_collected_raw)
    except Exception:
        last_collected = datetime.now(timezone.utc)
    now_utc = datetime.now(timezone.utc)
    hours_passed = (now_utc - last_collected).total_seconds() / 3600
    level = max(0, int(user_prop.get("level") or 0))
    base_income_cap = prop["income_per_hour"] * level * 24
    income = min(hours_passed * prop["income_per_hour"] * level, base_income_cap)
    if income < 1:
        raise HTTPException(status_code=400, detail="No income to collect yet")
    perk_until = current_user.get("property_income_perk_until")
    if perk_until:
        try:
            until = datetime.fromisoformat(perk_until.replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if now_utc < until:
                income = income * 1.1
        except Exception:
            pass
    # Streak bonus: +1% income per consecutive day (up to MAX_STREAK_DAYS)
    streak_days = int(user_prop.get("collection_streak_days") or 0)
    days_since_collect = (now_utc.date() - last_collected.date()).days
    if days_since_collect <= 1:
        streak_days = min(MAX_STREAK_DAYS, streak_days + 1)
    else:
        streak_days = 1
    if streak_days > 0:
        income *= 1.0 + streak_days * STREAK_BONUS_PER_DAY
    # Per-property reinvest buff
    income_buff_until = user_prop.get("income_buff_until")
    buff_active = False
    if income_buff_until:
        try:
            buff_until_dt = datetime.fromisoformat(income_buff_until.replace("Z", "+00:00"))
            if buff_until_dt.tzinfo is None:
                buff_until_dt = buff_until_dt.replace(tzinfo=timezone.utc)
            if now_utc < buff_until_dt:
                income *= 1.0 + BUFF_INCOME_MULT
                buff_active = True
        except Exception:
            buff_active = False
    # Risk event: if money has been capped for a while, chance to lose a slice
    risk_event = None
    if hours_passed >= RISK_HOURS_THRESHOLD and income >= base_income_cap * 0.99:
        if random.random() < RISK_EVENT_CHANCE:
            loss_pct = random.uniform(RISK_LOSS_MIN, RISK_LOSS_MAX)
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
    update_fields = {
        "last_collected": now_utc.isoformat(),
        "collection_streak_days": streak_days,
    }
    await db.user_properties.update_one(
        {"user_id": current_user["id"], "property_id": property_id},
        {"$set": update_fields}
    )
    message = f"Collected ${income:,.2f}"
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
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"points": -BUFF_COST_POINTS}},
        )
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
