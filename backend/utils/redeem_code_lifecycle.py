"""Redeem codes: release global slots when a character dies so new accounts can use limited codes.

Also records redeemed code strings on the dead user so a revived character cannot claim the same
codes again after their id was removed from redeem_codes.used_by.

release_redeem_slots_for_deceased_user is invoked from: kill/attack (player victim), admin kill,
dead_alive (reviver death), server_backup execute_attack mirror, and reconcile_stale_dead_redeemers_on_code
for any is_dead user still listed in used_by.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


class RedeemCodeError(ValueError):
    """A player-facing redeem-code failure."""


async def apply_redeem_code(db: Any, user: dict, code: str) -> dict:
    """Atomically claim and grant one redeem code for a user."""
    from routers.kill.armoury import TOKEN_CONFIG
    from utils.point_provenance import log_points_event

    code_normalized = (code or "").strip().upper()
    if not code_normalized:
        raise RedeemCodeError("Code is required")
    user_id = user.get("id")
    if not user_id:
        raise RedeemCodeError("Not authenticated")
    if code_normalized in (user.get("redeemed_codes") or []):
        raise RedeemCodeError("This character has already redeemed this code.")

    await reconcile_stale_dead_redeemers_on_code(db, code_normalized)
    doc = await db.redeem_codes.find_one({"code": code_normalized, "active": True})
    if not doc:
        raise RedeemCodeError("Invalid or inactive code")
    used_by = doc.get("used_by") or []
    if user_id in used_by:
        raise RedeemCodeError("This character is already recorded for this redeem code.")
    max_uses = doc.get("max_uses")
    used_count = int(doc.get("used_count", 0))
    if max_uses is not None and used_count >= max_uses:
        raise RedeemCodeError("This code has no redemptions left.")

    claim_filter = {
        "code": code_normalized,
        "active": True,
        "used_by": {"$nin": [user_id]},
    }
    if max_uses is not None:
        claim_filter["used_count"] = {"$lt": int(max_uses)}
    claimed = await db.redeem_codes.find_one_and_update(
        claim_filter,
        {"$inc": {"used_count": 1}, "$push": {"used_by": user_id}},
    )
    if not claimed:
        raise RedeemCodeError("Could not claim this code (try again).")
    new_used = int(claimed.get("used_count", 0)) + 1

    rewards = doc.get("rewards") or {}
    inc = {}
    if rewards.get("money"):
        inc["money"] = int(rewards["money"])
    if rewards.get("points"):
        inc["points"] = int(rewards["points"])
    if rewards.get("respect_points"):
        inc["respect_points"] = int(rewards["respect_points"])
    if rewards.get("loot_box_pieces"):
        inc["loot_box_pieces"] = int(rewards["loot_box_pieces"])
    if rewards.get("bullets"):
        inc["bullets"] = int(rewards["bullets"])
    for token_type, amount in (rewards.get("tokens") or {}).items():
        if token_type == "rank_xp_pass":
            continue
        cfg = TOKEN_CONFIG.get(token_type)
        if cfg and amount:
            inc[cfg["count_field"]] = int(amount)
    inc["redeem_stats_total_money"] = int(rewards.get("money") or 0)
    inc["redeem_stats_total_points"] = int(rewards.get("points") or 0)
    inc["redeem_stats_total_respect_points"] = int(rewards.get("respect_points") or 0)
    inc["redeem_stats_total_loot_box_pieces"] = int(rewards.get("loot_box_pieces") or 0)
    inc["redeem_stats_total_bullets"] = int(rewards.get("bullets") or 0)
    # Cars no longer granted via redeem codes (GTA / dealer / store / admin only).
    inc["redeem_stats_total_cars"] = 0
    inc["redeem_stats_total_tokens"] = sum(
        int(amount)
        for token_type, amount in (rewards.get("tokens") or {}).items()
        if token_type != "rank_xp_pass"
    )
    update = {"$addToSet": {"redeemed_codes": code_normalized}}
    if inc:
        update["$inc"] = inc
    await db.users.update_one({"id": user_id}, update)

    if inc.get("points", 0) > 0:
        await log_points_event(
            db,
            user_id=user_id,
            points=inc["points"],
            event_type="redeem_code",
            event_ref=code_normalized,
            meta={"code": code_normalized},
        )

    topic_id = doc.get("forum_topic_id")
    if topic_id and max_uses is not None and new_used >= int(max_uses):
        from routers.social.forum import remove_redeem_code_forum_topic

        await remove_redeem_code_forum_topic(topic_id)
        await db.redeem_codes.update_one(
            {"code": code_normalized},
            {"$unset": {"forum_topic_id": ""}},
        )

    granted = []
    if inc.get("money"):
        granted.append(f"${inc['money']:,} cash")
    if inc.get("points"):
        granted.append(f"{inc['points']:,} points")
    if inc.get("respect_points"):
        granted.append(f"{inc['respect_points']:,} respect")
    if inc.get("loot_box_pieces"):
        granted.append(f"{inc['loot_box_pieces']} loot pieces")
    if inc.get("bullets"):
        granted.append(f"{inc['bullets']:,} bullets")
    for token_type, amount in (rewards.get("tokens") or {}).items():
        if token_type != "rank_xp_pass" and amount:
            granted.append(f"{amount} {token_type.replace('_', ' ')} token(s)")
    if rewards.get("cars"):
        granted.append("(car rewards skipped — cars only from GTA / dealer / store)")
    return {
        "message": "Code redeemed successfully",
        "code": code_normalized,
        "granted": granted,
    }


async def release_redeem_slots_for_deceased_user(db: Any, user_id: str) -> None:
    """Remove user_id from all redeem_codes.used_by (and decrements used_count); remember codes on the user."""
    if not user_id:
        return
    try:
        cursor = db.redeem_codes.find({"used_by": user_id}, {"_id": 0, "code": 1})
        code_list = [d["code"] async for d in cursor if d.get("code")]
        if not code_list:
            return
        await db.users.update_one(
            {"id": user_id},
            {"$addToSet": {"redeemed_codes": {"$each": code_list}}},
        )
        await db.redeem_codes.update_many(
            {"used_by": user_id},
            {"$pull": {"used_by": user_id}, "$inc": {"used_count": -1}},
        )
    except Exception:
        logger.exception("release_redeem_slots_for_deceased_user failed user_id=%s", user_id)


async def reconcile_stale_dead_redeemers_on_code(db: Any, code_normalized: str) -> None:
    """If dead accounts still occupy used_by for this code (legacy or pre-deploy deaths), release their slots.

    Then set used_count to len(used_by) so legacy drift (e.g. empty used_by but used_count > 0) cannot block redemptions.
    """
    if not code_normalized:
        return
    try:
        doc = await db.redeem_codes.find_one({"code": code_normalized}, {"_id": 0, "used_by": 1})
        if not doc:
            return
        used_by = doc.get("used_by") or []
        if used_by:
            uid_list = list(dict.fromkeys(used_by))
            dead_ids = [
                r["id"]
                async for r in db.users.find(
                    {"id": {"$in": uid_list}, "is_dead": True},
                    {"_id": 0, "id": 1},
                )
            ]
            for did in dead_ids:
                await release_redeem_slots_for_deceased_user(db, did)
        doc2 = await db.redeem_codes.find_one({"code": code_normalized}, {"_id": 0, "used_by": 1, "used_count": 1})
        if not doc2:
            return
        ub = doc2.get("used_by") or []
        n = len(ub)
        current = int(doc2.get("used_count", 0) or 0)
        if current != n:
            await db.redeem_codes.update_one({"code": code_normalized}, {"$set": {"used_count": n}})
    except Exception:
        logger.exception("reconcile_stale_dead_redeemers_on_code failed code=%s", code_normalized)
