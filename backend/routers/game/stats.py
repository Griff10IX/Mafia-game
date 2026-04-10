# Stats: overview (game capital, user stats, vehicles, ranks, recent kills, top dead)
# My Stats: per-user aggregated lifetime stats (combat, rank, bodyguards, gambling, casinos)
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException

from utils.attack_attempt_display import is_hitlist_npc_kill_excluded_from_stats


def _gambling_profit_from_details(game_type: str, details: dict) -> int:
    """Compute profit from gambling_log details. Positive = won, negative = lost."""
    # Handle different field names used by different games
    stake = int(details.get("stake") or details.get("bet") or details.get("total_stake") or 0)
    payout = int(details.get("payout") or details.get("total_payout") or 0)
    
    # Sports betting uses separate sports_bets collection
    if game_type == "sports_bet":
        return 0
    
    # MDG: track fees paid vs payouts received
    if game_type == "mdg":
        action = details.get("action")
        if action in ("create", "join"):
            # Player paid fee to enter
            fee_pts = int(details.get("fee_points") or 0)
            fee_money = int(details.get("fee_money") or 0)
            extra_pts = int(details.get("extra_pot_points") or 0)
            extra_money = int(details.get("extra_pot_money") or 0)
            return -(fee_pts + fee_money + extra_pts + extra_money)
        elif action == "payout":
            # Player won pot
            pot_pts = int(details.get("pot_points") or 0)
            pot_money = int(details.get("pot_money") or 0)
            return pot_pts + pot_money
        return 0
    
    # MP Blackjack: track buy-ins vs winnings
    if game_type == "mp_blackjack":
        action = details.get("action")
        if action in ("create", "join"):
            buy_in = int(details.get("buy_in") or 0)
            extra_prize = int(details.get("extra_prize") or 0)
            return -(buy_in + extra_prize)
        elif action == "payout":
            winnings = int(details.get("winnings") or 0)
            return winnings
        return 0
    
    # MP Poker: track buy-ins vs winnings
    if game_type == "mp_poker":
        action = details.get("action")
        if action in ("create", "join"):
            buy_in = int(details.get("buy_in") or 0)
            return -buy_in
        elif action == "payout":
            winnings = int(details.get("winnings") or 0)
            return winnings
        return 0

    # 8-Ball Pool: win gets pot + bonus, loss gets -stake (pot they put in)
    if game_type == "mp_8ball":
        action = details.get("action")
        if action == "win":
            return int(details.get("payout") or 0)
        elif action == "loss":
            return -int(details.get("stake") or 0)
        return 0
    
    return payout - stake


def _money_int(v) -> int:
    try:
        if v is None or v == "":
            return 0
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _gambling_stake_payout_for_analytics(game_type: str, details: dict) -> tuple[int, int]:
    """
    (stake, payout) in cash terms for admin casino summary rows.
    Must stay aligned with how each game logs in gambling_log.details.
    """
    d = details or {}
    gt = (game_type or "").strip() or "unknown"

    if gt == "mdg":
        action = d.get("action")
        if action in ("create", "join"):
            fee = _money_int(d.get("fee_money"))
            extra = _money_int(d.get("extra_pot_money")) if action == "create" else 0
            return fee + extra, 0
        if action == "payout":
            return 0, _money_int(d.get("pot_money"))
        return 0, 0

    if gt == "mp_blackjack":
        action = d.get("action")
        if action == "create":
            return _money_int(d.get("buy_in")) + _money_int(d.get("extra_prize")), 0
        if action == "join":
            return _money_int(d.get("buy_in")), 0
        if action == "payout":
            return 0, _money_int(d.get("winnings"))
        return 0, 0

    if gt == "mp_poker":
        action = d.get("action")
        if action in ("create", "join"):
            return _money_int(d.get("buy_in")), 0
        if action == "payout":
            return 0, _money_int(d.get("winnings"))
        return 0, 0

    if gt == "mp_8ball":
        action = d.get("action")
        if action == "win":
            return 0, _money_int(d.get("payout"))
        if action == "loss":
            return _money_int(d.get("stake")) or _money_int(d.get("pot")), 0
        return 0, 0

    stake = _money_int(d.get("stake") or d.get("bet") or d.get("total_stake"))
    payout = _money_int(d.get("payout") or d.get("total_payout"))
    return stake, payout


