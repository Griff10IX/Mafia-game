# Robot bodyguard auto-search cron

Keeps **Attack → My searches** filled for players with an active **Robot auto-search** subscription (Store / Bodyguards), even when they never open the Attack page.

| Mode | How renewals run |
|------|------------------|
| **Default** (`ROBOT_BG_AUTO_SEARCH_USE_CRON` unset) | In-process ticker inside `mafia-backend` every **15 minutes** |
| **Cron mode** (`ROBOT_BG_AUTO_SEARCH_USE_CRON=1`) | External ticker only — **must** run the script below |

Use **cron mode** on production if you restart the API often or want renewals isolated from uvicorn workers (same idea as `AUTO_RANK_USE_CRON=1`).

---

## Server setup (recommended)

1. In `backend/.env` on the server:

```bash
CRON_SECRET=your-existing-secret
BASE_URL=http://127.0.0.1:8000
ROBOT_BG_AUTO_SEARCH_USE_CRON=1
```

2. Deploy latest code, then on the server:

```bash
cd /opt/mafia-app
sudo PROJECT=/opt/mafia-app bash scripts/install-cron-robot-bg-auto-search-on-server.sh
sudo systemctl restart mafia-backend
```

3. Check it is calling the API:

```bash
journalctl -u cron-robot-bg-auto-search -f
# Should show JSON like {"users": N, "searched": ...} every ~15m
```

---

## Manual run (no systemd)

```bash
cd /opt/mafia-app
python3 scripts/cron-robot-bg-auto-search.py
```

Reads `CRON_SECRET` and `BASE_URL` from `backend/.env`. Optional: `ROBOT_BG_AUTO_SEARCH_CRON_INTERVAL=900` (seconds).

---

## Endpoint

`POST /api/attack/cron/robot-bg-auto-search`  
Header: `X-Cron-Secret: <CRON_SECRET>`

One-shot test:

```bash
./scripts/cron-curl.sh robot-bg
```

---

## Notes

- On **purchase**, searches are seeded immediately; this cron **renews** when rows expire or are cleared (≤3h left on a row, or no active row).
- Opening **Attack** / **Bodyguards** also triggers a throttled resync (backup if cron is briefly down).
