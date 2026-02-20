# Mafia Wars – Setup guide for beginners

This is a **step-by-step walkthrough** to get **mafiawars.co.uk** (or your domain) showing your game on a DigitalOcean server. No prior experience assumed.

---

## What you need before you start

| Thing | What it is | Where to get it |
|-------|------------|------------------|
| **Domain** | Your web address (e.g. mafiawars.co.uk) | You already have this at **IONOS** |
| **DigitalOcean account** | The place that runs your server | [digitalocean.com](https://www.digitalocean.com) – sign up |
| **MongoDB Atlas** | The database for the game (we don’t host this on DigitalOcean) | [mongodb.com/atlas](https://www.mongodb.com/atlas) – free tier is fine |
| **GitHub** | Where your game code lives | You already have the repo |

You’ll also need to **copy-paste commands** into a terminal (PowerShell on Windows, or Terminal on Mac). We tell you exactly what to type.

---

## Part 1: Create your server (DigitalOcean Droplet)

A “Droplet” is just DigitalOcean’s word for a small virtual server. Your game will run on it.

1. Log in at [digitalocean.com](https://www.digitalocean.com).
2. Click **Create** → **Droplets**.
3. **Image:** choose **Ubuntu 22.04 (LTS)**.
4. **Plan:** choose **Basic**, then **Regular** (about **$6/month** for 1 GB RAM). Pick **$12/month** if the build feels slow later.
5. **Datacenter:** pick one near you or your players.
6. **Authentication:** add your SSH key (recommended) or use a password.
7. **Hostname:** type something like `mafia-game`.
8. Click **Create Droplet**.

When it’s ready, you’ll see an **IP address** (e.g. `123.45.67.89`). **Write this down** – you need it for the next part and for later.

---

## Part 2: Point your domain (mafiawars.co.uk) at that server (IONOS DNS)

Right now your domain doesn’t “point” anywhere. We’ll tell the internet: “when someone goes to mafiawars.co.uk, send them to my DigitalOcean server.”

1. Log in at **IONOS** (where you manage mafiawars.co.uk).
2. Open your **Domains** list and find **mafiawars.co.uk**.
3. Where it says **“Domain not in use”**, click **“Use your domain”** (or the **DNS** option).
4. Open the **DNS** settings for mafiawars.co.uk.
5. Add an **A record**:
   - **Type:** A  
   - **Host / Name:** `@` (or leave blank if that’s how IONOS shows “the main domain”)  
   - **Points to / Value:** your **Droplet IP** from Part 1 (e.g. `123.45.67.89`)  
   - **TTL:** leave default (e.g. 3600).  
   Save.
6. Optional – for **www.mafiawars.co.uk** to work too:
   - Add another **A** record: Host = `www`, Points to = **same Droplet IP**. Save.

Wait **5–30 minutes** for the internet to catch up. You can continue with the next part while it does.

---

## Part 3: Log into your server (SSH)

“SSH” means “connect to the server from your PC so you can type commands on it.”

1. On your PC, open **PowerShell** (Windows) or **Terminal** (Mac).
2. Type (replace with **your** Droplet IP):

   ```bash
   ssh root@123.45.67.89
   ```

3. If it asks “Are you sure you want to continue?” type `yes` and press Enter.
4. Enter your password (or use your SSH key if you set one up). You won’t see the password as you type – that’s normal.
5. When you see something like `root@mafia-game:~#`, you’re **on the server**. All the following commands are run **on the server** until we say otherwise.

---

## Part 4: Install the stuff the game needs

Copy and paste this **whole block** into the terminal (still on the server), then press Enter. It installs Python, Node.js, Nginx (the web server), and Git.

```bash
apt update && apt upgrade -y
apt install -y python3.11 python3.11-venv python3-pip
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
apt install -y nginx
apt install -y git
```

Wait for it to finish. If it asks `Do you want to continue? [Y/n]`, type `Y` and Enter.

---

## Part 5: Put your game code on the server (clone the repo)

We’ll download your game from GitHub onto the server.

1. Use **your** repo URL. For example, if your repo is **Mafia-Game-2**:

   ```bash
   cd /opt
   git clone https://github.com/Griff10IX/Mafia-Game-2.git mafia-app
   cd mafia-app
   git checkout main
   ```

   If your code is in a different repo or branch, change the URL and branch name. If you use a **private** repo, you may need to use a **Personal Access Token** instead of a password when Git asks.

2. Set a shortcut so we don’t have to type the path every time:

   ```bash
   export APP_ROOT=/opt/mafia-app
   cd $APP_ROOT
   ```

---

## Part 6: Backend (the API and database connection)

The “backend” is the part that talks to the database and does the game logic.

1. Go to the backend folder and create a virtual environment (a clean space for Python packages):

   ```bash
   cd $APP_ROOT/backend
   python3.11 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. Create the config file:

   ```bash
   nano .env
   ```

3. Paste this, then **edit the bits in capitals** to match your real details:

   ```env
   MONGO_URL=mongodb+srv://YOUR_USER:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/
   DB_NAME=mafia
   JWT_SECRET_KEY=choose-a-long-random-secret-string-here
   CORS_ORIGINS=https://mafiawars.co.uk
   ADMIN_EMAILS=your@email.com
   ```

   - **MONGO_URL:** from MongoDB Atlas (Database → Connect → “Connect your application” – copy the connection string and put your DB user and password in it).  
   - **JWT_SECRET_KEY:** any long random string (e.g. 32+ random letters/numbers).  
   - **CORS_ORIGINS:** use `https://mafiawars.co.uk` (and later we’ll add HTTPS).  
   - **ADMIN_EMAILS:** your email.

4. Save and exit: press **Ctrl+O**, Enter, then **Ctrl+X**.

5. Test that the backend starts (you’ll stop it in a second):

   ```bash
   uvicorn server:app --host 127.0.0.1 --port 8000
   ```

   If you see “Uvicorn running”, it’s working. Press **Ctrl+C** to stop it.

6. Make it run automatically whenever the server reboots:

   ```bash
   nano /etc/systemd/system/mafia-backend.service
   ```

   Paste this (if your app path is different, change `/opt/mafia-app` to match):

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

   Save (Ctrl+O, Enter, Ctrl+X). Then run:

   ```bash
   systemctl daemon-reload
   systemctl enable mafia-backend
   systemctl start mafia-backend
   systemctl status mafia-backend
   ```

   You should see “active (running)”. If not, check the message and fix the path or `.env`.

---

## Part 7: Frontend (build the React app)

The “frontend” is the part people see in the browser. We build it once on the server so it’s in the right place for Nginx to serve.

1. Go back to the app root and build (leave `REACT_APP_BACKEND_URL` empty so the game uses `/api` on the same domain):

   ```bash
   cd $APP_ROOT
   export REACT_APP_BACKEND_URL=
   npm install --legacy-peer-deps
   npm run build
   ```

   This can take a few minutes. If it runs out of memory, try first:

   ```bash
   export NODE_OPTIONS=--max-old-space-size=2048
   ```

   then run `npm run build` again.

2. When it finishes, the built files will be in `$APP_ROOT/build`. Nginx will serve this folder.

---

## Part 8: Nginx (serve the site and send /api to the backend)

Nginx is the program that: (1) serves your built frontend when someone visits your domain, and (2) sends requests to `/api` to your backend.

1. Create the Nginx config file:

   ```bash
   nano /etc/nginx/sites-available/mafia
   ```

2. Paste this and change **mafiawars.co.uk** if you use a different domain:

   ```nginx
   server {
       listen 80;
       server_name mafiawars.co.uk www.mafiawars.co.uk _;

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

   The `_` at the end of `server_name` means “also answer if someone visits using the raw IP address”.

3. Save and exit (Ctrl+O, Enter, Ctrl+X).

4. Turn this config on and reload Nginx:

   ```bash
   ln -sf /etc/nginx/sites-available/mafia /etc/nginx/sites-enabled/
   rm -f /etc/nginx/sites-enabled/default
   nginx -t
   systemctl reload nginx
   ```

If `nginx -t` says “syntax is ok”, you’re good. Try opening **http://mafiawars.co.uk** (or **http://YOUR_DROPLET_IP**) in your browser. You should see the game. If the domain doesn’t open yet, wait a bit for DNS (Part 2) to finish updating.

---

## Part 9: HTTPS (padlock in the browser – optional but recommended)

HTTPS makes the connection encrypted. Browsers like it and it’s free with Let’s Encrypt.

1. On the server, install Certbot (the tool that gets the free certificate):

   ```bash
   apt install -y certbot python3-certbot-nginx
   certbot --nginx -d mafiawars.co.uk -d www.mafiawars.co.uk
   ```

2. Follow the prompts: enter your email, agree to terms, choose whether to redirect HTTP to HTTPS (recommended: yes).

3. When it’s done, Certbot will have changed your Nginx config so HTTPS works. Test by opening **https://mafiawars.co.uk**.

4. Make sure the backend knows the site is HTTPS. Edit the backend `.env`:

   ```bash
   nano /opt/mafia-app/backend/.env
   ```

   Set:

   ```env
   CORS_ORIGINS=https://mafiawars.co.uk
   ```

   Save, then restart the backend:

   ```bash
   systemctl restart mafia-backend
   ```

That’s it. Your game should now be live at **https://mafiawars.co.uk**.

---

## Quick checklist

- [ ] Part 1: Droplet created, IP written down  
- [ ] Part 2: IONOS DNS – A record for mafiawars.co.uk (and www) → Droplet IP  
- [ ] Part 3: SSH into the server  
- [ ] Part 4: Dependencies installed  
- [ ] Part 5: Repo cloned to `/opt/mafia-app`  
- [ ] Part 6: Backend `.env` filled in, backend service running  
- [ ] Part 7: Frontend built (`npm run build`)  
- [ ] Part 8: Nginx config in place, Nginx reloaded  
- [ ] Part 9: Certbot run for HTTPS, CORS_ORIGINS set, backend restarted  

---

## If something goes wrong

- **“Connection refused” or “can’t connect”**  
  Check that the Droplet is running in the DigitalOcean dashboard and that you’re using the correct IP. For the domain, wait longer for DNS (up to an hour in rare cases).

- **Site loads but login doesn’t work**  
  Check backend logs: `journalctl -u mafia-backend -f`. Make sure `MONGO_URL` and `CORS_ORIGINS` in `.env` are correct (CORS should use `https://mafiawars.co.uk` with no trailing slash when you’re on HTTPS).

- **“502 Bad Gateway”**  
  The backend probably isn’t running. Run `systemctl status mafia-backend` and fix any errors (often a typo in `.env` or wrong path in the service file).

- **More detail**  
  The full technical guide is in **DEPLOY_DIGITALOCEAN.md** in this repo (updating the app, redirects, etc.).

---

You’re done. Share **https://mafiawars.co.uk** with your players.
