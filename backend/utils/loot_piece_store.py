"""Fixed Store loot-piece packs (GBP Stripe only).

These SKUs must not also receive the points-tab 110-pieces-per-£1
or 2-spins-per-£10 bonuses — pack loot and spins are the full grant.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

# Stripe / POINT_PACKAGES ids.
LOOT_PIECE_PACKS: Dict[str, Dict[str, Any]] = {
    "loot_pieces_1000": {
        "loot_box_pieces": 1000,
        "price_gbp": 7.00,
        "wheel_bonus_free_spins": 2,
    },
    "loot_pieces_2000": {
        "loot_box_pieces": 2000,
        "price_gbp": 13.50,
        "wheel_bonus_free_spins": 4,
    },
    "loot_pieces_3000": {
        "loot_box_pieces": 3000,
        "price_gbp": 19.50,
        "wheel_bonus_free_spins": 6,
    },
    "loot_pieces_4000": {
        "loot_box_pieces": 4000,
        "price_gbp": 25.00,
        "wheel_bonus_free_spins": 8,
    },
    "loot_pieces_5000": {
        "loot_box_pieces": 5000,
        "price_gbp": 30.00,
        "wheel_bonus_free_spins": 10,
    },
}


def is_loot_piece_package(package_id: Optional[str]) -> bool:
    return (package_id or "").strip() in LOOT_PIECE_PACKS


def get_loot_piece_pack(package_id: Optional[str]) -> Optional[Dict[str, Any]]:
    pid = (package_id or "").strip()
    pack = LOOT_PIECE_PACKS.get(pid)
    if not pack:
        return None
    return {"package_id": pid, **pack}


def point_package_entries() -> Dict[str, Dict[str, Any]]:
    """Entries for server.POINT_PACKAGES (0 points credited; Stripe uses price_gbp)."""
    return {
        pid: {
            "points": 0,
            "price_gbp": float(p["price_gbp"]),
            "loot_box_pieces": int(p["loot_box_pieces"]),
            "wheel_bonus_free_spins": int(p["wheel_bonus_free_spins"]),
        }
        for pid, p in LOOT_PIECE_PACKS.items()
    }


def stripe_product_name(package_id: Optional[str]) -> str:
    pack = get_loot_piece_pack(package_id)
    if not pack:
        return "Loot box pieces"
    pieces = int(pack["loot_box_pieces"])
    spins = int(pack["wheel_bonus_free_spins"])
    spin_label = "spin" if spins == 1 else "spins"
    return f"{pieces:,} loot box pieces + {spins} Wheel of Fortune free {spin_label}"
