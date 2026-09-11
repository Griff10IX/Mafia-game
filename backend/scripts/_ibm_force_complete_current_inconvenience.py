"""Force-complete every player's current illegal-business (racket) mission,
advance them to the next, grant mission rewards, +1000 points, inconvenience notice.

Pure pymongo (no FastAPI imports). Mission defs from _ibm_missions_snapshot.json.

Idempotent via origin_ref system_ai_ibm_inconvenience_skip_20260904.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

POINTS = 1000
ORIGIN = "system_ai_ibm_inconvenience_skip_20260904"
AVATAR = "/images/system-ai-profile.jpg?v=5"
DRY_RUN = os.environ.get("DRY_RUN", "").strip().lower() in ("1", "true", "yes")

INCOME_PER_HOUR_BASE = 700
INCOME_CAP_HOURS_BASE = 24
INCOME_CAP_HOURS_MAX = 72
DEFENDER_STRENGTH_BONUS_CAP = 50
RAID_INCOMING_LOOT_MULT_MIN = 0.25
RAID_DAILY_LIMIT_DEFAULT = 5
RAID_DAILY_LIMIT_MAX = 10

# Token reward keys that appear on IBM missions
TOKEN_REWARD_FIELDS = (
    "xp_crimes_tokens",
    "xp_gta_tokens",
    "auto_rank_2h_tokens",
    "melt_tokens",
    "booze_tokens",
    "travel_tokens",
    "properties_tokens",
    "jailbust_tokens",
    "oc_reduced_tokens",
    "racket_tokens",
)

# Segment counters snapshotted into illegal_business_mission_baselines
SEGMENT_USER_FIELDS = {
    "crimes_in_state": "illegal_business_crimes_in_state",
    "collections": "illegal_business_collections",
    "raids_won": "illegal_business_raids_won",
    "raids_attempted": "illegal_business_raids_attempted",
    "guards_hired": "illegal_business_guards_hired",
    "guard_slots_bought": "illegal_business_guard_slots_bought",
    "vault_withdrawals": "illegal_business_vault_withdrawals",
    "hitlist_npc_kills": "illegal_business_hitlist_npc_kills",
}

now = datetime.now(timezone.utc)
now_iso = now.isoformat()

snap_path = Path(__file__).with_name("_ibm_missions_snapshot.json")
ordered = json.loads(snap_path.read_text(encoding="utf-8"))
ordered = sorted(ordered, key=lambda m: int(m["order"]))
print("missions", len(ordered), "dry_run", DRY_RUN)


def completed_ids(user: dict) -> set:
    return {c.get("mission_id") for c in (user.get("illegal_business_mission_completions") or []) if c.get("mission_id")}


def next_index(done: set) -> int:
    for i, m in enumerate(ordered, start=1):
        if m["id"] not in done:
            return i
    return len(ordered) + 1


def baseline_snap(user: dict, req: dict) -> dict:
    snap = {}
    for key in req:
        field = SEGMENT_USER_FIELDS.get(key)
        if field:
            snap[key] = int(user.get(field) or 0)
    return snap


def apply_business_rewards(business: dict, rewards: dict) -> dict:
    update_set = {}
    update_inc = {}
    if "income_mult" in rewards or "income_per_hour_add" in rewards:
        iph = int(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
        if "income_mult" in rewards:
            iph = int(iph * float(rewards["income_mult"]))
        if "income_per_hour_add" in rewards:
            iph += int(rewards["income_per_hour_add"])
        update_set["income_per_hour"] = max(0, iph)
    if "guard_weapon_max" in rewards:
        update_set["guard_weapon_max_unlock"] = int(business.get("guard_weapon_max_unlock") or 0) + int(
            rewards["guard_weapon_max"]
        )
    if "guard_armour_max" in rewards:
        cur_a = business.get("guard_armour_max_unlock")
        if cur_a is None:
            cur_a = int(business.get("guard_weapon_max_unlock") or 0)
        else:
            cur_a = int(cur_a)
        update_set["guard_armour_max_unlock"] = cur_a + int(rewards["guard_armour_max"])
    if rewards.get("guard_slots"):
        update_inc["guard_slots"] = int(rewards["guard_slots"])
    if rewards.get("income_cap_hours_add"):
        cur_cap = int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE)
        update_set["income_cap_hours"] = min(INCOME_CAP_HOURS_MAX, cur_cap + int(rewards["income_cap_hours_add"]))
    if rewards.get("defender_strength_bonus_add"):
        cur_b = int(business.get("defender_strength_bonus") or 0)
        update_set["defender_strength_bonus"] = min(
            DEFENDER_STRENGTH_BONUS_CAP, cur_b + int(rewards["defender_strength_bonus_add"])
        )
    if rewards.get("raid_incoming_loot_mult_sub") is not None:
        cur_m = float(business.get("raid_incoming_loot_mult") or 1.0)
        update_set["raid_incoming_loot_mult"] = max(
            RAID_INCOMING_LOOT_MULT_MIN, round(cur_m - float(rewards["raid_incoming_loot_mult_sub"]), 4)
        )
    if rewards.get("vault_cash"):
        update_inc["vault"] = int(rewards["vault_cash"])
        update_inc["vault_lifetime_earned"] = int(rewards["vault_cash"])
    out = {}
    if update_set:
        out["$set"] = update_set
    if update_inc:
        out["$inc"] = update_inc
    return out


advanced = []
skipped = []
errors = []

user_ids = sorted(
    {
        b.get("user_id")
        for b in db.illegal_businesses.find({}, {"_id": 0, "user_id": 1})
        if b.get("user_id")
    }
)
print("businesses", len(user_ids))

for uid in user_ids:
    try:
        if db.point_ledger_events.find_one({"user_id": uid, "origin_ref": ORIGIN}, {"_id": 1}):
            skipped.append((uid, "already"))
            continue

        user = db.users.find_one(
            {"id": uid, "is_npc": {"$ne": True}},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "points": 1,
                "is_dead": 1,
                "is_banned": 1,
                "illegal_business_mission_completions": 1,
                "illegal_business_raid_daily_limit": 1,
                **{f: 1 for f in SEGMENT_USER_FIELDS.values()},
            },
        )
        if not user:
            skipped.append((uid, "no_user_or_npc"))
            continue
        if user.get("is_banned"):
            skipped.append((uid, "banned"))
            continue
        if user.get("is_dead"):
            skipped.append((uid, "dead"))
            continue

        done = completed_ids(user)
        idx = next_index(done)
        if idx > len(ordered):
            skipped.append((uid, "all_complete"))
            continue

        mission = ordered[idx - 1]
        mission_id = mission["id"]
        rewards = mission.get("rewards") or {}
        uname = user.get("username") or "?"

        if DRY_RUN:
            print(f"DRY {uname} complete {mission_id} (#{idx}) -> next #{idx + 1}")
            advanced.append(uname)
            continue

        business = db.illegal_businesses.find_one({"user_id": uid}, {"_id": 0})
        if not business:
            skipped.append((uid, "no_biz"))
            continue

        user_updates = {
            "$push": {
                "illegal_business_mission_completions": {
                    "mission_id": mission_id,
                    "completed_at": now_iso,
                }
            }
        }
        token_inc = {f: int(rewards[f]) for f in TOKEN_REWARD_FIELDS if rewards.get(f)}
        if token_inc:
            user_updates["$inc"] = token_inc

        result = db.users.update_one(
            {"id": uid, "illegal_business_mission_completions.mission_id": {"$ne": mission_id}},
            user_updates,
        )
        if result.modified_count == 0:
            skipped.append((uid, "race_or_already"))
            continue

        if idx < len(ordered):
            nxt = ordered[idx]
            snap = baseline_snap(user, nxt.get("requirements") or {})
            db.users.update_one(
                {"id": uid},
                {"$set": {f"illegal_business_mission_baselines.{nxt['id']}": snap}},
            )

        if rewards.get("raid_daily_limit_add"):
            add = int(rewards["raid_daily_limit_add"])
            cur_lim = int(user.get("illegal_business_raid_daily_limit") or RAID_DAILY_LIMIT_DEFAULT)
            db.users.update_one(
                {"id": uid},
                {"$set": {"illegal_business_raid_daily_limit": min(RAID_DAILY_LIMIT_MAX, cur_lim + add)}},
            )

        biz_update = apply_business_rewards(business, rewards)
        if biz_update:
            db.illegal_businesses.update_one({"id": business["id"]}, biz_update)

        before = db.users.find_one_and_update(
            {"id": uid},
            {"$inc": {"points": POINTS}},
            projection={"_id": 0, "points": 1, "username": 1},
            return_document=ReturnDocument.BEFORE,
        )
        pts_before = int((before or {}).get("points") or 0)
        db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": "system_ai_ibm_inconvenience",
                "user_id": uid,
                "points": POINTS,
                "lot_id": None,
                "origin_ref": ORIGIN,
                "root_purchase_ref": None,
                "meta": {
                    "reason": "racket_mission_bug_inconvenience",
                    "completed_mission_id": mission_id,
                    "completed_display": idx,
                    "next_display": idx + 1,
                },
                "created_at": now_iso,
                "wallet_points_before": pts_before,
                "wallet_points_after": pts_before + POINTS,
                "source": "system_ai",
            }
        )

        if idx < len(ordered):
            next_title = ordered[idx].get("title") or ordered[idx]["id"]
        else:
            next_title = "all racket missions complete"

        db.notifications.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "title": "Racket missions — sorry for the inconvenience",
                "message": (
                    f"{uname},\n\n"
                    "This is the System AI.\n\n"
                    "We fixed a racket-mission bug (prestige was wiping rank progress on missions, "
                    "and mission 29 was too harsh). As an apology, your current racket mission "
                    f"({mission.get('title') or mission_id}) has been completed for you with its rewards, "
                    f"and you've been moved to the next step ({next_title}). "
                    f"You also received {POINTS:,} points for the inconvenience — already on your account.\n\n"
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
        print(f"OK {uname} {mission_id} -> next #{idx + 1} +{POINTS}pts")
        advanced.append(uname)
    except Exception as e:
        errors.append((uid, str(e)))
        print(f"ERR {uid}: {e}")

print("=" * 40)
print("advanced", len(advanced))
print("skipped", len(skipped))
print("errors", len(errors))
if skipped[:30]:
    print("skip sample", skipped[:30])
if errors:
    print("errors", errors)
