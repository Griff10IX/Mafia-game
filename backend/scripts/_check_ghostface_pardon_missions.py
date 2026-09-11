"""Inspect GhostFace pardon + mission grant state on live."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": {"$regex": "^ghostface$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "has_commissioners_pardon": 1,
        "pardon_auto_skip_mission_ids": 1,
        "pardon_near_finish_mission_id": 1,
        "mission_completions": 1,
        "mission_skip_tokens": 1,
    },
)
comps = u.get("mission_completions") or []
print("username", u.get("username"))
print("has_pardon", u.get("has_commissioners_pardon"))
print("completed_count", len(comps))
print("near_finish_mission", u.get("pardon_near_finish_mission_id"))
skip = u.get("pardon_auto_skip_mission_ids") or []
print("skip_count", len(skip))
print("skip_first_10", skip[:10])
print("skip_tokens", u.get("mission_skip_tokens"))

p = db.commissioners_pardon_ownership.find_one({}, {"_id": 0})
print("pardon_doc", p)

# current open = first incomplete in ladder order if we can import
import sys
sys.path.insert(0, "/opt/mafia-app/backend")
try:
    from routers.account.missions import _current_open_mission, _user_completed_mission_ids, _check_mission_requirements
    mid_set = _user_completed_mission_ids(u)
    open_m = _current_open_mission(u)
    print("open_mission", (open_m or {}).get("id"), (open_m or {}).get("name"))
    if open_m:
        met, prog = _check_mission_requirements(u, open_m)
        print("open_met", met, "progress", prog)
        print("open_in_skip", open_m["id"] in set(skip))
except Exception as e:
    print("import_err", type(e).__name__, e)
