#!/bin/bash
set -u
cd /opt/mafia-app

echo "=== curl headers ==="
curl -sI https://mafiawars.co.uk/ | tr -d '\r'
echo "---"
MAIN=$(python3 -c "import re,pathlib; h=pathlib.Path('build/index.html').read_text(); m=re.search(r'static/js/main\.[^\"]+\.js',h); print(m.group(0) if m else '')")
echo "MAIN=$MAIN"
curl -sI "https://mafiawars.co.uk/$MAIN" | tr -d '\r'
echo "--- old main ---"
curl -sI "https://mafiawars.co.uk/static/js/main.0a99151f.chunk.js" | tr -d '\r' | head -8
echo

echo "=== nginx mafia site ==="
sed -n '1,120p' /etc/nginx/sites-enabled/mafia
echo

echo "=== chunk 404s since 21:40 (sudo grep) ==="
sudo awk '$4 >= "[03/Sep/2026:21:40:00" {
  if ($0 ~ /static\/(js|css)\/.+\.(js|css)/ && $0 ~ / 404 /) print
}' /var/log/nginx/access.log | tail -80
echo
echo "=== top missing chunk paths since 21:40 ==="
sudo awk '$4 >= "[03/Sep/2026:21:40:00" {
  if ($0 ~ /static\/(js|css)\// && $0 ~ / 404 /) {
    for (i=1;i<=NF;i++) if ($i ~ /^\/static\//) { print $i; break }
  }
}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -40
echo

echo "=== status codes for static since 21:40 ==="
sudo awk '$4 >= "[03/Sep/2026:21:40:00" && $0 ~ /static\/(js|css)\// {
  for (i=1;i<=NF;i++) if ($i ~ /^[0-9]{3}$/) { c[$i]++; break }
}
END { for (k in c) print c[k], k }' /var/log/nginx/access.log | sort -rn | head -20
echo

echo "=== build static js count + previous build remnants ==="
ls build/static/js | wc -l
ls -d build.prev build.old build.bak /opt/mafia-app/build.* 2>/dev/null
ls scripts/deploy-after-pull.sh
grep -nE 'build|rm |mv |static' scripts/deploy-after-pull.sh | head -60
