# Stats: overview (game capital, user stats, vehicles, ranks, recent kills, top dead)
import uuid
from datetime import datetime, timezone

from fastapi import Depends


def register(router):
    """Register stats routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    get_rank_info = srv.get_rank_info
    RANKS = srv.RANKS
    CARS = srv.CARS

    @router.get("/stats/overview")
    async def get_stats_overview(
        users_only_kills: bool = True,
        current_user: dict = Depends(get_current_user),
    ):
        now = datetime.now(timezone.utc)

        total_users = await db.users.count_documents({})
        alive_users = await db.users.count_documents({"is_dead": {"$ne": True}})
        dead_users = max(0, total_users - alive_users)

        totals = await db.users.aggregate([
            {
                "$group": {
                    "_id": None,
                    "money_total": {"$sum": {"$ifNull": ["$money", 0]}},
                    "points_total": {"$sum": {"$ifNull": ["$points", 0]}},
                    "swiss_total": {"$sum": {"$ifNull": ["$swiss_balance", 0]}},
                    "total_crimes": {"$sum": {"$ifNull": ["$total_crimes", 0]}},
                    "total_gta": {"$sum": {"$ifNull": ["$total_gta", 0]}},
                    "total_jail_busts": {"$sum": {"$ifNull": ["$jail_busts", 0]}},
                }
            }
        ]).to_list(1)
        totals_doc = totals[0] if totals else {}

        interest_agg = await db.bank_deposits.aggregate([
            {"$match": {"claimed_at": None}},
            {"$group": {"_id": None, "total": {"$sum": {"$add": [{"$ifNull": ["$principal", 0]}, {"$ifNull": ["$interest_amount", 0]}]}}}}
        ]).to_list(1)
        interest_bank_total = int(interest_agg[0].get("total", 0) or 0) if interest_agg else 0

        total_vehicles = await db.user_cars.count_documents({})
        car_counts = await db.user_cars.aggregate([
            {"$group": {"_id": "$car_id", "count": {"$sum": 1}}}
        ]).to_list(100)
        car_by_id = {c.get("id"): c for c in CARS}
        exclusive_vehicles = 0
        rare_vehicles = 0
        for cc in car_counts:
            car_id = cc.get("_id")
            cnt = int(cc.get("count", 0) or 0)
            info = car_by_id.get(car_id) or {}
            rarity = info.get("rarity")
            if rarity == "exclusive":
                exclusive_vehicles += cnt
            if rarity in ("rare", "ultra_rare", "legendary", "exclusive"):
                rare_vehicles += cnt

        rank_stats_map: dict = {}
        rank_meta = [(r["id"], r["name"]) for r in RANKS]
        for rid, rname in rank_meta:
            rank_stats_map[int(rid)] = {"rank_id": int(rid), "rank_name": rname, "alive": 0, "dead": 0}

        users_for_rank = await db.users.find(
            {},
            {"_id": 0, "rank_points": 1, "is_dead": 1}
        ).to_list(50000)
        for u in users_for_rank:
            rid, _ = get_rank_info(int(u.get("rank_points", 0) or 0))
            bucket = rank_stats_map.get(int(rid))
            if not bucket:
                continue
            if u.get("is_dead"):
                bucket["dead"] += 1
            else:
                bucket["alive"] += 1

        rank_stats = [rank_stats_map[r["id"]] for r in RANKS]

        attempts = await db.attack_attempts.find(
            {"outcome": "killed"},
            {"_id": 0}
        ).sort("created_at", -1).to_list(200)
        recent_kills = []
        for a in attempts:
            killer = await db.users.find_one(
                {"id": a.get("attacker_id")},
                {"_id": 0, "is_npc": 1, "rank_points": 1, "username": 1}
            )
            victim = await db.users.find_one(
                {"id": a.get("target_id")},
                {"_id": 0, "is_npc": 1, "rank_points": 1}
            )

            if users_only_kills and (bool(killer and killer.get("is_npc")) or bool(victim and victim.get("is_npc"))):
                continue

            victim_rank_name = None
            tr_id = a.get("target_rank_id")
            if tr_id is not None:
                try:
                    tr_id_int = int(tr_id)
                    victim_rank_name = next((r.get("name") for r in RANKS if int(r.get("id", 0) or 0) == tr_id_int), None)
                except Exception:
                    victim_rank_name = None
            if victim_rank_name is None and victim:
                _, victim_rank_name = get_rank_info(int(victim.get("rank_points", 0) or 0))

            is_public = bool(a.get("make_public"))
            killer_username = a.get("attacker_username") if is_public else None
            victim_username = a.get("target_username")
            if not victim_username:
                continue

            recent_kills.append({
                "id": a.get("id") or a.get("attack_id") or str(uuid.uuid4()),
                "victim_username": victim_username,
                "victim_rank_name": victim_rank_name,
                "killer_username": killer_username,
                "is_public": is_public,
                "created_at": a.get("created_at"),
            })

            if len(recent_kills) >= 15:
                break

        top_dead = await db.users.find(
            {"is_dead": True},
            {"_id": 0, "username": 1, "total_kills": 1, "rank_points": 1, "dead_at": 1}
        ).sort("total_kills", -1).limit(20).to_list(20)
        top_dead_users = []
        for u in top_dead:
            rid, rname = get_rank_info(int(u.get("rank_points", 0) or 0))
            top_dead_users.append({
                "username": u.get("username"),
                "total_kills": int(u.get("total_kills", 0) or 0),
                "rank_name": rname,
                "dead_at": u.get("dead_at"),
            })

        return {
            "generated_at": now.isoformat(),
            "game_capital": {
                "total_cash": int(totals_doc.get("money_total", 0) or 0),
                "swiss_total": int(totals_doc.get("swiss_total", 0) or 0),
                "interest_bank_total": interest_bank_total,
                "points_total": int(totals_doc.get("points_total", 0) or 0),
            },
            "user_stats": {
                "total_users": int(total_users),
                "alive_users": int(alive_users),
                "dead_users": int(dead_users),
                "total_crimes": int(totals_doc.get("total_crimes", 0) or 0),
                "total_gta": int(totals_doc.get("total_gta", 0) or 0),
                "total_jail_busts": int(totals_doc.get("total_jail_busts", 0) or 0),
                "bullets_melted_total": 0,
            },
            "vehicle_stats": {
                "total_vehicles": int(total_vehicles),
                "exclusive_vehicles": int(exclusive_vehicles),
                "rare_vehicles": int(rare_vehicles),
            },
            "rank_stats": rank_stats,
            "recent_kills": recent_kills,
            "top_dead_users": top_dead_users,
        }
