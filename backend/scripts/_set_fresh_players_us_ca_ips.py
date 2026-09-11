"""Set VinceConti37 to a US IP; patch fresh-player script for Canada IP next."""
import os
import random
import re
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

US_IP = f"73.162.{random.randint(10, 240)}.{random.randint(10, 250)}"
CA_IP_LINE = (
    '    # Soft Canada-looking IP (Bell/Rogers-ish)\n'
    '    reg_ip = f"99.232.{random.randint(10, 240)}.{random.randint(10, 250)}"\n'
)

u = db.users.find_one({"username": "VinceConti37"}, {"_id": 0, "id": 1, "username": 1, "registration_ip": 1})
print("before", u)
if u:
    hist = {
        "at": None,  # keep existing if present
        "ip": US_IP,
        "device_type": "desktop",
        "ua_short": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0",
        "source": "register",
    }
    # Pull current created_at for hist
    full = db.users.find_one({"id": u["id"]}, {"_id": 0, "created_at": 1, "login_history": 1})
    hist["at"] = (full or {}).get("created_at")
    old_hist = list((full or {}).get("login_history") or [])
    if old_hist:
        old_hist[0] = {**old_hist[0], "ip": US_IP}
        new_hist = old_hist
    else:
        new_hist = [hist]
    db.users.update_one(
        {"id": u["id"]},
        {"$set": {"registration_ip": US_IP, "login_ips": [US_IP], "login_history": new_hist}},
    )
    after = db.users.find_one({"id": u["id"]}, {"_id": 0, "username": 1, "registration_ip": 1, "login_ips": 1})
    print("after_us", after)

# Patch create script so the next (player 2) gets a Canada IP
path = "/opt/mafia-app/backend/scripts/_mk_fresh_player_ar.py"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()
src2, n = re.subn(
    r'    # Soft UK-ish looking IP \(not GhostFace / server\)\n    reg_ip = f"82\.132\.\{random\.randint\(200, 245\)\}\.\{random\.randint\(10, 250\)\}"',
    CA_IP_LINE.rstrip("\n"),
    src,
    count=1,
)
if n != 1:
    # fallback: replace any 82.132 line
    src2, n = re.subn(
        r'reg_ip = f"82\.132\.\{random\.randint\([^)]+\)\}\.\{random\.randint\([^)]+\)\}"',
        'reg_ip = f"99.232.{random.randint(10, 240)}.{random.randint(10, 250)}"',
        src,
        count=1,
    )
with open(path, "w", encoding="utf-8") as f:
    f.write(src2)
print("script_patched", n)
# Confirm scheduled job still sleeping
import subprocess
out = subprocess.check_output(["ps", "aux"], text=True)
for line in out.splitlines():
    if "mk_fresh_player" in line or ("sleep 300" in line and "python" in line):
        print("proc", line[:160])
