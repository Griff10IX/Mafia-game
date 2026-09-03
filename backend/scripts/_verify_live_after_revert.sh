#!/bin/bash
cd /opt/mafia-app || exit 1
echo "LIVE_HEAD=$(git rev-parse --short HEAD)"
echo
echo "=== index.html asset refs ==="
python3 - <<'PY'
import re
from pathlib import Path
html = Path("build/index.html").read_text(encoding="utf-8", errors="replace")
refs = sorted(set(re.findall(r'(?:src|href)="(/static/[^"]+)"', html)))
for r in refs:
    p = Path("build", r.lstrip("/"))
    print(("ok     " if p.is_file() else "MISSING"), r)
print("total", len(refs))
PY
echo
echo "=== deep link /kill/attack ==="
curl -skI --resolve mafiawars.co.uk:443:127.0.0.1 https://mafiawars.co.uk/kill/attack | head -4
echo "=== missing chunk returns 404 ==="
curl -skI --resolve mafiawars.co.uk:443:127.0.0.1 https://mafiawars.co.uk/static/js/nope.chunk.js | head -3
echo
echo "=== ErrorBoundary behaviour in shipped bundle ==="
grep -o "Loading new version" build/static/js/main.*.chunk.js | head -2
grep -o "Could not load this page" build/static/js/main.*.chunk.js | head -2
echo
echo "=== kill search timers ==="
backend/venv/bin/python - <<'PY'
import asyncio, datetime
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient

env = {}
for line in Path("backend/.env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")

async def main():
    db = AsyncIOMotorClient(env["MONGO_URL"])[env["DB_NAME"]]
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    total = await db.attacks.count_documents({"status": "searching"})
    waiting = await db.attacks.count_documents({"status": "searching", "found_at": {"$gt": now}})
    print("searching_total", total, "still_waiting", waiting)

asyncio.run(main())
PY
