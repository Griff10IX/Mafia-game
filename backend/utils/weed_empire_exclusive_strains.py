"""Loot-exclusive Weed Empire special strains (1 of each game-wide; PvP kill transfer)."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

EXCLUSIVE_WEED_STRAINS_COLLECTION = "exclusive_weed_strains"

EXCLUSIVE_ACAPULCO_GOLD = "exclusive_acapulco_gold"
EXCLUSIVE_SUPER_SILVER_HAZE = "exclusive_super_silver_haze"
EXCLUSIVE_CRITICAL_MASS = "exclusive_critical_mass"
EXCLUSIVE_LA_CONFIDENTIAL = "exclusive_la_confidential"
EXCLUSIVE_GODFATHER_OG = "exclusive_godfather_og"

EXCLUSIVE_STRAIN_IDS: tuple = (
    EXCLUSIVE_ACAPULCO_GOLD,
    EXCLUSIVE_SUPER_SILVER_HAZE,
    EXCLUSIVE_CRITICAL_MASS,
    EXCLUSIVE_LA_CONFIDENTIAL,
    EXCLUSIVE_GODFATHER_OG,
)

EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL = 2
ACAPULCO_GOLD_DAILY_CASH = 25_000_000

EXCLUSIVE_STRAIN_BUFFS: Dict[str, Dict[str, Any]] = {
    EXCLUSIVE_ACAPULCO_GOLD: {
        "label": "+$25,000,000 cash / day",
        "kind": "daily_cash",
        "amount": ACAPULCO_GOLD_DAILY_CASH,
    },
    EXCLUSIVE_SUPER_SILVER_HAZE: {
        "label": "50% faster harvest (all crops)",
        "kind": "grow_speed",
        "mult": 1.5,
    },
    EXCLUSIVE_CRITICAL_MASS: {
        "label": "+50% harvest yield (all crops)",
        "kind": "yield",
        "mult": 1.5,
    },
    EXCLUSIVE_LA_CONFIDENTIAL: {
        "label": "Heat rises 50% slower",
        "kind": "heat",
        "mult": 0.5,
    },
    EXCLUSIVE_GODFATHER_OG: {
        "label": "+50% sell price (all sales)",
        "kind": "market",
        "mult": 1.5,
    },
}

# Catalog seed rows: id, name, type, hours, yield, price_mult, bud_mesh, buff_key
EXCLUSIVE_STRAIN_SEED: List[tuple] = [
    (EXCLUSIVE_ACAPULCO_GOLD, "Acapulco Gold", "sativa", 5.5, (20, 32), 2.4, "frosty"),
    (EXCLUSIVE_SUPER_SILVER_HAZE, "Super Silver Haze", "sativa", 5.0, (18, 28), 2.2, "airy"),
    (EXCLUSIVE_CRITICAL_MASS, "Critical Mass", "indica", 4.5, (28, 42), 2.1, "dense"),
    (EXCLUSIVE_LA_CONFIDENTIAL, "LA Confidential", "indica", 4.0, (18, 28), 2.15, "dense"),
    (EXCLUSIVE_GODFATHER_OG, "Godfather OG", "indica", 5.5, (20, 32), 2.5, "frosty"),
]


def is_exclusive_strain_id(strain_id: Optional[str]) -> bool:
    return bool(strain_id) and str(strain_id) in EXCLUSIVE_STRAIN_IDS


def exclusive_strain_display_name(strain_id: str) -> str:
    for sid, name, *_rest in EXCLUSIVE_STRAIN_SEED:
        if sid == strain_id:
            return name
    return strain_id.replace("exclusive_", "").replace("_", " ").title()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utc_date_str(dt: Optional[datetime] = None) -> str:
    d = dt or _utcnow()
    return d.astimezone(timezone.utc).date().isoformat()


async def ensure_exclusive_weed_strain_indexes(db) -> None:
    try:
        await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].create_index("strain_id", unique=True)
        await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].create_index("owner_id")
    except Exception:
        logger.exception("ensure exclusive_weed_strains indexes failed")


async def get_owned_exclusive_strain_ids(db, user_id: str) -> Set[str]:
    if not user_id:
        return set()
    rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
        {"owner_id": user_id},
        {"_id": 0, "strain_id": 1},
    ).to_list(20)
    return {str(r["strain_id"]) for r in (rows or []) if r.get("strain_id")}


async def list_owned_exclusive_strains(db, user_id: str) -> List[Dict[str, Any]]:
    if not user_id:
        return []
    rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
        {"owner_id": user_id},
        {"_id": 0, "strain_id": 1, "acquired_at": 1, "source": 1},
    ).to_list(20)
    out = []
    for r in rows or []:
        sid = r.get("strain_id")
        if not sid:
            continue
        buff = EXCLUSIVE_STRAIN_BUFFS.get(sid) or {}
        out.append(
            {
                "strain_id": sid,
                "name": exclusive_strain_display_name(sid),
                "buff_label": buff.get("label") or "",
                "buff_kind": buff.get("kind") or "",
                "acquired_at": r.get("acquired_at"),
                "source": r.get("source"),
            }
        )
    out.sort(key=lambda x: (x.get("name") or "").lower())
    return out


async def list_unowned_exclusive_strain_ids(db) -> List[str]:
    owned = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].distinct("strain_id")
    owned_set = {str(x) for x in (owned or []) if x}
    return [sid for sid in EXCLUSIVE_STRAIN_IDS if sid not in owned_set]


async def release_exclusive_weed_strains_to_pool(db, user_id: str) -> List[str]:
    """Delete this player's exclusive strain ownership so they can drop from loot again."""
    uid = (user_id or "").strip()
    if not uid:
        return []
    rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
        {"owner_id": uid},
        {"_id": 0, "strain_id": 1},
    ).to_list(20)
    strain_ids = [str(r["strain_id"]) for r in (rows or []) if r.get("strain_id")]
    if not strain_ids:
        return []
    strain_set = set(strain_ids)
    try:
        farm = await db.weed_farms.find_one({"user_id": uid}, {"_id": 0, "plots": 1, "stash": 1, "curing": 1})
        if farm:
            farm_set: Dict[str, Any] = {}
            if farm.get("plots"):
                plots = []
                changed = False
                for p in farm.get("plots") or []:
                    if p.get("strain_id") in strain_set and p.get("state") in ("growing", "harvest_ready"):
                        plots.append(
                            {
                                "id": p.get("id"),
                                "state": "empty",
                                "strain_id": None,
                                "planted_at": None,
                                "last_watered_at": None,
                                "last_fed_at": None,
                                "quality": 0,
                                "soil_type": None,
                                "medium": None,
                                "stage": None,
                                "progress": 0,
                                "mite_infestation_pct": 0.0,
                                "mite_infested": False,
                            }
                        )
                        changed = True
                    else:
                        plots.append(p)
                if changed:
                    farm_set["plots"] = plots
            stash = dict(farm.get("stash") or {})
            stash_changed = False
            for sid in strain_ids:
                if sid in stash:
                    stash.pop(sid, None)
                    stash_changed = True
            if stash_changed:
                farm_set["stash"] = stash
            curing = list(farm.get("curing") or [])
            kept = [b for b in curing if (b or {}).get("strain_id") not in strain_set]
            if len(kept) != len(curing):
                farm_set["curing"] = kept
            if farm_set:
                await db.weed_farms.update_one({"user_id": uid}, {"$set": farm_set})
    except Exception:
        logger.exception("release exclusive weed farm clear failed user=%s", uid)
    await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].delete_many({"owner_id": uid})
    return strain_ids


