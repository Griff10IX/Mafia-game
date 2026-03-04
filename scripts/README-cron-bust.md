# Auto Rank cron (two tickers when using AUTO_RANK_USE_CRON=1)

When you use **AUTO_RANK_USE_CRON=1**, the server does **not** run Auto Rank itself. You must call the API from outside.

**If you see `cron-bust` every 5s in logs but no `POST /api/auto-rank/cron` and no "running cycle for N due user(s)" after 60s:**  
The **main** 60s cron is not running. Start it with one of: **systemd** (see "Main cron ticker" below — use `cron-cycle-ticker.service.example`), **crontab** (`* * * * * .../cron-curl.sh main`), or by hand: `python scripts/cron-cycle-ticker.py`.

| What runs | Endpoint | How often | Script |
|-----------|----------|------------|--------|
| **Crimes, GTA, booze, OC** (main cycle) | `POST /api/auto-rank/cron` | Every **60s** | `scripts/cron-cycle-ticker.py` |
| **Jail bust every 5 sec** only | `POST /api/auto-rank/cron-bust` | Every **5s** | `scripts/cron-bust-ticker.py` |

**If you only run the cron-bust ticker, crimes will never run.** You must also run the main cron (script or crontab below).

---

## Fixing 403 / "X-Cron-Secret mismatch"

The backend reads **`CRON_SECRET`** from **`backend/.env`** (or from the environment when you start uvicorn, e.g. `EnvironmentFile=/opt/mafia-app/backend/.env`). The value you send in the **`X-Cron-Secret`** header must be **exactly** that value.

**Do this:**

1. **Single source of truth**  
   In `backend/.env` set:
   ```bash
   CRON_SECRET=your-long-random-secret-here
   ```
   No spaces around `=`. If you change it, restart the backend so it picks up the new value.

2. **Use the same value when calling the API**
   - **Python tickers** (`cron-cycle-ticker.py`, `cron-bust-ticker.py`): they load `backend/.env` automatically. As long as the backend is also started with that same `.env` (e.g. systemd `EnvironmentFile` pointing at `backend/.env`), they will match.
   - **Crontab with curl:** either:
     - **Option A (recommended):** use the wrapper script so the secret always comes from `.env` (no copy-paste):
       ```bash
       * * * * * /opt/mafia-app/scripts/cron-curl.sh main
       ```
       (Replace `/opt/mafia-app` with your project root. Script: `scripts/cron-curl.sh`.)
     - **Option B:** copy the **exact** value from `backend/.env` into the crontab line (replace `YOUR_CRON_SECRET` below). One wrong character or extra space causes 403.

3. **Check both sides**
   - Backend: `grep CRON_SECRET /path/to/backend/.env`
   - Crontab: `crontab -l`
   - If using a script, ensure it reads from the same `.env` the backend uses.

---

## Main cron via crontab (Option B) — crimes every minute

Call the main Auto Rank endpoint once per minute with system cron.

**Option A — Use wrapper script (secret from .env, no mismatch):**

1. Make the script runnable: `chmod +x scripts/cron-curl.sh`
2. `crontab -e` and add (replace `/path/to/Game-files-mafia` with your project root):
   ```bash
   * * * * * /path/to/Game-files-mafia/scripts/cron-curl.sh main
   ```

**Option B — Put the secret in crontab:**

1. **On the server**, open crontab:
   ```bash
   crontab -e
   ```

2. **Add one line** (run every minute). Replace `YOUR_CRON_SECRET` with the **exact** value from `backend/.env` (same as the backend uses):
   ```bash
   * * * * * curl -s -X POST -H "X-Cron-Secret: YOUR_CRON_SECRET" -H "Content-Type: application/json" https://your-domain.com/api/auto-rank/cron
   ```
   If the app is on the same host:
   ```bash
   * * * * * curl -s -X POST -H "X-Cron-Secret: YOUR_CRON_SECRET" -H "Content-Type: application/json" http://127.0.0.1:8000/api/auto-rank/cron
   ```

3. **Save and exit.** Cron will run that command every minute. Check server logs for `POST /api/auto-rank/cron` returning 200.

---

## cron-bust ticker (every 5 seconds)

