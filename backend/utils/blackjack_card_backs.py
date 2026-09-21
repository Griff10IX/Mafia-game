"""Unlisted Ultra Rare blackjack card-back cosmetics (no bonuses, no public loot catalog)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

_BJ_ASSET_V = "20260921a"

BLACKJACK_CARD_BACKS: Dict[str, Dict[str, str]] = {
    "spade_black_gold": {
        "id": "spade_black_gold",
        "name": "Black Gold Spade",
        "image": f"/images/blackjack/card-backs/spade-black-gold.jpg?v={_BJ_ASSET_V}",
    },
    "spade_red_gold": {
        "id": "spade_red_gold",
        "name": "Red Gold Spade",
        "image": f"/images/blackjack/card-backs/spade-red-gold.jpg?v={_BJ_ASSET_V}",
    },
    "celestial_compass": {
        "id": "celestial_compass",
        "name": "Celestial Compass",
        "image": f"/images/blackjack/card-backs/celestial-compass.jpg?v={_BJ_ASSET_V}",
    },
    "galaxy_frame": {
        "id": "galaxy_frame",
        "name": "Galaxy Frame",
        "image": f"/images/blackjack/card-backs/galaxy-frame.jpg?v={_BJ_ASSET_V}",
    },
    "hasbulla_boss": {
        "id": "hasbulla_boss",
        "name": "Boss Hasbulla",
        "image": f"/images/blackjack/card-backs/hasbulla-boss.jpg?v={_BJ_ASSET_V}",
    },
    "doge_boss": {
        "id": "doge_boss",
        "name": "Boss Doge",
        "image": f"/images/blackjack/card-backs/doge-boss.jpg?v={_BJ_ASSET_V}",
    },
    "cosmic_portal": {
        "id": "cosmic_portal",
        "name": "Cosmic Portal",
        "image": f"/images/blackjack/card-backs/cosmic-portal.jpg?v={_BJ_ASSET_V}",
    },
    "neon_nebula": {
        "id": "neon_nebula",
        "name": "Neon Nebula",
        "image": f"/images/blackjack/card-backs/neon-nebula.jpg?v={_BJ_ASSET_V}",
    },
}

OWNED_FIELD = "blackjack_card_backs_owned"
EQUIPPED_FIELD = "blackjack_card_back_id"
ALL_BACK_IDS = tuple(BLACKJACK_CARD_BACKS.keys())


def catalog_back(back_id: Optional[str]) -> Optional[Dict[str, Any]]:
    bid = str(back_id or "").strip().lower()
    if not bid:
        return None
    row = BLACKJACK_CARD_BACKS.get(bid)
    return dict(row) if row else None


def owned_back_ids(user: Optional[dict]) -> List[str]:
    if not user:
        return []
    raw = user.get(OWNED_FIELD) or []
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    seen = set()
    for x in raw:
        bid = str(x or "").strip().lower()
        if not bid or bid in seen or bid not in BLACKJACK_CARD_BACKS:
            continue
        seen.add(bid)
        out.append(bid)
    return out


def user_owns_back(user: Optional[dict], back_id: Optional[str]) -> bool:
    bid = str(back_id or "").strip().lower()
    return bool(bid) and bid in owned_back_ids(user)


def equipped_back_id(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    bid = str(user.get(EQUIPPED_FIELD) or "").strip().lower()
    if not bid or bid not in BLACKJACK_CARD_BACKS:
        return None
    if not user_owns_back(user, bid):
        return None
    return bid


def resolve_equipped_back(user: Optional[dict]) -> Optional[Dict[str, Any]]:
    return catalog_back(equipped_back_id(user))


def public_fields(user: Optional[dict], *, include_owned: bool = False) -> Dict[str, Any]:
    eq = equipped_back_id(user)
    out: Dict[str, Any] = {
        "blackjack_card_back_id": eq,
        "blackjack_card_back": resolve_equipped_back(user),
    }
    if include_owned:
        owned = owned_back_ids(user)
        out["blackjack_card_backs_owned"] = owned
        out["blackjack_card_backs"] = [catalog_back(b) for b in owned if catalog_back(b)]
    return out


def normalize_equip_back_id(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or s in ("none", "null", "off", "default"):
        return None
    if s not in BLACKJACK_CARD_BACKS:
        raise ValueError("Unknown blackjack card back")
    return s


async def grant_back(db, user_id: str, back_id: str) -> bool:
    bid = str(back_id or "").strip().lower()
    if bid not in BLACKJACK_CARD_BACKS:
        return False
    res = await db.users.update_one(
        {"id": user_id},
        {"$addToSet": {OWNED_FIELD: bid}},
    )
    return bool(res.modified_count or res.matched_count)


async def clear_backs_on_death(db, user_id: str) -> List[str]:
    """Strip owned/equipped backs on death (return to quiet pool — no world cap)."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, OWNED_FIELD: 1, EQUIPPED_FIELD: 1}) or {}
    owned = owned_back_ids(u)
    if not owned and not u.get(EQUIPPED_FIELD):
        return []
    await db.users.update_one(
        {"id": user_id},
        {"$unset": {EQUIPPED_FIELD: ""}, "$set": {OWNED_FIELD: []}},
    )
    return owned


async def list_unowned_for_user(db, user_id: str) -> List[str]:
    u = await db.users.find_one({"id": user_id}, {"_id": 0, OWNED_FIELD: 1}) or {}
    have = set(owned_back_ids(u))
    return [b for b in ALL_BACK_IDS if b not in have]
