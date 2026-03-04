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

## Docs

- **This file:** `backend/WHERE-STUFF-IS.md`
- **Backend overview:** `backend/README.md`
- **Email setup (SSH + IONOS):** project root `EMAIL-SETUP-FOR-DUMMIES.md`
