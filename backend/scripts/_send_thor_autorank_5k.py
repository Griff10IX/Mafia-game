"""Credit Thor 5,000 points for duplicate Auto Rank + System AI inbox."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

THOR_ID = "37137408-371d-41d2-ae26-2dfc83a72c8b"
POINTS = 5000
TITLE = "Auto Rank"
BODY = (
    "Thor,\n\n"
    "This is the system AI. I checked the file.\n\n"
    "Account Auto Rank was already on this account, so that part of the grant did nothing. "
    "5,000 points are on the account instead.\n\n"
    "— System AI"
)
AVATAR = "/images/system-ai-avatar.png"
now_iso = datetime.now(timezone.utc).isoformat()

thor = db.users.find_one(
    {"id": THOR_ID},
    {"_id": 0, "id": 1, "username": 1, "points": 1, "auto_rank_purchased": 1, "auto_rank_permanent": 1},
)
print("thor", thor)
if not thor or (thor.get("username") or "") != "Thor":
    raise SystemExit("Thor id mismatch")

already = db.notifications.find_one(
    {"user_id": THOR_ID, "title": TITLE, "system_ai": True, "message": {"$regex": "5,000 points are on the account instead"}},
    {"_id": 0, "id": 1, "created_at": 1},
)
if already:
    raise SystemExit(f"already sent {already}")

already_ledger = db.point_ledger_events.find_one(
    {"user_id": THOR_ID, "origin_ref": "system_ai_thor_autorank_already_owned"},
    {"_id": 0, "id": 1},
)
if already_ledger:
    raise SystemExit(f"already credited {already_ledger}")

before = db.users.find_one_and_update(
    {"id": THOR_ID, "username": "Thor"},
    {"$inc": {"points": POINTS}},
    projection={"_id": 0, "points": 1},
    return_document=ReturnDocument.BEFORE,
)
pts_before = int((before or {}).get("points") or 0)
pts_after = pts_before + POINTS
print("credited", pts_before, "->", pts_after)

db.point_ledger_events.insert_one(
    {
        "id": str(uuid.uuid4()),
        "event_type": "system_ai_autorank_already_owned",
        "user_id": THOR_ID,
        "points": POINTS,
        "lot_id": None,
        "origin_ref": "system_ai_thor_autorank_already_owned",
        "root_purchase_ref": None,
        "meta": {"reason": "death_file_autorank_already_owned"},
        "created_at": now_iso,
        "wallet_points_before": pts_before,
        "wallet_points_after": pts_after,
        "source": "system_ai",
    }
)

nid = str(uuid.uuid4())
db.notifications.insert_one(
    {
        "id": nid,
        "user_id": THOR_ID,
        "title": TITLE,
        "message": BODY,
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)
print("inbox", nid)
print("done")
