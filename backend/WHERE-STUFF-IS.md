# Backend – where stuff is

Quick reference for paths and important files.

## .env (config & secrets)

- **On your machine (repo):**  
  `backend/.env`  
  (create from `backend/.env.example`; never commit `.env`)

- **On the server:**  
  `/opt/mafia-app/backend/.env`  
  Edit with: `nano /opt/mafia-app/backend/.env` (from anywhere) or `cd /opt/mafia-app/backend` then `nano .env`

## Server (systemd)

- **Service name:** `mafia-backend.service`
- **Restart after changing .env:**  
  `sudo systemctl restart mafia-backend`
- **Check status:** `sudo systemctl status mafia-backend`
- **View logs:** `sudo journalctl -u mafia-backend -f`

## Main app

- **Entry point:** `backend/server.py`
- **Routers:** `backend/routers/*.py` (auth, crimes, jail, store, etc.)
- **Email sending:** `backend/email_sender.py` (SMTP / Resend)
- **Dependencies:** `backend/requirements.txt`

## Email verification

- **Default:** ON (new users must verify email before logging in). To turn off, use Admin → Game settings → uncheck “Require email verification” and save.
- **Existing users:** If you already have users and enable verification, run once so they can still log in:  
  `python backend/migrate_email_verified.py` (from repo root, with correct `MONGO_URL` / `.env`).

## SSL / “Not secure” in the browser

- **Why it happens:** The browser shows “Not secure” when the **page** is loaded over **HTTP** (no padlock). Having an SSL certificate is not enough if you don’t use it.
- **Quick fix:** Always open the site as **https://mafiawars.co.uk** (with **https**). Bookmark that. If you type `mafiawars.co.uk` or `http://mafiawars.co.uk`, the connection is unencrypted and the browser will say “Not secure”.
- **Proper fix – redirect HTTP → HTTPS (do this on the server):**
  1. SSH in, then run:  
     `sudo nano /etc/nginx/sites-available/default`
  2. At the **top** of the file (before any other `server {` block), add this block. Use your domain; for mafiawars.co.uk:

     ```nginx
     server {
         listen 80;
         server_name mafiawars.co.uk www.mafiawars.co.uk;
         return 301 https://$host$request_uri;
     }
     ```

  3. Save (Ctrl+O, Enter) and exit (Ctrl+X).
  4. Test and reload Nginx:

     ```bash
     sudo nginx -t
     sudo systemctl reload nginx
     ```

  After this, opening `http://mafiawars.co.uk` will redirect to `https://` and the padlock will show. More detail: project root **SSL-NOT-SECURE.md**.

- **If it still isn’t redirecting:**  
  1. **Right config file** – You might be editing the wrong file. See which site is actually used:  
     `ls -la /etc/nginx/sites-enabled/`  
     If you see `mafia-backend` (and no `default`), edit that instead:  
     `sudo nano /etc/nginx/sites-available/mafia-backend`  
     Add the redirect block at the top of **that** file, then `sudo nginx -t` and `sudo systemctl reload nginx`.

  2. **Port 80 must only redirect** – If the **same** `server { }` block has both `listen 80` and `location /` (or `root`), Nginx will serve the site on HTTP and won’t redirect. Fix: have **two** blocks.  
     - **Block 1 (only redirect):**  
       `listen 80;`  
       `server_name mafiawars.co.uk www.mafiawars.co.uk;`  
       `return 301 https://$host$request_uri;`  
       (no `location /`, no `root`, no `proxy_pass` in this block.)  
     - **Block 2 (HTTPS and your app):**  
       `listen 443 ssl;`  
       … rest of your config (server_name, ssl_certificate, location /, proxy_pass, etc.).  
     If your current block has both `listen 80` and `listen 443 ssl`, **remove the line `listen 80;`** from that block and add the separate redirect block above so only the new block listens on 80.

  3. **Check what Nginx is doing:**  
     `sudo nginx -T | grep -B2 -A12 "listen 80"`  
     You should see a server block that has `listen 80` and `return 301 https://` and nothing that serves content (no `location /` in that block).

## Docs

- **This file:** `backend/WHERE-STUFF-IS.md`
- **Backend overview:** `backend/README.md`
- **Email setup (SSH + IONOS):** project root `EMAIL-SETUP-FOR-DUMMIES.md`
