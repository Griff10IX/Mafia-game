# Normalize referred_by (legacy string or list) and split referral cuts across referrers.
from __future__ import annotations

from typing import Any, List, Sequence, Tuple


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
