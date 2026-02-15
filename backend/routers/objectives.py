# Objectives: daily and weekly objectives with progress tracking and completion rewards
from datetime import datetime, timezone, timedelta
import random
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException
from server import (
    db,
    get_current_user,
    STATES,
)

# Objective types and their progress keys
OBJECTIVE_TYPES_DAILY = [
    {"id": "crimes", "progress_key": "crimes", "label": "Commit {target} crimes", "target_range": (5, 15), "reward_rank_points": (3, 8), "reward_cash": (500, 2000)},
    {"id": "gta", "progress_key": "gta", "label": "Complete {target} GTA heists", "target_range": (1, 5), "reward_rank_points": (5, 15), "reward_cash": (300, 1000)},
    {"id": "busts", "progress_key": "busts", "label": "Bust {target} players/NPCs out of jail", "target_range": (1, 4), "reward_rank_points": (5, 12), "reward_cash": (200, 800)},
    {"id": "booze_runs", "progress_key": "booze_runs", "label": "Complete {target} booze run(s) (sell delivery)", "target_range": (1, 4), "reward_rank_points": (2, 6), "reward_cash": (400, 1200)},
    {"id": "crimes_in_city", "progress_key": "crimes_in_city", "label": "Commit {target} crimes in {city}", "target_range": (3, 10), "reward_rank_points": (4, 10), "reward_cash": (300, 1500), "needs_city": True},
    {"id": "deposit_interest", "progress_key": "deposit_interest", "label": "Deposit ${target:,} into interest", "target_range": (50000, 300000), "reward_rank_points": (2, 6), "reward_points": (5, 20)},
    {"id": "hitlist_npc_kills", "progress_key": "hitlist_npc_kills", "label": "Kill {target} hitlist NPC(s)", "target_range": (1, 5), "reward_rank_points": (8, 25), "reward_cash": (1000, 4000)},
]

OBJECTIVE_TYPES_WEEKLY = [
    {"id": "crimes", "progress_key": "crimes", "label": "Commit {target} crimes this week", "target_range": (30, 80), "reward_rank_points": (20, 50), "reward_cash": (3000, 10000)},
    {"id": "gta", "progress_key": "gta", "label": "Complete {target} GTA heists this week", "target_range": (8, 25), "reward_rank_points": (30, 80), "reward_cash": (2000, 6000)},
    {"id": "busts", "progress_key": "busts", "label": "Bust {target} players/NPCs this week", "target_range": (5, 15), "reward_rank_points": (25, 60), "reward_cash": (1500, 5000)},
    {"id": "booze_runs", "progress_key": "booze_runs", "label": "Complete {target} booze runs this week", "target_range": (5, 15), "reward_rank_points": (15, 40), "reward_cash": (2000, 6000)},
    {"id": "deposit_interest", "progress_key": "deposit_interest", "label": "Deposit ${target:,} into interest this week", "target_range": (500000, 2000000), "reward_rank_points": (10, 30), "reward_points": (50, 150)},
    {"id": "hitlist_npc_kills", "progress_key": "hitlist_npc_kills", "label": "Kill {target} hitlist NPC(s) this week", "target_range": (3, 10), "reward_rank_points": (40, 100), "reward_cash": (5000, 15000)},
]

# Completion bonus when ALL daily or weekly are done (on top of per-objective rewards)
DAILY_COMPLETION_BONUS = {"rank_points": 15, "money": 2000, "points": 10}
WEEKLY_COMPLETION_BONUS = {"rank_points": 80, "money": 15000, "points": 75}


def _date_seed(date_str: str) -> int:
    """Deterministic seed from date string for reproducible daily objectives."""
    return int(hashlib.sha256(date_str.encode()).hexdigest()[:8], 16)


def _week_start(dt: datetime) -> datetime:
    """Monday 00:00 UTC as start of week."""
    d = dt.date()
    # Monday = 0
    days_since_monday = (d.weekday()) % 7
    start = d - timedelta(days=days_since_monday)
    return datetime(start.year, start.month, start.day, tzinfo=timezone.utc)


