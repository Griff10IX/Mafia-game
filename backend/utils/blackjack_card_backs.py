"""Unlisted Ultra Rare blackjack card-back cosmetics (no bonuses, no public loot catalog)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

_BJ_ASSET_V = "20260930weedpulse"

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
    # New card backs (catalog; grant separately — not live yet)
    "ruby_filigree": {
        "id": "ruby_filigree",
        "name": "Ruby Filigree",
        "image": f"/images/blackjack/card-backs/ruby-filigree.jpg?v={_BJ_ASSET_V}",
    },
    "clover_felt": {
        "id": "clover_felt",
        "name": "Clover Felt",
        "image": f"/images/blackjack/card-backs/clover-felt.jpg?v={_BJ_ASSET_V}",
    },
    "skull_rose": {
        "id": "skull_rose",
        "name": "Skull & Rose",
        "image": f"/images/blackjack/card-backs/skull-rose.jpg?v={_BJ_ASSET_V}",
    },
    "gold_dragon": {
        "id": "gold_dragon",
        "name": "Gold Dragon",
        "image": f"/images/blackjack/card-backs/gold-dragon.jpg?v={_BJ_ASSET_V}",
    },
    "bank_seal": {
        "id": "bank_seal",
        "name": "Bank Seal",
        "image": f"/images/blackjack/card-backs/bank-seal.jpg?v={_BJ_ASSET_V}",
    },
    "tommy_crest": {
        "id": "tommy_crest",
        "name": "Tommy Crest",
        "image": f"/images/blackjack/card-backs/tommy-crest.jpg?v={_BJ_ASSET_V}",
    },
    "ice_crystal": {
        "id": "ice_crystal",
        "name": "Ice Crystal",
        "image": f"/images/blackjack/card-backs/ice-crystal.jpg?v={_BJ_ASSET_V}",
    },
    "copper_gears": {
        "id": "copper_gears",
        "name": "Copper Gears",
        "image": f"/images/blackjack/card-backs/copper-gears.jpg?v={_BJ_ASSET_V}",
    },
    "emerald_crown": {
        "id": "emerald_crown",
        "name": "Emerald Crown",
        "image": f"/images/blackjack/card-backs/emerald-crown.jpg?v={_BJ_ASSET_V}",
    },
    "thorn_rose": {
        "id": "thorn_rose",
        "name": "Thorn Rose",
        "image": f"/images/blackjack/card-backs/thorn-rose.jpg?v={_BJ_ASSET_V}",
    },
    # Space set
    "space_orbit_seal": {
        "id": "space_orbit_seal",
        "name": "Orbit Seal",
        "image": f"/images/blackjack/card-backs/space-orbit-seal.jpg?v={_BJ_ASSET_V}",
    },
    "space_comet_crest": {
        "id": "space_comet_crest",
        "name": "Comet Crest",
        "image": f"/images/blackjack/card-backs/space-comet-crest.jpg?v={_BJ_ASSET_V}",
    },
    "space_plasma_ring": {
        "id": "space_plasma_ring",
        "name": "Plasma Ring",
        "image": f"/images/blackjack/card-backs/space-plasma-ring.jpg?v={_BJ_ASSET_V}",
    },
    "space_lunar_crest": {
        "id": "space_lunar_crest",
        "name": "Lunar Crest",
        "image": f"/images/blackjack/card-backs/space-lunar-crest.jpg?v={_BJ_ASSET_V}",
    },
    "space_starfield_seal": {
        "id": "space_starfield_seal",
        "name": "Starfield Seal",
        "image": f"/images/blackjack/card-backs/space-starfield-seal.jpg?v={_BJ_ASSET_V}",
    },
    # Sicily 1920s set
    "sicily_olive_crest": {
        "id": "sicily_olive_crest",
        "name": "Olive Crest",
        "image": f"/images/blackjack/card-backs/sicily-olive-crest.jpg?v={_BJ_ASSET_V}",
    },
    "sicily_fedora_gold": {
        "id": "sicily_fedora_gold",
        "name": "Gold Fedora",
        "image": f"/images/blackjack/card-backs/sicily-fedora-gold.jpg?v={_BJ_ASSET_V}",
    },
    "sicily_lemon_seal": {
        "id": "sicily_lemon_seal",
        "name": "Lemon Seal",
        "image": f"/images/blackjack/card-backs/sicily-lemon-seal.jpg?v={_BJ_ASSET_V}",
    },
    "sicily_barrel_crest": {
        "id": "sicily_barrel_crest",
        "name": "Barrel Crest",
        "image": f"/images/blackjack/card-backs/sicily-barrel-crest.jpg?v={_BJ_ASSET_V}",
    },
    "sicily_tram_crest": {
        "id": "sicily_tram_crest",
        "name": "Tram Crest",
        "image": f"/images/blackjack/card-backs/sicily-tram-crest.jpg?v={_BJ_ASSET_V}",
    },
    # Scenic set
    "scenic_wave_crest": {
        "id": "scenic_wave_crest",
        "name": "Wave Crest",
        "image": f"/images/blackjack/card-backs/scenic-wave-crest.jpg?v={_BJ_ASSET_V}",
    },
    "scenic_mountain_seal": {
        "id": "scenic_mountain_seal",
        "name": "Mountain Seal",
        "image": f"/images/blackjack/card-backs/scenic-mountain-seal.jpg?v={_BJ_ASSET_V}",
    },
    "scenic_forest_crest": {
        "id": "scenic_forest_crest",
        "name": "Forest Crest",
        "image": f"/images/blackjack/card-backs/scenic-forest-crest.jpg?v={_BJ_ASSET_V}",
    },
    "scenic_desert_seal": {
        "id": "scenic_desert_seal",
        "name": "Desert Seal",
        "image": f"/images/blackjack/card-backs/scenic-desert-seal.jpg?v={_BJ_ASSET_V}",
    },
    "scenic_aurora_crest": {
        "id": "scenic_aurora_crest",
        "name": "Aurora Crest",
        "image": f"/images/blackjack/card-backs/scenic-aurora-crest.jpg?v={_BJ_ASSET_V}",
    },
    # Weed set
    "weed_gold_leaf": {
        "id": "weed_gold_leaf",
        "name": "Gold Leaf",
        "image": f"/images/blackjack/card-backs/weed-gold-leaf.jpg?v={_BJ_ASSET_V}",
    },
    "weed_neon_leaf": {
        "id": "weed_neon_leaf",
        "name": "Neon Leaf",
        "image": f"/images/blackjack/card-backs/weed-neon-leaf.jpg?v={_BJ_ASSET_V}",
    },
    "weed_jar_crest": {
        "id": "weed_jar_crest",
        "name": "Jar Crest",
        "image": f"/images/blackjack/card-backs/weed-jar-crest.jpg?v={_BJ_ASSET_V}",
    },
    "weed_cartel_seal": {
        "id": "weed_cartel_seal",
        "name": "Cartel Seal",
        "image": f"/images/blackjack/card-backs/weed-cartel-seal.jpg?v={_BJ_ASSET_V}",
    },
    "weed_grow_lights": {
        "id": "weed_grow_lights",
        "name": "Grow Lights",
        "image": f"/images/blackjack/card-backs/weed-grow-lights.jpg?v={_BJ_ASSET_V}",
    },
    "weed_field_crest": {
        "id": "weed_field_crest",
        "name": "Field Crest",
        "image": f"/images/blackjack/card-backs/weed-field-crest.jpg?v={_BJ_ASSET_V}",
    },
    "weed_cosmos_leaf": {
        "id": "weed_cosmos_leaf",
        "name": "Cosmos Leaf",
        "image": f"/images/blackjack/card-backs/weed-cosmos-leaf.jpg?v={_BJ_ASSET_V}",
    },
    "weed_tiki_leaf": {
        "id": "weed_tiki_leaf",
        "name": "Tiki Leaf",
        "image": f"/images/blackjack/card-backs/weed-tiki-leaf.jpg?v={_BJ_ASSET_V}",
    },
    "weed_reef_leaf": {
        "id": "weed_reef_leaf",
        "name": "Reef Leaf",
        "image": f"/images/blackjack/card-backs/weed-reef-leaf.jpg?v={_BJ_ASSET_V}",
    },
    "weed_cabin_leaf": {
        "id": "weed_cabin_leaf",
        "name": "Cabin Leaf",
        "image": f"/images/blackjack/card-backs/weed-cabin-leaf.jpg?v={_BJ_ASSET_V}",
    },
    "weed_leaf_pulse": {
        "id": "weed_leaf_pulse",
        "name": "Leaf Pulse",
        "image": f"/images/blackjack/card-backs/weed-leaf-pulse.gif?v={_BJ_ASSET_V}",
    },
}

OWNED_FIELD = "blackjack_card_backs_owned"
EQUIPPED_FIELD = "blackjack_card_back_id"
ALL_BACK_IDS = tuple(BLACKJACK_CARD_BACKS.keys())

# New covers: Crimes/GTA drops + Quick Trade — excluded from loot-box card-back rolls.
CRIME_GTA_COSMETIC_BACK_IDS = (
    "ruby_filigree",
    "clover_felt",
    "skull_rose",
    "gold_dragon",
    "bank_seal",
    "tommy_crest",
    "ice_crystal",
    "copper_gears",
    "emerald_crown",
    "thorn_rose",
    "space_orbit_seal",
    "space_comet_crest",
    "space_plasma_ring",
    "space_lunar_crest",
    "space_starfield_seal",
    "sicily_olive_crest",
    "sicily_fedora_gold",
    "sicily_lemon_seal",
    "sicily_barrel_crest",
    "sicily_tram_crest",
    "scenic_wave_crest",
    "scenic_mountain_seal",
    "scenic_forest_crest",
    "scenic_desert_seal",
    "scenic_aurora_crest",
    "weed_gold_leaf",
    "weed_neon_leaf",
    "weed_jar_crest",
    "weed_cartel_seal",
    "weed_grow_lights",
    "weed_field_crest",
    "weed_cosmos_leaf",
    "weed_tiki_leaf",
    "weed_reef_leaf",
    "weed_cabin_leaf",
    "weed_leaf_pulse",
)
_CRIME_GTA_BACK_SET = frozenset(CRIME_GTA_COSMETIC_BACK_IDS)
# Legacy / UR loot pool only (never includes crime/GTA cosmetics).
LOOT_BACK_IDS = tuple(b for b in ALL_BACK_IDS if b not in _CRIME_GTA_BACK_SET)


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
    from utils.crime_gta_cosmetics import BACK_INVENTORY_FIELD

    u = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, OWNED_FIELD: 1, EQUIPPED_FIELD: 1, BACK_INVENTORY_FIELD: 1},
    ) or {}
    owned = owned_back_ids(u)
    if not owned and not u.get(EQUIPPED_FIELD) and not u.get(BACK_INVENTORY_FIELD):
        return []
    await db.users.update_one(
        {"id": user_id},
        {
            "$unset": {EQUIPPED_FIELD: "", BACK_INVENTORY_FIELD: ""},
            "$set": {OWNED_FIELD: []},
        },
    )
    return owned


async def list_unowned_for_user(db, user_id: str, *, loot_only: bool = True) -> List[str]:
    """Backs the user does not own. Default loot_only excludes Crimes/GTA cosmetics."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, OWNED_FIELD: 1}) or {}
    have = set(owned_back_ids(u))
    pool = LOOT_BACK_IDS if loot_only else ALL_BACK_IDS
    return [b for b in pool if b not in have]