async def exclusive_strain_ownership_summary(db) -> Dict[str, Any]:
    rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
        {},
        {"_id": 0, "strain_id": 1, "owner_id": 1, "acquired_at": 1, "source": 1},
    ).to_list(20)
    by_id = {str(r.get("strain_id")): r for r in (rows or []) if r.get("strain_id")}
    owner_ids = sorted({str(r.get("owner_id")) for r in by_id.values() if r.get("owner_id")})
    users = {}
    if owner_ids:
        docs = await db.users.find(
            {"id": {"$in": owner_ids}},
            {"_id": 0, "id": 1, "username": 1},
        ).to_list(len(owner_ids) + 1)
        users = {str(u["id"]): (u.get("username") or "?") for u in (docs or []) if u.get("id")}
    strains = []
    claimed = 0
    for sid in EXCLUSIVE_STRAIN_IDS:
        row = by_id.get(sid)
        oid = (row or {}).get("owner_id")
        if oid:
            claimed += 1
        strains.append(
            {
                "strain_id": sid,
                "name": exclusive_strain_display_name(sid),
                "buff_label": (EXCLUSIVE_STRAIN_BUFFS.get(sid) or {}).get("label") or "",
                "owned": bool(oid),
                "owner_id": oid,
                "owner_username": users.get(str(oid)) if oid else None,
                "acquired_at": (row or {}).get("acquired_at"),
                "source": (row or {}).get("source"),
            }
        )
    return {
        "claimed": claimed,
        "cap": len(EXCLUSIVE_STRAIN_IDS),
        "remaining": max(0, len(EXCLUSIVE_STRAIN_IDS) - claimed),
        "strains": strains,
    }


