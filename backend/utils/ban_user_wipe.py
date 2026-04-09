"""
Account-ban helpers: enforce db.bans on auth, and wipe progression when a user is banned.

Does NOT modify ip_bans (preserves IP, reason, banned_by, source_username, etc.).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict


async def user_has_active_account_ban(db, user_id: str) -> bool:
    """True if there is an active ban row for this user and (if timed) it has not expired."""
    if not user_id:
        return False
    now = datetime.now(timezone.utc)
    cursor = db.bans.find({"user_id": user_id, "active": True}, {"_id": 0, "expires_at": 1})
    async for b in cursor:
        exp = b.get("expires_at")
        if not exp:
            return True
        try:
            raw = str(exp).replace("Z", "+00:00")
            exp_dt = datetime.fromisoformat(raw)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            if exp_dt > now:
                return True
        except Exception:
            return True
    return False


async def wipe_user_for_account_ban(db, user_id: str) -> Dict[str, Any]:
    """
    Remove leaderboard rows, minigame history, inventories, and reset core user stats.
    Keeps the users document (id, username, email, password) for audit; does not touch ip_bans.
    """
    uid = (user_id or "").strip()
    if not uid:
        return {"error": "missing user_id"}

    deleted: Dict[str, int] = {}

    # --- Minigames (same collections as /admin/minigames/clear-user-records) ---
    collections = {
        "snake_scores": db.snake_scores,
        "family_run_scores": db.family_run_scores,
        "whack_a_copper_scores": db.whack_a_copper_scores,
        "gauntlet_scores": db.gauntlet_scores,
        "shooting_range_scores": db.shooting_range_scores,
        "mafia_rpg_scores": db.mafia_rpg_scores,
        "minesweeper_wins": db.minesweeper_wins,
        "battleships_wins": db.battleships_wins,
        "the_getaway_runs": db.the_getaway_runs,
        "minigame_plays": db.minigame_plays,
        "minigame_run_sessions": db.minigame_run_sessions,
    }
    for key, coll in collections.items():
        if coll is None:
            continue
        r = await coll.delete_many({"user_id": uid})
        deleted[key] = int(r.deleted_count or 0)

    # --- Racing / boxing / pool profiles ---
    for key, attr in (
        ("racing_profiles", "racing_profiles"),
        ("user_racing_cars", "user_racing_cars"),
        ("boxing_profiles", "boxing_profiles"),
        ("pool_profiles", "pool_profiles"),
    ):
        coll = getattr(db, attr, None)
        if coll is not None:
            r = await coll.delete_many({"user_id": uid})
            deleted[key] = int(r.deleted_count or 0)

    # --- Respect / meta ---
    if getattr(db, "respect_events", None) is not None:
        r = await db.respect_events.delete_many({"user_id": uid})
        deleted["respect_events"] = int(r.deleted_count or 0)
    if getattr(db, "user_meta", None) is not None:
        r = await db.user_meta.delete_many({"user_id": uid})
        deleted["user_meta"] = int(r.deleted_count or 0)
    for key in ("economy_events", "gambling_log", "security_flags"):
        coll = getattr(db, key, None)
        if coll is not None:
            r = await coll.delete_many({"user_id": uid})
            deleted[key] = int(r.deleted_count or 0)
    if getattr(db, "daily_rewards_ttt", None) is not None:
        r = await db.daily_rewards_ttt.delete_many({"user_id": uid})
        deleted["daily_rewards_ttt"] = int(r.deleted_count or 0)

    # --- Same satellite cleanup as admin delete-user (user row kept) ---
    if getattr(db, "family_members", None) is not None:
        r = await db.family_members.delete_many({"user_id": uid})
        deleted["family_members"] = int(r.deleted_count or 0)
    for key, q in (
        ("bodyguards", {"$or": [{"user_id": uid}, {"bodyguard_user_id": uid}]}),
        ("bodyguard_invites", {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]}),
    ):
        coll = getattr(db, key, None)
        if coll is not None:
            r = await coll.delete_many(q)
            deleted[key] = int(r.deleted_count or 0)

    for key in ("user_cars", "user_properties", "user_weapons"):
        coll = getattr(db, key, None)
        if coll is not None:
            r = await coll.delete_many({"user_id": uid})
            deleted[key] = int(r.deleted_count or 0)

    for key, q in (
        ("attacks", {"$or": [{"attacker_id": uid}, {"target_id": uid}]}),
        ("notifications", {"user_id": uid}),
        ("extortions", {"$or": [{"extorter_id": uid}, {"target_id": uid}]}),
        ("sports_bets", {"user_id": uid}),
        ("blackjack_games", {"user_id": uid}),
        ("dice_buy_back_offers", {"$or": [{"from_owner_id": uid}, {"to_user_id": uid}]}),
        ("slots_buy_back_offers", {"$or": [{"from_owner_id": uid}, {"to_user_id": uid}]}),
        ("interest_deposits", {"user_id": uid}),
        ("family_war_stats", {"user_id": uid}),
    ):
        coll = getattr(db, key, None)
        if coll is not None:
            r = await coll.delete_many(q)
            deleted[key] = int(r.deleted_count or 0)

    if getattr(db, "dice_ownership", None) is not None:
        r = await db.dice_ownership.update_many(
            {"owner_id": uid}, {"$set": {"owner_id": None, "owner_username": None}}
        )
        deleted["dice_ownership_cleared"] = int(r.modified_count or 0)
    if getattr(db, "slots_ownership", None) is not None:
        r = await db.slots_ownership.update_many(
            {"owner_id": uid}, {"$set": {"owner_id": None, "owner_username": None}}
        )
        deleted["slots_ownership_cleared"] = int(r.modified_count or 0)
    if getattr(db, "slots_entries", None) is not None:
        await db.slots_entries.update_many({}, {"$pull": {"user_ids": uid}})

    # --- Reset user document: keep identity fields; strip progression ---
    reset: Dict[str, Any] = {
        "money": 0,
        "points": 0,
        "respect_points": 0,
        "rank": 1,
        "rank_points": 0,
        "health": 100,
        "armour_level": 0,
        "total_crimes": 0,
        "crime_profit": 0,
        "total_kills": 0,
        "total_kills_excludes_npc_v1": True,
        "total_deaths": 0,
        "bullets": 0,
        "molotovs": 0,
        "swiss_balance": 0,
        "casino_profit": 0,
        "property_profit": 0,
        "loot_box_pieces": 0,
        "has_casino_or_property": False,
        "family_id": None,
        "family_role": None,
        "gang_name": None,
        "sessions": [],
        "is_dead": False,
        "dead_at": None,
        "money_at_death": 0,
        "points_at_death": None,
        "killed_by_username": None,
        "killed_by_family_name": None,
        "killer_revealed": False,
        "family_name": None,
        "xp_crimes_tokens": 0,
        "xp_gta_tokens": 0,
        "melt_tokens": 0,
        "oc_reduced_tokens": 0,
        "booze_tokens": 0,
        "racket_tokens": 0,
        "travel_tokens": 0,
        "properties_tokens": 0,
        "jailbust_tokens": 0,
        "rank_xp_pass_tokens": 0,
        "shooting_range_bonus_plays": 0,
        "rank_xp_pass_rewards_granted": False,
        "rank_xp_pass_last_granted_micro_tier": 0,
        "rank_xp_pass_prestige_carry_rp": 0,
    }
    unset_fields = [
        "xp_crimes_until",
        "xp_gta_until",
        "melt_until",
        "oc_reduced_until",
        "booze_until",
        "racket_until",
        "travel_until",
        "properties_until",
        "jailbust_bonus_until",
        "rank_xp_pass_bonus_until",
        "rank_xp_pass_token_expires_at",
        "rank_xp_pass_tier_snapshot",
        "travel_arrives_at",
        "jail_until",
        "account_locked",
        "account_locked_at",
        "account_locked_until",
        "account_locked_comment",
        "account_locked_admin_message",
        "account_locked_user_reply",
    ]
    await db.users.update_one(
        {"id": uid},
        {"$set": reset, "$unset": {k: "" for k in unset_fields}},
    )
    deleted["user_stats_reset"] = 1

    return {"user_id": uid, "deleted": deleted}


async def apply_ban_and_invalidate_sessions(db, user_id: str) -> None:
    """Bump token_version so all JWTs expire; sessions already cleared in wipe."""
    await db.users.update_one({"id": user_id}, {"$inc": {"token_version": 1}})
