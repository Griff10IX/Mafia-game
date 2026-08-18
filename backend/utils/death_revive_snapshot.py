"""Capture victim estate at PvP/staff kill and restore on Dead > Alive revive (50k pts)."""

from __future__ import annotations

import logging
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

VIP_PASS_CAR_ID = "car22"
EXCLUSIVE_CAR_RARITIES = frozenset({"exclusive", "loot_exclusive"})


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_mongo_id(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    out = dict(doc)
    out.pop("_id", None)
    return out


def _strip_mongo_ids(rows: List[dict]) -> List[dict]:
    return [d for d in (_strip_mongo_id(r) for r in rows) if d]


def _car_info_for(car_id: str) -> Optional[dict]:
    try:
        from server import CARS

        return next((c for c in CARS if c.get("id") == car_id), None)
    except Exception:
        return None


def _is_vip_pass_car(car_id: str, car_info: Optional[dict]) -> bool:
    return car_id == VIP_PASS_CAR_ID or bool(car_info and car_info.get("rarity") == "vip_exclusive")


def _ibm_user_field_names() -> List[str]:
    try:
        from routers.money.illegal_business import IBM_REQUIREMENT_USER_FIELDS

        fields = ["illegal_business_mission_completions", "illegal_business_mission_baselines"]
        for f in IBM_REQUIREMENT_USER_FIELDS.values():
            if f not in fields:
                fields.append(f)
        return fields
    except Exception:
        return ["illegal_business_mission_completions", "illegal_business_mission_baselines"]


def _extract_ibm_user_fields(user: dict) -> dict:
    out: Dict[str, Any] = {}
    for f in _ibm_user_field_names():
        if f in user:
            out[f] = deepcopy(user[f])
    return out


def _lootable_car_rows(victim_cars: List[dict]) -> List[dict]:
    rows: List[dict] = []
    for uc in victim_cars:
        car_id = uc.get("car_id")
        car_info = _car_info_for(str(car_id or ""))
        if _is_vip_pass_car(str(car_id or ""), car_info):
            continue
        doc = _strip_mongo_id(uc)
        if doc:
            rows.append(doc)
    return rows


async def capture_death_revive_snapshot(
    db,
    *,
    victim_id: str,
    killer_id: Optional[str],
    victim_username: str = "",
    victim_prop_rows: Optional[List[dict]] = None,
    victim_cars: Optional[List[dict]] = None,
    victim_user: Optional[dict] = None,
    staff_kill: bool = False,
) -> dict:
    """Deep-copy estate before kill strip. Caller stores result on users.death_revive_snapshot."""
    if victim_prop_rows is None:
        victim_prop_rows = await db.user_properties.find({"user_id": victim_id}).to_list(100)
    if victim_cars is None:
        victim_cars = await db.user_cars.find({"user_id": victim_id}).to_list(500)
    if victim_user is None:
        proj = {"_id": 0}
        for f in _ibm_user_field_names():
            proj[f] = 1
        proj["mission_completions"] = 1
        victim_user = await db.users.find_one({"id": victim_id}, proj) or {}

    victim_biz = await db.illegal_businesses.find_one({"user_id": victim_id}, {"_id": 0})
    guards_snapshot: List[dict] = []
    if victim_biz:
        guards_snapshot = await db.illegal_business_guards.find(
            {"business_id": victim_biz["id"]}, {"_id": 0}
        ).sort("slot_number", 1).to_list(2000)

    victim_ep = await db.exclusive_properties.find_one({"owner_id": victim_id}, {"_id": 0})

    exclusive_weed_strains: List[str] = []
    exclusive_weed_stash: Dict[str, float] = {}
    exclusive_weed_curing: List[dict] = []
    try:
        from utils.weed_empire_exclusive_strains import (
            EXCLUSIVE_WEED_STRAINS_COLLECTION,
            exclusive_grams_in_bags,
            is_exclusive_strain_id,
        )

        excl_rows = await db[EXCLUSIVE_WEED_STRAINS_COLLECTION].find(
            {"owner_id": victim_id},
            {"_id": 0, "strain_id": 1},
        ).to_list(20)
        exclusive_weed_strains = [
            str(r["strain_id"])
            for r in (excl_rows or [])
            if r.get("strain_id") and is_exclusive_strain_id(str(r["strain_id"]))
        ]
        if exclusive_weed_strains:
            farm = await db.weed_farms.find_one(
                {"user_id": victim_id},
                {"_id": 0, "stash": 1, "stash_vault": 1, "curing": 1},
            )
            stash = (farm or {}).get("stash") or {}
            vault = (farm or {}).get("stash_vault") or {}
            exclusive_weed_stash = exclusive_grams_in_bags(
                stash, vault, strain_ids=exclusive_weed_strains
            )
            sid_set = set(exclusive_weed_strains)
            for batch in (farm or {}).get("curing") or []:
                if (batch or {}).get("strain_id") in sid_set:
                    cleaned = _strip_mongo_id(batch) if isinstance(batch, dict) else None
                    if cleaned:
                        exclusive_weed_curing.append(cleaned)
    except Exception:
        logger.exception("death_revive_snapshot exclusive weed capture failed victim=%s", victim_id)

    snapshot: Dict[str, Any] = {
        "victim_id": victim_id,
        "victim_username": victim_username or "",
        "killer_id": killer_id,
        "staff_kill": bool(staff_kill),
        "captured_at": _utc_now_iso(),
        "user_properties": _strip_mongo_ids(victim_prop_rows),
        "lootable_cars": _lootable_car_rows(victim_cars),
        "illegal_business": _strip_mongo_id(victim_biz),
        "illegal_business_guards": _strip_mongo_ids(guards_snapshot),
        "exclusive_property": _strip_mongo_id(victim_ep),
        "exclusive_weed_strains": exclusive_weed_strains,
        "exclusive_weed_stash": exclusive_weed_stash,
        "exclusive_weed_curing": exclusive_weed_curing,
        "user_ibm_fields": _extract_ibm_user_fields(victim_user),
        "mission_completions": deepcopy(victim_user.get("mission_completions")),
        "car_transfer_outcomes": [],
    }
    return snapshot


async def patch_death_revive_snapshot_car_outcomes(db, victim_id: str, outcomes: List[dict]) -> None:
    if not outcomes:
        return
    await db.users.update_one(
        {"id": victim_id, "death_revive_snapshot": {"$exists": True}},
        {"$set": {"death_revive_snapshot.car_transfer_outcomes": list(outcomes)}},
    )


def _format_restore_summary(summary: dict) -> str:
    parts: List[str] = []
    props = int(summary.get("properties_restored") or 0)
    if props:
        parts.append(f"{props} propert{'y' if props == 1 else 'ies'}")
    if summary.get("illegal_business_restored"):
        parts.append("illegal business")
    cars = int(summary.get("cars_restored") or 0)
    if cars:
        parts.append(f"{cars} car{'s' if cars != 1 else ''}")
    weed_n = int(summary.get("exclusive_weed_restored") or 0)
    if weed_n:
        parts.append(f"{weed_n} weed special{'s' if weed_n != 1 else ''}")
    if summary.get("vip_pass_car_regranted"):
        parts.append("VIP Pass Car")
    if summary.get("exclusive_property_restored"):
        parts.append("Speakeasy")
    skipped = []
    if int(summary.get("properties_skipped") or 0):
        skipped.append(f"{summary['properties_skipped']} properties skipped (conflict)")
    if summary.get("exclusive_property_skipped"):
        skipped.append("Speakeasy skipped (you already own one)")
    cars_missing = int(summary.get("cars_not_found") or 0)
    if cars_missing:
        skipped.append(f"{cars_missing} car(s) no longer with killer (sold/melted)")
    if not parts and not skipped:
        return ""
    text = ", ".join(parts) if parts else "Estate partially restored"
    if skipped:
        text += f" ({'; '.join(skipped)})"
    return text


async def _restore_user_ibm_fields(db, victim_id: str, snap: dict, summary: dict) -> None:
    ibm = snap.get("user_ibm_fields") or {}
    if not ibm:
        return
    await db.users.update_one({"id": victim_id}, {"$set": ibm})
    summary["ibm_fields_restored"] = True

    user = await db.users.find_one({"id": victim_id}, {"_id": 0, "mission_completions": 1})
    mc_snap = snap.get("mission_completions")
    if mc_snap and not (user or {}).get("mission_completions"):
        await db.users.update_one({"id": victim_id}, {"$set": {"mission_completions": mc_snap}})
        summary["mission_completions_restored"] = True


async def _restore_properties(
    db, victim_id: str, killer_id: Optional[str], snap: dict, summary: dict
) -> None:
    """
    Restore victim portfolio from snapshot only.
    Never move rows off the killer — kill clears the victim's deeds for a boost %;
    taking matching property_ids from the killer stole their own portfolio.
    """
    rows = snap.get("user_properties") or []
    if not rows:
        return
    restored = 0
    skipped = 0
    for row in rows:
        pid = row.get("property_id")
        if not pid:
            continue
        existing = await db.user_properties.find_one({"user_id": victim_id, "property_id": pid}, {"_id": 1})
        if existing:
            skipped += 1
            continue
        doc = dict(row)
        doc.pop("_id", None)
        doc["user_id"] = victim_id
        # Fresh row id so we never collide with killer's deed of the same property_id.
        if doc.get("id"):
            doc["id"] = str(uuid.uuid4())
        await db.user_properties.insert_one(doc)
        restored += 1
    summary["properties_restored"] = restored
    summary["properties_skipped"] = skipped


async def _clawback_pending_biz_reward(db, victim_id: str, killer_id: Optional[str], summary: dict) -> bool:
    if not killer_id:
        return False
    killer = await db.users.find_one({"id": killer_id}, {"_id": 0, "pending_illegal_business_rewards": 1})
    pending = list((killer or {}).get("pending_illegal_business_rewards") or [])
    had = any(p.get("victim_id") == victim_id for p in pending)
    if had:
        await db.users.update_one(
            {"id": killer_id},
            {"$pull": {"pending_illegal_business_rewards": {"victim_id": victim_id}}},
        )
        summary["pending_biz_reward_removed"] = True
    return had


async def _revert_killer_biz_takeover_if_needed(
    db, victim_id: str, killer_id: Optional[str], snap: dict, summary: dict
) -> None:
    """No-op: killer keeps seized/absorb business; victim restores a separate copy from snapshot."""
    summary["killer_biz_takeover_kept"] = True


async def _restore_illegal_business(db, victim_id: str, snap: dict, summary: dict) -> None:
    biz = snap.get("illegal_business")
    if not biz:
        return
    existing = await db.illegal_businesses.find_one({"user_id": victim_id}, {"_id": 0, "id": 1})
    if existing:
        summary["illegal_business_skipped"] = True
        return
    biz_doc = dict(biz)
    biz_doc.pop("_id", None)
    old_biz_id = biz_doc.get("id")
    need_new_ids = False
    if old_biz_id:
        held = await db.illegal_businesses.find_one({"id": old_biz_id}, {"_id": 0, "user_id": 1})
        if held and held.get("user_id") != victim_id:
            need_new_ids = True
        elif held and held.get("user_id") == victim_id:
            summary["illegal_business_skipped"] = True
            return
    else:
        need_new_ids = True

    biz_id = str(uuid.uuid4()) if need_new_ids else old_biz_id
    biz_doc["id"] = biz_id
    biz_doc["user_id"] = victim_id
    biz_doc.pop("seized_from_user_id", None)
    await db.illegal_businesses.insert_one(biz_doc)
    for g in snap.get("illegal_business_guards") or []:
        gd = dict(g)
        gd.pop("_id", None)
        gd["id"] = str(uuid.uuid4()) if need_new_ids else (gd.get("id") or str(uuid.uuid4()))
        gd["business_id"] = biz_id
        await db.illegal_business_guards.insert_one(gd)
    summary["illegal_business_restored"] = True
    if need_new_ids:
        summary["illegal_business_new_id"] = True


async def _restore_exclusive_weed(db, victim_id: str, killer_id: Optional[str], snap: dict, summary: dict) -> None:
    strain_ids = list(snap.get("exclusive_weed_strains") or [])
    stash = snap.get("exclusive_weed_stash") or {}
    if not strain_ids and not stash:
        return
    try:
        from utils.weed_empire_exclusive_strains import restore_exclusive_weed_strains_on_revive

        restored = await restore_exclusive_weed_strains_on_revive(
            db,
            victim_id=victim_id,
            killer_id=killer_id,
            strain_ids=strain_ids or None,
            exclusive_stash=stash if isinstance(stash, dict) else None,
            notify=True,
        )
        summary["exclusive_weed_restored"] = len(restored)
        summary["exclusive_weed_strain_ids"] = restored
    except Exception:
        logger.exception("death_revive exclusive weed restore failed victim=%s", victim_id)
        summary["exclusive_weed_error"] = True


async def _ensure_vip_pass_car_on_revive(db, victim_id: str, summary: dict) -> None:
    """If revived user was VIP-car eligible/granted but has zero car22, re-grant one."""
    try:
        from utils.game_pass_vip_car import ensure_vip_pass_car_on_revive

        granted = await ensure_vip_pass_car_on_revive(db, user_id=victim_id)
        if granted:
            summary["vip_pass_car_regranted"] = True
    except Exception:
        logger.exception("death_revive VIP car ensure failed victim=%s", victim_id)


async def _restore_exclusive_property(
    db, victim_id: str, killer_id: Optional[str], snap: dict, summary: dict
) -> None:
    ep = snap.get("exclusive_property")
    if not ep:
        return
    victim_ep = await db.exclusive_properties.find_one({"owner_id": victim_id}, {"_id": 1})
    if victim_ep:
        summary["exclusive_property_skipped"] = True
        return
    ep_type = ep.get("type") or "speakeasy"
    if killer_id:
        killer_ep = await db.exclusive_properties.find_one({"owner_id": killer_id, "type": ep_type}, {"_id": 1})
        if killer_ep:
            await db.exclusive_properties.update_one(
                {"owner_id": killer_id, "type": ep_type},
                {"$set": {"owner_id": victim_id}},
            )
            summary["exclusive_property_restored"] = True
            return
    unowned = await db.exclusive_properties.find_one(
        {"owner_id": None, "type": ep_type}, {"_id": 1}
    )
    if unowned:
        await db.exclusive_properties.update_one(
            {"owner_id": None, "type": ep_type},
            {"$set": {"owner_id": victim_id}},
        )
        summary["exclusive_property_restored"] = True
        return
    # Killer already had their own speakeasy at kill time — victim's was orphaned (owner_id None).
    orphan = await db.exclusive_properties.find_one({"type": ep_type, "owner_id": {"$in": [None, ""]}}, {"_id": 1})
    if orphan:
        await db.exclusive_properties.update_one(
            {"_id": orphan["_id"]},
            {"$set": {"owner_id": victim_id}},
        )
        summary["exclusive_property_restored"] = True


async def _clawback_cars_from_killer(
    db, victim_id: str, killer_id: Optional[str], snap: dict, summary: dict
) -> None:
    if not killer_id:
        return
    outcomes = snap.get("car_transfer_outcomes") or []
    lootable = snap.get("lootable_cars") or []
    restored = 0
    not_found = 0

    async def _transfer_row_to_victim(row: dict, car_id: str, is_exclusive: bool) -> bool:
        nonlocal restored
        new_id = str(uuid.uuid4()) if is_exclusive else row.get("id") or str(uuid.uuid4())
        await db.user_cars.update_one(
            {"_id": row["_id"]},
            {
                "$set": {"user_id": victim_id, "id": new_id},
                "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""},
            },
        )
        restored += 1
        if is_exclusive:
            try:
                from utils.exclusive_car_events import log_exclusive_car_event

                car_info = _car_info_for(car_id)
                await log_exclusive_car_event(
                    db,
                    event_type="revive_estate_restore",
                    car_id=car_id,
                    user_car_id=new_id,
                    previous_user_car_id=row.get("id"),
                    from_user_id=killer_id,
                    to_user_id=victim_id,
                    car_name=(car_info or {}).get("name"),
                )
            except Exception:
                logger.exception("exclusive car event on revive restore victim=%s", victim_id)
        return True

    if outcomes:
        for oc in outcomes:
            if oc.get("destroyed"):
                not_found += 1
                continue
            car_id = str(oc.get("car_id") or "")
            car_info = _car_info_for(car_id)
            is_exclusive = bool(car_info and car_info.get("rarity") in EXCLUSIVE_CAR_RARITIES)
            killer_car_id = oc.get("user_car_id") or oc.get("killer_user_car_id")
            if not killer_car_id and not is_exclusive:
                killer_car_id = oc.get("previous_user_car_id")
            row = None
            if killer_car_id:
                row = await db.user_cars.find_one({"user_id": killer_id, "id": killer_car_id})
            if not row and car_id:
                row = await db.user_cars.find_one({"user_id": killer_id, "car_id": car_id})
            if not row:
                not_found += 1
                continue
            await _transfer_row_to_victim(row, car_id, is_exclusive)
    elif lootable:
        for lc in lootable:
            car_id = str(lc.get("car_id") or "")
            car_info = _car_info_for(car_id)
            is_exclusive = bool(car_info and car_info.get("rarity") in EXCLUSIVE_CAR_RARITIES)
            orig_id = lc.get("id")
            row = None
            if orig_id and not is_exclusive:
                row = await db.user_cars.find_one({"user_id": killer_id, "id": orig_id})
            if not row and car_id:
                row = await db.user_cars.find_one({"user_id": killer_id, "car_id": car_id})
            if not row:
                not_found += 1
                continue
            await _transfer_row_to_victim(row, car_id, is_exclusive)

    summary["cars_restored"] = restored
    summary["cars_not_found"] = not_found


async def restore_death_revive_snapshot(db, *, victim_id: str) -> dict:
    """
    One-time restore from users.death_revive_snapshot. Does not roll back revive on partial failure.
    Archives snapshot, then clears the live field after the restore attempt.
    Killer keeps any seized illegal business; victim gets a restored copy (new ids if needed).
    """
    user = await db.users.find_one({"id": victim_id}, {"_id": 0, "death_revive_snapshot": 1, "username": 1})
    snap = (user or {}).get("death_revive_snapshot")
    if not snap:
        return {"restored": False, "reason": "no_snapshot", "summary_text": ""}

    killer_id = snap.get("killer_id")
    summary: Dict[str, Any] = {"restored": True, "victim_id": victim_id}

    # Archive before mutating so auto-heal / admin can recover if restore fails mid-way.
    archive_entry = deepcopy(snap) if isinstance(snap, dict) else {"raw": snap}
    archive_entry["archived_at"] = _utc_now_iso()
    archive_entry["archive_reason"] = "revive_restore"
    try:
        await db.users.update_one(
            {"id": victim_id},
            {
                "$push": {
                    "death_revive_snapshot_archive": {
                        "$each": [archive_entry],
                        "$slice": -10,
                    }
                }
            },
        )
        summary["snapshot_archived"] = True
    except Exception:
        logger.exception("death_revive_snapshot archive failed victim=%s", victim_id)

    try:
        await _clawback_pending_biz_reward(db, victim_id, killer_id, summary)
        # Killer keeps takeover/absorb; do not delete their seized biz.
        await _revert_killer_biz_takeover_if_needed(db, victim_id, killer_id, snap, summary)
        await _restore_illegal_business(db, victim_id, snap, summary)
        await _restore_properties(db, victim_id, killer_id, snap, summary)
        await _restore_exclusive_property(db, victim_id, killer_id, snap, summary)
        await _clawback_cars_from_killer(db, victim_id, killer_id, snap, summary)
        await _restore_exclusive_weed(db, victim_id, killer_id, snap, summary)
        await _restore_user_ibm_fields(db, victim_id, snap, summary)
        await _ensure_vip_pass_car_on_revive(db, victim_id, summary)
    except Exception:
        logger.exception("death_revive_snapshot restore failed victim=%s", victim_id)
        summary["error"] = True

    summary["summary_text"] = _format_restore_summary(summary)
    # Only clear live snapshot after the attempt; archive is retained for heal.
    await db.users.update_one({"id": victim_id}, {"$unset": {"death_revive_snapshot": ""}})
    return summary