async def grant_exclusive_weed_strain(
    db,
    *,
    user_id: str,
    strain_id: str,
    source: str = "loot_box",
    username: Optional[str] = None,
    notify: bool = True,
) -> bool:
    """Atomically grant one exclusive strain. Returns False if already claimed or invalid."""
    if not user_id or not is_exclusive_strain_id(strain_id):
        return False
    # Loot boxes: at most one special per player (more only via PvP kill transfer).
    if (source or "loot_box") == "loot_box":
        if await get_owned_exclusive_strain_ids(db, user_id):
            return False
    now_iso = _utcnow().isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "strain_id": strain_id,
        "owner_id": user_id,
        "acquired_at": now_iso,
        "source": source or "loot_box",
    }
    try:
        await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].insert_one(doc)
    except Exception as e:
        # Duplicate key → already claimed
        if "duplicate" in str(e).lower() or getattr(e, "code", None) == 11000:
            return False
        logger.exception("grant_exclusive_weed_strain insert failed strain=%s user=%s", strain_id, user_id)
        return False

    if notify:
        try:
            from server import send_notification

            name = exclusive_strain_display_name(strain_id)
            buff = (EXCLUSIVE_STRAIN_BUFFS.get(strain_id) or {}).get("label") or ""
            await send_notification(
                user_id,
                "Loot exclusive strain",
                (
                    f"You claimed the exclusive strain {name} (1 of 1 in the game). "
                    f"Buff: {buff}. Plant it from Weed Empire at Grower Level "
                    f"{EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL}+. Loot will not grant you another special — "
                    f"get more only by killing holders. Ownership transfers if someone kills you."
                ),
                "reward",
            )
        except Exception:
            logger.exception("exclusive weed strain notify failed user=%s", user_id)
    return True


