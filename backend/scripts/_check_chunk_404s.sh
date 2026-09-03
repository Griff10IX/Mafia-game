#!/bin/bash
set -u
cd /opt/mafia-app || exit 1

echo "=== HEAD / build ==="
git rev-parse --short HEAD
ls -la build/index.html build/static/js/main*.js 2>/dev/null | head -5
echo

echo "=== index.html script/css refs ==="
python3 - <<'PY'
from pathlib import Path
import re
html = Path("build/index.html").read_text(encoding="utf-8", errors="replace")
refs = re.findall(r'(?:src|href)="(/?static/[^"]+)"', html)
for r in refs:
    p = r.lstrip("/")
    ok = Path("build", p).is_file()
    print(("ok" if ok else "MISSING"), r)
print("total refs", len(refs))
PY
echo

echo "=== nginx log files ==="
ls -la /var/log/nginx/ 2>/dev/null | head -30
echo

echo "=== recent 404 static js/css ==="
ACCESS=""
for f in /var/log/nginx/access.log /var/log/nginx/mafiawars.access.log /var/log/nginx/mafia_access.log; do
  if [ -f "$f" ]; then ACCESS="$f"; break; fi
done
if [ -n "$ACCESS" ]; then
  echo "using $ACCESS"
  grep -E 'static/(js|css)/' "$ACCESS" | grep ' 404 ' | tail -50
  echo "--- 404 counts (last 5000 static lines) ---"
  grep -E 'static/(js|css)/' "$ACCESS" | tail -5000 | awk '{print $9}' | sort | uniq -c | sort -rn | head -20
else
  echo "no access log found"
  find /var/log/nginx -type f 2>/dev/null | head -20
fi
echo

echo "=== nginx error tail ==="
if [ -f /var/log/nginx/error.log ]; then tail -n 50 /var/log/nginx/error.log; fi
echo

echo "=== curl headers index + main chunk ==="
curl -sI https://mafiawars.co.uk/ | tr -d '\r' | grep -iE 'HTTP/|cache-control|etag|last-modified|age|expires|cf-|x-cache|content-type'
MAIN=$(python3 - <<'PY'
from pathlib import Path
import re
html = Path("build/index.html").read_text(encoding="utf-8", errors="replace")
m = re.search(r'static/js/main\.[^"]+\.js', html)
print(m.group(0) if m else "")
PY
)
echo "MAIN=$MAIN"
if [ -n "$MAIN" ]; then
  curl -sI "https://mafiawars.co.uk/$MAIN" | tr -d '\r' | grep -iE 'HTTP/|cache-control|etag|content-type|age|expires'
fi
echo

echo "=== sample old chunk 404 test (previous main hash if any) ==="
# Try a known previous hash from earlier deploy
curl -sI "https://mafiawars.co.uk/static/js/main.0a99151f.chunk.js" | tr -d '\r' | head -5
echo

echo "=== nginx config snippets ==="
grep -RInE 'root |Cache-Control|expires|location |try_files' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | head -100
echo

echo "=== backend journal last 80 (chunk related?) ==="
journalctl -u mafia-backend -n 80 --no-pager 2>/dev/null | tail -80