def _generate_daily_objectives(date_str: str) -> list:
    rng = random.Random(_date_seed(date_str))
    num_objectives = rng.randint(4, 6)
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
    num_objectives = rng.randint(3, 5)
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
        label = t["label"].format(target=target)
        out.append({
            "id": t["id"],
            "progress_key": t["progress_key"],
            "label": label,
            "target": target,
            "reward": reward,
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


async def get_objectives(current_user: dict = Depends(get_current_user)):
    """Get today's and this week's objectives, user progress, and auto-claim when all complete."""
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    week_start = _week_start(now)
    week_start_str = week_start.strftime("%Y-%m-%d")

    user_id = current_user["id"]
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "objectives_daily_date": 1, "objectives_daily_progress": 1, "objectives_daily_claimed": 1,
         "objectives_weekly_start": 1, "objectives_weekly_progress": 1, "objectives_weekly_claimed": 1, "current_state": 1}
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
            {"$set": {"objectives_daily_date": today_str, "objectives_daily_progress": {}, "objectives_daily_claimed": False}}
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
            {"$set": {"objectives_weekly_start": week_start_str, "objectives_weekly_progress": {}, "objectives_weekly_claimed": False}}
        )

    daily_objectives = _generate_daily_objectives(today_str)
    weekly_objectives = _generate_weekly_objectives(week_start_str)
    current_state = (user.get("current_state") or "").strip() or (current_user.get("current_state") or "")

    def build_objective_list(objectives, progress, is_weekly=False):
        result = []
        all_done = True
        total_rewards = {"rank_points": 0, "money": 0, "points": 0}
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

    daily_list, daily_all_done, daily_total_rewards = build_objective_list(daily_objectives, daily_progress)
    weekly_list, weekly_all_done, weekly_total_rewards = build_objective_list(weekly_objectives, weekly_progress, is_weekly=True)

    # Auto-claim daily completion
    daily_claim_reward = None
    if daily_all_done and not daily_claimed:
        daily_claim_reward = {k: v for k, v in daily_total_rewards.items() if v}
        daily_claim_reward["rank_points"] = daily_claim_reward.get("rank_points", 0) + DAILY_COMPLETION_BONUS.get("rank_points", 0)
        daily_claim_reward["money"] = daily_claim_reward.get("money", 0) + DAILY_COMPLETION_BONUS.get("money", 0)
        daily_claim_reward["points"] = daily_claim_reward.get("points", 0) + DAILY_COMPLETION_BONUS.get("points", 0)
        inc = {}
        for k, v in daily_claim_reward.items():
            if k == "money":
                inc["money"] = v
            elif k == "rank_points":
                inc["rank_points"] = v
            elif k == "points":
                inc["points"] = v
        await db.users.update_one({"id": user_id}, {"$set": {"objectives_daily_claimed": True}, "$inc": inc})
        daily_claimed = True

    # Auto-claim weekly completion
    weekly_claim_reward = None
    if weekly_all_done and not weekly_claimed:
        weekly_claim_reward = {k: v for k, v in weekly_total_rewards.items() if v}
        weekly_claim_reward["rank_points"] = weekly_claim_reward.get("rank_points", 0) + WEEKLY_COMPLETION_BONUS.get("rank_points", 0)
        weekly_claim_reward["money"] = weekly_claim_reward.get("money", 0) + WEEKLY_COMPLETION_BONUS.get("money", 0)
        weekly_claim_reward["points"] = weekly_claim_reward.get("points", 0) + WEEKLY_COMPLETION_BONUS.get("points", 0)
        inc = {}
        for k, v in weekly_claim_reward.items():
            if k == "money":
                inc["money"] = v
            elif k == "rank_points":
                inc["rank_points"] = v
            elif k == "points":
                inc["points"] = v
        await db.users.update_one({"id": user_id}, {"$set": {"objectives_weekly_claimed": True}, "$inc": inc})
        weekly_claimed = True

    return {
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
    }


def register(router):
    router.add_api_route("/objectives", get_objectives, methods=["GET"])
