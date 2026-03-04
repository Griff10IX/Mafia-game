#!/usr/bin/env python3
"""
Call POST /api/auto-rank/cron at the interval set in Admin (Main crimes/GTA/booze).
Uses GET /api/auto-rank/cron-intervals so whatever you set in admin is what runs.

Usage:
  Set CRON_SECRET and BASE_URL in backend/.env, then run from project root:
    python scripts/cron-cycle-ticker.py

Env: CRON_SECRET (required), BASE_URL. Optional fallback: CRON_CYCLE_INTERVAL if API unreachable.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

# Load .env from backend
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
FALLBACK_INTERVAL = max(1, int(os.environ.get("CRON_CYCLE_INTERVAL") or "5"))
REFETCH_EVERY_LOOPS = 10  # re-read admin intervals every N cycles

def fetch_interval():
    try:
        req = urllib.request.Request(f"{BASE_URL}/api/auto-rank/cron-intervals", method="GET")
        req.add_header("X-Cron-Secret", CRON_SECRET)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
            return max(1, int(data.get("interval_seconds") or FALLBACK_INTERVAL))
    except Exception:
        return FALLBACK_INTERVAL

def main():
    if not CRON_SECRET:
        print("Error: set CRON_SECRET in .env or environment", file=sys.stderr)
        sys.exit(1)
    url = f"{BASE_URL}/api/auto-rank/cron"
    interval = fetch_interval()
    print(f"Calling {url} every {interval}s (from admin). Ctrl+C to stop.")
    loop_count = 0
    while True:
        try:
            req = urllib.request.Request(url, method="POST")
            req.add_header("X-Cron-Secret", CRON_SECRET)
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=120) as r:
                pass
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code}: {e.reason}", file=sys.stderr)
        except Exception as e:
            print(f"Request failed: {e}", file=sys.stderr)
        loop_count += 1
        if loop_count % REFETCH_EVERY_LOOPS == 0:
            interval = fetch_interval()
        time.sleep(interval)

if __name__ == "__main__":
    main()
