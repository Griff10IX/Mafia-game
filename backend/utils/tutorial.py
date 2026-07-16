"""New-player tutorial progress, anti-abuse claims, and completion rewards."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

TUTORIAL_STEPS = (
    "theme",
    "crimes",
    "gta",
    "auto_rank",
    "travel",
    "jail",
    "distillery",
    "missions",
)
TUTORIAL_STATUS_PENDING = "pending"
TUTORIAL_STATUS_IN_PROGRESS = "in_progress"
TUTORIAL_STATUS_COMPLETED = "completed"
TUTORIAL_STATUS_SKIPPED = "skipped"

TUTORIAL_RESPECT_REWARD = 3000
TUTORIAL_ROBOT_COUNT = 2
TUTORIAL_CLAIMS_COLLECTION = "tutorial_reward_claims"
TUTORIAL_REDIRECT = "/money/loot-box?tier=rare&tutorial=1"
# game_config id — default OFF so staff can test via Admin before enabling for all new players.
TUTORIAL_CONFIG_ID = "new_player_tutorial"
TUTORIAL_ENABLED_DEFAULT = False


async def is_tutorial_globally_enabled(db) -> bool:
    """Whether new players get the coach automatically. Admin start-for-me always works."""
    try:
        doc = await db.game_config.find_one(
            {"id": TUTORIAL_CONFIG_ID},
            {"_id": 0, "enabled": 1},
        )
        if doc is None:
            return TUTORIAL_ENABLED_DEFAULT
        return bool(doc.get("enabled"))
    except Exception:
        logger.exception("tutorial global enabled read failed")
        return TUTORIAL_ENABLED_DEFAULT


async def set_tutorial_globally_enabled(db, enabled: bool) -> bool:
    await db.game_config.update_one(
        {"id": TUTORIAL_CONFIG_ID},
        {
            "$set": {
                "id": TUTORIAL_CONFIG_ID,
                "enabled": bool(enabled),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )
    return bool(enabled)


def normalize_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


def normalize_ip(ip: Optional[str]) -> str:
    return (ip or "").strip()


def next_step_after(step: Optional[str]) -> Optional[str]:
    if not step:
        return TUTORIAL_STEPS[0]
    try:
        idx = TUTORIAL_STEPS.index(step)
    except ValueError:
        return TUTORIAL_STEPS[0]
    if idx + 1 >= len(TUTORIAL_STEPS):
        return None
    return TUTORIAL_STEPS[idx + 1]


def effective_tutorial_status(user: dict) -> str:
    raw = (user.get("tutorial_status") or "").strip().lower()
    if raw in (
        TUTORIAL_STATUS_PENDING,
        TUTORIAL_STATUS_IN_PROGRESS,
        TUTORIAL_STATUS_COMPLETED,
        TUTORIAL_STATUS_SKIPPED,
    ):
        return raw
    # Existing accounts without the field: do not force tutorial.
    if user.get("tutorial_status") is None and user.get("created_at"):
        return TUTORIAL_STATUS_SKIPPED
    return TUTORIAL_STATUS_PENDING


async def ensure_tutorial_indexes(db) -> None:
    col = db[TUTORIAL_CLAIMS_COLLECTION]
    try:
        await col.create_index(
            [("kind", 1), ("key", 1)],
            unique=True,
            name="tutorial_claim_kind_key",
        )
    except Exception:
        logger.exception("tutorial claim index ensure failed")


async def find_claim(db, *, kind: str, key: str) -> Optional[dict]:
    if not key:
        return None
    return await db[TUTORIAL_CLAIMS_COLLECTION].find_one(
        {"kind": kind, "key": key},
        {"_id": 0},
    )


async def email_or_ip_already_claimed(
    db,
    *,
    email: Optional[str] = None,
    ip: Optional[str] = None,
) -> Tuple[bool, Optional[str]]:
    email_norm = normalize_email(email)
    ip_norm = normalize_ip(ip)
    if email_norm:
        if await find_claim(db, kind="email", key=email_norm):
            return True, "email"
    if ip_norm:
        if await find_claim(db, kind="ip", key=ip_norm):
            return True, "ip"
    return False, None


async def resolve_tutorial_eligibility(db, user: dict, *, request_ip: Optional[str] = None) -> dict:
    """
    Returns status fields for the user. May persist auto-skip when email/IP already claimed.
    When the global tutorial flag is off, pending players are not eligible (no coach);
    in_progress (e.g. admin test) can continue.
    """
    globally_enabled = await is_tutorial_globally_enabled(db)
    status = effective_tutorial_status(user)
    if status in (TUTORIAL_STATUS_COMPLETED, TUTORIAL_STATUS_SKIPPED):
        return {
            "tutorial_status": status,
            "tutorial_step": user.get("tutorial_step"),
            "tutorial_crime_done": bool(user.get("tutorial_crime_done")),
            "tutorial_gta_done": bool(user.get("tutorial_gta_done")),
            "tutorial_theme_done": bool(user.get("tutorial_theme_done")),
            "tutorial_rewards_granted": bool(user.get("tutorial_rewards_granted")),
            "tutorial_ineligible_reason": user.get("tutorial_ineligible_reason"),
            "tutorial_enabled": globally_enabled,
            "eligible": False,
        }

    email = user.get("email")
    ip = normalize_ip(user.get("registration_ip")) or normalize_ip(request_ip)
    claimed, reason = await email_or_ip_already_claimed(db, email=email, ip=ip)
    if claimed or bool(user.get("tutorial_rewards_granted")):
        reason = reason or "already_granted"
        await db.users.update_one(
            {"id": user["id"]},
            {
                "$set": {
                    "tutorial_status": TUTORIAL_STATUS_SKIPPED,
                    "tutorial_ineligible_reason": reason,
                }
            },
        )
        return {
            "tutorial_status": TUTORIAL_STATUS_SKIPPED,
            "tutorial_step": user.get("tutorial_step"),
            "tutorial_crime_done": bool(user.get("tutorial_crime_done")),
            "tutorial_gta_done": bool(user.get("tutorial_gta_done")),
            "tutorial_theme_done": bool(user.get("tutorial_theme_done")),
            "tutorial_rewards_granted": bool(user.get("tutorial_rewards_granted")),
            "tutorial_ineligible_reason": reason,
            "tutorial_enabled": globally_enabled,
            "eligible": False,
        }

    # Global kill-switch: new players do not auto-start until Admin enables the tutorial.
    if not globally_enabled and status != TUTORIAL_STATUS_IN_PROGRESS:
        return {
            "tutorial_status": status,
            "tutorial_step": user.get("tutorial_step"),
            "tutorial_crime_done": bool(user.get("tutorial_crime_done")),
            "tutorial_gta_done": bool(user.get("tutorial_gta_done")),
            "tutorial_theme_done": bool(user.get("tutorial_theme_done")),
            "tutorial_rewards_granted": False,
            "tutorial_ineligible_reason": "disabled",
            "tutorial_enabled": False,
            "eligible": False,
        }

    return {
        "tutorial_status": status,
        "tutorial_step": user.get("tutorial_step") or (
            TUTORIAL_STEPS[0] if status == TUTORIAL_STATUS_IN_PROGRESS else None
        ),
        "tutorial_crime_done": bool(user.get("tutorial_crime_done")),
        "tutorial_gta_done": bool(user.get("tutorial_gta_done")),
        "tutorial_theme_done": bool(user.get("tutorial_theme_done")),
        "tutorial_rewards_granted": False,
        "tutorial_ineligible_reason": None,
        "tutorial_enabled": globally_enabled,
        "eligible": status in (TUTORIAL_STATUS_PENDING, TUTORIAL_STATUS_IN_PROGRESS),
    }


async def mark_tutorial_crime_done(db, user_id: str) -> None:
    if not user_id:
        return
    await db.users.update_one(
        {
            "id": user_id,
            "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
            "tutorial_step": "crimes",
            "tutorial_crime_done": {"$ne": True},
        },
        {"$set": {"tutorial_crime_done": True}},
    )


async def mark_tutorial_gta_done(db, user_id: str) -> None:
    if not user_id:
        return
    await db.users.update_one(
        {
            "id": user_id,
            "tutorial_status": TUTORIAL_STATUS_IN_PROGRESS,
            "tutorial_step": "gta",
            "tutorial_gta_done": {"$ne": True},
        },
        {"$set": {"tutorial_gta_done": True}},
    )


async def _hire_free_robots(db, user: dict, count: int = TUTORIAL_ROBOT_COUNT) -> List[dict]:
    from routers.kill.bodyguards import _create_robot_bodyguard_user

    owner_id = user.get("id")
    if not owner_id or count <= 0:
        return []
    existing = await db.bodyguards.find(
        {"user_id": owner_id},
        {"_id": 0, "slot_number": 1},
    ).to_list(10)
    occupied = {int(b.get("slot_number") or 0) for b in existing}
    empty_slots = [s for s in range(1, 5) if s not in occupied]
    hired = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for slot in empty_slots[:count]:
        try:
            robot_user_id, robot_name, robot_initial_state = await _create_robot_bodyguard_user(user)
        except Exception:
            logger.exception("tutorial free robot create failed user_id=%s slot=%s", owner_id, slot)
            break
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": owner_id,
            "owner_username": user.get("username"),
            "slot_number": slot,
            "is_robot": True,
            "robot_name": robot_name,
            "bodyguard_user_id": robot_user_id,
            "health": 100,
            "armour_level": 0,
            "hired_at": now_iso,
            "hire_cost": 0,
            "tutorial_grant": True,
        }
        await db.bodyguards.insert_one(doc)
        await db.users.update_one(
            {"id": owner_id},
            {"$max": {"bodyguard_slots": slot}, "$inc": {"bodyguard_lifetime_hires": 1}},
        )
        hired.append(
            {
                "slot": slot,
                "robot_name": robot_name,
                "robot_user_id": robot_user_id,
                "robot_initial_state": robot_initial_state,
            }
        )
    return hired


async def _insert_claims(
    db,
    *,
    user_id: str,
    username: Optional[str],
    email_norm: str,
    ip_norm: str,
) -> Tuple[bool, Optional[str]]:
    """Insert email/IP claims. Returns (ok, blocked_reason)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    col = db[TUTORIAL_CLAIMS_COLLECTION]
    docs = []
    if email_norm:
        docs.append(
            {
                "id": str(uuid.uuid4()),
                "kind": "email",
                "key": email_norm,
                "user_id": user_id,
                "username": username or "?",
                "claimed_at": now_iso,
            }
        )
    if ip_norm:
        docs.append(
            {
                "id": str(uuid.uuid4()),
                "kind": "ip",
                "key": ip_norm,
                "user_id": user_id,
                "username": username or "?",
                "claimed_at": now_iso,
            }
        )
    for doc in docs:
        try:
            await col.insert_one(doc)
        except Exception:
            # Unique index race — already claimed
            return False, doc["kind"]
    return True, None


