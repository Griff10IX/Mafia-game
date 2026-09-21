"""Season 6 Game Pass dossier themes — £15 VIP + free track (not Prestige)."""
from __future__ import annotations

from typing import Any, Dict, Optional

# Free track (5) — tiers 20/40/60/80/100
GP_S6_FREE_THEME_BY_TIER: Dict[int, str] = {
    20: "gp_s6_quagmire",
    40: "gp_s6_patrick_finger",
    60: "gp_s6_risitas",
    80: "gp_s6_hasbulla_sideeye",
    100: "gp_s6_nebula_c",
}

# VIP / £15 track (19) — spaced 15→100
GP_S6_VIP_THEME_BY_TIER: Dict[int, str] = {
    15: "gp_s6_joker_me",
    19: "gp_s6_godfather",
    24: "gp_s6_peaky",
    28: "gp_s6_vader_still",
    32: "gp_s6_vader_mist",
    36: "gp_s6_stormtrooper_dance",
    40: "gp_s6_joker_nurse",
    44: "gp_s6_hasbulla_stare",
    48: "gp_s6_blobby",
    52: "gp_s6_nebula_a",
    56: "gp_s6_nebula_b",
    60: "gp_s6_patrick_scheme",
    64: "gp_s6_wanderlust",
    68: "gp_s6_dump_01",
    72: "gp_s6_dump_02",
    76: "gp_s6_dump_03",
    82: "gp_s6_dump_04",
    90: "gp_s6_dump_05",
    100: "gp_s6_dump_06",
}

GP_S6_THEME_META: Dict[str, Dict[str, Any]] = {
    "gp_s6_quagmire": {"name": "Quagmire Nod", "file_stem": "gp-s6-quagmire"},
    "gp_s6_patrick_finger": {"name": "Patrick Contemplates", "file_stem": "gp-s6-patrick-finger"},
    "gp_s6_risitas": {"name": "El Risitas", "file_stem": "gp-s6-risitas"},
    "gp_s6_hasbulla_sideeye": {"name": "Hasbulla Side-Eye", "file_stem": "gp-s6-hasbulla-sideeye"},
    "gp_s6_nebula_c": {"name": "Nebula Drift", "file_stem": "gp-s6-nebula-c"},
    "gp_s6_joker_me": {"name": "Joker — Me", "file_stem": "gp-s6-joker-me"},
    "gp_s6_godfather": {"name": "The Don", "file_stem": "gp-s6-godfather"},
    "gp_s6_peaky": {"name": "Peaky Blinders", "file_stem": "gp-s6-peaky"},
    "gp_s6_vader_still": {"name": "Darth Vader", "file_stem": "gp-s6-vader-still"},
    "gp_s6_vader_mist": {"name": "Vader in the Mist", "file_stem": "gp-s6-vader-mist"},
    "gp_s6_stormtrooper_dance": {"name": "Stormtrooper Dance", "file_stem": "gp-s6-stormtrooper-dance"},
    "gp_s6_joker_nurse": {"name": "Joker Nurse", "file_stem": "gp-s6-joker-nurse"},
    "gp_s6_hasbulla_stare": {"name": "Hasbulla Stare", "file_stem": "gp-s6-hasbulla-stare"},
    "gp_s6_blobby": {"name": "Mr Blobby", "file_stem": "gp-s6-blobby"},
    "gp_s6_nebula_a": {"name": "Nebula Core", "file_stem": "gp-s6-nebula-a"},
    "gp_s6_nebula_b": {"name": "Nebula Spark", "file_stem": "gp-s6-nebula-b"},
    "gp_s6_patrick_scheme": {"name": "Patrick Scheming", "file_stem": "gp-s6-patrick-scheme"},
    "gp_s6_wanderlust": {"name": "Wanderlust", "file_stem": "gp-s6-wanderlust"},
    "gp_s6_dump_01": {"name": "Season 6 Theme I", "file_stem": "gp-s6-dump-01"},
    "gp_s6_dump_02": {"name": "Season 6 Theme II", "file_stem": "gp-s6-dump-02"},
    "gp_s6_dump_03": {"name": "Season 6 Theme III", "file_stem": "gp-s6-dump-03"},
    "gp_s6_dump_04": {"name": "Season 6 Theme IV", "file_stem": "gp-s6-dump-04"},
    "gp_s6_dump_05": {"name": "Season 6 Theme V", "file_stem": "gp-s6-dump-05"},
    "gp_s6_dump_06": {"name": "Season 6 Theme VI", "file_stem": "gp-s6-dump-06"},
}

ALL_GP_S6_THEME_IDS = tuple(GP_S6_THEME_META.keys())


def theme_for_vip_micro_tier(micro_tier: int, *, profile_key: Optional[str] = None) -> Optional[str]:
    if profile_key is not None and profile_key != "v6":
        return None
    try:
        t = int(micro_tier or 0)
    except Exception:
        return None
    return GP_S6_VIP_THEME_BY_TIER.get(t)


def theme_for_free_micro_tier(micro_tier: int, *, profile_key: Optional[str] = None) -> Optional[str]:
    if profile_key is not None and profile_key != "v6":
        return None
    try:
        t = int(micro_tier or 0)
    except Exception:
        return None
    return GP_S6_FREE_THEME_BY_TIER.get(t)


def game_pass_s6_theme_display_name(theme_id: str) -> str:
    meta = GP_S6_THEME_META.get(str(theme_id) or "")
    if meta and meta.get("name"):
        return str(meta["name"])
    return str(theme_id or "").replace("gp_s6_", "").replace("_", " ").title()
