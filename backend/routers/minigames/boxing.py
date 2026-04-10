import secrets
_rng = secrets.SystemRandom()
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from server import db, get_current_user_verified, get_current_user, log_gambling, _get_staff_user_ids, _is_admin, send_notification
from utils.minigame_captcha_gate import require_turnstile_for_minigame_start
from utils.minigame_run_session import utc_rate_limit_window, RATE_LIMIT_PERIOD_HOURS


def _boxing_fight_throttle_429(message: str, *, cooldown_seconds: Optional[int] = None) -> HTTPException:
    """429 with flag so the client skips the global 'clicking too fast' overlay (game cooldown only)."""
    body: Dict[str, Any] = {"message": message, "suppress_global_cooldown": True}
    if cooldown_seconds is not None:
        body["cooldown_seconds"] = int(cooldown_seconds)
    return HTTPException(status_code=429, detail=body)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _user_id_match(a: Any, b: Any) -> bool:
    """JWT `sub` and Mongo `users.id` may differ by type (str vs int); normalize for comparisons."""
    if a is None or b is None:
        return False
    return str(a) == str(b)


def _user_id_query_values(uid: Any) -> List[Any]:
    """Values to use in $in queries so challenges match regardless of id storage type."""
    if uid is None:
        return []
    s = str(uid)
    out: List[Any] = []
    if uid not in out:
        out.append(uid)
    if s not in out:
        out.append(s)
    return out


async def _find_user_by_username_for_challenge(raw_name: str) -> Optional[dict]:
    """
    Case-insensitive exact username match (same idea as bank transfers).
    If more than one user matches, require a unique handle — avoids wrong opponent on case-only duplicates.
    """
    name = (raw_name or "").strip()
    if not name:
        return None
    pattern = re.compile("^" + re.escape(name) + "$", re.IGNORECASE)
    cur = db.users.find(
        {"username": pattern, "is_dead": {"$ne": True}, "is_npc": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1},
    )
    matches = await cur.to_list(3)
    if not matches:
        return None
    if len(matches) > 1:
        raise HTTPException(
            status_code=400,
            detail="Multiple accounts match that name; type the username exactly as shown on their profile.",
        )
    return matches[0]


def _week_start(dt: datetime) -> datetime:
    d = dt.date()
    start = d - timedelta(days=d.weekday())
    return datetime(start.year, start.month, start.day, tzinfo=timezone.utc)


# ── Stats & Profile ──────────────────────────────────────────────────────────

STAT_KEYS = ("power", "speed", "defense", "stamina")

DEFAULT_PROFILE: Dict[str, Any] = {
    "power": 10, "speed": 10, "defense": 10, "stamina": 10,
    "rating": 1000,
    "xp": 0, "level": 1, "stat_points": 0,
    "wins": 0, "losses": 0, "draws": 0,
    "streak": 0, "best_streak": 0, "ko_wins": 0,
    "total_earnings": 0,
}

TRAIN_BASE_COST = 5000
TRAIN_GROWTH = 1.15
MAX_STAT = 80
MAX_LEVEL = 50


def _train_cost(current_val: int) -> int:
    return int(TRAIN_BASE_COST * (TRAIN_GROWTH ** max(0, current_val - 10)))


def _xp_for_level(level: int) -> int:
    return 100 * level * (level + 1) // 2


def _level_from_xp(xp: int) -> int:
    lvl = 1
    while lvl < MAX_LEVEL and xp >= _xp_for_level(lvl + 1):
        lvl += 1
    return lvl


async def _ensure_profile(user_id: str) -> dict:
    prof = await db.boxing_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if prof:
        return prof
    doc = {"user_id": user_id, **DEFAULT_PROFILE}
    await db.boxing_profiles.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ── ELO ──────────────────────────────────────────────────────────────────────

def _elo_expected(a: int, b: int) -> float:
    return 1.0 / (1.0 + 10.0 ** ((b - a) / 400.0))


def _elo_update(a: int, b: int, a_won: bool) -> tuple:
    ea = _elo_expected(a, b)
    sa = 1.0 if a_won else 0.0
    k = 24
    a2 = int(round(a + k * (sa - ea)))
    b2 = int(round(b + k * ((1.0 - sa) - (1.0 - ea))))
    return max(100, a2), max(100, b2)


def _decimal_odds(p: float) -> float:
    p = max(0.05, min(0.95, float(p)))
    return max(1.01, round(1.0 / p, 2))


def _match_odds(ra: int, rb: int) -> dict:
    pa = _elo_expected(ra, rb)
    pb = 1.0 - pa
    pa2 = min(0.97, pa + 0.03)
    pb2 = min(0.97, pb + 0.03)
    s = pa2 + pb2
    return {"a": _decimal_odds(pa2 / s), "b": _decimal_odds(pb2 / s)}


# ── NPC Opponents ────────────────────────────────────────────────────────────

NPCS: List[dict] = [
    {"id": "npc_1",  "name": "Street Punk",           "power": 12, "speed": 14, "defense": 10, "stamina": 13, "reward": 7500,    "flavor": "Scrawny kid who thinks he's tough."},
    {"id": "npc_2",  "name": "Bar Brawler",            "power": 18, "speed": 15, "defense": 14, "stamina": 16, "reward": 15000,  "flavor": "Throws haymakers after six beers."},
    {"id": "npc_3",  "name": "Dock Worker",            "power": 22, "speed": 18, "defense": 19, "stamina": 20, "reward": 30000,  "flavor": "Arms like crane cables."},
    {"id": "npc_4",  "name": "Club Bouncer",           "power": 26, "speed": 20, "defense": 24, "stamina": 22, "reward": 52500,  "flavor": "Gets paid to hurt people."},
    {"id": "npc_5",  "name": "Ex-Con",                 "power": 30, "speed": 25, "defense": 28, "stamina": 26, "reward": 75000,  "flavor": "Learned to fight in the yard."},
    {"id": "npc_6",  "name": "Pit Fighter",            "power": 35, "speed": 30, "defense": 32, "stamina": 30, "reward": 112500, "flavor": "No rules, no refs, no mercy."},
    {"id": "npc_7",  "name": "The Hammer",             "power": 42, "speed": 34, "defense": 36, "stamina": 35, "reward": 150000, "flavor": "One punch and the lights go out."},
    {"id": "npc_8",  "name": "Iron Mike",              "power": 48, "speed": 40, "defense": 42, "stamina": 40, "reward": 225000, "flavor": "Former pro with nothing to lose."},
    {"id": "npc_9",  "name": "The Butcher",            "power": 55, "speed": 46, "defense": 48, "stamina": 45, "reward": 300000, "flavor": "Leaves opponents unrecognizable."},
    {"id": "npc_10", "name": "Underground Champion",   "power": 62, "speed": 55, "defense": 56, "stamina": 52, "reward": 750000, "flavor": "King of the pit. Nobody beats him. Yet."},
]


