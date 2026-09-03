from _system_ai_prank_helpers import db

name = "CiroTerranova0008011d"
u = db.users.find_one(
    {"username": name},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "is_bodyguard": 1,
        "is_npc": 1,
        "bodyguard_owner_id": 1,
        "points": 1,
    },
)
print("user", u)
oid = (u or {}).get("bodyguard_owner_id")
if oid:
    o = db.users.find_one({"id": oid}, {"_id": 0, "id": 1, "username": 1})
    print("owner", o)
bg = db.bodyguards.find_one(
    {"$or": [{"bodyguard_user_id": (u or {}).get("id")}, {"robot_name": name}]},
    {"_id": 0, "user_id": 1, "slot_number": 1, "is_robot": 1, "robot_name": 1, "bodyguard_user_id": 1, "hired_at": 1},
)
print("bg row", bg)
if bg and bg.get("user_id"):
    o2 = db.users.find_one({"id": bg["user_id"]}, {"_id": 0, "id": 1, "username": 1})
    print("bg owner", o2)
    slots = list(
        db.bodyguards.find(
            {"user_id": bg["user_id"]},
            {"_id": 0, "slot_number": 1, "is_robot": 1, "robot_name": 1, "bodyguard_user_id": 1},
        ).sort("slot_number", 1)
    )
    print("all slots")
    for s in slots:
        ru = None
        if s.get("bodyguard_user_id"):
            ru = db.users.find_one({"id": s["bodyguard_user_id"]}, {"_id": 0, "username": 1})
        print(" slot", s.get("slot_number"), "robot", s.get("is_robot"), "name", s.get("robot_name") or (ru or {}).get("username"))