async def transfer_exclusive_weed_strains_on_kill(
    db,
    *,
    victim_id: str,
    killer_id: str,
    victim_username: Optional[str] = None,
    killer_username: Optional[str] = None,
) -> List[str]:
    """
    Reassign victim's exclusive strains to killer.
    Clears victim growing plots of those strains and moves their exclusive stash/curing to the killer.
    Returns list of transferred strain_ids.
    """
    if not victim_id or not killer_id or victim_id == killer_id:
        return []
    rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
        {"owner_id": victim_id},
        {"_id": 0, "strain_id": 1},
    ).to_list(20)
    transferred: List[str] = []
    for row in rows or []:
        sid = row.get("strain_id")
        if not sid:
            continue
        res = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].update_one(
            {"strain_id": sid, "owner_id": victim_id},
            {
                "$set": {
                    "owner_id": killer_id,
                    "previous_owner_id": victim_id,
                    "transferred_at": _utcnow().isoformat(),
                    "transfer_source": "pvp_kill",
                }
            },
        )
        if int(res.modified_count or 0) <= 0:
            continue
        transferred.append(str(sid))

    if not transferred:
        return []

    stolen_stash_grams: Dict[str, float] = {}
    # Clear victim plots + move exclusive stash/curing to killer.
    try:
        transferred_set = set(transferred)
        victim_farm = await db.weed_farms.find_one(
            {"user_id": victim_id},
            {"_id": 0, "plots": 1, "stash": 1, "curing": 1},
        )
        victim_set: Dict[str, Any] = {}
        if victim_farm:
            if victim_farm.get("plots"):
                plots = []
                plots_changed = False
                for p in victim_farm.get("plots") or []:
                    if p.get("strain_id") in transferred_set and p.get("state") in ("growing", "harvest_ready"):
                        plots.append(
                            {
                                "id": p.get("id"),
                                "state": "empty",
                                "strain_id": None,
                                "planted_at": None,
                                "last_watered_at": None,
                                "last_fed_at": None,
                                "quality": 0,
                                "soil_type": None,
                                "medium": None,
                                "stage": None,
                                "progress": 0,
                                "mite_infestation_pct": 0.0,
                                "mite_infested": False,
                            }
                        )
                        plots_changed = True
                    else:
                        plots.append(p)
                if plots_changed:
                    victim_set["plots"] = plots

            victim_stash = dict(victim_farm.get("stash") or {})
            moved_stash: Dict[str, float] = {}
            for sid in transferred:
                grams = float(victim_stash.get(sid) or 0)
                if grams > 0:
                    moved_stash[sid] = round(grams, 4)
                    stolen_stash_grams[sid] = moved_stash[sid]
                    victim_stash.pop(sid, None)
            if moved_stash:
                victim_set["stash"] = victim_stash

            victim_curing = list(victim_farm.get("curing") or [])
            moved_curing = [b for b in victim_curing if (b or {}).get("strain_id") in transferred_set]
            if moved_curing:
                victim_set["curing"] = [
                    b for b in victim_curing if (b or {}).get("strain_id") not in transferred_set
                ]
                for b in moved_curing:
                    sid = str((b or {}).get("strain_id") or "")
                    grams = float((b or {}).get("grams") or 0)
                    if sid and grams > 0:
                        stolen_stash_grams[sid] = round(
                            float(stolen_stash_grams.get(sid) or 0) + grams, 4
                        )

            if victim_set:
                await db.weed_farms.update_one({"user_id": victim_id}, {"$set": victim_set})

            if moved_stash or moved_curing:
                killer_farm = await db.weed_farms.find_one(
                    {"user_id": killer_id},
                    {"_id": 0, "stash": 1, "curing": 1},
                )
                if killer_farm is None:
                    # Killer may not have opened Weed Empire yet — ensure a farm exists for stash.
                    from routers.money.weed_empire import _get_or_create_farm

                    await _get_or_create_farm(killer_id)
                    killer_farm = await db.weed_farms.find_one(
                        {"user_id": killer_id},
                        {"_id": 0, "stash": 1, "curing": 1},
                    ) or {"stash": {}, "curing": []}

                killer_set: Dict[str, Any] = {}
                if moved_stash:
                    killer_stash = dict((killer_farm or {}).get("stash") or {})
                    for sid, grams in moved_stash.items():
                        killer_stash[sid] = round(float(killer_stash.get(sid) or 0) + grams, 4)
                    killer_set["stash"] = killer_stash
                if moved_curing:
                    killer_curing = list((killer_farm or {}).get("curing") or [])
                    killer_curing.extend(moved_curing)
                    killer_set["curing"] = killer_curing
                if killer_set:
                    await db.weed_farms.update_one({"user_id": killer_id}, {"$set": killer_set})
    except Exception:
        logger.exception(
            "exclusive strain farm loot on kill failed victim=%s killer=%s",
            victim_id,
            killer_id,
        )

    try:
        from server import send_notification

        for sid in transferred:
            name = exclusive_strain_display_name(sid)
            buff = (EXCLUSIVE_STRAIN_BUFFS.get(sid) or {}).get("label") or ""
            grams = float(stolen_stash_grams.get(sid) or 0)
            grams_bit = f" Took {grams:g}g stash." if grams > 0 else ""
            try:
                await send_notification(
                    killer_id,
                    "Exclusive strain taken",
                    f"You took {name} from {victim_username or 'your victim'}. Buff: {buff}.{grams_bit}",
                    "reward",
                )
            except Exception:
                pass
            try:
                await send_notification(
                    victim_id,
                    "Exclusive strain lost",
                    (
                        f"You lost {name} to {killer_username or 'your killer'}."
                        + (f" They took your {grams:g}g stash." if grams > 0 else "")
                    ),
                    "attack",
                    category="attacks",
                )
            except Exception:
                pass
    except Exception:
        logger.exception("exclusive weed strain kill notify failed")

    return transferred


