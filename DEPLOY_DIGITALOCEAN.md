# Deploy Mafia Game to DigitalOcean (frontend + backend on one Droplet)

This guide deploys the React frontend and FastAPI backend on a **single DigitalOcean Droplet** (Ubuntu). Nginx serves the app and proxies `/api` to the backend. Keep using **MongoDB Atlas** (no need to host DB on DO).

---

## 1. Create a Droplet

1. Sign up at [digitalocean.com](https://www.digitalocean.com).
2. **Create** → **Droplets**.
3. **Image:** Ubuntu 22.04 (LTS).
4. **Plan:** Basic → **Regular** (or Shared CPU). **$6/mo** (1 GB RAM) is enough to start; use **$12/mo** (2 GB) if the frontend build is slow or you want headroom.
5. **Datacenter:** Choose closest to your users.
6. **Authentication:** Add your SSH key (recommended) or use a root password.
7. **Hostname:** e.g. `mafia-game`.
8. Create Droplet. Note the **IP address** (e.g. `123.45.67.89`).

---

## 2. Point a domain (optional but recommended)

- In your domain registrar (e.g. Namecheap, Cloudflare), add an **A record**:  
  `yourdomain.com` → Droplet IP.  
- (Optional) `www.yourdomain.com` → same IP.  
- Use `yourdomain.com` below. If you skip this, use the Droplet IP everywhere instead.

---

## 3. SSH into the Droplet

From your PC (PowerShell or Git Bash):

```bash
ssh root@YOUR_DROPLET_IP
```

Replace `YOUR_DROPLET_IP` with the IP from step 1. Accept the host key if prompted.

---

## 4. Install dependencies

Run on the server:

```bash
apt update && apt upgrade -y

# Python 3.11, pip, venv
apt install -y python3.11 python3.11-venv python3-pip

# Node.js 20 (for building the frontend)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Nginx
apt install -y nginx

# Git
apt install -y git
```

---

## 5. Clone the repo and set app directory

Replace with your actual GitHub repo URL and branch if different:

```bash
cd /opt
git clone https://github.com/Griff10IX/Mafia-game.git mafia-app
cd mafia-app
git checkout main
```

If your app is in **Mafia-Game-2** repo:

```bash
cd /opt
git clone https://github.com/Griff10IX/Mafia-Game-2.git mafia-app
cd mafia-app
# If code is in a subfolder: cd Mafia-Game-2
git checkout main
```

Set a variable for the app root (adjust if you use a subfolder like `Mafia-Game-2`):

```bash
export APP_ROOT=/opt/mafia-app
cd $APP_ROOT
```

---

## 6. Backend (FastAPI)

```bash
cd $APP_ROOT/backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create the env file (use your real values):

```bash
nano .env
```

Add (replace with your MongoDB Atlas URL and secrets):

```env
MONGO_URL=mongodb+srv://USER:PASS@cluster.mongodb.net/
DB_NAME=mafia
JWT_SECRET_KEY=your-super-secret-key-change-this
CORS_ORIGINS=https://yourdomain.com
ADMIN_EMAILS=your@email.com
```

Save (Ctrl+O, Enter, Ctrl+X). Then test run:

```bash
uvicorn server:app --host 127.0.0.1 --port 8000
```

Press Ctrl+C to stop. Create a systemd service so it runs on boot:

```bash
nano /etc/systemd/system/mafia-backend.service
```

Paste (adjust `APP_ROOT` if different):

```ini
[Unit]
Description=Mafia FastAPI backend
After=network.target

[Service]
User=root
WorkingDirectory=/opt/mafia-app/backend
Environment="PATH=/opt/mafia-app/backend/venv/bin"
ExecStart=/opt/mafia-app/backend/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable mafia-backend
systemctl start mafia-backend
systemctl status mafia-backend
```

---

## 7. Frontend (build and output)

Build the React app **on the server** so the same domain can be used (no CORS issues for `/api`):

```bash
cd $APP_ROOT
export REACT_APP_BACKEND_URL=
npm install --legacy-peer-deps
npm run build
```

If the build fails (e.g. Node memory), try:

```bash
export NODE_OPTIONS=--max-old-space-size=2048
npm run build
```

The built files will be in `$APP_ROOT/build`. Nginx will serve this folder.

---

## 8. Nginx (serve frontend + proxy API)

Create a config (use your domain or Droplet IP):

```bash
nano /etc/nginx/sites-available/mafia
```

Paste (replace `yourdomain.com` with your domain or leave as `_` and use IP):

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com _;

    root /opt/mafia-app/build;
    index index.html;

    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable and reload:

```bash
ln -sf /etc/nginx/sites-available/mafia /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

Open **http://YOUR_DROPLET_IP** or **http://yourdomain.com**. You should see the app; login will call `/api` on the same host.

---

## 9. HTTPS (Let's Encrypt)

If you use a domain:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Follow prompts. Certbot will adjust Nginx for HTTPS. Renewal is automatic.

After HTTPS is working, in **backend** `.env` set:

```env
CORS_ORIGINS=https://yourdomain.com
```

Then restart the backend:

```bash
systemctl restart mafia-backend
```

---

## 10. Updating the app

**Option A: Use `origin` pointing at Mafia-Game-2 (one remote)**

On the server, point `origin` at your Mafia-Game-2 repo (run once if you originally cloned a different repo):

```bash
cd /opt/mafia-app
git remote set-url origin https://github.com/Griff10IX/Mafia-Game-2.git
```

For private repos, use the **GitHub Personal Access Token (PAT)** you created — that’s the “key”. When Git asks for username and password, use your **GitHub username** and the **PAT as the password** (not your GitHub account password).

**To stop being asked every time** — embed the token in the remote URL (run this on the machine that’s prompting: your PC for push, or the server for pull). Don’t commit or share this URL.

- **On your Windows PC** (so `git push mafia2 MAfiaGame2` doesn’t ask):

```powershell
cd "c:\Users\jakeg\Desktop\Game files mafia"
git remote set-url mafia2 https://YOUR_GITHUB_USERNAME:YOUR_PAT@github.com/Griff10IX/Mafia-Game-2.git
```

- **On the server** (so `git pull` doesn’t ask):

```bash
cd /opt/mafia-app
git remote set-url origin https://YOUR_GITHUB_USERNAME:YOUR_PAT@github.com/Griff10IX/Mafia-Game-2.git
# If you use mafia2 remote for pull:
git remote set-url mafia2 https://YOUR_GITHUB_USERNAME:YOUR_PAT@github.com/Griff10IX/Mafia-Game-2.git
```

Replace `YOUR_GITHUB_USERNAME` (e.g. `Griff10IX`) and `YOUR_PAT` with your real token. After that, push and pull won’t prompt.

Alternative (no token in URL): use a credential helper so Git remembers after one prompt:

```bash
git config --global credential.helper store
# Next push/pull: enter username + PAT as password once; it’s saved.
```

Then pull and build:

```bash
git fetch origin MAfiaGame2
git checkout MAfiaGame2
git pull origin MAfiaGame2

cd backend && source venv/bin/activate && pip install -r requirements.txt
cd ..
npm run build
systemctl restart mafia-backend   # required: new backend code only loads after restart
```

**Option B: Keep a second remote `mafia2`**

```bash
cd /opt/mafia-app
git remote add mafia2 https://github.com/Griff10IX/Mafia-Game-2.git   # only if missing
git fetch mafia2 MAfiaGame2
git checkout MAfiaGame2
git pull mafia2 MAfiaGame2
# ... then backend + npm run build as above
```

Nginx already serves `build/`; no Nginx restart needed after a new build. **You must run `systemctl restart mafia-backend`** after pulling backend changes or the server will keep running the old Python code.

---

## Summary

| What        | Where / How                    |
|------------|---------------------------------|
| Frontend   | Nginx serves `build/` at `/`   |
| Backend    | Uvicorn on `127.0.0.1:8000`, Nginx proxies `/api` |
| Database   | MongoDB Atlas (unchanged)      |
| HTTPS      | Certbot + Nginx (when using a domain) |

Set **REACT_APP_BACKEND_URL** empty so the frontend uses `/api` on the same host. Set **CORS_ORIGINS** in backend `.env` to your domain (e.g. `https://yourdomain.com`) so CORS allows the browser to call the API.

---

## Alternative: DigitalOcean App Platform

Instead of a Droplet, you can use **App Platform** (managed):

- **Backend:** Create an **App** from your repo, root dir `backend`, run command `uvicorn server:app --host 0.0.0.0 --port 8080`, add env vars (MONGO_URL, etc.).
- **Frontend:** Create a **Static Site** from the same repo, root dir `.` (or `frontend` if you use that structure), build command `npm run build`, output dir `build`. Set env `REACT_APP_BACKEND_URL` to the backend app’s URL.
- Both appear in one project; you pay per app (small free tier available).

The Droplet approach above gives you one server, one bill, and full control; App Platform is less ops but split into two components.
