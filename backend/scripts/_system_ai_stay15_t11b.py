from _system_ai_prank_helpers import db, find_user

u = find_user("Thor")
print("id", u.get("id") if u else None)
print("username", u.get("username") if u else None)
if u:
    for k in sorted(u):
        if "skip" in k.lower() or "token" in k.lower() or "mission" in k.lower():
            print(k, u.get(k))
