# 100-mission ladder: rewards hit fixed economy sums; requirements m_26+ generated/scaled.
from __future__ import annotations

from typing import Any, Dict, List, Tuple

# Must match armoury TOKEN_TYPES minus rank_xp_pass (avoid importing armoury — circular via server).
MISSION_RANDOM_TOKEN_TYPES = (
    "xp_crimes",
    "xp_gta",
    "auto_rank_2h",
    "melt",
    "oc_reduced",
    "booze",
    "racket",
    "travel",
    "properties",
    "jailbust_bonus",
)

FIRST_MISSION_ID = "m_first"
SECOND_MISSION_ID = "m_second"
THIRD_MISSION_ID = "m_third"
FOURTH_MISSION_ID = "m_fourth"

# Economy targets (plan)
TOTAL_REWARD_POINTS = 10_000
# Sum of per-mission reward_tribute_daily when ladder complete (~$75M/day).
TOTAL_TRIBUTE_DAILY_CASH = 75_000_000
TOTAL_CASH_IMMEDIATE = 500_000_000
# Reference only (legacy ratio vs old 120.125M cash ladder); respect/bullets are explicit below so raising cash does not scale them.
_OLD_MISSION_CASH_DAILY_SUM = 120_125_000
TOTAL_RESPECT_DAILY = 1000
# Kept near prior ~14.5k/day (was 69_575 * TOTAL_TRIBUTE_DAILY_CASH / _OLD_...) before cash target rose to 75M.
# Nerf: free daily tribute bullets tightened (~7k/day when ladder complete).
TOTAL_BULLETS_DAILY = 7_000
# Total random-armoury-token credits per day (tribute_tokens pool); split across token-eligible missions.
TOTAL_TRIBUTE_TOKEN_CREDITS_DAILY = 20
# Auto-rank 2h tokens credited daily to balance (not tribute bank); split only across missions that used to grant this bonus.
TOTAL_TRIBUTE_AUTO_RANK_2H_DAILY = 10
# Loot box pieces per day from completed missions only (100 missions sum to this when ladder complete).
# Was 150; raised to 200 so every mission can receive ≥1 piece with remainder weighted by difficulty.
PREVIOUS_TOTAL_TRIBUTE_LOOT_BOX_PIECES_DAILY = 150
TOTAL_TRIBUTE_LOOT_BOX_PIECES_DAILY = 200

WEIGHT_P = 1.6
WEIGHT_BASE = 12.0

# 25% easier: all numeric mission targets are 75% of prior values (min 1).
MISSION_REQUIREMENT_MULT = 0.75


def _ease_amount(v: int) -> int:
    return max(1, int(round(int(v) * MISSION_REQUIREMENT_MULT)))


def ease_mission_requirements(req: Dict[str, Any]) -> Dict[str, Any]:
    """Scale countable requirement targets; leave flags / city / mission lists alone."""
    out: Dict[str, Any] = {}
    for k, v in req.items():
        if k in ("in_state", "complete_missions") or isinstance(v, (str, list, bool)):
            out[k] = v
        elif isinstance(v, (int, float)):
            out[k] = _ease_amount(v)
        else:
            out[k] = v
    return out


