# Extended illegal-business missions ibm_31–ibm_100 (generator).
# Requirements use only keys supported by illegal_business._ibm_requirement_current.
# Rewards: vault_cash curve, income_per_hour_add (~75k total on 31–99 + finale),
# token bundles, guard_slots / guard_weapon_max / guard_armour_max, raid_daily_limit_add,
# income_cap_hours_add / defender_strength_bonus_add / raid_incoming_loot_mult_sub on select orders.

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# Highest rank_id used in existing ibm_30 (Godfather)
RANK_GODFATHER = 13

# Missions 31–99: target sum of income_per_hour_add (plan: ~60k–90k; use 76_000)
_IPH_SUM_31_99 = 76_000
# Mission 100 finale add: takes total income to ~$4.69M/h (~$800M/week) so 100% completion
# pays back the full ~$565M ladder cost roughly every 5 days.
_IPH_FINALE_100 = 4_000_000

# Vault at order 31 / 100 (plan: ~$1.05M start, ~$6.5M finale)
_VAULT_START = 1_050_000
_VAULT_END = 6_500_000


def _vault_for_order(order: int) -> int:
    if order <= 31:
        return _VAULT_START
    if order >= 100:
        return _VAULT_END
    t = (order - 31) / (100 - 31)
    # Slight late acceleration
    t_ease = t**0.88
    return int(_VAULT_START + (_VAULT_END - _VAULT_START) * t_ease)


def _distribute_ints(total: int, n: int) -> List[int]:
    if n <= 0 or total <= 0:
        return []
    weights = [(i + 1) ** 1.15 for i in range(n)]
    s = sum(weights)
    parts = [max(1, int(total * w / s)) for w in weights]
    diff = total - sum(parts)
    parts[-1] += diff
    return parts


def _iph_slots_for_extended() -> Dict[int, int]:
    """Map mission order -> income_per_hour_add (orders 31–99 only); ~76k total."""
    n = 28
    orders_iph = []
    for i in range(n):
        o = 31 + int(round((i + 0.5) * 69 / n))
        o = max(31, min(99, o))
        orders_iph.append(o)
    orders_iph = sorted(set(orders_iph))
    while len(orders_iph) < n:
        for o in range(31, 100):
            if o not in orders_iph:
                orders_iph.append(o)
                break
        orders_iph.sort()
    orders_iph = sorted(orders_iph)[:n]
    amounts = _distribute_ints(_IPH_SUM_31_99, len(orders_iph))
    amounts.sort()
    orders_sorted = sorted(orders_iph)
    return dict(zip(orders_sorted, amounts))


