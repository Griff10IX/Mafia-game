# Objectives: daily and weekly objectives with progress tracking and completion rewards
from datetime import datetime, timezone, timedelta
import random
import hashlib
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException, Body
from pydantic import BaseModel
from server import (
    db,
    get_current_user,
    maybe_process_rank_up,
    send_notification,
    STATES,
    _is_admin,
)

# Difficulty thresholds for admin assessment (completion % of eligible users)
OBJ_TOO_EASY_PCT = 75   # >75% complete = too easy
OBJ_TOO_HARD_PCT = 15   # <15% complete = too hard
OBJ_MIN_SAMPLE = 5      # need at least 5 eligible to assess

# Daily: ~2-4h play. Crimes 15s-60min, GTA 60-240s, hitlist 3/3h, booze ~1-2min/run.
OBJECTIVE_TYPES_DAILY = [
    {"id": "crimes", "progress_key": "crimes", "label": "Commit {target} crimes", "target_range": (40, 120), "reward_rank_points": (5, 14), "reward_cash": (800, 3200), "reward_respect_points": (1, 4)},
    {"id": "gta", "progress_key": "gta", "label": "Complete {target} GTAs", "target_range": (5, 18), "reward_rank_points": (8, 22), "reward_cash": (500, 1800), "reward_respect_points": (1, 4)},
    {"id": "busts", "progress_key": "busts", "label": "Bust {target} players/NPCs out of jail", "target_range": (3, 10), "reward_rank_points": (8, 18), "reward_cash": (400, 1200), "reward_respect_points": (1, 4)},
    {"id": "booze_runs", "progress_key": "booze_runs", "label": "Complete {target} booze run(s) (sell delivery)", "target_range": (4, 14), "reward_rank_points": (4, 10), "reward_cash": (600, 2000), "reward_respect_points": (1, 3)},
    {"id": "crimes_in_city", "progress_key": "crimes_in_city", "label": "Commit {target} crimes in {city}", "target_range": (12, 40), "reward_rank_points": (6, 16), "reward_cash": (500, 2400), "reward_respect_points": (1, 4), "needs_city": True},
    {"id": "deposit_interest", "progress_key": "deposit_interest", "label": "Deposit ${target:,} into interest", "target_range": (100000, 600000), "reward_rank_points": (4, 10), "reward_points": (10, 35), "reward_respect_points": (1, 3)},
    {"id": "hitlist_npc_kills", "progress_key": "hitlist_npc_kills", "label": "Kill {target} hitlist NPC(s)", "target_range": (2, 8), "reward_rank_points": (12, 38), "reward_cash": (1600, 6500), "reward_respect_points": (2, 5)},
]

# Weekly: ~7x daily. Crimes 800-4k (calibrated to ~11k/week active), GTA 60-180, hitlist 18-56 (3/3h * 7d).
OBJECTIVE_TYPES_WEEKLY = [
    {"id": "crimes", "progress_key": "crimes", "label": "Commit {target} crimes this week", "target_range": (800, 3500), "reward_rank_points": (50, 120), "reward_cash": (12000, 35000), "reward_respect_points": (5, 12)},
    {"id": "gta", "progress_key": "gta", "label": "Complete {target} GTAs this week", "target_range": (45, 120), "reward_rank_points": (80, 180), "reward_cash": (8000, 22000), "reward_respect_points": (5, 12)},
    {"id": "busts", "progress_key": "busts", "label": "Bust {target} players/NPCs this week", "target_range": (25, 70), "reward_rank_points": (60, 140), "reward_cash": (5000, 16000), "reward_respect_points": (5, 12)},
    {"id": "booze_runs", "progress_key": "booze_runs", "label": "Complete {target} booze runs this week", "target_range": (35, 90), "reward_rank_points": (45, 100), "reward_cash": (8000, 22000), "reward_respect_points": (4, 10)},
    {"id": "crimes_in_city", "progress_key": "crimes_in_city", "label": "Commit {target} crimes in {city} this week", "target_range": (220, 900), "reward_rank_points": (40, 90), "reward_cash": (4000, 12000), "reward_respect_points": (5, 12), "needs_city": True},
    {"id": "deposit_interest", "progress_key": "deposit_interest", "label": "Deposit ${target:,} into interest this week", "target_range": (2000000, 8000000), "reward_rank_points": (35, 85), "reward_points": (150, 400), "reward_respect_points": (4, 10)},
    {"id": "hitlist_npc_kills", "progress_key": "hitlist_npc_kills", "label": "Kill {target} hitlist NPC(s) this week", "target_range": (18, 56), "reward_rank_points": (100, 220), "reward_cash": (18000, 45000), "reward_respect_points": (6, 14)},
]

