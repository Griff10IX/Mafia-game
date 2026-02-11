# Deploy Mafia Game to Linode (frontend + backend on one VPS)

> **Using DigitalOcean instead?** See [DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md) for the same setup on a Droplet.

This guide deploys the React frontend and FastAPI backend on a **single Linode** (Ubuntu). Nginx serves the app and proxies `/api` to the backend. Keep using **MongoDB Atlas** (no need to host DB on Linode).

---

## 1. Create a Linode

1. Sign up at [linode.com](https://www.linode.com).
2. **Create** → **Linode**.
3. **Image:** Ubuntu 22.04 LTS.
4. **Region:** Choose closest to your users.
5. **Plan:** Nanode 1 GB ($5/mo) is enough to start; use 2 GB if you want more headroom.
6. **Root Password:** Set a strong password (and save it).
7. Create the Linode. Note the **IP address** (e.g. `123.45.67.89`).

---

## 2. Point a domain (optional but recommended)

- In your domain registrar (e.g. Namecheap, Cloudflare), add an **A record**:  
  `yourdomain.com` → Linode IP.  
- (Optional) `www.yourdomain.com` → same IP.  
- Use `yourdomain.com` below. If you skip this, use the Linode IP everywhere instead.

---

## 3. SSH into the Linode

From your PC (PowerShell or Git Bash):

```bash
ssh root@YOUR_LINODE_IP
```

Replace `YOUR_LINODE_IP` with the IP from step 1. Accept the host key if prompted.

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

Create a config (use your domain or Linode IP):

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

Open **http://YOUR_LINODE_IP** or **http://yourdomain.com**. You should see the app; login will call `/api` on the same host.

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

```bash
cd /opt/mafia-app
git pull origin main
cd backend && source venv/bin/activate && pip install -r requirements.txt
systemctl restart mafia-backend
cd ..
npm run build
# Nginx already points to build/; no restart needed
```

---

## Summary

| What        | Where / How                    |
|------------|---------------------------------|
| Frontend   | Nginx serves `build/` at `/`   |
| Backend    | Uvicorn on `127.0.0.1:8000`, Nginx proxies `/api` |
| Database   | MongoDB Atlas (unchanged)      |
| HTTPS      | Certbot + Nginx (when using a domain) |

Set **REACT_APP_BACKEND_URL** empty (or same origin) so the frontend uses `/api` on the same host. Set **CORS_ORIGINS** in backend `.env` to your Linode domain (or `https://yourdomain.com`) so CORS allows the browser to call the API.
