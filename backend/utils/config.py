"""
Shared game constants. No database or request dependencies.
Imported by server.py and optionally by routers.
"""

# Locations (travel / attack states)
STATES = ["Chicago", "New York", "Las Vegas"]

# Inactive cities kept in DB/assets for possible re-enable (not in STATES).
DISABLED_STATES = ["Atlantic City"]

# Rank is based on rank_points only. Godfather is the top rank.
RANKS = [
    {"id": 1, "name": "Rat", "required_points": 0},
    {"id": 2, "name": "Street Thug", "required_points": 250},
    {"id": 3, "name": "Hustler", "required_points": 1000},
    {"id": 4, "name": "Goon", "required_points": 3000},
    {"id": 5, "name": "Made Man", "required_points": 6000},
    {"id": 6, "name": "Capo", "required_points": 12000},
    {"id": 7, "name": "Underboss", "required_points": 24000},
    {"id": 8, "name": "Consigliere", "required_points": 50000},
    {"id": 9, "name": "Boss", "required_points": 100000},
    {"id": 10, "name": "Don", "required_points": 200000},
    {"id": 11, "name": "Godfather", "required_points": 400000},
]

# Wealth ranks: based on cash on hand (ordered by min_money ascending). "color" is hex for UI.
WEALTH_RANKS = [
    {"id": 1, "name": "Broke", "min_money": 0, "color": "#64748b"},
    {"id": 2, "name": "Bum", "min_money": 1, "color": "#78716c"},
    {"id": 3, "name": "Very Poor", "min_money": 50_000, "color": "#94a3b8"},
    {"id": 4, "name": "Poor", "min_money": 200_000, "color": "#cbd5e1"},
    {"id": 5, "name": "Rich", "min_money": 500_000, "color": "#fcd34d"},
    {"id": 6, "name": "Millionaire", "min_money": 1_000_000, "color": "#fbbf24"},
    {"id": 7, "name": "Extremely Rich", "min_money": 2_000_000, "color": "#f59e0b"},
    {"id": 8, "name": "Fat Cat", "min_money": 5_000_000, "color": "#84cc16"},
    {"id": 9, "name": "Multi Millionaire", "min_money": 10_000_000, "color": "#65a30d"},
    {"id": 10, "name": "Big Hitter", "min_money": 25_000_000, "color": "#4ade80"},
    {"id": 11, "name": "Power Broker", "min_money": 50_000_000, "color": "#22c55e"},
    {"id": 12, "name": "Centimillionaire", "min_money": 100_000_000, "color": "#10b981"},
    {"id": 13, "name": "Quarter Billionaire", "min_money": 250_000_000, "color": "#14b8a6"},
    {"id": 14, "name": "Tycoon", "min_money": 500_000_000, "color": "#2dd4bf"},
    {"id": 15, "name": "Billionaire", "min_money": 1_000_000_000, "color": "#06b6d4"},
    {"id": 16, "name": "Double Billionaire", "min_money": 2_000_000_000, "color": "#0ea5e9"},
    {"id": 17, "name": "Five-Billion Magnate", "min_money": 5_000_000_000, "color": "#38bdf8"},
    {"id": 18, "name": "Multi Billionaire", "min_money": 10_000_000_000, "color": "#60a5fa"},
    {"id": 19, "name": "Ultra Billionaire", "min_money": 50_000_000_000, "color": "#818cf8"},
    {"id": 20, "name": "Mega Billionaire", "min_money": 100_000_000_000, "color": "#a78bfa"},
    {"id": 21, "name": "Quarter Trillionaire", "min_money": 250_000_000_000, "color": "#c084fc"},
    {"id": 22, "name": "Half Trillionaire", "min_money": 500_000_000_000, "color": "#e879f9"},
    {"id": 23, "name": "Trillionaire", "min_money": 1_000_000_000_000, "color": "#f472b6"},
    {"id": 24, "name": "Double Trillionaire", "min_money": 2_000_000_000_000, "color": "#fb7185"},
    {"id": 25, "name": "Grand Trillionaire", "min_money": 5_000_000_000_000, "color": "#fcd34d"},
    {"id": 26, "name": "Multi Trillionaire", "min_money": 10_000_000_000_000, "color": "#fef08a"},
]

# Game-wide daily events (rotate by UTC date). Multipliers default 1.0 when not set.
GAME_EVENTS = [
    {"id": "double_rank", "name": "Double Rank Points", "message": "Double rank points today! Kills and GTA reward 2x rank.", "rank_points": 2.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "double_cash", "name": "Double Cash Rewards", "message": "Double cash rewards today! Kill loot is 2x.", "rank_points": 1.0, "kill_cash": 2.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "gta_double_chance", "name": "2x GTA Success Chance", "message": "2x GTA success chance today! Better odds on heists.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 2.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_half_price", "name": "Bodyguards 50% Off", "message": "Bodyguards 50% off today! Slots, hire, and armour upgrades.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 0.5, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_premium", "name": "Bodyguards 10% More", "message": "Bodyguard services 10% more expensive today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.1, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_extra_payout", "name": "Rackets +10% Payouts", "message": "Family rackets pay 10% more today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.1, "armour_weapon_cost": 1.0},
    {"id": "racket_reduced_payout", "name": "Rackets -10% Payouts", "message": "Family rackets pay 10% less today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 0.9, "armour_weapon_cost": 1.0},
    {"id": "racket_faster_cooldown", "name": "Rackets 50% Faster", "message": "Racket cooldowns are half as long today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 0.5, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_bonus_day", "name": "Racket Bonus Day", "message": "Rackets: +10% payouts and 25% faster cooldowns.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 0.75, "racket_payout": 1.1, "armour_weapon_cost": 1.0},
    {"id": "armour_weapon_half_price", "name": "Armour & Weapons 50% Off", "message": "Armour and weapons 50% off today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 0.5},
    {"id": "armour_weapon_premium", "name": "Armour & Weapons 10% More", "message": "Armour and weapons 10% more expensive today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.1},
]
NO_EVENT = {"id": "none", "name": "No event", "message": "", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0}
MULTIPLIER_KEYS = ["rank_points", "kill_cash", "gta_success", "bodyguard_cost", "racket_cooldown", "racket_payout", "armour_weapon_cost"]
