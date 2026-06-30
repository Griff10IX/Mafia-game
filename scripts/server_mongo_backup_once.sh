#!/bin/bash
set -euo pipefail
cd /opt/mafia-app/backend
PY=../backend/venv/bin/python
if [ ! -x "$PY" ]; then PY=python3; fi
"$PY" << 'PY'
import os, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from dotenv import load_dotenv
load_dotenv(".env", override=True)
mongo_url = (os.environ.get("MONGO_URL") or "").strip()
db_name = (os.environ.get("DB_NAME") or "mafia").strip()
if not mongo_url:
    sys.exit("MONGO_URL missing")
p = urlparse(mongo_url)
uri = urlunparse((p.scheme, p.netloc, "/" + db_name.lstrip("/"), p.params, p.query, p.fragment))
ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
out = Path("../backups")
out.mkdir(parents=True, exist_ok=True)
archive = out / f"mongo-{db_name}-{ts}.archive.gz"
subprocess.run(["mongodump", "--uri", uri, "--archive", str(archive), "--gzip"], check=True)
print(f"DONE {archive} {archive.stat().st_size / 1024 / 1024:.2f} MB")
PY
