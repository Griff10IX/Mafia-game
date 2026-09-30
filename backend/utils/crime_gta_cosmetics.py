"""Secret Crimes/GTA cosmetic drops (profile themes + blackjack backs).

Drop chance is server-side only — never expose as a named rate in API payloads.
Sellable via Quick Trade (points only). Each item has a live player stock of
COSMETIC_MAX_LIVE_COPIES (staff/GhostFace ownership does not consume stock).
Not available from loot boxes.
"""
from __future__ import annotations

import random
from typing import Any, Dict, List, Optional, Tuple

from pymongo import ReturnDocument

# Quiet roll — do not surface this constant in public API fields.
_CRIME_GTA_COSMETIC_CHANCE = 0.0001  # 0.01%

# Max copies in the live player economy per theme/cover (sellable scarcity).
COSMETIC_MAX_LIVE_COPIES = 2

THEME_INVENTORY_FIELD = "profile_theme_inventory"
BACK_INVENTORY_FIELD = "blackjack_back_inventory"

# Points-only Quick Trade floor per copy.
COSMETIC_MIN_POINTS_PER = 50


def _theme_pool() -> Tuple[str, ...]:
    from utils.profile_background_themes import CRIME_GTA_COSMETIC_THEME_IDS

    return CRIME_GTA_COSMETIC_THEME_IDS


def _back_pool() -> Tuple[str, ...]:
    from utils.blackjack_card_backs import CRIME_GTA_COSMETIC_BACK_IDS

    return CRIME_GTA_COSMETIC_BACK_IDS


def crime_gta_cosmetic_pool() -> List[Tuple[str, str]]:
    """Return [(kind, id), ...] for uniform random pick. kind is 'theme' or 'back'."""
    out: List[Tuple[str, str]] = []
    for tid in _theme_pool():
        out.append(("theme", tid))
    for bid in _back_pool():
        out.append(("back", bid))
    return out


def inventory_count(user: Optional[dict], field: str, item_id: str) -> int:
    if not user:
        return 0
    raw = user.get(field)
    if not isinstance(raw, dict):
        return 0
    try:
        return max(0, int(raw.get(item_id) or 0))
    except (TypeError, ValueError):
        return 0


def theme_inventory_count(user: Optional[dict], theme_id: str) -> int:
    return inventory_count(user, THEME_INVENTORY_FIELD, str(theme_id or "").strip().lower())


def back_inventory_count(user: Optional[dict], back_id: str) -> int:
    return inventory_count(user, BACK_INVENTORY_FIELD, str(back_id or "").strip().lower())


def public_inventory_fields(user: Optional[dict]) -> Dict[str, Any]:
    """Self-only inventory maps for Quick Trade / equip UI."""
    if not user:
        return {
            THEME_INVENTORY_FIELD: {},
            BACK_INVENTORY_FIELD: {},
        }
    themes = user.get(THEME_INVENTORY_FIELD) if isinstance(user.get(THEME_INVENTORY_FIELD), dict) else {}
    backs = user.get(BACK_INVENTORY_FIELD) if isinstance(user.get(BACK_INVENTORY_FIELD), dict) else {}
    clean_t = {str(k): max(0, int(v or 0)) for k, v in themes.items() if int(v or 0) > 0}
    clean_b = {str(k): max(0, int(v or 0)) for k, v in backs.items() if int(v or 0) > 0}
    return {
        THEME_INVENTORY_FIELD: clean_t,
        BACK_INVENTORY_FIELD: clean_b,
    }


async def _staff_excluded_ids(db) -> List[Any]:
    """Staff + GhostFace — do not consume the live player stock of 2."""
    from utils.profile_background_themes import _staff_ids_excluded_from_theme_pool

    return await _staff_ids_excluded_from_theme_pool(db)


async def live_cosmetic_copy_totals(db) -> Dict[Tuple[str, str], int]:
    """Sum inventory copies across non-staff players for every crime/GTA cosmetic."""
    theme_set = frozenset(_theme_pool())
    back_set = frozenset(_back_pool())
    totals: Dict[Tuple[str, str], int] = {}
    excluded = await _staff_excluded_ids(db)
    q: Dict[str, Any] = {
        "$or": [
            {THEME_INVENTORY_FIELD: {"$exists": True, "$ne": {}}},
            {BACK_INVENTORY_FIELD: {"$exists": True, "$ne": {}}},
        ]
    }
    if excluded:
        q["id"] = {"$nin": excluded}
    cursor = db.users.find(
        q,
        {"_id": 0, THEME_INVENTORY_FIELD: 1, BACK_INVENTORY_FIELD: 1},
    )
    async for doc in cursor:
        inv_t = doc.get(THEME_INVENTORY_FIELD)
        if isinstance(inv_t, dict):
            for tid, raw in inv_t.items():
                key = str(tid or "").strip().lower()
                if key not in theme_set:
                    continue
                try:
                    n = max(0, int(raw or 0))
                except (TypeError, ValueError):
                    n = 0
                if n:
                    totals[("theme", key)] = totals.get(("theme", key), 0) + n
        inv_b = doc.get(BACK_INVENTORY_FIELD)
        if isinstance(inv_b, dict):
            for bid, raw in inv_b.items():
                key = str(bid or "").strip().lower()
                if key not in back_set:
                    continue
                try:
                    n = max(0, int(raw or 0))
                except (TypeError, ValueError):
                    n = 0
                if n:
                    totals[("back", key)] = totals.get(("back", key), 0) + n
    return totals


