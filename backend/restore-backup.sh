#!/bin/bash
# ============================================================================
# MongoDB Backup Restoration Script
# ============================================================================
# Use this to restore your database from a backup
#
# Usage:
#   chmod +x restore-backup.sh
#   ./restore-backup.sh /path/to/backup_folder

set -e

if [ -z "$1" ]; then
    echo "❌ Error: No backup path provided"
    echo ""
    echo "Usage: ./restore-backup.sh /path/to/backup_folder"
    echo ""
    echo "Example:"
    echo "  ./restore-backup.sh ~/backups/backup_20260215_020000/"
    echo ""
    exit 1
fi

BACKUP_PATH="$1"

if [ ! -d "$BACKUP_PATH" ]; then
    echo "❌ Error: Backup folder not found: $BACKUP_PATH"
    exit 1
fi

echo "🗄️  MongoDB Backup Restoration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Backup path: $BACKUP_PATH"
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    exit 1
fi

# Extract MongoDB credentials from .env
MONGO_URL=$(grep "^MONGO_URL=" .env | cut -d'=' -f2 | tr -d '"')
DB_NAME=$(grep "^DB_NAME=" .env | cut -d'=' -f2 | tr -d '"')

if [[ $MONGO_URL == *"@"* ]]; then
    # Has authentication
    echo "📍 Using authenticated MongoDB connection"
    echo "⚠️  WARNING: This will OVERWRITE your current database: $DB_NAME"
    echo ""
    echo "Press ENTER to continue, or Ctrl+C to cancel..."
    read -r
    
    mongorestore --uri="$MONGO_URL" --drop --dir="$BACKUP_PATH/$DB_NAME"
else
    # No authentication (local dev)
    echo "📍 Using local MongoDB (no auth)"
    echo "⚠️  WARNING: This will OVERWRITE your current database: $DB_NAME"
    echo ""
    echo "Press ENTER to continue, or Ctrl+C to cancel..."
    read -r
    
    mongorestore --db="$DB_NAME" --drop "$BACKUP_PATH/$DB_NAME"
fi

echo ""
echo "✅ Backup restored successfully!"
echo ""
echo "🔄 Restart your backend service:"
echo "   sudo systemctl restart mafia-backend"