def _security_level_target(order: int) -> Optional[int]:
    """Spread 50..80 across ibm_32–ibm_96; None if no security req this mission."""
    if order < 32 or order > 96:
        return None
    # 65 missions span 31 levels → roughly every 2 orders +1
    idx = order - 32
    return min(80, 50 + (idx * 31) // 65)


def _requirement_tuple(order: int) -> Tuple[Dict[str, int], str]:
    """Returns (requirements, how_to_complete text)."""
    o = order
    mod = (o - 31) % 7
    sec = _security_level_target(o)

    if mod == 0:
        req = {
            "collections": 18 + (o - 31) * 3,
            "crimes_in_state": 800 + (o - 31) * 140,
            "raids_attempted": 12 + (o - 31) * 4,
        }
        how = f"Collect {req['collections']} times, {req['crimes_in_state']} crimes in your state, {req['raids_attempted']} raid attempts (since mission start)."
    elif mod == 1:
        req = {
            "guards_hired": 8 + (o - 31) * 2,
            "vault_withdrawals": 8 + (o - 31) * 2,
        }
        if sec is not None:
            req["security_level"] = sec
        how = (
            f"Hire {req['guards_hired']} guards, {req['vault_withdrawals']} vault withdrawals"
            + (f", reach security level {sec}." if sec is not None else ".")
        )
    elif mod == 2:
        req = {
            "raids_won": 8 + (o - 31) * 3,
            "crimes": 8000 + (o - 31) * 2200,
        }
        rid = min(RANK_GODFATHER, max(8, 8 + (o - 40) // 15))
        req["rank_id"] = rid
        how = f"Win {req['raids_won']} raids, {req['crimes']} total crimes, rank {rid}+."
    elif mod == 3:
        req = {
            "guard_slots_bought": min(18, 3 + (o - 31) // 6),
            "collections": 22 + (o - 31) * 3,
            "crimes_in_state": 1000 + (o - 31) * 150,
        }
        how = f"Buy {req['guard_slots_bought']} guard slots (this tier), collect {req['collections']} times, state crimes {req['crimes_in_state']}."
    elif mod == 4:
        sl = sec if sec is not None else min(80, 48 + max(0, (o - 32) // 2))
        req = {
            "security_level": sl,
            "raids_attempted": 20 + (o - 31) * 5,
            "hitlist_npc_kills": min(12, 2 + (o - 31) // 10),
        }
        how = f"Security {req['security_level']}, {req['raids_attempted']} raid attempts, {req['hitlist_npc_kills']} hitlist practice NPC kills."
    elif mod == 5:
        req = {
            "crimes": 15000 + (o - 31) * 2800,
            "vault_withdrawals": 12 + (o - 31) * 2,
            "guards_hired": 12 + (o - 31) * 2,
        }
        how = f"{req['crimes']} crimes, {req['vault_withdrawals']} vault withdrawals, hire {req['guards_hired']} guards."
    else:
        req = {
            "collections": 25 + (o - 31) * 3,
            "guards_hired": 10 + (o - 31) * 2,
            "raids_attempted": 25 + (o - 31) * 5,
        }
        if sec is not None:
            req["security_level"] = sec
        how = "Collections, hires, raid attempts" + (f", security {sec}." if sec else ".")

    return req, how


def _meta_perks(order: int) -> Dict[str, Any]:
    """Stackable business meta: till cap hours, defender strength, less loot lost when raided."""
    extra: Dict[str, Any] = {}
    if order in (44, 58, 72, 86):
        extra["income_cap_hours_add"] = 4
    if order in (50, 68, 85):
        extra["defender_strength_bonus_add"] = 18
    if order in (55, 77, 96):
        extra["raid_incoming_loot_mult_sub"] = 0.03
    return extra


def _token_bundle(order: int) -> Dict[str, int]:
    """Rotate multi-token rewards like ibm_16–ibm_30."""
    bundles = [
        {"racket_tokens": 1, "xp_gta_tokens": 1, "melt_tokens": 1},
        {"oc_reduced_tokens": 1, "travel_tokens": 1, "properties_tokens": 1},
        {"xp_crimes_tokens": 1, "xp_gta_tokens": 1, "auto_rank_2h_tokens": 1},
        {"jailbust_tokens": 1, "melt_tokens": 1, "racket_tokens": 1},
        {"jailbust_tokens": 1, "booze_tokens": 1, "properties_tokens": 1},
        {"racket_tokens": 1, "xp_crimes_tokens": 1, "oc_reduced_tokens": 1, "travel_tokens": 1},
        {"xp_crimes_tokens": 1, "melt_tokens": 1, "booze_tokens": 1, "jailbust_tokens": 1},
    ]
    base = dict(bundles[(order - 31) % len(bundles)])
    if order >= 55 and order % 11 == 0:
        base["xp_crimes_tokens"] = base.get("xp_crimes_tokens", 0) + 1
    if order >= 70:
        base["racket_tokens"] = base.get("racket_tokens", 0) + 1
    return base


def build_extended_ibm_missions() -> List[Dict[str, Any]]:
    iph_map = _iph_slots_for_extended()
    missions: List[Dict[str, Any]] = []

    # raid_daily_limit_add on five missions → 5+5=10 cap
    raid_bonus_orders = {40, 52, 64, 76, 88}

    guard_weapon_orders = {34, 42, 51, 60, 69, 78, 87, 94}
    guard_armour_orders = {38, 47, 56, 65, 74, 83, 92, 99}
    guard_slot_orders = {36, 54, 72, 91}

    for order in range(31, 100):
        req, how = _requirement_tuple(order)
        rewards: Dict[str, Any] = {"vault_cash": _vault_for_order(order)}
        rewards.update(_token_bundle(order))

        if order in iph_map:
            rewards["income_per_hour_add"] = iph_map[order]
        if order in raid_bonus_orders:
            rewards["raid_daily_limit_add"] = 1
        if order in guard_weapon_orders:
            rewards["guard_weapon_max"] = 1
        if order in guard_armour_orders:
            rewards["guard_armour_max"] = 1
        if order in guard_slot_orders:
            rewards["guard_slots"] = 1

        rewards.update(_meta_perks(order))

        title = f"Ladder run {order - 30}"
        story = "The outfit keeps raising the bar. Prove the racket still runs through you."

        missions.append(
            {
                "id": f"ibm_{order}",
                "order": order,
                "title": title,
                "story": story,
                "how_to_complete": how,
                "requirements": req,
                "rewards": rewards,
            }
        )

    # ibm_100 finale
    fin_rewards: Dict[str, Any] = {
        "vault_cash": _VAULT_END,
        "income_per_hour_add": _IPH_FINALE_100,
        "racket_tokens": 13,
        "xp_crimes_tokens": 3,
        "jailbust_tokens": 3,
        "melt_tokens": 2,
        "booze_tokens": 2,
        "properties_tokens": 2,
        "auto_rank_2h_tokens": 2,
        "xp_gta_tokens": 2,
        "oc_reduced_tokens": 1,
        "travel_tokens": 1,
        "raid_daily_limit_add": 1,
        "guard_slots": 2,
        "guard_weapon_max": 1,
        "income_cap_hours_add": 6,
        "defender_strength_bonus_add": 25,
        "raid_incoming_loot_mult_sub": 0.05,
    }
    missions.append(
        {
            "id": "ibm_100",
            "order": 100,
            "title": "Century racket",
            "story": "One hundred proofs on the ledger. The city pays rent to you.",
            "how_to_complete": (
                "Godfather rank; 85k crimes; 12k in-state; 200 collections; "
                "220 raid attempts; 150 raid wins; 95 guards hired; 14 hitlist practice NPC kills; security 80."
            ),
            "requirements": {
                "rank_id": RANK_GODFATHER,
                "crimes": 85000,
                "crimes_in_state": 12000,
                "collections": 200,
                "raids_attempted": 220,
                "raids_won": 150,
                "guards_hired": 95,
                "hitlist_npc_kills": 14,
                "security_level": 80,
            },
            "rewards": fin_rewards,
        }
    )

    return missions


EXTENDED_IBM_MISSIONS: List[Dict[str, Any]] = build_extended_ibm_missions()
