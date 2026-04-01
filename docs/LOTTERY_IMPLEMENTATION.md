# Lottery (implementation)

**Scope:** Lottery only (property upkeep / store cash tokens are separate).

## Implemented

- **`backend/routers/money/lottery.py`** — `GET /api/lottery`, `POST /api/lottery/buy`, `POST /api/lottery/draw-cron` (header `X-Cron-Secret` matching `CRON_SECRET`)
- **`backend/server.py`** — `lottery.register(api_router)`
- **Mongo indexes** — `lottery_rounds`, `lottery_tickets` in `backend/ensure_indexes.py`
- **`src/pages/Money/Lottery.js`** — route **`/money/lottery`** (alias **`/lottery`**), sidebar + mobile Misc nav

## Rules

$500,000 per ticket · draws **Wednesday and Sunday at 00:00 UTC** · **10%** of gross pot removed at draw (sink) · **90%** to **one** random ticket · unlimited tickets per player while they have cash.

## Cron

Schedule **`POST /api/lottery/draw-cron`** (e.g. hourly) so a run occurs shortly after Wed/Sun midnight UTC. Send header:

`X-Cron-Secret: <same value as server CRON_SECRET>`

If `CRON_SECRET` is unset, the endpoint returns **503**.

Design notes: `.cursor/plans/property_upkeep_money_sink_ca27f7bf.plan.md` (Part B).
