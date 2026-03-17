# Ranking Achievements / Badges - tiered milestones from early game to 5M+ crimes
# Badge events are written to db.badge_events for flash news ticker

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends

BADGE_CATEGORIES = [
    {
        "id": "crimes",
        "name": "Crimes",
        "progress_key": "total_crimes",
        "targets": [100, 250, 500, 750, 1000, 1500, 2500, 4000, 5000, 7500, 10000, 15000, 25000, 35000, 50000, 75000, 100000, 150000, 250000, 400000, 500000, 750000, 1_000_000, 1_500_000, 2_500_000, 4_000_000, 5_000_000, 7_500_000, 10_000_000, 15_000_000],
    },
    {
        "id": "gta",
        "name": "GTA",
        "progress_key": "total_gta",
        "targets": [25, 50, 100, 200, 250, 400, 500, 750, 1000, 1500, 2500, 4000, 5000, 7500, 10000, 15000, 25000, 40000, 50000, 75000, 100000, 150000, 250000, 500000, 1_000_000],
    },
    {
        "id": "jail_busts",
        "name": "Jail Busts",
        "progress_key": "jail_busts",
        "targets": [10, 25, 50, 75, 100, 150, 250, 400, 500, 750, 1000, 1500, 2500, 4000, 5000, 7500, 10000, 15000, 25000, 40000, 50000, 75000, 100000, 250000, 500000, 1_000_000],
    },
    {
        "id": "kills",
        "name": "Kills",
        "progress_key": "total_kills",
        "targets": [1, 3, 5, 10, 15, 25, 40, 50, 75, 100, 150, 250, 400, 500, 750, 1000, 1500, 2500, 5000, 7500, 10000, 25000, 50000, 100000],
    },
    {
        "id": "oc_heists",
        "name": "OC Heists",
        "progress_key": "total_oc_heists",
        "targets": [5, 10, 20, 25, 40, 50, 75, 100, 150, 250, 400, 500, 750, 1000, 1500, 2500, 4000, 5000, 7500, 10000, 25000, 50000, 100000],
    },
    {
        "id": "bullets_melted",
        "name": "Bullets Melted",
        "progress_key": "bullets_melted",
        "targets": [500, 1000, 2500, 5000, 7500, 10000, 15000, 25000, 40000, 50000, 75000, 100000, 150000, 250000, 400000, 500000, 750000, 1_000_000, 1_500_000, 2_500_000, 5_000_000],
    },
    {
        "id": "booze_runs",
        "name": "Booze Runs",
        "progress_key": "booze_runs_count",
        "targets": [5, 10, 20, 25, 40, 50, 75, 100, 150, 250, 400, 500, 750, 1000, 1500, 2500, 4000, 5000, 7500, 10000, 25000, 50000, 100000],
    },
    {
        "id": "hitlist_npc",
        "name": "Hitlist NPC Kills",
        "progress_key": "hitlist_npc_kills",
        "targets": [5, 10, 15, 25, 40, 50, 75, 100, 150, 250, 400, 500, 750, 1000, 1500, 2500, 4000, 5000, 7500, 10000],
    },
]

# Benefit labels for bonus categories (excludes rank)
BONUS_BENEFITS = {
    "crimes": "Crime payout",
    "gta": "GTA rarity boost",
    "jail_busts": "Jail bust success",
    "oc_heists": "OC heist payout",
    "kills": "Attacker: fewer bullets / Victim: more to survive",
    "bullets_melted": "Melt cooldown reduction",
    "booze_runs": "Booze profit",
    "hitlist_npc": "Hitlist NPC rewards",
}


def compute_profile_badges(user: dict) -> list:
    """Return current (highest) badge per category for profile display (no DB call needed)."""
    result = []
    for cat in BADGE_CATEGORIES:
        progress = int(user.get(cat["progress_key"]) or 0)
        unlocked = [t for t in sorted(cat["targets"]) if progress >= t]
        if not unlocked:
            continue
        result.append({
            "id": cat["id"],
            "name": cat["name"],
            "current_target": max(unlocked),
            "unlocked_count": len(unlocked),
            "total_tiers": len(cat["targets"]),
        })
    return result


