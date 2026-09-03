"""Everyone at 100/100 missions: 50k points, 5k loot pieces, $25B. Inbox + game chat."""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

sys.path.insert(0, "/opt/mafia-app/backend")
from utils.missions_extended import build_missions

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

POINTS = 50_000
LOOT = 5_000
MONEY = 25_000_000_000
ORIGIN = "system_ai_mission_100_complete_bonus_2026_09_01"
TITLE = "100 missions"
AVATAR = "/images/system-ai-profile.jpg?v=5"
now = datetime.now(timezone.utc)
now_iso = now.isoformat()

MISSION_IDS = {m["id"] for m in build_missions()}
print("ladder", len(MISSION_IDS))
if len(MISSION_IDS) != 100:
    raise SystemExit(f"expected 100 missions, got {len(MISSION_IDS)}")


def completed_ids(user):
    return {row.get("mission_id") for row in (user.get("mission_completions") or []) if row.get("mission_id")}


cands = list(
    db.users.find(
        {
            "mission_completions.99": {"$exists": True},
            "is_npc": {"$ne": True},
            "is_bodyguard": {"$ne": True},
        },
        {"_id": 0, "id": 1, "username": 1, "mission_completions": 1},
    )
)
print("candidates", len(cands))

done = []
for u in cands:
    uid = u.get("id")
    name = (u.get("username") or "").strip()
    if not uid or not name or name.lower() == "system ai":
        continue
    if not MISSION_IDS.issubset(completed_ids(u)):
        print("skip incomplete", name, len(completed_ids(u)))
        continue
    done.append((uid, name))

done.sort(key=lambda x: x[1].lower())
print("complete 100/100", len(done), [n for _, n in done])

credited_names = []
skipped_already = []
for uid, name in done:
    already = db.point_ledger_events.find_one(
        {"user_id": uid, "origin_ref": ORIGIN},
        {"_id": 0, "id": 1},
    )
    if already:
        print("already", name)
        skipped_already.append(name)
        continue
    before = db.users.find_one_and_update(
        {"id": uid},
        {"$inc": {"points": POINTS, "loot_box_pieces": LOOT, "money": float(MONEY)}},
        projection={"_id": 0, "points": 1, "money": 1, "loot_box_pieces": 1},
        return_document=ReturnDocument.BEFORE,
    )
    pts_before = int((before or {}).get("points") or 0)
    loot_before = int((before or {}).get("loot_box_pieces") or 0)
    money_before = float((before or {}).get("money") or 0)
    db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_mission_100_complete_bonus",
            "user_id": uid,
            "points": POINTS,
            "lot_id": None,
            "origin_ref": ORIGIN,
            "root_purchase_ref": None,
            "meta": {
                "reason": "all_100_missions_complete",
                "cash": MONEY,
                "loot_box_pieces": LOOT,
            },
            "created_at": now_iso,
            "wallet_points_before": pts_before,
            "wallet_points_after": pts_before + POINTS,
            "source": "system_ai",
        }
    )
    body = (
        f"{name},\n\n"
        "This is the system AI.\n\n"
        "You finished all 100 missions. 50,000 points, 5,000 loot pieces, and "
        "$25,000,000,000 are already on your account.\n\n"
        "Daily and passive rewards for completing the ladder are still being worked on. "
        "You'll get those when they're ready.\n\n"
        "— System AI"
    )
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
    print(
        "credited",
        name,
        "pts",
        pts_before,
        "->",
        pts_before + POINTS,
        "loot",
        loot_before,
        "->",
        loot_before + LOOT,
        "cash",
        money_before,
        "->",
        money_before + MONEY,
    )
    credited_names.append(name)

chat_text = (
    "Anyone who's finished all 100 missions: 50,000 points, 5,000 loot pieces, and "
    "$25,000,000,000 are on your account. Check inbox. Daily and passive rewards for "
    "completing it are still being worked on."
)
if len(chat_text) > 500:
    raise SystemExit(f"chat too long {len(chat_text)}")

already_chat = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": chat_text, "channel": "global"},
    {"_id": 0, "id": 1},
)
if already_chat:
    print("chat already", already_chat)
else:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": "system_ai",
        "username": "System AI",
        "message": chat_text,
        "family_id": None,
        "channel": "global",
        "created_at": now.isoformat(),
        "expires_at": now + timedelta(days=7),
        "sender_is_staff": True,
        "system_ai": True,
        "avatar_url": AVATAR,
        "author_online_color": "#FBBF24",
        "viewed_by": [],
    }
    db.game_chat_messages.insert_one(doc)
    print("chat posted", doc["id"], len(chat_text))

print("credited", len(credited_names), credited_names)
print("already skipped", skipped_already)
print("done")