async def transfer_exclusive_weed_strains_between_users(
    db,
    *,
    from_user_id: str,
    to_user_id: str,
    from_username: Optional[str] = None,
    to_username: Optional[str] = None,
    notify: bool = True,
    transfer_source: str = "revive_sacrifice_transfer",
) -> List[str]:
    """
    Move all exclusive weed strains (and exclusive stash/curing) from one account to another.
    Used when a £10 revive sacrifice alt should hand exclusives to the revived character.
    """
    if not from_user_id or not to_user_id or from_user_id == to_user_id:
        return []
    rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
        {"owner_id": from_user_id},
        {"_id": 0, "strain_id": 1},
    ).to_list(20)
    strain_ids = [str(r["strain_id"]) for r in (rows or []) if r.get("strain_id")]
    if not strain_ids:
        return []
    restored = await restore_exclusive_weed_strains_on_revive(
        db,
        victim_id=to_user_id,
        killer_id=from_user_id,
        strain_ids=strain_ids,
        exclusive_stash=None,  # pull whatever exclusive grams the from-user still holds
        notify=False,
    )
    # Tag transfer source for admin/heal visibility
    if restored:
        try:
            await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].update_many(
                {"strain_id": {"$in": restored}, "owner_id": to_user_id},
                {
                    "$set": {
                        "transfer_source": transfer_source,
                        "previous_owner_id": from_user_id,
                    }
                },
            )
        except Exception:
            logger.exception(
                "exclusive weed sacrifice transfer tag failed from=%s to=%s",
                from_user_id,
                to_user_id,
            )
    if notify and restored:
        try:
            from server import send_notification

            names = ", ".join(exclusive_strain_display_name(s) for s in restored)
            await send_notification(
                to_user_id,
                "Exclusive strain transferred",
                (
                    f"{names} moved from {from_username or 'your revive alt'} "
                    f"onto {to_username or 'this account'} with the £10 revive."
                ),
                "reward",
            )
        except Exception:
            logger.exception(
                "exclusive weed sacrifice notify failed from=%s to=%s",
                from_user_id,
                to_user_id,
            )
    return restored


