"""Secret Crimes/GTA cosmetic drops (profile themes + blackjack backs).

Drop chance is server-side only — never expose as a named rate in API payloads.
Duplicates are allowed via stackable inventory fields used by Quick Trade.
"""
from __future__ import annotations

import random
from typing import Any, Dict, List, Optional, Tuple

from pymongo import ReturnDocument

# Quiet roll — do not surface this constant in public API fields.
_CRIME_GTA_COSMETIC_CHANCE = 0.0001  # 0.01%

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


async def grant_cosmetic_copy(db, user_id: str, kind: str, item_id: str) -> Optional[Dict[str, Any]]:
    """Grant one sellable copy: add to owned set + increment inventory. Duplicates OK."""
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
    """Return escrowed copies (cancel / death)."""
    qty = int(quantity or 0)
    if qty < 1:
        return
    for _ in range(qty):
        await grant_cosmetic_copy(db, user_id, kind, item_id)


async def maybe_roll_crime_gta_cosmetic(
    db,
    user_id: str,
    rng: Optional[random.Random] = None,
) -> Optional[Dict[str, Any]]:
    """On successful crime/GTA: quiet chance to grant one random new cosmetic."""
    r = rng if rng is not None else random
    if r.random() >= _CRIME_GTA_COSMETIC_CHANCE:
        return None
    pool = crime_gta_cosmetic_pool()
    if not pool:
        return None
    kind, item_id = r.choice(pool)
    try:
        return await grant_cosmetic_copy(db, user_id, kind, item_id)
    except Exception:
        return None


async def grant_all_crime_gta_cosmetics_to_user(db, user_id: str, *, copies: int = 1) -> Dict[str, int]:
    """Staff/testing: grant N copies of every crime/GTA cosmetic."""
    n = max(1, int(copies or 1))
    themes = 0
    backs = 0
    for tid in _theme_pool():
        for _ in range(n):
            if await grant_cosmetic_copy(db, user_id, "theme", tid):
                themes += 1
    for bid in _back_pool():
        for _ in range(n):
            if await grant_cosmetic_copy(db, user_id, "back", bid):
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
