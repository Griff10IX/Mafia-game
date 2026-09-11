"""Split $200B confiscated cash among all online users into Swiss + System AI PM."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TOTAL = 200_000_000_000  # $200 billion
ORIGIN = "system_ai_zwischenzug_swiss_share"
AVATAR = "/images/system-ai-profile.jpg?v=5"

EXCLUDE_USERNAMES = {"system ai", "zwischenzug", "weiss", "piece"}

now = datetime.now(timezone.utc)
now_iso = now.isoformat()
idle_cutoff = (now - timedelta(minutes=10)).isoformat()

filt = {
    "is_dead": {"$ne": True},
    "is_npc": {"$ne": True},
    "is_bodyguard": {"$ne": True},
    "is_banned": {"$ne": True},
    "id": {"$exists": True, "$nin": ["", None]},
    "$or": [
        {"last_seen": {"$gte": idle_cutoff}},
        {"forced_online_until": {"$gt": now_iso}},
        {"$and": [{"auto_rank_enabled": True}, {"auto_rank_idle": {"$ne": True}}]},
    ],
}

users = list(
    db.users.find(
        filt,
        {"_id": 0, "id": 1, "username": 1, "swiss_balance": 1, "swiss_limit": 1},
    )
)

recipients = []
for u in users:
    uid = u.get("id")
    name = (u.get("username") or "").strip()
    if not uid or not name:
        continue
    if name.lower() in EXCLUDE_USERNAMES:
        continue
    recipients.append(u)

n = len(recipients)
print(f"Online eligible: {n}")
if n == 0:
    raise SystemExit("No online users found")

# Equal split (floor), leftover stays undistributed
share = TOTAL // n
leftover = TOTAL - (share * n)
print(f"Total pool: ${TOTAL:,}")
print(f"Per user:   ${share:,}")
print(f"Leftover:   ${leftover:,}")
print()

credited = []
for u in recipients:
    uid = u["id"]
    name = u["username"]

    already = db.point_ledger_events.find_one(
        {"user_id": uid, "origin_ref": ORIGIN},
        {"_id": 0, "id": 1},
    )
    if already:
        print(f"  SKIP already: {name}")
        continue

    current_swiss = int(u.get("swiss_balance") or 0)
    current_limit = int(u.get("swiss_limit") or 0)
    new_balance = current_swiss + share
    # Raise swiss_limit if needed so the credit isn't trapped / clipped by UI
    new_limit = max(current_limit, new_balance)

    db.users.update_one(
        {"id": uid},
        {
            "$inc": {"swiss_balance": share},
            "$max": {"swiss_limit": new_limit},
        },
    )

    db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_swiss_redistribution",
            "user_id": uid,
            "points": 0,
            "lot_id": None,
            "origin_ref": ORIGIN,
            "root_purchase_ref": None,
            "meta": {
                "swiss_share": share,
                "total_pool": TOTAL,
                "online_count": n,
                "reason": "zwischenzug_confiscated_wealth_online_share",
            },
            "created_at": now_iso,
            "source": "system_ai",
        }
    )

    db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": "Swiss share",
            "message": (
                f"{name},\n\n"
                "This is the system AI.\n\n"
                f"${share:,} has been deposited into your Swiss bank.\n\n"
                "This is your share of cash confiscated from Zwischenzug, who was caught botting "
                "and permanently banned. The pool ($200,000,000,000) was split equally between "
                f"everyone online at the time ({n} players).\n\n"
                "See Topic of Shame for full details.\n\n"
                "— System AI"
            ),
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )

    credited.append((name, share))
    print(f"  ✓ {name}: +${share:,} Swiss")

print(f"\nDone. Credited {len(credited)} users @ ${share:,} each.")
print("NAMES:", ", ".join(n for n, _ in sorted(credited, key=lambda x: x[0].lower())))
