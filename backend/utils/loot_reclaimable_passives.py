"""
Globally unique loot-box vault relics (cap 1 each).

Live ownership in `loot_reclaimable_passives` — on PvP kill the victim's relics
return to the vault pool (owner cleared). Existing exclusives (weapon/armour/
Speakeasy/SJ/weed) are unchanged elsewhere.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

COLLECTION = "loot_reclaimable_passives"

# Buff keys used by get_reclaimable_passive_mults / callers.
BUFF_CRIME_CASH = "crime_cash_mult"
BUFF_OC_PAYOUT = "oc_payout_mult"
BUFF_CAR_SELL = "car_sell_mult"
BUFF_JAILBUST = "jailbust_success_bonus"  # additive to success rate (0.15 = +15%)
BUFF_IBM_INCOME = "ibm_income_mult"
BUFF_TRAVEL_COST = "travel_cost_mult"
BUFF_WEED_WITHDRAW = "weed_withdraw_cap_mult"
BUFF_KILL_BULLETS = "kill_bullets_mult"
BUFF_BANK_INTEREST = "bank_interest_mult"
BUFF_TRIBUTE_CASH = "tribute_cash_mult"
BUFF_MISSION_REQ = "mission_req_mult"

RECLAIMABLE_PASSIVES: Dict[str, Dict[str, Any]] = {
    "ledger_of_favors": {
        "name": "Ledger of Favors",
        "buff_label": "+10% crime cash",
        "buffs": {BUFF_CRIME_CASH: 1.10},
    },
    "silent_partner": {
        "name": "Silent Partner",
        "buff_label": "+10% OC payout",
        "buffs": {BUFF_OC_PAYOUT: 1.10},
    },
    "chop_shop_seal": {
        "name": "Chop-Shop Seal",
        "buff_label": "+20% car sell value",
        "buffs": {BUFF_CAR_SELL: 1.20},
    },
    "bail_bond_ring": {
        "name": "Bail Bondsman's Ring",
        "buff_label": "+15% jailbust success",
        "buffs": {BUFF_JAILBUST: 0.15},
    },
    "union_card": {
        "name": "Union Card",
        "buff_label": "+10% illegal business / racket income",
        "buffs": {BUFF_IBM_INCOME: 1.10},
    },
    "smugglers_compass": {
        "name": "Smuggler's Compass",
        "buff_label": "−25% airport travel cost",
        "buffs": {BUFF_TRAVEL_COST: 0.75},
    },
    "distributors_badge": {
        "name": "Distributor's Badge",
        "buff_label": "+20% Weed Empire daily withdraw-to-wallet cap",
        "buffs": {BUFF_WEED_WITHDRAW: 1.20},
    },
    "armourers_mark": {
        "name": "Armourer's Mark",
        "buff_label": "−10% bullets needed to kill",
        "buffs": {BUFF_KILL_BULLETS: 0.90},
    },
    "night_deposit_bag": {
        "name": "Night Deposit Bag",
        "buff_label": "+10% bank / Swiss interest",
        "buffs": {BUFF_BANK_INTEREST: 1.10},
    },
    "tribute_medallion": {
        "name": "Tribute Medallion",
        "buff_label": "+10% mission tribute cash; 15% easier missions",
        "buffs": {BUFF_TRIBUTE_CASH: 1.10, BUFF_MISSION_REQ: 0.85},
    },
}

ALL_ITEM_IDS: List[str] = list(RECLAIMABLE_PASSIVES.keys())

_DEFAULT_MULTS: Dict[str, float] = {
    BUFF_CRIME_CASH: 1.0,
    BUFF_OC_PAYOUT: 1.0,
    BUFF_CAR_SELL: 1.0,
    BUFF_JAILBUST: 0.0,
    BUFF_IBM_INCOME: 1.0,
    BUFF_TRAVEL_COST: 1.0,
    BUFF_WEED_WITHDRAW: 1.0,
    BUFF_KILL_BULLETS: 1.0,
    BUFF_BANK_INTEREST: 1.0,
    BUFF_TRIBUTE_CASH: 1.0,
    BUFF_MISSION_REQ: 1.0,
}


def catalog_public() -> List[Dict[str, Any]]:
    """Player-facing list for scarcity UI."""
    out = []
    for item_id, cfg in RECLAIMABLE_PASSIVES.items():
        out.append(
            {
                "id": item_id,
                "name": cfg["name"],
                "buff_label": cfg["buff_label"],
                "cap": 1,
            }
        )
    return out


def item_display_name(item_id: str) -> str:
    return str((RECLAIMABLE_PASSIVES.get(item_id) or {}).get("name") or item_id)


async def ensure_indexes(db) -> None:
    try:
        await db[COLLECTION].create_index("item_id", unique=True)
        await db[COLLECTION].create_index("owner_id")
    except Exception:
        logger.exception("loot_reclaimable_passives index ensure failed")


async def _seed_unclaimed_docs(db) -> None:
    """Ensure one doc per catalog id exists (unowned until granted)."""
    now = datetime.now(timezone.utc).isoformat()
    for item_id in ALL_ITEM_IDS:
        try:
            await db[COLLECTION].update_one(
                {"item_id": item_id},
                {
                    "$setOnInsert": {
                        "item_id": item_id,
                        "owner_id": None,
                        "owner_username": None,
                        "granted_at": None,
                        "created_at": now,
                    }
                },
                upsert=True,
            )
        except Exception:
            logger.exception("seed reclaimable passive failed item_id=%s", item_id)


async def list_unowned_item_ids(db) -> List[str]:
    await _seed_unclaimed_docs(db)
    rows = await db[COLLECTION].find(
        {"item_id": {"$in": ALL_ITEM_IDS}},
        {"_id": 0, "item_id": 1, "owner_id": 1},
    ).to_list(50)
    by_id = {r.get("item_id"): r for r in rows}
    unowned: List[str] = []
    for item_id in ALL_ITEM_IDS:
        doc = by_id.get(item_id)
        if not doc or not str(doc.get("owner_id") or "").strip():
            unowned.append(item_id)
    return unowned


async def user_owned_item_ids(db, user_id: str) -> Set[str]:
    if not user_id:
        return set()
    rows = await db[COLLECTION].find(
        {"owner_id": user_id, "item_id": {"$in": ALL_ITEM_IDS}},
        {"_id": 0, "item_id": 1},
    ).to_list(20)
    return {str(r["item_id"]) for r in rows if r.get("item_id")}


async def user_owns_any(db, user_id: str) -> bool:
    return bool(await user_owned_item_ids(db, user_id))


async def claimed_counts_live(db) -> Dict[str, Dict[str, Any]]:
    """Per-item claimed (0|1) + owner username for status UI."""
    await _seed_unclaimed_docs(db)
    rows = await db[COLLECTION].find(
        {"item_id": {"$in": ALL_ITEM_IDS}},
        {"_id": 0, "item_id": 1, "owner_id": 1, "owner_username": 1},
    ).to_list(50)
    by_id = {r.get("item_id"): r for r in rows}
    out: Dict[str, Dict[str, Any]] = {}
    for item_id, cfg in RECLAIMABLE_PASSIVES.items():
        doc = by_id.get(item_id) or {}
        owned = bool(str(doc.get("owner_id") or "").strip())
        out[item_id] = {
            "id": item_id,
            "name": cfg["name"],
            "buff_label": cfg["buff_label"],
            "claimed": 1 if owned else 0,
            "cap": 1,
            "owner_username": doc.get("owner_username") if owned else None,
        }
    return out


def _merge_buffs_for_ids(ids) -> Dict[str, float]:
    mults = dict(_DEFAULT_MULTS)
    for item_id in ids or []:
        buffs = (RECLAIMABLE_PASSIVES.get(str(item_id)) or {}).get("buffs") or {}
        for k, v in buffs.items():
            if k == BUFF_JAILBUST:
                mults[k] = float(mults.get(k) or 0.0) + float(v)
            elif k in (BUFF_TRAVEL_COST, BUFF_KILL_BULLETS, BUFF_MISSION_REQ):
                mults[k] = float(mults.get(k) or 1.0) * float(v)
            else:
                mults[k] = float(mults.get(k) or 1.0) * float(v)
    return mults


def get_reclaimable_passive_mults_from_user(user: Optional[Dict[str, Any]]) -> Dict[str, float]:
    """Sync helper using denormalized users.loot_reclaimable_passive_ids."""
    ids = (user or {}).get("loot_reclaimable_passive_ids") or []
    if not isinstance(ids, list):
        ids = []
    return _merge_buffs_for_ids(ids)


async def _sync_user_owned_ids(db, user_id: str) -> List[str]:
    ids = sorted(await user_owned_item_ids(db, user_id))
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"loot_reclaimable_passive_ids": ids}},
    )
    return ids


async def grant_to_user(
    db,
    *,
    user_id: str,
    item_id: str,
    username: Optional[str] = None,
    source: str = "loot_box",
) -> Optional[Dict[str, Any]]:
    """Atomically claim an unowned relic. Returns public reward dict or None."""
    if not user_id or item_id not in RECLAIMABLE_PASSIVES:
        return None
    if await user_owns_any(db, user_id):
        return None
    await _seed_unclaimed_docs(db)
    now = datetime.now(timezone.utc).isoformat()
    upd = await db[COLLECTION].update_one(
        {
            "item_id": item_id,
            "$or": [{"owner_id": None}, {"owner_id": {"$exists": False}}, {"owner_id": ""}],
        },
        {
            "$set": {
                "owner_id": user_id,
                "owner_username": (username or "").strip() or None,
                "granted_at": now,
                "grant_source": source,
            }
        },
    )
    if upd.modified_count <= 0:
        check = await db[COLLECTION].find_one({"item_id": item_id, "owner_id": user_id}, {"_id": 0})
        if not check:
            return None
    await _sync_user_owned_ids(db, user_id)
    cfg = RECLAIMABLE_PASSIVES[item_id]
    return {
        "type": "reclaimable_passive",
        "id": item_id,
        "name": cfg["name"],
        "buff_label": cfg["buff_label"],
        "rarity": "loot_exclusive",
        "reward_tier": "loot_exclusive",
    }


async def get_reclaimable_passive_mults(db, user_id: str) -> Dict[str, float]:
    """Merged buff multipliers for a user (identity defaults if none owned)."""
    if not user_id:
        return dict(_DEFAULT_MULTS)
    ids = await user_owned_item_ids(db, user_id)
    return _merge_buffs_for_ids(ids)


async def reclaim_on_kill(
    db,
    *,
    victim_id: str,
    victim_username: Optional[str] = None,
    killer_id: Optional[str] = None,
    send_notification=None,
) -> List[str]:
    """
    Clear ownership of all vault relics held by the victim so they return to the pool.
    Returns list of reclaimed item_ids.
    """
    if not victim_id:
        return []
    owned = await user_owned_item_ids(db, victim_id)
    if not owned:
        return []
    reclaimed: List[str] = []
    for item_id in owned:
        res = await db[COLLECTION].update_one(
            {"item_id": item_id, "owner_id": victim_id},
            {
                "$set": {
                    "owner_id": None,
                    "owner_username": None,
                    "granted_at": None,
                    "reclaimed_at": datetime.now(timezone.utc).isoformat(),
                    "reclaimed_from": victim_id,
                    "reclaimed_from_username": victim_username,
                    "reclaim_killer_id": killer_id,
                }
            },
        )
        if res.modified_count > 0:
            reclaimed.append(item_id)
    if reclaimed:
        try:
            await db.users.update_one(
                {"id": victim_id},
                {"$set": {"loot_reclaimable_passive_ids": []}},
            )
        except Exception:
            logger.exception("clear victim loot_reclaimable_passive_ids failed")
    if reclaimed and send_notification:
        names = ", ".join(item_display_name(i) for i in reclaimed)
        try:
            await send_notification(
                victim_id,
                "Vault relic lost",
                f"{names} returned to the vaults on your death.",
                "system",
            )
        except Exception:
            logger.exception("reclaim notify victim failed")
        if killer_id and killer_id != victim_id:
            try:
                await send_notification(
                    killer_id,
                    "Vault relic returned",
                    f"{names} returned to the vaults (not transferred).",
                    "system",
                )
            except Exception:
                logger.exception("reclaim notify killer failed")
    return reclaimed
