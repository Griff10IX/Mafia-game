"""Cloudflare incident goodwill: everyone currently online gets points, loot pieces and
Wheel of Fortune spins, a System AI inbox card, plus one System AI post in global chat.

Usage:
    python _system_ai_online_reward.py            # dry run
    python _system_ai_online_reward.py --apply
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

POINTS = 5_000
LOOT = 2_000
SPINS = 5
ORIGIN = "system_ai_cloudflare_goodwill_2026_09_03"
TITLE = "Cloudflare issue - resolved"
AVATAR = "/images/system-ai-profile.jpg?v=5"
ONLINE_LAST_SEEN_MINUTES = 5
IDLE_LAST_SEEN_MAX_MINUTES = 10

ADMIN_EMAILS = {e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()}
MOD_EMAILS = {e.strip().lower() for e in (os.environ.get("MOD_EMAILS") or "").split(",") if e.strip()}

now = datetime.now(timezone.utc)
now_iso = now.isoformat()
online_cutoff = now - timedelta(minutes=ONLINE_LAST_SEEN_MINUTES)
idle_cutoff = now - timedelta(minutes=IDLE_LAST_SEEN_MAX_MINUTES)
idle_cutoff_iso = idle_cutoff.isoformat()

CHAT_TEXT = (
    "This is the system AI. The loading trouble on the kill pages earlier was a Cloudflare "
    "issue. It has been resolved. Search timers and the bodyguards lost in that window have "
    "been put back as closely as possible, without rolling the server back a few hours. "
    "Everyone who was online has 5,000 points, 2,000 loot pieces and 5 Wheel of Fortune spins "
    "on their account. This will not happen again."
)


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


def _user_status_online(user) -> bool:
    """Match /users/online: status must be online, not idle."""
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
    return status == "online"


def inbox_body(name: str) -> str:
    return (
        f"{name},\n\n"
        "This is the system AI.\n\n"
        "The loading trouble on the kill pages earlier tonight was a Cloudflare issue. "
        "It has been resolved.\n\n"
        "Everything has been put back as closely as possible without rolling the server back "
        "a few hours. Search timers were restored, and the bodyguards lost in that window have "
        "been returned or paid for.\n\n"
        "You were online, so these are already on your account:\n"
        f"\u2022 {POINTS:,} points\n"
        f"\u2022 {LOOT:,} loot pieces\n"
        f"\u2022 {SPINS} free Wheel of Fortune spins\n\n"
        "This will not happen again.\n\n"
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
online_users = []
for u in candidates:
    name = (u.get("username") or "").strip()
    if not name or name.lower() == "system ai":
        continue
    is_admin = (u.get("email") or "").strip().lower() in ADMIN_EMAILS
    is_mod = bool(u.get("is_moderator"))
    if (is_admin or is_mod) and u.get("admin_ghost_mode"):
        continue
    if not _user_status_online(u):
        continue
    online_users.append(u)

print("candidates", len(candidates), "online", len(online_users))
print("online:", ", ".join(sorted((u.get("username") or "?") for u in online_users)))
print()

credited = []
skipped = []
for u in online_users:
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
                "points": POINTS,
                "loot_box_pieces": LOOT,
                "wheel_bonus_free_spins": SPINS,
            }
        },
        projection={"_id": 0, "points": 1},
        return_document=ReturnDocument.BEFORE,
    )
    pts_before = int((before or {}).get("points") or 0)
    pts_after = pts_before + POINTS

    db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_cloudflare_goodwill",
            "user_id": uid,
            "points": POINTS,
            "lot_id": None,
            "origin_ref": ORIGIN,
            "root_purchase_ref": None,
            "meta": {
                "reason": "cloudflare_incident_online_bonus",
                "loot_box_pieces": LOOT,
                "wheel_bonus_free_spins": SPINS,
            },
            "created_at": now_iso,
            "wallet_points_before": pts_before,
            "wallet_points_after": pts_after,
            "source": "system_ai",
        }
    )
    db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": TITLE,
            "message": inbox_body(name),
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    credited.append(name)
    print("credited", name, "pts", pts_before, "->", pts_after)

credited = sorted(set(credited), key=str.lower)
skipped = sorted(set(skipped), key=str.lower)
print()
print("CREDITED" if APPLY else "WOULD_CREDIT", len(credited), ", ".join(credited))
if skipped:
    print("SKIPPED_ALREADY", len(skipped), ", ".join(skipped))

print()
already_chat = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": CHAT_TEXT, "channel": "global"},
    {"_id": 0, "id": 1, "created_at": 1},
)
if already_chat:
    print("chat already posted", already_chat)
elif not APPLY:
    print("would post to global chat:")
    print(" ", CHAT_TEXT)
else:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": "system_ai",
        "username": "System AI",
        "message": CHAT_TEXT,
        "family_id": None,
        "channel": "global",
        "created_at": now_iso,
        "expires_at": now + timedelta(days=7),
        "sender_is_staff": True,
        "system_ai": True,
        "avatar_url": AVATAR,
        "author_online_color": "#FBBF24",
        "viewed_by": [],
    }
    db.game_chat_messages.insert_one(doc)
    print("chat posted", doc["id"])

print("\nDRY RUN - nothing written. Re-run with --apply" if not APPLY else "\ndone")
