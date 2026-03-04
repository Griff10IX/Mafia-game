#!/bin/bash
# Run this ON THE SERVER to create cron-bust + main-cycle ticker scripts and systemd units.
# You need BOTH: cron-bust every 5s (jail busts) and main cycle every 5s (crimes, GTA, booze, OC).
# (Or copy the blocks below and run by hand.)
#
# Usage (from project root /opt/mafia-app):
#   PROJECT=/opt/mafia-app ./scripts/install-cron-bust-on-server.sh
# If "Permission denied", run with bash:
#   PROJECT=/opt/mafia-app bash /opt/mafia-app/scripts/install-cron-bust-on-server.sh
# Default PROJECT=/opt/mafia-app if not set.

set -e
PROJECT="${PROJECT:-/opt/mafia-app}"
mkdir -p "$PROJECT/scripts"

# 1. Create the ticker script
cat > "$PROJECT/scripts/cron-bust-ticker.py" << 'PYEOF'
#!/usr/bin/env python3
"""
Call POST /api/auto-rank/cron-bust every 5 seconds. Run when AUTO_RANK_USE_CRON=1.
Reads CRON_SECRET and BASE_URL from backend/.env.
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

def main():
    if not CRON_SECRET:
        print("Error: set CRON_SECRET in .env or environment", file=sys.stderr)
        sys.exit(1)
    url = f"{BASE_URL}/api/auto-rank/cron-bust"
    print(f"Calling {url} every 5 seconds (Ctrl+C to stop)")
    while True:
        try:
            req = urllib.request.Request(url, method="POST")
            req.add_header("X-Cron-Secret", CRON_SECRET)
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=30) as r:
                pass
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code}: {e.reason}", file=sys.stderr)
        except Exception as e:
            print(f"Request failed: {e}", file=sys.stderr)
        time.sleep(5)

if __name__ == "__main__":
    main()
PYEOF

chmod +x "$PROJECT/scripts/cron-bust-ticker.py"

# 2. Create systemd unit
cat > /etc/systemd/system/cron-bust-ticker.service << EOF
[Unit]
Description=Auto Rank jail bust ticker (every 5s)
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT
ExecStart=/usr/bin/python3 $PROJECT/scripts/cron-bust-ticker.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 3. Create the main cycle ticker script (5s — crimes, GTA, booze, OC, same as jail busts)
cat > "$PROJECT/scripts/cron-cycle-ticker.py" << 'CYCLEPYEOF'
#!/usr/bin/env python3
"""
Call POST /api/auto-rank/cron every 5 seconds. Main Auto Rank cycle: crimes, GTA, booze, OC.
Run when AUTO_RANK_USE_CRON=1 (same interval as jail busts). Reads CRON_SECRET and BASE_URL from backend/.env.
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
                pass
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code}: {e.reason}", file=sys.stderr)
        except Exception as e:
            print(f"Request failed: {e}", file=sys.stderr)
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
CYCLEPYEOF

chmod +x "$PROJECT/scripts/cron-cycle-ticker.py"

# 4. Create systemd unit for main cycle (5s)
cat > /etc/systemd/system/cron-cycle-ticker.service << EOF
[Unit]
Description=Auto Rank main cycle ticker (crimes/GTA/booze/OC every 5s)
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT
ExecStart=/usr/bin/python3 $PROJECT/scripts/cron-cycle-ticker.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 5. Reload, enable, start both services
systemctl daemon-reload
systemctl enable cron-bust-ticker cron-cycle-ticker
systemctl start cron-bust-ticker cron-cycle-ticker
echo ""
echo "Done. Both tickers installed and started:"
echo "  - cron-bust-ticker (every 5s) — jail busts"
echo "  - cron-cycle-ticker (every 5s) — crimes, GTA, booze, OC"
echo ""
systemctl status cron-bust-ticker --no-pager
echo ""
systemctl status cron-cycle-ticker --no-pager
