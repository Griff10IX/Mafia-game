#!/bin/bash
cd /opt/mafia-app
echo "HEAD=$(git rev-parse --short HEAD)"
ls -la build/static/js/main.*.js
echo "prev main kept?"
ls -la build/static/js/main.d3971a6b.chunk.js 2>&1 || true
echo "missing chunk status:"
curl -skI --resolve mafiawars.co.uk:443:127.0.0.1 https://mafiawars.co.uk/static/js/nope.js | tr -d '\r' | head -8
echo "sites-enabled:"
ls -la /etc/nginx/sites-enabled/
echo "deploy log mention:"
grep -n "Kept previous" /opt/mafia-app/../.. 2>/dev/null || true
# check js count growth
echo "static js count: $(ls build/static/js | wc -l)"
