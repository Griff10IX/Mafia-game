# Deploy with Vercel (frontend) + Render (backend)

**Repo:** [github.com/Griff10IX/mafia-game](https://github.com/Griff10IX/mafia-game)

Your app: **React frontend** (`frontend/`) + **FastAPI backend** (`backend/`) + **MongoDB**.

---

## What gets pushed (up to date)

When you push to GitHub, the repo includes all current source and config; secrets and build outputs are excluded by `.gitignore`.

| Included | Excluded (never commit) |
|----------|---------------------------|
| `backend/` — server.py, routers/, requirements.txt, tests/, seed_families.py | `backend/.env` (MONGO_URL, JWT_SECRET_KEY, etc.) |
| `frontend/` — src/, public/, package.json, craco.config.js, vercel.json | `frontend/.env` (REACT_APP_BACKEND_URL) |
| Root: DEPLOY_VERCEL_RENDER.md, .gitignore, FAMILIES_AND_FAMILYWAR_REFERENCE.md | `node_modules/`, `frontend/build/`, `__pycache__/`, `.venv/` |
| `BACKUP_ALL_FILES/`, `.emergent/` (if present) | |

Set **MONGO_URL**, **DB_NAME**, **JWT_SECRET_KEY**, **CORS_ORIGINS** (and any Stripe/API keys) in **Render** Environment. Set **REACT_APP_BACKEND_URL** in **Vercel** Environment.

---

## 1. MongoDB in the cloud (required for Render backend)

Your backend needs MongoDB. Use **MongoDB Atlas** (free tier):

1. Go to [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) and create an account.
2. Create a **free cluster** (e.g. M0).
3. **Database Access** → Add user (username + password). Note the password.
4. **Network Access** → Add IP: `0.0.0.0/0` (allows Render to connect).
5. **Connect** → “Drivers” → copy the connection string. It looks like:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Replace `USER` and `PASSWORD` with your DB user. Add the database name after `.net/` if needed, e.g.:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/mafia?retryWrites=true&w=majority&appName=Cluster0`

You’ll use this as `MONGO_URL` on Render (Environment only; do not commit).

---

## 2. Deploy backend on Render

1. Push your code to **GitHub** (e.g. repo `mafia-game`). Backend must be in the repo (e.g. in a `backend` folder).
2. Go to [render.com](https://render.com) → Sign up / Log in (GitHub is easiest).
3. **Dashboard** → **New** → **Web Service**.
4. Connect your GitHub repo. Select the repo.
5. Configure:
   - **Name:** e.g. `mafia-api`
   - **Region:** pick one close to you.
   - **Root Directory:** `backend`
   - **Runtime:** `Python 3`
   - **Build Command:**  
     `pip install -r requirements.txt`
   - **Start Command:**  
     `uvicorn server:app --host 0.0.0.0 --port $PORT`
6. **Environment** (Environment Variables):
   - `MONGO_URL` = your Atlas connection string (from step 1).
   - `DB_NAME` = e.g. `mafia` (database name in that URL).
   - `JWT_SECRET_KEY` = a long random string (generate one and keep it secret).
   - `CORS_ORIGINS` = your frontend URL (see step 3). You can set it after Vercel deploy, e.g. `https://your-app.vercel.app` or `*` for testing.
   - Add any other keys your app uses (e.g. `THE_ODDS_API_KEY`, Stripe keys).
7. Click **Create Web Service**. Wait for the first deploy. Your API URL will be like:  
   `https://mafia-api.onrender.com`

**Note:** On the free tier, the service may sleep after inactivity; the first request after sleep can be slow.

---

## 3. Deploy frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → Sign up / Log in (GitHub is easiest).
2. **Add New** → **Project** → Import your GitHub repo.
3. Configure:
   - **Root Directory:** click **Edit** and set to `frontend`.
   - **Framework Preset:** Create React App (or Vite if you use it). Vercel usually detects it.
   - **Build Command:** `yarn build` (or `npm run build`).
   - **Output Directory:** `build`.
4. **Environment Variables:**
   - `REACT_APP_BACKEND_URL` = your Render API URL **without** `/api`, e.g.  
     `https://mafia-api.onrender.com`
5. Click **Deploy**. When it’s done you’ll get a URL like:  
   `https://your-project.vercel.app`

---

## 4. Connect frontend to backend (CORS)

1. In **Render** → your backend service → **Environment**.
2. Set `CORS_ORIGINS` to your Vercel URL, e.g. `https://your-project.vercel.app`  
   (or comma-separated list if you have several). For quick testing you can use `*` (not recommended for production).
3. **Save Changes** (Render may redeploy).

Your frontend already uses `REACT_APP_BACKEND_URL` in `src/utils/api.js` and appends `/api` for requests, so once this is set, the app should work.

---

## 5. Optional: custom domain (e.g. Namecheap)

- **Vercel:** Project → **Settings** → **Domains** → add your domain (e.g. `game.yourdomain.com`). Vercel will show the CNAME or A record to add in Namecheap DNS.
- **Render:** Service → **Settings** → **Custom Domain** → add e.g. `api.yourdomain.com` and add the CNAME in Namecheap.
- Then set `REACT_APP_BACKEND_URL` to your Render custom domain (e.g. `https://api.yourdomain.com`) and update `CORS_ORIGINS` to your Vercel custom domain.

---

## Quick checklist

| Step | Where | What |
|------|--------|------|
| 1 | MongoDB Atlas | Create cluster, user, get `MONGO_URL` |
| 2 | Render | New Web Service from repo, root `backend`, start: `uvicorn server:app --host 0.0.0.0 --port $PORT`, set env vars |
| 3 | Vercel | New project from repo, root `frontend`, set `REACT_APP_BACKEND_URL` |
| 4 | Render | Set `CORS_ORIGINS` to your Vercel URL |

After that, open the Vercel URL and use the app; all API calls go to the Render backend.
