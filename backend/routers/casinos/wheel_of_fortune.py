# House Wheel of Fortune: free daily spin + paid spins (points or respect). Server-weighted prizes.
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from server import (
    db,
    get_current_user_verified,
    log_activity,
    log_gambling,
    log_respect_delta,
    _is_admin,
)
from utils.casino_page_rl import casinos_sustained_rl_dependencies
from utils.point_provenance import consume_points_fifo
from utils.gambling_self_ban import raise_if_gambling_self_banned

logger = logging.getLogger(__name__)
_rng = secrets.SystemRandom()

_casinos_rl_u = casinos_sustained_rl_dependencies(db, get_current_user_verified)

WHEEL_PAID_SPIN_POINTS = 100
WHEEL_PAID_SPIN_RESPECT = 300  # 3× points cost
WHEEL_PAID_SPINS_PER_DAY = 3
WHEEL_FREE_COOLDOWN = timedelta(hours=24)
WHEEL_RECENT_WINS_LIMIT = 5
WHEEL_WINS_COLLECTION = "wheel_of_fortune_wins"

# token_type -> user count field (store / armoury; no game pass)
TOKEN_FIELD_MAP: Dict[str, str] = {
    "xp_crimes": "xp_crimes_tokens",
    "xp_gta": "xp_gta_tokens",
    "melt": "melt_tokens",
    "oc_reduced": "oc_reduced_tokens",
    "booze": "booze_tokens",
    "racket": "racket_tokens",
    "properties": "properties_tokens",
    "travel": "travel_tokens",
    "jailbust_bonus": "jailbust_tokens",
    "auto_rank_2h": "auto_rank_2h_tokens",
    "crew_oc_auto_3h": "crew_oc_auto_apply_tokens",
    "auto_collect_12h": "auto_collect_12h_tokens",
    "auto_collect_24h": "auto_collect_24h_tokens",
    "jail_bailout": "jail_bailout_tokens",
    "cooldown_skip_crime": "cooldown_skip_crime_tokens",
    "cooldown_skip_gta": "cooldown_skip_gta_tokens",
    "cooldown_skip_booze": "cooldown_skip_booze_tokens",
    "cooldown_skip_properties": "cooldown_skip_properties_tokens",
}

TOKEN_LABELS: Dict[str, Tuple[str, str]] = {
    "xp_crimes": ("Crimes XP ×3", "CXP"),
    "xp_gta": ("GTA XP ×3", "GXP"),
    "melt": ("Melt ×3", "Melt"),
    "oc_reduced": ("OC ×3", "OC"),
    "booze": ("Booze ×3", "Booze"),
    "racket": ("Racket ×3", "Rkt"),
    "properties": ("Properties ×3", "Prop"),
    "travel": ("Travel ×3", "Trvl"),
    "jailbust_bonus": ("Jailbust ×3", "Bust"),
    "auto_rank_2h": ("Auto Rank 2h ×3", "AR"),
    "crew_oc_auto_3h": ("Crew OC ×3", "Crew"),
    "auto_collect_12h": ("Auto Collect 12h ×3", "AC12"),
    "auto_collect_24h": ("Auto Collect 24h ×3", "AC24"),
    "jail_bailout": ("Jail Bailout ×3", "Bail"),
    "cooldown_skip_crime": ("Crime Skip ×3", "SkC"),
    "cooldown_skip_gta": ("GTA Skip ×3", "SkG"),
    "cooldown_skip_booze": ("Booze Skip ×3", "SkB"),
    "cooldown_skip_properties": ("Props Skip ×3", "SkP"),
}

# Mafia palette alternating charcoal / burgundy / gold accents
_COLORS = (
    "#1a1410",
    "#3d1f1f",
    "#2a2218",
    "#5c2b2b",
    "#1f1814",
    "#8B6914",
    "#2c1810",
    "#4a2020",
)


