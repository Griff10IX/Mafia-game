"""Distribute Zwischenzug's tokens evenly to online users; give paid Game Pass to one active (not idle) player."""
import os
import sys
import uuid
import asyncio
import json
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/opt/mafia-app/backend")

from dotenv import load_dotenv
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/opt/mafia-app/backend/.env")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = (os.environ.get("DB_NAME") or "mafia_game").strip()
sync_db = MongoClient(MONGO_URL)[DB_NAME]

ORIGIN = "system_ai_zwischenzug_token_share"
GP_ORIGIN = "system_ai_zwischenzug_game_pass_transfer"
AVATAR = "/images/system-ai-profile.jpg?v=5"
BACKUP = "/opt/mafia-app/backups/zwischenzug_ban_backup_20260904_010940.json"

EXCLUDE = {"system ai", "zwischenzug", "weiss", "piece"}
# Prefer not GhostFace for Game Pass (admin) — pick a real active player
GP_EXCLUDE = EXCLUDE | {"ghostface"}

ADMIN_EMAILS = {e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()}

# Token fields from Zwischenzug backup (no Game Pass tokens)
TOKEN_FIELDS = [
    "auto_collect_12h_tokens",
    "auto_collect_24h_tokens",
    "auto_rank_2h_tokens",
    "booze_tokens",
    "cooldown_skip_booze_tokens",
    "cooldown_skip_crime_tokens",
    "cooldown_skip_gta_tokens",
    "cooldown_skip_properties_tokens",
    "crew_oc_auto_apply_tokens",
    "jail_bailout_tokens",
    "jailbust_tokens",
    "melt_tokens",
    "mission_skip_tokens",
    "oc_reduced_tokens",
    "properties_tokens",
    "racket_tokens",
    "robot_bodyguard_hire_tokens",
    "travel_tokens",
    "xp_crimes_tokens",
    "xp_gta_tokens",
]

# Friendly labels for PM
LABELS = {
    "auto_collect_12h_tokens": "Auto Collect 12h",
    "auto_collect_24h_tokens": "Auto Collect 24h",
    "auto_rank_2h_tokens": "Auto Rank 2h",
    "booze_tokens": "Booze boost",
    "cooldown_skip_booze_tokens": "Cooldown Skip Booze",
    "cooldown_skip_crime_tokens": "Cooldown Skip Crime",
    "cooldown_skip_gta_tokens": "Cooldown Skip GTA",
    "cooldown_skip_properties_tokens": "Cooldown Skip Properties",
    "crew_oc_auto_apply_tokens": "Crew OC Auto 3h",
    "jail_bailout_tokens": "Jail Bailout",
    "jailbust_tokens": "Jailbust bonus",
    "melt_tokens": "Melt",
    "mission_skip_tokens": "Mission Skip",
    "oc_reduced_tokens": "OC Reduced",
    "properties_tokens": "Properties boost",
    "racket_tokens": "Racket boost",
    "robot_bodyguard_hire_tokens": "Robot BG Hire",
    "travel_tokens": "Travel boost",
    "xp_crimes_tokens": "XP Crimes",
    "xp_gta_tokens": "XP GTA",
    "loot_box_pieces": "Loot pieces",
    "wheel_bonus_free_spins": "Wheel free spins",
}

EXTRA_FIELDS = ["loot_box_pieces", "wheel_bonus_free_spins"]

now = datetime.now(timezone.utc)
now_iso = now.isoformat()
online_cutoff = now - timedelta(minutes=5)
idle_cutoff = now - timedelta(minutes=10)
idle_cutoff_iso = idle_cutoff.isoformat()


def _parse_iso(raw):
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def status_of(user) -> str:
    status = "offline"
    ls = _parse_iso(user.get("last_seen"))
    if ls:
        if ls >= online_cutoff:
            status = "online"
        elif ls >= idle_cutoff:
            status = "idle"
    forced = _parse_iso(user.get("forced_online_until"))
    if forced and status != "online" and now < forced:
        status = "online"
    return status


with open(BACKUP) as f:
    backup = json.load(f)

pool = {f: int(backup.get(f) or 0) for f in TOKEN_FIELDS + EXTRA_FIELDS}
gp_expires = backup.get("rank_xp_pass_token_expires_at")
print("Pool from backup:")
for k, v in pool.items():
    print(f"  {k}: {v}")
