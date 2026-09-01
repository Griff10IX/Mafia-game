"""Credit HP entertainer reward + System AI inbox to HP and GhostFace."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
POINTS = 25_000
MONEY = 25_000_000_000
TITLE = "Entertainer file — thank you"
BODY = (
    "HP,\n\n"
    "This is the system AI. I checked the entertainer file.\n\n"
    "You have put in a serious amount of work. Over three thousand funded games completed — "
    "mostly dice, plus gift boxes, house games, and poker. That is the kind of effort that "
    "keeps the tables moving for everyone else.\n\n"
    "For that, you are being rewarded 25,000 points and $25,000,000,000. "
    "It is already on your account.\n\n"
    "Keep running games the same way. The streets notice.\n\n"
    "— System AI"
)
AVATAR = "/images/system-ai-avatar.png"
now = datetime.now(timezone.utc)
now_iso = now.isoformat()

hp = db.users.find_one({"id": HP_ID}, {"_id": 0, "id": 1, "username": 1, "points": 1, "money": 1})
gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "id": 1, "username": 1})
print("HP", hp)
print("GF", gf)
if not hp or (hp.get("username") or "") != "HP":
    raise SystemExit("HP id mismatch")
if not gf or (gf.get("username") or "") != "GhostFace":
    raise SystemExit("GhostFace id mismatch")

already = db.notifications.find_one(
    {"user_id": HP_ID, "title": TITLE, "system_ai": True},
    {"_id": 0, "id": 1, "created_at": 1},
)
if already:
    raise SystemExit(f"already sent {already}")

before = db.users.find_one_and_update(
    {"id": HP_ID},
    {"$inc": {"points": POINTS, "money": float(MONEY)}},
    projection={"_id": 0, "points": 1, "money": 1},
    return_document=ReturnDocument.BEFORE,
)
pts_before = int((before or {}).get("points") or 0)
pts_after = pts_before + POINTS
money_before = float((before or {}).get("money") or 0)
money_after = money_before + MONEY
print("credited points", pts_before, "->", pts_after)
print("credited money", money_before, "->", money_after)

db.point_ledger_events.insert_one(
    {
        "id": str(uuid.uuid4()),
        "event_type": "system_ai_entertainer_reward",
        "user_id": HP_ID,
        "points": POINTS,
        "lot_id": None,
        "origin_ref": "system_ai_hp_entertainer_thank_you",
        "root_purchase_ref": None,
        "meta": {"reason": "entertainer_effort", "cash": MONEY},
        "created_at": now_iso,
        "wallet_points_before": pts_before,
        "wallet_points_after": pts_after,
        "source": "system_ai",
    }
)


def send_to(uid, username):
    nid = str(uuid.uuid4())
    db.notifications.insert_one(
        {
            "id": nid,
            "user_id": uid,
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
    print("inbox sent", username, nid)
    return nid


send_to(HP_ID, "HP")
send_to(GF_ID, "GhostFace")
print("done")
