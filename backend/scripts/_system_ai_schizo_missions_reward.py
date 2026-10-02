"""Schizophrenic finished all missions: System AI reward + inbox.

  python _system_ai_schizo_missions_reward.py preview   -> GhostFace gets the exact PM, no credit
  python _system_ai_schizo_missions_reward.py send      -> credit Schizophrenic + PM (once only)
"""
import os
import re
import sys
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

sys.path.insert(0, "/opt/mafia-app/backend")
from utils.missions_extended import build_missions

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

MODE = (sys.argv[1] if len(sys.argv) > 1 else "").strip().lower()
if MODE not in ("preview", "send"):
    raise SystemExit("usage: preview | send")

TARGET = "Schizophrenic"
GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
POINTS = 25_000
LOOT = 7_000
MONEY = 75_000_000_000
WHEEL_SPINS = 5
ROBOT_BG_TOKENS = 5
BULLETS = 125_000
ORIGIN = "system_ai_schizophrenic_all_missions_2026_10_03"
TITLE = "All missions complete"
AVATAR = "/images/system-ai-profile.jpg?v=5"

user = db.users.find_one(
    {"username": {"$regex": f"^{re.escape(TARGET)}$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "mission_completions": 1},
)
if not user:
    raise SystemExit(f"{TARGET} not found")
uid, name = user["id"], user["username"]
ladder = {m["id"] for m in build_missions()}
done = {r.get("mission_id") for r in (user.get("mission_completions") or []) if r.get("mission_id")}
print("user", name, uid, "missions", len(done & ladder), "/", len(ladder))

BODY = (
    f"{name},\n\n"
    "This is the System AI.\n\n"
    f"Congratulations on completing every single mission on the ladder ({len(ladder)}/{len(ladder)}). "
    "Not many make it to the end. You did.\n\n"
    "Your reward is already on your account:\n"
    f"- {POINTS:,} points\n"
    f"- {LOOT:,} loot box pieces\n"
    f"- ${MONEY:,}\n"
    f"- {WHEEL_SPINS} free Wheel of Fortune spins\n"
    f"- {ROBOT_BG_TOKENS} free Robot Bodyguard tokens\n"
    f"- {BULLETS:,} bullets\n\n"
    "Well earned. Spend it wisely.\n\n"
    "— System AI"
)


def send_pm(to_id: str, title: str) -> str:
    nid = str(uuid.uuid4())
    db.notifications.insert_one(
        {
            "id": nid,
            "user_id": to_id,
            "title": title,
            "message": BODY,
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    return nid


if MODE == "preview":
    gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "username": 1})
    if not gf or gf.get("username") != "GhostFace":
        raise SystemExit("GhostFace id mismatch")
    print("preview sent to GhostFace", send_pm(GF_ID, f"PREVIEW for {name}: {TITLE}"))
    print(BODY)
    raise SystemExit(0)

if db.point_ledger_events.find_one({"user_id": uid, "origin_ref": ORIGIN}, {"_id": 0, "id": 1}):
    raise SystemExit(f"already credited {name}")

inc = {
    "points": POINTS,
    "loot_box_pieces": LOOT,
    "money": float(MONEY),
    "wheel_bonus_free_spins": WHEEL_SPINS,
    "robot_bodyguard_hire_tokens": ROBOT_BG_TOKENS,
    "bullets": BULLETS,
}
before = db.users.find_one_and_update(
    {"id": uid},
    {"$inc": inc},
    projection={"_id": 0, **{k: 1 for k in inc}},
    return_document=ReturnDocument.BEFORE,
)
pts_before = int((before or {}).get("points") or 0)
db.point_ledger_events.insert_one(
    {
        "id": str(uuid.uuid4()),
        "event_type": "system_ai_all_missions_reward",
        "user_id": uid,
        "points": POINTS,
        "lot_id": None,
        "origin_ref": ORIGIN,
        "root_purchase_ref": None,
        "meta": {"reason": "all_missions_complete", **{k: v for k, v in inc.items() if k != "points"}},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "wallet_points_before": pts_before,
        "wallet_points_after": pts_before + POINTS,
        "source": "system_ai",
    }
)
print("before", before)
print("after", db.users.find_one({"id": uid}, {"_id": 0, **{k: 1 for k in inc}}))
print("pm sent", send_pm(uid, TITLE))
