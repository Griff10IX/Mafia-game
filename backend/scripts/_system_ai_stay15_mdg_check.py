from _system_ai_prank_helpers import db

g = db.mdg_games.find_one(
    {"id": "a750e6d2-c5c9-4f41-9838-3c4ec341f9b1"},
    {"_id": 0, "status": 1, "entries": 1, "winner_username": 1, "pot_points": 1, "pot_money": 1, "auto_roll_at": 1},
)
ents = g.get("entries") or []
print("status", g.get("status"), "n", len(ents), "auto", g.get("auto_roll_at"), "winner", g.get("winner_username"), "pot_pts", g.get("pot_points"), "pot_money", g.get("pot_money"))
for e in ents:
    print(" ", e.get("username"), e.get("user_id", "")[:8])
