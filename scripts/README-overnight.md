# Overnight test bot

Runs crimes, GTA, and organised crime in a loop so you can test the game while you sleep.

## Setup

1. **Backend running**  
   Start your API (e.g. `uvicorn` in the backend folder).

2. **Credentials**  
   Create a `.env` file in the **project root** (same folder as `package.json`) with:

   ```env
   EMAIL=your@email.com
   PASSWORD=yourpassword
   ```

   Or set `MAFIA_EMAIL` and `MAFIA_PASSWORD` instead.

   Optional:

   ```env
   BASE_URL=http://localhost:8000
   LOOP_SECONDS=30
   ```

   - `BASE_URL` – API base (default: `http://localhost:8000`).
   - `LOOP_SECONDS` – Seconds between each full run (default: 30).

## Run

From the project root:

```bash
npm run overnight
```

Or: `node scripts/run-overnight.js`

Stop with **Ctrl+C**.

## What it does

1. Logs in with your email/password.
2. Every `LOOP_SECONDS` seconds it:
   - **Crimes** – Commits every crime that is off cooldown.
   - **GTA** – One GTA attempt (first unlocked option) if global cooldown is over.
   - **Organised crime** – One heist (first job, you + 3 NPCs) if OC cooldown is over.
3. If the token expires, it logs in again and continues.
4. If you’re in jail, it skips crimes/GTA/OC until you’re out (no jail bust).

Logs are printed with timestamps so you can see what ran and any errors.