async def live_cosmetic_copy_count(db, kind: str, item_id: str) -> int:
    kind = str(kind or "").strip().lower()
    item_id = str(item_id or "").strip().lower()
    field = THEME_INVENTORY_FIELD if kind == "theme" else BACK_INVENTORY_FIELD
    path = f"{field}.{item_id}"
    excluded = await _staff_excluded_ids(db)
    q: Dict[str, Any] = {path: {"$gt": 0}}
    if excluded:
        q["id"] = {"$nin": excluded}
    total = 0
    cursor = db.users.find(q, {"_id": 0, field: 1})
    async for doc in cursor:
        total += inventory_count(doc, field, item_id)
    return total


async def available_crime_gta_cosmetic_pool(db) -> List[Tuple[str, str]]:
    """Pool items still under the live stock cap (for drops only)."""
    totals = await live_cosmetic_copy_totals(db)
    out: List[Tuple[str, str]] = []
    for kind, item_id in crime_gta_cosmetic_pool():
        if totals.get((kind, item_id), 0) < COSMETIC_MAX_LIVE_COPIES:
            out.append((kind, item_id))
    return out


async def grant_cosmetic_copy(
    db,
    user_id: str,
    kind: str,
    item_id: str,
    *,
    bypass_stock: bool = False,
) -> Optional[Dict[str, Any]]:
    """Grant one sellable copy: add to owned set + increment inventory. Duplicates OK.

    Player grants respect COSMETIC_MAX_LIVE_COPIES unless bypass_stock (staff/testing).
    """
    kind = str(kind or "").strip().lower()
    item_id = str(item_id or "").strip().lower()
    if kind == "theme":
        from utils.profile_background_themes import (
            CRIME_GTA_COSMETIC_THEME_IDS,
            OWNED_FIELD,
            catalog_theme,
        )

        if item_id not in CRIME_GTA_COSMETIC_THEME_IDS:
            return None
        if not bypass_stock:
            if await live_cosmetic_copy_count(db, "theme", item_id) >= COSMETIC_MAX_LIVE_COPIES:
                return None
        meta = catalog_theme(item_id) or {"id": item_id, "name": item_id}
        await db.users.update_one(
            {"id": user_id},
            {
                "$addToSet": {OWNED_FIELD: item_id},
                "$inc": {f"{THEME_INVENTORY_FIELD}.{item_id}": 1},
            },
        )
        return {
            "kind": "theme",
            "id": item_id,
            "name": meta.get("name") or item_id,
            "image": meta.get("image"),
            "label": f"Profile theme: {meta.get('name') or item_id}",
        }
    if kind == "back":
        from utils.blackjack_card_backs import (
            CRIME_GTA_COSMETIC_BACK_IDS,
            OWNED_FIELD,
            catalog_back,
        )

        if item_id not in CRIME_GTA_COSMETIC_BACK_IDS:
            return None
        if not bypass_stock:
            if await live_cosmetic_copy_count(db, "back", item_id) >= COSMETIC_MAX_LIVE_COPIES:
                return None
        meta = catalog_back(item_id) or {"id": item_id, "name": item_id}
        await db.users.update_one(
            {"id": user_id},
            {
                "$addToSet": {OWNED_FIELD: item_id},
                "$inc": {f"{BACK_INVENTORY_FIELD}.{item_id}": 1},
            },
        )
        return {
            "kind": "back",
            "id": item_id,
            "name": meta.get("name") or item_id,
            "image": meta.get("image"),
            "label": f"Blackjack cover: {meta.get('name') or item_id}",
        }
    return None


