"""Preview Zwischenzug GP fields from backup."""
import json
with open("/opt/mafia-app/backups/zwischenzug_ban_backup_20260904_010940.json") as f:
    b = json.load(f)
for k in sorted(b):
    if "rank_xp" in k or "game_pass" in k:
        print(f"{k}: {b.get(k)}")
