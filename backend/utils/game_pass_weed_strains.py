"""
Per-player permanent Game Pass weed strains (VIP micro-tier rewards).

Stored on users.game_pass_weed_strain_ids (not unique loot exclusives).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

GP_SOUR_DIESEL = "gp_sour_diesel"
GP_GIRL_SCOUT_COOKIES = "gp_girl_scout_cookies"
GP_PURPLE_PUNCH = "gp_purple_punch"
GP_WEDDING_CAKE = "gp_wedding_cake"
GP_GORILLA_GLUE = "gp_gorilla_glue"

GAME_PASS_STRAIN_IDS: tuple = (
    GP_SOUR_DIESEL,
    GP_GIRL_SCOUT_COOKIES,
    GP_PURPLE_PUNCH,
    GP_WEDDING_CAKE,
    GP_GORILLA_GLUE,
)

# VIP micro-tier → strain id (v4 profile only)
GAME_PASS_STRAIN_BY_TIER: Dict[int, str] = {
    20: GP_SOUR_DIESEL,
    28: GP_GIRL_SCOUT_COOKIES,
    35: GP_PURPLE_PUNCH,
    42: GP_WEDDING_CAKE,
    50: GP_GORILLA_GLUE,
}

GAME_PASS_STRAIN_BUFFS: Dict[str, Dict[str, Any]] = {
    GP_SOUR_DIESEL: {
        "label": "+5% ranking (RP)",
        "description": (
            "While you own Sour Diesel, all rank points you earn are increased by 5% "
            "(stacks with active VIP Game Pass +10% RP)."
        ),
        "kind": "rank_points",
    },
    GP_GIRL_SCOUT_COOKIES: {
        "label": "−5% raid success while planted",
        "description": (
            "While Girl Scout Cookies is growing on any of your pots, raiders have 5% lower "
            "success chance against your farm."
        ),
        "kind": "raid_defence_planted",
    },
    GP_PURPLE_PUNCH: {
        "label": "50% heat bust loss",
        "description": (
            "On a heat bust you only lose half your business cash, stash, and curing batches "
            "(equipment is still halved as usual)."
        ),
        "kind": "bust_soft",
    },
    GP_WEDDING_CAKE: {
        "label": "+25% / +15% daily withdraw",
        "description": (
            "Raises your Weed Empire daily personal withdraw cap: +25% while you have active "
            "VIP this season, then +15% permanently once unlocked."
        ),
        "kind": "withdraw_cap",
    },
    GP_GORILLA_GLUE: {
        "label": "−10% upgrade costs",
        "description": (
            "All Weed Empire upgrade costs (equipment, house tiers, and dealers) cost 10% less "
            "business cash while you own Gorilla Glue #4."
        ),
        "kind": "upgrade_discount",
    },
}

# Catalog seed: id, name, type, hours, yield_range, price_mult, bud_mesh
GAME_PASS_STRAIN_SEED: List[tuple] = [
    (GP_SOUR_DIESEL, "Sour Diesel", "sativa", 5.0, (20, 30), 2.2, "airy"),
    (GP_GIRL_SCOUT_COOKIES, "Girl Scout Cookies", "hybrid", 4.5, (22, 34), 2.3, "frosty"),
    (GP_PURPLE_PUNCH, "Purple Punch", "indica", 4.0, (24, 36), 2.25, "dense"),
    (GP_WEDDING_CAKE, "Wedding Cake", "hybrid", 5.0, (22, 32), 2.35, "frosty"),
    (GP_GORILLA_GLUE, "Gorilla Glue #4", "hybrid", 5.5, (26, 38), 2.4, "dense"),
]

GP_RANK_POINTS_BONUS_MULT = 1.05
GP_RAID_SUCCESS_MULT_WHEN_PLANTED = 0.95
GP_UPGRADE_COST_MULT = 0.90
GP_WITHDRAW_MULT_PERMANENT = 1.15
GP_WITHDRAW_MULT_ACTIVE_VIP = 1.25


def is_game_pass_strain_id(strain_id: Optional[str]) -> bool:
    return bool(strain_id) and str(strain_id) in GAME_PASS_STRAIN_IDS


def game_pass_strain_display_name(strain_id: str) -> str:
    for sid, name, *_rest in GAME_PASS_STRAIN_SEED:
        if sid == strain_id:
            return name
    return str(strain_id).replace("gp_", "").replace("_", " ").title()


def owned_game_pass_strain_ids(user: Optional[dict]) -> Set[str]:
    raw = (user or {}).get("game_pass_weed_strain_ids")
    if not isinstance(raw, list):
        return set()
    return {str(x) for x in raw if x and str(x) in GAME_PASS_STRAIN_IDS}


def user_owns_game_pass_strain(user: Optional[dict], strain_id: str) -> bool:
    return strain_id in owned_game_pass_strain_ids(user)


def game_pass_strain_for_micro_tier(micro_tier: int, *, profile_key: str) -> Optional[str]:
    if profile_key != "v4":
        return None
    try:
        t = int(micro_tier or 0)
    except (TypeError, ValueError):
        return None
    return GAME_PASS_STRAIN_BY_TIER.get(t)


async def grant_game_pass_strain(db, user_id: str, strain_id: str) -> bool:
    """Permanently unlock a Game Pass strain for the player. Idempotent."""
    if not user_id or not is_game_pass_strain_id(strain_id):
        return False
    res = await db.users.update_one(
        {"id": user_id},
        {"$addToSet": {"game_pass_weed_strain_ids": strain_id}},
    )
    return int(res.modified_count or 0) > 0 or int(res.matched_count or 0) > 0


async def transfer_game_pass_weed_strains_between_users(
    db,
    *,
    from_user_id: str,
    to_user_id: str,
    from_username: Optional[str] = None,
    to_username: Optional[str] = None,
    notify: bool = True,
    transfer_source: str = "dead_alive_retrieve",
) -> List[str]:
    """
    Move permanent Game Pass weed strains (users.game_pass_weed_strain_ids) from one
    account to another. Used on Claim Inheritance and £10 revive sacrifice.
    Idempotent: no-op when the source has none left.
    """
    if not from_user_id or not to_user_id or from_user_id == to_user_id:
        return []

    src = await db.users.find_one(
        {"id": from_user_id},
        {"_id": 0, "username": 1, "game_pass_weed_strain_ids": 1},
    )
    if not src:
        return []
    if not from_username:
        from_username = src.get("username")
    ids = sorted(owned_game_pass_strain_ids(src))
    if not ids:
        return []

    if not to_username:
        recip = await db.users.find_one({"id": to_user_id}, {"_id": 0, "username": 1})
        to_username = (recip or {}).get("username")

    await db.users.update_one(
        {"id": to_user_id},
        {"$addToSet": {"game_pass_weed_strain_ids": {"$each": ids}}},
    )
    await db.users.update_one(
        {"id": from_user_id},
        {"$pullAll": {"game_pass_weed_strain_ids": ids}},
    )

    if notify:
        try:
            from server import send_notification

            dead_label = (from_username or "your other account").strip() or "your other account"
            names = ", ".join(game_pass_strain_display_name(s) for s in ids)
            if len(ids) == 1:
                body = (
                    f"Your Game Pass Weed Empire strain ({names}) was moved from "
                    f"{dead_label} to this life. Plant it in Weed Empire."
                )
            else:
                body = (
                    f"{len(ids)} Game Pass Weed Empire strains ({names}) were moved from "
                    f"{dead_label} to this life. Plant them in Weed Empire."
                )
            await send_notification(
                to_user_id,
                "Game Pass weed strains transferred",
                body,
                "system",
                category="system",
            )
        except Exception:
            pass

    try:
        await db.game_pass_weed_strain_events.insert_one(
            {
                "event_type": "dead_alive_transfer",
                "transfer_source": transfer_source,
                "from_user_id": from_user_id,
                "from_username": from_username,
                "to_user_id": to_user_id,
                "to_username": to_username,
                "strain_ids": ids,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception:
        pass

    return ids


async def backfill_game_pass_weed_strains_dead_alive(db, *, dry_run: bool = False) -> Dict[str, Any]:
    """
    Find dead accounts that already completed Claim Inheritance but still hold
    Game Pass weed strains; move them to the alive recipient.
    """
    out: Dict[str, Any] = {
        "dry_run": bool(dry_run),
        "dead_with_strains": 0,
        "transferred_users": 0,
        "transferred_strains": 0,
        "skipped": 0,
        "transfers": [],
        "skips": [],
    }
    dead_users = await db.users.find(
        {
            "is_dead": True,
            "game_pass_weed_strain_ids": {
                "$elemMatch": {"$in": list(GAME_PASS_STRAIN_IDS)},
            },
        },
        {"_id": 0, "id": 1, "username": 1, "game_pass_weed_strain_ids": 1},
    ).to_list(5000)
    out["dead_with_strains"] = len(dead_users)

    for dead in dead_users:
        dead_id = dead.get("id")
        if not dead_id:
            continue
        ids = sorted(owned_game_pass_strain_ids(dead))
        if not ids:
            continue
        xfer = await db.dead_alive_transfers.find_one(
            {"event_type": "retrieve", "dead_id": dead_id},
            {"_id": 0, "recipient_id": 1, "recipient_username": 1, "created_at": 1},
            sort=[("created_at", -1)],
        )
        dead_name = dead.get("username") or dead_id
        if not xfer or not xfer.get("recipient_id"):
            # Still dead with strains but no retrieve log — may be unpaid death; skip.
            out["skipped"] += 1
            out["skips"].append({"dead_username": dead_name, "reason": "no_retrieve_log"})
            continue
        recip_id = xfer["recipient_id"]
        recip = await db.users.find_one(
            {"id": recip_id},
            {"_id": 0, "username": 1, "is_dead": 1},
        )
        if not recip or recip.get("is_dead"):
            out["skipped"] += 1
            out["skips"].append({"dead_username": dead_name, "reason": "recipient_missing_or_dead"})
            continue
        entry = {
            "dead_username": dead_name,
            "recipient_username": recip.get("username"),
            "strain_ids": ids,
        }
        if dry_run:
            entry["would_apply"] = True
            out["transfers"].append(entry)
            out["transferred_users"] += 1
            out["transferred_strains"] += len(ids)
            continue
        moved = await transfer_game_pass_weed_strains_between_users(
            db,
            from_user_id=dead_id,
            to_user_id=recip_id,
            from_username=dead_name,
            to_username=recip.get("username"),
            notify=True,
            transfer_source="dead_alive_inheritance_backfill",
        )
        entry["applied"] = bool(moved)
        entry["strain_ids"] = moved
        out["transfers"].append(entry)
        if moved:
            out["transferred_users"] += 1
            out["transferred_strains"] += len(moved)

    return out


PREMATURE_GP_STRAIN_REVOKE_KEY = "game_pass_weed_strains_premature_revoke_v1"


async def revoke_all_game_pass_weed_strains(db) -> Dict[str, Any]:
    """
    Strip Game Pass strain ownership from every user and farm unlock lists.
    Used to undo bulk grants that ran before season 4 purchases started.
    """
    users_with = await db.users.count_documents(
        {
            "game_pass_weed_strain_ids": {
                "$elemMatch": {"$in": list(GAME_PASS_STRAIN_IDS)},
            },
        },
    )
    users_field_exists = await db.users.count_documents(
        {"game_pass_weed_strain_ids": {"$exists": True}},
    )
    sample: List[str] = []
    async for row in db.users.find(
        {
            "game_pass_weed_strain_ids": {
                "$elemMatch": {"$in": list(GAME_PASS_STRAIN_IDS)},
            },
        },
        {"_id": 0, "username": 1, "game_pass_weed_strain_ids": 1},
    ).limit(25):
        sample.append(
            f"{row.get('username') or '?'}={list(row.get('game_pass_weed_strain_ids') or [])}"
        )
    ures = await db.users.update_many(
        {"game_pass_weed_strain_ids": {"$exists": True}},
        {"$unset": {"game_pass_weed_strain_ids": ""}},
    )
    farms_pulled = 0
    for sid in GAME_PASS_STRAIN_IDS:
        fres = await db.weed_farms.update_many(
            {"unlocks": sid},
            {"$pull": {"unlocks": sid}},
        )
        farms_pulled += int(fres.modified_count or 0)
    return {
        "users_had_strains": int(users_with),
        "users_field_exists": int(users_field_exists),
        "users_modified": int(ures.modified_count or 0),
        "farm_unlock_rows_pulled": farms_pulled,
        "sample": sample,
    }


async def maybe_revoke_premature_game_pass_strains_once(db) -> Optional[Dict[str, Any]]:
    """
    One-shot: clear GP strains incorrectly granted via season close-out before players
    could buy season-4 VIP. Idempotent via game_settings stamp.
    """
    doc = await db.game_settings.find_one(
        {"key": PREMATURE_GP_STRAIN_REVOKE_KEY},
        {"_id": 0, "value": 1},
    )
    raw = (doc or {}).get("value")
    if isinstance(raw, dict) and raw.get("done_at"):
        return None
    result = await revoke_all_game_pass_weed_strains(db)
    stamp = {
        "done_at": datetime.now(timezone.utc).isoformat(),
        "set_by": "auto_premature_revoke_v1",
        **result,
    }
    await db.game_settings.update_one(
        {"key": PREMATURE_GP_STRAIN_REVOKE_KEY},
        {"$set": {"key": PREMATURE_GP_STRAIN_REVOKE_KEY, "value": stamp}},
        upsert=True,
    )
    return stamp


def scale_rank_points_for_game_pass_strain(base_rp: int, user: Optional[dict]) -> int:
    """+5% RP while Sour Diesel is owned."""
    try:
        rp = int(base_rp or 0)
    except (TypeError, ValueError):
        return 0
    if rp <= 0 or not user_owns_game_pass_strain(user, GP_SOUR_DIESEL):
        return rp
    return int(round(rp * GP_RANK_POINTS_BONUS_MULT))


def farm_has_strain_planted(farm: Optional[dict], strain_id: str) -> bool:
    if not farm or not strain_id:
        return False
    for p in farm.get("plots") or []:
        if not isinstance(p, dict):
            continue
        if str(p.get("strain_id") or "") != strain_id:
            continue
        state = str(p.get("state") or "")
        if state in ("growing", "ready", "flowering", "vegetative") or p.get("planted_at"):
            if state not in ("empty", ""):
                return True
    return False


def game_pass_buffs_public(owned_ids: Set[str], *, active_vip: bool = False) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for sid in GAME_PASS_STRAIN_IDS:
        if sid not in (owned_ids or set()):
            continue
        buff = GAME_PASS_STRAIN_BUFFS.get(sid) or {}
        label = buff.get("label") or ""
        description = buff.get("description") or label
        if sid == GP_WEDDING_CAKE:
            if active_vip:
                label = "+25% daily withdraw (active VIP)"
                description = (
                    "Your daily personal withdraw cap from the Weed business is +25% while VIP "
                    "Game Pass is active this season. After the pass ends it stays at +15% forever."
                )
            else:
                label = "+15% daily withdraw (permanent)"
                description = (
                    "Your daily personal withdraw cap from the Weed business is permanently "
                    "+15% while you own Wedding Cake."
                )
        out.append(
            {
                "strain_id": sid,
                "name": game_pass_strain_display_name(sid),
                "buff_label": label,
                "buff_description": description,
                "buff_kind": buff.get("kind") or "",
                "active": True,
                "game_pass": True,
            }
        )
    return out
