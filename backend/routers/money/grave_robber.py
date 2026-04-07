from datetime import datetime, timedelta, timezone
import math
import secrets
import uuid
from typing import Optional

from fastapi import Depends, HTTPException

from server import CARS, db, get_current_user_verified, log_activity
from routers.kill.armoury import TOKEN_CONFIG, TOKEN_TYPES
from utils.point_provenance import log_points_event

_rng = secrets.SystemRandom()

GR_ATTEMPTS_TOTAL = 50
GR_BASE_ATTEMPT_COST = 1_000_000
GR_TIER_STEP_PCT = 5
GR_TIER_MULTIPLIER = 1.15
GR_TIERS_TOTAL = int(100 / GR_TIER_STEP_PCT)  # 20
GR_COOLDOWN_HOURS = 24
GR_RECENT_ATTEMPTS_LIMIT = 20

# Rank-XP pass token is store-only, excluded from this reward pool.
GR_TOKEN_TYPES = tuple(t for t in TOKEN_TYPES if t != "rank_xp_pass")

# Exclude exclusive and loot-exclusive, plus custom car.
GR_CAR_POOL = [
    c for c in CARS
    if c.get("id") != "car_custom" and c.get("rarity") not in ("exclusive", "loot_exclusive")
]

GR_REWARD_WEIGHTS = (
    ("nothing", 0.37),
    ("cash", 0.31),
    ("bullets", 0.17),
    ("points", 0.02),  # hardest reward to hit
    ("tokens", 0.10),
    ("car", 0.03),
)


def _as_utc_dt(v) -> Optional[datetime]:
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)
    if isinstance(v, str):
        s = v.replace("Z", "+00:00")
        try:
            d = datetime.fromisoformat(s)
        except ValueError:
            return None
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc)
    return None


def _tier_for_attempts_used(attempts_used: int) -> int:
    used = max(0, min(GR_ATTEMPTS_TOTAL - 1, int(attempts_used or 0)))
    tier = int(math.floor((used * GR_TIERS_TOTAL) / GR_ATTEMPTS_TOTAL))
    return max(0, min(GR_TIERS_TOTAL - 1, tier))


def _cost_for_attempts_used(attempts_used: int) -> int:
    tier = _tier_for_attempts_used(attempts_used)
    return int(round(GR_BASE_ATTEMPT_COST * (GR_TIER_MULTIPLIER ** tier)))


def _remaining_seconds(until: Optional[datetime], now: datetime) -> int:
    if not until or until <= now:
        return 0
    return int((until - now).total_seconds()) + 1


def _pick_reward_kind() -> str:
    r = _rng.random()
    cumulative = 0.0
    for kind, weight in GR_REWARD_WEIGHTS:
        cumulative += weight
        if r <= cumulative:
            return kind
    return "nothing"


def _roll_reward(attempt_cost: int) -> dict:
    kind = _pick_reward_kind()
    reward = {
        "kind": kind,
        "money": 0,
        "bullets": 0,
        "points": 0,
        "tokens": [],
        "car": None,
    }
    if kind == "nothing":
        return reward
    if kind == "cash":
        lo = max(250_000, int(attempt_cost * 0.35))
        hi = max(lo, int(attempt_cost * 1.15))
        reward["money"] = _rng.randint(lo, hi)
        return reward
    if kind == "bullets":
        lo = max(75, int(attempt_cost / 7000))
        hi = max(lo + 25, int(attempt_cost / 2500))
        reward["bullets"] = _rng.randint(lo, hi)
        return reward
    if kind == "points":
        lo = max(5, int(attempt_cost / 250_000))
        hi = max(lo + 5, int(attempt_cost / 90_000))
        hi = min(100, hi)
        lo = min(lo, hi)
        reward["points"] = _rng.randint(lo, hi)
        return reward
    if kind == "tokens":
        picks = 2 if _rng.random() < 0.35 else 1
        chosen = _rng.sample(list(GR_TOKEN_TYPES), k=min(picks, len(GR_TOKEN_TYPES)))
        for t in chosen:
            reward["tokens"].append({"token_type": t, "amount": _rng.randint(1, 2)})
        return reward
    if kind == "car" and GR_CAR_POOL:
        car = _rng.choice(GR_CAR_POOL)
        reward["car"] = {
            "car_id": car.get("id"),
            "name": car.get("name", car.get("id")),
            "rarity": car.get("rarity", "common"),
        }
    return reward