The **Auto Rank "Jail bust every 5 sec"** option is driven by this ticker: it calls `POST /api/auto-rank/cron-bust` every 5s. Without it, that option does nothing in cron mode.

---

## Setup (Linux server)

Do this on the machine where the app (or at least the cron) runs.

1. **Env on the server**  
   In `backend/.env` set (same values you use for the main Auto Rank cron):
   - `AUTO_RANK_USE_CRON=1` – so the server relies on cron + this ticker (no in-process bust loop).
   - `CRON_SECRET=your-secret`
   - `BASE_URL=https://your-domain.com` (or `http://localhost:8000` if the ticker and app are on the same host)

2. **Install the systemd service**  
   From your project root (replace `YOUR_PROJECT_ROOT` with the real path, e.g. `/home/you/Game-files-mafia`):
   ```bash
   sudo cp scripts/cron-bust-ticker.service.example /etc/systemd/system/cron-bust-ticker.service
   sudo sed -i 's|/path/to/Game-files-mafia|YOUR_PROJECT_ROOT|g' /etc/systemd/system/cron-bust-ticker.service
   ```

3. **Enable and start**  
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable cron-bust-ticker
   sudo systemctl start cron-bust-ticker
   ```

4. **Verify**  
   ```bash
   sudo systemctl status cron-bust-ticker
   ```
   You should see `active (running)`. To watch logs: `journalctl -u cron-bust-ticker -f`.

**Useful commands**
- Stop: `sudo systemctl stop cron-bust-ticker`
- Restart: `sudo systemctl restart cron-bust-ticker`
- Disable (don’t start on boot): `sudo systemctl disable cron-bust-ticker`

---

## Main cron ticker (crimes / GTA / booze / OC) — every 60s

Run this so Auto Rank actually runs crimes and the rest of the cycle:

```bash
python scripts/cron-cycle-ticker.py
```

Uses the same `CRON_SECRET` and `BASE_URL` as the bust ticker. Optional: `CRON_CYCLE_INTERVAL=60` (default 60 seconds).

---

## Quick start (run by hand) — bust ticker

1. In **backend/.env** (or your env) set:
   - `CRON_SECRET` – same value you use for your main Auto Rank cron
   - `BASE_URL` – e.g. `http://localhost:8000` or `https://your-domain.com`

2. From the **project root** (where `backend` and `scripts` live):

   ```bash
   python scripts/cron-bust-ticker.py
   ```

   Or from the **backend** folder (so it loads backend/.env):

   ```bash
   cd backend
   python ../scripts/cron-bust-ticker.py
   ```

3. Leave it running. It will POST to `/api/auto-rank/cron-bust` every 5 seconds. Press Ctrl+C to stop.

## Production (Linux server)

Cron cannot run jobs more often than once per minute, so the 5-second jail bust must run as a **long-running process**, not a cron job.

**Option A – systemd (recommended)**  
Runs on boot, restarts on crash, easy to manage:

1. Copy the example unit and fix paths:
   ```bash
   sudo cp scripts/cron-bust-ticker.service.example /etc/systemd/system/cron-bust-ticker.service
   sudo nano /etc/systemd/system/cron-bust-ticker.service
   ```
   Set `WorkingDirectory=` and both paths in `ExecStart=` to your project root (e.g. `/home/you/Game-files-mafia`).

2. Ensure `backend/.env` on the server has `CRON_SECRET` and `BASE_URL` (e.g. `https://your-domain.com`).

3. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable cron-bust-ticker
   sudo systemctl start cron-bust-ticker
   ```
   Check: `sudo systemctl status cron-bust-ticker`  
   Logs: `journalctl -u cron-bust-ticker -f`

**Option B – nohup (quick and dirty)**  
```bash
cd /path/to/Game-files-mafia
nohup python3 scripts/cron-bust-ticker.py >> /var/log/cron-bust-ticker.log 2>&1 &
```
It won’t start on reboot; use systemd for that.

- Use the same `CRON_SECRET` as your main cron.
- **You must run the main Auto Rank cron** for crimes/GTA/booze/OC: either `python scripts/cron-cycle-ticker.py` (calls `POST /api/auto-rank/cron` every 60s) or a system crontab entry like `* * * * * curl -X POST -H "X-Cron-Secret: YOUR_SECRET" https://your-domain.com/api/auto-rank/cron`.
