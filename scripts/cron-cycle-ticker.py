#!/usr/bin/env python3
"""
Call POST /api/auto-rank/cron every 5 seconds. This is the main Auto Rank cycle:
crimes, GTA, booze, bust pass, OC. Run this when using AUTO_RANK_USE_CRON=1 (same interval as jail busts).

Usage:
  Set CRON_SECRET and BASE_URL, then run from project root or backend:
    python scripts/cron-cycle-ticker.py

  Or from backend dir (loads backend/.env):
    python ../scripts/cron-cycle-ticker.py

Env (in .env or export):
  CRON_SECRET  - same secret as your cron-bust ticker (required)
  BASE_URL     - e.g. http://localhost:8000 (default) or https://your-domain.com
  CRON_CYCLE_INTERVAL - seconds between calls (default 5)
"""
import os
import sys
import time
import urllib.request
import urllib.error

# Load .env from backend so CRON_SECRET is available
try:
    from pathlib import Path
    _script_dir = Path(__file__).resolve().parent
    _backend = _script_dir.parent / "backend"
    _env = _backend / ".env"
    if _env.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(_env)
        except ImportError:
            with open(_env) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, _, v = line.partition("=")
                        k, v = k.strip(), v.strip().strip('"').strip("'")
                        if k and v and k not in os.environ:
                            os.environ[k] = v
except Exception:
    pass

CRON_SECRET = (os.environ.get("CRON_SECRET") or "").strip()
BASE_URL = (os.environ.get("BASE_URL") or "http://localhost:8000").rstrip("/")
INTERVAL = max(1, int(os.environ.get("CRON_CYCLE_INTERVAL") or "5"))

def main():
    if not CRON_SECRET:
        print("Error: set CRON_SECRET in .env or environment", file=sys.stderr)
        sys.exit(1)
    url = f"{BASE_URL}/api/auto-rank/cron"
    print(f"Calling {url} every {INTERVAL} seconds (crimes/GTA/booze/OC). Ctrl+C to stop.")
    while True:
        try:
            req = urllib.request.Request(url, method="POST")
            req.add_header("X-Cron-Secret", CRON_SECRET)
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=120) as r:
                pass  # 200 = ok
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code}: {e.reason}", file=sys.stderr)
        except Exception as e:
            print(f"Request failed: {e}", file=sys.stderr)
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