def register(router):
    @router.get("/grave-robber/status")
    async def grave_robber_status(user: dict = Depends(get_current_user_verified)):
        uid = user.get("id") or ""
        now = datetime.now(timezone.utc)
        fresh = await db.users.find_one({"id": uid}, {"_id": 0}) or user
        attempts_total = int(fresh.get("grave_robber_attempts_total") or GR_ATTEMPTS_TOTAL)
        attempts_used = int(fresh.get("grave_robber_attempts_used") or 0)
        attempts_used = max(0, min(attempts_total, attempts_used))
        attempts_remaining = max(0, attempts_total - attempts_used)
        cooldown_until_dt = _as_utc_dt(fresh.get("grave_robber_cooldown_until"))
        cooldown_active = bool(cooldown_until_dt and cooldown_until_dt > now)
        run_started_at = _as_utc_dt(fresh.get("grave_robber_run_started_at"))

        current_attempt_cost = int(fresh.get("grave_robber_current_attempt_cost") or _cost_for_attempts_used(attempts_used))
        next_attempt_cost = int(_cost_for_attempts_used(min(attempts_total - 1, attempts_used + 1)))
        tier = _tier_for_attempts_used(attempts_used if attempts_used < attempts_total else attempts_total - 1)

        recent = await db.grave_robber_attempts.find(
            {"user_id": uid},
            {"_id": 0},
        ).sort("attempted_at", -1).limit(GR_RECENT_ATTEMPTS_LIMIT).to_list(GR_RECENT_ATTEMPTS_LIMIT)

        return {
            "attempts_total": attempts_total,
            "attempts_used": attempts_used,
            "attempts_remaining": attempts_remaining,
            "run_started": bool(run_started_at) and attempts_used < attempts_total,
            "run_started_at": run_started_at.isoformat() if run_started_at else None,
            "current_attempt_cost": current_attempt_cost,
            "next_attempt_cost": next_attempt_cost,
            "tier_index": tier,
            "tier_count": GR_TIERS_TOTAL,
            "tier_step_percent": GR_TIER_STEP_PCT,
            "tier_multiplier": GR_TIER_MULTIPLIER,
            "base_attempt_cost": GR_BASE_ATTEMPT_COST,
            "cooldown_active": cooldown_active,
            "cooldown_until": cooldown_until_dt.isoformat() if cooldown_until_dt and cooldown_until_dt > now else None,
            "cooldown_remaining_seconds": _remaining_seconds(cooldown_until_dt, now),
            "total_spent": int(fresh.get("grave_robber_total_spent") or 0),
            "total_rewards_cash": int(fresh.get("grave_robber_total_rewards_cash") or 0),
            "total_rewards_bullets": int(fresh.get("grave_robber_total_rewards_bullets") or 0),
            "total_rewards_points": int(fresh.get("grave_robber_total_rewards_points") or 0),
            "recent_attempts": recent,
        }

    @router.post("/grave-robber/start-run")
    async def grave_robber_start_run(user: dict = Depends(get_current_user_verified)):
        uid = user.get("id") or ""
        now = datetime.now(timezone.utc)
        fresh = await db.users.find_one({"id": uid}, {"_id": 0}) or user
        cooldown_until_dt = _as_utc_dt(fresh.get("grave_robber_cooldown_until"))
        if cooldown_until_dt and cooldown_until_dt > now:
            raise HTTPException(status_code=400, detail="Cooldown active. Finish your cooldown before starting a new run.")
        attempts_total = int(fresh.get("grave_robber_attempts_total") or GR_ATTEMPTS_TOTAL)
        attempts_used = int(fresh.get("grave_robber_attempts_used") or 0)
        run_started_at = _as_utc_dt(fresh.get("grave_robber_run_started_at"))
        if run_started_at and attempts_used < attempts_total:
            raise HTTPException(status_code=400, detail="Run already active. Continue digging.")

        await db.users.update_one(
            {"id": uid},
            {
                "$set": {
                    "grave_robber_attempts_total": GR_ATTEMPTS_TOTAL,
                    "grave_robber_attempts_used": 0,
                    "grave_robber_current_attempt_cost": GR_BASE_ATTEMPT_COST,
                    "grave_robber_run_started_at": now,
                    "grave_robber_cooldown_until": None,
                }
            },
        )
        await log_activity(uid, user.get("username") or "?", "grave_robber_start_run", {"attempts_total": GR_ATTEMPTS_TOTAL})
        return {
            "ok": True,
            "message": "Grave Robber run started. 50 attempts ready.",
            "attempts_total": GR_ATTEMPTS_TOTAL,
            "attempts_used": 0,
            "attempts_remaining": GR_ATTEMPTS_TOTAL,
            "current_attempt_cost": GR_BASE_ATTEMPT_COST,
            "tier_step_percent": GR_TIER_STEP_PCT,
            "tier_multiplier": GR_TIER_MULTIPLIER,
        }

    @router.post("/grave-robber/attempt")
    async def grave_robber_attempt(user: dict = Depends(get_current_user_verified)):
        uid = user.get("id") or ""
        uname = user.get("username") or "?"
        now = datetime.now(timezone.utc)
        fresh = await db.users.find_one({"id": uid}, {"_id": 0})
        if not fresh:
            raise HTTPException(status_code=404, detail="User not found.")

        cooldown_until_dt = _as_utc_dt(fresh.get("grave_robber_cooldown_until"))
        if cooldown_until_dt and cooldown_until_dt > now:
            raise HTTPException(status_code=400, detail="Cooldown active. Come back when the heat dies down.")

        attempts_total = int(fresh.get("grave_robber_attempts_total") or GR_ATTEMPTS_TOTAL)
        attempts_used = int(fresh.get("grave_robber_attempts_used") or 0)
        run_started_at = _as_utc_dt(fresh.get("grave_robber_run_started_at"))
        if not run_started_at:
            raise HTTPException(status_code=400, detail="Start a run first.")
        if attempts_used >= attempts_total:
            raise HTTPException(status_code=400, detail="Run completed. Wait for cooldown, then start a new run.")

        expected_cost = int(fresh.get("grave_robber_current_attempt_cost") or _cost_for_attempts_used(attempts_used))
        next_attempts_used = attempts_used + 1
        next_cost = _cost_for_attempts_used(next_attempts_used)

        step = await db.users.update_one(
            {
                "id": uid,
                "money": {"$gte": expected_cost},
                "grave_robber_attempts_used": attempts_used,
            },
            {
                "$inc": {
                    "money": -expected_cost,
                    "grave_robber_attempts_used": 1,
                    "grave_robber_total_spent": expected_cost,
                },
                "$set": {
                    "grave_robber_current_attempt_cost": next_cost,
                    "grave_robber_last_attempt_at": now,
                },
            },
        )
        if step.modified_count == 0:
            fresh_after = await db.users.find_one({"id": uid}, {"money": 1, "grave_robber_attempts_used": 1, "_id": 0}) or {}
            if int(fresh_after.get("money") or 0) < expected_cost:
                raise HTTPException(status_code=400, detail=f"You need ${expected_cost:,} cash for this dig.")
            raise HTTPException(status_code=409, detail="Attempt state changed. Refresh and try again.")

        reward = _roll_reward(expected_cost)
        inc = {}
        if int(reward.get("money") or 0) > 0:
            inc["money"] = int(reward["money"])
            inc["grave_robber_total_rewards_cash"] = int(reward["money"])
        if int(reward.get("bullets") or 0) > 0:
            inc["bullets"] = int(reward["bullets"])
            inc["grave_robber_total_rewards_bullets"] = int(reward["bullets"])
        if int(reward.get("points") or 0) > 0:
            inc["points"] = int(reward["points"])
            inc["grave_robber_total_rewards_points"] = int(reward["points"])

        token_counts = {}
        for row in reward.get("tokens") or []:
            t = row.get("token_type")
            amt = max(0, int(row.get("amount") or 0))
            cfg = TOKEN_CONFIG.get(t)
            if not cfg or amt <= 0:
                continue
            field = cfg["count_field"]
            token_counts[field] = token_counts.get(field, 0) + amt
        for field, amt in token_counts.items():
            inc[field] = int(inc.get(field, 0)) + int(amt)

        if inc:
            await db.users.update_one({"id": uid}, {"$inc": inc})
        if int(reward.get("points") or 0) > 0:
            await log_points_event(
                db,
                user_id=uid,
                points=int(reward["points"]),
                event_type="grave_robber_reward",
                event_ref=f"grave_robber:{uuid.uuid4().hex}",
            )

        if reward.get("car"):
            car_id = reward["car"].get("car_id")
            if car_id:
                await db.user_cars.insert_one(
                    {
                        "id": uuid.uuid4().hex,
                        "user_id": uid,
                        "car_id": car_id,
                        "acquired_at": now,
                        "source": "grave_robber",
                    }
                )

        is_last_attempt = next_attempts_used >= attempts_total
        cooldown_until_iso = None
        if is_last_attempt:
            cool_until = now + timedelta(hours=GR_COOLDOWN_HOURS)
            await db.users.update_one(
                {
                    "id": uid,
                    "grave_robber_attempts_used": {"$gte": attempts_total},
                },
                {
                    "$set": {
                        "grave_robber_cooldown_until": cool_until,
                        "grave_robber_run_completed_at": now,
                    }
                },
            )
            cooldown_until_iso = cool_until.isoformat()

        attempt_row = {
            "id": uuid.uuid4().hex,
            "user_id": uid,
            "username": uname,
            "attempted_at": now,
            "attempt_number": next_attempts_used,
            "attempt_cost": expected_cost,
            "reward": reward,
        }
        await db.grave_robber_attempts.insert_one(attempt_row)
        await log_activity(
            uid,
            uname,
            "grave_robber_attempt",
            {
                "attempt_number": next_attempts_used,
                "attempt_cost": expected_cost,
                "reward_kind": reward.get("kind"),
                "is_last_attempt": is_last_attempt,
            },
        )

        return {
            "message": "Grave disturbed.",
            "attempt": {
                "attempt_number": next_attempts_used,
                "attempt_cost": expected_cost,
                "reward": reward,
            },
            "attempts_total": attempts_total,
            "attempts_used": next_attempts_used,
            "attempts_remaining": max(0, attempts_total - next_attempts_used),
            "current_attempt_cost": next_cost if not is_last_attempt else None,
            "cooldown_until": cooldown_until_iso,
            "cooldown_hours": GR_COOLDOWN_HOURS if is_last_attempt else 0,
            "tier_step_percent": GR_TIER_STEP_PCT,
            "tier_multiplier": GR_TIER_MULTIPLIER,
        }
