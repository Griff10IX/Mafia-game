"""One-shot live grant: GhostFace gets all Crimes/GTA cosmetics (owned + 1 inventory each).

Self-contained (no app imports) so it can be scp'd and run on the server before full deploy.
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

for env_path in ("/opt/mafia-app/backend/.env", os.path.join(os.path.dirname(__file__), "..", ".env")):
    if os.path.isfile(env_path):
        load_dotenv(env_path)
        break

UID = "36425cb4-3755-4669-b4b5-5d86345991d0"
THEME_OWNED = "profile_background_themes_owned"
BJ_OWNED = "blackjack_card_backs_owned"
THEME_INV = "profile_theme_inventory"
BACK_INV = "blackjack_back_inventory"

THEMES = [
    "vegas_rain",
    "chicago_alley",
    "sicilian_villa",
    "subway_heist",
    "speakeasy_bar",
    "dockyard_fog",
    "desert_airstrip",
    "venice_canal",
    "penthouse_rain",
    "train_trestle",
    "star_wars_station",
    "space_nebula_rift",
    "space_ringworld",
    "space_ice_moon",
    "space_red_giant",
    "space_asteroid_field",
    "sicily_palermo_street",
    "sicily_dock_crates",
    "sicily_villa_night",
    "sicily_market_square",
    "sicily_train_station",
    "scenic_aurora_fjord",
    "scenic_sahara_dunes",
    "scenic_cherry_temple",
    "scenic_cliff_lighthouse",
    "scenic_misty_bamboo",
    "kill_blood_altar",
    "kill_knife_alley",
    "kill_execution_chair",
    "kill_black_hood",
    "kill_handprint_wall",
    "kill_coffin_crypt",
    "kill_sniper_rooftop",
    "kill_dungeon_chains",
    "kill_red_candle_ritual",
    "kill_abandoned_asylum",
    "kill_hitman_briefcase",
    "kill_graveyard_fog",
    "kill_meat_hooks",
    "kill_dark_cathedral",
    "kill_bullet_casings",
    "weed_cartel_compound",
    "weed_border_tunnel",
    "weed_armored_convoy",
    "weed_cartel_villa",
    "weed_jungle_lab",
    "weed_grow_purple",
    "weed_jar_vault",
    "weed_neon_dispensary",
    "weed_hydro_lab",
    "weed_field_sunset",
    "weed_stoned_cosmos",
    "weed_tiki_lounge",
    "weed_retro_cassette",
    "weed_mountain_cabin",
    "weed_underwater_reef",
    "leatherface_porch",
    "leatherface_closeup",
    "leatherface_cornfield",
    "leatherface_hooks",
    "leatherface_dance",
    "musashi_dual",
    "samurai_torii",
    "tokyo_shibuya",
    "ninja_rooftops",
    "egypt_tomb",
    "viking_longship",
    "wild_west_street",
    "pirate_storm",
    "cyberpunk_skyline",
    "trex_jungle",
    "sunken_galleon",
    "castle_siege",
    "aztec_pyramid",
    "haunted_mansion",
    "monaco_f1",
    "kyoto_lanterns",
    "fuji_lake",
    "colosseum",
    "steam_train",
    "alien_planet",
    "jazz_speakeasy",
    "onsen_snow",
    "boxing_ring",
    "mardi_gras",
    "arctic_aurora",
    "kabuki_stage",
    "cooling_towers",
    "sumo_dohyo",
    "grand_canyon",
    "wizard_library",
    "hong_kong_harbor",
    "sakura_tunnel",
    "neon_diner",
    "shogun_castle",
    "coal_mine",
    "rio_carnival",
    "bamboo_path",
    "casino_vault",
    "savanna_sunset",
    "koi_garden",
]
BACKS = [
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
    "leatherface_mask",
    "kabuto_crest",
    "shuriken_seal",
    "viking_axe",
    "ankh_scarab",
    "pirate_cutlass",
    "trex_fossil",
    "cyber_chip",
    "revolver_crest",
    "castle_keep",
    "aztec_sun",
    "haunted_crest",
    "checkered_flag",
    "koi_circle",
    "sakura_crest",
    "fuji_moon",
    "onsen_lantern",
    "boxing_glove",
    "mardi_mask",
    "polar_aurora",
    "kabuki_mask",
    "atom_tower",
    "sumo_crest",
    "canyon_layers",
    "spellbook",
    "junk_sail",
    "diner_neon",
    "shogun_mon",
    "mine_lantern",
    "carnival_feather",
    "bamboo_crest",
    "poker_chips",
    "lion_savanna",
    "colosseum_arch",
    "loco_front",
    "alien_eye",
    "sax_crest",
    "phoenix_fire",
    "wolf_moon",
    "owl_crest",
    "cobra_coil",
    "widow_web",
    "raven_wings",
    "tiger_face",
    "panther_head",
    "scorpion",
    "octopus",
    "butterfly_knife",
    "snake_eyes",
    "torii_sun",
]


def main() -> int:
    db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
    u0 = db.users.find_one({"id": UID}, {"_id": 0, "username": 1})
    if not u0:
        print("GhostFace user not found", UID)
        return 1
    theme_inc = {f"{THEME_INV}.{tid}": 1 for tid in THEMES}
    back_inc = {f"{BACK_INV}.{bid}": 1 for bid in BACKS}
    r = db.users.update_one(
        {"id": UID},
        {
            "$addToSet": {
                THEME_OWNED: {"$each": THEMES},
                BJ_OWNED: {"$each": BACKS},
            },
            "$inc": {**theme_inc, **back_inc},
        },
    )
    u = db.users.find_one(
        {"id": UID},
        {"_id": 0, "username": 1, THEME_OWNED: 1, BJ_OWNED: 1, THEME_INV: 1, BACK_INV: 1},
    )
    t_inv = (u or {}).get(THEME_INV) or {}
    b_inv = (u or {}).get(BACK_INV) or {}
    print(
        "ok",
        (u or {}).get("username"),
        "matched",
        r.matched_count,
        "modified",
        r.modified_count,
        "themes_owned",
        len((u or {}).get(THEME_OWNED) or []),
        "backs_owned",
        len((u or {}).get(BJ_OWNED) or []),
        "theme_inv",
        len([k for k, v in t_inv.items() if int(v or 0) > 0]),
        "back_inv",
        len([k for k, v in b_inv.items() if int(v or 0) > 0]),
    )
    return 0 if r.matched_count else 1


if __name__ == "__main__":
    raise SystemExit(main())
