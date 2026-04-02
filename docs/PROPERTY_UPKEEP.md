# Property upkeep (weekly)

## Billing period

- **Cadence:** 7 days per payment (rolling). Each successful payment sets `property_upkeep_paid_until` to **max(previous paid-until, now) + 7 days** (see [`backend/routers/money/properties.py`](../backend/routers/money/properties.py)).
- **Timezone:** Stored as ISO UTC on the user document (`property_upkeep_paid_until`).
- **Baseline for pricing:** Does **not** include streak, reinvest buff, loot perk, `properties_until`, or founding multipliers — only the same **effective $/hr** used on the Properties UI (base `income_per_hour` × total levels × stack multiplier).

## Formula (hybrid)

For each progression business the player owns (canonical `properties` with `price`, `income_per_hour`, `max_level`, not `for_sale`):

1. **Weekly baseline gross** — sum of  
   `effective_income_per_hour × 168`  
   where `effective_income_per_hour` matches the API/UI:  
   `income_per_hour × total_level × stack_mult`  
   (`stack_mult = 1 + 0.25 × (copies − 1)` when copies &gt; 1).

2. **Portfolio value** — sum over each owned **copy** of `calculate_property_value(prop, level)` (base price + upgrade ladder; same helper as the backend).

3. **Weekly bill**

   `raw = INCOME_SHARE × weekly_baseline_gross + WEALTH_SHARE × portfolio_value`  

   `weekly_amount = max(MIN_WEEKLY, ceil(raw))`  

   If the player owns no qualifying businesses, `weekly_amount = 0`.

**Constants** (tunable in code): `INCOME_SHARE = 10%`, `WEALTH_SHARE = 0.2%` per week, `MIN_WEEKLY = $250`.

## Behavior

- **Lazy init:** First time a player owns any qualifying business and has no `property_upkeep_paid_until`, the server sets paid-until to **now + 7 days** so existing owners are not immediately overdue.
- **Overdue:** If `now > property_upkeep_paid_until` and `weekly_amount > 0`, **collecting income is blocked** until they pay. The Properties API shows `available_income` as 0 for display while blocked; the collect endpoint returns an error.
- **Pay:** `POST /api/properties/upkeep/pay` — deducts `weekly_amount` if cash sufficient, extends coverage, logs `economy_events` type `property_upkeep_pay`. **Prepay cap (UI + API):** pay is only allowed when **overdue** or within **`PROPERTY_UPKEEP_PAY_WINDOW_HOURS`** (default 48) of `property_upkeep_paid_until` so players cannot stack many weeks in one sitting from the button.

## Example personas (illustrative, using [`backend/data/properties.json`](../backend/data/properties.json) stats)

| Persona | Portfolio | Weekly baseline gross | Portfolio value (sum of copy values) | raw (10% + 0.2%) | Bill (after ceil + min $250) |
|--------|-----------|------------------------|----------------------------------------|------------------|------------------------------|
| New owner | Speakeasy 1× level 1 | $87,528 | $1,250 | $8,752.8 + $2.50 | **$8,756** |
| Mid | Speakeasy 1× L5 + Bullet Factory 1× L3 | $1,751,760 | $56,250 | $175,176 + $112.50 | **$175,289** |
| Whale | Luxury Casino 3× L10 (30 total levels, ×1.5 stack) | $196,877,520 | $10,312,500 | $19,687,752 + $20,625 | **$19,708,377** |

Net-retention targets should be validated in a spreadsheet against **real** collection patterns (cooldowns, 24h caps, perks); the bill is tied to **capacity** (baseline × 168), not realized weekly cash.

## Staff

- Adjust **`PROPERTY_UPKEEP_INCOME_SHARE`**, **`PROPERTY_UPKEEP_WEALTH_SHARE`**, **`PROPERTY_UPKEEP_MIN_WEEKLY`** in code; avoid duplicating formulas in the UI — expose the same numbers via `GET /properties` → `property_upkeep`.