def _get_npc(npc_id: str) -> Optional[dict]:
    return next((n for n in NPCS if n["id"] == npc_id), None)


# ── Fight Simulation ─────────────────────────────────────────────────────────

PUNCH_TYPES = ["jab", "cross", "hook", "uppercut", "body"]
PUNCH_BASE_DMG = {"jab": (2, 5), "cross": (5, 10), "hook": (6, 12), "uppercut": (7, 13), "body": (4, 9)}
PUNCH_ACC_BONUS = {"jab": 0.18, "cross": 0.06, "hook": 0.02, "uppercut": -0.02, "body": 0.10}
PUNCH_STAM_COST = {"jab": 1.0, "cross": 2.0, "hook": 2.5, "uppercut": 2.8, "body": 2.2}
MAX_ROUNDS = 12
MAX_KNOCKDOWNS = 3


def _choose_punch(stam: float, hp: float) -> str:
    if stam < 20:
        weights = [50, 10, 8, 5, 27]
    elif hp < 30:
        weights = [30, 15, 10, 8, 37]
    else:
        weights = [25, 22, 20, 15, 18]
    r = _rng.random() * sum(weights)
    for i, w in enumerate(weights):
        r -= w
        if r <= 0:
            return PUNCH_TYPES[i]
    return "jab"


def _simulate_fight(a_stats: dict, b_stats: dict) -> dict:
    """Run a full fight and return the event log, winner, reason, scorecard, and stats."""

    def make(s):
        return {
            "power": int(s.get("power", 10)),
            "speed": int(s.get("speed", 10)),
            "defense": int(s.get("defense", 10)),
            "stamina_stat": int(s.get("stamina", 10)),
            "hp": 100.0, "stam": 100.0, "kds": 0,
            "total_dmg": 0.0, "total_hits": 0, "total_thrown": 0,
        }

    a, b = make(a_stats), make(b_stats)
    rounds_log: List[dict] = []
    scorecard_a, scorecard_b = [], []

    for rnd in range(1, MAX_ROUNDS + 1):
        exchanges = _rng.randint(8, 12)
        round_events: List[dict] = []
        round_dmg_a, round_dmg_b = 0.0, 0.0
        round_kd_a, round_kd_b = 0, 0

        for _ in range(exchanges):
            if a["hp"] <= 0 or b["hp"] <= 0 or a["kds"] >= MAX_KNOCKDOWNS or b["kds"] >= MAX_KNOCKDOWNS:
                break

            for attacker, defender, side in [(a, b, "a"), (b, a, "b")]:
                if attacker["hp"] <= 0 or defender["hp"] <= 0:
                    break
                punch = _choose_punch(attacker["stam"], attacker["hp"])
                attacker["total_thrown"] += 1

                base_acc = 0.45 + PUNCH_ACC_BONUS[punch]
                acc = base_acc + (attacker["speed"] - defender["defense"]) / 200.0
                acc -= max(0.0, (40 - attacker["stam"]) * 0.005)
                acc = max(0.08, min(0.85, acc))

                landed = _rng.random() < acc
                dmg = 0.0
                knockdown = False

                if landed:
                    lo, hi = PUNCH_BASE_DMG[punch]
                    raw = _rng.uniform(lo, hi)
                    power_mult = 1.0 + (attacker["power"] - 10) * 0.025
                    def_mult = max(0.3, 1.0 - (defender["defense"] - 10) * 0.012)
                    stam_mult = max(0.5, attacker["stam"] / 100.0)
                    dmg = raw * power_mult * def_mult * stam_mult
                    dmg = max(1.0, dmg)

                    if punch == "body":
                        defender["stam"] = max(0, defender["stam"] - dmg * 0.4)
                        dmg *= 0.6

                    defender["hp"] = max(0, defender["hp"] - dmg)
                    attacker["total_hits"] += 1
                    attacker["total_dmg"] += dmg

                    if side == "a":
                        round_dmg_a += dmg
                    else:
                        round_dmg_b += dmg

                    if punch != "body" and dmg >= 5:
                        hurt_mult = 2.0 if defender["hp"] < 25 else 1.4 if defender["hp"] < 45 else 1.0
                        stam_factor = max(0.5, 1.0 + (50 - defender["stam"]) * 0.012)
                        def_factor = max(0.3, 1.0 - (defender["defense"] - 10) * 0.015)
                        kd_chance = (dmg / 80.0) * hurt_mult * stam_factor * def_factor
                        kd_chance = min(0.30, kd_chance)
                        if _rng.random() < kd_chance and defender["kds"] < MAX_KNOCKDOWNS:
                            knockdown = True
                            defender["kds"] += 1
                            defender["hp"] = max(1, defender["hp"] - 5)
                            if side == "a":
                                round_kd_a += 1
                            else:
                                round_kd_b += 1

                attacker["stam"] = max(0, attacker["stam"] - PUNCH_STAM_COST[punch] * (1.0 if landed else 0.4))

                round_events.append({
                    "side": side, "punch": punch,
                    "landed": landed, "dmg": round(dmg, 1),
                    "knockdown": knockdown,
                })

        fight_over = a["hp"] <= 0 or b["hp"] <= 0 or a["kds"] >= MAX_KNOCKDOWNS or b["kds"] >= MAX_KNOCKDOWNS
        rounds_log.append({
            "round": rnd,
            "exchanges": round_events,
            "hp": {"a": round(a["hp"]), "b": round(b["hp"])},
            "stam": {"a": round(a["stam"]), "b": round(b["stam"])},
            "kds": {"a": a["kds"], "b": b["kds"]},
            "dmg": {"a": round(round_dmg_a, 1), "b": round(round_dmg_b, 1)},
            "round_kds": {"a": round_kd_a, "b": round_kd_b},
        })

        if fight_over:
            break

        if round_dmg_a > round_dmg_b:
            sa, sb = 10, 9
        elif round_dmg_b > round_dmg_a:
            sa, sb = 9, 10
        else:
            sa, sb = 10, 10
        if round_kd_a > 0:
            sb = max(7, sb - round_kd_a)
        if round_kd_b > 0:
            sa = max(7, sa - round_kd_b)
        scorecard_a.append(sa)
        scorecard_b.append(sb)

        a_rec = 4 + a["stamina_stat"] * 0.15
        b_rec = 4 + b["stamina_stat"] * 0.15
        a["stam"] = min(100, a["stam"] + a_rec)
        b["stam"] = min(100, b["stam"] + b_rec)
        a["hp"] = min(100, a["hp"] + 1.5)
        b["hp"] = min(100, b["hp"] + 1.5)

    winner = None
    reason = "decision"
    if a["hp"] <= 0 and b["hp"] <= 0:
        winner = None
        reason = "double_ko"
    elif b["hp"] <= 0 or b["kds"] >= MAX_KNOCKDOWNS:
        winner = "a"
        reason = "ko" if b["hp"] <= 0 else "tko"
    elif a["hp"] <= 0 or a["kds"] >= MAX_KNOCKDOWNS:
        winner = "b"
        reason = "ko" if a["hp"] <= 0 else "tko"
    else:
        total_a = sum(scorecard_a)
        total_b = sum(scorecard_b)
        if total_a > total_b:
            winner = "a"
            reason = "unanimous_decision" if total_a - total_b >= 3 else "split_decision"
        elif total_b > total_a:
            winner = "b"
            reason = "unanimous_decision" if total_b - total_a >= 3 else "split_decision"
        else:
            winner = "a" if a["total_dmg"] > b["total_dmg"] else "b"
            reason = "majority_decision"

    return {
        "rounds": rounds_log,
        "winner": winner,
        "reason": reason,
        "scorecard": {"a": scorecard_a, "b": scorecard_b},
        "stats": {
            "a": {"thrown": a["total_thrown"], "landed": a["total_hits"], "dmg": round(a["total_dmg"]), "kds": a["kds"]},
            "b": {"thrown": b["total_thrown"], "landed": b["total_hits"], "dmg": round(b["total_dmg"]), "kds": b["kds"]},
        },
        "total_rounds": len(rounds_log),
    }


