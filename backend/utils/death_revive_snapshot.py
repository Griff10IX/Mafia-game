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
    rows = snap.get("user_properties") or []
    if not rows:
        return
    restored = 0
    skipped = 0
    seizer_id = killer_id
    for row in rows:
        pid = row.get("property_id")
        if not pid:
            continue
        existing = await db.user_properties.find_one({"user_id": victim_id, "property_id": pid}, {"_id": 1})
        if existing:
            skipped += 1
            continue
        moved = False
        if seizer_id:
            seizer_row = await db.user_properties.find_one(
                {"user_id": seizer_id, "property_id": pid}, {"_id": 1}
            )
            if seizer_row:
                await db.user_properties.update_one({"_id": seizer_row["_id"]}, {"$set": {"user_id": victim_id}})
                restored += 1
                moved = True
        if not moved:
            doc = dict(row)
            doc.pop("_id", None)
            doc["user_id"] = victim_id
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
    if not killer_id or not snap.get("illegal_business"):
        return
    seized = await db.illegal_businesses.find_one(
        {"user_id": killer_id, "seized_from_user_id": victim_id}, {"_id": 0, "id": 1}
    )
    if not seized:
        return
    biz_id = seized["id"]
    await db.illegal_business_guards.delete_many({"business_id": biz_id})
    await db.illegal_businesses.delete_one({"id": biz_id})
    summary["killer_biz_takeover_reverted"] = True


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
    biz_id = biz_doc.get("id") or str(uuid.uuid4())
    biz_doc["id"] = biz_id
    biz_doc["user_id"] = victim_id
    biz_doc.pop("seized_from_user_id", None)
    await db.illegal_businesses.insert_one(biz_doc)
    for g in snap.get("illegal_business_guards") or []:
        gd = dict(g)
        gd.pop("_id", None)
        gd["id"] = gd.get("id") or str(uuid.uuid4())
        gd["business_id"] = biz_id
        await db.illegal_business_guards.insert_one(gd)
    summary["illegal_business_restored"] = True


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
    Clears snapshot after attempt.
    """
    user = await db.users.find_one({"id": victim_id}, {"_id": 0, "death_revive_snapshot": 1, "username": 1})
    snap = (user or {}).get("death_revive_snapshot")
    if not snap:
        return {"restored": False, "reason": "no_snapshot", "summary_text": ""}

    killer_id = snap.get("killer_id")
    summary: Dict[str, Any] = {"restored": True, "victim_id": victim_id}

    try:
        await _clawback_pending_biz_reward(db, victim_id, killer_id, summary)
        await _revert_killer_biz_takeover_if_needed(db, victim_id, killer_id, snap, summary)
        await _restore_illegal_business(db, victim_id, snap, summary)
        await _restore_properties(db, victim_id, killer_id, snap, summary)
        await _restore_exclusive_property(db, victim_id, killer_id, snap, summary)
        await _clawback_cars_from_killer(db, victim_id, killer_id, snap, summary)
        await _restore_user_ibm_fields(db, victim_id, snap, summary)
    except Exception:
        logger.exception("death_revive_snapshot restore failed victim=%s", victim_id)
        summary["error"] = True

    summary["summary_text"] = _format_restore_summary(summary)
    await db.users.update_one({"id": victim_id}, {"$unset": {"death_revive_snapshot": ""}})
    return summary
