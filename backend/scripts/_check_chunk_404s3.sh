#!/bin/bash
set -u
cd /opt/mafia-app

echo "=== origin via --resolve ==="
curl -skI --resolve mafiawars.co.uk:443:127.0.0.1 https://mafiawars.co.uk/ | tr -d '\r' | head -20
echo "--- main ---"
MAIN=$(python3 -c 'import re,pathlib; h=pathlib.Path("build/index.html").read_text(); m=re.search(r"static/js/main\.[^\"]+\.js",h); print(m.group(0) if m else "")')
echo "MAIN=$MAIN"
curl -skI --resolve mafiawars.co.uk:443:127.0.0.1 "https://mafiawars.co.uk/$MAIN" | tr -d '\r' | head -15
echo "--- missing old chunk ---"
curl -skI --resolve mafiawars.co.uk:443:127.0.0.1 "https://mafiawars.co.uk/static/js/main.0a99151f.chunk.js" | tr -d '\r' | head -15
echo "body start:"
curl -sk --resolve mafiawars.co.uk:443:127.0.0.1 "https://mafiawars.co.uk/static/js/main.0a99151f.chunk.js" | head -c 160
echo
echo

echo "=== access log non-200 static since 21:40 ==="
sudo python3 <<'PY'
from collections import Counter
import re
status = Counter()
miss = Counter()
html_as_js = 0
with open("/var/log/nginx/access.log", "r", errors="ignore") as f:
    for line in f:
        if "03/Sep/2026:21:" not in line and "03/Sep/2026:22:" not in line:
            continue
        if "static/js/" not in line and "static/css/" not in line:
            continue
        m = re.search(r'"[A-Z]+ ([^ ]+) HTTP/[^"]*" (\d{3})', line)
        if not m:
            continue
        path, code = m.group(1).split("?", 1)[0], m.group(2)
        status[code] += 1
        if code != "200":
            miss[path] += 1
print("status:", status.most_common(20))
print("non-200 top:")
for p, c in miss.most_common(40):
    print(f"{c:5d} {p}")
PY

echo
echo "=== cf ray / under attack check from public ==="
curl -sI -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" https://mafiawars.co.uk/ | tr -d '\r' | head -25
