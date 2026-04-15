# Rate limiting (Phase 0)

Application-level **API rate limiting**, **page-visit sliding windows**, **mutating spam**, **duplicate POST detection**, and **per-endpoint `RATE_LIMIT_CONFIG` / `check_endpoint_rate_limit`** have been **removed** until a new design is implemented.

What still applies:

- **IP bans** — enforced in [`backend/middleware/security_middleware.py`](../backend/middleware/security_middleware.py) for every request (see `ip_bans` / `json_response_if_ip_banned`).
- **Request logging** — unchanged; see request logging middleware and `.env.example` (`REQUEST_LOGGING_*`).
- **Gameplay / minigame limits** — separate features (e.g. hourly play caps, game chat caps) are **not** the removed `middleware.security` RL stack; they live in their respective routers.

Admin routes that previously toggled RL (`/admin/security/rate-limits*`, page-visit, middleware spam toggle, `/admin/rate-limit-log`) are gone; staff security UI no longer exposes them.

Legacy Mongo collections (`rate_limit_clicks`, `endpoint_rl_violations`) and indexes may still exist from older deployments; they are unused by the current no-op `check_endpoint_rate_limit`.

## Jail sustained pacing (optional)

- **Behavior:** [`backend/utils/sustained_page_ratelimit.py`](../backend/utils/sustained_page_ratelimit.py) — per-user gap-based streak on jail API routes only (see [`backend/routers/crime/jail.py`](../backend/routers/crime/jail.py)). When `game_settings._id: "main".sustained_page_rl_jail_enabled` is true, consecutive requests spaced **under 500ms** for **~15s wall time** trigger a **random 10–15s** cooldown (`429`, `Retry-After`, JSON `cooldown_seconds`).
- **State:** Mongo collection `sustained_page_rl_state` (document `_id` = `{user_id}:jail`).
- **Admin:** Admin Tools → Settings (anti-bot area) — **Enable** / **Disable** jail pacing; same flag is included when saving **Save settings** (`PATCH /admin/settings` field `sustained_page_rl_jail_enabled`). Default **off** when unset.
