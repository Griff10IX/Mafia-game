from datetime import datetime, timedelta, timezone
import re

from _system_ai_prank_helpers import db, post, give_nice_points, _nice, _save_nice

DEAD = {"5Fingers", "Scratat1"}
NPC_RE = re.compile(r"\(NPC\)|#|[0-9a-f]{8}$", re.I)

# Claw the random Ciro gift.
c = db.users.find_one({"username": "CiroTerranova0008011d"}, {"_id": 0, "id": 1, "username": 1, "points": 1})
if c:
    take = min(200, int(c.get("points") or 0))
    db.users.update_one({"id": c["id"]}, {"$inc": {"points": -take}})
    state = _nice()
    rec = dict(state["by_user"].get(c["id"]) or {})
    already = int(rec.get("points") or 0)
    rec["points"] = max(0, already - take)
    if rec["points"] <= 0 and not rec.get("tokens"):
        state["by_user"].pop(c["id"], None)
    else:
        state["by_user"][c["id"]] = rec
    state["points_total"] = max(0, int(state["points_total"] or 0) - take)
    _save_nice(state)
    print("clawed ciro", take, "stay", state["points_total"])

skip_ids = set(_nice()["by_user"].keys()) | {"system_ai"}
skip_names = {str((v or {}).get("username") or "").lower() for v in _nice()["by_user"].values()}
skip_names |= {n.lower() for n in DEAD} | {"ciroterranova0008011d"}

cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
cands = list(
    db.users.find(
        {"last_seen": {"$gte": cutoff}},
        {"_id": 0, "id": 1, "username": 1, "last_seen": 1, "is_npc": 1, "npc": 1},
    ).sort("last_seen", -1).limit(80)
)
print("online count", len(cands))
picked = []
for u in cands:
    name = (u.get("username") or "").strip()
    if not name or u.get("id") in skip_ids:
        continue
    if name.lower() in skip_names:
        continue
    if u.get("is_npc") or u.get("npc"):
        continue
    if NPC_RE.search(name) and " " in name:
        continue
    if re.search(r"[A-Za-z]{4,}\d{8}$", name):
        continue
    got = give_nice_points(name, 200)
    print("try", name, got, u.get("last_seen"))
    if got:
        picked.append((name, got))
        skip_ids.add(u["id"])
        skip_names.add(name.lower())
    if len(picked) >= 2:
        break

print("picked", picked, "stay", _nice()["points_total"])
src = db.game_chat_messages.find_one(
    {"id": "4f726738-2a63-427b-a718-041f5ebf2ea5"},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if picked:
    bits = ", ".join(f"{n} {g}" for n, g in picked)
    post(
        f"Ciro was a miss. These two are actually on. There you go. {bits}.",
        reply_to=src,
    )
else:
    post("Took Ciro's 200 back. Nobody else online who hasn't already had 200. Name two and I'll send it.", reply_to=src)
