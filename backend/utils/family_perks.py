"""Family perks: monthly UTC calendar expiry, modifiers for Crew OC / melt / GTA / hitlist / rackets / booze."""
from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

# Costs (users.points)
FAMILY_PERK_COST_CREW_OC = 250
FAMILY_PERK_COST_CREW_OC_AUTO_COMMIT = 250
FAMILY_PERK_CREW_OC_AUTO_COMMIT_DAYS = 2
FAMILY_PERK_COST_MELT = 250
FAMILY_PERK_COST_GTA = 250
FAMILY_PERK_COST_HITLIST = 300
FAMILY_PERK_COST_RACKET = 500
FAMILY_PERK_COST_BOOZE_STEP = 50  # +15 cargo per step, max total bonus 300

FAMILY_PERK_CREW_OC_HOURS_OFF = 1
FAMILY_PERK_MELT_SECONDS_OFF = 5
FAMILY_PERK_GTA_SECONDS_OFF = 5
FAMILY_PERK_HITLIST_NPC_SLOTS = 2
FAMILY_PERK_RACKET_BONUS_PERCENT = 5
FAMILY_PERK_BOOZE_STEP_AMOUNT = 15
FAMILY_PERK_BOOZE_BONUS_CAP = 300

PERK_IDS = frozenset({"crew_oc", "crew_oc_auto_commit", "melt", "gta", "hitlist", "racket", "booze"})


def utc_calendar_month_end(now: Optional[datetime] = None) -> datetime:
    """Last microsecond of the current UTC calendar month (as exclusive boundary use next month start - 1µs, but ISO uses end of day)."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    y, m = now.year, now.month
    last_day = monthrange(y, m)[1]
    end = datetime(y, m, last_day, 23, 59, 59, 999999, tzinfo=timezone.utc)
    return end


def _parse_iso(val: Any) -> Optional[datetime]:
    if val is None:
        return None
    if hasattr(val, "year"):
        dt = val
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    try:
        s = str(val).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    except Exception:
        return None


def valid_until_active(valid_until_iso: Any, now: datetime) -> bool:
    dt = _parse_iso(valid_until_iso)
    if dt is None:
        return False
    return dt >= now


def clean_family_perks(perks: Optional[Dict[str, Any]], now: datetime) -> Dict[str, Any]:
    """Drop expired perk rows; reset booze cargo if booze month expired."""
    if not perks or not isinstance(perks, dict):
        return {}
    out: Dict[str, Any] = {}
    now = now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    for key in ("crew_oc", "crew_oc_auto_commit", "melt", "gta", "hitlist", "racket"):
        row = perks.get(key)
        if isinstance(row, dict) and valid_until_active(row.get("valid_until"), now):
            out[key] = dict(row)
    b = perks.get("booze")
    if isinstance(b, dict) and valid_until_active(b.get("valid_until"), now):
        cargo = int(b.get("cargo_bonus") or 0)
        cargo = max(0, min(FAMILY_PERK_BOOZE_BONUS_CAP, cargo))
        out["booze"] = {"valid_until": b.get("valid_until"), "cargo_bonus": cargo}
    return out


async def family_perk_modifiers(db, family_id: Optional[str]) -> Dict[str, Any]:
    """Resolved modifiers for gameplay (all zeros if no family / expired)."""
    empty = {
        "crew_oc_hours_off": 0,
        "melt_seconds_off": 0,
        "gta_seconds_off": 0,
        "hitlist_npc_slots": 0,
        "racket_bonus_percent": 0,
        "booze_cargo_bonus": 0,
    }
    if not family_id:
        return empty
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "family_perks": 1})
    now = datetime.now(timezone.utc)
    perks = clean_family_perks((fam or {}).get("family_perks") or {}, now)
    out = dict(empty)
    if perks.get("crew_oc"):
        out["crew_oc_hours_off"] = int(perks["crew_oc"].get("hours_off") or FAMILY_PERK_CREW_OC_HOURS_OFF)
    if perks.get("melt"):
        out["melt_seconds_off"] = int(perks["melt"].get("seconds_off") or FAMILY_PERK_MELT_SECONDS_OFF)
    if perks.get("gta"):
        out["gta_seconds_off"] = int(perks["gta"].get("seconds_off") or FAMILY_PERK_GTA_SECONDS_OFF)
    if perks.get("hitlist"):
        out["hitlist_npc_slots"] = int(perks["hitlist"].get("npc_bonus_slots") or FAMILY_PERK_HITLIST_NPC_SLOTS)
    if perks.get("racket"):
        out["racket_bonus_percent"] = int(perks["racket"].get("bonus_percent") or FAMILY_PERK_RACKET_BONUS_PERCENT)
    if perks.get("booze"):
        out["booze_cargo_bonus"] = int(perks["booze"].get("cargo_bonus") or 0)
    return out


def perk_catalog_prices() -> Dict[str, Any]:
    return {
        "crew_oc": {"cost": FAMILY_PERK_COST_CREW_OC, "label": "Crew OC cooldown −1h"},
        "crew_oc_auto_commit": {
            "cost": FAMILY_PERK_COST_CREW_OC_AUTO_COMMIT,
            "label": "Auto-commit Crew OC (10m after ad, 2d)",
        },
        "melt": {"cost": FAMILY_PERK_COST_MELT, "label": "Family melt cooldown −5s"},
        "gta": {"cost": FAMILY_PERK_COST_GTA, "label": "Family GTA cooldown −5s"},
        "hitlist": {"cost": FAMILY_PERK_COST_HITLIST, "label": "+2 hitlist NPC slots"},
        "racket": {"cost": FAMILY_PERK_COST_RACKET, "label": "+5% daily racket income"},
        "booze": {
            "cost_per_step": FAMILY_PERK_COST_BOOZE_STEP,
            "step_cargo": FAMILY_PERK_BOOZE_STEP_AMOUNT,
            "cap": FAMILY_PERK_BOOZE_BONUS_CAP,
            "label": "Booze run cargo",
        },
    }