async def get_badge_bonuses(user_id: str) -> dict:
    """Return unlocked tier count per bonus category (excludes rank). Keys: crimes, gta, jail_busts, kills, oc_heists, bullets_melted, booze_runs, hitlist_npc. Also includes prestige_badge_mult (1 + 0.5% per prestige level) to scale badge effects."""
    from server import db
    u = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "total_crimes": 1, "total_gta": 1, "jail_busts": 1, "total_kills": 1,
            "total_oc_heists": 1, "bullets_melted": 1, "booze_runs_count": 1,
            "hitlist_npc_kills": 1, "rank_points": 1, "prestige_level": 1,
        },
    )
    user = u or {}
    out = {}
    for cat in BADGE_CATEGORIES:
        computed = _compute_category(cat, user)
        out[cat["id"]] = computed["unlocked_count"]
    prestige_level = int(user.get("prestige_level") or 0)
    out["prestige_badge_mult"] = 1 + prestige_level * 0.005
    return out


def _fmt(target: int, key: str = "") -> str:
    """Format target for display."""
    if target >= 1_000_000:
        return f"{target // 1_000_000}M"
    if target >= 1000:
        return f"{target // 1000}K"
    return str(target)


async def log_badge_events(
    user_id: str,
    category_id: str,
    tier_targets: List[int],
    username: Optional[str] = None,
) -> None:
    """Write one badge_event per tier to db.badge_events for flash news. Call when a user crosses new achievement tiers (e.g. from _award_crime_milestones)."""
    if not tier_targets:
        return
    from server import db
    if username is None:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        username = (u or {}).get("username") or "Someone"
    cat = next((c for c in BADGE_CATEGORIES if c["id"] == category_id), None)
    category_name = cat.get("name", category_id) if cat else category_id
    now = datetime.now(timezone.utc)
    created_at = now.isoformat()
    for tier in tier_targets:
        tier_label = _fmt(tier)
        try:
            await db.badge_events.insert_one({
                "user_id": user_id,
                "username": username,
                "category_id": category_id,
                "category_name": category_name,
                "tier_target": tier,
                "tier_label": tier_label,
                "created_at": created_at,
            })
        except Exception:
            pass


def _compute_category(cat: dict, user: dict) -> dict:
    """Compute badge state for one category."""
    key = cat["progress_key"]
    progress = int(user.get(key) or 0)

    targets = sorted(cat["targets"])
    unlocked = [t for t in targets if progress >= t]
    next_target = next((t for t in targets if t > progress), None)

    prev_target = unlocked[-1] if unlocked else 0
    if next_target is not None:
        segment = next_target - prev_target
        current_in_segment = progress - prev_target
        percent_to_next = min(100, int(100 * current_in_segment / segment)) if segment > 0 else 0
    else:
        percent_to_next = 100

    tiers = []
    for t in targets:
        tiers.append({
            "target": t,
            "label": _fmt(t, key),
            "unlocked": progress >= t,
        })

    return {
        "id": cat["id"],
        "name": cat["name"],
        "progress": progress,
        "progress_display": _fmt(progress, key),
        "unlocked_count": len(unlocked),
        "total_tiers": len(targets),
        "next_target": next_target,
        "next_target_label": _fmt(next_target, key) if next_target is not None else None,
        "percent_to_next": percent_to_next,
        "tiers": tiers,
    }


def register(router):
    from server import db, get_current_user

    @router.get("/achievements/me")
    async def get_achievements_me(current_user: dict = Depends(get_current_user)):
        """Return badge progress for current user. Grouped by category."""
        uid = current_user.get("id") or ""
        u = await db.users.find_one(
            {"id": uid},
            {
                "_id": 0,
                "total_crimes": 1, "total_gta": 1, "jail_busts": 1, "total_kills": 1,
                "total_oc_heists": 1, "bullets_melted": 1, "booze_runs_count": 1,
                "hitlist_npc_kills": 1, "rank_points": 1, "prestige_level": 1,
            },
        )
        user = u or {}

        categories = []
        total_unlocked = 0
        total_tiers = 0
        for cat in BADGE_CATEGORIES:
            computed = _compute_category(cat, user)
            categories.append(computed)
            total_unlocked += computed["unlocked_count"]
            total_tiers += computed["total_tiers"]

        bonuses = []
        for cat_id, benefit in BONUS_BENEFITS.items():
            cat_data = next((c for c in categories if c["id"] == cat_id), None)
            if cat_data:
                n = cat_data["unlocked_count"]
                bonuses.append({
                    "id": cat_id,
                    "unlocked_count": n,
                    "bonus_pct": round(n * 0.1, 1),
                    "benefit": benefit,
                })

        return {
            "categories": categories,
            "total_unlocked": total_unlocked,
            "total_tiers": total_tiers,
            "bonuses": bonuses,
        }
