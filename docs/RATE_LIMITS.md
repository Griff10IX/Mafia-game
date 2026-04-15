# Rate limiting and abuse detection

## Page-visit rate limiting (security middleware)

When **`SECURITY_MIDDLEWARE_ENABLED`** is on, authenticated API traffic is checked against a **sliding-window limit per user and SPA route**, not per API endpoint pattern.

### How it works

- **Key:** `(user_id, normalized_spa_path)` where `normalized_spa_path` comes from the **`X-Current-Path`** request header (strip, collapse repeated `/`, max **500** characters). If the header is missing or empty after normalization, the server uses **`/`** as the bucket so behaviour stays defined; for accurate buckets the browser should send the header on every call (see [`src/utils/api.js`](../src/utils/api.js)).
- **Window:** Default **30** seconds (`PAGE_SPAM_WINDOW_SEC`).
- **Threshold:** Default **more than 100** requests in that window (`PAGE_SPAM_MAX_REQUESTS`) → **HTTP 429** with the same cooldown payload as mutating spam (`is_cooldown`, `cooldown_seconds`). Tune **N** upward (e.g. 120–150) if heavy pages with many parallel GETs false-positive.
- **Methods:** **GET** is counted (so aggressive polling is covered). **HEAD** and **OPTIONS** are skipped.
- **Auto Rank:** Requests whose API path matches **`/api/auto-rank/`** (same rule as mutating spam) are **not** counted toward the page window.
- **Toggle:** Set **`PAGE_SPAM_ENABLED`** to `0` or `false` in env to disable on boot, or use **Admin → Page visit rate limit** (`POST /admin/security/page-visit-rate-limit` with query `enabled`, `window_sec`, `max_requests`) to change the running process (in-memory; restart re-applies env unless you set env too).

### Environment (code source of truth: [`security.py`](../backend/middleware/security.py))

| Variable | Default | Role |
|----------|---------|------|
| `PAGE_SPAM_ENABLED` | on (`1` / `true` / `yes`) | Master switch for page-visit window. |
| `PAGE_SPAM_WINDOW_SEC` | 30 | Sliding window length (seconds). |
| `PAGE_SPAM_MAX_REQUESTS` | 100 | Block when count in window **exceeds** this value. |

Staff flags use **`page_visit_spam`** with throttled Telegram handling (same family as request/burst spam).

### Middleware skips (unchanged)

Exact **`/`**, **`/docs`**, **`/openapi.json`**, and prefixes **`/api/auth/`**, **`/api/admin/`**, **`/admin/`** skip page spam and other user checks. **IP bans** apply to all paths before these gates.

---

## Per-endpoint `RATE_LIMIT_CONFIG` (legacy in middleware)

**`check_endpoint_rate_limit` is no longer called from [`security_middleware.py`](../backend/middleware/security_middleware.py).** Admin toggles and `RATE_LIMIT_CONFIG` still exist for:

- Optional use via **`security_check_request`** / **`rate_limit_dependency`** on specific routes, and
- Admin UI routes under **`/admin/security/rate-limits`**.

They do **not** gate ordinary traffic through the global security middleware until wired again or removed in a follow-up.

Prior documentation for inter-arrival sustain, token buckets, and hard lockouts on **`endpoint_rl_violations`** / **`rate_limit_hard_until`** still describes that subsystem for any code paths that continue to call **`check_endpoint_rate_limit`**.

---

## Mutating spam and duplicate requests

- **`check_request_spam`** (1 s and burst windows) counts **only mutating** methods: **POST**, **PUT**, **PATCH**, **DELETE**, etc. **GET**, **HEAD**, and **OPTIONS** are **not** counted. Thresholds: **more than `MAX_REQUESTS_PER_SECOND` (20)** in 1 s, or **≥ `BURST_MAX_REQUESTS` (20)** in **0.5 s**.
- **Auto Rank control traffic:** Paths under **`/api/auto-rank/`** are exempt from mutating spam and from **`check_duplicate_request`**. Cron routes use **`X-Cron-Secret`** and typically have no user JWT, so user checks are skipped.
- **`check_duplicate_request`** and **`_get_cooldown_seconds`** in [`security_middleware.py`](../backend/middleware/security_middleware.py) behave as before when spam/duplicate detection fires.

## Client 429 handling

The 429 handler in [`src/utils/api.js`](../src/utils/api.js) treats **`is_cooldown`** and **`cooldown_seconds`** for cooldown UX. **`endpoint_rate_limit_hard`** may still appear from **`rate_limit_dependency`** or other callers of **`check_endpoint_rate_limit`**, not from the global middleware path.

## Login

Successful **login** clears **`rate_limit_hard_until`** on the user so a new session is not blocked by an old endpoint-RL hard lockout.

## Verification (automated)

From the **backend** directory with the same `.env` as the API (`MONGO_URL`, `DB_NAME`, `JWT_SECRET_KEY`):

```bash
python scripts/audit_rate_limit_routes.py
```

This script inventories **`RATE_LIMIT_CONFIG`** coverage for routes that opt into endpoint checks; it does not assert middleware wiring for page-visit limits.

## Config coverage (inventory)

`RATE_LIMIT_CONFIG` keys remain the **storage keys** for optional per-endpoint metering (prefix rows end with `/` and use `startswith`; others are exact paths). Major areas include: bank, attack, crimes, hitlist, store, weapons, armour, properties, racket, bodyguards, casino games, sports betting, loot box, crack safe, jail, GTA, entertainer, gauntlet, minigames, boxing, snake, shooting range, whack-a-copper, travel, booze run, families, notifications, admin, auth, account, meta, users, leaderboard, daily rewards, prestige, game chat, help desk, stock market, OC, organised crime, inventory, profile, racing, trade, illegal business, lottery, forum, bullet factory, airports, grave robber, witness statements, missions, objectives, payments, webhooks, family run, auto rank, states, stats, death / dead-alive, image host, minesweeper, battleships, the getaway, mafia RPG.
