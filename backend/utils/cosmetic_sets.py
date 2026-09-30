"""Crimes/GTA dossier themes and blackjack covers grouped into sets of 8.

Owning every piece of a set turns on that set's bonus. The same bonus id
never stacks past one +25%, even if several sets share it.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

SET_SIZE = 8
SET_BONUS_MULT = 1.25

THEME_OWNED_FIELD = "profile_background_themes_owned"
BACK_OWNED_FIELD = "blackjack_card_backs_owned"

BONUS_LABELS: Dict[str, str] = {
    "crime_cash": "+25% cash from crimes",
    "melt_bullets": "+25% bullets from melting a car",
    "respect": "+25% respect from crimes, GTA, and organised crime",
    "rank_points": "+25% rank points",
    "gta_legendary": "+25% legendary car chance from GTA",
    "loot_token": "+25% loot token chance from crimes",
}

# kind: "theme" | "back". item_ids length is always SET_SIZE.
COSMETIC_SETS: Sequence[Dict[str, Any]] = (
    {
        "id": "rain_city",
        "name": "Rain City",
        "kind": "theme",
        "bonus": "crime_cash",
        "item_ids": (
            "vegas_rain",
            "chicago_alley",
            "subway_heist",
            "speakeasy_bar",
            "dockyard_fog",
            "penthouse_rain",
            "venice_canal",
            "train_trestle",
        ),
    },
    {
        "id": "deep_orbit",
        "name": "Deep Orbit",
        "kind": "theme",
        "bonus": "rank_points",
        "item_ids": (
            "space_nebula_rift",
            "space_ringworld",
            "space_ice_moon",
            "space_red_giant",
            "space_asteroid_field",
            "star_wars_station",
            "space_derelict_station",
            "space_binary_sunset",
        ),
    },
    {
        "id": "palermo",
        "name": "Palermo",
        "kind": "theme",
        "bonus": "respect",
        "item_ids": (
            "sicily_palermo_street",
            "sicily_dock_crates",
            "sicily_villa_night",
            "sicily_market_square",
            "sicily_train_station",
            "sicilian_villa",
            "sicily_vineyard_dusk",
            "sicily_chapel_bells",
        ),
    },
    {
        "id": "horizons",
        "name": "Horizons",
        "kind": "theme",
        "bonus": "gta_legendary",
        "item_ids": (
            "scenic_aurora_fjord",
            "scenic_sahara_dunes",
            "scenic_cherry_temple",
            "scenic_cliff_lighthouse",
            "scenic_misty_bamboo",
            "desert_airstrip",
            "scenic_glacier_bay",
            "scenic_volcano_coast",
        ),
    },
    {
        "id": "bloodwork",
        "name": "Bloodwork",
        "kind": "theme",
        "bonus": "melt_bullets",
        "item_ids": (
            "kill_blood_altar",
            "kill_knife_alley",
            "kill_execution_chair",
            "kill_black_hood",
            "kill_handprint_wall",
            "kill_coffin_crypt",
            "kill_sniper_rooftop",
            "kill_dungeon_chains",
        ),
    },
    {
        "id": "last_rites",
        "name": "Last Rites",
        "kind": "theme",
        "bonus": "melt_bullets",
        "item_ids": (
            "kill_red_candle_ritual",
            "kill_abandoned_asylum",
            "kill_hitman_briefcase",
            "kill_graveyard_fog",
            "kill_meat_hooks",
            "kill_dark_cathedral",
            "kill_bullet_casings",
            "kill_ivory_revolver",
        ),
    },
    {
        "id": "cartel",
        "name": "Cartel",
        "kind": "theme",
        "bonus": "loot_token",
        "item_ids": (
            "weed_cartel_compound",
            "weed_border_tunnel",
            "weed_armored_convoy",
            "weed_cartel_villa",
            "weed_jungle_lab",
            "weed_night_airstrip",
            "weed_dock_crates",
            "weed_gold_safe",
        ),
    },
    {
        "id": "grow_room",
        "name": "Grow Room",
        "kind": "theme",
        "bonus": "loot_token",
        "item_ids": (
            "weed_grow_purple",
            "weed_jar_vault",
            "weed_neon_dispensary",
            "weed_hydro_lab",
            "weed_field_sunset",
            "weed_clone_room",
            "weed_drying_racks",
            "weed_trim_table",
        ),
    },
    {
        "id": "haze",
        "name": "Haze",
        "kind": "theme",
        "bonus": "loot_token",
        "item_ids": (
            "weed_stoned_cosmos",
            "weed_tiki_lounge",
            "weed_retro_cassette",
            "weed_mountain_cabin",
            "weed_underwater_reef",
            "weed_lava_lamp",
            "weed_van_mural",
            "weed_rooftop_garden",
        ),
    },
    {
        "id": "sawyer",
        "name": "Sawyer",
        "kind": "theme",
        "bonus": "melt_bullets",
        "item_ids": (
            "leatherface_porch",
            "leatherface_closeup",
            "leatherface_cornfield",
            "leatherface_hooks",
            "leatherface_dance",
            "leatherface_barn",
            "leatherface_cellar",
            "leatherface_highway",
        ),
    },
    {
        "id": "ronin",
        "name": "Ronin",
        "kind": "theme",
        "bonus": "crime_cash",
        "item_ids": (
            "musashi_dual",
            "samurai_torii",
            "ninja_rooftops",
            "kyoto_lanterns",
            "kabuki_stage",
            "sumo_dohyo",
            "shogun_castle",
            "koi_garden",
        ),
    },
    {
        "id": "night_cities",
        "name": "Night Cities",
        "kind": "theme",
        "bonus": "rank_points",
        "item_ids": (
            "tokyo_shibuya",
            "cyberpunk_skyline",
            "hong_kong_harbor",
            "neon_diner",
            "monaco_f1",
            "boxing_ring",
            "casino_vault",
            "jazz_speakeasy",
        ),
    },
    {
        "id": "wild_world",
        "name": "Wild World",
        "kind": "theme",
        "bonus": "respect",
        "item_ids": (
            "egypt_tomb",
            "viking_longship",
            "wild_west_street",
            "pirate_storm",
            "trex_jungle",
            "aztec_pyramid",
            "castle_siege",
            "colosseum",
        ),
    },
    {
        "id": "voyage",
        "name": "Voyage",
        "kind": "theme",
        "bonus": "gta_legendary",
        "item_ids": (
            "sunken_galleon",
            "steam_train",
            "fuji_lake",
            "onsen_snow",
            "grand_canyon",
            "savanna_sunset",
            "arctic_aurora",
            "coal_mine",
        ),
    },
    {
        "id": "spectacle",
        "name": "Spectacle",
        "kind": "theme",
        "bonus": "loot_token",
        "item_ids": (
            "haunted_mansion",
            "alien_planet",
            "mardi_gras",
            "rio_carnival",
            "wizard_library",
            "cooling_towers",
            "sakura_tunnel",
            "bamboo_path",
        ),
    },
    {
        "id": "felt_gold",
        "name": "Felt & Gold",
        "kind": "back",
        "bonus": "crime_cash",
        "item_ids": (
            "ruby_filigree",
            "clover_felt",
            "skull_rose",
            "gold_dragon",
            "bank_seal",
            "tommy_crest",
            "emerald_crown",
            "thorn_rose",
        ),
    },
    {
        "id": "orbit_covers",
        "name": "Deep Orbit",
        "kind": "back",
        "bonus": "rank_points",
        "item_ids": (
            "space_orbit_seal",
            "space_comet_crest",
            "space_plasma_ring",
            "space_lunar_crest",
            "space_starfield_seal",
            "ice_crystal",
            "space_saturn_crest",
            "space_pulsar_seal",
        ),
    },
    {
        "id": "palermo_covers",
        "name": "Palermo",
        "kind": "back",
        "bonus": "respect",
        "item_ids": (
            "sicily_olive_crest",
            "sicily_fedora_gold",
            "sicily_lemon_seal",
            "sicily_barrel_crest",
            "sicily_tram_crest",
            "sicily_vespa_crest",
            "sicily_opera_mask",
            "sicily_coral_seal",
        ),
    },
    {
        "id": "horizons_covers",
        "name": "Horizons",
        "kind": "back",
        "bonus": "gta_legendary",
        "item_ids": (
            "scenic_wave_crest",
            "scenic_mountain_seal",
            "scenic_forest_crest",
            "scenic_desert_seal",
            "scenic_aurora_crest",
            "scenic_glacier_seal",
            "scenic_volcano_crest",
            "scenic_reef_seal",
        ),
    },
    {
        "id": "weed_gold",
        "name": "Gold Leaf",
        "kind": "back",
        "bonus": "loot_token",
        "item_ids": (
            "weed_gold_leaf",
            "weed_neon_leaf",
            "weed_jar_crest",
            "weed_cartel_seal",
            "weed_grow_lights",
            "weed_field_crest",
            "weed_cosmos_leaf",
            "weed_tiki_leaf",
        ),
    },
    {
        "id": "weed_haze_covers",
        "name": "Haze Leaf",
        "kind": "back",
        "bonus": "loot_token",
        "item_ids": (
            "weed_reef_leaf",
            "weed_cabin_leaf",
            "weed_leaf_pulse",
            "weed_airstrip_leaf",
            "weed_safe_leaf",
            "weed_clone_leaf",
            "weed_drying_leaf",
            "weed_rooftop_leaf",
        ),
    },
    {
        "id": "dark_covers",
        "name": "Dark Crests",
        "kind": "back",
        "bonus": "melt_bullets",
        "item_ids": (
            "leatherface_mask",
            "haunted_crest",
            "widow_web",
            "raven_wings",
            "wolf_moon",
            "snake_eyes",
            "butterfly_knife",
            "spellbook",
        ),
    },
    {
        "id": "ronin_covers",
        "name": "Ronin",
        "kind": "back",
        "bonus": "crime_cash",
        "item_ids": (
            "kabuto_crest",
            "shuriken_seal",
            "koi_circle",
            "sakura_crest",
            "kabuki_mask",
            "sumo_crest",
            "shogun_mon",
            "torii_sun",
        ),
    },
    {
        "id": "night_covers",
        "name": "Night Cities",
        "kind": "back",
        "bonus": "rank_points",
        "item_ids": (
            "cyber_chip",
            "checkered_flag",
            "boxing_glove",
            "diner_neon",
            "poker_chips",
            "sax_crest",
            "mardi_mask",
            "carnival_feather",
        ),
    },
    {
        "id": "wild_covers",
        "name": "Wild World",
        "kind": "back",
        "bonus": "respect",
        "item_ids": (
            "viking_axe",
            "ankh_scarab",
            "pirate_cutlass",
            "trex_fossil",
            "castle_keep",
            "aztec_sun",
            "colosseum_arch",
            "revolver_crest",
        ),
    },
    {
        "id": "voyage_covers",
        "name": "Voyage",
        "kind": "back",
        "bonus": "gta_legendary",
        "item_ids": (
            "fuji_moon",
            "onsen_lantern",
            "bamboo_crest",
            "junk_sail",
            "canyon_layers",
            "polar_aurora",
            "mine_lantern",
            "lion_savanna",
        ),
    },
    {
        "id": "beast_covers",
        "name": "Beasts",
        "kind": "back",
        "bonus": "loot_token",
        "item_ids": (
            "phoenix_fire",
            "owl_crest",
            "cobra_coil",
            "tiger_face",
            "panther_head",
            "scorpion",
            "octopus",
            "alien_eye",
        ),
    },
    {
        "id": "ironworks",
        "name": "Ironworks",
        "kind": "back",
        "bonus": "melt_bullets",
        "item_ids": (
            "copper_gears",
            "loco_front",
            "atom_tower",
            "iron_gear_crest",
            "iron_piston_seal",
            "iron_anvil_crest",
            "iron_rivet_seal",
            "iron_smokestack",
        ),
    },
)


def _owned_ids(user: Optional[dict], kind: str) -> set:
    if not user:
        return set()
    field = THEME_OWNED_FIELD if kind == "theme" else BACK_OWNED_FIELD
    raw = user.get(field) or []
    if not isinstance(raw, list):
        return set()
    return {str(x or "").strip().lower() for x in raw if str(x or "").strip()}


def set_is_complete(user: Optional[dict], spec: Dict[str, Any]) -> bool:
    owned = _owned_ids(user, str(spec.get("kind") or ""))
    ids = spec.get("item_ids") or ()
    return bool(ids) and all(str(i) in owned for i in ids)


def completed_set_bonus(user: Optional[dict], bonus_id: str) -> bool:
    """True when any owned set of this bonus id is complete. Caps at one."""
    bid = str(bonus_id or "").strip()
    if not bid or not user:
        return False
    for spec in COSMETIC_SETS:
        if spec.get("bonus") != bid:
            continue
        if set_is_complete(user, spec):
            return True
    return False


def set_bonus_mult(user: Optional[dict], bonus_id: str) -> float:
    return SET_BONUS_MULT if completed_set_bonus(user, bonus_id) else 1.0


def apply_respect_set_bonus(user: Optional[dict], amount: int) -> int:
    try:
        n = int(amount or 0)
    except (TypeError, ValueError):
        return 0
    if n <= 0:
        return 0
    if not completed_set_bonus(user, "respect"):
        return n
    return max(1, int(round(n * SET_BONUS_MULT)))


def active_set_bonuses(user: Optional[dict]) -> List[Dict[str, str]]:
    """One row per bonus id that at least one complete set has unlocked."""
    out: List[Dict[str, str]] = []
    seen = set()
    for spec in COSMETIC_SETS:
        bid = str(spec.get("bonus") or "")
        if not bid or bid in seen:
            continue
        if completed_set_bonus(user, bid):
            seen.add(bid)
            out.append({"id": bid, "label": BONUS_LABELS.get(bid, bid)})
    return out


def set_progress_rows(
    user: Optional[dict],
    kind: str,
    lookup: Callable[[str], Optional[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    owned = _owned_ids(user, kind)
    rows: List[Dict[str, Any]] = []
    for spec in COSMETIC_SETS:
        if spec.get("kind") != kind:
            continue
        items: List[Dict[str, Any]] = []
        have = 0
        for iid in spec["item_ids"]:
            meta = lookup(str(iid)) or {}
            owned_flag = str(iid) in owned
            if owned_flag:
                have += 1
            items.append({
                "id": iid,
                "name": meta.get("name") or iid,
                "image": meta.get("image") or "",
                "owned": owned_flag,
            })
        total = len(spec["item_ids"])
        bid = str(spec.get("bonus") or "")
        rows.append({
            "id": spec["id"],
            "name": spec["name"],
            "kind": kind,
            "bonus": bid,
            "bonus_label": BONUS_LABELS.get(bid, bid),
            "owned_count": have,
            "total": total,
            "complete": have == total and total > 0,
            "items": items,
        })
    return rows


def assert_sets_cover(theme_ids: Iterable[str], back_ids: Iterable[str]) -> None:
    """Every Crimes/GTA cosmetic is in exactly one set of 8. Raises ValueError."""
    for spec in COSMETIC_SETS:
        ids = tuple(spec.get("item_ids") or ())
        if len(ids) != SET_SIZE or len(set(ids)) != SET_SIZE:
            raise ValueError(f"{spec.get('id')} must contain {SET_SIZE} unique ids")
        if spec.get("bonus") not in BONUS_LABELS:
            raise ValueError(f"{spec.get('id')} has unknown bonus {spec.get('bonus')}")
        if spec.get("kind") not in ("theme", "back"):
            raise ValueError(f"{spec.get('id')} has unknown kind")

    def _check(kind: str, expected: Iterable[str]) -> None:
        want = {str(x) for x in expected}
        seen: Dict[str, str] = {}
        for spec in COSMETIC_SETS:
            if spec.get("kind") != kind:
                continue
            for iid in spec["item_ids"]:
                if iid in seen:
                    raise ValueError(f"{iid} is in both {seen[iid]} and {spec['id']}")
                seen[iid] = str(spec["id"])
        missing = sorted(want - set(seen))
        extra = sorted(set(seen) - want)
        if missing or extra:
            raise ValueError(f"{kind} set mismatch missing={missing} extra={extra}")

    _check("theme", theme_ids)
    _check("back", back_ids)
