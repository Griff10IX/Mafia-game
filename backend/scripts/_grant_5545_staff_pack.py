"""Staff grant for 5545: Auto Rank, 10x each perk, Game/VIP/Prestige pass, 25k points.
Local desktop script — run on live server only. No public posts.
"""
import calendar
import os
import sys
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USERNAME = "5545"
POINTS = 25_000
PERK_AMOUNT = 10
GP_TOKENS = 10
ORIGIN = "staff_grant_5545_20260904"
AVATAR = "/images/system-ai-profile.jpg?v=8"

PERK_FIELDS = {
    "xp_crimes_tokens": PERK_AMOUNT,
    "xp_gta_tokens": PERK_AMOUNT,
    "auto_rank_2h_tokens": PERK_AMOUNT,
    "melt_tokens": PERK_AMOUNT,
    "oc_reduced_tokens": PERK_AMOUNT,
    "booze_tokens": PERK_AMOUNT,
    "racket_tokens": PERK_AMOUNT,
    "travel_tokens": PERK_AMOUNT,
    "properties_tokens": PERK_AMOUNT,
    "jailbust_tokens": PERK_AMOUNT,
    "mission_skip_tokens": PERK_AMOUNT,
}


def add_months(dt: datetime, months: int) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    y = dt.year + (dt.month - 1 + months) // 12
    m = (dt.month - 1 + months) % 12 + 1
    last_day = calendar.monthrange(y, m)[1]
    d = min(dt.day, last_day)
    return dt.replace(year=y, month=m, day=d)


now = datetime.now(timezone.utc)
now_iso = now.isoformat()

dup = db.point_ledger_events.find_one({"origin_ref": ORIGIN}, {"_id": 0, "id": 1})
if dup:
    raise SystemExit(f"already granted ({ORIGIN})")

user = db.users.find_one(
    {"username": {"$regex": f"^{USERNAME}$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "points": 1,
        "rank_points": 1,
        "rank_xp_pass_tokens": 1,
        "rank_xp_pass_token_expires_at": 1,
        "game_pass_prestige_pending": 1,
        "game_pass_prestige_count": 1,
        "auto_rank_purchased": 1,
        "auto_rank_permanent": 1,
    },
)
if not user:
    raise SystemExit("user 5545 not found")

uid = user["id"]
uname = user.get("username") or USERNAME
print(f"user={uname} id={uid}")

gp_expires = add_months(now, 1).isoformat()
pending_before = int(user.get("game_pass_prestige_pending") or 0)
prestige_count = int(user.get("game_pass_prestige_count") or 0)
can_queue_prestige = prestige_count < 1 and pending_before < 1

inc = {"points": POINTS, "rank_xp_pass_tokens": GP_TOKENS, **PERK_FIELDS}
set_doc = {
    "auto_rank_purchased": True,
    "auto_rank_permanent": True,
    "auto_rank_trial": False,
    "auto_rank_enabled": True,
    "auto_rank_crimes": True,
    "auto_rank_gta": True,
    "auto_rank_bust_every_5_sec": False,
    "auto_rank_oc": False,
    "auto_rank_booze": False,
    "auto_rank_telegram_notify": True,
    "rank_xp_pass_token_expires_at": gp_expires,
    "rank_xp_pass_pending_tier_snapshot": int(user.get("rank_points") or 0),
}
if can_queue_prestige:
    set_doc["game_pass_prestige_pending"] = 1

before = db.users.find_one_and_update(
    {"id": uid},
    {"$inc": inc, "$set": set_doc, "$unset": {"auto_rank_trial_until": ""}},
    projection={
        "_id": 0,
        "points": 1,
        "rank_xp_pass_tokens": 1,
        "game_pass_prestige_pending": 1,
        "xp_crimes_tokens": 1,
        "auto_rank_permanent": 1,
    },
    return_document=ReturnDocument.BEFORE,
)

pts_before = int((before or {}).get("points") or 0)
pts_after = pts_before + POINTS
gp_before = int((before or {}).get("rank_xp_pass_tokens") or 0)
perk_before = int((before or {}).get("xp_crimes_tokens") or 0)

db.point_ledger_events.insert_one(
    {
        "id": str(uuid.uuid4()),
        "event_type": "staff_grant_points",
        "user_id": uid,
        "points": POINTS,
        "lot_id": None,
        "origin_ref": ORIGIN,
        "root_purchase_ref": None,
        "meta": {
            "reason": "staff_grant",
            "username": uname,
            "auto_rank": True,
            "perks_each": PERK_AMOUNT,
            "game_pass_tokens": GP_TOKENS,
            "prestige_pending": bool(can_queue_prestige),
        },
        "created_at": now_iso,
        "wallet_points_before": pts_before,
        "wallet_points_after": pts_after,
        "source": "staff",
    }
)

prestige_line = (
    "1x Game Pass Prestige queued (applies when you finish VIP tiers 1–100)."
    if can_queue_prestige
    else "Game Pass Prestige not queued (already pending or used this season)."
)
body = (
    f"{uname},\n\n"
    "Staff grant landed on your account:\n\n"
    "• Permanent Auto Rank (enabled)\n"
    f"• {PERK_AMOUNT} of each perk token (crime/GTA XP, Auto Rank 2h, melt, OC reduced, "
    "booze, racket, travel, properties, jailbust, mission skip)\n"
    f"• {GP_TOKENS}x Game Pass / VIP tokens (activate from Armoury / Inventory; expire ~1 month)\n"
    f"• {prestige_line}\n"
    f"• {POINTS:,} points\n\n"
    "— System AI"
)

nid = str(uuid.uuid4())
db.notifications.insert_one(
    {
        "id": nid,
        "user_id": uid,
        "title": "Staff grant",
        "message": body,
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)

after = db.users.find_one(
    {"id": uid},
    {
        "_id": 0,
        "points": 1,
        "rank_xp_pass_tokens": 1,
        "game_pass_prestige_pending": 1,
        "auto_rank_permanent": 1,
        "auto_rank_enabled": 1,
        "xp_crimes_tokens": 1,
        "melt_tokens": 1,
        "mission_skip_tokens": 1,
    },
)
print(
    "OK",
    {
        "points": f"{pts_before}->{pts_after}",
        "gp_tokens": f"{gp_before}->{int((after or {}).get('rank_xp_pass_tokens') or 0)}",
        "xp_crimes": f"{perk_before}->{int((after or {}).get('xp_crimes_tokens') or 0)}",
        "auto_rank": bool((after or {}).get("auto_rank_permanent")),
        "prestige_pending": int((after or {}).get("game_pass_prestige_pending") or 0),
        "inbox": nid,
    },
)
