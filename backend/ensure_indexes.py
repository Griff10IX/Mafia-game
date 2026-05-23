# Central place for MongoDB indexes used across routers (except profile-specific ones in routers/profile.py).
# Idempotent: safe to run on every startup.
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# Raw event rows used for weekly boards / analytics; all-time totals live on users.* fields.
EVENT_LOG_TTL_DAYS = 14
CRIME_EVENTS_TTL_DAYS = EVENT_LOG_TTL_DAYS  # backwards compat
# Activity / gambling / analytics raw rows — longer retention than gameplay event logs.
AUDIT_LOG_TTL_DAYS = 90
TOAST_EVENTS_TTL_DAYS = 30


async def _ensure_event_log_ttl(
    db,
    coll_name: str,
    date_field: str,
    *,
    compound_indexes=None,
    ttl_days: int = EVENT_LOG_TTL_DAYS,
):
    """TTL index + startup prune on a date field. Idempotent compound indexes for queries."""
    coll = getattr(db, coll_name)
    idx_name = f"{date_field}_1"
    try:
        await coll.drop_index(idx_name)
    except Exception:
        pass
    try:
        await coll.create_index([(date_field, 1)], expireAfterSeconds=ttl_days * 24 * 3600)
    except Exception as e:
        logger.warning("%s TTL on %s: %s", coll_name, date_field, e)
    if compound_indexes:
        for spec in compound_indexes:
            try:
                await coll.create_index(spec)
            except Exception as e:
                logger.warning("%s index %s: %s", coll_name, spec, e)
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
        pr = await coll.delete_many({date_field: {"$lt": cutoff}})
        if pr.deleted_count:
            logger.info(
                "%s: removed %s documents older than %sd",
                coll_name,
                pr.deleted_count,
                ttl_days,
            )
    except Exception as e:
        logger.warning("%s startup prune: %s", coll_name, e)


async def _prune_mixed_date_string_field(
    db,
    coll_name: str,
    field_name: str,
    *,
    ttl_days: int = EVENT_LOG_TTL_DAYS,
):
    """Remove old docs where field is BSON Date or ISO string (legacy inserts)."""
    coll = getattr(db, coll_name)
    cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
    cutoff_iso = cutoff.isoformat()
    try:
        r1 = await coll.delete_many({field_name: {"$lt": cutoff}})
        r2 = await coll.delete_many({field_name: {"$lt": cutoff_iso}})
        n = int(r1.deleted_count or 0) + int(r2.deleted_count or 0)
        if n:
            logger.info("%s: pruned %s old documents (%s)", coll_name, n, field_name)
    except Exception as e:
        logger.warning("%s mixed prune: %s", coll_name, e)


async def _migrate_economy_booze_at_strings_to_date(db):
    """Booze rows used ISO strings for `at`, forcing $toDate scans on weekly boards; convert to BSON Date."""
    try:
        r = await db.economy_events.update_many(
            {"type": {"$in": ["booze_run_sell", "booze_run_jail"]}, "at": {"$type": "string"}},
            [{"$set": {"at": {"$toDate": "$at"}}}],
        )
        if r.modified_count:
            logger.info("economy_events booze: normalized %s string at -> Date", r.modified_count)
    except Exception as e:
        logger.warning("economy_events booze at migration: %s", e)


