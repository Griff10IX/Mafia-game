"""Lifetime per-token benefit counters shown on My Inventory (Perks in use).

Stored on the user doc as token_perk_stats.<token_type>.<field> — best-effort,
never raises so it can be called from any hot path.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def bump_token_perk_stats(db, user_id: str, token_type: str, **fields) -> None:
    """$inc numeric benefit fields for one token type, e.g.
    await bump_token_perk_stats(db, uid, "xp_crimes", bonus_rp=120, uses=1)."""
    uid = (user_id or "").strip()
    if not uid or not token_type:
        return
    inc = {}
    for k, v in fields.items():
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n:
            inc[f"token_perk_stats.{token_type}.{k}"] = n
    if not inc:
        return
    try:
        await db.users.update_one({"id": uid}, {"$inc": inc})
    except Exception as e:
        logger.debug("token perk stats %s/%s: %s", uid, token_type, e)
