"""Send death-file rewards + Meraxes loot-ticket refusal."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

AVATAR = "/images/system-ai-avatar.png"
now_iso = datetime.now(timezone.utc).isoformat()

POINTS = 2500
MONEY = 5_000_000_000
SPINS = 5
TOKENS = {
    "xp_crimes_tokens": 5,
    "xp_gta_tokens": 5,
    "jailbust_tokens": 5,
    "jail_bailout_tokens": 5,
    "robot_bodyguard_hire_tokens": 3,
    "wheel_bonus_free_spins": SPINS,
}

RECIPIENTS = [
    ("198d7467-75d4-4aa9-a74f-aa47a260fbe0", "OneShot"),
    ("37137408-371d-41d2-ae26-2dfc83a72c8b", "Thor"),
    ("9499a1ea-bf2e-46fe-a3c0-e9506491b83e", "Ambush"),
]

DEATH_TITLE = "A little help"


def death_body(name: str) -> str:
    return (
        f"{name},\n\n"
        "This is the system AI. I checked the death file for this month.\n\n"
        "You are one of three users who have died the most. That is a rough run. "
        "I would like to give you a little helping hand.\n\n"
        "Already on this account:\n"
        "• 2,500 points\n"
        "• Account Auto Rank (the 5,000-point store version — this account only, not the email-tied permanent one)\n"
        "• 5 Wheel of Fortune spins\n"
        "• 5 Crime XP tokens, 5 GTA XP tokens, 5 Jailbust tokens, 5 Jail Bailout tokens\n"
        "• 3 Robot Bodyguard hire tokens\n"
        "• $5,000,000,000\n\n"
        "Stay sharper out there.\n\n"
        "— System AI"
    )


print("=== death file ===")
for uid, expect_name in RECIPIENTS:
    user = db.users.find_one(
        {"id": uid},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "is_dead": 1,
            "points": 1,
            "money": 1,
            "auto_rank_purchased": 1,
            "auto_rank_permanent": 1,
            "auto_rank_email_entitlement": 1,
        },
    )
    print("user", user)
    if not user or (user.get("username") or "") != expect_name:
        raise SystemExit(f"id mismatch {expect_name}")
    already = db.notifications.find_one(
        {"user_id": uid, "title": DEATH_TITLE, "system_ai": True},
        {"_id": 0, "id": 1},
    )
    if already:
        print("already sent death file", expect_name, already)
        continue

    inc = {"points": POINTS, "money": float(MONEY), **TOKENS}
    before = db.users.find_one_and_update(
        {"id": uid},
        {
            "$inc": inc,
            "$set": {
                "auto_rank_purchased": True,
                "auto_rank_permanent": True,
                "auto_rank_trial": False,
            },
            "$unset": {"auto_rank_trial_until": ""},
        },
        projection={"_id": 0, "points": 1, "money": 1, "wheel_bonus_free_spins": 1, "robot_bodyguard_hire_tokens": 1},
        return_document=ReturnDocument.BEFORE,
    )
    pts_before = int((before or {}).get("points") or 0)
    print(
        expect_name,
        "points", pts_before, "->", pts_before + POINTS,
        "money", float((before or {}).get("money") or 0), "->", float((before or {}).get("money") or 0) + MONEY,
        "spins", int((before or {}).get("wheel_bonus_free_spins") or 0), "->", int((before or {}).get("wheel_bonus_free_spins") or 0) + SPINS,
    )
    db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_death_file_reward",
            "user_id": uid,
            "points": POINTS,
            "lot_id": None,
            "origin_ref": "system_ai_death_file_aug2026",
            "root_purchase_ref": None,
            "meta": {"reason": "most_deaths_month", "cash": MONEY, "tokens": TOKENS},
            "created_at": now_iso,
            "wallet_points_before": pts_before,
            "wallet_points_after": pts_before + POINTS,
            "source": "system_ai",
        }
    )
    nid = str(uuid.uuid4())
    db.notifications.insert_one(
        {
            "id": nid,
            "user_id": uid,
            "title": DEATH_TITLE,
            "message": death_body(expect_name),
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    print("inbox", expect_name, nid)

MERAXES_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
TICKET_ID = "50e393c2-406f-453d-8b8c-d01aab27fcb2"
LOOT_TITLE = "Loot pieces"
LOOT_BODY = (
    "Meraxes,\n\n"
    "This is the system AI. I checked your ticket.\n\n"
    "Last night the store loot rate changed. Extra pieces went to people who had just bought points. "
    "You were not in that window, so nothing was credited then, and nothing is being credited now.\n\n"
    "— System AI"
)

print("\n=== meraxes loot ticket ===")
mx = db.users.find_one({"id": MERAXES_ID}, {"_id": 0, "username": 1, "loot_box_pieces": 1})
print("Meraxes", mx)
if not mx or (mx.get("username") or "") != "Meraxes":
    raise SystemExit("Meraxes id mismatch")

already_loot = db.notifications.find_one(
    {"user_id": MERAXES_ID, "title": LOOT_TITLE, "system_ai": True},
    {"_id": 0, "id": 1},
)
if already_loot:
    print("already sent loot inbox", already_loot)
else:
    nid = str(uuid.uuid4())
    db.notifications.insert_one(
        {
            "id": nid,
            "user_id": MERAXES_ID,
            "title": LOOT_TITLE,
            "message": LOOT_BODY,
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    print("loot inbox", nid)

ticket = db.help_desk_tickets.find_one({"id": TICKET_ID}, {"_id": 0, "status": 1, "replies": 1, "user_id": 1})
if not ticket:
    raise SystemExit("ticket missing")
last = (ticket.get("replies") or [])[-1] if ticket.get("replies") else {}
if (last.get("system_ai") and "nothing is being credited now" in (last.get("body") or "")):
    print("ticket already has this reply")
else:
    db.help_desk_tickets.update_one(
        {"id": TICKET_ID},
        {
            "$push": {
                "replies": {
                    "author_id": "system_ai",
                    "author_username": "System AI",
                    "author_role": "system_ai",
                    "body": LOOT_BODY,
                    "created_at": now_iso,
                    "system_ai": True,
                    "avatar_url": AVATAR,
                }
            },
            "$set": {"updated_at": now_iso},
        },
    )
    print("ticket reply added, loot_box_pieces still", mx.get("loot_box_pieces"))

print("done")
