from _system_ai_prank_helpers import db

OID = "4171d822-7eea-44e5-8d0c-be8f90d9e5e7"
CID = "0008011d-a4f3-49d6-9f74-95790d73d7f6"

print("bodyguards for Chingy")
for b in db.bodyguards.find({"user_id": OID}, {"_id": 0}).sort("slot_number", 1):
    print(b)

print("users owned")
for u in db.users.find(
    {"bodyguard_owner_id": OID},
    {"_id": 0, "id": 1, "username": 1, "is_npc": 1, "is_bodyguard": 1},
):
    print(u)

print("bodyguards mentioning ciro id")
for b in db.bodyguards.find(
    {"$or": [{"bodyguard_user_id": CID}, {"id": CID}, {"npc_id": CID}]},
    {"_id": 0},
):
    print(b)

print("sample bodyguard keys")
s = db.bodyguards.find_one({"user_id": OID}, {"_id": 0})
print(s)
print("count", db.bodyguards.count_documents({"user_id": OID}))
