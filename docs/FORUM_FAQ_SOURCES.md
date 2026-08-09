# FORUM_FAQ.md — source of truth (maintainers)

Use this when updating [FORUM_FAQ.md](FORUM_FAQ.md) so numbers stay aligned with the codebase.

**Route / feature coverage:** see [FORUM_FAQ_ROUTE_COVERAGE.md](FORUM_FAQ_ROUTE_COVERAGE.md) (major `App.js` routes vs FAQ sections).

**Player how-to (no rules dump):** [FORUM_HOW_TO.md](FORUM_HOW_TO.md) → pinned forum topic **How To**. Refresh: `python backend/seeds/update_how_to_topic.py` or [`scripts/push-how-to-topic.bat`](../scripts/push-how-to-topic.bat). Startup sync: `utils/ensure_how_to_topic.py` (disable with `HOW_TO_TOPIC_SYNC=0`).

**Live forum topic:** `seed_faq_topic.py` only *creates* the "FAQs" topic if missing. To refresh an existing topic from disk:

- **Local (dev DB):** `python backend/seeds/update_faq_topic.py` from the repo root (needs `MONGO_URL` / `MONGO_DB` in `backend/.env`).
- **Production (same flow as deploy):** double-click [`scripts/push-faq-topic.bat`](../scripts/push-faq-topic.bat) — SSHs to the server, syncs `origin/MAfiaGame2`, runs `update_faq_topic.py` against live Mongo (creates the `FAQs` topic if it was never seeded). Commit and **push** FAQ edits first. For “only run Python” without `git pull`, use `push-faq-topic.bat python`.

