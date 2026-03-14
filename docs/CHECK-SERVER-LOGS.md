# How to check server logs (502 / login issues)

After pushing an update, if you get **502 Bad Gateway** or login fails, check these logs on the server.

## 1. SSH into the server

From your machine (PowerShell or terminal):

```bash
ssh root@178.128.38.68
```

(Use the same password as in `push-live.bat` if prompted.)

---

## 2. Backend service status

See if the backend is running or crashed:

```bash
sudo systemctl status mafia-backend
```

- **active (running)** – service is up; 502 might be nginx or something else.
- **failed** or **inactive** – service crashed; check the logs below.

---

## 3. Backend logs (best place for 502 / startup errors)

**Option A – systemd (recommended)**  
Shows why the service failed to start or crashed:

```bash
sudo journalctl -u mafia-backend -n 100 --no-pager
```

Live tail (follow new lines):

```bash
sudo journalctl -u mafia-backend -f
```

**Option B – app log file**  
Application-level messages (startup, DB, etc.):

```bash
tail -100 /opt/mafia-app/backend/logs/server.log
```

**Option C – service stdout/stderr**  
If the unit file logs to files (e.g. from an older deploy script):

```bash
tail -100 /home/root/mafia-backend-error.log
# or
tail -100 /home/root/mafia-backend.log
```

(Path may be under a different user, e.g. `/home/ubuntu/...` – check with `ls /home/`.)

---

## 4. Nginx (if backend is running but you still get 502)

```bash
sudo tail -50 /var/log/nginx/error.log
```

---

## 5. One-liner from your PC (no SSH session)

If you have `plink` (from push-live.bat), you can run:

```batch
plink -pw "YOUR_SSH_PASSWORD" root@178.128.38.68 "sudo journalctl -u mafia-backend -n 80 --no-pager"
```

Replace `YOUR_SSH_PASSWORD` with the same password used in `push-live.bat`.  
This prints the last 80 backend log lines so you can see startup/crash errors.

---

## What to look for

- **Python traceback / ImportError / ModuleNotFoundError** – code or dependency issue after the update.
- **JWT_SECRET_KEY must be set** – backend refuses to start until `.env` has a real secret.
- **MongoDB connection errors** – DB not reachable or wrong `MONGO_URL` in `backend/.env`.
- **Address already in use** – port 8000 in use; restart or fix the process using it.

After you find the error, fix the code or config, push again, and redeploy (or restart: `sudo systemctl restart mafia-backend`).