# Monthly: ~4-5x weekly. Crimes 4k-18k (active ~11k/week = 44k/month), hitlist max ~720 (24/d*30).
OBJECTIVE_TYPES_MONTHLY = [
    {"id": "crimes", "progress_key": "crimes", "label": "Commit {target} crimes this month", "target_range": (4000, 18000), "reward_rank_points": (600, 1400), "reward_cash": (50000, 140000), "reward_respect_points": (30, 80)},
    {"id": "gta", "progress_key": "gta", "label": "Complete {target} GTAs this month", "target_range": (200, 550), "reward_rank_points": (320, 700), "reward_cash": (35000, 90000), "reward_respect_points": (30, 80)},
    {"id": "busts", "progress_key": "busts", "label": "Bust {target} players/NPCs this month", "target_range": (120, 320), "reward_rank_points": (250, 550), "reward_cash": (22000, 65000), "reward_respect_points": (30, 80)},
    {"id": "booze_runs", "progress_key": "booze_runs", "label": "Complete {target} booze runs this month", "target_range": (160, 400), "reward_rank_points": (180, 400), "reward_cash": (35000, 90000), "reward_respect_points": (24, 70)},
    {"id": "crimes_in_city", "progress_key": "crimes_in_city", "label": "Commit {target} crimes in {city} this month", "target_range": (1100, 4500), "reward_rank_points": (160, 360), "reward_cash": (18000, 50000), "reward_respect_points": (30, 80), "needs_city": True},
    {"id": "deposit_interest", "progress_key": "deposit_interest", "label": "Deposit ${target:,} into interest this month", "target_range": (10000000, 45000000), "reward_rank_points": (140, 340), "reward_points": (600, 1600), "reward_respect_points": (24, 70)},
    {"id": "hitlist_npc_kills", "progress_key": "hitlist_npc_kills", "label": "Kill {target} hitlist NPC(s) this month", "target_range": (80, 250), "reward_rank_points": (400, 900), "reward_cash": (75000, 180000), "reward_respect_points": (40, 100)},
]

# Completion bonus when ALL daily / weekly / monthly are done (on top of per-objective rewards)
DAILY_COMPLETION_BONUS = {"rank_points": 25, "money": 3500, "points": 18, "respect_points": 5}
WEEKLY_COMPLETION_BONUS = {"rank_points": 180, "money": 40000, "points": 180, "respect_points": 15}
MONTHLY_COMPLETION_BONUS = {"rank_points": 1800, "money": 360000, "points": 1500, "respect_points": 150}
# Weekly and monthly rewards are multiplied so they feel like "x5" and "x15" vs daily
WEEKLY_REWARD_MULTIPLIER = 5
MONTHLY_REWARD_MULTIPLIER = 15


def _date_seed(date_str: str) -> int:
    """Deterministic seed from date string for reproducible daily objectives."""
    return int(hashlib.sha256(date_str.encode()).hexdigest()[:8], 16)


def _week_start(dt: datetime) -> datetime:
    """Monday 00:00 UTC as start of week."""
    d = dt.date()
    days_since_monday = (d.weekday()) % 7
    start = d - timedelta(days=days_since_monday)
    return datetime(start.year, start.month, start.day, tzinfo=timezone.utc)


def _month_start(dt: datetime) -> datetime:
    """First day of month 00:00 UTC."""
    d = dt.date()
    return datetime(d.year, d.month, 1, tzinfo=timezone.utc)


