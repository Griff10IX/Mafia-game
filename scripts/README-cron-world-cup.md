# World Cup fixture sync & auto-settle cron

Keeps **World Cup** knockout fixtures up to date (R16, quarter-finals, semis, final) and settles finished matches without manual admin clicks.

| Job | Schedule | What it does |
|-----|----------|--------------|
| **Fixture sync** | **Every night 00:00 UK** | `POST /api/world-cup/cron/sync-fixtures` — Odds API events + `backend/data/world_cup_2026_kickoffs.json` |
| **Auto-settle** | Every **30 minutes** | `POST /api/world-cup/cron/auto-settle` — scores → prediction results |

New knockout rounds appear automatically when the Odds API lists them. Official kickoff times / rounds from `world_cup_2026_kickoffs.json` are merged on each sync (add confirmed matchups there after each round if needed).

---

## Server setup (one time)

1. In `backend/.env` on the server:

```bash
CRON_SECRET=your-existing-secret
BASE_URL=http://127.0.0.1:8000
THE_ODDS_API_KEY=...
```

2. Deploy latest code, then on the server:

```bash
cd /opt/mafia-app
sudo PROJECT=/opt/mafia-app bash scripts/install-cron-world-cup-on-server.sh
sudo systemctl restart mafia-backend
```

3. Run a sync immediately (optional):

```bash
cd /opt/mafia-app
python3 scripts/cron-world-cup-sync.py
```

4. Check the timer:

```bash
systemctl list-timers world-cup-fixture-sync.timer
journalctl -u world-cup-fixture-sync.service -n 30
journalctl -u world-cup-auto-settle -n 20
```

---

## Manual / crontab alternative

```bash
# Nightly sync (00:00 UK) — crontab line:
0 0 * * * cd /opt/mafia-app && /usr/bin/python3 scripts/cron-world-cup-sync.py

# Or via curl helper:
./scripts/cron-curl.sh wc-sync
./scripts/cron-curl.sh wc-settle
```

Set `WORLD_CUP_SYNC_USE_CRON=1` and `WORLD_CUP_AUTO_SETTLE_USE_CRON=1` so the API process does not run duplicate in-process tickers.

---

## Endpoints

| Endpoint | Header |
|----------|--------|
| `POST /api/world-cup/cron/sync-fixtures` | `X-Cron-Secret` |
| `POST /api/world-cup/cron/auto-settle` | `X-Cron-Secret` |

Admin can still use **Sync fixtures** / **Auto-settle run** in the World Cup admin panel for one-off runs.
