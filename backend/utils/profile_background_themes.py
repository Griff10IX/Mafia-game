"""Loot-style profile dossier background themes (own + equip separately)."""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Set

# Canonical dossier banner bitmap — every theme JPEG must be exactly this size.
# CSS: .prof-dossier-theme-bg uses width-fit (100% auto). See
# public/images/profile-themes/README.md and scripts/check_profile_theme_images.py.
THEME_IMAGE_WIDTH = 1024
THEME_IMAGE_HEIGHT = 931
THEME_IMAGE_SIZE = (THEME_IMAGE_WIDTH, THEME_IMAGE_HEIGHT)  # (w, h)

# Admin-only test upload (not in public loot catalog).
CUSTOM_THEME_ID = "admin_custom"
CUSTOM_URL_FIELD = "profile_background_custom_url"
CUSTOM_THEME_NAME = "Admin custom (test)"

# Catalog: hard-to-get themes (loot later). Image paths are public static assets.
# ?v= cache-bust when art is replaced.
# fit: width = natural-aspect banner (default); stretch = fill whole dossier.
_THEME_ASSET_V = "20260921gp6"
PROFILE_BACKGROUND_THEMES: Dict[str, Dict[str, Any]] = {
    "godfather": {
        "id": "godfather",
        "name": "Godfather 1 — Legacy",
        "image": f"/images/profile-themes/godfather-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "godfather_empire": {
        "id": "godfather_empire",
        "name": "Godfather 2 — Empire",
        "image": f"/images/profile-themes/godfather-empire-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "halloween_heist": {
        "id": "halloween_heist",
        "name": "Halloween Heist",
        "image": f"/images/profile-themes/halloween-heist-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "ronin_fuji": {
        "id": "ronin_fuji",
        "name": "Ronin Fuji",
        "image": f"/images/profile-themes/ronin-fuji-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "london_snow": {
        "id": "london_snow",
        "name": "London Snow",
        "image": f"/images/profile-themes/london-snow-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "orbit_overlook": {
        "id": "orbit_overlook",
        "name": "Orbit Overlook",
        "image": f"/images/profile-themes/orbit-overlook-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    # Ultra Rare loot exclusives (1 live player copy each; staff/admin ownership ignored for scarcity).
    "ur_samurai_fuji": {
        "id": "ur_samurai_fuji",
        "name": "Samurai Fuji",
        "image": f"/images/profile-themes/ur-samurai-fuji.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "rp_50",
        "bonus_label": "+50% rank points from crimes, GTA, OC, and missions",
    },
    "ur_orbit_overlook": {
        "id": "ur_orbit_overlook",
        "name": "Deep Orbit",
        "image": f"/images/profile-themes/ur-orbit-overlook.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "gta_multi_rare",
        "bonus_label": "GTA rare/legendary: 50% chance to receive 5 cars instead of 1",
    },
    "ur_noir_balcony": {
        "id": "ur_noir_balcony",
        "name": "Noir Balcony",
        "image": f"/images/profile-themes/ur-noir-balcony.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "hitlist_npc_x3",
        "bonus_label": "Hitlist NPC kill: 50% chance for ×3 reward",
    },
    "ur_jungle_explorer": {
        "id": "ur_jungle_explorer",
        "name": "Lost City",
        "image": f"/images/profile-themes/ur-jungle-explorer.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "crime_cash_double",
        "bonus_label": "Crimes success: 50% chance to double cash",
    },
    "ur_cyber_oni": {
        "id": "ur_cyber_oni",
        "name": "Cyber Oni",
        "image": f"/images/profile-themes/ur-cyber-oni.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "bullets_needed_15",
        "bonus_label": "−15% bullets needed to kill",
    },
    "ur_blood_moon": {
        "id": "ur_blood_moon",
        "name": "Blood Moon Hunter",
        "image": f"/images/profile-themes/ur-blood-moon.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "hitlist_cash_50",
        "bonus_label": "+50% hitlist NPC cash",
    },
    "ur_space_hangar": {
        "id": "ur_space_hangar",
        "name": "Space Hangar",
        "image": f"/images/profile-themes/ur-space-hangar.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "travel_cost_50",
        "bonus_label": "−50% airport travel cost",
    },
    "ur_colony_ring": {
        "id": "ur_colony_ring",
        "name": "Colony Ring",
        "image": f"/images/profile-themes/ur-colony-ring.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "income_25",
        "bonus_label": "+25% property and illegal business income",
    },
    "ur_mob_office_dog": {
        "id": "ur_mob_office_dog",
        "name": "Mob Office",
        "image": f"/images/profile-themes/ur-mob-office-dog.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "robot_free_daily",
        "bonus_label": "+1 free Robot Bodyguard hire / day (stacks to 5)",
    },
    "ur_inner_circle": {
        "id": "ur_inner_circle",
        "name": "Inner Circle",
        "image": f"/images/profile-themes/ur-inner-circle.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "oc_payout_25",
        "bonus_label": "+25% OC heist payout",
    },
    "ur_vittoria_club": {
        "id": "ur_vittoria_club",
        "name": "Vittoria Social Club",
        "image": f"/images/profile-themes/ur-vittoria-club.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "weed_payout_25",
        "bonus_label": "+25% Weed Empire sell / payout",
    },
    "ur_empire_lounge": {
        "id": "ur_empire_lounge",
        "name": "Empire State Lounge",
        "image": f"/images/profile-themes/ur-empire-lounge.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "loot_exclusive": True,
        "ultra_rare_only": True,
        "bonus_id": "heist_loot_piece",
        "bonus_label": "Jewelry / Bank / Casino Heist success: 0.25% chance for 1 loot piece",
    },
    # Grave Robber exclusives (1 live player copy each; dig drop; return on death).
    "gr_grave_haul": {
        "id": "gr_grave_haul",
        "name": "Grave Haul",
        "image": f"/images/profile-themes/gr-grave-haul.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "grave_robber_exclusive": True,
        "bonus_id": "gr_dig_15",
        "bonus_label": "+15% Grave Robber dig rewards (equip; own all 3 Grave themes → +90%)",
    },
    "gr_tommy_map": {
        "id": "gr_tommy_map",
        "name": "Tommy's Map",
        "image": f"/images/profile-themes/gr-tommy-map.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "grave_robber_exclusive": True,
        "bonus_id": "gr_dig_25",
        "bonus_label": "+25% Grave Robber dig rewards (equip; own all 3 Grave themes → +90%)",
    },
    "gr_lion_vault": {
        "id": "gr_lion_vault",
        "name": "Lion's Vault",
        "image": f"/images/profile-themes/gr-lion-vault.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "grave_robber_exclusive": True,
        "bonus_id": "gr_dig_50",
        "bonus_label": "+50% Grave Robber dig rewards (equip; own all 3 Grave themes → +90%)",
    },
    # Game Pass Season 6 (£15 VIP / free track — not Prestige, not loot-exclusive)
    "gp_s6_quagmire": {
        "id": "gp_s6_quagmire",
        "name": "Quagmire Nod",
        "image": f"/images/profile-themes/gp-s6-quagmire.gif?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_patrick_finger": {
        "id": "gp_s6_patrick_finger",
        "name": "Patrick Contemplates",
        "image": f"/images/profile-themes/gp-s6-patrick-finger.gif?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_risitas": {
        "id": "gp_s6_risitas",
        "name": "El Risitas",
        "image": f"/images/profile-themes/gp-s6-risitas.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_hasbulla_sideeye": {
        "id": "gp_s6_hasbulla_sideeye",
        "name": "Hasbulla Side-Eye",
        "image": f"/images/profile-themes/gp-s6-hasbulla-sideeye.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_nebula_c": {
        "id": "gp_s6_nebula_c",
        "name": "Nebula Drift",
        "image": f"/images/profile-themes/gp-s6-nebula-c.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_joker_me": {
        "id": "gp_s6_joker_me",
        "name": "Joker — Me",
        "image": f"/images/profile-themes/gp-s6-joker-me.gif?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_godfather": {
        "id": "gp_s6_godfather",
        "name": "The Don",
        "image": f"/images/profile-themes/gp-s6-godfather.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_peaky": {
        "id": "gp_s6_peaky",
        "name": "Peaky Blinders",
        "image": f"/images/profile-themes/gp-s6-peaky.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_vader_still": {
        "id": "gp_s6_vader_still",
        "name": "Darth Vader",
        "image": f"/images/profile-themes/gp-s6-vader-still.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_vader_mist": {
        "id": "gp_s6_vader_mist",
        "name": "Vader in the Mist",
        "image": f"/images/profile-themes/gp-s6-vader-mist.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_stormtrooper_dance": {
        "id": "gp_s6_stormtrooper_dance",
        "name": "Stormtrooper Dance",
        "image": f"/images/profile-themes/gp-s6-stormtrooper-dance.gif?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_joker_nurse": {
        "id": "gp_s6_joker_nurse",
        "name": "Joker Nurse",
        "image": f"/images/profile-themes/gp-s6-joker-nurse.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_hasbulla_stare": {
        "id": "gp_s6_hasbulla_stare",
        "name": "Hasbulla Stare",
        "image": f"/images/profile-themes/gp-s6-hasbulla-stare.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_blobby": {
        "id": "gp_s6_blobby",
        "name": "Mr Blobby",
        "image": f"/images/profile-themes/gp-s6-blobby.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_nebula_a": {
        "id": "gp_s6_nebula_a",
        "name": "Nebula Core",
        "image": f"/images/profile-themes/gp-s6-nebula-a.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_nebula_b": {
        "id": "gp_s6_nebula_b",
        "name": "Nebula Spark",
        "image": f"/images/profile-themes/gp-s6-nebula-b.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_patrick_scheme": {
        "id": "gp_s6_patrick_scheme",
        "name": "Patrick Scheming",
        "image": f"/images/profile-themes/gp-s6-patrick-scheme.gif?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_wanderlust": {
        "id": "gp_s6_wanderlust",
        "name": "Wanderlust",
        "image": f"/images/profile-themes/gp-s6-wanderlust.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_dump_01": {
        "id": "gp_s6_dump_01",
        "name": "Season 6 Theme I",
        "image": f"/images/profile-themes/gp-s6-dump-01.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_dump_02": {
        "id": "gp_s6_dump_02",
        "name": "Season 6 Theme II",
        "image": f"/images/profile-themes/gp-s6-dump-02.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_dump_03": {
        "id": "gp_s6_dump_03",
        "name": "Season 6 Theme III",
        "image": f"/images/profile-themes/gp-s6-dump-03.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_dump_04": {
        "id": "gp_s6_dump_04",
        "name": "Season 6 Theme IV",
        "image": f"/images/profile-themes/gp-s6-dump-04.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_dump_05": {
        "id": "gp_s6_dump_05",
        "name": "Season 6 Theme V",
        "image": f"/images/profile-themes/gp-s6-dump-05.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
    "gp_s6_dump_06": {
        "id": "gp_s6_dump_06",
        "name": "Season 6 Theme VI",
        "image": f"/images/profile-themes/gp-s6-dump-06.gif?v={_THEME_ASSET_V}",
        "fit": "width",
        "game_pass_season6": True,
    },
}

UR_LOOT_THEME_IDS = tuple(
    tid for tid, meta in PROFILE_BACKGROUND_THEMES.items() if meta.get("ultra_rare_only")
)
GRAVE_ROBBER_THEME_IDS = tuple(
    tid for tid, meta in PROFILE_BACKGROUND_THEMES.items() if meta.get("grave_robber_exclusive")
)
# 1/1 player-pool themes that return on death (loot UR + grave digger).
SCARCE_THEME_IDS = tuple(dict.fromkeys(list(UR_LOOT_THEME_IDS) + list(GRAVE_ROBBER_THEME_IDS)))

# Equipped dig bonus % (fraction). Owning all three stacks to 0.90.
GRAVE_THEME_DIG_BONUS: Dict[str, float] = {
    "gr_grave_haul": 0.15,
    "gr_tommy_map": 0.25,
    "gr_lion_vault": 0.50,
}

OWNED_FIELD = "profile_background_themes_owned"
EQUIPPED_FIELD = "profile_background_theme_id"

# Stable edit-profile order when granting / listing.
THEME_DISPLAY_ORDER = tuple(PROFILE_BACKGROUND_THEMES.keys())

_SAFE_USER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,80}$")


def catalog_theme(theme_id: Optional[str]) -> Optional[Dict[str, Any]]:
    tid = (theme_id or "").strip().lower()
    if not tid or tid == CUSTOM_THEME_ID:
        return None
    t = PROFILE_BACKGROUND_THEMES.get(tid)
    if not t:
        return None
    out: Dict[str, Any] = dict(t)
    out["width"] = THEME_IMAGE_WIDTH
    out["height"] = THEME_IMAGE_HEIGHT
    return out


def ur_loot_theme_reward_info_rows() -> List[Dict[str, Any]]:
    """Public exclusives list rows for UR themes (no drop %)."""
    rows: List[Dict[str, Any]] = []
    for tid in UR_LOOT_THEME_IDS:
        meta = PROFILE_BACKGROUND_THEMES.get(tid) or {}
        rows.append({
            "id": f"theme_{tid}",
            "theme_id": tid,
            "label": f"{meta.get('name') or tid} (Ultra Rare theme)",
            "bonus_label": meta.get("bonus_label") or "",
            "cap_global": 1,
        })
    return rows


def is_ur_loot_theme(theme_id: Optional[str]) -> bool:
    tid = str(theme_id or "").strip().lower()
    return tid in UR_LOOT_THEME_IDS


# GhostFace admin account — always ignored for 1/1 UR theme scarcity (same idea as BAR admin_grant).
_GHOSTFACE_USER_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"


async def _staff_ids_excluded_from_theme_pool(db, staff_user_ids: Optional[Set[str]] = None) -> List[Any]:
    """Staff + GhostFace ids that must not consume UR theme loot slots."""
    staff: Set[str] = set(str(x) for x in (staff_user_ids or ()) if x)
    if not staff:
        try:
            from server import _get_staff_user_ids

            staff.update(str(x) for x in (await _get_staff_user_ids(db)) if x)
        except Exception:
            pass
    staff.add(_GHOSTFACE_USER_ID)
    from server import expand_user_ids_for_mongo_nin

    return expand_user_ids_for_mongo_nin(list(staff))


async def theme_player_claimed_live(db, theme_id: str, *, staff_user_ids: Optional[Set[str]] = None) -> int:
    """1 if a non-staff player owns this scarce theme. Staff/admin (e.g. GhostFace) do not block the pool."""
    tid = str(theme_id or "").strip().lower()
    if tid not in SCARCE_THEME_IDS:
        return 0
    q: Dict[str, Any] = {OWNED_FIELD: tid}
    excluded = await _staff_ids_excluded_from_theme_pool(db, staff_user_ids)
    if excluded:
        q["id"] = {"$nin": excluded}
    n = int(await db.users.count_documents(q))
    return 1 if n > 0 else 0


async def list_available_ur_themes_for_loot(db, *, staff_user_ids: Optional[Set[str]] = None) -> List[str]:
    out: List[str] = []
    for tid in UR_LOOT_THEME_IDS:
        if await theme_player_claimed_live(db, tid, staff_user_ids=staff_user_ids) < 1:
            out.append(tid)
    return out


async def list_available_grave_themes_for_dig(db, *, staff_user_ids: Optional[Set[str]] = None) -> List[str]:
    out: List[str] = []
    for tid in GRAVE_ROBBER_THEME_IDS:
        if await theme_player_claimed_live(db, tid, staff_user_ids=staff_user_ids) < 1:
            out.append(tid)
    return out


async def grant_ur_theme_to_user(db, user_id: str, theme_id: str, *, count_toward_pool: bool = True) -> Optional[Dict[str, Any]]:
    """Grant theme ownership. Staff ownership never blocks the player pool (staff ids are $nin'd)."""
    tid = str(theme_id or "").strip().lower()
    meta = PROFILE_BACKGROUND_THEMES.get(tid)
    if not meta:
        return None
    await db.users.update_one({"id": user_id}, {"$addToSet": {OWNED_FIELD: tid}})
    return {
        "type": "profile_theme",
        "id": tid,
        "name": meta.get("name") or tid,
        "bonus_label": meta.get("bonus_label") or "",
        "rarity": "loot_exclusive",
        "reward_tier": "loot_exclusive",
        "image": meta.get("image"),
        "grave_robber_exclusive": bool(meta.get("grave_robber_exclusive")),
    }


async def release_ur_themes_on_death(db, user_id: str) -> List[str]:
    """Strip scarce themes (UR loot + Grave Robber) so they return to the player pool."""
    u = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, OWNED_FIELD: 1, EQUIPPED_FIELD: 1},
    ) or {}
    owned = owned_theme_ids(u)
    scarce_owned = [t for t in owned if t in SCARCE_THEME_IDS]
    if not scarce_owned:
        return []
    remaining = [t for t in owned if t not in SCARCE_THEME_IDS]
    equipped = str(u.get(EQUIPPED_FIELD) or "").strip().lower()
    update: Dict[str, Any] = {"$set": {OWNED_FIELD: remaining}}
    if equipped in scarce_owned:
        update["$unset"] = {EQUIPPED_FIELD: ""}
    await db.users.update_one({"id": user_id}, update)
    return scarce_owned


def grave_robber_dig_reward_mult(user: Optional[dict]) -> float:
    """1.0 + dig bonus. Equip one theme for its %; own all three → +90%."""
    if not user:
        return 1.0
    owned = set(owned_theme_ids(user))
    gr_owned = [tid for tid in GRAVE_ROBBER_THEME_IDS if tid in owned]
    if len(gr_owned) >= 3:
        return 1.90
    eq = str(user.get(EQUIPPED_FIELD) or "").strip().lower()
    pct = GRAVE_THEME_DIG_BONUS.get(eq)
    if pct is None:
        return 1.0
    return 1.0 + float(pct)


def catalog_theme_bonus_fields(theme: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not theme:
        return {}
    out: Dict[str, Any] = {}
    if theme.get("bonus_label"):
        out["bonus_label"] = theme.get("bonus_label")
    if theme.get("bonus_id"):
        out["bonus_id"] = theme.get("bonus_id")
    return out


def custom_theme_payload(image_url: Optional[str] = None) -> Dict[str, Any]:
    url = (image_url or "").strip()
    return {
        "id": CUSTOM_THEME_ID,
        "name": CUSTOM_THEME_NAME,
        "image": url,
        "fit": "width",
        "width": THEME_IMAGE_WIDTH,
        "height": THEME_IMAGE_HEIGHT,
        "custom": True,
    }


def custom_image_url(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    url = str(user.get(CUSTOM_URL_FIELD) or "").strip()
    return url or None


def owned_theme_ids(user: Optional[dict]) -> List[str]:
    if not user:
        return []
    raw = user.get(OWNED_FIELD) or []
    if not isinstance(raw, list):
        return []
    seen = set()
    collected: List[str] = []
    for x in raw:
        tid = str(x or "").strip().lower()
        if not tid or tid in seen or tid not in PROFILE_BACKGROUND_THEMES:
            continue
        seen.add(tid)
        collected.append(tid)
    # Prefer catalog order for the Profile themes picker.
    ordered = [tid for tid in THEME_DISPLAY_ORDER if tid in seen]
    for tid in collected:
        if tid not in ordered:
            ordered.append(tid)
    return ordered


def user_owns_theme(user: Optional[dict], theme_id: Optional[str], *, is_admin: bool = False) -> bool:
    tid = (theme_id or "").strip().lower()
    if not tid:
        return False
    if tid == CUSTOM_THEME_ID:
        return bool(is_admin and custom_image_url(user))
    return tid in owned_theme_ids(user)


def equipped_theme_id(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    tid = str(user.get(EQUIPPED_FIELD) or "").strip().lower()
    if not tid:
        return None
    if tid == CUSTOM_THEME_ID:
        return CUSTOM_THEME_ID if custom_image_url(user) else None
    if tid not in PROFILE_BACKGROUND_THEMES:
        return None
    if not user_owns_theme(user, tid):
        return None
    return tid


def resolve_equipped_theme(user: Optional[dict]) -> Optional[Dict[str, Any]]:
    tid = equipped_theme_id(user)
    if not tid:
        return None
    if tid == CUSTOM_THEME_ID:
        return custom_theme_payload(custom_image_url(user))
    return catalog_theme(tid)


def profile_background_public_fields(
    user: Optional[dict],
    *,
    include_owned: bool = False,
    is_admin: bool = False,
) -> Dict[str, Any]:
    """Public dossier fields. Own list only for self (/auth/me or own profile edit)."""
    eq = equipped_theme_id(user)
    theme = resolve_equipped_theme(user)
    out: Dict[str, Any] = {
        "profile_background_theme_id": eq,
        "profile_background_theme": theme,
        # Default on (darken). Owner can disable for true-colour art.
        "profile_theme_scrim": False if user and user.get("profile_theme_scrim") is False else True,
    }
    if include_owned:
        owned = owned_theme_ids(user)
        themes = [catalog_theme(t) for t in owned if catalog_theme(t)]
        if is_admin:
            themes.append(custom_theme_payload(custom_image_url(user)))
            if CUSTOM_THEME_ID not in owned:
                owned = list(owned) + [CUSTOM_THEME_ID]
        out["profile_background_themes_owned"] = owned
        out["profile_background_themes"] = themes
        out["profile_background_theme_can_upload"] = bool(is_admin)
    return out


def normalize_equip_theme_id(raw: Optional[str]) -> Optional[str]:
    """Empty / none / null -> unequip. Else must be a known catalog id or admin_custom."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or s in ("none", "null", "off", "default"):
        return None
    if s == CUSTOM_THEME_ID:
        return CUSTOM_THEME_ID
    if s not in PROFILE_BACKGROUND_THEMES:
        raise ValueError("Unknown profile background theme")
    return s


def custom_theme_upload_dir(root_dir: Path) -> Path:
    return Path(root_dir) / "uploads" / "profile_themes"


def custom_theme_file_path(root_dir: Path, user_id: str, *, ext: str = "jpg") -> Path:
    uid = str(user_id or "").strip()
    if not _SAFE_USER_ID_RE.match(uid):
        raise ValueError("Invalid user id")
    e = str(ext or "jpg").strip().lower().lstrip(".")
    if e not in ("jpg", "jpeg", "png", "webp", "gif"):
        e = "jpg"
    return custom_theme_upload_dir(root_dir) / f"{uid}.{e}"


def find_custom_theme_file(root_dir: Path, user_id: str) -> Optional[Path]:
    """Prefer animated gif, then static formats."""
    for ext in ("gif", "jpg", "jpeg", "webp", "png"):
        try:
            p = custom_theme_file_path(root_dir, user_id, ext=ext)
        except ValueError:
            return None
        if p.is_file():
            return p
    return None


def _cover_crop_rgb(im: Any, tw: int, th: int) -> Any:
    from PIL import Image

    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in (im.mode or "") else "RGB")
    sw, sh = im.size
    if sw < 1 or sh < 1:
        raise ValueError("Invalid image dimensions")
    scale = max(tw / sw, th / sh)
    nw = max(tw, int(round(sw * scale)))
    nh = max(th, int(round(sh * scale)))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - tw) // 2)
    top = max(0, (nh - th) // 2)
    return im.crop((left, top, left + tw, top + th))


def encode_theme_jpeg(raw: bytes) -> Tuple[bytes, str]:
    """Back-compat: always return JPEG bytes (first frame if GIF). Prefer encode_theme_image."""
    data, mime, _ext = encode_theme_image(raw, prefer_gif=False)
    return data, mime


def encode_theme_image(raw: bytes, *, prefer_gif: bool = True) -> Tuple[bytes, str, str]:
    """Validate upload and encode a center cover-crop at THEME_IMAGE_SIZE.

    Animated GIFs keep animation (resized per frame). Other formats become JPEG.
    Returns (bytes, mime, file_ext).
    """
    from PIL import Image, ImageSequence

    from utils.image_upload_security import sniff_image_mime, verify_image_magic_bytes

    if not raw:
        raise ValueError("Invalid or empty image file")
    ok, err = verify_image_magic_bytes(raw, None)
    if not ok:
        raise ValueError(err or "Invalid image")
    mime = sniff_image_mime(raw)
    if not mime:
        raise ValueError("Invalid image type")
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as e:
        raise ValueError("Could not read image") from e

    tw, th = THEME_IMAGE_WIDTH, THEME_IMAGE_HEIGHT
    is_gif = bool(prefer_gif and mime == "image/gif" and getattr(im, "is_animated", False) and int(getattr(im, "n_frames", 1) or 1) > 1)

    if is_gif:
        frames = []
        durations = []
        try:
            for frame in ImageSequence.Iterator(im):
                fr = _cover_crop_rgb(frame.copy(), tw, th)
                # GIF palette path — quantize via adaptive
                if fr.mode == "RGBA":
                    bg = Image.new("RGBA", fr.size, (0, 0, 0, 255))
                    bg.paste(fr, mask=fr.split()[3])
                    fr = bg.convert("RGB")
                else:
                    fr = fr.convert("RGB")
                frames.append(fr.convert("P", palette=Image.Palette.ADAPTIVE, colors=255))
                durations.append(int(frame.info.get("duration") or 100))
        except Exception as e:
            raise ValueError("Could not process animated GIF") from e
        if not frames:
            raise ValueError("Could not process animated GIF")
        buf = io.BytesIO()
        frames[0].save(
            buf,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=int(im.info.get("loop") or 0),
            optimize=False,
            disposal=2,
        )
        return buf.getvalue(), "image/gif", "gif"

    # Static: JPEG (works for jpeg/png/webp/single-frame gif)
    cropped = _cover_crop_rgb(im, tw, th).convert("RGB")
    buf = io.BytesIO()
    cropped.save(buf, format="JPEG", quality=92, optimize=True)
    return buf.getvalue(), "image/jpeg", "jpg"
