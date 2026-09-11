from dotenv import load_dotenv
import os
from pprint import pprint
from collections import Counter
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

VID = "a1fa3bcc-cb04-4b79-a5ee-3e1fc2bb9eb5"
SID = "828d4094-7095-4007-bb4e-9d8c25c7bc8f"  # Schizophrenic
KID = "335f19a3-2722-4b95-99ba-1ea046a2462e"  # Kill
VIP = "82.132.228.82"
SIP = "82.132.220.9"

def dump_user(uid, label):
    u = db.users.find_one({"id": uid}, {"_id":0})
    print(f"\n=== {label} ===")
    for k in ("username","email","id","is_dead","dead_at","health","points","rank","created_at","last_seen",
              "registration_ip","last_login_ip","last_request_ip","login_ips","known_ips",
              "family_id","family_name","total_kills","cash","is_banned"):
        if u and k in u:
            print(f"  {k}: {u.get(k)}")
    return u

v = dump_user(VID, "V")
s = dump_user(SID, "Schizophrenic")
k = dump_user(KID, "Kill")

print("\n=== accounts on Schizophrenic IPs ===")
s_ips = set()
for x in [s.get("registration_ip"), s.get("last_login_ip"), s.get("last_request_ip")]:
    if x: s_ips.add(x)
for x in (s.get("login_ips") or []):
    s_ips.add(x)
print("schizo ips:", sorted(s_ips))
for ip in sorted(s_ips):
    if not ip: continue
    hits = list(db.users.find({"$or":[{"registration_ip":ip},{"last_login_ip":ip},{"login_ips":ip},{"last_request_ip":ip}]},
        {"_id":0,"username":1,"email":1,"is_dead":1,"points":1,"created_at":1,"registration_ip":1,"last_request_ip":1}).limit(30))
    print(f"\nIP {ip} -> {len(hits)} accounts")
    for h in hits:
        print(" ", h)

print("\n=== email near-match olivergroves ===")
for u in db.users.find({"email":{"$regex":"olivergroves","$options":"i"}},
    {"_id":0,"username":1,"email":1,"is_dead":1,"points":1,"created_at":1,"registration_ip":1,"last_request_ip":1,"login_ips":1}):
    pprint(u)

print("\n=== Schizophrenic attack audits recent (IPs) ===")
ips = Counter()
for d in db.attack_client_audit.find({"user_id": SID}, {"client_ip":1,"created_at":1,"target_username":1}).sort("created_at",-1).limit(40):
    ips[d.get("client_ip")] += 1
    if d.get("target_username") == "V" or (d.get("created_at") and str(d.get("created_at")) >= "2026-09-06"):
        print(d.get("created_at"), d.get("client_ip"), "->", d.get("target_username"))
print("schizo IP counts (40 recent audits):", ips.most_common(10))

print("\n=== V attack audits ===")
for d in db.attack_client_audit.find({"user_id": VID}, {"client_ip":1,"created_at":1,"target_username":1}).sort("created_at",-1).limit(20):
    print(d.get("created_at"), d.get("client_ip"), "->", d.get("target_username"))

print("\n=== Kill attack audits / logins ===")
for d in db.attack_client_audit.find({"user_id": KID}, {"client_ip":1,"created_at":1,"target_username":1}).sort("created_at",-1).limit(15):
    print(d.get("created_at"), d.get("client_ip"), "->", d.get("target_username"))

# prefix check: anyone else on 82.132.228.*
print("\n=== other users registration_ip 82.132.228.* ===")
for u in db.users.find({"registration_ip":{"$regex":"^82\\.132\\.228\\."}},
    {"_id":0,"username":1,"email":1,"is_dead":1,"points":1,"created_at":1,"registration_ip":1}).limit(40):
    print(u)

print("\n=== same /24 as kill attack IP 82.132.220.* with V or Kill emails? ===")
for u in db.users.find({"$or":[{"registration_ip":{"$regex":"^82\\.132\\.220\\."}},{"last_request_ip":{"$regex":"^82\\.132\\.220\\."}}]},
    {"_id":0,"username":1,"email":1,"is_dead":1,"points":1,"registration_ip":1,"last_request_ip":1}).limit(40):
    print(u)
