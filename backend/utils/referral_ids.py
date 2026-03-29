# Normalize referred_by (legacy string or list) and split referral cuts across referrers.
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Sequence, Tuple

logger = logging.getLogger(__name__)


def normalize_referred_by_ids(raw: Any) -> List[str]:
    """Return ordered unique referrer user ids. Accepts legacy single string or list."""
    if raw is None:
        return []
    if isinstance(raw, str):
        s = raw.strip()
        return [s] if s else []
    if isinstance(raw, list):
        out: List[str] = []
        seen = set()
        for x in raw:
            sid = str(x).strip() if x is not None else ""
            if sid and sid not in seen:
                seen.add(sid)
                out.append(sid)
        return out
    return []


def user_has_referrers(raw: Any) -> bool:
    return bool(normalize_referred_by_ids(raw))


def split_referral_pool(pool: int, referrer_ids: Sequence[str], *, self_id: str) -> List[Tuple[str, int]]:
    """Split integer pool evenly across referrers (excludes self). Remainder to first ids."""
    sid = str(self_id or "").strip()
    ids = [str(r).strip() for r in referrer_ids if r and str(r).strip() and str(r).strip() != sid]
    pool = int(pool)
    if pool <= 0 or not ids:
        return []
    n = len(ids)
    base = pool // n
    rem = pool % n
    return [(ids[i], base + (1 if i < rem else 0)) for i in range(n)]


def referral_pool_int(base: int, fraction: float) -> int:
    """Integer cut of base * fraction using ceil (not trunc). Avoids int() rounding small payouts to zero."""
    b = int(base)
    if b <= 0 or fraction <= 0:
        return 0
    return max(0, int(math.ceil(b * fraction - 1e-12)))


async def apply_referrer_referral_increment(db, referrer_id: str, inc: Dict[str, int], *, context: str = "") -> bool:
    """$inc on referrer by user id; logs if no document matched (mis-linked referred_by)."""
    rid = str(referrer_id or "").strip()
    if not rid or not inc:
        return False
    res = await db.users.update_one({"id": rid}, {"$inc": inc})
    if res.matched_count:
        return True
    logger.warning("referral payout: no user matched id=%s context=%s inc=%s", rid, context or "?", inc)
    return False