async def restore_exclusive_weed_strains_on_revive(
    db,
    *,
    victim_id: str,
    killer_id: Optional[str] = None,
    strain_ids: Optional[List[str]] = None,
    exclusive_stash: Optional[Dict[str, float]] = None,
    notify: bool = True,
) -> List[str]:
    """
    Claw exclusive weed strains (and optional exclusive stash grams) back to a revived victim.
    Prefer snapshotted strain_ids; fall back to rows with previous_owner_id == victim.
    Always reassigns from whoever currently holds the strain (not only the killer).
    """
    if not victim_id:
        return []
    restored: List[str] = []
    ids: List[str] = []
    if strain_ids:
        ids = [str(s) for s in strain_ids if s and is_exclusive_strain_id(str(s))]
    else:
        rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
            {"previous_owner_id": victim_id},
            {"_id": 0, "strain_id": 1, "owner_id": 1},
        ).to_list(20)
        ids = [str(r["strain_id"]) for r in (rows or []) if r.get("strain_id")]

    for sid in ids:
        # Already on victim — count as restored for stash logic / reporting.
        already = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find_one(
            {"strain_id": sid, "owner_id": victim_id},
            {"_id": 1},
        )
        if already:
            restored.append(sid)
            continue

        update_doc = {
            "$set": {
                "owner_id": victim_id,
                "transferred_at": _utcnow().isoformat(),
                "transfer_source": "revive_estate_restore",
            },
            "$unset": {"previous_owner_id": ""},
        }

        # 1) Prefer claw from killer when known
        matched = False
        if killer_id:
            res = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].update_one(
                {"strain_id": sid, "owner_id": killer_id},
                update_doc,
            )
            matched = int(res.modified_count or 0) > 0

        # 2) previous_owner_id match (any current holder)
        if not matched:
            res2 = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].update_one(
                {"strain_id": sid, "previous_owner_id": victim_id, "owner_id": {"$ne": victim_id}},
                update_doc,
            )
            matched = int(res2.modified_count or 0) > 0

        # 3) Force from whoever holds it (heal / revive when metadata is missing)
        if not matched:
            res3 = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].update_one(
                {"strain_id": sid, "owner_id": {"$ne": victim_id}},
                update_doc,
            )
            matched = int(res3.modified_count or 0) > 0

        if matched:
            restored.append(sid)

    # Move exclusive stash grams from killer farm back to victim (from snapshot amounts if provided).
    stash_map = {str(k): float(v or 0) for k, v in (exclusive_stash or {}).items() if float(v or 0) > 0}
    if not stash_map and restored and killer_id:
        # Take whatever exclusive grams killer still holds for restored strains.
        try:
            kf = await db.weed_farms.find_one({"user_id": killer_id}, {"_id": 0, "stash": 1})
            for sid in restored:
                g = float((kf or {}).get("stash", {}).get(sid) or 0)
                if g > 0:
                    stash_map[sid] = g
        except Exception:
            logger.exception("exclusive weed stash probe on revive failed killer=%s", killer_id)

    if stash_map and killer_id and killer_id != victim_id:
        try:
            killer_farm = await db.weed_farms.find_one(
                {"user_id": killer_id}, {"_id": 0, "stash": 1, "curing": 1}
            )
            victim_farm = await db.weed_farms.find_one(
                {"user_id": victim_id}, {"_id": 0, "stash": 1, "curing": 1}
            )
            if victim_farm is None:
                from routers.money.weed_empire import _get_or_create_farm

                await _get_or_create_farm(victim_id)
                victim_farm = await db.weed_farms.find_one(
                    {"user_id": victim_id}, {"_id": 0, "stash": 1, "curing": 1}
                ) or {"stash": {}, "curing": []}

            if killer_farm is not None:
                k_stash = dict((killer_farm or {}).get("stash") or {})
                v_stash = dict((victim_farm or {}).get("stash") or {})
                moved_any = False
                for sid, want in stash_map.items():
                    have = float(k_stash.get(sid) or 0)
                    take = min(have, float(want or 0)) if have > 0 else 0.0
                    if take <= 0:
                        continue
                    k_stash[sid] = round(have - take, 4)
                    if k_stash[sid] <= 0:
                        k_stash.pop(sid, None)
                    v_stash[sid] = round(float(v_stash.get(sid) or 0) + take, 4)
                    moved_any = True
                k_curing = list((killer_farm or {}).get("curing") or [])
                restored_set = set(restored) | set(stash_map.keys())
                move_c = [b for b in k_curing if (b or {}).get("strain_id") in restored_set]
                keep_c = [b for b in k_curing if (b or {}).get("strain_id") not in restored_set]
                if moved_any or move_c:
                    v_curing = list((victim_farm or {}).get("curing") or [])
                    if move_c:
                        v_curing.extend(move_c)
                    await db.weed_farms.update_one(
                        {"user_id": killer_id},
                        {"$set": {"stash": k_stash, "curing": keep_c}},
                    )
                    await db.weed_farms.update_one(
                        {"user_id": victim_id},
                        {"$set": {"stash": v_stash, "curing": v_curing}},
                    )
        except Exception:
            logger.exception(
                "exclusive weed stash restore on revive failed victim=%s killer=%s",
                victim_id,
                killer_id,
            )

    if notify and restored:
        try:
            from server import send_notification

            for sid in restored:
                name = exclusive_strain_display_name(sid)
                await send_notification(
                    victim_id,
                    "Exclusive strain restored",
                    f"{name} was returned with your Dead → Alive revive.",
                    "reward",
                )
        except Exception:
            logger.exception("exclusive weed revive notify failed victim=%s", victim_id)

    return restored


