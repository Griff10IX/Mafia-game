# Live bank economy: Swiss default cap + interest deposit terms (game_settings overrides).
from __future__ import annotations

from typing import Any, Dict, List, Optional

KEY_SWISS_DEFAULT = "bank_swiss_default_limit"
KEY_INTEREST_MAX = "bank_interest_max_unclaimed_principal"
KEY_INTEREST_OPTIONS = "bank_interest_options"


def normalize_interest_options(raw: Any, fallback: List[dict]) -> List[dict]:
    """Return sorted list of {hours, rate}; invalid entries dropped. fallback used if raw unusable."""
    if not isinstance(raw, list) or not raw:
        return [dict(x) for x in fallback]
    out: List[dict] = []
    seen_hours: set = set()
    for x in raw:
        if not isinstance(x, dict):
            continue
        try:
            h = int(x.get("hours", 0) or 0)
            rate = float(x.get("rate", 0) or 0)
        except (TypeError, ValueError):
            continue
        if h < 1 or h > 24 * 30:
            continue
        if rate < 0 or rate > 10:
            continue
        if h in seen_hours:
            continue
        seen_hours.add(h)
        out.append({"hours": h, "rate": rate})
    if not out:
        return [dict(x) for x in fallback]
    return sorted(out, key=lambda o: o["hours"])


async def get_bank_economy_config(
    db,
    *,
    swiss_fallback: int,
    interest_max_fallback: int,
    interest_options_fallback: List[dict],
) -> Dict[str, Any]:
    keys = [KEY_SWISS_DEFAULT, KEY_INTEREST_MAX, KEY_INTEREST_OPTIONS]
    docs = await db.game_settings.find({"key": {"$in": keys}}, {"_id": 0, "key": 1, "value": 1}).to_list(10)
    by_k = {d.get("key"): d.get("value") for d in docs if d.get("key")}

    swiss = swiss_fallback
    raw_sw = by_k.get(KEY_SWISS_DEFAULT)
    if raw_sw is not None:
        try:
            swiss = max(1_000, min(int(raw_sw), 10**15))
        except (TypeError, ValueError):
            swiss = swiss_fallback

    mx = interest_max_fallback
    raw_mx = by_k.get(KEY_INTEREST_MAX)
    if raw_mx is not None:
        try:
            mx = max(1, min(int(raw_mx), 10**15))
        except (TypeError, ValueError):
            mx = interest_max_fallback

    opts = normalize_interest_options(by_k.get(KEY_INTEREST_OPTIONS), interest_options_fallback)

    return {
        "swiss_limit_start": swiss,
        "interest_max_unclaimed_principal": mx,
        "interest_options": opts,
    }


def interest_option_for_hours(options: List[dict], duration_hours: int) -> Optional[dict]:
    try:
        h = int(duration_hours)
    except (TypeError, ValueError):
        return None
    return next((o for o in options if int(o.get("hours", 0) or 0) == h), None)


def compute_bank_interest_previews(interest_options: List[dict], principals: List[int]) -> List[dict]:
    """For admin UI: sample maturity math per principal."""
    out: List[dict] = []
    opts = sorted(interest_options, key=lambda x: int(x.get("hours", 0) or 0))
    for p in principals:
        try:
            principal = max(0, int(p))
        except (TypeError, ValueError):
            continue
        rows = []
        for o in opts:
            h = int(o.get("hours", 0) or 0)
            rate = float(o.get("rate", 0) or 0)
            interest = int(round(principal * rate))
            rows.append(
                {
                    "hours": h,
                    "rate": rate,
                    "rate_percent": round(rate * 100, 4),
                    "interest": interest,
                    "maturity_total": principal + interest,
                }
            )
        out.append({"principal": principal, "options": rows})
    return out