async def grant_tutorial_completion_rewards(
    db,
    user: dict,
    *,
    request_ip: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Grant rewards once. Returns payload for client.
    If claims already exist, marks completed without rewards.
    """
    from server import log_respect_delta, send_notification

    user_id = user.get("id")
    if not user_id:
        return {"granted": False, "reason": "no_user"}

    fresh = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "registration_ip": 1,
            "tutorial_rewards_granted": 1,
            "tutorial_status": 1,
        },
    )
    if not fresh:
        return {"granted": False, "reason": "no_user"}

    now_iso = datetime.now(timezone.utc).isoformat()
    if fresh.get("tutorial_rewards_granted"):
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"tutorial_status": TUTORIAL_STATUS_COMPLETED, "tutorial_completed_at": now_iso}},
        )
        return {
            "granted": False,
            "reason": "already_granted",
            "redirect": TUTORIAL_REDIRECT,
            "loot_box_free_rare_opens": int((await db.users.find_one({"id": user_id}, {"loot_box_free_rare_opens": 1}) or {}).get("loot_box_free_rare_opens") or 0),
        }

    email_norm = normalize_email(fresh.get("email"))
    ip_norm = normalize_ip(fresh.get("registration_ip")) or normalize_ip(request_ip)
    claimed, reason = await email_or_ip_already_claimed(db, email=email_norm, ip=ip_norm)
    if claimed:
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "tutorial_status": TUTORIAL_STATUS_COMPLETED,
                    "tutorial_completed_at": now_iso,
                    "tutorial_ineligible_reason": reason,
                }
            },
        )
        return {"granted": False, "reason": reason or "already_claimed", "redirect": None}

    claim_ok, blocked = await _insert_claims(
        db,
        user_id=user_id,
        username=fresh.get("username"),
        email_norm=email_norm,
        ip_norm=ip_norm,
    )
    if not claim_ok:
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "tutorial_status": TUTORIAL_STATUS_COMPLETED,
                    "tutorial_completed_at": now_iso,
                    "tutorial_ineligible_reason": blocked,
                }
            },
        )
        return {"granted": False, "reason": blocked or "claim_race", "redirect": None}

    guard = await db.users.update_one(
        {"id": user_id, "tutorial_rewards_granted": {"$ne": True}},
        {
            "$set": {
                "tutorial_rewards_granted": True,
                "tutorial_status": TUTORIAL_STATUS_COMPLETED,
                "tutorial_completed_at": now_iso,
                "tutorial_step": "missions",
            },
            "$inc": {
                "respect_points": TUTORIAL_RESPECT_REWARD,
                "loot_box_free_rare_opens": 1,
            },
        },
    )
    if guard.modified_count == 0:
        return {"granted": False, "reason": "already_granted", "redirect": TUTORIAL_REDIRECT}

    try:
        await log_respect_delta(user_id, TUTORIAL_RESPECT_REWARD, "tutorial_complete")
    except Exception:
        logger.exception("tutorial respect log failed user_id=%s", user_id)

    robots = []
    try:
        robots = await _hire_free_robots(db, {**fresh, **user}, TUTORIAL_ROBOT_COUNT)
    except Exception:
        logger.exception("tutorial robot grant failed user_id=%s", user_id)

    try:
        await send_notification(
            user_id,
            "Tutorial complete",
            (
                f"You earned {TUTORIAL_RESPECT_REWARD:,} respect, "
                f"{len(robots)} robot bodyguard(s), and a free Rare loot box. Open it now!"
            ),
            "reward",
        )
    except Exception:
        logger.exception("tutorial reward notification failed user_id=%s", user_id)

    return {
        "granted": True,
        "respect": TUTORIAL_RESPECT_REWARD,
        "robots_hired": len(robots),
        "robots": robots,
        "free_rare_box": True,
        "redirect": TUTORIAL_REDIRECT,
        "loot_box_free_rare_opens": 1,
    }


async def clear_tutorial_claims_for_user(db, user: dict) -> int:
    email_norm = normalize_email(user.get("email"))
    ip_norm = normalize_ip(user.get("registration_ip"))
    deleted = 0
    if email_norm:
        r = await db[TUTORIAL_CLAIMS_COLLECTION].delete_many({"kind": "email", "key": email_norm})
        deleted += int(r.deleted_count or 0)
    if ip_norm:
        r = await db[TUTORIAL_CLAIMS_COLLECTION].delete_many({"kind": "ip", "key": ip_norm})
        deleted += int(r.deleted_count or 0)
    r2 = await db[TUTORIAL_CLAIMS_COLLECTION].delete_many({"user_id": user.get("id")})
    deleted += int(r2.deleted_count or 0)
    return deleted
