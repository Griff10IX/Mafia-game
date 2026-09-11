"""Give Vuse 1 Game Pass from Zwischenzug ban; PM Vuse + admin preview."""
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/opt/mafia-app/backend")

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

AVATAR = "/images/system-ai-profile.jpg?v=5"
ORIGIN = "system_ai_zwischenzug_game_pass_vuse"
GP_EXPIRES = "2026-09-27T05:54:05.078698+00:00"
GHOSTFACE_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"

now_iso = datetime.now(timezone.utc).isoformat()

vuse = db.users.find_one(
    {"username": {"$regex": "^Vuse$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "rank_xp_pass_season_rp": 1,
        "rank_xp_pass_rewards_granted": 1,
        "rank_xp_pass_token_expires_at": 1,
        "rank_xp_pass_tokens": 1,
        "rank_xp_pass_last_granted_micro_tier": 1,
        "rank_xp_pass_free_last_micro_tier_granted": 1,
    },
)
if not vuse:
    raise SystemExit("Vuse not found")

uid = vuse["id"]
name = vuse.get("username") or "Vuse"
print(f"Vuse: {name} ({uid})")
print(f"  current GP granted={vuse.get('rank_xp_pass_rewards_granted')} expires={vuse.get('rank_xp_pass_token_expires_at')} tokens={vuse.get('rank_xp_pass_tokens')}")

if db.point_ledger_events.find_one({"origin_ref": ORIGIN}):
    raise SystemExit("Already granted to Vuse (origin exists)")

# Resolve micro cursor from season RP (no armoury import)
try:
    from utils.game_pass_micro_rewards import micro_tier_from_rank_points
    season_rp = int(vuse.get("rank_xp_pass_season_rp") or 0)
    micro = int(micro_tier_from_rank_points(season_rp) or 0)
except Exception:
    season_rp = int(vuse.get("rank_xp_pass_season_rp") or 0)
    micro = int(vuse.get("rank_xp_pass_last_granted_micro_tier") or 0)

# Grant 1 paid Game Pass VIP window (same remaining ban confiscation expiry)
db.users.update_one(
    {"id": uid},
    {
        "$set": {
            "rank_xp_pass_tokens": 0,
            "rank_xp_pass_token_expires_at": GP_EXPIRES,
            "rank_xp_pass_rewards_granted": True,
            "rank_xp_pass_tier_snapshot": season_rp,
            "rank_xp_pass_last_granted_micro_tier": max(micro, int(vuse.get("rank_xp_pass_last_granted_micro_tier") or 0)),
            "rank_xp_pass_bonus_until": None,
        },
        "$unset": {"rank_xp_pass_pending_tier_snapshot": ""},
    },
)

db.point_ledger_events.insert_one(
    {
        "id": str(uuid.uuid4()),
        "event_type": "system_ai_game_pass_transfer",
        "user_id": uid,
        "points": 0,
        "lot_id": None,
        "origin_ref": ORIGIN,
        "root_purchase_ref": None,
        "meta": {
            "from": "Zwischenzug",
            "to": name,
            "expires_at": GP_EXPIRES,
            "reason": "random_active_pick_from_banned_player",
        },
        "created_at": now_iso,
        "source": "system_ai",
    }
)

pm_body = (
    f"{name},\n\n"
    "This is the system AI.\n\n"
    "You have been given 1 paid Game Pass.\n\n"
    "It was taken from Zwischenzug after he was permanently banned for botting. "
    "You were picked at random from players who were online.\n\n"
    f"VIP is active on your account until {GP_EXPIRES}.\n\n"
    "See Topic of Shame for the ban details.\n\n"
    "— System AI"
)

# Preview to admin (GhostFace)
db.notifications.insert_one(
    {
        "id": str(uuid.uuid4()),
        "user_id": GHOSTFACE_ID,
        "title": "PREVIEW — Game Pass to Vuse",
        "message": (
            "PREVIEW (admin) — this is the PM sent to Vuse:\n\n"
            "────────\n"
            + pm_body
        ),
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)
print("Preview PM → GhostFace")

# Real PM to Vuse
db.notifications.insert_one(
    {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "title": "Game Pass",
        "message": pm_body,
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)
print(f"PM → {name}")
print(f"Game Pass VIP → {name} until {GP_EXPIRES} (micro cursor {micro})")
print("DONE")
