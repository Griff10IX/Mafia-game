"""Finish Zwischenzug redistribution: leftover small tokens + Game Pass to active non-idle (not HP)."""
import os
import sys
import uuid
import json
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/opt/mafia-app/backend")

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ORIGIN_TOKENS = "system_ai_zwischenzug_token_share"
ORIGIN_LEFTOVER = "system_ai_zwischenzug_token_leftovers"
GP_ORIGIN = "system_ai_zwischenzug_game_pass_transfer"
AVATAR = "/images/system-ai-profile.jpg?v=5"
BACKUP = "/opt/mafia-app/backups/zwischenzug_ban_backup_20260904_010940.json"

EXCLUDE = {"system ai", "zwischenzug", "weiss", "piece", "hp"}  # HP excluded from GP
ADMIN_EMAILS = {e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()}

TOKEN_FIELDS = [
    "auto_collect_12h_tokens", "auto_collect_24h_tokens", "auto_rank_2h_tokens", "booze_tokens",
    "cooldown_skip_booze_tokens", "cooldown_skip_crime_tokens", "cooldown_skip_gta_tokens",
    "cooldown_skip_properties_tokens", "crew_oc_auto_apply_tokens", "jail_bailout_tokens",
    "jailbust_tokens", "melt_tokens", "mission_skip_tokens", "oc_reduced_tokens",
    "properties_tokens", "racket_tokens", "robot_bodyguard_hire_tokens", "travel_tokens",
    "xp_crimes_tokens", "xp_gta_tokens", "loot_box_pieces", "wheel_bonus_free_spins",
]

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

now = datetime.now(timezone.utc)
now_iso = now.isoformat()
online_cutoff = now - timedelta(minutes=5)
idle_cutoff = now - timedelta(minutes=10)


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

# Who already got the even split
got_ids = [
    e["user_id"]
    for e in db.point_ledger_events.find({"origin_ref": ORIGIN_TOKENS}, {"_id": 0, "user_id": 1})
]
n = len(got_ids)
print(f"Already received even split: {n}")

