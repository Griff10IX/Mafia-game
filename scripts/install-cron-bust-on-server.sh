#!/bin/bash
# Run this ON THE SERVER from /opt/mafia-app to create scripts + systemd unit
# (Or copy the blocks below and run by hand.)

set -e
PROJECT=/opt/mafia-app
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

systemctl daemon-reload
systemctl enable cron-bust-ticker
systemctl start cron-bust-ticker
echo "Done. Check: systemctl status cron-bust-ticker"
systemctl status cron-bust-ticker