def _build_segments() -> List[Dict[str, Any]]:
    segs: List[Dict[str, Any]] = []

    def add(
        sid: str,
        label: str,
        short: str,
        tier: str,
        weight: int,
        prize: Dict[str, Any],
        color: Optional[str] = None,
    ) -> None:
        segs.append(
            {
                "id": sid,
                "label": label,
                "short": short,
                "tier": tier,
                "weight": int(weight),
                "prize": prize,
                "color": color or _COLORS[len(segs) % len(_COLORS)],
            }
        )

    add("rare_points_2500", "2,500 Points", "2.5K", "rare", 2, {"kind": "points", "amount": 2500}, "#FFD700")
    add("jackpot_loot", "1,000 Loot Pieces", "Loot", "jackpot", 2, {"kind": "loot_box_pieces", "amount": 1000}, "#E8C547")
    add(
        "jackpot_mission_skip",
        "Mission Skip",
        "MSkip",
        "jackpot",
        2,
        {"kind": "mission_skip", "amount": 1},
        "#9b59b6",
    )
    add(
        "jackpot_points_25k",
        "25,000 Points",
        "25K",
        "jackpot",
        1,
        {"kind": "points", "amount": 25_000},
        "#ff6b9d",
    )
    add(
        "jackpot_cash_25b",
        "$25,000,000,000",
        "$25B",
        "jackpot",
        1,
        {"kind": "money", "amount": 25_000_000_000},
        "#ff2d55",
    )
    add(
        "rare_robot_hire",
        "Free Robot Bodyguard",
        "Bot",
        "rare",
        2,
        {"kind": "robot_bodyguard_hire", "amount": 1},
        "#5dade2",
    )
    add(
        "rare_cash_5b",
        "$5,000,000,000",
        "$5B",
        "rare",
        2,
        {"kind": "money", "amount": 5_000_000_000},
        "#2ecc71",
    )
    add(
        "rare_points_500",
        "500 Points",
        "500",
        "rare",
        2,
        {"kind": "points", "amount": 500},
        "#58d68d",
    )
    add(
        "rare_points_1000",
        "1,000 Points",
        "1K",
        "rare",
        2,
        {"kind": "points", "amount": 1000},
        "#48c9b0",
    )
    add(
        "rare_cash_1_5b",
        "$1,500,000,000",
        "$1.5B",
        "rare",
        2,
        {"kind": "money", "amount": 1_500_000_000},
        "#1abc9c",
    )

    for tt, (label, short) in TOKEN_LABELS.items():
        w = 4 if tt == "auto_rank_2h" else (6 if tt in ("auto_collect_24h", "auto_collect_12h") else 10)
        add(f"token_{tt}", label, short, "token", w, {"kind": "token", "token_type": tt, "amount": 3})

    add("cash_50k", "$50,000", "$50K", "common", 36, {"kind": "money", "amount": 50_000})
    add("cash_250k", "$250,000", "$250K", "common", 30, {"kind": "money", "amount": 250_000})
    add("cash_1m", "$1,000,000", "$1M", "common", 22, {"kind": "money", "amount": 1_000_000})
    add("cash_5m", "$5,000,000", "$5M", "common", 12, {"kind": "money", "amount": 5_000_000})
    add("cash_500m", "$500,000,000", "$500M", "common", 10, {"kind": "money", "amount": 500_000_000})

    add("pts_25", "25 Points", "25", "common", 40, {"kind": "points", "amount": 25})
    add("pts_50", "50 Points", "50", "common", 34, {"kind": "points", "amount": 50})
    add("pts_100", "100 Points", "100", "common", 28, {"kind": "points", "amount": 100})

    add("loot_5", "5 Loot Pieces", "5L", "common", 40, {"kind": "loot_box_pieces", "amount": 5})

    add("bullets_1k", "1,000 Bullets", "1K", "common", 26, {"kind": "bullets", "amount": 1000})
    add("bullets_2_5k", "2,500 Bullets", "2.5K", "common", 18, {"kind": "bullets", "amount": 2500})
    add("bullets_5k", "5,000 Bullets", "5K", "common", 10, {"kind": "bullets", "amount": 5000})

    for tt, short in (
        ("cooldown_skip_crime", "Csk"),
        ("cooldown_skip_gta", "Gsk"),
        ("cooldown_skip_booze", "Bsk"),
        ("cooldown_skip_properties", "Psk"),
    ):
        add(
            f"skip1_{tt}",
            f"1× {TOKEN_LABELS.get(tt, (tt, tt))[0].replace(' ×3', '')}",
            short,
            "common",
            28,
            {"kind": "token", "token_type": tt, "amount": 1},
        )

    return segs


WHEEL_SEGMENTS: List[Dict[str, Any]] = _build_segments()