pool = {f: int(backup.get(f) or 0) for f in TOKEN_FIELDS}
leftovers = {f: pool[f] - (pool[f] // n) * n for f in TOKEN_FIELDS}
# Fields that gave 0 each: entire pool is leftover
zero_share = {f: pool[f] for f in TOKEN_FIELDS if pool[f] // n == 0}
print("Leftovers from floor split:", {k: v for k, v in leftovers.items() if v})
print("Zero-share pools (give 1 to first N):", zero_share)

# Active online recipients for leftovers + GP (not idle, not HP)
users = list(
    db.users.find(
        {"id": {"$in": got_ids}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "last_seen": 1,
            "forced_online_until": 1,
            "admin_ghost_mode": 1,
            "rank_xp_pass_rewards_granted": 1,
            "rank_xp_pass_token_expires_at": 1,
            "rank_xp_pass_tokens": 1,
            "rank_xp_pass_season_rp": 1,
            "rank_xp_pass_last_granted_micro_tier": 1,
            "rank_xp_pass_free_last_micro_tier_granted": 1,
        },
    )
)
active = []
for u in users:
    name = (u.get("username") or "").strip()
    if not name or name.lower() in EXCLUDE:
        continue
    if status_of(u) != "online":
        continue
    email = (u.get("email") or "").strip().lower()
    if email in ADMIN_EMAILS and u.get("admin_ghost_mode"):
        continue
    active.append(u)

active.sort(key=lambda u: _parse_iso(u.get("last_seen")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
print(f"Active (not idle) for leftovers/GP: {len(active)} → {', '.join(u.get('username') for u in active[:15])}...")

# Distribute leftover + zero-share: 1 token per person down the active list
# Track what each person gets from leftovers
extra_by_user = {u["id"]: {} for u in active}

def give_ones(field, count):
    given = 0
    for u in active:
        if given >= count:
            break
        uid = u["id"]
        extra_by_user[uid][field] = extra_by_user[uid].get(field, 0) + 1
        given += 1
    return given

# Zero-share fields: distribute whole pool as 1s
for field, total in zero_share.items():
    g = give_ones(field, total)
    print(f"  zero-share {field}: gave {g}/{total}")

# Remaining floor leftovers (where share >= 1): also 1 each to active
for field, left in leftovers.items():
    if field in zero_share:
        continue
    if left <= 0:
        continue
    g = give_ones(field, left)
    print(f"  leftover {field}: gave {g}/{left}")

# Apply extras
if not db.point_ledger_events.find_one({"origin_ref": ORIGIN_LEFTOVER}):
    for u in active:
        uid = u["id"]
        name = u.get("username")
        extras = {k: v for k, v in extra_by_user[uid].items() if v > 0}
        if not extras:
            continue
        db.users.update_one({"id": uid}, {"$inc": extras})
        db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": "system_ai_token_leftovers",
                "user_id": uid,
                "points": 0,
                "lot_id": None,
                "origin_ref": ORIGIN_LEFTOVER,
                "root_purchase_ref": None,
                "meta": {"extras": extras},
                "created_at": now_iso,
                "source": "system_ai",
            }
        )
        lines = [f"• +{amt}× {LABELS.get(f, f)}" for f, amt in extras.items()]
        db.notifications.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "title": "Extra token share",
                "message": (
                    f"{name},\n\n"
                    "This is the system AI.\n\n"
                    "Leftover tokens that did not divide evenly have been shared with players "
                    "who were actively online (not idle):\n\n"
                    + "\n".join(lines)
                    + "\n\n— System AI"
                ),
                "notification_type": "system",
                "category": "system",
                "read": False,
                "created_at": now_iso,
                "system_ai": True,
                "avatar_url": AVATAR,
            }
        )
        print(f"  leftover extras → {name}: {extras}")
else:
    print("Leftovers already applied — skip")

# Game Pass winner: first active without existing VIP, not GhostFace/HP
gp_expires = backup.get("rank_xp_pass_token_expires_at")
GP_SKIP = EXCLUDE | {"ghostface"}


def has_active_gp(u):
    if int(u.get("rank_xp_pass_tokens") or 0) > 0:
        return True
    if not u.get("rank_xp_pass_rewards_granted"):
        return False
    exp = _parse_iso(u.get("rank_xp_pass_token_expires_at"))
    return bool(exp and exp > now)


gp_candidates = [u for u in active if (u.get("username") or "").lower() not in GP_SKIP]
no_gp = [u for u in gp_candidates if not has_active_gp(u)]
gp_winner = (no_gp or gp_candidates)[0] if (no_gp or gp_candidates) else None
if not gp_winner:
    raise SystemExit("No GP winner")

print(f"\nGame Pass → {gp_winner.get('username')}")

if db.point_ledger_events.find_one({"origin_ref": GP_ORIGIN}):
    print("GP already transferred — skip")
else:
    uid = gp_winner["id"]
    name = gp_winner.get("username")
    season_rp = int(gp_winner.get("rank_xp_pass_season_rp") or 0)

    # Resolve current micro tier without importing armoury (circular)
    try:
        from utils.game_pass_micro_rewards import micro_tier_from_rank_points
        micro = int(micro_tier_from_rank_points(season_rp) or 0)
    except Exception:
        # Fallback: rough — don't re-grant by setting cursor high if unknown
        micro = int(gp_winner.get("rank_xp_pass_last_granted_micro_tier") or 0)

    if has_active_gp(gp_winner):
        their_exp = _parse_iso(gp_winner.get("rank_xp_pass_token_expires_at"))
        zw_exp = _parse_iso(gp_expires)
        new_exp = gp_expires
        if their_exp and zw_exp and their_exp > zw_exp:
            new_exp = their_exp.isoformat()
        db.users.update_one({"id": uid}, {"$set": {"rank_xp_pass_token_expires_at": new_exp}})
        action = f"extended to {new_exp}"
    else:
        # Transfer VIP window; set cursor to current micro so past tiers aren't re-granted
        db.users.update_one(
            {"id": uid},
            {
                "$set": {
                    "rank_xp_pass_tokens": 0,
                    "rank_xp_pass_token_expires_at": gp_expires,
                    "rank_xp_pass_rewards_granted": True,
                    "rank_xp_pass_tier_snapshot": season_rp,
                    "rank_xp_pass_last_granted_micro_tier": micro,
                    "rank_xp_pass_bonus_until": None,
                },
                "$unset": {"rank_xp_pass_pending_tier_snapshot": ""},
            },
        )
        action = f"VIP active until {gp_expires} (cursor micro={micro}, no backfill)"

    db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_game_pass_transfer",
            "user_id": uid,
            "points": 0,
            "lot_id": None,
            "origin_ref": GP_ORIGIN,
            "root_purchase_ref": None,
            "meta": {"from": "Zwischenzug", "to": name, "expires_at": gp_expires, "action": action},
            "created_at": now_iso,
            "source": "system_ai",
        }
    )
    db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": "Game Pass transferred",
            "message": (
                f"{name},\n\n"
                "This is the system AI.\n\n"
                "You were actively online (not idle), so Zwischenzug's remaining paid Game Pass "
                f"has been moved to you.\n\n"
                f"VIP is active until {gp_expires}.\n\n"
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
    # Fix the earlier PM that wrongly told HP they got GP (if HP got the token PM with got_gp=True)
    # Update HP's compensation PM if it mentioned Game Pass
    hp = db.users.find_one({"username": {"$regex": "^HP$", "$options": "i"}}, {"id": 1})
    if hp:
        db.notifications.update_many(
            {
                "user_id": hp["id"],
                "title": "Confiscated tokens",
                "message": {"$regex": "paid Game Pass"},
            },
            {
                "$set": {
                    "message": (
                        "HP,\n\n"
                        "This is the system AI.\n\n"
                        "Zwischenzug's confiscated inventory has been split between everyone who was online. "
                        "Your equal share is already on your account. "
                        "(Game Pass went to another active player.)\n\n"
                        "— System AI"
                    )
                }
            },
        )
        print("Corrected HP PM (removed false Game Pass claim)")

    print(f"Game Pass done: {name} — {action}")

print("\nDONE")