def _format_requirements_description(req: Dict[str, Any]) -> str:
    """Human-readable requirement line(s) from the eased requirements dict."""
    parts: List[str] = []
    if req.get("in_state"):
        parts.append(f"Travel to {req['in_state']}")
    order = (
        "crimes",
        "jail_busts_npc",
        "jail_busts",
        "gta",
        "booze_sells",
        "cars_melted",
        "bullets_melted",
        "bullets_purchased_armoury",
        "uncommon_cars_stolen",
        "uncommon_cars_scrapped",
        "hitlist_npc_kills",
        "deposit_interest",
    )
    seen = set()
    for k in order:
        if k not in req:
            continue
        seen.add(k)
        v = int(req[k])
        if k == "crimes":
            parts.append(f"Commit {v:,} crimes")
        elif k == "jail_busts_npc":
            parts.append(f"Bust {v:,} NPC from jail" if v == 1 else f"Bust {v:,} NPCs from jail")
        elif k == "jail_busts":
            parts.append(f"Bust {v:,} from jail")
        elif k == "gta":
            parts.append(f"Steal {v:,} cars")
        elif k == "booze_sells":
            parts.append(f"Do {v:,} booze runs")
        elif k == "cars_melted":
            parts.append(f"Melt {v:,} car" if v == 1 else f"Melt {v:,} cars")
        elif k == "bullets_melted":
            parts.append(f"Melt {v:,} bullets")
        elif k == "bullets_purchased_armoury":
            parts.append(f"Buy {v:,} bullets from the armoury")
        elif k == "uncommon_cars_stolen":
            parts.append(f"Steal {v:,} uncommon cars")
        elif k == "uncommon_cars_scrapped":
            parts.append(f"Scrap {v:,} uncommon cars")
        elif k == "hitlist_npc_kills":
            parts.append(f"Kill {v:,} hitlist NPCs")
        elif k == "deposit_interest":
            parts.append(f"Add ${v:,} to the interest bank")
    for k, v in req.items():
        if k in seen or k in ("in_state", "complete_missions"):
            continue
        if isinstance(v, (int, float)):
            parts.append(f"{int(v):,} {k.replace('_', ' ')}")
    return (". ".join(parts) + ".") if parts else ""


def _weights_100() -> List[float]:
    return [WEIGHT_BASE + (i + 1) ** WEIGHT_P for i in range(100)]


def _allocate_exact_int(total: int, weights: List[float]) -> List[int]:
    s = sum(weights)
    vals = [int(total * w / s) for w in weights]
    diff = total - sum(vals)
    frac_idx = sorted(
        range(len(weights)),
        key=lambda i: (total * weights[i] / s) - vals[i],
        reverse=True,
    )
    for j in range(diff):
        vals[frac_idx[j % len(frac_idx)]] += 1
    return vals


def _allocate_loot_pieces_daily(total: int, weights: List[float]) -> List[int]:
    """Spread loot across all missions: ≥1 each when total ≥ mission count, then weight the rest."""
    n = len(weights)
    if n <= 0:
        return []
    if total >= n:
        base = [1] * n
        rem = total - n
        if rem > 0:
            extra = _allocate_exact_int(rem, weights)
            return [base[i] + extra[i] for i in range(n)]
        return base
    return _allocate_exact_int(total, weights)


def legacy_loot_pieces_daily_by_order() -> List[int]:
    """How loot was split when the ladder total was 150 (weighted only — early missions could be 0)."""
    return _allocate_exact_int(PREVIOUS_TOTAL_TRIBUTE_LOOT_BOX_PIECES_DAILY, _weights_100())


def _mission_has_random_token(order: int) -> bool:
    if order in (0, 2):
        return True
    return order >= 4 and order % 2 == 0


def _is_boss(difficulty: int) -> bool:
    if 20 <= difficulty <= 25:
        return True
    return difficulty > 25 and difficulty % 5 == 0


def _mission_eligible_auto_rank_2h_daily(difficulty: int) -> bool:
    """Which missions participate in splitting TOTAL_TRIBUTE_AUTO_RANK_2H_DAILY (legacy cadence, was 2 tokens each)."""
    if difficulty in (11, 13, 15, 17, 20, 23):
        return True
    if difficulty > 25 and difficulty % 11 in (0, 4, 8):
        return True
    return False


