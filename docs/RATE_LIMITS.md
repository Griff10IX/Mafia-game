# Endpoint rate limits (security middleware)

## Product decision

**Strict inter-arrival sustain:** For each endpoint key (`user_id` + pattern), the server records **consecutive request arrival times**. If the gap between the **previous** and **current** request is **less than** `min_interval_sec` (e.g. 300 ms → `0.3`), that request adds a row to `endpoint_rl_violations`. This applies **whether or not** the token bucket still **allows** the action (burst), so fast spacing is measured on **every** attempt.

**No short punitive cooldown:** A normal over-limit block (bucket empty) returns **HTTP 429** with **`cooldown_seconds`: 0**, **`is_cooldown`: false**, and a generic message (“Please slow down”). The **only** long player-facing cooldown from endpoint RL is the **15–30 s** hard lockout (`users.rate_limit_hard_until`, **`endpoint_rate_limit_hard`** in the JSON when applicable).

## Semantics: 300 ms example vs hard penalty

| Idea | Behavior |
|------|----------|
| 200 ms between clicks vs 300 ms limit | **Too fast** for metering: each such consecutive pair (after the first request) records a violation when the gap is under `min_interval_sec`. |
| Burst | Still allows up to **`ENDPOINT_RL_BURST_TOKENS`** successful actions when tokens refill; **does not** hide sub-interval spacing from the sustain meter. |
| 15–30 s hard lockout + staff flag | **≥ `ENDPOINT_RL_SUSTAIN_MIN_COUNT`** violations in **`ENDPOINT_RL_SUSTAIN_WINDOW_SEC`**, with time from **first** to **last** violation in that window **≥ `ENDPOINT_RL_SUSTAIN_MIN_SPAN_SEC`**. Lockout length is random **15–30 s** on `rate_limit_hard_until`. |

## Behavior

- **Per-endpoint** spacing comes from [`RATE_LIMIT_CONFIG`](../backend/middleware/security.py). Each pattern shares one **token bucket** row in `rate_limit_clicks` (`user_id` + `endpoint_key`), with **`last_arrival_at`** for inter-arrival checks (legacy rows fall back to `last_at` until migrated).
- **Token bucket:** `ENDPOINT_RL_BURST_TOKENS` (default 3); refill rate `1 / min_interval_sec` per second, capped at burst size.
- **Sub-interval:** gap under `min_interval_sec` → append `endpoint_rl_violations`; then bucket allow/deny as before.
- **Soft block:** 429, no short **`cooldown_seconds`** (see above). **Hard block:** long **`cooldown_seconds`** until `rate_limit_hard_until` expires; **`endpoint_rate_limit_hard`** in response when that lockout applies.
- **PyMongo:** Allow path uses `modified_count` / insert success, not `upserted_count`.

## Spam / duplicate requests

Unchanged: still use **`_get_cooldown_seconds`** in [`security_middleware.py`](../backend/middleware/security_middleware.py) for `check_request_spam` and `check_duplicate_request`.

## Verification (manual)

1. Enable **GLOBAL_RATE_LIMITS_ENABLED**, **SECURITY_MIDDLEWARE_ENABLED**, and one endpoint with a short interval (e.g. 300 ms).
2. **Burst:** Rapid requests within burst may **succeed**; **`endpoint_rl_violations`** still receives entries when spacing is sub-interval; soft 429 has **no** short cooldown in JSON.
3. **Sustained:** Sub-interval violations spread over **≥15 s** with **≥3** in **30 s** → hard lockout response with long **`cooldown_seconds`** and **`endpoint_rate_limit_hard`** true.
4. **Multi-worker:** Hard state on **`users.rate_limit_hard_until`**; metering uses **`rate_limit_clicks`** / DB when available.
