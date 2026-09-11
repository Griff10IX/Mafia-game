"""Purge Cloudflare cache."""
import os
import requests
from dotenv import load_dotenv

load_dotenv("/opt/mafia-app/backend/.env")

zone_id = os.environ.get("CF_ZONE_ID", "")
token = os.environ.get("CF_API_TOKEN", "")

if not zone_id or not token:
    print("CF_ZONE_ID or CF_API_TOKEN not set")
    exit(1)

print(f"Purging cache for zone {zone_id[:8]}...")
resp = requests.post(
    f"https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json={"purge_everything": True},
    timeout=30,
)
print(resp.status_code, resp.json())
