#!/usr/bin/env python3
"""Call POST .../world-cup/cron/auto-settle every 30 min. Header: X-Cron-Secret."""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    _env = Path(__file__).resolve().parent.parent / "backend" / ".env"
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
INTERVAL = max(60, int(os.environ.get("WORLD_CUP_SETTLE_INTERVAL") or "1800"))


def run_once():
    url = f"{BASE_URL}/api/world-cup/cron/auto-settle"
    req = urllib.request.Request(url, method="POST")
    req.add_header("X-Cron-Secret", CRON_SECRET)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode())
        print("OK:", data)
        return True


def main():
    if not CRON_SECRET:
        print("Error: set CRON_SECRET", file=sys.stderr)
        sys.exit(1)
    if "--once" in sys.argv:
        try:
            run_once()
            sys.exit(0)
        except Exception as e:
            print(f"Failed: {e}", file=sys.stderr)
            sys.exit(1)
    while True:
        try:
            run_once()
        except Exception as e:
            print(f"Failed: {e}", file=sys.stderr)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
