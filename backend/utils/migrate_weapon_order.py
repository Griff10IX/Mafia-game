"""
One-time idempotent migration: renumber weapon5-weapon9 so tier order matches
damage (bullets-to-kill). Old schema had Luger as weapon9 after BAR (weapon8).

Updates: user_weapons, users.equipped_weapon_id, user_weapon_mastery,
bullet_factory.weapon_stock and weapon_production_hours.

Then replaces weapon1-weapon10 documents from backend/data/weapons.json.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_WEAPONS_JSON = _BACKEND_ROOT / "data" / "weapons.json"

_REMAP_PHASE1 = {
    "weapon5": "_wtmp_a",
    "weapon6": "_wtmp_b",
    "weapon7": "_wtmp_c",
    "weapon8": "_wtmp_d",
    "weapon9": "_wtmp_e",
}
_REMAP_PHASE2 = {
    "_wtmp_a": "weapon6",
    "_wtmp_b": "weapon7",
    "_wtmp_c": "weapon8",
    "_wtmp_d": "weapon9",
    "_wtmp_e": "weapon5",
}


def _load_standard_weapons_from_json():
    if not _WEAPONS_JSON.is_file():
        logger.warning("migrate_weapon_order: missing %s", _WEAPONS_JSON)
        return []
    with open(_WEAPONS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        return []
    out = []
    for w in data:
        wid = (w.get("id") or "").strip()
        if re.fullmatch(r"weapon\d+", wid):
            out.append(w)
    return out


def _remap_stock_or_hours(d, phase1):
    m = _REMAP_PHASE1 if phase1 else _REMAP_PHASE2
    src = dict(d or {})
    out = {}
    for k, v in src.items():
        nk = m.get(k, k)
        fv = float(v or 0)
        out[nk] = out.get(nk, 0) + fv
    return out


async def migrate_weapon_tier_order_if_needed(db):
    new_ok = await db.weapons.find_one({"id": "weapon5", "name": "Luger P08"})
    if new_ok:
        return
    old_ok = await db.weapons.find_one({"id": "weapon9", "name": "Luger P08"})
    if not old_ok:
        return

    std = _load_standard_weapons_from_json()
    if len(std) != 10:
        logger.error(
            "migrate_weapon_order: expected 10 standard weapons in weapons.json, got %s; aborting",
            len(std),
        )
        return

    logger.info("migrate_weapon_order: remapping weapon5-9 and refreshing weapon definitions")

    for old, tmp in _REMAP_PHASE1.items():
        await db.user_weapons.update_many({"weapon_id": old}, {"$set": {"weapon_id": tmp}})
    for old, tmp in _REMAP_PHASE1.items():
        await db.users.update_many({"equipped_weapon_id": old}, {"$set": {"equipped_weapon_id": tmp}})
    for old, tmp in _REMAP_PHASE1.items():
        await db.user_weapon_mastery.update_many({"weapon_id": old}, {"$set": {"weapon_id": tmp}})

    for tmp, new in _REMAP_PHASE2.items():
        await db.user_weapons.update_many({"weapon_id": tmp}, {"$set": {"weapon_id": new}})
    for tmp, new in _REMAP_PHASE2.items():
        await db.users.update_many({"equipped_weapon_id": tmp}, {"$set": {"equipped_weapon_id": new}})
    for tmp, new in _REMAP_PHASE2.items():
        await db.user_weapon_mastery.update_many({"weapon_id": tmp}, {"$set": {"weapon_id": new}})

    async for fac in db.bullet_factory.find({}, {"_id": 1, "state": 1, "weapon_stock": 1, "weapon_production_hours": 1}):
        ws = fac.get("weapon_stock") or {}
        wh = fac.get("weapon_production_hours") or {}
        if not ws and not wh:
            continue
        nws = _remap_stock_or_hours(_remap_stock_or_hours(ws, True), False)
        nwh = _remap_stock_or_hours(_remap_stock_or_hours(wh, True), False)
        await db.bullet_factory.update_one(
            {"_id": fac["_id"]},
            {"$set": {"weapon_stock": nws, "weapon_production_hours": nwh}},
        )

    await db.weapons.delete_many({"id": {"$regex": r"^weapon\d+$"}})
    await db.weapons.insert_many(std)
    logger.info("migrate_weapon_order: done (user inventories + weapon docs updated)")
