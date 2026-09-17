"""Gift Users Online (online + idle) free WoF spins + loot pieces; System AI inbox.

Also always includes GhostFace even if offline.

Usage:
    python _system_ai_update_pause_online_gift.py            # dry run
    python _system_ai_update_pause_online_gift.py --apply
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

APPLY = "--apply" in sys.argv

LOOT = 500
SPINS = 5
ORIGIN = "system_ai_update_pause_gift_2026_09_14"
TITLE = "A few quiet days"
AVATAR = "/images/system-ai-profile.jpg?v=8"
ONLINE_LAST_SEEN_MINUTES = 5
IDLE_LAST_SEEN_MAX_MINUTES = 10
GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"

ADMIN_EMAILS = {e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()}

now = datetime.now(timezone.utc)
now_iso = now.isoformat()
online_cutoff = now - timedelta(minutes=ONLINE_LAST_SEEN_MINUTES)
idle_cutoff = now - timedelta(minutes=IDLE_LAST_SEEN_MAX_MINUTES)
idle_cutoff_iso = idle_cutoff.isoformat()


def _parse_iso(raw):
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _roster_status(user) -> str:
    """Match /users/online status: online | idle | offline."""
    is_admin = (user.get("email") or "").strip().lower() in ADMIN_EMAILS
    is_mod = bool(user.get("is_moderator"))
    status = "offline"
    ls_dt = _parse_iso(user.get("last_seen"))
    if ls_dt:
        if ls_dt >= online_cutoff:
            status = "online"
        elif ls_dt >= idle_cutoff:
            status = "idle"
    forced_until = _parse_iso(user.get("forced_online_until"))
    if forced_until and status != "online" and now < forced_until:
        status = "online"
    if (is_admin or is_mod) and user.get("auto_rank_enabled") and not user.get("auto_rank_idle"):
        status = "online"
    return status


def _on_users_online(user) -> bool:
    """Anyone who would show on Users Online as online or idle (incl. auto-rank presence)."""
    status = _roster_status(user)
    if status in ("online", "idle"):
        return True
    if user.get("auto_rank_enabled") and not user.get("auto_rank_idle"):
        return True
    return False


def inbox_body(name: str) -> str:
    return (
        f"{name},\n\n"
        "This is the system AI.\n\n"
        "There will not be any more game updates for a few days. "
        "Everything that needed shipping is live — enjoy the quiet stretch.\n\n"
        "You are on Users Online right now, so these are already on your account:\n"
        f"\u2022 {SPINS} free Wheel of Fortune spins\n"
        f"\u2022 {LOOT:,} loot pieces\n\n"
        "Spend them however you like.\n\n"
        "\u2014 System AI"
    )


def inbox_body_ghostface(name: str) -> str:
    return (
        f"{name},\n\n"
        "This is the system AI.\n\n"
        "There will not be any more game updates for a few days. "
        "I have told everyone who was online or idle on Users Online the same, "
        "and credited them:\n"
        f"\u2022 {SPINS} free Wheel of Fortune spins\n"
        f"\u2022 {LOOT:,} loot pieces\n\n"
        "Those are on your account too.\n\n"
        "\u2014 System AI"
    )


filt = {
    "is_dead": {"$ne": True},
    "is_npc": {"$ne": True},
    "is_bodyguard": {"$ne": True},
    "id": {"$exists": True, "$nin": ["", None]},
    "$or": [
        {"last_seen": {"$gte": idle_cutoff_iso}},
        {"forced_online_until": {"$gt": now_iso}},
        {"$and": [{"auto_rank_enabled": True}, {"auto_rank_idle": {"$ne": True}}]},
    ],
}
candidates = list(
    db.users.find(
        filt,
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "is_moderator": 1,
            "admin_ghost_mode": 1,
            "last_seen": 1,
            "forced_online_until": 1,
            "auto_rank_enabled": 1,
            "auto_rank_idle": 1,
        },
    )
)

targets = []
seen_ids = set()
for u in candidates:
    name = (u.get("username") or "").strip()
    if not name or name.lower() == "system ai":
        continue
    is_admin = (u.get("email") or "").strip().lower() in ADMIN_EMAILS
    is_mod = bool(u.get("is_moderator"))
    if (is_admin or is_mod) and u.get("admin_ghost_mode"):
        continue
    if not _on_users_online(u):
        continue
    uid = u.get("id")
    if not uid or uid in seen_ids:
        continue
    seen_ids.add(uid)
    targets.append({**u, "_status": _roster_status(u)})

gf = db.users.find_one(
    {"id": GF_ID},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "email": 1,
        "is_moderator": 1,
        "admin_ghost_mode": 1,
        "last_seen": 1,
        "forced_online_until": 1,
        "auto_rank_enabled": 1,
        "auto_rank_idle": 1,
    },
)
if not gf or (gf.get("username") or "") != "GhostFace":
    raise SystemExit("GhostFace id/username mismatch")
if GF_ID not in seen_ids:
    targets.append({**gf, "_status": _roster_status(gf), "_forced_include": True})
    seen_ids.add(GF_ID)

targets.sort(key=lambda u: (u.get("username") or "").lower())

print("roster_match", len(targets))
for u in targets:
    flag = " +GF" if u.get("_forced_include") else ""
    print(f"  {(u.get('username') or '?')} [{u.get('_status')}]{flag}")
print()

credited = []
skipped = []
for u in targets:
    uid = u["id"]
    name = (u.get("username") or "").strip()
    already = db.point_ledger_events.find_one({"user_id": uid, "origin_ref": ORIGIN}, {"_id": 0, "id": 1})
    if already:
        print("already", name)
        skipped.append(name)
        continue
    if not APPLY:
        print("would credit", name)
        credited.append(name)
        continue

    before = db.users.find_one_and_update(
        {"id": uid},
        {
            "$inc": {
                "loot_box_pieces": LOOT,
                "wheel_bonus_free_spins": SPINS,
            }
        },
        projection={"_id": 0, "loot_box_pieces": 1, "wheel_bonus_free_spins": 1},
        return_document=ReturnDocument.BEFORE,
    )
    loot_before = int((before or {}).get("loot_box_pieces") or 0)
    spins_before = int((before or {}).get("wheel_bonus_free_spins") or 0)

    db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_update_pause_gift",
            "user_id": uid,
            "points": 0,
            "lot_id": None,
            "origin_ref": ORIGIN,
            "root_purchase_ref": None,
            "meta": {
                "reason": "update_pause_users_online_gift",
                "loot_box_pieces": LOOT,
                "wheel_bonus_free_spins": SPINS,
                "status": u.get("_status"),
                "forced_include": bool(u.get("_forced_include")),
            },
            "created_at": now_iso,
            "wallet_points_before": None,
            "wallet_points_after": None,
            "source": "system_ai",
        }
    )
    body = inbox_body_ghostface(name) if uid == GF_ID else inbox_body(name)
    db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": TITLE,
            "message": body,
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    credited.append(name)
    print(
        "credited",
        name,
        "loot",
        loot_before,
        "->",
        loot_before + LOOT,
        "spins",
        spins_before,
        "->",
        spins_before + SPINS,
    )

credited = sorted(set(credited), key=str.lower)
skipped = sorted(set(skipped), key=str.lower)
print()
print("CREDITED" if APPLY else "WOULD_CREDIT", len(credited), ", ".join(credited))
if skipped:
    print("SKIPPED_ALREADY", len(skipped), ", ".join(skipped))
print("\nDRY RUN - nothing written. Re-run with --apply" if not APPLY else "\ndone")
