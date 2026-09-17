"""Internal table-sampler knobs (admin-only). Never expose via public casino APIs."""

from __future__ import annotations

import random
import time
from copy import deepcopy
from typing import Any, Dict, Optional

# Opaque game_settings key — looks like telemetry, not casino bias.
_SETTINGS_KEY = "mw_ts_v1"

GAMES = ("dice", "roulette", "videopoker", "blackjack")

# Defaults match prior hardcoded rates; boost (force-win) off until enabled in admin.
_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "dice": {"suppress_on": True, "suppress_p": 0.15, "boost_on": False, "boost_p": 0.0},
    "roulette": {"suppress_on": True, "suppress_p": 0.07, "boost_on": False, "boost_p": 0.0},
    "videopoker": {"suppress_on": True, "suppress_p": 0.07, "boost_on": False, "boost_p": 0.0},
    "blackjack": {"suppress_on": True, "suppress_p": 0.07, "boost_on": False, "boost_p": 0.0},
}

_cache: Optional[tuple] = None  # (cfg_dict, expires_at_monotonic)
_rng = random.SystemRandom()


def _clamp_p(v: Any, fallback: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return float(fallback)
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _normalize_game(raw: Any, fallback: Dict[str, Any]) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    return {
        "suppress_on": bool(src.get("suppress_on", fallback["suppress_on"])),
        "suppress_p": _clamp_p(src.get("suppress_p", fallback["suppress_p"]), fallback["suppress_p"]),
        "boost_on": bool(src.get("boost_on", fallback["boost_on"])),
        "boost_p": _clamp_p(src.get("boost_p", fallback["boost_p"]), fallback["boost_p"]),
    }


def default_config() -> Dict[str, Dict[str, Any]]:
    return {g: dict(_DEFAULTS[g]) for g in GAMES}


def _merge_stored(raw: Any) -> Dict[str, Dict[str, Any]]:
    base = default_config()
    if not isinstance(raw, dict):
        return base
    out = {}
    for g in GAMES:
        out[g] = _normalize_game(raw.get(g), base[g])
    return out


def should_fire(on: bool, p: float) -> bool:
    """True when an optional post-outcome remap should apply."""
    return _fire(bool(on), float(p or 0.0))


async def load_mw_ts(db, *, ttl_sec: float = 8.0) -> Dict[str, Dict[str, Any]]:
    """Effective knobs for dice / roulette / videopoker / blackjack. Short TTL cache."""
    global _cache
    now = time.monotonic()
    if ttl_sec > 0 and _cache is not None:
        cached, exp = _cache
        if now < exp:
            return deepcopy(cached)

    doc = await db.game_settings.find_one({"key": _SETTINGS_KEY}, {"_id": 0, "value": 1})
    cfg = _merge_stored((doc or {}).get("value"))
    if ttl_sec > 0:
        _cache = (cfg, now + ttl_sec)
    return deepcopy(cfg)


def invalidate_mw_ts_cache() -> None:
    global _cache
    _cache = None


async def save_mw_ts(db, cfg: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    merged = _merge_stored(cfg)
    await db.game_settings.update_one(
        {"key": _SETTINGS_KEY},
        {"$set": {"key": _SETTINGS_KEY, "value": merged}},
        upsert=True,
    )
    invalidate_mw_ts_cache()
    return await load_mw_ts(db, ttl_sec=0.0)


def admin_public_view(cfg: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Admin API shape (clear labels). Never return this from player casino routes."""
    games = {}
    for g in GAMES:
        row = cfg.get(g) or _DEFAULTS[g]
        games[g] = {
            "miss_enabled": bool(row["suppress_on"]),
            "miss_chance_pct": round(float(row["suppress_p"]) * 100.0, 4),
            "hit_enabled": bool(row["boost_on"]),
            "hit_chance_pct": round(float(row["boost_p"]) * 100.0, 4),
        }
    return {"games": games, "defaults": admin_public_view_defaults()}


def admin_public_view_defaults() -> Dict[str, Any]:
    out = {}
    for g in GAMES:
        row = _DEFAULTS[g]
        out[g] = {
            "miss_enabled": bool(row["suppress_on"]),
            "miss_chance_pct": round(float(row["suppress_p"]) * 100.0, 4),
            "hit_enabled": bool(row["boost_on"]),
            "hit_chance_pct": round(float(row["boost_p"]) * 100.0, 4),
        }
    return out


def merge_admin_patch(existing: Dict[str, Dict[str, Any]], patch_games: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Convert admin miss/hit % fields into stored suppress/boost fractions."""
    out = default_config()
    for g in GAMES:
        out[g] = dict(existing.get(g) or _DEFAULTS[g])
    if not isinstance(patch_games, dict):
        return out
    for g, raw in patch_games.items():
        if g not in GAMES or not isinstance(raw, dict):
            continue
        cur = dict(out[g])
        if "miss_enabled" in raw:
            cur["suppress_on"] = bool(raw["miss_enabled"])
        if "hit_enabled" in raw:
            cur["boost_on"] = bool(raw["hit_enabled"])
        if "miss_chance_pct" in raw:
            try:
                cur["suppress_p"] = _clamp_p(float(raw["miss_chance_pct"]) / 100.0, cur["suppress_p"])
            except (TypeError, ValueError):
                pass
        if "hit_chance_pct" in raw:
            try:
                cur["boost_p"] = _clamp_p(float(raw["hit_chance_pct"]) / 100.0, cur["boost_p"])
            except (TypeError, ValueError):
                pass
        out[g] = _normalize_game(cur, _DEFAULTS[g])
    return out


def _fire(on: bool, p: float) -> bool:
    return bool(on) and p > 0.0 and _rng.random() < p


def dice_calibrated_roll(sides: int, chosen: int, game_cfg: Dict[str, Any]) -> tuple:
    """Fair roll, then optional suppress (void hit) or boost (force hit). Returns (display, win, faces)."""
    roll = _rng.randint(1, int(sides))
    win = roll == chosen
    if win and _fire(game_cfg.get("suppress_on"), float(game_cfg.get("suppress_p") or 0)):
        display = chosen
        while display == chosen:
            display = _rng.randint(1, int(sides))
        return display, False, sides
    if (not win) and _fire(game_cfg.get("boost_on"), float(game_cfg.get("boost_p") or 0)):
        return chosen, True, sides
    return roll, win, sides


def roulette_calibrated_result(
    fair_result: int,
    bets,
    game_cfg: Dict[str, Any],
    *,
    any_win_fn,
) -> int:
    """Optional suppress (remap paying spin) or boost (remap dead spin to a payer)."""
    paying = bool(bets) and bool(any_win_fn(bets, fair_result))
    if paying and _fire(game_cfg.get("suppress_on"), float(game_cfg.get("suppress_p") or 0)):
        for _ in range(64):
            alt = _rng.randint(0, 36)
            if not any_win_fn(bets, alt):
                return alt
        return fair_result
    if (not paying) and bets and _fire(game_cfg.get("boost_on"), float(game_cfg.get("boost_p") or 0)):
        for _ in range(64):
            alt = _rng.randint(0, 36)
            if any_win_fn(bets, alt):
                return alt
        return fair_result
    return fair_result


def videopoker_calibrated_draw(
    hand: list,
    held_idx: set,
    deck: list,
    game_cfg: Dict[str, Any],
    *,
    draw_once_fn,
    hand_pays_fn,
) -> list:
    """Fair draw; optional suppress (void payer) or boost (force payer). Hold-all is a no-op."""
    swap_indices = [i for i in range(5) if i not in held_idx]
    if not swap_indices:
        return hand

    new_hand, remaining = draw_once_fn(hand, swap_indices, deck)
    pays = hand_pays_fn(new_hand)

    if pays and _fire(game_cfg.get("suppress_on"), float(game_cfg.get("suppress_p") or 0)):
        for _ in range(48):
            alt_hand, alt_remaining = draw_once_fn(hand, swap_indices, deck)
            if not hand_pays_fn(alt_hand):
                deck[:] = alt_remaining
                return alt_hand
        deck[:] = remaining
        return new_hand

    if (not pays) and _fire(game_cfg.get("boost_on"), float(game_cfg.get("boost_p") or 0)):
        for _ in range(48):
            alt_hand, alt_remaining = draw_once_fn(hand, swap_indices, deck)
            if hand_pays_fn(alt_hand):
                deck[:] = alt_remaining
                return alt_hand
        deck[:] = remaining
        return new_hand

    deck[:] = remaining
    return new_hand