def _gambling_analytics_bucket(game_type: str, details: dict) -> str:
    """Stable aggregation key for gambling_log (splits mp_poker vs dealer vs multiplayer)."""
    gt = (game_type or "").strip() or "unknown"
    if gt != "mp_poker":
        return gt
    d = details or {}
    mode = d.get("mode")
    if mode == "vs_dealer":
        return "mp_poker_vs_dealer"
    if mode == "vs_players":
        return "mp_poker_vs_players"
    # Join is only used for multiplayer tables; older rows omitted mode.
    if d.get("action") == "join":
        return "mp_poker_vs_players"
    return "mp_poker"


def _stats_parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _gambling_log_entry_dt(created_at) -> Optional[datetime]:
    """Normalize gambling_log.created_at for comparisons. BSON is usually datetime; legacy rows may be ISO strings."""
    if created_at is None:
        return None
    if isinstance(created_at, datetime):
        dt = created_at
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    if isinstance(created_at, str):
        return _stats_parse_iso(created_at)
    return None


def _booze_stats(u: dict) -> dict:
    """Build booze stats dict. Uses get_rank_info and booze_run capacity logic."""
    from routers.money.booze_run import BOOZE_TYPES, BOOZE_CAPACITY_BASE_RANK1, BOOZE_CAPACITY_EXTRA_PER_RANK, BOOZE_CAPACITY_BONUS_MAX
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
    effective_player_kill_count = srv.effective_player_kill_count
    get_current_user = srv.get_current_user
    get_current_user_verified = srv.get_current_user_verified
    get_rank_info = srv.get_rank_info
    _is_admin = srv._is_admin
    _is_moderator = srv._is_moderator
    _staff_exclude_user_filter = srv._staff_exclude_user_filter
    _get_staff_user_ids = srv._get_staff_user_ids
    RANKS = srv.RANKS
    CARS = srv.CARS

    @router.get("/stats/overview")
    async def get_stats_overview(
        users_only_kills: bool = True,
        current_user: dict = Depends(get_current_user),
    ):
        now = datetime.now(timezone.utc)
        staff_filter = _staff_exclude_user_filter()
        staff_ids = await _get_staff_user_ids()
        # Real users only: exclude NPCs and staff (admins + mods)
        real_user_match = {"is_npc": {"$ne": True}, **staff_filter}
        alive_real_match = {"is_npc": {"$ne": True}, "is_dead": {"$ne": True}, **staff_filter}

        total_users = await db.users.count_documents(real_user_match)
        alive_users = await db.users.count_documents(alive_real_match)
        dead_users = max(0, total_users - alive_users)

        # Totals only from real users; total_cash only from alive real users
        # Game Capital "booze" = one number: sum of every non-NPC user's stored booze_profit_total (alive + dead + staff).
        totals = await db.users.aggregate([
            {"$match": real_user_match},
            {
                "$group": {
                    "_id": None,
                    "swiss_total": {"$sum": {"$ifNull": ["$swiss_balance", 0]}},
                    "bullets_total": {"$sum": {"$ifNull": ["$bullets", 0]}},
                    "total_crimes": {"$sum": {"$ifNull": ["$total_crimes", 0]}},
                    "total_gta": {"$sum": {"$ifNull": ["$total_gta", 0]}},
                    "total_jail_busts": {"$sum": {"$ifNull": ["$jail_busts", 0]}},
                    "total_oc_heists": {"$sum": {"$ifNull": ["$total_oc_heists", 0]}},
                    "bullets_melted_total": {"$sum": {"$ifNull": ["$bullets_melted", 0]}},
                    "token_store_points_spent_total": {"$sum": {"$ifNull": ["$token_points_spent", 0]}},
                    "token_store_respect_spent_total": {"$sum": {"$ifNull": ["$token_respect_spent", 0]}},
                    "token_store_cash_spent_total": {"$sum": {"$ifNull": ["$token_cash_spent", 0]}},
                }
            }
        ]).to_list(1)
        totals_doc = totals[0] if totals else {}

        booze_sum_rows = await db.users.aggregate(
            [
                {"$match": {"is_npc": {"$ne": True}}},
                {"$group": {"_id": None, "t": {"$sum": {"$ifNull": ["$booze_profit_total", 0]}}}},
            ]
        ).to_list(1)
        booze_profit_grand_total = int(booze_sum_rows[0].get("t", 0) or 0) if booze_sum_rows else 0

        # Family treasuries total
        family_treasury_agg = await db.families.aggregate([
            {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$treasury", 0]}}}}
        ]).to_list(1)
        family_treasury_total = int(family_treasury_agg[0].get("total", 0) or 0) if family_treasury_agg else 0
        # Total cash: alive real users only (not dead, not NPCs)
        cash_agg = await db.users.aggregate([
            {"$match": alive_real_match},
            {"$group": {"_id": None, "money_total": {"$sum": {"$ifNull": ["$money", 0]}}}}
        ]).to_list(1)
        total_cash_alive = int(cash_agg[0].get("money_total", 0) or 0) if cash_agg else 0

        bank_match = {"claimed_at": None}
        if staff_ids:
            bank_match["user_id"] = {"$nin": staff_ids}
        interest_agg = await db.bank_deposits.aggregate([
            {"$match": bank_match},
            {"$group": {"_id": None, "total": {"$sum": {"$add": [{"$ifNull": ["$principal", 0]}, {"$ifNull": ["$interest_amount", 0]}]}}}}
        ]).to_list(1)
        interest_bank_total = int(interest_agg[0].get("total", 0) or 0) if interest_agg else 0

        qt_match = {"status": "active"}
        if staff_ids:
            qt_match["user_id"] = {"$nin": staff_ids}
        quicktrade_agg = await db.trade_buy_offers.aggregate([
            {"$match": qt_match},
            {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$offer", 0]}}}}
        ]).to_list(1)
        quicktrade_cash = int(quicktrade_agg[0].get("total", 0) or 0) if quicktrade_agg else 0

        non_staff_car_filter = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
        total_vehicles = await db.user_cars.count_documents(non_staff_car_filter)
        car_counts = await db.user_cars.aggregate([
            {"$match": non_staff_car_filter},
            {"$group": {"_id": "$car_id", "count": {"$sum": 1}}}
        ]).to_list(100)
        car_by_id = {c.get("id"): c for c in CARS}
        rarity_counts = {"common": 0, "uncommon": 0, "rare": 0, "ultra_rare": 0, "legendary": 0, "custom": 0, "exclusive": 0, "loot_exclusive": 0}
        total_vehicle_value = 0
        for cc in car_counts:
            car_id = cc.get("_id")
            cnt = int(cc.get("count", 0) or 0)
            info = car_by_id.get(car_id) or {}
            rarity = info.get("rarity") or "common"
            car_value = int(info.get("value") or 0)
            total_vehicle_value += car_value * cnt
            if rarity in rarity_counts:
                rarity_counts[rarity] += cnt
            else:
                rarity_counts["common"] += cnt
        
        # Cars scrapped and melted totals
        cars_scrapped_agg = await db.users.aggregate([
            {"$match": real_user_match},
            {
                "$group": {
                    "_id": None,
                    "scrapped": {
                        "$sum": {
                            "$add": [
                                {"$ifNull": ["$total_cars_scrapped", 0]},
                                {"$ifNull": ["$auto_rank_total_cars_scrapped", 0]},
                            ]
                        }
                    },
                    "melted": {
                        "$sum": {
                            "$add": [
                                {"$ifNull": ["$total_cars_melted", 0]},
                                {"$ifNull": ["$auto_rank_total_cars_melted", 0]},
                            ]
                        }
                    },
                }
            }
        ]).to_list(1)
        cars_scrapped_doc = cars_scrapped_agg[0] if cars_scrapped_agg else {}
        
        # Racing cars count
        racing_cars_count = await db.user_racing_cars.count_documents(non_staff_car_filter)
        
        # GTA success rate (GTAs / attempts if we have attempts data)
        gta_stats_agg = await db.users.aggregate([
            {"$match": real_user_match},
            {"$group": {"_id": None, "gta_total": {"$sum": {"$ifNull": ["$total_gta", 0]}}, "gta_fails": {"$sum": {"$ifNull": ["$total_gta_fails", 0]}}}}
        ]).to_list(1)
        gta_stats_doc = gta_stats_agg[0] if gta_stats_agg else {}

        rank_thresholds = sorted(
            [(r["id"], r["required_points"]) for r in RANKS],
            key=lambda x: x[1], reverse=True,
        )

        def _build_rank_branch(is_dead_val):
            branches = []
            for rid, req in rank_thresholds:
                branches.append({
                    "case": {"$gte": [{"$ifNull": ["$rank_points", 0]}, req]},
                    "then": rid,
                })
            return {"$switch": {"branches": branches, "default": rank_thresholds[-1][0]}}

        rank_agg = await db.users.aggregate([
            {"$match": real_user_match},
            {"$project": {
                "_id": 0,
                "rank_id": _build_rank_branch(None),
                "is_dead": {"$ifNull": ["$is_dead", False]},
            }},
            {"$group": {
                "_id": {"rank_id": "$rank_id", "is_dead": "$is_dead"},
                "count": {"$sum": 1},
            }},
        ]).to_list(200)

        rank_stats_map: dict = {}
        for r in RANKS:
            rank_stats_map[int(r["id"])] = {"rank_id": int(r["id"]), "rank_name": r["name"], "alive": 0, "dead": 0}
        for row in rank_agg:
            rid = int(row["_id"]["rank_id"])
            bucket = rank_stats_map.get(rid)
            if not bucket:
                continue
            if row["_id"]["is_dead"]:
                bucket["dead"] += row["count"]
            else:
                bucket["alive"] += row["count"]

        rank_stats = [rank_stats_map[r["id"]] for r in RANKS]

        attempts = await db.attack_attempts.find(
            {"outcome": "killed"},
            {"_id": 0}
        ).sort("created_at", -1).to_list(500)

        all_user_ids = set()
        for a in attempts:
            aid = a.get("attacker_id")
            tid = a.get("target_id")
            if aid:
                all_user_ids.add(aid)
            if tid:
                all_user_ids.add(tid)
        users_batch = {}
        if all_user_ids:
            users_list = await db.users.find(
                {"id": {"$in": list(all_user_ids)}},
                {"_id": 0, "id": 1, "is_npc": 1, "rank_points": 1, "username": 1},
            ).to_list(None)
            users_batch = {u["id"]: u for u in users_list}

        recent_kills = []
        seen_kills = set()
        staff_can_see = current_user and (_is_admin(current_user) or _is_moderator(current_user))
        for a in attempts:
            dedup_key = (a.get("target_username"), a.get("attacker_username"), a.get("created_at"))
            if dedup_key in seen_kills:
                continue
            seen_kills.add(dedup_key)

            killer = users_batch.get(a.get("attacker_id"))
            victim = users_batch.get(a.get("target_id"))

            killer_is_npc = bool(killer and killer.get("is_npc"))
            victim_is_npc = bool(victim and victim.get("is_npc"))
            if is_hitlist_npc_kill_excluded_from_stats(a, victim):
                continue
            if users_only_kills and killer_is_npc:
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
            killer_username = a.get("attacker_username") if (is_public or staff_can_see) else None
            victim_username = a.get("target_username")
            if not victim_username:
                continue

            recent_kills.append({
                "id": a.get("id") or a.get("attack_id") or str(uuid.uuid4()),
                "victim_username": victim_username,
                "victim_rank_name": victim_rank_name,
                "victim_is_npc": victim_is_npc,
                "killer_username": killer_username,
                "is_public": is_public,
                "created_at": a.get("created_at"),
            })

            if len(recent_kills) >= 15:
                break

        # Wiped families: wars that ended with one family wiped (all dead)
        wiped_wars = await db.family_wars.find(
            {"status": {"$in": ["family_a_wins", "family_b_wins"]}},
            {"_id": 0, "id": 1, "winner_family_id": 1, "winner_family_name": 1, "loser_family_id": 1, "loser_family_name": 1, "ended_at": 1, "wiped_by_killer_id": 1, "wiped_by_killer_username": 1}
        ).sort("ended_at", -1).limit(30).to_list(30)
        wiped_families = []
        seen_loser_ids = set()
        for w in wiped_wars:
            loser_id = w.get("loser_family_id")
            if loser_id in seen_loser_ids:
                continue
            seen_loser_ids.add(loser_id)
            war_id = w.get("id")
            winner_id = w.get("winner_family_id")
            winner_name = (w.get("winner_family_name") or "?").strip() or "?"
            loser_name = (w.get("loser_family_name") or "?").strip() or "?"
            wiped_by_killer_id = w.get("wiped_by_killer_id")
            wiped_by_killer_username = (w.get("wiped_by_killer_username") or "?").strip() or "?"
            # Aggregate winner-side stats for this war (player kills, BG kills; whether winner was in a family)
            stats_docs = await db.family_war_stats.find(
                {"war_id": war_id, "family_id": winner_id},
                {"_id": 0, "kills": 1, "bodyguard_kills": 1, "deaths": 1}
            ).to_list(100) if winner_id else []
            player_kills = sum(int(s.get("kills") or 0) for s in stats_docs)
            bodyguard_kills = sum(int(s.get("bodyguard_kills") or 0) for s in stats_docs)
            wiped_families.append({
                "war_id": war_id,
                "wiped_family_id": loser_id,
                "wiped_by_family_id": None if wiped_by_killer_id else winner_id,
                "wiped_family_name": loser_name,
                "wiped_by_family_name": None if wiped_by_killer_id else winner_name,
                "wiped_by_killer_id": wiped_by_killer_id,
                "wiped_by_killer_username": wiped_by_killer_username if wiped_by_killer_id else None,
                "wiped_by_in_family": not wiped_by_killer_id,
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
                "booze_profit_total": booze_profit_grand_total,
                "bullets_total": int(totals_doc.get("bullets_total", 0) or 0),
                "family_treasury_total": family_treasury_total,
                "token_store_points_spent_total": int(totals_doc.get("token_store_points_spent_total", 0) or 0),
                "token_store_respect_spent_total": int(totals_doc.get("token_store_respect_spent_total", 0) or 0),
                "token_store_cash_spent_total": int(totals_doc.get("token_store_cash_spent_total", 0) or 0),
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
                "total_vehicle_value": int(total_vehicle_value),
                "common_vehicles": int(rarity_counts.get("common", 0)),
                "uncommon_vehicles": int(rarity_counts.get("uncommon", 0)),
                "rare_vehicles": int(rarity_counts.get("rare", 0)),
                "ultra_rare_vehicles": int(rarity_counts.get("ultra_rare", 0)),
                "legendary_vehicles": int(rarity_counts.get("legendary", 0)),
                "custom_vehicles": int(rarity_counts.get("custom", 0)),
                "exclusive_vehicles": int(rarity_counts.get("exclusive", 0)),
                "loot_exclusive_vehicles": int(rarity_counts.get("loot_exclusive", 0)),
                "racing_cars": int(racing_cars_count),
                "cars_scrapped": int(cars_scrapped_doc.get("scrapped", 0) or 0),
                "cars_melted": int(cars_scrapped_doc.get("melted", 0) or 0),
                "gta_success": int(gta_stats_doc.get("gta_total", 0) or 0),
                "gta_fails": int(gta_stats_doc.get("gta_fails", 0) or 0),
            },
            "rank_stats": rank_stats,
            "recent_kills": recent_kills,
            "wiped_families": wiped_families,
        }

    @router.get("/stats/me")
    async def get_my_stats(current_user: dict = Depends(get_current_user)):
        """Aggregate per-user lifetime stats: combat, rank, bodyguards, gambling, casinos, etc."""
        from routers.kill.bodyguards import get_bodyguards_stats
        from routers.cars.gta import get_gta_stats
        from routers.crime.crimes import get_crime_stats
        from routers.crime.jail import get_jail_stats
        from routers.casinos.sports_betting import compute_sports_betting_stats
        from server import _get_casino_property_profit

        uid = current_user["id"]
        u = await db.users.find_one(
            {"id": uid},
            {
                "_id": 0,
                "total_kills": 1,
                "total_deaths": 1,
                "hitlist_npc_kills": 1,
                "robot_bodyguard_kills": 1,
                "total_kills_excludes_npc_v1": 1,
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
                "casinos_seized": 1, "casinos_lost": 1, "properties_seized": 1, "properties_lost": 1,
                "total_casino_payouts": 1, "biggest_casino_payout": 1,
                "stats_gambling_reset_at": 1,
            },
        )
        u = u or {}
        _raw_gambling_reset = u.get("stats_gambling_reset_at")
        if isinstance(_raw_gambling_reset, datetime):
            _rdt = _raw_gambling_reset
            if _rdt.tzinfo is None:
                _rdt = _rdt.replace(tzinfo=timezone.utc)
            stats_gambling_reset_at = _rdt.isoformat()
        elif isinstance(_raw_gambling_reset, str) and _raw_gambling_reset.strip():
            stats_gambling_reset_at = _raw_gambling_reset.strip()
        else:
            stats_gambling_reset_at = None
        stats_gambling_reset_dt = _stats_parse_iso(stats_gambling_reset_at) if stats_gambling_reset_at else None

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

        _sidebar_cash, property_pts, has_casino, has_property, casino_profit = await _get_casino_property_profit(uid)
        # casino_profit for My Stats = cumulative `total_earnings` (5th tuple value); not cleared by reset profit
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
            sports_lifetime = await compute_sports_betting_stats(uid, None)
            if stats_gambling_reset_at:
                sports_period = await compute_sports_betting_stats(uid, stats_gambling_reset_at)
                sports_stats = {
                    **sports_period,
                    "display_since": stats_gambling_reset_at,
                    "streaks_all_time": True,
                    "lifetime_total_bets_placed": sports_lifetime["total_bets_placed"],
                    "lifetime_total_bets_won": sports_lifetime["total_bets_won"],
                    "lifetime_total_bets_lost": sports_lifetime["total_bets_lost"],
                    "lifetime_win_pct": sports_lifetime["win_pct"],
                    "lifetime_profit_loss": sports_lifetime["profit_loss"],
                    "lifetime_biggest_win": sports_lifetime["biggest_win"],
                    "lifetime_biggest_loss": sports_lifetime["biggest_loss"],
                }
            else:
                sports_stats = sports_lifetime
        except Exception:
            pass

        hitlist_npc_kills = int(u.get("hitlist_npc_kills") or 0)
        robot_bodyguard_kills = int(u.get("robot_bodyguard_kills") or 0)
        combat_total_kills = effective_player_kill_count(u)

        gambling_by_game_lt: dict = {}
        gambling_total_lt = 0
        gambling_by_game_period: dict = {}
        gambling_total_period = 0
        cursor = db.gambling_log.find(
            {"user_id": uid},
            {"_id": 0, "game_type": 1, "details": 1, "created_at": 1},
        ).limit(5000)
        async for entry in cursor:
            gt = (entry.get("game_type") or "").strip()
            if not gt:
                continue
            details = entry.get("details") or {}
            profit = _gambling_profit_from_details(gt, details)
            if profit == 0:
                continue
            bucket = _gambling_analytics_bucket(gt, details)
            gambling_by_game_lt[bucket] = gambling_by_game_lt.get(bucket, 0) + profit
            gambling_total_lt += profit
            entry_dt = _gambling_log_entry_dt(entry.get("created_at"))
            if stats_gambling_reset_dt is None or (entry_dt is not None and entry_dt >= stats_gambling_reset_dt):
                gambling_by_game_period[bucket] = gambling_by_game_period.get(bucket, 0) + profit
                gambling_total_period += profit

        return {
            "combat": {
                "total_kills": combat_total_kills,
                "total_deaths": int(u.get("total_deaths") or 0),
                "hitlist_npc_kills": hitlist_npc_kills,
                "robot_bodyguard_kills": robot_bodyguard_kills,
                "user_kills": combat_total_kills,
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
                "casinos_seized": int(u.get("casinos_seized") or 0),
                "casinos_lost": int(u.get("casinos_lost") or 0),
                "properties_seized": int(u.get("properties_seized") or 0),
                "properties_lost": int(u.get("properties_lost") or 0),
                "total_casino_payouts": int(u.get("total_casino_payouts") or 0),
                "biggest_casino_payout": int(u.get("biggest_casino_payout") or 0),
            },
            "gambling": {
                "total_profit": gambling_total_period,
                "by_game": gambling_by_game_period,
                "lifetime_total_profit": gambling_total_lt,
                "lifetime_by_game": gambling_by_game_lt,
                "display_reset_at": stats_gambling_reset_at,
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

    @router.post("/stats/me/reset-gambling-display")
    async def reset_my_gambling_stats_display(current_user: dict = Depends(get_current_user_verified)):
        """Start a fresh gambling/sports stats window on My Stats. Lifetime totals stay in API as lifetime_* / gambling_log."""
        uid = current_user["id"]
        now = datetime.now(timezone.utc).isoformat()
        r = await db.users.update_one({"id": uid}, {"$set": {"stats_gambling_reset_at": now}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        return {"ok": True, "reset_at": now}