# ── XP & Leveling helpers ───────────────────────────────────────────────────

async def _award_xp(user_id: str, base_xp: int):
    prof = await _ensure_profile(user_id)
    old_xp = int(prof.get("xp") or 0)
    old_level = int(prof.get("level") or 1)
    new_xp = old_xp + base_xp
    new_level = _level_from_xp(new_xp)
    points_gained = max(0, new_level - old_level)
    await db.boxing_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"xp": new_xp, "level": new_level}, "$inc": {"stat_points": points_gained}},
    )
    return new_xp, new_level, points_gained


# ── Request Models ───────────────────────────────────────────────────────────

class TrainRequest(BaseModel):
    stat: str

class AllocateRequest(BaseModel):
    stat: str

class FightNpcRequest(BaseModel):
    npc_id: str
    captcha_token: Optional[str] = None

class ChallengeRequest(BaseModel):
    opponent_username: str
    captcha_token: Optional[str] = None

class AcceptChallengeRequest(BaseModel):
    challenge_id: str
    captcha_token: Optional[str] = None

class CancelChallengeRequest(BaseModel):
    challenge_id: str

class BetRequest(BaseModel):
    challenge_id: str
    fighter: str
    stake: int


# ── Endpoints ────────────────────────────────────────────────────────────────

async def boxing_me(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_profile(current_user["id"])
    next_lvl = int(prof.get("level") or 1) + 1
    xp_next = _xp_for_level(next_lvl) if next_lvl <= MAX_LEVEL else None
    return {
        "profile": prof,
        "xp_next_level": xp_next,
        "train_costs": {k: _train_cost(int(prof.get(k) or 10)) for k in STAT_KEYS},
        "npcs": [_npc_for_client(n) for n in NPCS],
    }


async def boxing_train(payload: TrainRequest, current_user: dict = Depends(get_current_user_verified)):
    stat = (payload.stat or "").strip().lower()
    if stat not in STAT_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid stat. Choose from: {', '.join(STAT_KEYS)}")
    prof = await _ensure_profile(current_user["id"])
    current_val = int(prof.get(stat) or 10)
    if current_val >= MAX_STAT:
        raise HTTPException(status_code=400, detail=f"{stat.title()} is already at max ({MAX_STAT})")
    cost = _train_cost(current_val)
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": cost}},
        {"$inc": {"money": -cost}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Not enough cash. Need ${cost:,}")
    await db.boxing_profiles.update_one({"user_id": current_user["id"]}, {"$inc": {stat: 1}})
    prof2 = await _ensure_profile(current_user["id"])
    return {
        "message": f"+1 {stat.title()} (now {current_val + 1}). Cost: ${cost:,}",
        "profile": prof2,
        "train_costs": {k: _train_cost(int(prof2.get(k) or 10)) for k in STAT_KEYS},
    }


async def boxing_allocate(payload: AllocateRequest, current_user: dict = Depends(get_current_user_verified)):
    stat = (payload.stat or "").strip().lower()
    if stat not in STAT_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid stat. Choose from: {', '.join(STAT_KEYS)}")
    prof = await _ensure_profile(current_user["id"])
    current_val = int(prof.get(stat) or 10)
    if current_val >= MAX_STAT:
        raise HTTPException(status_code=400, detail=f"{stat.title()} is already at max ({MAX_STAT})")
    alloc_result = await db.boxing_profiles.update_one(
        {"user_id": current_user["id"], "stat_points": {"$gte": 1}},
        {"$inc": {stat: 1, "stat_points": -1}},
    )
    if alloc_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="No stat points available")
    prof2 = await _ensure_profile(current_user["id"])
    return {"message": f"+1 {stat.title()} (free point)", "profile": prof2}


async def boxing_opponents(current_user: dict = Depends(get_current_user)):
    return {"npcs": [_npc_for_client(n) for n in NPCS]}


NPC_FIGHT_COOLDOWN_SECONDS = 5 * 60
NPC_MAX_FIGHTS_PER_HOUR = 10
PVP_MAX_FIGHTS_PER_HOUR = 10
# 1.0 = winner receives full NPC "reward" shown in UI (was 0.6).
NPC_WIN_PAYOUT_MULTIPLIER = 1.0


def _npc_win_reward(npc: dict) -> int:
    return int((int(npc.get("reward") or 0)) * NPC_WIN_PAYOUT_MULTIPLIER)


def _npc_for_client(npc: dict) -> dict:
    out = dict(npc)
    out["reward"] = _npc_win_reward(npc)
    return out


async def _claim_hourly_fight_slot(
    *,
    user_id: str,
    start_field: str,
    count_field: str,
    max_fights: int,
    now_dt: datetime,
) -> tuple[bool, int, str]:
    hour_start, reset_dt = utc_rate_limit_window(now_dt.replace(microsecond=0))
    hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
    claimed = await db.boxing_profiles.update_one(
        { "user_id": user_id, start_field: hour_start_iso, count_field: {"$lt": max_fights} },
        {"$inc": {count_field: 1}},
    )
    if claimed.modified_count == 0:
        claimed = await db.boxing_profiles.update_one(
            {"user_id": user_id, start_field: {"$ne": hour_start_iso}},
            {"$set": {start_field: hour_start_iso, count_field: 1}},
        )
    if claimed.modified_count == 0:
        remaining = max(0, int((reset_dt - now_dt).total_seconds()))
        return False, remaining, hour_start_iso
    return True, 0, hour_start_iso


async def _release_hourly_fight_slot(
    *,
    user_id: str,
    start_field: str,
    count_field: str,
    hour_start_iso: str,
) -> None:
    await db.boxing_profiles.update_one(
        {"user_id": user_id, start_field: hour_start_iso, count_field: {"$gt": 0}},
        {"$inc": {count_field: -1}},
    )


async def boxing_fight_npc(
    payload: FightNpcRequest,
    request: Request,
    current_user: dict = Depends(get_current_user_verified),
):
    npc = _get_npc(payload.npc_id)
    if not npc:
        raise HTTPException(status_code=400, detail="Invalid opponent")

    await require_turnstile_for_minigame_start(
        db,
        request=request,
        current_user=current_user,
        captcha_token=payload.captcha_token,
        is_admin=_is_admin(current_user),
    )

    await _ensure_profile(current_user["id"])
    now = datetime.now(timezone.utc)
    npc_ok, npc_remaining, hour_start_iso = await _claim_hourly_fight_slot(
        user_id=current_user["id"],
        start_field="npc_fight_hour_start",
        count_field="npc_fight_hour_count",
        max_fights=NPC_MAX_FIGHTS_PER_HOUR,
        now_dt=now,
    )
    if not npc_ok:
        raise _boxing_fight_throttle_429(
            f"Fight limit reached ({NPC_MAX_FIGHTS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again in {npc_remaining}s.",
            cooldown_seconds=max(1, npc_remaining),
        )

    # Fight slot reserved; if cooldown claim fails below, we roll this back.
    cooldown_until = now + timedelta(seconds=NPC_FIGHT_COOLDOWN_SECONDS)
    cooldown_iso = cooldown_until.isoformat().replace("+00:00", "Z")
    now_iso_cd = now.isoformat().replace("+00:00", "Z")

    claimed = await db.boxing_profiles.find_one_and_update(
        {
            "user_id": current_user["id"],
            "$or": [
                {"npc_fight_cooldown_until": {"$lte": now_iso_cd}},
                {"npc_fight_cooldown_until": {"$exists": False}},
            ],
        },
        {"$set": {"npc_fight_cooldown_until": cooldown_iso}},
    )
    if claimed is None:
        await db.boxing_profiles.update_one(
            {
                "user_id": current_user["id"],
                "npc_fight_hour_start": hour_start_iso,
                "npc_fight_hour_count": {"$gt": 0},
            },
            {"$inc": {"npc_fight_hour_count": -1}},
        )
        existing = await db.boxing_profiles.find_one(
            {"user_id": current_user["id"]}, {"_id": 0, "npc_fight_cooldown_until": 1}
        )
        cd_raw = (existing or {}).get("npc_fight_cooldown_until")
        if cd_raw:
            cd_dt = datetime.fromisoformat(str(cd_raw).replace("Z", "+00:00"))
            if cd_dt.tzinfo is None:
                cd_dt = cd_dt.replace(tzinfo=timezone.utc)
            if cd_dt > now:
                secs = int((cd_dt - now).total_seconds())
                raise _boxing_fight_throttle_429(f"Fight cooldown: wait {secs}s", cooldown_seconds=max(1, secs))
        raise _boxing_fight_throttle_429(
            f"Fight cooldown: wait {NPC_FIGHT_COOLDOWN_SECONDS}s",
            cooldown_seconds=NPC_FIGHT_COOLDOWN_SECONDS,
        )

    prof = await _ensure_profile(current_user["id"])
    a_stats = {k: int(prof.get(k) or 10) for k in STAT_KEYS}
    b_stats = {k: int(npc.get(k) or 10) for k in STAT_KEYS}

    result = _simulate_fight(a_stats, b_stats)
    winner_side = result["winner"]
    reason = result["reason"]

    ra = int(prof.get("rating") or 1000)
    npc_rating = 800 + NPCS.index(npc) * 80
    is_win = winner_side == "a"
    is_draw = winner_side is None

    ra2, _ = _elo_update(ra, npc_rating, is_win) if not is_draw else (ra, npc_rating)

    xp_earned = 100 if is_win else 30 if not is_draw else 50
    if is_win and reason in ("ko", "tko"):
        xp_earned += 50

    reward = _npc_win_reward(npc) if is_win else 0

    inc_fields: Dict[str, int] = {}
    set_fields: Dict[str, Any] = {"rating": ra2}
    if is_win:
        inc_fields["wins"] = 1
        inc_fields["streak"] = 1
        inc_fields["total_earnings"] = reward
        if reason in ("ko", "tko"):
            inc_fields["ko_wins"] = 1
        new_streak = int(prof.get("streak") or 0) + 1
        if new_streak > int(prof.get("best_streak") or 0):
            set_fields["best_streak"] = new_streak
    elif is_draw:
        inc_fields["draws"] = 1
        set_fields["streak"] = 0
    else:
        inc_fields["losses"] = 1
        set_fields["streak"] = 0

    update_ops: Dict[str, Any] = {"$set": set_fields}
    if inc_fields:
        update_ops["$inc"] = inc_fields
    await db.boxing_profiles.update_one({"user_id": current_user["id"]}, update_ops, upsert=True)

    new_xp, new_level, points_gained = await _award_xp(current_user["id"], xp_earned)

    if reward > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": reward}})

    fight_id = str(uuid.uuid4())
    now = _now_iso()
    fight_doc = {
        "id": fight_id,
        "a_id": current_user["id"],
        "a_username": current_user.get("username") or "?",
        "b_id": npc["id"],
        "b_username": npc["name"],
        "b_is_npc": True,
        "winner_side": winner_side,
        "winner_id": current_user["id"] if is_win else npc["id"] if not is_draw else None,
        "reason": reason,
        "rounds": result["rounds"],
        "scorecard": result["scorecard"],
        "fight_stats": result["stats"],
        "total_rounds": result["total_rounds"],
        "reward": reward,
        "xp_earned": xp_earned,
        "created_at": now,
    }
    await db.boxing_fights.insert_one(fight_doc)
    fight_doc.pop("_id", None)

    await db.boxing_events.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "fight_id": fight_id,
        "result": "win" if is_win else "loss" if not is_draw else "draw",
        "points": (3 if is_win else 0) + (1 if is_win and reason in ("ko", "tko") else 0),
        "at": now,
    })

    prof2 = await _ensure_profile(current_user["id"])
    return {
        "fight_id": fight_id,
        "fight": fight_doc,
        "result": "win" if is_win else "loss" if not is_draw else "draw",
        "reason": reason,
        "reward": reward,
        "xp_earned": xp_earned,
        "level_ups": points_gained,
        "profile": prof2,
    }