def apply_exclusive_stat_bonuses(
    stats: Dict[str, float],
    *,
    owned_ids: Set[str],
    grower_level: int,
) -> Dict[str, float]:
    """Mutate/return stats with exclusive global buffs when grower is high enough."""
    out = dict(stats or {})
    if int(grower_level or 0) < EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL:
        return out
    owned = owned_ids or set()
    if EXCLUSIVE_SUPER_SILVER_HAZE in owned:
        out["grow_speed_mult"] = float(out.get("grow_speed_mult") or 1.0) * 1.5
    if EXCLUSIVE_CRITICAL_MASS in owned:
        out["yield_mult"] = float(out.get("yield_mult") or 1.0) * 1.5
    if EXCLUSIVE_LA_CONFIDENTIAL in owned:
        out["heat_gain_mult"] = float(out.get("heat_gain_mult") or 1.0) * 0.5
    if EXCLUSIVE_GODFATHER_OG in owned:
        out["market_mult_bonus"] = float(out.get("market_mult_bonus") or 1.0) * 1.5
    return out


def exclusive_buffs_public(
    owned_ids: Set[str],
    *,
    grower_level: int,
) -> List[Dict[str, Any]]:
    active = int(grower_level or 0) >= EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL
    out = []
    for sid in EXCLUSIVE_STRAIN_IDS:
        if sid not in (owned_ids or set()):
            continue
        buff = EXCLUSIVE_STRAIN_BUFFS.get(sid) or {}
        out.append(
            {
                "strain_id": sid,
                "name": exclusive_strain_display_name(sid),
                "buff_label": buff.get("label") or "",
                "buff_kind": buff.get("kind") or "",
                "active": active,
                "requires_grower_level": EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL,
            }
        )
    return out


async def maybe_claim_acapulco_gold_daily(
    db,
    *,
    user_id: str,
    farm: dict,
    grower_level: int,
    owned_ids: Set[str],
) -> Optional[Dict[str, Any]]:
    """Credit $25m once per UTC day if Acapulco Gold is owned and grower Lv >= 3."""
    if EXCLUSIVE_ACAPULCO_GOLD not in (owned_ids or set()):
        return None
    if int(grower_level or 0) < EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL:
        return None
    today = _utc_date_str()
    if farm.get("exclusive_acapulco_gold_claimed_utc") == today:
        return None
    try:
        from server import send_notification

        res = await db.users.update_one(
            {"id": user_id},
            {"$inc": {"money": ACAPULCO_GOLD_DAILY_CASH}},
        )
        if int(res.modified_count or 0) <= 0 and int(res.matched_count or 0) <= 0:
            return None
        await db.weed_farms.update_one(
            {"user_id": user_id},
            {"$set": {"exclusive_acapulco_gold_claimed_utc": today}},
        )
        farm["exclusive_acapulco_gold_claimed_utc"] = today
        try:
            await send_notification(
                user_id,
                "Acapulco Gold",
                f"Exclusive strain payout: ${ACAPULCO_GOLD_DAILY_CASH:,} cash credited to your wallet.",
                "reward",
            )
        except Exception:
            pass
        return {"strain_id": EXCLUSIVE_ACAPULCO_GOLD, "cash": ACAPULCO_GOLD_DAILY_CASH, "utc_date": today}
    except Exception:
        logger.exception("acapulco gold daily claim failed user=%s", user_id)
        return None