async def ensure_all_indexes(db):
    """Create indexes for bank, attack, families, GTA, airport, OC, jail, forum, etc."""
    try:
        # --- Bank ---
        await db.bank_deposits.create_index([("user_id", 1), ("created_at", -1)])
        await db.bank_deposits.create_index([("user_id", 1), ("claimed_at", 1)])
        await db.money_transfers.create_index([("from_user_id", 1), ("created_at", -1)])
        await db.money_transfers.create_index([("to_user_id", 1), ("created_at", -1)])
        await db.points_transfers.create_index([("from_user_id", 1), ("created_at", -1)])
        await db.points_transfers.create_index([("to_user_id", 1), ("created_at", -1)])
        await db.bank_deposits.create_index([("id", 1), ("user_id", 1)])
        await db.bank_deposits.create_index("id")

        # --- Stock market ---
        # stock_transactions: compound + TTL on created_at in --- Crimes / event logs --- below

        # --- Game config / settings ---
        await db.game_config.create_index("id", unique=True)
        # Sparse: only index docs that have "key"; docs with only "id" (main, auto_rank) have no key so avoid duplicate null
        try:
            await db.game_config.drop_index("key_1")
        except Exception:
            pass
        await db.game_config.create_index([("key", 1)], unique=True, sparse=True)
        # Sparse: docs like _id "main" / "booze_run_globals" have no "key"; non-sparse unique would only allow one null key (breaks booze listed-price upsert).
        try:
            await db.game_settings.drop_index("key_1")
        except Exception:
            pass
        await db.game_settings.create_index([("key", 1)], unique=True, sparse=True)
        await db.captcha_turnstile_failures.create_index([("at", -1)])
        await db.captcha_turnstile_failures.create_index([("user_id", 1), ("at", -1)])

        # Bot/script client block audit (admin investigation; TTL on expires_at)
        try:
            await db.bot_client_block_events.create_index([("user_id", 1), ("created_at", -1)])
            await db.bot_client_block_events.create_index([("expires_at", 1)], expireAfterSeconds=0)
        except Exception as e:
            logger.warning("bot_client_block_events indexes: %s", e)

        # Sustained page RL 429 audit (admin UI; TTL on created_at)
        try:
            await db.admin_sustained_rl_events.create_index([("created_at", -1)])
            await db.admin_sustained_rl_events.create_index([("user_id", 1), ("created_at", -1)])
            await db.admin_sustained_rl_events.create_index([("page_key", 1), ("created_at", -1)])
            await db.admin_sustained_rl_events.create_index(
                [("created_at", 1)], expireAfterSeconds=21 * 24 * 3600
            )
        except Exception as e:
            logger.warning("admin_sustained_rl_events indexes: %s", e)

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
        await db.family_vault_transactions.create_index([("family_id", 1), ("at", -1)])
        await db.family_war_stats.create_index("war_id")
        await db.family_war_stats.create_index([("war_id", 1), ("user_id", 1)], unique=True)
        await db.families.create_index("id", unique=True)
        await db.families.create_index("name")
        await db.families.create_index("tag")
        await db.families.create_index("wiped")  # list non-wiped families
        await db.families.create_index([("crew_oc_join_fee", 1)], sparse=True)
        await db.families.create_index([("crew_oc_auto_commit_due_at", 1)], sparse=True)
        # Partial filters cannot use $ne (server rewrites to $not). Match non-wiped docs only.
        await db.families.create_index(
            "emblem_key",
            unique=True,
            partialFilterExpression={
                "emblem_key": {"$exists": True, "$type": "string"},
                "$or": [
                    {"wiped": {"$exists": False}},
                    {"wiped": False},
                ],
            },
        )

        # --- Attack ---
        await db.attacks.create_index([("attacker_id", 1), ("search_started", -1)])
        # List query: attacker + status in (searching,found) + sort by search_started (IXSCAN + no in-memory sort).
        await db.attacks.create_index([("attacker_id", 1), ("status", 1), ("search_started", -1)])
        await db.attacks.create_index([("attacker_id", 1), ("expires_at", 1)])
        await db.attacks.create_index("id")
        await db.attacks.create_index([("attacker_id", 1), ("id", 1)])
        await db.attacks.create_index(
            [("attacker_id", 1), ("status", 1), ("execute_token", 1)],
            sparse=True,
        )
        # Travel + execute by attack id: find_one(attacker_id, status found, id).
        await db.attacks.create_index([("attacker_id", 1), ("status", 1), ("id", 1)])
        await db.attacks.create_index("target_id")
        await db.attack_attempts.create_index([("attacker_id", 1), ("created_at", -1)])
        await db.attack_attempts.create_index([("target_id", 1), ("created_at", -1)])
        await db.attack_attempts.create_index([("outcome", 1), ("created_at", -1)])
        await db.attack_attempts.create_index([("outcome", 1), ("target_id", 1), ("created_at", -1)])
        await db.attack_attempts.create_index([("outcome", 1), ("attacker_id", 1), ("created_at", -1)])
        await db.attack_attempts.create_index(
            [("created_at", 1), ("outcome", 1), ("attacker_id", 1)],
        )
        await db.witness_statement_listings.create_index("id", unique=True)
        await db.witness_statement_listings.create_index([("seller_id", 1), ("status", 1)])

        # --- Attack client audit (per-search/per-execute audit; admin investigations) ---
        # Previously unindexed and unbounded. TTL keeps the collection small so writes stay fast.
        try:
            await db.attack_client_audit.create_index([("user_id", 1), ("created_at", -1)])
            await db.attack_client_audit.create_index([("event", 1), ("created_at", -1)])
            await db.attack_client_audit.create_index(
                [("created_at", 1)], expireAfterSeconds=EVENT_LOG_TTL_DAYS * 24 * 3600
            )
        except Exception as e:
            logger.warning("attack_client_audit indexes: %s", e)

        # --- User cars / GTA ---
        await db.user_cars.create_index("user_id")
        await db.user_cars.create_index([("user_id", 1), ("acquired_at", -1)])
        await db.user_cars.create_index([("listed_for_sale", 1), ("listed_at", -1)])
        await db.user_cars.create_index("id", unique=True)
        await db.user_cars.create_index([("user_id", 1), ("car_id", 1)])
        await db.user_cars.create_index("car_id")
        await db.exclusive_car_events.create_index([("at", -1)])
        await db.exclusive_car_events.create_index([("car_id", 1), ("at", -1)])
        await db.exclusive_car_events.create_index([("user_car_id", 1), ("at", -1)])
        await db.exclusive_car_events.create_index([("from_user_id", 1), ("at", -1)])
        await db.exclusive_car_events.create_index([("to_user_id", 1), ("at", -1)])
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
        await db.mp_poker_games.create_index([("mode", 1), ("approval_status", 1), ("created_at", -1)])
        await db.mp_poker_games.create_index([("mode", 1), ("tournament_status", 1), ("created_at", -1)])
        await db.mp_poker_games.create_index([("mode", 1), ("creator_id", 1), ("created_at", -1)])
        await db.entertainer_funded_games.create_index("id", unique=True)
        await db.entertainer_funded_games.create_index([("entertainer_id", 1), ("utc_day", 1)])
        await db.entertainer_funded_games.create_index([("ref_id", 1), ("source", 1)])
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
        await db.user_crimes.create_index([("user_id", 1), ("crime_id", 1)], unique=True)

        # --- Jail ---
        await db.jail_npcs.create_index("username", unique=True)
        await db.jail_npcs.create_index("owner_user_id")
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
        await db.hitlist.create_index([("placer_id", 1), ("target_id", 1), ("target_type", 1)])
        await db.hitlist.create_index([("reward_amount", -1), ("created_at", -1)])

        # --- Hitlist / bodyguard events (admin analytics) ---
        await db.hitlist_bodyguard_events.create_index([("at", -1)])
        await db.hitlist_bodyguard_events.create_index([("type", 1), ("at", -1)])
        await db.hitlist_bodyguard_events.create_index([("owner_id", 1), ("at", -1)])
        await db.hitlist_bodyguard_events.create_index([("guard_id", 1), ("at", -1)])
        await db.hitlist_bodyguard_events.create_index([("guard_user_id", 1), ("at", -1)])
        await db.hitlist_bodyguard_events.create_index([("inviter_id", 1), ("at", -1)])
        await db.hitlist_bodyguard_events.create_index([("invitee_id", 1), ("at", -1)])
        await db.hitlist_bodyguard_events.create_index([("killer_id", 1), ("at", -1)])

        # --- Economy events (car/property/loot/booze analytics) ---
        await db.economy_events.create_index([("at", -1)])
        await db.economy_events.create_index([("type", 1), ("at", -1)])
        await db.economy_events.create_index([("user_id", 1), ("at", -1)])

        # --- Crimes ---
        await db.crimes.create_index("id", unique=True)
        # Per-attempt / event logs for weekly leaderboards (Mon UTC week). TTL + prune = 14d retention.
        # All-time totals (total_crimes, total_gta, respect_points, stock_market_profit_total, etc.) stay on users.
        await _ensure_event_log_ttl(
            db,
            "crime_events",
            "at",
            compound_indexes=[
                [("user_id", 1), ("at", -1)],
                [("at", 1), ("success", 1), ("user_id", 1)],
            ],
        )
        await _ensure_event_log_ttl(
            db,
            "gta_events",
            "at",
            compound_indexes=[
                [("user_id", 1), ("at", -1)],
                [("at", 1), ("success", 1), ("user_id", 1)],
            ],
        )
        await _ensure_event_log_ttl(
            db,
            "bust_events",
            "at",
            compound_indexes=[
                [("user_id", 1), ("at", -1)],
                [("at", 1), ("success", 1), ("user_id", 1)],
            ],
        )
        await _ensure_event_log_ttl(
            db,
            "respect_events",
            "at",
            compound_indexes=[
                [("user_id", 1), ("at", -1)],
                [("at", 1), ("user_id", 1)],
            ],
        )
        await _ensure_event_log_ttl(
            db,
            "melt_events",
            "at",
            compound_indexes=[
                [("user_id", 1), ("at", -1)],
                [("at", 1), ("user_id", 1)],
            ],
        )
        # attack_attempts: no TTL — these rows power the public Last N kills feed, player timelines,
        # and staff tools. A 14d expiry deleted real kills while users expected a rolling top-15 only.
        # Weekly kill boards still scope by date in aggregations; indexes above cover queries.
        try:
            await db.attack_attempts.drop_index("created_at_1")
        except Exception:
            pass
        await _ensure_event_log_ttl(
            db,
            "stock_transactions",
            "created_at",
            compound_indexes=[
                [("user_id", 1), ("created_at", -1)],
                [("created_at", 1), ("user_id", 1)],
            ],
        )
        # economy_events: booze/property/etc.; some legacy docs store `at` as ISO string — prune both; TTL applies to BSON dates.
        try:
            await db.economy_events.drop_index("at_1")
        except Exception:
            pass
        try:
            await db.economy_events.create_index(
                [("at", 1)], expireAfterSeconds=EVENT_LOG_TTL_DAYS * 24 * 3600
            )
        except Exception as e:
            logger.warning("economy_events TTL: %s", e)
        await _prune_mixed_date_string_field(db, "economy_events", "at")
        await _migrate_economy_booze_at_strings_to_date(db)

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
        await db.ip_geodata_cache.create_index("ip", unique=True)
        await db.revive_used_by_email.create_index("email", unique=True)
        await db.payment_transactions.create_index("session_id", unique=True)
        await db.point_lots.create_index("id", unique=True)
        await db.point_lots.create_index([("owner_user_id", 1), ("created_at", 1)])
        await db.point_lots.create_index([("root_purchase_ref", 1), ("owner_user_id", 1)])
        await db.point_lots.create_index([("origin_ref", 1)])
        await db.point_ledger_events.create_index("id", unique=True)
        await db.point_ledger_events.create_index([("user_id", 1), ("created_at", -1)])
        await db.point_ledger_events.create_index([("user_id", 1), ("event_type", 1), ("created_at", -1)])
        await db.point_ledger_events.create_index([("root_purchase_ref", 1), ("created_at", -1)])
        await db.point_ledger_events.create_index([("origin_ref", 1), ("created_at", -1)])

        # --- Notifications: unread count (profile has user_id) ---
        await db.notifications.create_index([("user_id", 1), ("read", 1)])
        await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
        await db.notifications.create_index([("id", 1), ("user_id", 1)])
        await db.notifications.create_index([("user_id", 1), ("sender_id", 1), ("created_at", 1)])
        await db.notifications.create_index([("user_id", 1), ("recipient_id", 1), ("created_at", 1)])
        await db.notifications.create_index([("title", 1), ("created_at", -1)])
        await db.notifications.create_index([("listed_listing_id", 1)], sparse=True)

        # --- Sports betting ---
        await db.sports_events.create_index("id", unique=True)
        await db.sports_events.create_index([("id", 1), ("status", 1)])
        await db.sports_events.create_index([("status", 1), ("start_time", 1)])
        await db.sports_events.create_index([("status", 1), ("source_template_id", 1)])
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

        # --- Sports betting: player requests to add template to board ---
        await db.sports_event_requests.create_index("id", unique=True)
        await db.sports_event_requests.create_index([("user_id", 1), ("created_at", -1)])
        await db.sports_event_requests.create_index([("status", 1), ("created_at", 1)])
        await db.sports_event_requests.create_index([("user_id", 1), ("template_id", 1), ("status", 1)])

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

        # --- Respect earned: legacy docs may use created_at; at+TTL handled in event-log section ---
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
        await db.racing_npc_race_starts.create_index([("user_id", 1), ("at", -1)])
        try:
            await db.racing_npc_race_starts.create_index([("at", 1)], expireAfterSeconds=3 * 24 * 3600)
        except Exception as e:
            logger.warning("racing_npc_race_starts TTL: %s", e)
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
        await db.forum_topics.create_index([("category", 1), ("is_important", -1), ("is_sticky", -1), ("updated_at", -1)])
        await db.forum_comments.create_index("id", unique=True)
        await db.forum_comments.create_index([("id", 1), ("topic_id", 1)])
        await db.forum_comments.create_index("topic_id")
        await db.forum_comments.create_index([("topic_id", 1), ("created_at", 1)])
        await db.forum_comment_likes.create_index([("comment_id", 1), ("user_id", 1)])
        await db.forum_comment_dislikes.create_index([("comment_id", 1), ("user_id", 1)])
        await db.forum_comment_reactions.create_index([("comment_id", 1), ("user_id", 1)], unique=True)
        await db.forum_comment_reactions.create_index([("topic_id", 1), ("comment_id", 1)])
        await db.forum_topic_reactions.create_index([("topic_id", 1), ("user_id", 1)], unique=True)

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
        try:
            await db.endpoint_rl_violations.create_index([("user_id", 1), ("at", -1)])
            await db.endpoint_rl_violations.create_index("at", expireAfterSeconds=120)
        except Exception as e:
            logger.warning("endpoint_rl_violations indexes: %s", e)
        await db.security_logs.create_index([("created_at", -1)])
        await db.security_logs.create_index([("user_id", 1), ("created_at", -1)])
        await db.security_logs.create_index([("ip", 1), ("created_at", -1)])
        await db.activity_log.create_index([("created_at", -1)])
        await db.activity_log.create_index([("user_id", 1), ("created_at", -1)])
        await db.activity_log.create_index([("action", 1), ("created_at", -1)])
        await db.activity_log.create_index([("username", 1), ("created_at", -1)])
        await db.gambling_log.create_index([("created_at", -1)])
        await db.gambling_log.create_index([("user_id", 1), ("created_at", -1)])
        await db.gambling_log.create_index([("username", 1), ("created_at", -1)])
        await db.gambling_log.create_index([("game_type", 1), ("created_at", -1)])
        await db.gambling_log.create_index([("user_id", 1), ("game_type", 1), ("created_at", -1)])
        await db.analytics_events.create_index([("created_at", -1)])
        await db.analytics_events.create_index([("domain", 1), ("created_at", -1)])
        await db.analytics_events.create_index([("domain", 1), ("metric", 1), ("created_at", -1)])
        await db.analytics_events.create_index([("user_id", 1), ("created_at", -1)])
        await db.analytics_events.create_index([("idempotency_key", 1)], unique=True)
        await db.analytics_events.create_index([("buckets.daily", 1), ("domain", 1)])
        await db.analytics_events.create_index([("buckets.weekly", 1), ("domain", 1)])
        await db.analytics_rollups.create_index([("bucket", 1), ("bucket_start", -1), ("domain", 1)], unique=True)
        await db.analytics_rollups.create_index([("bucket", 1), ("domain", 1), ("bucket_start", -1)])

        # --- Entertainer ---
        await db.entertainer_games.create_index("id", unique=True)
        await db.entertainer_games.create_index([("status", 1)])
        await db.entertainer_games.create_index([("status", 1), ("completed_at", -1)])
        await db.entertainer_games.create_index([("created_at", -1)])
        await db.entertainer_find_word_rounds.create_index("id", unique=True)
        await db.entertainer_find_word_rounds.create_index([("status", 1), ("created_at", -1)])
        await db.entertainer_find_word_rounds.create_index([("completed_at", -1)])

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
        await db.users.create_index([("crew_oc_auto_apply_until", 1)], sparse=True)

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

        # --- TTL: other high-churn append-only logs (gameplay-adjacent / audit) ---
        await _ensure_event_log_ttl(
            db,
            "hitlist_bodyguard_events",
            "at",
            ttl_days=EVENT_LOG_TTL_DAYS,
            compound_indexes=[[("type", 1), ("at", -1)]],
        )
        await _ensure_event_log_ttl(
            db,
            "boxing_events",
            "at",
            ttl_days=EVENT_LOG_TTL_DAYS,
            compound_indexes=[[("user_id", 1), ("at", -1)]],
        )
        await _ensure_event_log_ttl(
            db,
            "trade_events",
            "at",
            ttl_days=EVENT_LOG_TTL_DAYS,
            compound_indexes=[
                [("type", 1), ("at", -1)],
                [("direction", 1), ("at", -1)],
            ],
        )
        await _ensure_event_log_ttl(
            db,
            "war_kill_feed",
            "created_at",
            ttl_days=EVENT_LOG_TTL_DAYS,
            compound_indexes=[[("war_id", 1), ("created_at", -1)]],
        )
        await _ensure_event_log_ttl(
            db,
            "captcha_turnstile_failures",
            "at",
            ttl_days=EVENT_LOG_TTL_DAYS,
            compound_indexes=[[("user_id", 1), ("at", -1)]],
        )
        await _ensure_event_log_ttl(
            db,
            "activity_log",
            "created_at",
            ttl_days=AUDIT_LOG_TTL_DAYS,
            compound_indexes=[
                [("user_id", 1), ("created_at", -1)],
                [("action", 1), ("created_at", -1)],
                [("username", 1), ("created_at", -1)],
            ],
        )
        await _ensure_event_log_ttl(
            db,
            "gambling_log",
            "created_at",
            ttl_days=AUDIT_LOG_TTL_DAYS,
            compound_indexes=[
                [("user_id", 1), ("created_at", -1)],
                [("username", 1), ("created_at", -1)],
                [("game_type", 1), ("created_at", -1)],
            ],
        )
        await _ensure_event_log_ttl(
            db,
            "minigame_play_payouts",
            "created_at",
            ttl_days=AUDIT_LOG_TTL_DAYS,
            compound_indexes=[[("user_id", 1), ("created_at", -1)]],
        )
        await _ensure_event_log_ttl(
            db,
            "toast_events",
            "created_at",
            ttl_days=TOAST_EVENTS_TTL_DAYS,
            compound_indexes=[
                [("username", 1), ("created_at", -1)],
                [("toast_type", 1), ("created_at", -1)],
                [("user_id", 1), ("created_at", -1)],
            ],
        )
        await _prune_mixed_date_string_field(
            db, "analytics_events", "created_at", ttl_days=AUDIT_LOG_TTL_DAYS
        )

        await db.deleted_messages_archive.create_index([("user_id", 1), ("deleted_at", -1)])
        await db.deleted_messages_archive.create_index([("source", 1), ("deleted_at", -1)])

        # --- Staff admin tool access audit (ISO created_at strings) ---
        await db.admin_tool_access_events.create_index([("created_at", -1)])
        await db.admin_tool_access_events.create_index([("user_id", 1), ("created_at", -1)])
        await _prune_mixed_date_string_field(
            db, "admin_tool_access_events", "created_at", ttl_days=AUDIT_LOG_TTL_DAYS
        )

        # --- Lottery (Wed/Sun draw cron + ticket buys) ---
        try:
            await db.lottery_tickets.create_index([("round_id", 1)])
            await db.lottery_tickets.create_index([("round_id", 1), ("user_id", 1)])
            await db.lottery_tickets.create_index([("round_id", 1), ("numbers", 1)])
            await db.lottery_rounds.create_index([("status", 1), ("closes_at", 1)])
            await db.lottery_rounds.create_index([("status", 1), ("drawn_at", -1)])
            await db.lottery_events.create_index([("drawn_at", -1)])
        except Exception as e:
            logger.warning("lottery indexes: %s", e)

        # --- MDG automated games ---
        try:
            await db.mdg_games.create_index([("is_automated", 1), ("status", 1)])
            await db.mdg_games.create_index([("cycle_id", 1), ("status", 1)])
            await db.mdg_house_stats.create_index([("id", 1)], unique=True)
        except Exception as e:
            logger.warning("mdg indexes: %s", e)

        logger.info("All non-profile indexes ensured.")
    except Exception as e:
        logger.warning("ensure_all_indexes: %s", e)
