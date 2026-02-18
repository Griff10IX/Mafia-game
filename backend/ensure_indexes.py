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

        # --- Game config / settings ---
        await db.game_config.create_index("id", unique=True)
        await db.game_config.create_index("key", unique=True)
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
        await db.dealer_stock.create_index("car_id")

        # --- Properties ---
        await db.properties.create_index("id", unique=True)
        await db.user_properties.create_index("user_id")
        await db.user_properties.create_index([("user_id", 1), ("property_id", 1)])

        # --- Airport / bullet factory ---
        await db.airport_ownership.create_index("owner_id")
        await db.airport_ownership.create_index([("state", 1), ("slot", 1)], unique=True)
        await db.bullet_factory.create_index("owner_id")
        await db.bullet_factory.create_index("state")

        # --- Casino ownership: city + owner_id (roulette, dice, horseracing, video poker, blackjack) ---
        for coll_name in ("dice_ownership", "roulette_ownership", "blackjack_ownership", "horseracing_ownership", "videopoker_ownership"):
            await db[coll_name].create_index("city")
            await db[coll_name].create_index("owner_id")

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

        # --- Bodyguards / hitlist ---
        await db.bodyguards.create_index("id", unique=True)
        await db.bodyguards.create_index("user_id")
        await db.bodyguards.create_index("bodyguard_user_id")
        await db.bodyguards.create_index([("user_id", 1), ("slot_number", 1)])
        await db.hitlist.create_index("target_id")
        await db.hitlist.create_index([("target_id", 1), ("target_type", 1)])
        await db.hitlist.create_index([("reward_amount", -1), ("created_at", -1)])

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
        await db.login_lockouts.create_index("email", unique=True)
        await db.payment_transactions.create_index("session_id", unique=True)

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

        # --- Quick trade ---
        await db.trade_sell_offers.create_index([("status", 1), ("created_at", -1)])
        await db.trade_sell_offers.create_index([("user_id", 1), ("status", 1)])
        await db.trade_buy_offers.create_index([("status", 1), ("created_at", -1)])
        await db.trade_buy_offers.create_index([("user_id", 1), ("status", 1)])
        await db.properties.create_index([("for_sale", 1), ("created_at", -1)])

        # --- Forum ---
        await db.forum_topics.create_index("id", unique=True)
        await db.forum_topics.create_index([("is_important", -1), ("is_sticky", -1), ("updated_at", -1)])
        await db.forum_comments.create_index("id", unique=True)
        await db.forum_comments.create_index([("id", 1), ("topic_id", 1)])
        await db.forum_comments.create_index("topic_id")
        await db.forum_comments.create_index([("topic_id", 1), ("created_at", 1)])
        await db.forum_comment_likes.create_index([("comment_id", 1), ("user_id", 1)])

        # --- Security / admin ---
        await db.bans.create_index([("active", 1), ("created_at", -1)])
        await db.ip_bans.create_index([("ip", 1), ("active", 1)])
        await db.ip_bans.create_index([("active", 1), ("created_at", -1)])
        await db.security_flags.create_index([("user_id", 1), ("created_at", -1)])
        await db.security_flags.create_index([("created_at", 1)])
        await db.security_logs.create_index([("created_at", -1)])
        await db.activity_log.create_index([("created_at", -1)])
        await db.activity_log.create_index([("username", 1), ("created_at", -1)])
        await db.gambling_log.create_index([("created_at", -1)])
        await db.gambling_log.create_index([("username", 1), ("created_at", -1)])
        await db.gambling_log.create_index([("game_type", 1), ("created_at", -1)])

        # --- Entertainer ---
        await db.entertainer_games.create_index("id", unique=True)
        await db.entertainer_games.create_index([("status", 1)])
        await db.entertainer_games.create_index([("status", 1), ("completed_at", -1)])
        await db.entertainer_games.create_index([("created_at", -1)])

        # --- Racket / extortions ---
        await db.extortions.create_index([("extorter_id", 1), ("target_id", 1), ("property_id", 1)])

        # --- Leaderboard / stats ---
        await db.users.create_index([("is_dead", 1), ("rank_points", -1)])
        await db.users.create_index([("is_dead", 1), ("total_kills", -1)])
        await db.users.create_index([("money", -1)])
        await db.users.create_index("in_jail")
        await db.users.create_index([("auto_rank_enabled", 1), ("auto_rank_next_run_at", 1)])

        logger.info("All non-profile indexes ensured.")
    except Exception as e:
        logger.warning("ensure_all_indexes: %s", e)