async def boxing_fight_get(fight_id: str, current_user: dict = Depends(get_current_user)):
    fid = (fight_id or "").strip()
    if not fid:
        raise HTTPException(status_code=400, detail="fight_id required")
    fight = await db.boxing_fights.find_one({"id": fid}, {"_id": 0})
    if not fight:
        raise HTTPException(status_code=404, detail="Fight not found")
    return {"fight": fight}


async def boxing_challenge_create(
    payload: ChallengeRequest,
    request: Request,
    current_user: dict = Depends(get_current_user_verified),
):
    opp_name = (payload.opponent_username or "").strip()
    if not opp_name:
        raise HTTPException(status_code=400, detail="Opponent username required")

    await require_turnstile_for_minigame_start(
        db,
        request=request,
        current_user=current_user,
        captcha_token=payload.captcha_token,
        is_admin=_is_admin(current_user),
    )
    opp = await _find_user_by_username_for_challenge(opp_name)
    if not opp:
        raise HTTPException(status_code=404, detail="Player not found")
    if _user_id_match(opp["id"], current_user["id"]):
        raise HTTPException(status_code=400, detail="Cannot challenge yourself")

    my_ids = _user_id_query_values(current_user["id"])
    opp_ids = _user_id_query_values(opp["id"])
    existing = await db.boxing_challenges.find_one({
        "challenger_id": {"$in": my_ids},
        "target_id": {"$in": opp_ids},
        "state": "pending",
    })
    if existing:
        raise HTTPException(status_code=400, detail="You already have a pending challenge against this player")

    cid_self = str(current_user["id"])
    cid_opp = str(opp["id"])
    await _ensure_profile(cid_self)
    await _ensure_profile(cid_opp)

    a_prof = await db.boxing_profiles.find_one({"user_id": cid_self}, {"_id": 0, "rating": 1})
    b_prof = await db.boxing_profiles.find_one({"user_id": cid_opp}, {"_id": 0, "rating": 1})
    ra = int((a_prof or {}).get("rating") or 1000)
    rb = int((b_prof or {}).get("rating") or 1000)
    odds = _match_odds(ra, rb)

    challenge_id = str(uuid.uuid4())
    now = _now_iso()
    doc = {
        "id": challenge_id,
        "challenger_id": cid_self,
        "challenger_username": current_user.get("username") or "?",
        "target_id": cid_opp,
        "target_username": opp.get("username") or "?",
        "state": "pending",
        "odds": odds,
        "created_at": now,
    }
    await db.boxing_challenges.insert_one(doc)
    doc.pop("_id", None)
    ch_name = current_user.get("username") or "A player"
    await send_notification(
        cid_opp,
        "Boxing challenge",
        f"{ch_name} challenged you to a fight. Open Casino → Mini Games → Boxing, then the Fight tab, to accept.",
        "boxing_challenge",
    )
    return {"message": f"Challenge sent to {opp['username']}", "challenge_id": challenge_id, "challenge": doc}


