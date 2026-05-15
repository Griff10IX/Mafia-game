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
