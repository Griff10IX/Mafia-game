from dotenv import load_dotenv
import os
from pprint import pprint
from collections import Counter
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

VID = "a1fa3bcc-cb04-4b79-a5ee-3e1fc2bb9eb5"
VIP = "82.132.228.82"

u = db.users.find_one({"id": VID}, {"_id": 0})
print("=== V full relevant ===")
keys = sorted(u.keys())
for k in ("username","email","id","is_dead","dead_at","health","points","rank","cash","created_at","last_seen","registration_ip","last_login_ip","known_ips","device_ids","fingerprint","killed_by_username","killed_by_id","death_reason","city","state"):
    if k in u:
        print(f"  {k}: {u.get(k)}")
# dump any kill-related
for k,v in u.items():
    if "kill" in k.lower() or "dead" in k.lower() or "ip" in k.lower() or "device" in k.lower():
        print(f"  *{k}: {v}")

print("\n=== kill / death docs about V ===")
for coll in db.list_collection_names():
    if any(x in coll.lower() for x in ("kill","death","attack","homicide","murder")):
        q = {"$or":[
            {"victim_id": VID},{"target_id": VID},{"defender_id": VID},
            {"victim_username":"V"},{"target_username":"V"},
            {"username":"V"},
        ]}
        n = db[coll].count_documents(q)
        if n:
            print(f"\n{coll}: {n}")
            for d in db[coll].find(q, {"_id":0}).sort([("created_at",-1),("at",-1),("timestamp",-1)]).limit(5):
                # slim
                slim = {k:d.get(k) for k in d if k in (
                    "attacker_id","attacker_username","killer_id","killer_username","victim_id","victim_username",
                    "target_id","target_username","result","status","created_at","at","timestamp","success",
                    "attacker_ip","ip","client_ip","damage","type"
                ) or "ip" in k.lower() or "user" in k.lower() or "time" in k.lower() or "result" in k.lower()}
                pprint(slim)

print("\n=== ALL accounts sharing reg/last IP", VIP, "===")
ip_q = {"$or":[
    {"registration_ip": VIP},
    {"last_login_ip": VIP},
    {"known_ips": VIP},
]}
for o in db.users.find(ip_q, {"_id":0,"username":1,"id":1,"email":1,"is_dead":1,"health":1,"created_at":1,"last_seen":1,"registration_ip":1,"last_login_ip":1,"points":1,"is_banned":1}).sort("created_at",1):
    print(o)

# also login logs
print("\n=== login_logs / sessions for this IP ===")
for coll in ("login_logs","user_logins","sessions","auth_logs","ip_logs"):
    if coll not in db.list_collection_names():
        continue
    n = db[coll].count_documents({"$or":[{"ip":VIP},{"client_ip":VIP},{"login_ip":VIP},{"remote_ip":VIP}]})
    print(coll, n)
    for d in db[coll].find({"$or":[{"ip":VIP},{"client_ip":VIP},{"login_ip":VIP},{"remote_ip":VIP}]},{"_id":0}).limit(15):
        pprint({k:d.get(k) for k in list(d)[:20]})