async def update_objectives_progress(user_id: str, objective_type: str, amount: int = 1, city: Optional[str] = None):
    """Increment daily/weekly/monthly objectives progress. Call after crimes, GTA, busts, booze sell, interest deposit, hitlist NPC kill.
    objective_type: crimes, gta, busts, booze_runs, crimes_in_city, deposit_interest, hitlist_npc_kills.
    For crimes_in_city pass city= (e.g. Chicago). For deposit_interest pass amount= dollars deposited."""
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    week_start_str = _week_start(now).strftime("%Y-%m-%d")
    month_start_str = _month_start(now).strftime("%Y-%m-%d")
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "objectives_daily_date": 1, "objectives_daily_progress": 1,
         "objectives_weekly_start": 1, "objectives_weekly_progress": 1,
         "objectives_monthly_start": 1, "objectives_monthly_progress": 1}
    )
    if not user:
        return
    daily_date = user.get("objectives_daily_date")
    weekly_start = user.get("objectives_weekly_start")
    monthly_start = user.get("objectives_monthly_start")
    daily_progress = dict(user.get("objectives_daily_progress") or {})
    weekly_progress = dict(user.get("objectives_weekly_progress") or {})
    monthly_progress = dict(user.get("objectives_monthly_progress") or {})

    def _progress_val(d: dict, k: str) -> int:
        v = d.get(k, 0)
        try:
            return int(v) if v is not None else 0
        except (TypeError, ValueError):
            return 0

    if daily_date == today_str:
        if objective_type == "crimes_in_city" and city:
            key = f"crimes_in_{city.lower().replace(' ', '_')}"
            daily_progress[key] = _progress_val(daily_progress, key) + amount
        else:
            daily_progress[objective_type] = _progress_val(daily_progress, objective_type) + amount
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"objectives_daily_progress": daily_progress}}
        )
    if weekly_start == week_start_str:
        if objective_type == "crimes_in_city" and city:
            key = f"crimes_in_{city.lower().replace(' ', '_')}"
            weekly_progress[key] = _progress_val(weekly_progress, key) + amount
        else:
            weekly_progress[objective_type] = _progress_val(weekly_progress, objective_type) + amount
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"objectives_weekly_progress": weekly_progress}}
        )
    if monthly_start == month_start_str:
        if objective_type == "crimes_in_city" and city:
            key = f"crimes_in_{city.lower().replace(' ', '_')}"
            monthly_progress[key] = _progress_val(monthly_progress, key) + amount
        else:
            monthly_progress[objective_type] = _progress_val(monthly_progress, objective_type) + amount
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"objectives_monthly_progress": monthly_progress}}
        )


