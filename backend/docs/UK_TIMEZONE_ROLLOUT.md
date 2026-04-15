# UK (Europe/London) timezone rollout

## What changed

- **Display (web):** Timestamps use `Europe/London` and `en-GB` via `src/utils/gameDateTime.js` (including staff Admin and attack logs).
- **Game calendar (server):** Daily / weekly / monthly boundaries (objectives, main weekly leaderboards, mini-game weekly boards, analytics buckets, booze profit “today”, store daily counters, illegal business raid day keys, crack safe replay day, bodyguard payout weekday, etc.) use **London local midnight / Monday 00:00 London**, implemented in `backend/utils/game_timezone.py`.
- **Unchanged:** All instants in Mongo and APIs remain **UTC ISO**; duration and expiry logic still compares UTC datetimes.

## Deploy note (objectives and similar)

User documents store period keys such as `objectives_daily_date`, `objectives_weekly_start`, and `objectives_monthly_start`. After switching from **UTC** to **London** for those keys, the first load may detect a “new” day/week/month relative to old values and **reset progress or rollover** once. This is a one-time alignment effect. To minimise confusion, deploy near **00:05 London** if you want the calendar flip to match player expectations.

## Dependency

- **`tzdata`** is listed in `backend/requirements.txt`. Python on Windows (and some slim Linux images) does not ship IANA zones by default; without `tzdata`, `ZoneInfo("Europe/London")` fails at import time.

## Ops checklist

- [ ] Smoke-test: objectives page, weekly leaderboards (`period=weekly`), mini-game weekly board, staff Admin log timestamps.
- [ ] If weekly payout cron runs on Monday, confirm it still runs after the London week definition (payout windows use the same `game_week_*` helpers as the boards).
