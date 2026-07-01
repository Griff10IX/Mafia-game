#!/usr/bin/env python3
"""
Call POST /api/attack/cron/robot-bg-auto-search every 15 minutes.

Usage:
  Set CRON_SECRET and BASE_URL in backend/.env, then run from project root:
    python scripts/cron-robot-bg-auto-search.py

Env: CRON_SECRET (required), BASE_URL. Optional: ROBOT_BG_AUTO_SEARCH_CRON_INTERVAL (seconds, default 900).
"""
import os
import sys
import time
import urllib.request
import urllib.error

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
INTERVAL = max(60, int(os.environ.get("ROBOT_BG_AUTO_SEARCH_CRON_INTERVAL") or "900"))


def call_cron():
    url = f"{BASE_URL}/api/attack/cron/robot-bg-auto-search"
    req = urllib.request.Request(url, method="POST", data=b"")
    req.add_header("X-Cron-Secret", CRON_SECRET)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8", errors="replace")


def main():
    if not CRON_SECRET:
        print("CRON_SECRET is not set", file=sys.stderr)
        sys.exit(1)
    print(f"Robot BG auto-search cron → {BASE_URL} every {INTERVAL}s")
    while True:
        try:
            body = call_cron()
            print(body[:500] if body else "ok")
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:300]}", file=sys.stderr)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