| Topic | Source file / symbol |
|--------|----------------------|
| Rank names & RP thresholds | `backend/server.py` → `RANKS` |
| Prestige titles & multipliers | `backend/server.py` → `PRESTIGE_CONFIGS`, `get_prestige_bonus` |
| Cities / travel destinations | `backend/server.py` → `STATES` |
| Car travel times | `backend/server.py` → `TRAVEL_TIMES`; car catalog `CARS` |
| Melt-for-bullets yield | `backend/server.py` → `MELT_VALUE_PER_BULLET`, `CARS[].value`; `backend/routers/cars/gta.py` → `_melt_cars_impl` |
| Interest bank terms & % | `backend/server.py` → `BANK_INTEREST_OPTIONS` |
| Kill cash % | `backend/server.py` → `KILL_CASH_PERCENT`, `KILL_CASH_MIN_PRESTIGE_LEVEL` (events: `kill_cash` in `GAME_EVENTS`; gated in `attack.py`) |
| Wealth rank thresholds & FAQ row colours | `backend/server.py` → `WEALTH_RANKS` (`min_money` + `color`); FAQ list uses matching `[color=#…]` per row |
| Garage batch limits | `backend/server.py` → `DEFAULT_GARAGE_BATCH_LIMIT`, `GARAGE_BATCH_UPGRADE_*` |
| Armour tier scaling (bullets formula) | `backend/server.py` → `ARMOUR_BASE_BULLETS`; `backend/routers/kill/attack.py` → `_bullets_to_kill` |
| Molotov bullet equivalent | `backend/routers/kill/attack.py` → `MOLOTOV_BULLET_EQUIV` |
| Hitlist hidden / buy-off multipliers | `backend/routers/kill/hitlist.py` → `HITLIST_HIDDEN_MULTIPLIER`, `HITLIST_BUY_OFF_MULTIPLIER` |
| Bodyguards (slots, costs, hire rules) | `backend/routers/kill/bodyguards.py` → `BODYGUARD_SLOT_COSTS`, `buy_bodyguard_slot`, `_do_hire_bodyguard` |
| New-account (civilian) protection | `backend/utils/civilian_protection.py` → `PROTECTION_HOURS`, `RULES_BULLETS`, `is_civilian_protected` |
| Hitman for Hire (tiers, protection, cooldowns) | `backend/routers/kill/hitman.py` → `HITMAN_TIERS`, `HITMAN_*` constants; UI `src/pages/Kill/HitmanForHire.js` |
| Health restore cost | `backend/routers/game/store.py` → `buy_health` (`BUY_HEALTH_COST_POINTS`); respect leg uses `_store_cost_inc` (~304 respect if 15 pts paid fully with respect) |
| Passive health regen (lazy tick) | `backend/server.py` → `HEALTH_REGEN_FULL_SECONDS`, `apply_passive_health_regen`; field `health_regen_last_at` on `users` |
| Silencer / anti-snitch / OC timers / bullets / custom car | `backend/routers/game/store.py` → `SILENCER_COST_POINTS`, `ANTI_SNITCH_COST_POINTS`, `OC_TIMER_COST_POINTS`, `CREW_OC_TIMER_COST_POINTS`, `BULLET_PACKS`, `CUSTOM_CAR_COST`, `upgrade_garage_batch_limit` |
| Dead > Alive, revive, reveal killer | `backend/routers/game/dead_alive.py` → `DEAD_ALIVE_PERCENT`, `TOKEN_RESTORE_PERCENT`, `REVIVE_COST`, `REVEAL_KILLER_COST` |
| Booze types, capacity, jail on bust | `backend/routers/money/booze_run.py` → `BOOZE_TYPES`, `BOOZE_CAPACITY_*`, `BOOZE_RUN_JAIL_*` |
| Regular crimes list & ranks | `backend/routers/crime/crimes.py` → crime dicts (`crime1`…`crime8`, prestige crimes) |
| Prestige crime bonus ranges (in-game cards) | `src/pages/Crime/Crimes.js` → `describePrestigeBonusLines` (mirrors `prestige_bonus` in `crimes.py`) |
| Organised crime (OC) | `backend/routers/crime/oc.py` → `OC_COOLDOWN_HOURS`, `OC_COOLDOWN_HOURS_REDUCED`, `OC_EQUIPMENT_BY_ID`, `OC_SUCCESS_RATE`, `OC_JAIL_*`, jobs, roles |
| Crew / family OC cooldown | `backend/routers/game/families.py` → `CREW_OC_COOLDOWN_HOURS`, `CREW_OC_COOLDOWN_HOURS_REDUCED` |
| GTA options | `backend/routers/cars/gta.py` → `GTA_OPTIONS` (cooldown seconds, jail seconds, success rates) |
| Melt for bullets | `backend/routers/cars/gta.py` → `_melt_cars_impl`, `MELT_BULLETS_COOLDOWN_SECONDS` |
| Jail, bust, snitch | `backend/routers/crime/jail.py` → bust logic, `SNITCH_*` |
| API paths blocked while `in_jail` (denylist) | `backend/server.py` → `JAIL_BLOCKED_EXACT`, `JAIL_BLOCKED_PREFIXES`, `_is_jail_blocked_path` |
| API rate limits (optional) | `backend/middleware/security.py` → `GLOBAL_RATE_LIMITS_ENABLED`, `RATE_LIMIT_CONFIG` |
| Consumable tokens | `backend/routers/kill/armoury.py` → `TOKEN_CONFIG`, `use_token`; descriptions also in `crack_safe.py` |
| Mini-game weekly leaderboard | `backend/routers/minigames/minigame_leaderboard.py` → `VALID_GAMES`, `DEFAULT_REWARDS`, week start |
| Daily Rewards (RPS + TTT) plays per window | `backend/routers/game/daily_rewards.py` → `RPS_PLAYS_PER_WINDOW`, `RPS_WINDOW_HOURS` |
| Famiglia (Mafia RPG) session submit rate | `backend/routers/minigames/mafia_rpg.py` → `MAX_PLAYS_PER_HOUR`, `_composite_score` |
| Property catalog ($/hr, max level) | Database `properties` collection; API via `backend/routers/money/properties.py` |
| Weapon list & damage | Database `weapons` collection; `backend/routers/kill/armoury.py` |
| BBCode & smileys | `src/utils/forumContent.js` → `parseForumContent` |
| DM wink behaviour | `src/pages/Social/InboxChat.js` → `dmUnicodeSmileys` |
| FAQ seed fallback | `backend/seeds/seed_faq_topic.py` → `FALLBACK_FAQ_CONTENT` (only if `FORUM_FAQ.md` missing) |
| Travel per hour + extra airmiles | `backend/routers/admin/airport.py` → `MAX_TRAVELS_PER_HOUR`, `EXTRA_AIRMILES_COST`, `MAX_EXTRA_AIRMILES` (+5 per purchase until cap) |
| Airport fare & slots | Same file → `AIRPORT_COST`, `AIRPORT_PRICE_MIN`, `AIRPORT_PRICE_MAX`, `AIRPORT_SLOTS_PER_STATE` |
| Daily rotating event modifiers | `backend/server.py` → `GAME_EVENTS`, `get_effective_event` |
| Badge passive bonuses | `backend/routers/game/achievements.py` → `get_badge_bonuses` (prestige scaling where applied) |
| Bullet factory / armoury / shooting cap | `backend/routers/kill/armoury.py` → `BULLET_FACTORY_CLAIM_COST`, `SHOOTING_RANGE_MAX_PLAYS_PER_HOUR`, factory tick & stock logic |
| Send points (P2P) | `backend/routers/game/store.py` → `send_points` / `/store/send-points` |
| Referral payouts | `backend/routers/crime/crimes.py`, `oc.py`, `money/booze_run.py`, `cars/gta.py` (referral comment blocks) |
| Entertainer / E-Games | `backend/routers/game/entertainer.py` |
| Designer competitions | `backend/routers/game/designer_competitions.py` |
| Family treasury / vault, compound, war prizes | `backend/routers/game/families.py` → `families_deposit`, `families_withdraw`, `families_compound_*`, war wipe / `compound_*` prize logic |
| Auto Rank (purchase, toggles, cron) | `backend/routers/account/auto_rank.py`; UI `src/pages/Account/AutoRank.js` |
| Game Ideas seasons / voting | `backend/routers/social/game_ideas.py` |
| Pre-register rewards, founding badge name, +% blurb | `backend/routers/account/auth.py` → `PREREGISTER_REWARDS`; founding payout mult `server.py` → `founding_member_income_mult` / `FOUNDING_MEMBER_INCOME_MULT` |
| Inbox read/unread auto-delete | `backend/routers/game/notifications.py` → `READ_NOTIFICATION_RETENTION_DAYS`, `UNREAD_NOTIFICATION_RETENTION_DAYS`; list API returns `read_retention_days`, `unread_retention_days` |
| Inbox delivery vs notification category mutes | `backend/server.py` → `send_notification` (when `category` is set, `notification_preferences[category] is False` skips insert) |
| Game Pass (price GBP, points price, month window, 14d repurchase block, tier model) | `backend/server.py` → `POINT_PACKAGES["rank_xp_pass_499"]`; `backend/routers/money/payments.py` → `GAME_PASS_POINTS_PRICE`, `GAME_PASS_PURCHASE_CLOSE_WINDOW_DAYS`; `utils/game_pass_micro_rewards.py`; UI `src/constants/gamePassPricing.js` |
