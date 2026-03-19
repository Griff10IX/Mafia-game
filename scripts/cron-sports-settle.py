#!/usr/bin/env python3
"""
Call POST /api/sports-betting/cron/auto-settle to auto-settle sports bets from Odds API scores. Runs every 30 min.

Usage:
  Set CRON_SECRET, BASE_URL, and THE_ODDS_API_KEY in backend/.env, then run from project root:
    python scripts/cron-sports-settle.py

  Or add to crontab (every 30 min):
    */30 * * * * cd /path/to/project && python scripts/cron-sports-settle.py

Env: CRON_SECRET (required), BASE_URL. Optional: SPORTS_SETTLE_INTERVAL (seconds, default 1800).
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
INTERVAL = max(60, int(os.environ.get("SPORTS_SETTLE_INTERVAL") or "1800"))


def run_once():
    """Call the auto-settle endpoint once. Returns True on success."""
    url = f"{BASE_URL}/api/sports-betting/cron/auto-settle"
    try:
        req = urllib.request.Request(url, method="POST")
        req.add_header("X-Cron-Secret", CRON_SECRET)
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read().decode())
            settled = data.get("settled", 0)
            print(f"OK: settled={settled}, skipped_no_match={data.get('skipped_no_match', 0)}, skipped_no_winner={data.get('skipped_no_winner', 0)}")
            return True
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.reason}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Request failed: {e}", file=sys.stderr)
        return False


def main():
    if not CRON_SECRET:
        print("Error: set CRON_SECRET in .env or environment", file=sys.stderr)
        sys.exit(1)
    once = "--once" in sys.argv or "-1" in sys.argv
    url = f"{BASE_URL}/api/sports-betting/cron/auto-settle"
    if once:
        print(f"Calling {url} once...")
        ok = run_once()
        sys.exit(0 if ok else 1)
    print(f"Calling {url} every {INTERVAL}s. Ctrl+C to stop.")
    while True:
        run_once()
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