def _requirements_for_extended(difficulty: int) -> Dict[str, int]:
    """m_26–m_100: scaled from late-ladder magnitudes; hitlist grows slower."""
    d = difficulty
    t = d - 25
    # Multipliers vs m_25-ish baselines
    m_main = 1.0 + t * 0.032
    m_hit = 1.0 + t * 0.022
    m_dep = 1.0 + t * 0.038

    def x(v: float) -> int:
        return _ease_amount(int(round(v)))

    archetype = (d - 26) % 8
    if archetype == 0:
        return {
            "crimes": x(32000 * m_main),
            "jail_busts": x(620 * m_main),
            "gta": x(520 * m_main),
            "booze_sells": x(780 * m_main),
        }
    if archetype == 1:
        return {
            "bullets_melted": x(155_000 * m_main),
            "bullets_purchased_armoury": x(6500 + t * 120),
            "uncommon_cars_scrapped": x(130 * m_main),
            "cars_melted": x(62 + t // 3),
        }
    if archetype == 2:
        return {
            "hitlist_npc_kills": x(155 * m_hit),
            "jail_busts": x(640 * m_main),
            "uncommon_cars_stolen": x(130 * m_main),
            "deposit_interest": x(260_000_000 * m_dep),
        }
    if archetype == 3:
        return {
            "crimes": x(35000 * m_main),
            "gta": x(540 * m_main),
            "booze_sells": x(800 * m_main),
        }
    if archetype == 4:
        return {
            "jail_busts": x(660 * m_main),
            "bullets_melted": x(160_000 * m_main),
            "uncommon_cars_scrapped": x(135 * m_main),
            "deposit_interest": x(275_000_000 * m_dep),
        }
    if archetype == 5:
        return {
            "crimes": x(36000 * m_main),
            "hitlist_npc_kills": x(160 * m_hit),
            "uncommon_cars_stolen": x(132 * m_main),
            "bullets_purchased_armoury": x(6800 + t * 100),
        }
    if archetype == 6:
        return {
            "gta": x(560 * m_main),
            "uncommon_cars_scrapped": x(140 * m_main),
            "booze_sells": x(820 * m_main),
            "deposit_interest": x(290_000_000 * m_dep),
        }
    return {
        "crimes": x(38000 * m_main),
        "jail_busts": x(680 * m_main),
        "cars_melted": x(65 + t // 2),
        "hitlist_npc_kills": x(165 * m_hit),
    }


def _title_extended(difficulty: int) -> Tuple[str, str]:
    tier = difficulty - 25
    titles = [
        "Red Ledger",
        "Iron Contract",
        "Night Run",
        "Blood Oath",
        "Silent Partner",
        "Harbor Cut",
        "Commission Seat",
        "Wire Room",
    ]
    base = titles[(difficulty - 26) % len(titles)]
    title = f"{base} {tier}"
    req = _requirements_for_extended(difficulty)
    desc = _format_requirements_description(req)
    return title, desc


def build_missions() -> List[Dict[str, Any]]:
    w = _weights_100()
    pts = _allocate_exact_int(TOTAL_REWARD_POINTS, w)
    trib = _allocate_exact_int(TOTAL_TRIBUTE_DAILY_CASH, w)
    # m_second gets a fixed +$1M cash (car-replacement bonus); rest of pool allocates to TOTAL.
    M_SECOND_CASH_BONUS = 1_000_000
    cash = _allocate_exact_int(TOTAL_CASH_IMMEDIATE - M_SECOND_CASH_BONUS, w)
    resp_d = _allocate_exact_int(TOTAL_RESPECT_DAILY, w)
    bull_d = _allocate_exact_int(TOTAL_BULLETS_DAILY, w)
    loot_d = _allocate_loot_pieces_daily(TOTAL_TRIBUTE_LOOT_BOX_PIECES_DAILY, w)

    # Token daily credits for orders 4..99 only (m_5–m_100)
    w_tok = w[4:100]
    tok_sub = _allocate_exact_int(TOTAL_TRIBUTE_TOKEN_CREDITS_DAILY, w_tok)
    tok_daily_by_order = [0] * 4 + tok_sub

    eligible_ar_orders = [o for o in range(4, 100) if _mission_eligible_auto_rank_2h_daily(o + 1)]
    if eligible_ar_orders:
        ar_sub = _allocate_exact_int(
            TOTAL_TRIBUTE_AUTO_RANK_2H_DAILY,
            [1.0] * len(eligible_ar_orders),
        )
    else:
        ar_sub = []
    auto_rank_by_order = [0] * 100
    for idx, o in enumerate(eligible_ar_orders):
        auto_rank_by_order[o] = ar_sub[idx]

    missions: List[Dict[str, Any]] = []

    # --- order 0 m_first
    o = 0
    m1_req = ease_mission_requirements({"crimes": 15, "jail_busts_npc": 1})
    missions.append(
        {
            "id": FIRST_MISSION_ID,
            "city": "Start",
            "area": "—",
            "order": o,
            "type": "starter",
            "requirements": m1_req,
            "title": "Prove Yourself",
            "description": f"{_format_requirements_description(m1_req)} The outfit wants to see what you're made of.",
            "reward_money": 300_000,
            "reward_cash_immediate": cash[o],
            "reward_points": pts[o],
            "reward_respect": 2,
            "reward_tribute": 1_000,
            "reward_tribute_daily": trib[o],
            "reward_respect_daily": resp_d[o],
            "reward_tribute_bullets_daily": bull_d[o],
            "reward_tribute_loot_box_pieces_daily": loot_d[o],
            "reward_token": "random",
            "reward_auto_rank_2h": 1,
            "difficulty": 1,
            "unlocks_city": None,
            "character_id": None,
            "is_boss": False,
        }
    )

    # --- order 1 m_second
    o = 1
    m2_req = ease_mission_requirements(
        {
            "in_state": "New York",
            "jail_busts": 2,
            "crimes": 200,
            "cars_melted": 1,
        }
    )
    missions.append(
        {
            "id": SECOND_MISSION_ID,
            "city": "Start",
            "area": "—",
            "order": o,
            "type": "special",
            "requirements": m2_req,
            "title": "New York Run",
            "description": _format_requirements_description(m2_req),
            "reward_cash_immediate": (cash[o] or 0) + M_SECOND_CASH_BONUS,
            "reward_tribute_daily": trib[o],
            "reward_respect": 3,
            "reward_respect_daily": resp_d[o],
            "reward_tribute": 2_000,
            "reward_bullets": 1_250,
            "reward_tribute_bullets_daily": bull_d[o],
            "reward_tribute_loot_box_pieces_daily": loot_d[o],
            "reward_auto_rank_2h": 1,
            "reward_points": pts[o],
            "difficulty": 2,
            "unlocks_city": None,
            "character_id": None,
            "is_boss": False,
        }
    )

    # --- order 2 m_third
    o = 2
    m3_req = ease_mission_requirements(
        {
            "booze_sells": 25,
            "crimes": 150,
            "gta": 10,
            "jail_busts": 15,
            "bullets_melted": 5000,
            "bullets_purchased_armoury": 300,
            "uncommon_cars_scrapped": 3,
        }
    )
    missions.append(
        {
            "id": THIRD_MISSION_ID,
            "city": "Start",
            "area": "—",
            "order": o,
            "type": "special",
            "requirements": m3_req,
            "title": "Making Moves",
            "description": _format_requirements_description(m3_req),
            "reward_money": 0,
            "reward_cash_immediate": cash[o],
            "reward_points": pts[o],
            "reward_respect": 5,
            "reward_tribute": 3_000,
            "reward_tribute_daily": trib[o],
            "reward_respect_daily": resp_d[o],
            "reward_tribute_bullets_daily": bull_d[o],
            "reward_tribute_loot_box_pieces_daily": loot_d[o],
            "reward_token": "random",
            "reward_auto_rank_2h": 1,
            "difficulty": 3,
            "unlocks_city": None,
            "character_id": None,
            "is_boss": False,
        }
    )

    # --- order 3 m_fourth
    o = 3
    m4_req = ease_mission_requirements(
        {
            "uncommon_cars_stolen": 5,
            "hitlist_npc_kills": 7,
            "jail_busts": 15,
            "bullets_purchased_armoury": 500,
            "bullets_melted": 5000,
            "deposit_interest": 1_000_000,
        }
    )
    missions.append(
        {
            "id": FOURTH_MISSION_ID,
            "city": "Start",
            "area": "—",
            "order": o,
            "type": "special",
            "requirements": m4_req,
            "title": "Big League",
            "description": _format_requirements_description(m4_req),
            "reward_money": 1_000_000,
            "reward_cash_immediate": cash[o],
            "reward_points": pts[o],
            "reward_respect": 10,
            "reward_tribute": 5_000,
            "reward_tribute_daily": trib[o],
            "reward_respect_daily": resp_d[o],
            "reward_tribute_bullets_daily": bull_d[o],
            "reward_tribute_loot_box_pieces_daily": loot_d[o],
            "reward_auto_rank_2h": 1,
            "difficulty": 4,
            "unlocks_city": None,
            "character_id": None,
            "is_boss": False,
        }
    )

    # --- m_5 .. m_25 (orders 4–24) unchanged requirements/titles; new rewards
    legacy = [
        (
            "m_5",
            {"crimes": 800, "jail_busts": 30, "gta": 25, "booze_sells": 50},
            "Street Boss",
            "Commit 800 crimes. Bust 30 from jail. Steal 25 cars. Do 50 booze runs.",
        ),
        (
            "m_6",
            {
                "bullets_melted": 10_000,
                "bullets_purchased_armoury": 800,
                "uncommon_cars_scrapped": 8,
                "cars_melted": 5,
            },
            "Arms Dealer",
            "Melt 10,000 bullets. Buy 800 from the armoury. Scrap 8 uncommon cars. Melt 5 cars.",
        ),
        (
            "m_7",
            {
                "hitlist_npc_kills": 15,
                "jail_busts": 50,
                "uncommon_cars_stolen": 10,
                "deposit_interest": 2_500_000,
            },
            "Clean Up",
            "Kill 15 hitlist NPCs. Bust 50 from jail. Steal 10 uncommon cars. Add $2.5M to the interest bank.",
        ),
        (
            "m_8",
            {"crimes": 1500, "gta": 50, "booze_sells": 100},
            "Territory",
            "Commit 1,500 crimes. Steal 50 cars. Do 100 booze runs.",
        ),
        (
            "m_9",
            {
                "jail_busts": 80,
                "bullets_melted": 20_000,
                "uncommon_cars_scrapped": 15,
                "deposit_interest": 5_000_000,
            },
            "Heavy Hitter",
            "Bust 80 from jail. Melt 20,000 bullets. Scrap 15 uncommon cars. Add $5M to the interest bank.",
        ),
        (
            "m_10",
            {
                "crimes": 2500,
                "hitlist_npc_kills": 25,
                "uncommon_cars_stolen": 20,
                "bullets_purchased_armoury": 1500,
            },
            "Capo",
            "Commit 2,500 crimes. Kill 25 hitlist NPCs. Steal 20 uncommon cars. Buy 1,500 bullets from the armoury.",
        ),
        (
            "m_11",
            {
                "booze_sells": 150,
                "gta": 80,
                "cars_melted": 15,
                "deposit_interest": 10_000_000,
            },
            "Empire Builder",
            "Do 150 booze runs. Steal 80 cars. Melt 15 cars. Add $10M to the interest bank.",
        ),
        (
            "m_12",
            {"crimes": 4000, "jail_busts": 120, "bullets_melted": 35_000},
            "Enforcer",
            "Commit 4,000 crimes. Bust 120 from jail. Melt 35,000 bullets.",
        ),
        (
            "m_13",
            {
                "hitlist_npc_kills": 40,
                "uncommon_cars_stolen": 35,
                "uncommon_cars_scrapped": 25,
                "deposit_interest": 20_000_000,
            },
            "Wheelman",
            "Kill 40 hitlist NPCs. Steal 35 uncommon cars. Scrap 25 uncommon cars. Add $20M to the interest bank.",
        ),
        (
            "m_14",
            {
                "crimes": 6000,
                "gta": 120,
                "booze_sells": 200,
                "bullets_purchased_armoury": 2500,
            },
            "Underboss",
            "Commit 6,000 crimes. Steal 120 cars. Do 200 booze runs. Buy 2,500 bullets from the armoury.",
        ),
        (
            "m_15",
            {"jail_busts": 180, "deposit_interest": 35_000_000, "cars_melted": 25},
            "Consigliere",
            "Bust 180 from jail. Add $35M to the interest bank. Melt 25 cars.",
        ),
        (
            "m_16",
            {
                "crimes": 9000,
                "hitlist_npc_kills": 60,
                "bullets_melted": 60_000,
                "uncommon_cars_scrapped": 40,
            },
            "War Chief",
            "Commit 9,000 crimes. Kill 60 hitlist NPCs. Melt 60,000 bullets. Scrap 40 uncommon cars.",
        ),
        (
            "m_17",
            {
                "gta": 180,
                "uncommon_cars_stolen": 55,
                "booze_sells": 300,
                "deposit_interest": 50_000_000,
            },
            "Kingpin",
            "Steal 180 cars. Steal 55 uncommon cars. Do 300 booze runs. Add $50M to the interest bank.",
        ),
        (
            "m_18",
            {
                "crimes": 12000,
                "jail_busts": 250,
                "bullets_purchased_armoury": 4000,
            },
            "Street General",
            "Commit 12,000 crimes. Bust 250 from jail. Buy 4,000 bullets from the armoury.",
        ),
        (
            "m_19",
            {
                "hitlist_npc_kills": 90,
                "deposit_interest": 75_000_000,
                "uncommon_cars_scrapped": 60,
                "cars_melted": 40,
            },
            "Shadow Don",
            "Kill 90 hitlist NPCs. Add $75M to the interest bank. Scrap 60 uncommon cars. Melt 40 cars.",
        ),
        (
            "m_20",
            {
                "crimes": 16000,
                "gta": 250,
                "booze_sells": 400,
                "jail_busts": 350,
            },
            "Boss of Bosses",
            "Commit 16,000 crimes. Steal 250 cars. Do 400 booze runs. Bust 350 from jail.",
        ),
        (
            "m_21",
            {
                "bullets_melted": 100_000,
                "uncommon_cars_stolen": 90,
                "deposit_interest": 100_000_000,
            },
            "Legend",
            "Melt 100,000 bullets. Steal 90 uncommon cars. Add $100M to the interest bank.",
        ),
        (
            "m_22",
            {
                "crimes": 22000,
                "hitlist_npc_kills": 120,
                "jail_busts": 450,
                "bullets_purchased_armoury": 6000,
            },
            "Empire",
            "Commit 22,000 crimes. Kill 120 hitlist NPCs. Bust 450 from jail. Buy 6,000 bullets from the armoury.",
        ),
        (
            "m_23",
            {
                "gta": 350,
                "uncommon_cars_scrapped": 85,
                "booze_sells": 500,
                "deposit_interest": 150_000_000,
            },
            "Dynasty",
            "Steal 350 cars. Scrap 85 uncommon cars. Do 500 booze runs. Add $150M to the interest bank.",
        ),
        (
            "m_24",
            {
                "crimes": 30000,
                "jail_busts": 600,
                "cars_melted": 60,
                "hitlist_npc_kills": 150,
            },
            "Immortal",
            "Commit 30,000 crimes. Bust 600 from jail. Melt 60 cars. Kill 150 hitlist NPCs.",
        ),
        (
            "m_25",
            {
                "uncommon_cars_stolen": 125,
                "deposit_interest": 250_000_000,
                "bullets_melted": 150_000,
                "booze_sells": 750,
                "gta": 500,
            },
            "Godfather",
            "Steal 125 uncommon cars. Add $250M to the interest bank. Melt 150,000 bullets. Do 750 booze runs. Steal 500 cars.",
        ),
    ]

    for i, (mid, req_raw, ttl, _desc) in enumerate(legacy):
        o = 4 + i
        diff = o + 1
        req = ease_mission_requirements(req_raw)
        row: Dict[str, Any] = {
            "id": mid,
            "city": "Start",
            "area": "—",
            "order": o,
            "type": "special",
            "requirements": req,
            "title": ttl,
            "description": _format_requirements_description(req),
            "reward_cash_immediate": cash[o],
            "reward_points": pts[o],
            "reward_respect": min(8 + i * 5, 130),
            "reward_tribute": min(10_000 + i * 85_000, 2_000_000),
            "reward_tribute_daily": trib[o],
            "reward_respect_daily": resp_d[o],
            "reward_tribute_bullets_daily": bull_d[o],
            "reward_tribute_loot_box_pieces_daily": loot_d[o],
            "reward_auto_rank_2h": 1,
            "difficulty": diff,
            "unlocks_city": None,
            "character_id": None,
            "is_boss": _is_boss(diff),
        }
        td = tok_daily_by_order[o]
        if td > 0:
            row["reward_tribute_tokens_daily"] = td
        if _mission_has_random_token(o):
            row["reward_token"] = "random"
        ard = auto_rank_by_order[o]
        if ard:
            row["reward_tribute_auto_rank_2h_daily"] = ard
        # Bullet lump milestones (subset)
        if diff in (5, 8, 10, 12, 14, 16, 18, 20, 22, 24, 25):
            row["reward_bullets"] = min(2500 + (diff - 5) * 2250, 50_000)
        missions.append(row)

    # --- m_26 .. m_100
    for o in range(25, 100):
        diff = o + 1
        mid = f"m_{diff}"
        ttl, desc = _title_extended(diff)
        row = {
            "id": mid,
            "city": "Start",
            "area": "—",
            "order": o,
            "type": "special",
            "requirements": _requirements_for_extended(diff),
            "title": ttl,
            "description": desc,
            "reward_cash_immediate": cash[o],
            "reward_points": pts[o],
            "reward_respect": min(20 + diff, 400),
            "reward_tribute": min(50_000 + diff * 25_000, 5_000_000),
            "reward_tribute_daily": trib[o],
            "reward_respect_daily": resp_d[o],
            "reward_tribute_bullets_daily": bull_d[o],
            "reward_tribute_loot_box_pieces_daily": loot_d[o],
            "reward_auto_rank_2h": 1,
            "difficulty": diff,
            "unlocks_city": None,
            "character_id": None,
            "is_boss": _is_boss(diff),
        }
        td = tok_daily_by_order[o]
        if td > 0:
            row["reward_tribute_tokens_daily"] = td
        if _mission_has_random_token(o):
            row["reward_token"] = "random"
        ard = auto_rank_by_order[o]
        if ard:
            row["reward_tribute_auto_rank_2h_daily"] = ard
        if diff % 4 == 0:
            row["reward_bullets"] = min(15_000 + (diff - 26) * 600, 125_000)
        missions.append(row)

    # Sanity checks (plan)
    assert len(missions) == 100
    assert sum(int(m.get("reward_points") or 0) for m in missions) == TOTAL_REWARD_POINTS
    assert sum(int(m.get("reward_tribute_daily") or 0) for m in missions) == TOTAL_TRIBUTE_DAILY_CASH
    assert sum(int(m.get("reward_cash_immediate") or 0) for m in missions) == TOTAL_CASH_IMMEDIATE
    assert sum(int(m.get("reward_respect_daily") or 0) for m in missions) == TOTAL_RESPECT_DAILY
    assert sum(int(m.get("reward_tribute_bullets_daily") or 0) for m in missions) == TOTAL_BULLETS_DAILY
    assert (
        sum(int(m.get("reward_tribute_tokens_daily") or 0) for m in missions)
        == TOTAL_TRIBUTE_TOKEN_CREDITS_DAILY
    )
    assert (
        sum(int(m.get("reward_tribute_auto_rank_2h_daily") or 0) for m in missions)
        == TOTAL_TRIBUTE_AUTO_RANK_2H_DAILY
    )
    assert (
        sum(int(m.get("reward_tribute_loot_box_pieces_daily") or 0) for m in missions)
        == TOTAL_TRIBUTE_LOOT_BOX_PIECES_DAILY
    )

    return missions
