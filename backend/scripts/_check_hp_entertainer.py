"""Count HP's entertainer-hosted games (MDG, E-games, poker)."""
import os
from collections import Counter
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

users = list(
    db.users.find(
        {"username": {"$regex": r"^hp$", "$options": "i"}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "is_entertainer": 1,
            "is_dead": 1,
            "entertainer_lifetime_bonus_points_paid": 1,
            "entertainer_lifetime_fund_cash_granted": 1,
            "entertainer_lifetime_fund_points_granted": 1,
            "entertainer_funded_completions_today": 1,
            "entertainer_activity_utc_date": 1,
        },
    )
)
print("users", users)
if not users:
    near = list(db.users.find({"username": {"$regex": "hp", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1, "is_entertainer": 1}).limit(20))
    print("near", near)
    raise SystemExit("no HP")

for u in users:
    uid = u["id"]
    print("\n========", u.get("username"), uid, "entertainer=", u.get("is_entertainer"), "dead=", u.get("is_dead"))
    print("lifetime bonus pts paid", u.get("entertainer_lifetime_bonus_points_paid"))
    print("lifetime fund granted cash/pts", u.get("entertainer_lifetime_fund_cash_granted"), u.get("entertainer_lifetime_fund_points_granted"))

    print("\n--- entertainer_funded_games (ledger) ---")
    rows = list(db.entertainer_funded_games.find({"entertainer_id": uid}, {"_id": 0}))
    print("total rows", len(rows))
    by_src = Counter((r.get("source") or "?") for r in rows)
    done = Counter((r.get("source") or "?") for r in rows if r.get("completed_at"))
    open_ = Counter((r.get("source") or "?") for r in rows if not r.get("completed_at"))
    print("by source", dict(by_src))
    print("completed", dict(done))
    print("open", dict(open_))
    print("completed total", sum(done.values()), "open total", sum(open_.values()))

    print("\n--- mdg_games created_by ---")
    mdg = list(db.mdg_games.find({"created_by": uid}, {"_id": 0, "id": 1, "status": 1, "entertainer_funded": 1, "created_at": 1, "fee_money": 1, "fee_points": 1}))
    print("mdg created", len(mdg))
    print("  funded", sum(1 for g in mdg if g.get("entertainer_funded")))
    print("  by status", dict(Counter((g.get("status") or "?") for g in mdg)))
    if mdg:
        mdg_sorted = sorted(mdg, key=lambda g: str(g.get("created_at") or ""))
        print("  first", mdg_sorted[0].get("created_at"), "last", mdg_sorted[-1].get("created_at"))

    print("\n--- entertainer_games (forum E-games) ---")
    eg = list(db.entertainer_games.find({"creator_id": uid}, {"_id": 0, "id": 1, "game_type": 1, "status": 1, "entertainer_funded": 1, "created_at": 1}))
    print("e-games created", len(eg))
    print("  funded", sum(1 for g in eg if g.get("entertainer_funded")))
    print("  by type", dict(Counter((g.get("game_type") or "?") for g in eg)))
    print("  by status", dict(Counter((g.get("status") or "?") for g in eg)))
    print("  funded by type", dict(Counter((g.get("game_type") or "?") for g in eg if g.get("entertainer_funded"))))

    print("\n--- mp_poker_games ---")
    pk = list(
        db.mp_poker_games.find(
            {"$or": [{"creator_id": uid}, {"created_by": uid}]},
            {"_id": 0, "id": 1, "status": 1, "tournament_status": 1, "entertainer_funded": 1, "created_at": 1},
        )
    )
    print("poker created", len(pk))
    print("  funded", sum(1 for g in pk if g.get("entertainer_funded")))
    print("  by status", dict(Counter((g.get("status") or g.get("tournament_status") or "?") for g in pk)))