async def _sync_owned_after_inventory_drain(db, user_id: str, kind: str, item_id: str, user_doc: dict) -> None:
    """If inventory hits 0, strip owned (and unequip) so sellable copies and equip stay aligned."""
    if kind == "theme":
        from utils.profile_background_themes import EQUIPPED_FIELD, OWNED_FIELD, owned_theme_ids

        left = inventory_count(user_doc, THEME_INVENTORY_FIELD, item_id)
        if left > 0:
            return
        owned = [t for t in owned_theme_ids(user_doc) if t != item_id]
        update: Dict[str, Any] = {
            "$set": {OWNED_FIELD: owned},
            "$unset": {f"{THEME_INVENTORY_FIELD}.{item_id}": ""},
        }
        eq = str(user_doc.get(EQUIPPED_FIELD) or "").strip().lower()
        if eq == item_id:
            update["$unset"][EQUIPPED_FIELD] = ""
        await db.users.update_one({"id": user_id}, update)
        return

    if kind == "back":
        from utils.blackjack_card_backs import EQUIPPED_FIELD, OWNED_FIELD, owned_back_ids

        left = inventory_count(user_doc, BACK_INVENTORY_FIELD, item_id)
        if left > 0:
            return
        owned = [b for b in owned_back_ids(user_doc) if b != item_id]
        update = {
            "$set": {OWNED_FIELD: owned},
            "$unset": {f"{BACK_INVENTORY_FIELD}.{item_id}": ""},
        }
        eq = str(user_doc.get(EQUIPPED_FIELD) or "").strip().lower()
        if eq == item_id:
            update["$unset"][EQUIPPED_FIELD] = ""
        await db.users.update_one({"id": user_id}, update)


async def consume_cosmetic_copies(
    db, user_id: str, kind: str, item_id: str, quantity: int = 1
) -> bool:
    """Deduct sellable inventory. Returns False if not enough. Syncs owned when drained."""
    kind = str(kind or "").strip().lower()
    item_id = str(item_id or "").strip().lower()
    qty = int(quantity or 0)
    if qty < 1 or kind not in ("theme", "back"):
        return False
    field = THEME_INVENTORY_FIELD if kind == "theme" else BACK_INVENTORY_FIELD
    path = f"{field}.{item_id}"
    proj = {
        "_id": 0,
        field: 1,
        "profile_background_themes_owned": 1,
        "profile_background_theme_id": 1,
        "blackjack_card_backs_owned": 1,
        "blackjack_card_back_id": 1,
    }
    doc = await db.users.find_one_and_update(
        {"id": user_id, path: {"$gte": qty}},
        {"$inc": {path: -qty}},
        projection=proj,
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        return False
    await _sync_owned_after_inventory_drain(db, user_id, kind, item_id, doc)
    return True


async def restore_cosmetic_copies(db, user_id: str, kind: str, item_id: str, quantity: int = 1) -> None:
    """Return escrowed copies (cancel / death). Bypasses stock — already counted before escrow."""
    qty = int(quantity or 0)
    if qty < 1:
        return
    for _ in range(qty):
        await grant_cosmetic_copy(db, user_id, kind, item_id, bypass_stock=True)


async def maybe_roll_crime_gta_cosmetic(
    db,
    user_id: str,
    rng: Optional[random.Random] = None,
) -> Optional[Dict[str, Any]]:
    """On successful crime/GTA: quiet chance to grant one random in-stock cosmetic."""
    r = rng if rng is not None else random
    if r.random() >= _CRIME_GTA_COSMETIC_CHANCE:
        return None
    pool = await available_crime_gta_cosmetic_pool(db)
    if not pool:
        return None
    kind, item_id = r.choice(pool)
    try:
        return await grant_cosmetic_copy(db, user_id, kind, item_id, bypass_stock=False)
    except Exception:
        return None


async def grant_all_crime_gta_cosmetics_to_user(db, user_id: str, *, copies: int = 1) -> Dict[str, int]:
    """Staff/testing: grant N copies of every crime/GTA cosmetic (does not burn player stock)."""
    n = max(1, int(copies or 1))
    themes = 0
    backs = 0
    for tid in _theme_pool():
        for _ in range(n):
            if await grant_cosmetic_copy(db, user_id, "theme", tid, bypass_stock=True):
                themes += 1
    for bid in _back_pool():
        for _ in range(n):
            if await grant_cosmetic_copy(db, user_id, "back", bid, bypass_stock=True):
                backs += 1
    return {"themes_granted": themes, "backs_granted": backs}


def catalog_meta_for_kind(kind: str, item_id: str) -> Optional[Dict[str, Any]]:
    kind = str(kind or "").strip().lower()
    item_id = str(item_id or "").strip().lower()
    if kind == "theme":
        from utils.profile_background_themes import catalog_theme

        return catalog_theme(item_id)
    if kind == "back":
        from utils.blackjack_card_backs import catalog_back

        return catalog_back(item_id)
    return None
