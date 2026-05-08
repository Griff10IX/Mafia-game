# Rate limiting (Phase 0)

Application-level **API rate limiting**, **page-visit sliding windows**, **mutating spam**, **duplicate POST detection**, and **per-endpoint `RATE_LIMIT_CONFIG` / `check_endpoint_rate_limit`** have been **removed** until a new design is implemented.

What still applies:

- **IP bans** — enforced in [`backend/middleware/security_middleware.py`](../backend/middleware/security_middleware.py) for every request (see `ip_bans` / `json_response_if_ip_banned`).
- **Request logging** — unchanged; see request logging middleware and `.env.example` (`REQUEST_LOGGING_*`).
- **Gameplay / minigame limits** — separate features (e.g. hourly play caps, game chat caps) are **not** the removed `middleware.security` RL stack; they live in their respective routers.

Admin routes that previously toggled RL (`/admin/security/rate-limits*`, page-visit, middleware spam toggle, `/admin/rate-limit-log`) are gone; staff security UI no longer exposes them.

Legacy Mongo collections (`rate_limit_clicks`, `endpoint_rl_violations`) and indexes may still exist from older deployments; they are unused by the current no-op `check_endpoint_rate_limit`.

## Sustained page pacing (optional)

- **Behavior:** [`backend/utils/sustained_page_ratelimit.py`](../backend/utils/sustained_page_ratelimit.py) — per-user, per-scope gap-based streak. When enabled for a scope, consecutive authenticated requests spaced **under the scope’s max gap** for the scope’s **sustain window** trigger a **random 10–15s** cooldown (`429`, `Retry-After`, JSON `cooldown_seconds`). Scopes are independent (separate state per user per scope). Default max gap (non–jail-style scopes) is **500ms**; **jail-style** scopes use **~750ms / ~22s**; **kill / attack** uses **300ms** gap with **~12s** sustain (then cooldown).
- **Not triggered by normal jail browsing or F5:** the jail UI refreshes `/jail/status` about every **1s** and `/jail/players` about every **3s** (see `src/pages/Crime/Jail.js`). Any gap **≥ 500ms** resets the “fast” chain, so typical polling and full page reloads stay under the threshold. This feature is aimed at **very fast repeated API calls** (scripts / autoclickers), not at limiting refresh or the built-in poll interval.
- **Scopes & wiring:**
  - **Jail** — [`backend/routers/crime/jail.py`](../backend/routers/crime/jail.py) (player jail actions).
  - **Forum** — [`backend/routers/social/forum.py`](../backend/routers/social/forum.py) (`/forum/topics…` routes).
  - **Entertainer** — [`backend/routers/game/entertainer.py`](../backend/routers/game/entertainer.py) (player entertainer APIs under `/forum/entertainer/…` except staff **`/forum/entertainer/admin/*`**, **`/forum/entertainer/find-word/admin/start`**, and **`/forum/entertainer/games/{id}/roll`**).
  - **Kill / attack** — [`backend/routers/kill/attack.py`](../backend/routers/kill/attack.py): **POST** routes only (e.g. search, travel, execute, bullets/calc, delete). **GET** list/status/timeline/inflation are **not** paced here. **300ms** max gap, **~12s** sustain.
- **State:** Mongo collection `sustained_page_rl_state` (document `_id` = `{user_id}:{page_key}` with `page_key` one of `jail`, `forum`, `entertainer`, `kill`).
- **Settings:** `game_settings` document `_id: "main"` — booleans (default **off** when unset for jail/forum/entertainer; **kill defaults on** when the flag is missing):
  - `sustained_page_rl_jail_enabled`
  - `sustained_page_rl_forum_enabled`
  - `sustained_page_rl_entertainer_enabled`
  - `sustained_page_rl_kill_enabled`
- **Admin:** Admin Tools → **Sustained page pacing** (Game World). Enable/disable per scope; same flags are included in **Save settings** (`PATCH /admin/settings`).