async def boxing_challenge_accept(
    payload: AcceptChallengeRequest,
    request: Request,
    current_user: dict = Depends(get_current_user_verified),
):
    cid = (payload.challenge_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="challenge_id required")

    await require_turnstile_for_minigame_start(
        db,
        request=request,
        current_user=current_user,
        captcha_token=payload.captcha_token,
        is_admin=_is_admin(current_user),
    )

    # Atomic state transition to prevent two concurrent accepts from both running the fight
    ch = await db.boxing_challenges.find_one_and_update(
        {"id": cid, "state": "pending"},
        {"$set": {"state": "in_progress"}},
        projection={"_id": 0},
        return_document=False,
    )
    if not ch:
        raise HTTPException(status_code=404, detail="Challenge not found or already accepted")
    if not _user_id_match(ch.get("target_id"), current_user["id"]):
        await db.boxing_challenges.update_one({"id": cid, "state": "in_progress"}, {"$set": {"state": "pending"}})
        raise HTTPException(status_code=403, detail="This challenge is not for you")

    a_id, b_id = ch["challenger_id"], ch["target_id"]
    now_dt = datetime.now(timezone.utc)

    a_ok, a_remaining, a_hour_start_iso = await _claim_hourly_fight_slot(
        user_id=a_id,
        start_field="pvp_fight_hour_start",
        count_field="pvp_fight_hour_count",
        max_fights=PVP_MAX_FIGHTS_PER_HOUR,
        now_dt=now_dt,
    )
    if not a_ok:
        await db.boxing_challenges.update_one({"id": cid, "state": "in_progress"}, {"$set": {"state": "pending"}})
        raise _boxing_fight_throttle_429(
            f"{ch.get('challenger_username') or 'Challenger'} reached fight limit ({PVP_MAX_FIGHTS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again in {a_remaining}s.",
            cooldown_seconds=max(1, a_remaining),
        )

    b_ok, b_remaining, b_hour_start_iso = await _claim_hourly_fight_slot(
        user_id=b_id,
        start_field="pvp_fight_hour_start",
        count_field="pvp_fight_hour_count",
        max_fights=PVP_MAX_FIGHTS_PER_HOUR,
        now_dt=now_dt,
    )
    if not b_ok:
        await _release_hourly_fight_slot(
            user_id=a_id,
            start_field="pvp_fight_hour_start",
            count_field="pvp_fight_hour_count",
            hour_start_iso=a_hour_start_iso,
        )
        await db.boxing_challenges.update_one({"id": cid, "state": "in_progress"}, {"$set": {"state": "pending"}})
        raise _boxing_fight_throttle_429(
            f"Fight limit reached ({PVP_MAX_FIGHTS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again in {b_remaining}s.",
            cooldown_seconds=max(1, b_remaining),
        )

    a_prof = await _ensure_profile(a_id)
    b_prof = await _ensure_profile(b_id)

    a_stats = {k: int(a_prof.get(k) or 10) for k in STAT_KEYS}
    b_stats = {k: int(b_prof.get(k) or 10) for k in STAT_KEYS}

    result = _simulate_fight(a_stats, b_stats)
    winner_side = result["winner"]
    reason = result["reason"]
    is_draw = winner_side is None

    ra = int(a_prof.get("rating") or 1000)
    rb = int(b_prof.get("rating") or 1000)
    if not is_draw:
        a_won = winner_side == "a"
        ra2, rb2 = _elo_update(ra, rb, a_won)
    else:
        ra2, rb2 = ra, rb

    now = _now_iso()
    fight_id = str(uuid.uuid4())

    winner_id = a_id if winner_side == "a" else b_id if winner_side == "b" else None

    for uid, side, opp_id, new_rating in [(a_id, "a", b_id, ra2), (b_id, "b", a_id, rb2)]:
        is_win = winner_side == side
        xp_earned = 100 if is_win else 30 if not is_draw else 50
        if is_win and reason in ("ko", "tko"):
            xp_earned += 50

        inc_f: Dict[str, int] = {}
        set_f: Dict[str, Any] = {"rating": new_rating}
        p = await _ensure_profile(uid)
        if is_win:
            inc_f["wins"] = 1
            inc_f["streak"] = 1
            if reason in ("ko", "tko"):
                inc_f["ko_wins"] = 1
            ns = int(p.get("streak") or 0) + 1
            if ns > int(p.get("best_streak") or 0):
                set_f["best_streak"] = ns
        elif is_draw:
            inc_f["draws"] = 1
            set_f["streak"] = 0
        else:
            inc_f["losses"] = 1
            set_f["streak"] = 0

        ops: Dict[str, Any] = {"$set": set_f}
        if inc_f:
            ops["$inc"] = inc_f
        await db.boxing_profiles.update_one({"user_id": uid}, ops, upsert=True)
        await _award_xp(uid, xp_earned)

        await db.boxing_events.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid, "fight_id": fight_id,
            "result": "win" if is_win else "loss" if not is_draw else "draw",
            "points": (3 if is_win else 0) + (1 if is_win and reason in ("ko", "tko") else 0),
            "at": now,
        })

    fight_doc = {
        "id": fight_id,
        "a_id": a_id, "a_username": ch.get("challenger_username") or "?",
        "b_id": b_id, "b_username": ch.get("target_username") or "?",
        "b_is_npc": False,
        "winner_side": winner_side,
        "winner_id": winner_id,
        "reason": reason,
        "rounds": result["rounds"],
        "scorecard": result["scorecard"],
        "fight_stats": result["stats"],
        "total_rounds": result["total_rounds"],
        "challenge_id": cid,
        "created_at": now,
    }
    await db.boxing_fights.insert_one(fight_doc)
    fight_doc.pop("_id", None)

    await db.boxing_challenges.update_one({"id": cid, "state": "in_progress"}, {"$set": {"state": "completed", "fight_id": fight_id, "winner_id": winner_id}})

    await _settle_challenge_bets(cid, winner_id, is_draw, ch)

    prof2 = await _ensure_profile(current_user["id"])
    return {
        "fight_id": fight_id,
        "fight": fight_doc,
        "result": "win" if winner_side == "b" else "loss" if winner_side == "a" else "draw",
        "reason": reason,
        "profile": prof2,
    }


