# Push updates (go live)

## One push = commit, push to both repos, deploy on server

**Easiest:** double-click **`push-live.bat`**  
- Commits all changes (message "Update"), pushes to **origin** (Mafia-game) and **mafia2** (Mafia-Game-2), then SSHs to the server and runs: fetch, reset, build, restart backend, reload nginx.

**With a custom commit message:** in terminal:
```powershell
.\push-live.bat "Fixed families page"
```
or
```powershell
.\push-live.ps1 "Fixed families page"
```

**Manual (push only, no server deploy):**
```powershell
git add -A
git commit -m "Your message"
git push origin MAfiaGame2
git push mafia2 MAfiaGame2
```

---

## If you deploy on the server by hand

SSH in, then:

```bash
cd /opt/mafia-app
git fetch origin
git reset --hard origin/MAfiaGame2
npm run build
sudo systemctl restart mafia-backend
sudo systemctl reload nginx
```

---

## If you see: "could not read Username for 'https://github.com'"

The server is using HTTPS for the `mafia2` remote and can’t log in to GitHub when the deploy script runs. Use **SSH** on the server instead.

**One-time setup on the server:**

1. **SSH in:** `ssh root@178.128.38.68`

2. **Point `mafia2` at GitHub over SSH** (replace with your repo if different):
   ```bash
   cd /opt/mafia-app
   git remote set-url mafia2 git@github.com:Griff10IX/Mafia-Game-2.git
   ```

3. **Add the server’s SSH key to GitHub** so the server can pull without a password:
   - On the server, show the public key: `cat ~/.ssh/id_rsa.pub` (or `id_ed25519.pub`). If that file doesn’t exist, create a key: `ssh-keygen -t ed25519 -C "mafia-server" -N ""`.
   - In GitHub: repo **Mafia-Game-2** → **Settings** → **Deploy keys** → **Add deploy key**. Paste the key and save.

4. **Test:**  
   `git fetch mafia2`  
   If it runs without asking for a password, future deploys (including from `push-live.bat`) will work.