def _utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _parse_iso(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    try:
        if isinstance(raw, datetime):
            dt = raw
        else:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _paid_spins_used(user: dict) -> int:
    if (user.get("wheel_paid_spins_day") or "") != _utc_today():
        return 0
    return int(user.get("wheel_paid_spins_today") or 0)


def _free_available(user: dict, now: Optional[datetime] = None) -> Tuple[bool, Optional[str], Optional[int]]:
    """Return (available, next_at_iso, seconds_remaining)."""
    now = now or datetime.now(timezone.utc)
    last = _parse_iso(user.get("wheel_last_free_spin_at"))
    if not last:
        return True, None, None
    nxt = last + WHEEL_FREE_COOLDOWN
    if now >= nxt:
        return True, None, None
    secs = max(0, int((nxt - now).total_seconds()))
    return False, nxt.isoformat(), secs


def _roll_segment_index() -> int:
    weights = [max(0, int(s.get("weight") or 0)) for s in WHEEL_SEGMENTS]
    total = sum(weights)
    if total <= 0:
        return 0
    r = _rng.randrange(total)
    acc = 0
    for i, w in enumerate(weights):
        acc += w
        if r < acc:
            return i
    return len(WHEEL_SEGMENTS) - 1


def _prize_inc(prize: Dict[str, Any]) -> Dict[str, int]:
    kind = (prize or {}).get("kind")
    amount = int((prize or {}).get("amount") or 0)
    if amount <= 0:
        return {}
    if kind == "points":
        return {"points": amount}
    if kind == "money":
        return {"money": amount}
    if kind == "loot_box_pieces":
        return {"loot_box_pieces": amount}
    if kind == "bullets":
        return {"bullets": amount}
    if kind == "mission_skip":
        return {"mission_skip_tokens": amount}
    if kind == "robot_bodyguard_hire":
        return {"robot_bodyguard_hire_tokens": amount}
    if kind == "token":
        tt = str((prize or {}).get("token_type") or "")
        field = TOKEN_FIELD_MAP.get(tt)
        if not field:
            raise HTTPException(status_code=500, detail="Invalid wheel token prize")
        return {field: amount}
    raise HTTPException(status_code=500, detail="Invalid wheel prize")


def _prize_label(prize: Dict[str, Any]) -> str:
    kind = (prize or {}).get("kind")
    amount = int((prize or {}).get("amount") or 0)
    if kind == "points":
        return f"{amount:,} points"
    if kind == "money":
        return f"${amount:,}"
    if kind == "loot_box_pieces":
        return f"{amount:,} loot pieces"
    if kind == "bullets":
        return f"{amount:,} bullets"
    if kind == "mission_skip":
        return f"{amount}× Mission Skip" if amount != 1 else "Mission Skip"
    if kind == "robot_bodyguard_hire":
        return "Free Robot Bodyguard" if amount == 1 else f"{amount}× Free Robot Bodyguard"
    if kind == "token":
        tt = str((prize or {}).get("token_type") or "")
        name = TOKEN_LABELS.get(tt, (tt, tt))[0].replace(" ×3", "").replace("×3", "").strip()
        return f"{amount}× {name}"
    return "prize"


def _spin_status(user: dict) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    free_ok, free_next, free_secs = _free_available(user, now)
    paid_used = _paid_spins_used(user)
    bonus = max(0, int(user.get("wheel_bonus_free_spins") or 0))
    admin = _is_admin(user)
    if admin:
        free_ok = True
        free_next = None
        free_secs = None
        paid_remaining = 999
    else:
        paid_remaining = max(0, WHEEL_PAID_SPINS_PER_DAY - paid_used)
    return {
        "free_available": free_ok or bonus > 0,
        "daily_free_available": free_ok,
        "bonus_free_spins": bonus,
        "free_next_at": free_next,
        "free_seconds_remaining": free_secs,
        "paid_spins_used_today": 0 if admin else paid_used,
        "paid_spins_remaining_today": paid_remaining,
        "paid_spins_per_day": WHEEL_PAID_SPINS_PER_DAY,
        "paid_cost_points": WHEEL_PAID_SPIN_POINTS,
        "paid_cost_respect": WHEEL_PAID_SPIN_RESPECT,
        "admin_unlimited": admin,
        "points": int(user.get("points") or 0),
        "respect_points": int(user.get("respect_points") or 0),
        "money": int(user.get("money") or 0),
        "loot_box_pieces": int(user.get("loot_box_pieces") or 0),
        "bullets": int(user.get("bullets") or 0),
        "robot_bodyguard_hire_tokens": int(user.get("robot_bodyguard_hire_tokens") or 0),
    }


async def _recent_wheel_wins(limit: int = WHEEL_RECENT_WINS_LIMIT) -> List[Dict[str, Any]]:
    """Game-wide last N public wins (newest first)."""
    try:
        rows = (
            await db[WHEEL_WINS_COLLECTION]
            .find({}, {"_id": 0})
            .sort("at", -1)
            .limit(max(1, int(limit)))
            .to_list(max(1, int(limit)))
        )
    except Exception:
        logger.exception("wheel recent wins fetch failed")
        return []
    out: List[Dict[str, Any]] = []
    for r in rows:
        at = r.get("at")
        if isinstance(at, datetime):
            at_iso = at.astimezone(timezone.utc).isoformat() if at.tzinfo else at.replace(tzinfo=timezone.utc).isoformat()
        else:
            at_iso = str(at or "")
        out.append(
            {
                "at": at_iso,
                "username": str(r.get("username") or "?"),
                "prize_label": str(r.get("prize_label") or r.get("label") or "prize"),
                "tier": str(r.get("tier") or "common"),
                "segment_id": r.get("segment_id"),
            }
        )
    return out


async def _record_wheel_win(
    *,
    user_id: str,
    username: str,
    prize_label: str,
    tier: str,
    segment_id: str,
    label: str,
    pay_with: str,
) -> None:
    """Append a public win (callers should skip admin test spins)."""
    try:
        await db[WHEEL_WINS_COLLECTION].insert_one(
            {
                "at": datetime.now(timezone.utc),
                "user_id": user_id,
                "username": (username or "?").strip() or "?",
                "prize_label": prize_label,
                "tier": tier,
                "segment_id": segment_id,
                "label": label,
                "pay_with": pay_with,
            }
        )
    except Exception:
        logger.exception("wheel win record failed user_id=%s", user_id)


class WheelSpinRequest(BaseModel):
    pay_with: str = Field(..., description="free | points | respect")


def register(router):
    @router.get("/casino/wheel/config", dependencies=_casinos_rl_u)
    async def wheel_config(current_user: dict = Depends(get_current_user_verified)):
        user = await db.users.find_one({"id": current_user.get("id") or ""}, {"_id": 0}) or current_user
        wedges = [
            {
                "id": s["id"],
                "label": s["label"],
                "short": s["short"],
                "tier": s["tier"],
                "color": s["color"],
                "index": i,
            }
            for i, s in enumerate(WHEEL_SEGMENTS)
        ]
        return {
            "wedges": wedges,
            "segment_count": len(WHEEL_SEGMENTS),
            "recent_wins": await _recent_wheel_wins(),
            **_spin_status(user),
        }

    @router.post("/casino/wheel/spin", dependencies=_casinos_rl_u)
    async def wheel_spin(
        body: WheelSpinRequest,
        current_user: dict = Depends(get_current_user_verified),
    ):
        raise_if_gambling_self_banned(current_user)
        uid = current_user.get("id") or ""
        if not uid:
            raise HTTPException(status_code=401, detail="Not authenticated")
        pay = (body.pay_with or "").strip().lower()
        if pay not in ("free", "points", "respect"):
            raise HTTPException(status_code=400, detail="pay_with must be free, points, or respect")

        user = await db.users.find_one({"id": uid}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        now = datetime.now(timezone.utc)
        today = _utc_today()
        segment_index = _roll_segment_index()
        segment = WHEEL_SEGMENTS[segment_index]
        prize = dict(segment["prize"])
        grant = _prize_inc(prize)
        if not grant:
            raise HTTPException(status_code=500, detail="Empty prize")

        filt: Dict[str, Any] = {"id": uid}
        inc: Dict[str, Any] = dict(grant)
        set_doc: Dict[str, Any] = {}
        admin = _is_admin(user) or _is_admin(current_user)

        if pay == "free":
            bonus = max(0, int(user.get("wheel_bonus_free_spins") or 0))
            free_ok, free_next, _ = _free_available(user, now)
            if admin:
                # Admins: unlimited free spins; do not touch cooldown or bonus bank
                pass
            elif bonus > 0:
                # Store GBP bonus spins: consume bank first (does not start 24h cooldown)
                inc["wheel_bonus_free_spins"] = int(inc.get("wheel_bonus_free_spins") or 0) - 1
                filt["wheel_bonus_free_spins"] = {"$gte": 1}
            elif free_ok:
                set_doc["wheel_last_free_spin_at"] = now.isoformat()
                # Race: only one free within cooldown window
                last = user.get("wheel_last_free_spin_at")
                if last:
                    filt["wheel_last_free_spin_at"] = last
                else:
                    filt["$or"] = [
                        {"wheel_last_free_spin_at": {"$exists": False}},
                        {"wheel_last_free_spin_at": None},
                        {"wheel_last_free_spin_at": ""},
                    ]
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Free spin available again after cooldown ({free_next})",
                )
        else:
            paid_used = _paid_spins_used(user)
            if not admin:
                if paid_used >= WHEEL_PAID_SPINS_PER_DAY:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Paid spin limit reached ({WHEEL_PAID_SPINS_PER_DAY} per UTC day)",
                    )
                if (user.get("wheel_paid_spins_day") or "") != today:
                    set_doc["wheel_paid_spins_day"] = today
                    set_doc["wheel_paid_spins_today"] = 1
                else:
                    set_doc["wheel_paid_spins_day"] = today
                    inc["wheel_paid_spins_today"] = 1
                    filt["wheel_paid_spins_today"] = {"$lt": WHEEL_PAID_SPINS_PER_DAY}
                    filt["wheel_paid_spins_day"] = today

            if pay == "points":
                cost = WHEEL_PAID_SPIN_POINTS
                filt["points"] = {"$gte": cost}
                inc["points"] = int(inc.get("points") or 0) - cost
                inc["lifetime_points_spent"] = int(inc.get("lifetime_points_spent") or 0) + cost
            else:
                cost = WHEEL_PAID_SPIN_RESPECT
                filt["respect_points"] = {"$gte": cost}
                inc["respect_points"] = int(inc.get("respect_points") or 0) - cost
                inc["lifetime_respect_points_spent"] = int(inc.get("lifetime_respect_points_spent") or 0) + cost

        update: Dict[str, Any] = {"$inc": inc}
        if set_doc:
            update["$set"] = set_doc

        result = await db.users.update_one(filt, update)
        if result.modified_count != 1:
            if pay == "free":
                raise HTTPException(status_code=400, detail="Free spin already used — try again later")
            if pay == "points":
                raise HTTPException(status_code=400, detail=f"Need {WHEEL_PAID_SPIN_POINTS} points (or paid limit reached)")
            raise HTTPException(status_code=400, detail=f"Need {WHEEL_PAID_SPIN_RESPECT} respect (or paid limit reached)")

        # Provenance / audit for spends
        if pay == "points":
            try:
                await consume_points_fifo(
                    db,
                    user_id=uid,
                    points=WHEEL_PAID_SPIN_POINTS,
                    event_type="spend_wheel",
                    event_ref="wheel_of_fortune",
                    meta={"source": "wheel", "admin": admin},
                    assume_balance_already_decremented_by=WHEEL_PAID_SPIN_POINTS,
                    source="wheel",
                    context={"cost_points": WHEEL_PAID_SPIN_POINTS, "admin": admin},
                    wallet_points_before=int(user.get("points") or 0),
                    wallet_points_after=int(user.get("points") or 0) - WHEEL_PAID_SPIN_POINTS,
                )
            except Exception:
                logger.exception("wheel points provenance failed user_id=%s", uid)
        elif pay == "respect":
            try:
                await log_respect_delta(uid, -WHEEL_PAID_SPIN_RESPECT, "wheel_of_fortune")
            except Exception:
                logger.exception("wheel respect audit failed user_id=%s", uid)

        prize_label = _prize_label(prize)
        try:
            await log_activity(
                uid,
                user.get("username") or "?",
                "wheel_of_fortune_spin",
                {
                    "pay_with": pay,
                    "segment_index": segment_index,
                    "segment_id": segment["id"],
                    "prize": prize,
                    "prize_label": prize_label,
                    "admin": admin,
                },
            )
            await log_gambling(
                uid,
                user.get("username") or "?",
                "wheel_of_fortune",
                {
                    "pay_with": pay,
                    "segment_index": segment_index,
                    "segment_id": segment["id"],
                    "prize": prize,
                    "prize_label": prize_label,
                },
            )
        except Exception:
            logger.exception("wheel log failed user_id=%s", uid)

        if not admin:
            await _record_wheel_win(
                user_id=uid,
                username=user.get("username") or "?",
                prize_label=prize_label,
                tier=str(segment.get("tier") or "common"),
                segment_id=str(segment.get("id") or ""),
                label=str(segment.get("label") or ""),
                pay_with=pay,
            )

        refreshed = await db.users.find_one({"id": uid}, {"_id": 0}) or user
        status = _spin_status(refreshed)
        return {
            "segment_index": segment_index,
            "segment_id": segment["id"],
            "tier": segment["tier"],
            "label": segment["label"],
            "prize": prize,
            "prize_label": prize_label,
            "pay_with": pay,
            "recent_wins": await _recent_wheel_wins(),
            **status,
        }
