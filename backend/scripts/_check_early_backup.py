"""Check earlier backup for original cash amounts."""
import json

# Check the earliest backup
with open("/opt/mafia-app/backups/zwischenzug_ban_backup_20260904_010857.json") as f:
    d = json.load(f)

print("=== ZWISCHENZUG WEALTH (earliest backup 01:08:57) ===")
print(f"Cash (on hand): ${d.get('cash', 0):,}")
print(f"Swiss Balance: ${d.get('swiss_balance', 0):,}")
print(f"Crypto Balance: ${d.get('crypto_balance', 0):,}")
print(f"Money field: ${d.get('money', 0):,}")
print(f"Points: {d.get('points', 0):,}")
print(f"\nTotal liquid: ${d.get('cash', 0) + d.get('swiss_balance', 0) + d.get('crypto_balance', 0):,}")
