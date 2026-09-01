"""Girly colours, offensive names, lock Highlights + Schizophrenic. Never staff."""
from datetime import datetime, timezone

from _system_ai_prank_helpers import _pranks, _save_pranks, _staff, db, find_user, kick, lock, paint, post

TARGETS = [
    ("Highlights", "PinkBellend", "girly-multi", "barbie rainbow"),
    ("Schizophrenic", "BarbieMelt", "#FF10F0", "barbie"),
]


def rename(old, new):
    u = find_user(old)
    if not u or _staff(u):
        print("refuse rename", old)
        return None
    taken = db.users.find_one({"username": {"$regex": f"^{new}$", "$options": "i"}, "id": {"$ne": u["id"]}}, {"_id": 1})
    if taken:
        print("name taken", new)
        return None
    pranks = _pranks()
    uid = u["id"]
    meta = pranks.get(uid) or {}
    if not meta.get("username"):
        meta["username"] = u.get("username")
    if "prev" not in meta:
        meta["prev"] = (u.get("chat_name_color") or "").strip() or None
    meta["renamed_to"] = new
    pranks[uid] = meta
    _save_pranks(pranks)
    db.users.update_one({"id": uid}, {"$set": {"username": new}})
    db.game_chat_messages.update_many({"user_id": uid}, {"$set": {"username": new}})
    print("renamed", u.get("username"), "->", new)
    return new


post(
    "Fifteen minutes. Girly names. You get locked. I swear back. Staff stay. Mouth off and you stay pink and locked."
)

for old, new, color, label in TARGETS:
    paint(old, color, label)
    rename(old, new)
    lock(new if find_user(new) else old, minutes=15)
    kick(new if find_user(new) else old)

post("Highlights is PinkBellend. Schizophrenic is BarbieMelt. Locked. Pink. Logged out. That is the look.")
print("blast done", datetime.now(timezone.utc).isoformat())
