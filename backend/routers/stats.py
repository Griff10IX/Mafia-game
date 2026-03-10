# Stats: overview (game capital, user stats, vehicles, ranks, recent kills, top dead)
# My Stats: per-user aggregated lifetime stats (combat, rank, bodyguards, gambling, casinos)
import uuid
from datetime import datetime, timezone

from fastapi import Depends


def _gambling_profit_from_details(game_type: str, details: dict) -> int:
    """Compute profit from gambling_log details. Positive = won, negative = lost."""
    stake = int(details.get("stake") or details.get("bet") or 0)
    payout = int(details.get("payout") or 0)
    if game_type in ("sports_bet", "mdg", "mp_blackjack"):
        return 0  # sports uses sports_bets; mdg/mp complex
    return payout - stake


def _booze_stats(u: dict) -> dict:
    """Build booze stats dict. Uses get_rank_info and booze_run capacity logic."""
    from routers.booze_run import BOOZE_TYPES, BOOZE_CAPACITY_BASE_RANK1, BOOZE_CAPACITY_EXTRA_PER_RANK, BOOZE_CAPACITY_BONUS_MAX
    from server import get_rank_info
    profit_by_type = dict(u.get("booze_profit_by_type") or {})
    best_id = None
    best_profit = 0
    for bid, p in profit_by_type.items():
        pv = int(p or 0)
        if pv > best_profit:
            best_profit = pv
            best_id = bid
    best_name = None
    if best_id:
        best_name = next((b["name"] for b in BOOZE_TYPES if b.get("id") == best_id), best_id)
    rank_id, _ = get_rank_info(int(u.get("rank_points") or 0))
    bonus = min(int(u.get("booze_capacity_bonus") or 0), BOOZE_CAPACITY_BONUS_MAX)
    capacity = max(1, BOOZE_CAPACITY_BASE_RANK1 + (rank_id - 1) * BOOZE_CAPACITY_EXTRA_PER_RANK + bonus)
    return {
        "profit_total": int(u.get("booze_profit_total") or 0),
        "runs_count": int(u.get("booze_runs_count") or 0),
        "jail_count": int(u.get("booze_jail_count") or 0),
        "capacity": capacity,
        "best_booze_id": best_id,
        "best_booze_name": best_name,
        "best_booze_profit": best_profit,
    }


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
        # Real users only: exclude NPCs (bodyguards, jail NPCs, hitlist NPCs, etc.)
        real_user_match = {"is_npc": {"$ne": True}}
        alive_real_match = {"is_npc": {"$ne": True}, "is_dead": {"$ne": True}}

        total_users = await db.users.count_documents(real_user_match)
        alive_users = await db.users.count_documents(alive_real_match)
        dead_users = max(0, total_users - alive_users)

        # Totals only from real users; total_cash only from alive real users
        totals = await db.users.aggregate([
            {"$match": real_user_match},
            {
                "$group": {
                    "_id": None,
                    "money_total": {"$sum": {"$ifNull": ["$money", 0]}},
                    "points_total": {"$sum": {"$ifNull": ["$points", 0]}},
                    "swiss_total": {"$sum": {"$ifNull": ["$swiss_balance", 0]}},
                    "total_crimes": {"$sum": {"$ifNull": ["$total_crimes", 0]}},
                    "total_gta": {"$sum": {"$ifNull": ["$total_gta", 0]}},
                    "total_jail_busts": {"$sum": {"$ifNull": ["$jail_busts", 0]}},
                    "total_oc_heists": {"$sum": {"$ifNull": ["$total_oc_heists", 0]}},
                    "bullets_melted_total": {"$sum": {"$ifNull": ["$bullets_melted", 0]}},
                }
            }
        ]).to_list(1)
        totals_doc = totals[0] if totals else {}
        # Total cash: alive real users only (not dead, not NPCs)
        cash_agg = await db.users.aggregate([
            {"$match": alive_real_match},
            {"$group": {"_id": None, "money_total": {"$sum": {"$ifNull": ["$money", 0]}}}}
        ]).to_list(1)
        total_cash_alive = int(cash_agg[0].get("money_total", 0) or 0) if cash_agg else 0

        interest_agg = await db.bank_deposits.aggregate([
            {"$match": {"claimed_at": None}},
            {"$group": {"_id": None, "total": {"$sum": {"$add": [{"$ifNull": ["$principal", 0]}, {"$ifNull": ["$interest_amount", 0]}]}}}}
        ]).to_list(1)
        interest_bank_total = int(interest_agg[0].get("total", 0) or 0) if interest_agg else 0

        quicktrade_agg = await db.trade_buy_offers.aggregate([
            {"$match": {"status": "active"}},
            {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$offer", 0]}}}}
        ]).to_list(1)
        quicktrade_cash = int(quicktrade_agg[0].get("total", 0) or 0) if quicktrade_agg else 0

        total_vehicles = await db.user_cars.count_documents({})
        car_counts = await db.user_cars.aggregate([
            {"$group": {"_id": "$car_id", "count": {"$sum": 1}}}
        ]).to_list(100)
        car_by_id = {c.get("id"): c for c in CARS}
        rarity_counts = {"common": 0, "uncommon": 0, "rare": 0, "ultra_rare": 0, "legendary": 0, "custom": 0, "exclusive": 0}
        for cc in car_counts:
            car_id = cc.get("_id")
            cnt = int(cc.get("count", 0) or 0)
            info = car_by_id.get(car_id) or {}
            rarity = info.get("rarity") or "common"
            if rarity in rarity_counts:
                rarity_counts[rarity] += cnt
            else:
                rarity_counts["common"] += cnt

        rank_stats_map: dict = {}
        rank_meta = [(r["id"], r["name"]) for r in RANKS]
        for rid, rname in rank_meta:
            rank_stats_map[int(rid)] = {"rank_id": int(rid), "rank_name": rname, "alive": 0, "dead": 0}

        users_for_rank = await db.users.find(
            real_user_match,
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

        # Wiped families: wars that ended with one family wiped (all dead)
        wiped_wars = await db.family_wars.find(
            {"status": {"$in": ["family_a_wins", "family_b_wins"]}},
            {"_id": 0, "id": 1, "winner_family_id": 1, "winner_family_name": 1, "loser_family_id": 1, "loser_family_name": 1, "ended_at": 1}
        ).sort("ended_at", -1).limit(30).to_list(30)
        wiped_families = []
        for w in wiped_wars:
            war_id = w.get("id")
            winner_id = w.get("winner_family_id")
            winner_name = (w.get("winner_family_name") or "?").strip() or "?"
            loser_name = (w.get("loser_family_name") or "?").strip() or "?"
            # Aggregate winner-side stats for this war (player kills, BG kills; whether winner was in a family)
            stats_docs = await db.family_war_stats.find(
                {"war_id": war_id, "family_id": winner_id},
                {"_id": 0, "kills": 1, "bodyguard_kills": 1, "deaths": 1}
            ).to_list(100)
            player_kills = sum(int(s.get("kills") or 0) for s in stats_docs)
            bodyguard_kills = sum(int(s.get("bodyguard_kills") or 0) for s in stats_docs)
            wiped_families.append({
                "war_id": war_id,
                "wiped_family_name": loser_name,
                "wiped_by_family_name": winner_name,
                "wiped_by_in_family": True,
                "ended_at": w.get("ended_at"),
                "player_kills": player_kills,
                "bodyguard_kills": bodyguard_kills,
            })

        return {
            "generated_at": now.isoformat(),
            "game_capital": {
                "total_cash": total_cash_alive,
                "swiss_total": int(totals_doc.get("swiss_total", 0) or 0),
                "interest_bank_total": interest_bank_total,
                "quicktrade_cash": quicktrade_cash,
                "points_total": int(totals_doc.get("points_total", 0) or 0),
            },
            "user_stats": {
                "total_users": int(total_users),
                "alive_users": int(alive_users),
                "dead_users": int(dead_users),
                "total_crimes": int(totals_doc.get("total_crimes", 0) or 0),
                "total_gta": int(totals_doc.get("total_gta", 0) or 0),
                "total_jail_busts": int(totals_doc.get("total_jail_busts", 0) or 0),
                "total_oc_heists": int(totals_doc.get("total_oc_heists", 0) or 0),
                "bullets_melted_total": int(totals_doc.get("bullets_melted_total", 0) or 0),
            },
            "vehicle_stats": {
                "total_vehicles": int(total_vehicles),
                "common_vehicles": int(rarity_counts.get("common", 0)),
                "uncommon_vehicles": int(rarity_counts.get("uncommon", 0)),
                "rare_vehicles": int(rarity_counts.get("rare", 0)),
                "ultra_rare_vehicles": int(rarity_counts.get("ultra_rare", 0)),
                "legendary_vehicles": int(rarity_counts.get("legendary", 0)),
                "custom_vehicles": int(rarity_counts.get("custom", 0)),
                "exclusive_vehicles": int(rarity_counts.get("exclusive", 0)),
            },
            "rank_stats": rank_stats,
            "recent_kills": recent_kills,
            "wiped_families": wiped_families,
        }

    @router.get("/stats/me")
    async def get_my_stats(current_user: dict = Depends(get_current_user)):
        """Aggregate per-user lifetime stats: combat, rank, bodyguards, gambling, casinos, etc."""
        import asyncio
        from routers.bodyguards import get_bodyguards_stats
        from routers.gta import get_gta_stats
        from routers.crimes import get_crime_stats
        from routers.jail import get_jail_stats
        from routers.sports_betting import sports_betting_stats
        from server import _get_casino_property_profit

        uid = current_user["id"]
        u = await db.users.find_one(
            {"id": uid},
            {
                "_id": 0,
                "total_kills": 1, "total_deaths": 1, "hitlist_npc_kills": 1, "robot_bodyguard_kills": 1,
                "total_crimes": 1, "crime_profit": 1,
                "total_gta": 1,
                "jail_busts": 1, "jail_bust_attempts": 1, "jail_busts_npc": 1,
                "total_oc_heists": 1,
                "bullets_melted": 1, "rank_points": 1,
                "lifetime_points_spent": 1,
                "bodyguard_slots": 1,
                "bodyguard_lifetime_hires": 1,
                "bodyguard_lifetime_spent_hires": 1,
                "bodyguard_lifetime_spent_upgrades": 1,
                "consecutive_busts_record": 1,
                "current_consecutive_busts": 1,
                "prestige_level": 1,
                "booze_profit_total": 1, "booze_runs_count": 1, "booze_jail_count": 1, "booze_profit_by_type": 1, "booze_capacity_bonus": 1, "rank_points": 1,
                "auto_rank_total_busts": 1, "auto_rank_total_crimes": 1, "auto_rank_total_gtas": 1,
                "auto_rank_total_cash": 1, "auto_rank_total_booze_runs": 1, "auto_rank_total_booze_profit": 1,
                "auto_rank_total_cars_melted": 1, "auto_rank_total_bullets_from_melt": 1,
                "auto_rank_total_cars_scrapped": 1, "auto_rank_total_cash_from_scrap": 1,
            },
        )
        u = u or {}

        stock_trades = 0
        stock_profit = 0
        try:
            stock_cursor = db.stock_transactions.find({"user_id": uid}, {"_id": 0, "profit_points": 1})
            stock_items = await stock_cursor.to_list(1000)
            stock_trades = len(stock_items)
            stock_profit = sum(int(t.get("profit_points") or 0) for t in stock_items)
        except Exception:
            pass

        bank_interest_earned = 0
        try:
            bank_agg = await db.bank_deposits.aggregate([
                {"$match": {"user_id": uid, "claimed_at": {"$ne": None}}},
                {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$interest_amount", 0]}}}}
            ]).to_list(1)
            bank_interest_earned = int(bank_agg[0].get("total", 0) or 0) if bank_agg else 0
        except Exception:
            pass

        casino_cash, property_pts, has_casino, has_property = await _get_casino_property_profit(uid)
        casino_profit = int(casino_cash or 0)
        property_profit = int(property_pts or 0)
        from server import _user_owns_any_casino, _user_owns_any_property
        owned_casino = await _user_owns_any_casino(uid)
        owned_property = await _user_owns_any_property(uid)

        bodyguard_stats = {}
        crime_stats = {}
        gta_stats = {}
        jail_stats = {}
        sports_stats = {}
        try:
            bodyguard_stats = await get_bodyguards_stats(current_user)
        except Exception:
            pass
        try:
            crime_stats = await get_crime_stats(current_user)
        except Exception:
            pass
        try:
            gta_stats = await get_gta_stats(current_user)
        except Exception:
            pass
        try:
            jail_stats = await get_jail_stats(current_user)
        except Exception:
            pass
        try:
            sports_stats = await sports_betting_stats(current_user)
        except Exception:
            pass

        hitlist_npc_kills = int(u.get("hitlist_npc_kills") or 0)
        robot_bodyguard_kills = int(u.get("robot_bodyguard_kills") or 0)
        total_kills = int(u.get("total_kills") or 0)
        user_kills = max(0, total_kills - hitlist_npc_kills - robot_bodyguard_kills)

        gambling_by_game = {}
        gambling_total_profit = 0
        cursor = db.gambling_log.find(
            {"user_id": uid},
            {"_id": 0, "game_type": 1, "details": 1},
        )
        async for entry in cursor:
            gt = (entry.get("game_type") or "").strip()
            if not gt:
                continue
            details = entry.get("details") or {}
            profit = _gambling_profit_from_details(gt, details)
            if profit != 0:
                gambling_by_game[gt] = gambling_by_game.get(gt, 0) + profit
                gambling_total_profit += profit

        return {
            "combat": {
                "total_kills": total_kills,
                "total_deaths": int(u.get("total_deaths") or 0),
                "hitlist_npc_kills": hitlist_npc_kills,
                "robot_bodyguard_kills": robot_bodyguard_kills,
                "user_kills": user_kills,
            },
            "rank": {
                "total_crimes": int(u.get("total_crimes") or 0),
                "crime_profit": int(u.get("crime_profit") or 0),
                "total_gta": int(u.get("total_gta") or 0),
                "jail_busts": int(u.get("jail_busts") or 0),
                "jail_bust_attempts": int(u.get("jail_bust_attempts") or 0),
                "jail_busts_npc": int(u.get("jail_busts_npc") or 0),
                "total_oc_heists": int(u.get("total_oc_heists") or 0),
                "bullets_melted": int(u.get("bullets_melted") or 0),
                "rank_points": int(u.get("rank_points") or 0),
                "consecutive_busts_record": int(u.get("consecutive_busts_record") or 0),
                "current_consecutive_busts": int(u.get("current_consecutive_busts") or 0),
            },
            "rank_period": {
                "crimes": crime_stats,
                "gta": gta_stats,
                "jail": jail_stats,
            },
            "bodyguards": {
                "slots_purchased": int(u.get("bodyguard_slots") or 0),
                "total_hired": bodyguard_stats.get("total_hired", 0),
                "human_hired": bodyguard_stats.get("human_hired", 0),
                "total_spent_hires": bodyguard_stats.get("total_spent_hires", 0),
                "total_spent_upgrades": bodyguard_stats.get("total_spent_upgrades", 0),
                "longest_surviving_seconds": bodyguard_stats.get("longest_surviving_seconds"),
                "longest_surviving_name": bodyguard_stats.get("longest_surviving_name"),
            },
            "points": {
                "lifetime_spent": int(u.get("lifetime_points_spent") or 0),
            },
            "casinos": {
                "casino_profit": casino_profit,
                "property_profit": property_profit,
                "has_casino": has_casino,
                "has_property": has_property,
                "owned_casino": {"type": owned_casino.get("type"), "location": owned_casino.get("city") or owned_casino.get("state")} if owned_casino else None,
                "owned_property": {"type": owned_property.get("type"), "location": owned_property.get("state")} if owned_property else None,
            },
            "gambling": {
                "total_profit": gambling_total_profit,
                "by_game": gambling_by_game,
            },
            "sports_betting": sports_stats,
            "booze": _booze_stats(u),
            "auto_rank": {
                "total_busts": int(u.get("auto_rank_total_busts") or 0),
                "total_crimes": int(u.get("auto_rank_total_crimes") or 0),
                "total_gtas": int(u.get("auto_rank_total_gtas") or 0),
                "total_cash": int(u.get("auto_rank_total_cash") or 0),
                "total_booze_runs": int(u.get("auto_rank_total_booze_runs") or 0),
                "total_booze_profit": int(u.get("auto_rank_total_booze_profit") or 0),
                "total_cars_melted": int(u.get("auto_rank_total_cars_melted") or 0),
                "total_bullets_from_melt": int(u.get("auto_rank_total_bullets_from_melt") or 0),
                "total_cars_scrapped": int(u.get("auto_rank_total_cars_scrapped") or 0),
                "total_cash_from_scrap": int(u.get("auto_rank_total_cash_from_scrap") or 0),
            },
            "stock_market": {
                "total_trades": stock_trades,
                "total_profit_points": stock_profit,
            },
            "bank": {
                "interest_earned": bank_interest_earned,
            },
            "prestige": {
                "level": int(u.get("prestige_level") or 0),
            },
        }