def _generate_daily_objectives(date_str: str) -> list:
    rng = random.Random(_date_seed(date_str))
    num_objectives = 5
    pool = list(OBJECTIVE_TYPES_DAILY)
    rng.shuffle(pool)
    out = []
    for i in range(min(num_objectives, len(pool))):
        t = pool[i]
        lo, hi = t["target_range"]
        if t["id"] == "deposit_interest":
            target = rng.randint(lo // 10000, hi // 10000) * 10000
        else:
            target = rng.randint(lo, hi)
        reward = {}
        if "reward_rank_points" in t:
            rp_lo, rp_hi = t["reward_rank_points"]
            reward["rank_points"] = rng.randint(rp_lo, rp_hi)
        if "reward_cash" in t:
            c_lo, c_hi = t["reward_cash"]
            reward["money"] = rng.randint(c_lo, c_hi)
        if "reward_points" in t:
            p_lo, p_hi = t["reward_points"]
            reward["points"] = rng.randint(p_lo, p_hi)
        if "reward_respect_points" in t:
            rp_lo, rp_hi = t["reward_respect_points"]
            reward["respect_points"] = rng.randint(rp_lo, rp_hi)
        city = rng.choice(STATES) if t.get("needs_city") else None
        label = t["label"].format(target=target, city=city or "")
        out.append({
            "id": t["id"],
            "progress_key": t["progress_key"],
            "label": label,
            "target": target,
            "reward": reward,
            "city": city,
        })
    return out


def _generate_weekly_objectives(week_start_str: str) -> list:
    rng = random.Random(_date_seed(week_start_str))
    num_objectives = 6  # more to do each week
    pool = list(OBJECTIVE_TYPES_WEEKLY)
    rng.shuffle(pool)
    out = []
    for i in range(min(num_objectives, len(pool))):
        t = pool[i]
        lo, hi = t["target_range"]
        if t["id"] == "deposit_interest":
            target = rng.randint(lo // 100000, hi // 100000) * 100000
        else:
            target = rng.randint(lo, hi)
        reward = {}
        if "reward_rank_points" in t:
            rp_lo, rp_hi = t["reward_rank_points"]
            reward["rank_points"] = rng.randint(rp_lo, rp_hi)
        if "reward_cash" in t:
            c_lo, c_hi = t["reward_cash"]
            reward["money"] = rng.randint(c_lo, c_hi)
        if "reward_points" in t:
            p_lo, p_hi = t["reward_points"]
            reward["points"] = rng.randint(p_lo, p_hi)
        if "reward_respect_points" in t:
            rp_lo, rp_hi = t["reward_respect_points"]
            reward["respect_points"] = rng.randint(rp_lo, rp_hi)
        city = rng.choice(STATES) if t.get("needs_city") else None
        label = t["label"].format(target=target, city=city or "")
        out.append({
            "id": t["id"],
            "progress_key": t["progress_key"],
            "label": label,
            "target": target,
            "reward": reward,
            "city": city,
        })
    return out


def _generate_monthly_objectives(month_start_str: str) -> list:
    rng = random.Random(_date_seed(month_start_str))
    num_objectives = 6
    pool = list(OBJECTIVE_TYPES_MONTHLY)
    rng.shuffle(pool)
    out = []
    for i in range(min(num_objectives, len(pool))):
        t = pool[i]
        lo, hi = t["target_range"]
        if t["id"] == "deposit_interest":
            target = rng.randint(lo // 500000, hi // 500000) * 500000
        else:
            target = rng.randint(lo, hi)
        reward = {}
        if "reward_rank_points" in t:
            rp_lo, rp_hi = t["reward_rank_points"]
            reward["rank_points"] = rng.randint(rp_lo, rp_hi)
        if "reward_cash" in t:
            c_lo, c_hi = t["reward_cash"]
            reward["money"] = rng.randint(c_lo, c_hi)
        if "reward_points" in t:
            p_lo, p_hi = t["reward_points"]
            reward["points"] = rng.randint(p_lo, p_hi)
        if "reward_respect_points" in t:
            rp_lo, rp_hi = t["reward_respect_points"]
            reward["respect_points"] = rng.randint(rp_lo, rp_hi)
        city = rng.choice(STATES) if t.get("needs_city") else None
        label = t["label"].format(target=target, city=city or "")
        out.append({
            "id": t["id"],
            "progress_key": t["progress_key"],
            "label": label,
            "target": target,
            "reward": reward,
            "city": city,
        })
    return out


def _get_progress_for_objective(progress_dict: dict, obj: dict, user_current_state: str) -> int:
    """Return current progress value for this objective."""
    key = obj["progress_key"]
    if key == "crimes_in_city":
        city = obj.get("city")
        if not city:
            return 0
        return int(progress_dict.get(f"crimes_in_{city.lower().replace(' ', '_')}", 0) or 0)
    return int(progress_dict.get(key, 0) or 0)


def _progress_key_for_city(city: str) -> str:
    return f"crimes_in_{city.lower().replace(' ', '_')}"


def _build_objective_list(objectives: list, progress: dict, current_state: str):
    result = []
    all_done = True
    total_rewards = {"rank_points": 0, "money": 0, "points": 0, "respect_points": 0}
    for obj in objectives:
        if obj["progress_key"] == "crimes_in_city":
            current = _get_progress_for_objective(progress, obj, current_state)
        else:
            current = int(progress.get(obj["progress_key"], 0) or 0)
        target = obj["target"]
        done = current >= target
        if not done:
            all_done = False
        for k, v in (obj.get("reward") or {}).items():
            if done and k in total_rewards:
                total_rewards[k] = total_rewards.get(k, 0) + v
        result.append({
            "id": obj["id"],
            "label": obj["label"],
            "target": target,
            "current": min(current, target),
            "done": done,
            "reward": obj.get("reward"),
        })
    return result, all_done, total_rewards


def _assess_difficulty(eligible: int, claimed: int) -> str:
    """Return 'too_easy' | 'too_hard' | 'about_right' | 'low_sample' based on completion rate."""
    if eligible < OBJ_MIN_SAMPLE:
        return "low_sample"
    pct = 100.0 * claimed / eligible if eligible else 0
    if pct > OBJ_TOO_EASY_PCT:
        return "too_easy"
    if pct < OBJ_TOO_HARD_PCT:
        return "too_hard"
    return "about_right"


async def _get_objectives_admin_stats(today_str: str, week_start_str: str, month_start_str: str) -> dict:
    """Compute completion stats and difficulty assessment for admin. Excludes dead users."""
    exclude_dead = {"is_dead": {"$ne": True}}
    daily_eligible = await db.users.count_documents({
        **exclude_dead,
        "objectives_daily_date": today_str,
    })
    daily_claimed = await db.users.count_documents({
        **exclude_dead,
        "objectives_daily_date": today_str,
        "objectives_daily_claimed": True,
    })
    weekly_eligible = await db.users.count_documents({
        **exclude_dead,
        "objectives_weekly_start": week_start_str,
    })
    weekly_claimed = await db.users.count_documents({
        **exclude_dead,
        "objectives_weekly_start": week_start_str,
        "objectives_weekly_claimed": True,
    })
    monthly_eligible = await db.users.count_documents({
        **exclude_dead,
        "objectives_monthly_start": month_start_str,
    })
    monthly_claimed = await db.users.count_documents({
        **exclude_dead,
        "objectives_monthly_start": month_start_str,
        "objectives_monthly_claimed": True,
    })
    def _pct(e, c):
        return round(100.0 * c / e, 1) if e else 0
    return {
        "daily": {
            "eligible": daily_eligible,
            "claimed": daily_claimed,
            "completion_pct": _pct(daily_eligible, daily_claimed),
            "assessment": _assess_difficulty(daily_eligible, daily_claimed),
        },
        "weekly": {
            "eligible": weekly_eligible,
            "claimed": weekly_claimed,
            "completion_pct": _pct(weekly_eligible, weekly_claimed),
            "assessment": _assess_difficulty(weekly_eligible, weekly_claimed),
        },
        "monthly": {
            "eligible": monthly_eligible,
            "claimed": monthly_claimed,
            "completion_pct": _pct(monthly_eligible, monthly_claimed),
            "assessment": _assess_difficulty(monthly_eligible, monthly_claimed),
        },
    }


async def get_objectives(current_user: dict = Depends(get_current_user)):
    """Get today's, this week's, and this month's objectives and user progress. Use POST /objectives/claim to claim rewards when all complete."""
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    week_start = _week_start(now)
    week_start_str = week_start.strftime("%Y-%m-%d")
    month_start = _month_start(now)
    month_start_str = month_start.strftime("%Y-%m-%d")

    user_id = current_user["id"]
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "objectives_daily_date": 1, "objectives_daily_progress": 1, "objectives_daily_claimed": 1,
         "objectives_daily_claim_notified": 1, "objectives_weekly_start": 1, "objectives_weekly_progress": 1,
         "objectives_weekly_claimed": 1, "objectives_weekly_claim_notified": 1, "objectives_monthly_start": 1,
         "objectives_monthly_progress": 1, "objectives_monthly_claimed": 1, "objectives_monthly_claim_notified": 1, "current_state": 1}
    )
    user = user or {}

    # Reset daily if new day
    daily_date = user.get("objectives_daily_date")
    daily_progress = dict(user.get("objectives_daily_progress") or {})
    daily_claimed = bool(user.get("objectives_daily_claimed"))
    if daily_date != today_str:
        daily_progress = {}
        daily_claimed = False
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"objectives_daily_date": today_str, "objectives_daily_progress": {}, "objectives_daily_claimed": False, "objectives_daily_claim_notified": None}}
        )

    # Reset weekly if new week
    weekly_start = user.get("objectives_weekly_start")
    weekly_progress = dict(user.get("objectives_weekly_progress") or {})
    weekly_claimed = bool(user.get("objectives_weekly_claimed"))
    if weekly_start != week_start_str:
        weekly_progress = {}
        weekly_claimed = False
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"objectives_weekly_start": week_start_str, "objectives_weekly_progress": {}, "objectives_weekly_claimed": False, "objectives_weekly_claim_notified": None}}
        )

    # Reset monthly if new month
    monthly_start = user.get("objectives_monthly_start")
    monthly_progress = dict(user.get("objectives_monthly_progress") or {})
    monthly_claimed = bool(user.get("objectives_monthly_claimed"))
    if monthly_start != month_start_str:
        monthly_progress = {}
        monthly_claimed = False
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"objectives_monthly_start": month_start_str, "objectives_monthly_progress": {}, "objectives_monthly_claimed": False, "objectives_monthly_claim_notified": None}}
        )

    daily_objectives = _generate_daily_objectives(today_str)
    weekly_objectives = _generate_weekly_objectives(week_start_str)
    monthly_objectives = _generate_monthly_objectives(month_start_str)
    current_state = (user.get("current_state") or "").strip() or (current_user.get("current_state") or "")

    daily_list, daily_all_done, daily_total_rewards = _build_objective_list(daily_objectives, daily_progress, current_state)
    weekly_list, weekly_all_done, weekly_total_rewards = _build_objective_list(weekly_objectives, weekly_progress, current_state)
    monthly_list, monthly_all_done, monthly_total_rewards = _build_objective_list(monthly_objectives, monthly_progress, current_state)

    # Preview claim rewards (manual claim via POST /objectives/claim)
    daily_claim_reward = None
    if daily_all_done and not daily_claimed:
        daily_claim_reward = {k: v for k, v in daily_total_rewards.items() if v}
        daily_claim_reward["rank_points"] = daily_claim_reward.get("rank_points", 0) + DAILY_COMPLETION_BONUS.get("rank_points", 0)
        daily_claim_reward["money"] = daily_claim_reward.get("money", 0) + DAILY_COMPLETION_BONUS.get("money", 0)
        daily_claim_reward["points"] = daily_claim_reward.get("points", 0) + DAILY_COMPLETION_BONUS.get("points", 0)
        daily_claim_reward["respect_points"] = daily_claim_reward.get("respect_points", 0) + DAILY_COMPLETION_BONUS.get("respect_points", 0)
        if user.get("objectives_daily_claim_notified") != today_str:
            await send_notification(user_id, "Objectives", "Your daily objectives are complete! Claim your rewards on the Objectives page.", "reward", category="system")
            await db.users.update_one({"id": user_id}, {"$set": {"objectives_daily_claim_notified": today_str}})

    weekly_claim_reward = None
    if weekly_all_done and not weekly_claimed:
        weekly_claim_reward = {k: v for k, v in weekly_total_rewards.items() if v}
        weekly_claim_reward["rank_points"] = (weekly_claim_reward.get("rank_points", 0) + WEEKLY_COMPLETION_BONUS.get("rank_points", 0)) * WEEKLY_REWARD_MULTIPLIER
        weekly_claim_reward["money"] = (weekly_claim_reward.get("money", 0) + WEEKLY_COMPLETION_BONUS.get("money", 0)) * WEEKLY_REWARD_MULTIPLIER
        weekly_claim_reward["points"] = (weekly_claim_reward.get("points", 0) + WEEKLY_COMPLETION_BONUS.get("points", 0)) * WEEKLY_REWARD_MULTIPLIER
        weekly_claim_reward["respect_points"] = (weekly_claim_reward.get("respect_points", 0) + WEEKLY_COMPLETION_BONUS.get("respect_points", 0)) * WEEKLY_REWARD_MULTIPLIER
        if user.get("objectives_weekly_claim_notified") != week_start_str:
            await send_notification(user_id, "Objectives", "Your weekly objectives are complete! Claim your rewards on the Objectives page.", "reward", category="system")
            await db.users.update_one({"id": user_id}, {"$set": {"objectives_weekly_claim_notified": week_start_str}})

    monthly_claim_reward = None
    if monthly_all_done and not monthly_claimed:
        monthly_claim_reward = {k: v for k, v in monthly_total_rewards.items() if v}
        monthly_claim_reward["rank_points"] = (monthly_claim_reward.get("rank_points", 0) + MONTHLY_COMPLETION_BONUS.get("rank_points", 0)) * MONTHLY_REWARD_MULTIPLIER
        monthly_claim_reward["money"] = (monthly_claim_reward.get("money", 0) + MONTHLY_COMPLETION_BONUS.get("money", 0)) * MONTHLY_REWARD_MULTIPLIER
        monthly_claim_reward["points"] = (monthly_claim_reward.get("points", 0) + MONTHLY_COMPLETION_BONUS.get("points", 0)) * MONTHLY_REWARD_MULTIPLIER
        monthly_claim_reward["respect_points"] = (monthly_claim_reward.get("respect_points", 0) + MONTHLY_COMPLETION_BONUS.get("respect_points", 0)) * MONTHLY_REWARD_MULTIPLIER
        if user.get("objectives_monthly_claim_notified") != month_start_str:
            await send_notification(user_id, "Objectives", "Your monthly objectives are complete! Claim your rewards on the Objectives page.", "reward", category="system")
            await db.users.update_one({"id": user_id}, {"$set": {"objectives_monthly_claim_notified": month_start_str}})

    out = {
        "daily": {
            "objectives": daily_list,
            "all_complete": daily_all_done,
            "claimed": daily_claimed,
            "claim_reward": daily_claim_reward,
            "date": today_str,
        },
        "weekly": {
            "objectives": weekly_list,
            "all_complete": weekly_all_done,
            "claimed": weekly_claimed,
            "claim_reward": weekly_claim_reward,
            "week_start": week_start_str,
        },
        "monthly": {
            "objectives": monthly_list,
            "all_complete": monthly_all_done,
            "claimed": monthly_claimed,
            "claim_reward": monthly_claim_reward,
            "month_start": month_start_str,
        },
    }
    if _is_admin(current_user):
        out["admin_stats"] = await _get_objectives_admin_stats(today_str, week_start_str, month_start_str)
    return out


