#!/bin/bash
# Show current MongoDB pool usage from this droplet's perspective and the
# cluster's perspective. Run on the production server: ./scripts/mongo-pool-usage.sh
ENV_FILE=/opt/mafia-app/backend/.env
MONGO_URL=$(grep -E '^MONGO_URL=' "$ENV_FILE" | head -n1 | sed -E 's/^MONGO_URL=//; s/^"//; s/"$//')
MAX_POOL=$(grep -E '^MONGO_MAX_POOL_SIZE=' "$ENV_FILE" | head -n1 | sed -E 's/^MONGO_MAX_POOL_SIZE=//; s/^"//; s/"$//')
WORKERS=$(systemctl show mafia-backend -p Environment 2>/dev/null | grep -oE 'WORKERS=[0-9]+' | head -n1 | cut -d= -f2)
[ -z "$MAX_POOL" ] && MAX_POOL=25
[ -z "$WORKERS" ] && WORKERS="(unknown — check ExecStart in systemctl cat mafia-backend)"

echo "==============================================="
echo " MongoDB pool usage"
echo " Configured maxPoolSize per worker: $MAX_POOL"
echo " Worker processes (env hint): $WORKERS"
echo "==============================================="

LOCAL_CONNS=$(ss -ant | grep -c ':27017')
ESTABLISHED=$(ss -ant state established | grep -c ':27017')
echo
echo "[A] TCP connections from this backend host to Mongo (port 27017): $LOCAL_CONNS total ($ESTABLISHED established)"
echo "    (This IS your live pool usage from this app's perspective.)"

echo
echo "[B] Cluster-side serverStatus().connections (all clients to the cluster):"
if command -v mongosh >/dev/null 2>&1; then
    mongosh "$MONGO_URL" --quiet --eval 'printjson(db.serverStatus().connections)' || echo "    (mongosh failed)"
else
    echo "    (mongosh not installed)"
fi

echo
echo "Tip: live watch the pool usage — watch -n 1 \"ss -ant | grep -c :27017\""