print(f"  Game Pass expires: {gp_expires}")

# Online candidates (within 10 min — same spirit as previous redistributions)
filt = {
    "is_dead": {"$ne": True},
    "is_npc": {"$ne": True},
    "is_bodyguard": {"$ne": True},
    "is_banned": {"$ne": True},
    "id": {"$exists": True, "$nin": ["", None]},
    "$or": [
        {"last_seen": {"$gte": idle_cutoff_iso}},
        {"forced_online_until": {"$gt": now_iso}},
        {"$and": [{"auto_rank_enabled": True}, {"auto_rank_idle": {"$ne": True}}]},
    ],
}
candidates = list(
    sync_db.users.find(
        filt,
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "last_seen": 1,
            "forced_online_until": 1,
            "auto_rank_enabled": 1,
            "auto_rank_idle": 1,
            "admin_ghost_mode": 1,
            "is_moderator": 1,
            "rank_xp_pass_rewards_granted": 1,
            "rank_xp_pass_token_expires_at": 1,
            "rank_xp_pass_tokens": 1,
            "rank_xp_pass_season_rp": 1,
            "rank_xp_pass_free_last_micro_tier_granted": 1,
        },
    )
)

recipients = []
for u in candidates:
    name = (u.get("username") or "").strip()
    if not name or name.lower() in EXCLUDE:
        continue
    email = (u.get("email") or "").strip().lower()
    if email in ADMIN_EMAILS and u.get("admin_ghost_mode"):
        continue
    recipients.append(u)

n = len(recipients)
print(f"\nOnline recipients: {n}")
if n < 1:
    raise SystemExit("No online users")

# Even floor split per field
per_user = {}
leftovers = {}
for field, total in pool.items():
    share = total // n
    per_user[field] = share
    leftovers[field] = total - share * n

print("\nPer-user share (floor):")
for field, share in per_user.items():
    if share > 0:
        print(f"  {LABELS.get(field, field)}: {share} each  (pool {pool[field]}, leftover {leftovers[field]})")

# Game Pass recipient: status online (not idle), not admin/GhostFace, prefer no active VIP
active = [u for u in recipients if status_of(u) == "online" and (u.get("username") or "").lower() not in GP_EXCLUDE]
# Prefer players without active paid pass
def has_active_gp(u):
    if int(u.get("rank_xp_pass_tokens") or 0) > 0:
        return True
    if not u.get("rank_xp_pass_rewards_granted"):
        return False
    exp = _parse_iso(u.get("rank_xp_pass_token_expires_at"))
    return bool(exp and exp > now)

no_gp = [u for u in active if not has_active_gp(u)]
gp_pool = no_gp or active
# Most recently seen
gp_pool.sort(key=lambda u: _parse_iso(u.get("last_seen")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
if not gp_pool:
    raise SystemExit("No active (non-idle) user for Game Pass")
gp_winner = gp_pool[0]
print(f"\nGame Pass winner: {gp_winner.get('username')} (status={status_of(gp_winner)}, last_seen={gp_winner.get('last_seen')})")

# Build inc dict
inc = {f: s for f, s in per_user.items() if s > 0}
if not inc and not gp_expires:
    raise SystemExit("Nothing to give")

token_lines = [f"• {share}× {LABELS.get(f, f)}" for f, share in per_user.items() if share > 0]


def make_pm(name: str, got_gp: bool) -> str:
    lines = [
        f"{name},",
        "",
        "This is the system AI.",
        "",
        "Zwischenzug's confiscated inventory has been split between everyone who was online.",
        "Your equal share is already on your account:",
        "",
        *token_lines,
        "",
    ]
    if got_gp:
        lines += [
            "You were also chosen (active, not idle) to receive his remaining paid Game Pass.",
            f"VIP window runs until {gp_expires}. It has been activated on your account.",
            "",
        ]
    lines += [
        "See Topic of Shame for the ban details.",
        "",
        "— System AI",
    ]
    return "\n".join(lines)


credited = []
for u in recipients:
    uid = u["id"]
    name = (u.get("username") or "").strip()
    already = sync_db.point_ledger_events.find_one({"user_id": uid, "origin_ref": ORIGIN}, {"_id": 0, "id": 1})
    if already:
        print(f"  SKIP already: {name}")
        continue

    if inc:
        sync_db.users.update_one({"id": uid}, {"$inc": inc})

    sync_db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_token_redistribution",
            "user_id": uid,
            "points": 0,
            "lot_id": None,
            "origin_ref": ORIGIN,
            "root_purchase_ref": None,
            "meta": {"shares": per_user, "online_count": n, "source": "zwischenzug_backup"},
            "created_at": now_iso,
            "source": "system_ai",
        }
    )

    got_gp = uid == gp_winner["id"]
    sync_db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": "Confiscated tokens",
            "message": make_pm(name, got_gp),
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    credited.append(name)
    print(f"  ✓ tokens → {name}")

