# Auto Rank cron-bust ticker (every 5 seconds)

When you use **AUTO_RANK_USE_CRON=1**, the server does not run the bust loop itself. The **Auto Rank "Jail bust every 5 sec"** option in the UI is driven by this ticker: it calls `POST /api/auto-rank/cron-bust` every 5s so users with that option get one bust attempt every 5 seconds. Without the ticker (or equivalent), that option does nothing in cron mode.

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

## Quick start (run by hand)

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

- Use the same `CRON_SECRET` as your main 60s cron job.
- Keep your main cron for the 60s Auto Rank cycle: `POST /api/auto-rank/cron` every minute.