async def boxing_challenge_cancel(payload: CancelChallengeRequest, current_user: dict = Depends(get_current_user_verified)):
    cid = (payload.challenge_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="challenge_id required")
    ch = await db.boxing_challenges.find_one({"id": cid, "state": "pending"}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Challenge not found or already resolved")
    if not _user_id_match(ch.get("challenger_id"), current_user["id"]):
        raise HTTPException(status_code=403, detail="Not your challenge to cancel")

    await db.boxing_challenges.update_one({"id": cid}, {"$set": {"state": "cancelled"}})
    await _refund_challenge_bets(cid)
    return {"message": "Challenge cancelled"}


async def boxing_challenges_list(current_user: dict = Depends(get_current_user_verified)):
    uid_opts = _user_id_query_values(current_user["id"])
    if not uid_opts:
        return {"incoming": [], "outgoing": []}
    incoming = await db.boxing_challenges.find(
        {"target_id": {"$in": uid_opts}, "state": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(20)
    outgoing = await db.boxing_challenges.find(
        {"challenger_id": {"$in": uid_opts}, "state": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(20)
    return {"incoming": incoming, "outgoing": outgoing}


MAX_BOXING_BET = 1_000_000

async def boxing_bet_place(payload: BetRequest, current_user: dict = Depends(get_current_user_verified)):
    cid = (payload.challenge_id or "").strip()
    fighter = (payload.fighter or "").strip().lower()
    stake = int(payload.stake or 0)
    if fighter not in ("a", "b"):
        raise HTTPException(status_code=400, detail="fighter must be 'a' or 'b'")
    if stake <= 0:
        raise HTTPException(status_code=400, detail="Stake must be > 0")
    if stake > MAX_BOXING_BET:
        raise HTTPException(status_code=400, detail=f"Maximum bet is ${MAX_BOXING_BET:,}")

    ch = await db.boxing_challenges.find_one({"id": cid, "state": "pending"}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Challenge not found or already resolved")

    odds = float((ch.get("odds") or {}).get(fighter) or 2.0)
    bet_id = str(uuid.uuid4())
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": stake}},
        {"$inc": {"money": -stake}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.boxing_bets.insert_one({
        "id": bet_id, "user_id": current_user["id"],
        "challenge_id": cid, "fighter": fighter,
        "odds": odds, "stake": stake, "status": "open",
        "challenger_username": ch.get("challenger_username"),
        "target_username": ch.get("target_username"),
        "created_at": _now_iso(),
    })
    await log_gambling(
        current_user["id"], current_user.get("username") or "?", "boxing_bet",
        {"bet_id": bet_id, "challenge_id": cid, "fighter": fighter, "odds": odds, "stake": stake},
    )
    who = ch.get("challenger_username") if fighter == "a" else ch.get("target_username")
    return {"message": f"Bet ${stake:,} on {who}", "bet_id": bet_id}


async def boxing_bets_list(current_user: dict = Depends(get_current_user_verified)):
    open_bets = await db.boxing_bets.find(
        {"user_id": current_user["id"], "status": "open"}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    settled = await db.boxing_bets.find(
        {"user_id": current_user["id"], "status": {"$in": ["won", "lost", "refunded"]}}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"open": open_bets, "settled": settled}


async def _settle_challenge_bets(challenge_id: str, winner_id: Optional[str], is_draw: bool, challenge: dict):
    win_side = None
    if _user_id_match(winner_id, challenge.get("challenger_id")):
        win_side = "a"
    elif _user_id_match(winner_id, challenge.get("target_id")):
        win_side = "b"
    now = _now_iso()
    bets = await db.boxing_bets.find({"challenge_id": challenge_id, "status": "open"}, {"_id": 0}).to_list(2000)
    for bet in bets:
        if is_draw:
            res = await db.boxing_bets.update_one({"id": bet["id"], "status": "open"}, {"$set": {"status": "refunded", "settled_at": now}})
            if res.modified_count > 0:
                stake = int(bet.get("stake") or 0)
                if stake > 0:
                    await db.users.update_one({"id": bet["user_id"]}, {"$inc": {"money": stake}})
        else:
            won = win_side is not None and bet.get("fighter") == win_side
            status = "won" if won else "lost"
            res = await db.boxing_bets.update_one({"id": bet["id"], "status": "open"}, {"$set": {"status": status, "settled_at": now}})
            if res.modified_count > 0 and won:
                payout = int(int(bet.get("stake") or 0) * float(bet.get("odds") or 1.0))
                if payout > 0:
                    await db.users.update_one({"id": bet["user_id"]}, {"$inc": {"money": payout}})
        u = await db.users.find_one({"id": bet["user_id"]}, {"_id": 0, "username": 1})
        await log_gambling(
            bet["user_id"], (u or {}).get("username", "?"), "boxing_bet",
            {"bet_id": bet["id"], "challenge_id": challenge_id, "status": bet.get("status"), "settled_at": now},
        )


async def _refund_challenge_bets(challenge_id: str):
    now = _now_iso()
    bets = await db.boxing_bets.find({"challenge_id": challenge_id, "status": "open"}, {"_id": 0}).to_list(2000)
    for bet in bets:
        res = await db.boxing_bets.update_one({"id": bet["id"], "status": "open"}, {"$set": {"status": "refunded", "settled_at": now}})
        if res.modified_count > 0:
            stake = int(bet.get("stake") or 0)
            if stake > 0:
                await db.users.update_one({"id": bet["user_id"]}, {"$inc": {"money": stake}})


async def boxing_leaderboard(period: str = "weekly", current_user: dict = Depends(get_current_user)):
    p = (period or "weekly").lower()
    now = datetime.now(timezone.utc)
    staff_ids = await _get_staff_user_ids()
    staff_match = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
    if p == "weekly":
        ws = _week_start(now)
        pipeline = [
            {"$addFields": {"_ts": {"$toDate": "$at"}}},
            {"$match": {"_ts": {"$gte": ws}, **staff_match}},
            {"$group": {
                "_id": "$user_id",
                "points": {"$sum": "$points"},
                "wins": {"$sum": {"$cond": [{"$eq": ["$result", "win"]}, 1, 0]}},
                "losses": {"$sum": {"$cond": [{"$eq": ["$result", "loss"]}, 1, 0]}},
            }},
            {"$sort": {"points": -1, "wins": -1}},
            {"$limit": 25},
        ]
    else:
        pipeline = [
            {"$match": staff_match},
            {"$group": {
                "_id": "$user_id",
                "points": {"$sum": "$points"},
                "wins": {"$sum": {"$cond": [{"$eq": ["$result", "win"]}, 1, 0]}},
                "losses": {"$sum": {"$cond": [{"$eq": ["$result", "loss"]}, 1, 0]}},
            }},
            {"$sort": {"points": -1, "wins": -1}},
            {"$limit": 25},
        ]
    rows = await db.boxing_events.aggregate(pipeline).to_list(25)
    uids = [r["_id"] for r in rows if r.get("_id")]
    users = await db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "username": 1}).to_list(200)
    u_map = {u["id"]: u for u in users}
    out = []
    for i, r in enumerate(rows):
        uid = r.get("_id")
        u = u_map.get(uid) or {}
        out.append({
            "rank": i + 1,
            "user_id": uid,
            "username": u.get("username", "?"),
            "points": int(r.get("points") or 0),
            "wins": int(r.get("wins") or 0),
            "losses": int(r.get("losses") or 0),
            "is_current_user": bool(uid and uid == current_user.get("id")),
        })
    return {"period": p, "standings": out}


async def boxing_history(current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    fights = await db.boxing_fights.find(
        {"$or": [{"a_id": uid}, {"b_id": uid}]},
        {"_id": 0, "id": 1, "a_id": 1, "b_id": 1, "a_username": 1, "b_username": 1,
         "winner_side": 1, "winner_id": 1, "reason": 1, "total_rounds": 1,
         "reward": 1, "xp_earned": 1, "created_at": 1, "b_is_npc": 1},
    ).sort("created_at", -1).to_list(20)
    out = []
    for f in fights:
        is_a = f.get("a_id") == uid
        opponent = f.get("b_username") if is_a else f.get("a_username")
        won = f.get("winner_id") == uid
        draw = f.get("winner_id") is None
        out.append({
            "fight_id": f.get("id"),
            "opponent": opponent or "Unknown",
            "result": "draw" if draw else "win" if won else "loss",
            "reason": (f.get("reason") or "decision").replace("_", " "),
            "rounds": f.get("total_rounds") or 0,
            "reward": f.get("reward") or 0,
            "date": f.get("created_at"),
            "is_npc": bool(f.get("b_is_npc")),
        })
    return {"history": out}


# ── Background Tasks ─────────────────────────────────────────────────────────

BOXING_PAYOUT_CONFIG_ID = "boxing_weekly_payout"


async def expire_stale_challenges(database):
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    stale = await database.boxing_challenges.find(
        {"state": "pending", "created_at": {"$lte": cutoff}}, {"_id": 0, "id": 1}
    ).to_list(100)
    for ch in stale:
        await database.boxing_challenges.update_one({"id": ch["id"], "state": "pending"}, {"$set": {"state": "expired"}})
        await _refund_challenge_bets(ch["id"])


async def run_weekly_boxing_league_payout(database, test_run: bool = False):
    now = datetime.now(timezone.utc)
    this_week_start = _week_start(now)
    last_week_start = this_week_start - timedelta(days=7)
    last_week_start_str = last_week_start.strftime("%Y-%m-%d")
    cfg = await database.game_config.find_one(
        {"id": BOXING_PAYOUT_CONFIG_ID},
        {"_id": 0, "last_run_week_start": 1, "top1_points": 1, "top2_points": 1, "top3_points": 1, "top4_10_points": 1},
    )
    if cfg and cfg.get("last_run_week_start") == last_week_start_str and not test_run:
        return
    top1 = int((cfg or {}).get("top1_points") or 5000)
    top2 = int((cfg or {}).get("top2_points") or 3000)
    top3 = int((cfg or {}).get("top3_points") or 1000)
    top4_10 = int((cfg or {}).get("top4_10_points") or 500)

    def points_for_rank(rank: int) -> int:
        if rank == 1: return top1
        if rank == 2: return top2
        if rank == 3: return top3
        if 4 <= rank <= 10: return top4_10
        return 0

    if not test_run:
        claim_filter = {
            "id": BOXING_PAYOUT_CONFIG_ID,
            "$or": [{"last_run_week_start": {"$ne": last_week_start_str}}, {"last_run_week_start": {"$exists": False}}],
        }
        claim_result = await database.game_config.update_one(claim_filter, {"$set": {"last_run_week_start": last_week_start_str}}, upsert=True)
        if claim_result.modified_count == 0 and claim_result.upserted_id is None:
            return

    pipeline = [
        {"$addFields": {"_ts": {"$toDate": "$at"}}},
        {"$match": {"_ts": {"$gte": last_week_start, "$lt": this_week_start}}},
        {"$group": {"_id": "$user_id", "points": {"$sum": "$points"}}},
        {"$sort": {"points": -1}},
        {"$limit": 10},
    ]
    rows = await database.boxing_events.aggregate(pipeline).to_list(10)
    if test_run:
        return
    for i, r in enumerate(rows):
        uid = r.get("_id")
        if not uid:
            continue
        pts = points_for_rank(i + 1)
        if pts > 0:
            await database.users.update_one({"id": uid}, {"$inc": {"money": pts}})


# ── Route Registration ───────────────────────────────────────────────────────

def register(router):
    router.add_api_route("/boxing/me", boxing_me, methods=["GET"])
    router.add_api_route("/boxing/opponents", boxing_opponents, methods=["GET"])
    router.add_api_route("/boxing/train", boxing_train, methods=["POST"])
    router.add_api_route("/boxing/allocate", boxing_allocate, methods=["POST"])
    router.add_api_route("/boxing/fight/npc", boxing_fight_npc, methods=["POST"])
    router.add_api_route("/boxing/fight/challenge", boxing_challenge_create, methods=["POST"])
    router.add_api_route("/boxing/fight/accept", boxing_challenge_accept, methods=["POST"])
    router.add_api_route("/boxing/fight/cancel", boxing_challenge_cancel, methods=["POST"])
    router.add_api_route("/boxing/fight/{fight_id}", boxing_fight_get, methods=["GET"])
    router.add_api_route("/boxing/challenges", boxing_challenges_list, methods=["GET"])
    router.add_api_route("/boxing/bet", boxing_bet_place, methods=["POST"])
    router.add_api_route("/boxing/bets", boxing_bets_list, methods=["GET"])
    router.add_api_route("/boxing/leaderboard", boxing_leaderboard, methods=["GET"])
    router.add_api_route("/boxing/history", boxing_history, methods=["GET"])