class ObjectivesClaimRequest(BaseModel):
    type: str  # "daily" | "weekly" | "monthly"


async def claim_objectives(body: ObjectivesClaimRequest = Body(...), current_user: dict = Depends(get_current_user)):
    """Claim rewards for completed daily, weekly, or monthly objectives. No auto-payout; user must call this."""
    claim_type = (body.type or "").strip().lower()
    if claim_type not in ("daily", "weekly", "monthly"):
        raise HTTPException(status_code=400, detail="type must be daily, weekly, or monthly")

    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    week_start = _week_start(now)
    week_start_str = week_start.strftime("%Y-%m-%d")
    month_start = _month_start(now)
    month_start_str = month_start.strftime("%Y-%m-%d")

    user_id = current_user["id"]
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "objectives_daily_date": 1, "objectives_daily_progress": 1, "objectives_daily_claimed": 1,
         "objectives_weekly_start": 1, "objectives_weekly_progress": 1, "objectives_weekly_claimed": 1,
         "objectives_monthly_start": 1, "objectives_monthly_progress": 1, "objectives_monthly_claimed": 1, "current_state": 1}
    )
    user = user or {}

    current_state = (user.get("current_state") or "").strip() or (current_user.get("current_state") or "")

    if claim_type == "daily":
        daily_date = user.get("objectives_daily_date")
        if daily_date != today_str:
            raise HTTPException(status_code=400, detail="No daily objectives to claim for this period")
        daily_progress = dict(user.get("objectives_daily_progress") or {})
        daily_claimed = bool(user.get("objectives_daily_claimed"))
        daily_objectives = _generate_daily_objectives(today_str)
        daily_list, daily_all_done, daily_total_rewards = _build_objective_list(daily_objectives, daily_progress, current_state)
        if not daily_all_done or daily_claimed:
            raise HTTPException(status_code=400, detail="Daily objectives not complete or already claimed")
        reward = {k: v for k, v in daily_total_rewards.items() if v}
        reward["rank_points"] = reward.get("rank_points", 0) + DAILY_COMPLETION_BONUS.get("rank_points", 0)
        reward["money"] = reward.get("money", 0) + DAILY_COMPLETION_BONUS.get("money", 0)
        reward["points"] = reward.get("points", 0) + DAILY_COMPLETION_BONUS.get("points", 0)
        reward["respect_points"] = reward.get("respect_points", 0) + DAILY_COMPLETION_BONUS.get("respect_points", 0)
        inc = {k: v for k, v in reward.items() if k in ("money", "rank_points", "points", "respect_points")}
        rp_before = int(user.get("rank_points") or 0)
        rp_added = int(inc.get("rank_points") or 0)
        await db.users.update_one({"id": user_id}, {"$set": {"objectives_daily_claimed": True}, "$inc": inc})
        if rp_added > 0:
            try:
                await maybe_process_rank_up(user_id, rp_before, rp_added, user.get("username", ""))
            except Exception:
                pass
        return {"claimed": True, "type": "daily", "reward": reward}

    if claim_type == "weekly":
        weekly_start = user.get("objectives_weekly_start")
        if weekly_start != week_start_str:
            raise HTTPException(status_code=400, detail="No weekly objectives to claim for this period")
        weekly_progress = dict(user.get("objectives_weekly_progress") or {})
        weekly_claimed = bool(user.get("objectives_weekly_claimed"))
        weekly_objectives = _generate_weekly_objectives(week_start_str)
        weekly_list, weekly_all_done, weekly_total_rewards = _build_objective_list(weekly_objectives, weekly_progress, current_state)
        if not weekly_all_done or weekly_claimed:
            raise HTTPException(status_code=400, detail="Weekly objectives not complete or already claimed")
        reward = {k: v for k, v in weekly_total_rewards.items() if v}
        reward["rank_points"] = (reward.get("rank_points", 0) + WEEKLY_COMPLETION_BONUS.get("rank_points", 0)) * WEEKLY_REWARD_MULTIPLIER
        reward["money"] = (reward.get("money", 0) + WEEKLY_COMPLETION_BONUS.get("money", 0)) * WEEKLY_REWARD_MULTIPLIER
        reward["points"] = (reward.get("points", 0) + WEEKLY_COMPLETION_BONUS.get("points", 0)) * WEEKLY_REWARD_MULTIPLIER
        reward["respect_points"] = (reward.get("respect_points", 0) + WEEKLY_COMPLETION_BONUS.get("respect_points", 0)) * WEEKLY_REWARD_MULTIPLIER
        inc = {k: v for k, v in reward.items() if k in ("money", "rank_points", "points", "respect_points")}
        rp_before = int(user.get("rank_points") or 0)
        rp_added = int(inc.get("rank_points") or 0)
        await db.users.update_one({"id": user_id}, {"$set": {"objectives_weekly_claimed": True}, "$inc": inc})
        if rp_added > 0:
            try:
                await maybe_process_rank_up(user_id, rp_before, rp_added, user.get("username", ""))
            except Exception:
                pass
        return {"claimed": True, "type": "weekly", "reward": reward}

    if claim_type == "monthly":
        monthly_start = user.get("objectives_monthly_start")
        if monthly_start != month_start_str:
            raise HTTPException(status_code=400, detail="No monthly objectives to claim for this period")
        monthly_progress = dict(user.get("objectives_monthly_progress") or {})
        monthly_claimed = bool(user.get("objectives_monthly_claimed"))
        monthly_objectives = _generate_monthly_objectives(month_start_str)
        monthly_list, monthly_all_done, monthly_total_rewards = _build_objective_list(monthly_objectives, monthly_progress, current_state)
        if not monthly_all_done or monthly_claimed:
            raise HTTPException(status_code=400, detail="Monthly objectives not complete or already claimed")
        reward = {k: v for k, v in monthly_total_rewards.items() if v}
        reward["rank_points"] = (reward.get("rank_points", 0) + MONTHLY_COMPLETION_BONUS.get("rank_points", 0)) * MONTHLY_REWARD_MULTIPLIER
        reward["money"] = (reward.get("money", 0) + MONTHLY_COMPLETION_BONUS.get("money", 0)) * MONTHLY_REWARD_MULTIPLIER
        reward["points"] = (reward.get("points", 0) + MONTHLY_COMPLETION_BONUS.get("points", 0)) * MONTHLY_REWARD_MULTIPLIER
        reward["respect_points"] = (reward.get("respect_points", 0) + MONTHLY_COMPLETION_BONUS.get("respect_points", 0)) * MONTHLY_REWARD_MULTIPLIER
        inc = {k: v for k, v in reward.items() if k in ("money", "rank_points", "points", "respect_points")}
        rp_before = int(user.get("rank_points") or 0)
        rp_added = int(inc.get("rank_points") or 0)
        await db.users.update_one({"id": user_id}, {"$set": {"objectives_monthly_claimed": True}, "$inc": inc})
        if rp_added > 0:
            try:
                await maybe_process_rank_up(user_id, rp_before, rp_added, user.get("username", ""))
            except Exception:
                pass
        return {"claimed": True, "type": "monthly", "reward": reward}

    raise HTTPException(status_code=400, detail="Invalid type")


def register(router):
    router.add_api_route("/objectives", get_objectives, methods=["GET"])
    router.add_api_route("/objectives/claim", claim_objectives, methods=["POST"])