print(f"\nToken shares sent to {len(credited)} users")


async def grant_game_pass():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    uid = gp_winner["id"]
    name = gp_winner.get("username")

    already = await db.point_ledger_events.find_one({"origin_ref": GP_ORIGIN}, {"_id": 0, "id": 1})
    if already:
        print("Game Pass already transferred this origin — skip")
        client.close()
        return

    # Fresh paid pass with Zwischenzug's remaining expiry, then auto-activate for recipient's progress
    expires_at = gp_expires
    u = await db.users.find_one(
        {"id": uid},
        {
            "_id": 0,
            "rank_xp_pass_season_rp": 1,
            "rank_xp_pass_free_last_micro_tier_granted": 1,
            "rank_xp_pass_rewards_granted": 1,
            "rank_xp_pass_token_expires_at": 1,
        },
    )
    season_rp = int((u or {}).get("rank_xp_pass_season_rp") or 0)
    free_last = int((u or {}).get("rank_xp_pass_free_last_micro_tier_granted") or 0)

    # If they already have VIP, just extend expiry to Zwischenzug's (keep their progress)
    if (u or {}).get("rank_xp_pass_rewards_granted"):
        their_exp = _parse_iso((u or {}).get("rank_xp_pass_token_expires_at"))
        zw_exp = _parse_iso(expires_at)
        new_exp = expires_at
        if their_exp and zw_exp and their_exp > zw_exp:
            new_exp = their_exp.isoformat()
        await db.users.update_one(
            {"id": uid},
            {"$set": {"rank_xp_pass_token_expires_at": new_exp}},
        )
        print(f"Game Pass: extended existing VIP for {name} → {new_exp}")
        activated = "extended"
    else:
        await db.users.update_one(
            {"id": uid},
            {
                "$set": {
                    "rank_xp_pass_tokens": 1,
                    "rank_xp_pass_token_expires_at": expires_at,
                    "rank_xp_pass_pending_tier_snapshot": season_rp,
                    "rank_xp_pass_rewards_granted": False,
                    "rank_xp_pass_last_granted_micro_tier": 0,
                    "rank_xp_pass_tier_snapshot": None,
                    "rank_xp_pass_bonus_until": None,
                }
            },
        )
        from routers.kill.armoury import _activate_rank_xp_pass_and_grant_cumulative_micro_tiers

        activated = await _activate_rank_xp_pass_and_grant_cumulative_micro_tiers(
            db,
            uid,
            season_rp,
            free_cash_last_micro_tier_granted=free_last,
        )
        if activated:
            await db.users.update_one({"id": uid}, {"$set": {"rank_xp_pass_tokens": 0}})
        print(f"Game Pass: activated for {name} → expires {expires_at} (activated={activated})")

    await db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_game_pass_transfer",
            "user_id": uid,
            "points": 0,
            "lot_id": None,
            "origin_ref": GP_ORIGIN,
            "root_purchase_ref": None,
            "meta": {
                "from": "Zwischenzug",
                "to": name,
                "expires_at": expires_at,
                "activated": str(activated),
            },
            "created_at": now_iso,
            "source": "system_ai",
        }
    )
    # Extra PM for winner clarity
    await db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": "Game Pass transferred",
            "message": (
                f"{name},\n\n"
                "This is the system AI.\n\n"
                "You were online and active (not idle), so Zwischenzug's remaining paid Game Pass "
                f"has been moved to you. VIP is active until {expires_at}.\n\n"
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
    client.close()


asyncio.run(grant_game_pass())

print("\nDONE")
print(f"Recipients ({len(credited)}): {', '.join(sorted(credited, key=str.lower))}")
print(f"Game Pass → {gp_winner.get('username')}")
