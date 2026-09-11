"""Check cash from Zwischenzug backup."""
import json

with open("/opt/mafia-app/backups/zwischenzug_ban_backup_20260904_010940.json") as f:
    d = json.load(f)

print("=== ZWISCHENZUG WEALTH AT TIME OF BAN ===")
print(f"Cash (on hand): ${d.get('cash', 0):,}")
print(f"Swiss Balance: ${d.get('swiss_balance', 0):,}")
print(f"Crypto Balance: ${d.get('crypto_balance', 0):,}")
print(f"Money field: ${d.get('money', 0):,}")
print(f"\nTotal liquid: ${d.get('cash', 0) + d.get('swiss_balance', 0) + d.get('crypto_balance', 0):,}")
