# Central place for MongoDB indexes used across routers (except profile-specific ones in routers/profile.py).
# Idempotent: safe to run on every startup.
import logging

logger = logging.getLogger(__name__)


async def ensure_all_indexes(db):
    """Create indexes for bank, attack, families, GTA, airport, OC, jail, forum, etc."""
    try:
        # --- Bank ---
        await db.bank_deposits.create_index([("user_id", 1), ("created_at", -1)])
        await db.bank_deposits.create_index([("user_id", 1), ("claimed_at", 1)])
        await db.money_transfers.create_index([("from_user_id", 1), ("created_at", -1)])
        await db.money_transfers.create_index([("to_user_id", 1), ("created_at", -1)])
        await db.bank_deposits.create_index([("id", 1), ("user_id", 1)])
        await db.bank_deposits.create_index("id")

        # --- Stock market ---
        await db.stock_transactions.create_index([("user_id", 1), ("created_at", -1)])

        # --- Game config / settings ---
        await db.game_config.create_index("id", unique=True)
        # Sparse: only index docs that have "key"; docs with only "id" (main, auto_rank) have no key so avoid duplicate null
        try:
            await db.game_config.drop_index("key_1")
        except Exception:
            pass
        await db.game_config.create_index([("key", 1)], unique=True, sparse=True)
        await db.game_settings.create_index("key", unique=True)

        # --- Families ---
        await db.family_members.create_index("family_id")
        await db.family_members.create_index([("family_id", 1), ("user_id", 1)])
        await db.family_wars.create_index("id", unique=True)
        await db.family_wars.create_index([("family_a_id", 1), ("family_b_id", 1)])
        await db.family_wars.create_index([("status", 1), ("created_at", -1)])
        await db.family_wars.create_index([("family_a_id", 1), ("status", 1)])
        await db.family_wars.create_index([("family_b_id", 1), ("status", 1)])
        await db.family_crew_oc_applications.create_index([("family_id", 1), ("created_at", -1)])
        await db.family_crew_oc_applications.create_index([("family_id", 1), ("status", 1)])
        await db.family_crew_oc_applications.create_index([("family_id", 1), ("user_id", 1)])
        await db.family_crew_oc_applications.create_index([("id", 1), ("family_id", 1)])
        await db.family_racket_attacks.create_index([("attacker_family_id", 1), ("target_family_id", 1), ("last_at", -1)])
        await db.family_war_stats.create_index("war_id")
        await db.family_war_stats.create_index([("war_id", 1), ("user_id", 1)], unique=True)
        await db.families.create_index("id", unique=True)
        await db.families.create_index("name")
        await db.families.create_index("tag")
        await db.families.create_index("wiped")  # list non-wiped families

        # --- Attack ---
        await db.attacks.create_index([("attacker_id", 1), ("search_started", -1)])
        await db.attacks.create_index([("attacker_id", 1), ("expires_at", 1)])
        await db.attacks.create_index("id")
        await db.attacks.create_index([("attacker_id", 1), ("id", 1)])
        await db.attacks.create_index("target_id")
        await db.attack_attempts.create_index([("attacker_id", 1), ("created_at", -1)])
        await db.attack_attempts.create_index([("target_id", 1), ("created_at", -1)])
        await db.attack_attempts.create_index([("outcome", 1), ("created_at", -1)])

        # --- User cars / GTA ---
        await db.user_cars.create_index("user_id")
        await db.user_cars.create_index([("user_id", 1), ("acquired_at", -1)])
        await db.user_cars.create_index([("listed_for_sale", 1), ("listed_at", -1)])
        await db.user_cars.create_index("id", unique=True)
        await db.user_cars.create_index([("user_id", 1), ("car_id", 1)])
        await db.gta_cooldowns.create_index("user_id", unique=True)
        await db.user_gta.create_index("user_id")
        await db.gta_events.create_index([("user_id", 1), ("at", -1)])
        await db.dealer_stock.create_index("car_id")

        # --- Properties ---
        await db.properties.create_index("id", unique=True)
        await db.user_properties.create_index("user_id")
        await db.user_properties.create_index([("user_id", 1), ("property_id", 1)])

        # --- Illegal business (racket) ---
        await db.illegal_businesses.create_index("user_id", unique=True)
        await db.illegal_business_guards.create_index([("business_id", 1), ("slot_number", 1)])
        await db.illegal_business_guards.create_index("user_id")

        # --- Airport / bullet factory ---
        await db.airport_ownership.create_index("owner_id")
        await db.airport_ownership.create_index([("state", 1), ("slot", 1)], unique=True)
        await db.exclusive_properties.create_index("owner_id")
        await db.exclusive_properties.create_index("id", unique=True)
        await db.bullet_factory.create_index("owner_id")
        await db.bullet_factory.create_index("state")

        # --- Casino ownership: city/state + owner_id (roulette, dice, horseracing, video poker, blackjack, slots) ---
        for coll_name in ("dice_ownership", "roulette_ownership", "blackjack_ownership", "horseracing_ownership", "videopoker_ownership"):
            await db[coll_name].create_index("city")
            await db[coll_name].create_index("owner_id")
        await db.slots_ownership.create_index("state")
        await db.slots_ownership.create_index("owner_id")
        await db.slots_entries.create_index("state", unique=True)
        await db.slots_buy_back_offers.create_index("id")
        await db.slots_buy_back_offers.create_index("to_user_id")

        # --- Casino buy-back offers (dice, blackjack) ---
        await db.dice_buy_back_offers.create_index("id")
        await db.dice_buy_back_offers.create_index("to_user_id")
        await db.dice_buy_back_offers.create_index("from_owner_id")
        await db.dice_buy_back_offers.create_index([("to_user_id", 1), ("expires_at", 1)])
        await db.blackjack_buy_back_offers.create_index("id")
        await db.blackjack_buy_back_offers.create_index("to_user_id")
        await db.blackjack_buy_back_offers.create_index("from_owner_id")
        await db.blackjack_buy_back_offers.create_index([("to_user_id", 1), ("expires_at", 1)])
        await db.blackjack_games.create_index("user_id")
        await db.mp_blackjack_games.create_index("id", unique=True)
        await db.mp_blackjack_games.create_index("status")
        await db.mp_blackjack_games.create_index("created_at")
        await db.mp_poker_games.create_index("id", unique=True)
        await db.mp_poker_games.create_index("status")
        await db.mp_poker_games.create_index("mode")
        await db.mp_poker_games.create_index("created_at")
        await db.mp_poker_games.create_index("user_id")
        await db.mp_8ball_games.create_index("id", unique=True)
        await db.mp_8ball_games.create_index("status")
        await db.mp_8ball_games.create_index("mode")
        await db.mp_8ball_games.create_index("owner_user_id")
        await db.mp_8ball_games.create_index("created_at")
        await db.pool_profiles.create_index("user_id", unique=True)
        await db.pool_profiles.create_index([("rating", -1), ("wins", -1)])
        await db.user_pool_cues.create_index("id", unique=True)
        await db.user_pool_cues.create_index([("user_id", 1), ("selected", 1)])
        await db.user_pool_cues.create_index([("user_id", 1), ("cue_id", 1)], unique=True)
        await db.pool_cue_upgrades.create_index([("user_id", 1), ("cue_instance_id", 1)], unique=True)
        await db.videopoker_games.create_index("user_id")

        # --- Organised crime ---
        await db.user_organised_crime.create_index("user_id", unique=True)
        await db.oc_pending_heists.create_index("creator_id")
        await db.oc_pending_heists.create_index([("creator_id", 1), ("id", 1)])
        await db.oc_pending_heists.create_index("id", unique=True)
        await db.oc_invites.create_index("id", unique=True)
        await db.oc_invites.create_index("creator_id")
        await db.oc_invites.create_index([("pending_heist_id", 1), ("role", 1)])
        await db.oc_invites.create_index("pending_heist_id")
        await db.user_crimes.create_index("user_id")
        await db.user_crimes.create_index([("user_id", 1), ("crime_id", 1)])

        # --- Jail ---
        await db.jail_npcs.create_index("username", unique=True)
        await db.bust_events.create_index([("user_id", 1), ("at", -1)])

        # --- Bodyguards / hitlist ---
        await db.bodyguards.create_index("id", unique=True)
        await db.bodyguards.create_index("user_id")
        await db.bodyguards.create_index("bodyguard_user_id")
        await db.bodyguards.create_index([("user_id", 1), ("slot_number", 1)])
        await db.bodyguard_payouts.create_index(
            [("owner_id", 1), ("slot_number", 1), ("payout_date", 1)],
            unique=True,
        )
        await db.bodyguard_payouts.create_index("payout_date")
        await db.bodyguard_payouts.create_index("guard_id")
        await db.hitlist.create_index("target_id")
        await db.hitlist.create_index([("target_id", 1), ("target_type", 1)])
        await db.hitlist.create_index([("reward_amount", -1), ("created_at", -1)])

        # --- Hitlist / bodyguard events (admin analytics) ---
        await db.hitlist_bodyguard_events.create_index([("at", -1)])
        await db.hitlist_bodyguard_events.create_index([("type", 1), ("at", -1)])

        # --- Economy events (car/property/loot/booze analytics) ---
        await db.economy_events.create_index([("at", -1)])
        await db.economy_events.create_index([("type", 1), ("at", -1)])
        await db.economy_events.create_index([("user_id", 1), ("at", -1)])

        # --- Crimes ---
        await db.crimes.create_index("id", unique=True)

        # --- Reference / config data ---
        await db.weapons.create_index("id", unique=True)

        # --- Weapons / store ---
        await db.user_weapons.create_index("user_id")
        await db.user_weapons.create_index([("user_id", 1), ("quantity", 1)])

        # --- Auth / payments ---
        await db.users.create_index("email")
        await db.password_resets.create_index("token", unique=True)
        await db.email_verifications.create_index("token", unique=True)
        await db.email_verifications.create_index("expires_at")
        await db.login_lockouts.create_index("email", unique=True)
        # One document per IP: duplicate visits from same IP are not counted (unique visitor count)
        await db.login_page_visits.create_index("ip", unique=True)
        await db.revive_used_by_email.create_index("email", unique=True)
        await db.payment_transactions.create_index("session_id", unique=True)
        await db.point_lots.create_index("id", unique=True)
        await db.point_lots.create_index([("owner_user_id", 1), ("created_at", 1)])
        await db.point_lots.create_index([("root_purchase_ref", 1), ("owner_user_id", 1)])
        await db.point_lots.create_index([("origin_ref", 1)])
        await db.point_ledger_events.create_index("id", unique=True)
        await db.point_ledger_events.create_index([("user_id", 1), ("created_at", -1)])
        await db.point_ledger_events.create_index([("root_purchase_ref", 1), ("created_at", -1)])
        await db.point_ledger_events.create_index([("origin_ref", 1), ("created_at", -1)])

        # --- Notifications: unread count (profile has user_id) ---
        await db.notifications.create_index([("user_id", 1), ("read", 1)])
        await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
        await db.notifications.create_index([("id", 1), ("user_id", 1)])
        await db.notifications.create_index([("user_id", 1), ("sender_id", 1), ("created_at", 1)])
        await db.notifications.create_index([("user_id", 1), ("recipient_id", 1), ("created_at", 1)])

        # --- Sports betting ---
        await db.sports_events.create_index("id", unique=True)
        await db.sports_events.create_index([("id", 1), ("status", 1)])
        await db.sports_events.create_index([("status", 1), ("start_time", 1)])
        await db.sports_bets.create_index([("user_id", 1), ("status", 1)])
        await db.sports_bets.create_index([("user_id", 1), ("status", 1), ("created_at", -1)])
        await db.sports_bets.create_index([("user_id", 1), ("status", 1), ("settled_at", -1)])
        await db.sports_bets.create_index("id")

        # --- The Odds API response cache (sports betting templates / scores) ---
        await db.sports_odds_api_cache.create_index("cache_key", unique=True)
        await db.sports_odds_api_cache.create_index([("fetched_at", -1)])

        # --- Sports betting: admin template library (persisted after "Check for events") ---
        await db.sports_betting_templates.create_index("id", unique=True)
        await db.sports_betting_templates.create_index([("category", 1), ("saved_at", -1)])

        # --- Flappy Gangster (Gauntlet) ---
        await db.minigame_run_sessions.create_index("id", unique=True)
        await db.minigame_run_sessions.create_index([("game", 1), ("user_id", 1)])
        await db.minigame_run_sessions.create_index([("expires_at", 1)], expireAfterSeconds=0)
        await db.minigame_identical_claims.create_index(
            [("user_id", 1), ("game", 1), ("fp", 1), ("window_id", 1)],
            unique=True,
        )
        await db.gauntlet_scores.create_index("id", unique=True)
        await db.gauntlet_scores.create_index([("score", -1), ("at", 1)])
        await db.gauntlet_scores.create_index([("user_id", 1), ("at", -1)])
        await db.gauntlet_scores.create_index([("at", -1)])

        # --- Package Run (Snake) ---
        await db.snake_scores.create_index("id", unique=True)
        await db.snake_scores.create_index([("score", -1), ("at", 1)])
        await db.snake_scores.create_index([("user_id", 1), ("at", -1)])
        await db.snake_scores.create_index([("at", -1)])

        # --- Boxing ---
        await db.boxing_profiles.create_index("user_id", unique=True)
        await db.user_boxing_gear.create_index([("user_id", 1), ("gear_id", 1)], unique=True)
        await db.user_boxing_gear.create_index([("user_id", 1), ("acquired_at", -1)])
        await db.boxing_matches.create_index("id", unique=True)
        await db.boxing_matches.create_index([("state", 1), ("next_round_at", 1)])
        await db.boxing_matches.create_index([("a_id", 1), ("created_at", -1)])
        await db.boxing_matches.create_index([("b_id", 1), ("created_at", -1)])
        await db.boxing_bets.create_index("id")
        await db.boxing_bets.create_index([("match_id", 1), ("status", 1)])
        await db.boxing_bets.create_index([("user_id", 1), ("status", 1), ("created_at", -1)])
        await db.boxing_events.create_index([("user_id", 1), ("at", -1)])
        await db.boxing_events.create_index([("at", -1)])

        # --- Respect earned (weekly leaderboard / objectives; documents use at or created_at) ---
        await db.respect_events.create_index([("user_id", 1), ("at", -1)])
        await db.respect_events.create_index([("user_id", 1), ("created_at", -1)])

        # --- Racing (road races / championship; shares user_racing_cars with garage car instances) ---
        await db.racing_races.create_index("id", unique=True)
        await db.racing_races.create_index([("state", 1), ("created_at", -1)])
        await db.racing_races.create_index([("state", 1), ("completed_at", -1)])
        await db.racing_races.create_index([("state", 1), ("participants.user_id", 1), ("completed_at", -1)])
        await db.racing_profiles.create_index("user_id", unique=True)
        await db.user_racing_cars.create_index([("user_id", 1), ("id", 1)])
        await db.racing_upgrades.create_index([("user_id", 1), ("racing_car_instance_id", 1)])
        await db.racing_championships.create_index([("status", 1)])
        await db.racing_meta.create_index("id", unique=True)
        await db.racing_records.create_index([("track_id", 1), ("type", 1)])
        await db.racing_records.create_index([("track_id", 1), ("type", 1), ("user_id", 1)])

        # --- Quick trade ---
        await db.trade_sell_offers.create_index([("status", 1), ("created_at", -1)])
        await db.trade_sell_offers.create_index([("user_id", 1), ("status", 1)])
        await db.trade_buy_offers.create_index([("status", 1), ("created_at", -1)])
        await db.trade_buy_offers.create_index([("user_id", 1), ("status", 1)])
        await db.properties.create_index([("for_sale", 1), ("created_at", -1)])
        await db.trade_events.create_index([("at", -1)])
        await db.trade_events.create_index([("type", 1), ("at", -1)])
        await db.trade_events.create_index([("direction", 1), ("at", -1)])

        # --- Forum ---
        await db.forum_topics.create_index("id", unique=True)
        await db.forum_topics.create_index([("is_important", -1), ("is_sticky", -1), ("updated_at", -1)])
        await db.forum_comments.create_index("id", unique=True)
        await db.forum_comments.create_index([("id", 1), ("topic_id", 1)])
        await db.forum_comments.create_index("topic_id")
        await db.forum_comments.create_index([("topic_id", 1), ("created_at", 1)])
        await db.forum_comment_likes.create_index([("comment_id", 1), ("user_id", 1)])
        await db.forum_comment_dislikes.create_index([("comment_id", 1), ("user_id", 1)])

        # --- Image host (user uploads) ---
        await db.image_host_uploads.create_index("public_id", unique=True)
        await db.image_host_uploads.create_index([("user_id", 1), ("deleted_at", 1), ("created_at", -1)])
        await db.image_host_uploads.create_index([("is_public_gallery", 1), ("deleted_at", 1), ("created_at", -1)])

        # --- War kill feed (family war UI) ---
        await db.war_kill_feed.create_index([("war_id", 1), ("created_at", -1)])

        # --- Game chat ---
        await db.game_chat_messages.create_index([("created_at", -1)])
        await db.game_chat_messages.create_index("id", unique=True)
        await db.game_chat_messages.create_index([("family_id", 1), ("created_at", -1)])

        # --- Security / admin ---
        await db.bans.create_index([("active", 1), ("created_at", -1)])
        await db.bans.create_index([("user_id", 1), ("active", 1)])
        await db.ip_bans.create_index([("ip", 1), ("active", 1)])
        await db.ip_bans.create_index([("active", 1), ("created_at", -1)])
        # One-time normalize: IPv6 has many equivalent strings; lookups use canonical form
        try:
            from utils.ip_normalize import normalize_ip_string

            async for doc in db.ip_bans.find({}, {"_id": 1, "ip": 1}):
                old = doc.get("ip") or ""
                new = normalize_ip_string(old)
                if new and new != old:
                    await db.ip_bans.update_one({"_id": doc["_id"]}, {"$set": {"ip": new}})
        except Exception as e:
            logger.warning("ip_bans IP normalize: %s", e)
        await db.security_flags.create_index([("user_id", 1), ("created_at", -1)])
        await db.security_flags.create_index([("created_at", 1)])
        await db.rate_limit_clicks.create_index([("user_id", 1), ("endpoint_key", 1)], unique=True)
        await db.rate_limit_clicks.create_index("last_at", expireAfterSeconds=86400)  # TTL: remove 24h after last use
        await db.security_logs.create_index([("created_at", -1)])
        await db.activity_log.create_index([("created_at", -1)])
        await db.activity_log.create_index([("username", 1), ("created_at", -1)])
        await db.gambling_log.create_index([("created_at", -1)])
        await db.gambling_log.create_index([("user_id", 1), ("created_at", -1)])
        await db.gambling_log.create_index([("username", 1), ("created_at", -1)])
        await db.gambling_log.create_index([("game_type", 1), ("created_at", -1)])

        # --- Entertainer ---
        await db.entertainer_games.create_index("id", unique=True)
        await db.entertainer_games.create_index([("status", 1)])
        await db.entertainer_games.create_index([("status", 1), ("completed_at", -1)])
        await db.entertainer_games.create_index([("created_at", -1)])

        # --- Designer competitions ---
        await db.designer_competitions.create_index("id", unique=True)
        await db.designer_competitions.create_index("status")
        await db.designer_competitions.create_index("end_at")
        await db.designer_competition_entries.create_index("competition_id")
        await db.designer_competition_entries.create_index("topic_id")
        await db.designer_competition_entries.create_index("comment_id")
        await db.designer_competition_entries.create_index("user_id")
        await db.designer_competition_entries.create_index("id", unique=True)
        await db.designer_competition_votes.create_index([("competition_id", 1), ("user_id", 1)], unique=True)
        await db.designer_competition_votes.create_index("competition_id")
        await db.designer_competition_votes.create_index("entry_id")
        await db.designer_competition_votes.create_index([("competition_id", 1), ("entry_id", 1)])

        # --- Designer forum auctions ---
        await db.forum_designer_auctions.create_index("id", unique=True)
        await db.forum_designer_auctions.create_index([("topic_id", 1)], unique=True)
        await db.forum_designer_auctions.create_index([("status", 1), ("end_at", 1)])
        await db.forum_designer_auction_bids.create_index("id", unique=True)
        await db.forum_designer_auction_bids.create_index([("auction_id", 1), ("created_at", -1)])
        await db.forum_designer_auction_disputes.create_index("id", unique=True)
        await db.forum_designer_auction_disputes.create_index([("auction_id", 1), ("status", 1), ("created_at", -1)])

        # --- Game Ideas (forum hub + voting) ---
        await db.game_idea_seasons.create_index("id", unique=True)
        await db.game_idea_seasons.create_index("status")
        await db.game_idea_entries.create_index("id", unique=True)
        await db.game_idea_entries.create_index("season_id")
        await db.game_idea_entries.create_index("comment_id")
        await db.game_idea_entries.create_index([("season_id", 1), ("user_id", 1)], unique=True)
        await db.game_idea_votes.create_index([("season_id", 1), ("user_id", 1), ("phase", 1)], unique=True)
        await db.game_idea_votes.create_index("entry_id")

        # --- Racket / extortions ---
        await db.extortions.create_index([("extorter_id", 1), ("target_id", 1), ("property_id", 1)])

        # --- Leaderboard / stats ---
        await db.users.create_index([("is_dead", 1), ("rank_points", -1)])
        await db.users.create_index([("is_dead", 1), ("total_kills", -1)])
        await db.users.create_index([("money", -1)])
        await db.users.create_index("in_jail")
        await db.users.create_index([("auto_rank_enabled", 1), ("auto_rank_next_run_at", 1)])

        # --- Mini games leaderboard ---
        await db.minigame_plays.create_index([("week_start", 1), ("user_id", 1)])
        await db.minigame_plays.create_index([("week_start", 1), ("points", -1)])

        # --- Minesweeper ---
        await db.minesweeper_wins.create_index([("time_seconds", 1)])
        await db.minesweeper_wins.create_index([("user_id", 1), ("difficulty", 1)])

        # --- Battleships ---
        await db.battleships_wins.create_index([("shots_fired", 1), ("time_seconds", 1)])
        await db.battleships_wins.create_index([("user_id", 1)])

        # --- The Getaway ---
        await db.the_getaway_runs.create_index([("distance", -1), ("coins_collected", -1)])
        await db.the_getaway_runs.create_index([("user_id", 1)])

        logger.info("All non-profile indexes ensured.")
    except Exception as e:
        logger.warning("ensure_all_indexes: %s", e)
