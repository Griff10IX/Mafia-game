from datetime import datetime, timedelta, timezone

from _system_ai_prank_helpers import (
    db, post, find_user, give_nice_points, _nice, _save_nice,
)

src = db.game_chat_messages.find_one(
    {"id": "4f726738-2a63-427b-a718-041f5ebf2ea5"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)

dead = ["5Fingers", "Scratat1"]
clawed = []
for name in dead:
    u = db.users.find_one(
        {"username": {"$regex": f"^{name}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "points": 1},
    )
    if not u:
        print("missing", name)
        continue
    have = int(u.get("points") or 0)
    take = min(200, have)
    db.users.update_one({"id": u["id"]}, {"$inc": {"points": -take}})
    clawed.append((u.get("username"), take, u["id"]))
    print("clawed", u.get("username"), take, "had", have)

state = _nice()
for _n, take, uid in clawed:
    rec = dict(state["by_user"].get(uid) or {})
    already = int(rec.get("points") or 0)
    rec["points"] = max(0, already - take)
    if rec["points"] <= 0 and not rec.get("tokens"):
        state["by_user"].pop(uid, None)
    else:
        state["by_user"][uid] = rec
    state["points_total"] = max(0, int(state["points_total"] or 0) - take)
_save_nice(state)
print("tracker stay", _nice()["points_total"], "by_user", len(_nice()["by_user"]))

already_ids = set(_nice()["by_user"].keys())
already_ids.add("system_ai")
already_ids.add("36425cb4-3755-4669-b4b5-5d86345991d0")  # GhostFace already had 200

# People in chat recently, plus anyone with a fresh last_active.
since = datetime.now(timezone.utc) - timedelta(minutes=45)
chat_ids = []
for m in db.game_chat_messages.find(
    {"channel": "global", "created_at": {"$gte": since.isoformat()}},
    {"user_id": 1, "username": 1},
).sort("created_at", -1):
    uid = m.get("user_id")
    if uid and uid not in already_ids and uid not in chat_ids:
        chat_ids.append(uid)

sample = db.users.find_one({"username": "Highlights"}, {"_id": 0})
print("user keys", sorted((sample or {}).keys())[:40])

online = []
for uid in chat_ids:
    u = db.users.find_one(
        {"id": uid},
        {"_id": 0, "id": 1, "username": 1, "last_active": 1, "last_seen": 1, "online": 1, "is_online": 1},
    )
    if u:
        online.append(u)
        print("chat recent", u.get("username"), u.get("last_active") or u.get("last_seen") or u.get("online") or u.get("is_online"))

# If chat-recent isn't enough, pick other recently active accounts not already gifted.
if len(online) < 2:
    extra = list(
        db.users.find(
            {"id": {"$nin": list(already_ids) + [u["id"] for u in online]}},
            {"_id": 0, "id": 1, "username": 1, "last_active": 1, "last_seen": 1},
        ).sort("last_active", -1).limit(10)
    )
    print("extra last_active", [(e.get("username"), e.get("last_active")) for e in extra])
    online.extend(extra)

picked = []
for u in online:
    if len(picked) >= 2:
        break
    if not u or not u.get("username") or u.get("id") in already_ids:
        continue
    got = give_nice_points(u["username"], 200)
    print("gift", u.get("username"), got)
    if got:
        picked.append((u.get("username"), got))

print("picked", picked)
post(
    "Yeah. Dumb. 5Fingers and Scratat1 are dead. Took the 200 off them. "
    "Going to people actually on.",
    reply_to=src,
)
if picked:
    bits = ", ".join(f"{n} {g}" for n, g in picked)
    post(f"There you go. {bits}. Don't tell everyone or I'll run out.")
else:
    post("Couldn't find two online who hadn't already had 200. Say names if you want them on someone.")
