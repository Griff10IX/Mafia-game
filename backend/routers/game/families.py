# Families: list, create, join, leave, kick, roles, treasury, rackets, crew OC, war stats/truce/history
from datetime import datetime, timezone, timedelta
import asyncio
import logging
import secrets
_rng = secrets.SystemRandom()
import time
import uuid
import os
import sys
from typing import Optional, Dict, List
from collections import defaultdict

logger = logging.getLogger(__name__)

# Caching: config is static; list and my have short TTL, invalidated on mutations
_config_cache: Optional[dict] = None
_list_cache: Optional[tuple] = None  # (payload, expires_at)
_list_cache_ttl_sec = 20
_my_cache: Dict[str, tuple] = {}  # user_id -> (payload, expires_at)
_my_cache_ttl_sec = 10
_my_cache_max_entries = 2000

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException, Body
from pydantic import BaseModel

from utils.notepad_color import notepad_color_for_api_response, normalize_notepad_color_for_set

from server import (
    db,
    get_current_user,
    get_effective_event,
    log_activity,
    log_respect_earned,
    RANKS,
    send_notification,
    send_notification_to_family,
    maybe_process_rank_up,
    set_state_head,
    _get_active_war_between,
    _get_active_war_for_family,
    _family_in_active_war,
    _family_war_duration_seconds,
    _family_war_start,
    _record_war_stats_bodyguard_kill,  # kept for potential direct use
    founding_member_income_mult,
    _is_admin,
)

# ============ Constants ============
MAX_FAMILIES = 10
# Admin-seeded / tool-created families set player_cap_exempt=True so they do not count toward this cap.
FAMILY_LIST_QUERY_LIMIT = 500  # list view: player crews + exempt crews
FAMILY_CREATE_COST = 75_000_000  # $75M to create a family
FAMILY_ROLES = ["boss", "underboss", "consigliere", "capo", "soldier", "associate"]
FAMILY_ROLE_LIMITS = {"boss": 1, "underboss": 1, "consigliere": 1, "capo": 4, "soldier": 15, "associate": 30}
FAMILY_ROLE_ORDER = {"boss": 0, "underboss": 1, "consigliere": 2, "capo": 3, "soldier": 4, "associate": 5}

# 75% reduction for beta on all racket base_income
RACKET_BASE_COOLDOWN_HOURS = 10 / 60  # 10 minutes
FAMILY_RACKETS = [
    {"id": "protection", "name": "Protection Racket", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 100, "description": "Extortion from businesses"},
    {"id": "gambling", "name": "Gambling Operation", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 138, "description": "Numbers & bookmaking"},
    {"id": "loansharking", "name": "Loan Sharking", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 175, "description": "High-interest loans"},
    {"id": "labour", "name": "Labour Racketeering", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 213, "description": "Union kickbacks"},
    {"id": "distillery", "name": "Distillery", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 250, "description": "Bootleg liquor production"},
    {"id": "warehouse", "name": "Warehouse", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 288, "description": "Storage and distribution"},
    {"id": "restaurant_bar", "name": "Restaurant & Bar", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 325, "description": "Front and steady income"},
    {"id": "funeral_home", "name": "Funeral Home", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 363, "description": "Respectable front"},
    {"id": "garment_shop", "name": "Garment Shop", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 400, "description": "Garment district operations"},
]
RACKET_UPGRADE_COST = 12_500  # 75% reduction
RACKET_UNLOCK_COST = 25_000  # 75% reduction
RACKET_MAX_LEVEL = 5
FAMILY_RACKET_ATTACK_BASE_SUCCESS = 0.70
FAMILY_RACKET_ATTACK_LEVEL_PENALTY = 0.10
FAMILY_RACKET_ATTACK_MIN_SUCCESS = 0.10
FAMILY_RACKET_ATTACK_REVENUE_PCT = 0.25
FAMILY_RACKET_ATTACK_MAX_PER_CREW = 2
FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS = 3

CREW_OC_COOLDOWN_HOURS = 8

# Casino game types that contribute to state head income (and have gambling_log entries with city/state)
STATE_HEAD_CASINO_GAMES = ["dice", "roulette", "blackjack", "horseracing", "slots", "videopoker"]


async def count_families_toward_player_cap() -> int:
    """Crews that count toward MAX_FAMILIES for player creation (admin tools set player_cap_exempt)."""
    return await db.families.count_documents({
        "wiped": {"$ne": True},
        "player_cap_exempt": {"$ne": True},
    })


async def _state_head_casino_week_stats(state_name: str):
    """Aggregate gambling_log for the current week (Monday 00:00 UTC) in the given state. Returns { game_type: { wins, losses } }."""
    if not state_name or not state_name.strip():
        return {}
    state = (state_name or "").strip()
    now = datetime.now(timezone.utc)
    days_since_monday = (now.isoweekday() - 1) % 7
    week_start = (now - timedelta(days=days_since_monday)).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_iso = week_start.isoformat()
    result = {gt: {"wins": 0, "losses": 0} for gt in STATE_HEAD_CASINO_GAMES}

    def _is_win(game_type: str, details: dict) -> bool:
        if game_type == "dice":
            return bool(details.get("win"))
        if game_type == "roulette":
            return bool(details.get("win"))
        if game_type == "blackjack":
            return details.get("result") in ("win", "dealer_bust")
        if game_type == "horseracing":
            return bool(details.get("won"))
        if game_type == "slots":
            return bool(details.get("won")) or (int(details.get("payout") or 0) > 0)
        if game_type == "videopoker":
            return (int(details.get("payout") or 0) > int(details.get("bet") or 0))
        return False

    def _in_state(game_type: str, details: dict) -> bool:
        city = (details.get("city") or "").strip()
        st = (details.get("state") or "").strip()
        return city.lower() == state.lower() or st.lower() == state.lower()

    try:
        cursor = db.gambling_log.find(
            {"created_at": {"$gte": week_start_iso}, "game_type": {"$in": STATE_HEAD_CASINO_GAMES}},
            {"_id": 0, "game_type": 1, "details": 1},
        )
        async for entry in cursor:
            gt = (entry.get("game_type") or "").strip()
            details = entry.get("details") or {}
            if gt not in result or not _in_state(gt, details):
                continue
            if _is_win(gt, details):
                result[gt]["wins"] += 1
            else:
                result[gt]["losses"] += 1
    except Exception:
        pass
    return result
CREW_OC_COOLDOWN_HOURS_REDUCED = 6
CREW_OC_REWARD_RP = 80
CREW_OC_REWARD_CASH = 10_000  # 75% reduction
CREW_OC_REWARD_BULLETS = 25  # 75% reduction
CREW_OC_REWARD_POINTS = 3
CREW_OC_REWARD_BOOZE = 10
CREW_OC_TREASURY_LUMP = 50_000  # 75% reduction

FAMILY_RACKET_RAID_SUCCESS_MESSAGES = [
    "Raid successful! Took ${amount:,} from {family_name}'s {racket_name}.",
    "Clean score. ${amount:,} from {family_name}'s racket.",
    "You hit their {racket_name}. ${amount:,} to your treasury.",
    "Raid successful. ${amount:,} from {family_name}.",
    "The take: ${amount:,} from {family_name}'s {racket_name}.",
    "No heat. ${amount:,} from their {racket_name}.",
    "Done. ${amount:,} taken from {family_name}.",
    "Smooth run. ${amount:,} from {family_name}'s racket.",
    "Score. ${amount:,} from {family_name}'s {racket_name}.",
    "Raid paid off. ${amount:,}.",
]
FAMILY_RACKET_RAID_FAIL_MESSAGES = [
    "Raid failed.",
    "No dice. {family_name}'s {racket_name} held.",
    "They were ready. Raid failed.",
    "The crew at {family_name} pushed back. No take.",
    "Raid blown. {family_name}'s racket didn't give.",
    "Wrong move. Raid failed.",
    "Their muscle held the line. No score.",
    "Raid failed. {family_name} was buttoned up.",
    "No score. Try again when the heat's off.",
    "The raid didn't stick. No payout.",
]

FAMILY_RACKET_COLLECT_SUCCESS_MESSAGES = [
    "Collected ${income:,}", "Your cut: ${income:,}", "Racket paid out. ${income:,} to the family.",
    "Collected ${income:,} from the racket.", "The take: ${income:,}.", "Payout collected. ${income:,}.",
    "${income:,} in the bag.", "Racket income: ${income:,}.", "Collected ${income:,}. Clean.", "Your share: ${income:,}.",
]

FAMILY_MELT_TREASURY_PCT_MAX = 50
FAMILY_MELT_REWARD_THRESHOLD_STEP = 1000
FAMILY_MELT_REWARD_THRESHOLD_MAX = 5_000_000
FAMILY_MELT_REWARD_MONEY_MAX = 5_000_000_000


# ============ Request models ============
class FamilyCreateRequest(BaseModel):
    name: str
    tag: str


class FamilyJoinRequest(BaseModel):
    family_id: str


class FamilyApplyRequest(BaseModel):
    family_id: str


class FamilyJoinSettingsRequest(BaseModel):
    join_mode: Optional[str] = None   # "open" | "approval"
    join_auto_accept: Optional[str] = None   # "none" | "all" | "rank_min"
    join_auto_accept_rank_min: Optional[int] = None   # rank id; used when join_auto_accept == "rank_min"


class FamilyMeltRewardTier(BaseModel):
    threshold_bullets: int
    reward_money: int


class FamilyMeltSettingsRequest(BaseModel):
    melt_treasury_pct: Optional[int] = None
    melt_reward_tiers: Optional[List[FamilyMeltRewardTier]] = None


class FamilyJoinApplicationActionRequest(BaseModel):
    pass  # path param application_id


class FamilyKickRequest(BaseModel):
    user_id: str


class FamilyRoleRequest(BaseModel):
    user_id: str
    role: str


class FamilyDepositRequest(BaseModel):
    amount: int = 0
    bullets: int = 0


class FamilyWithdrawRequest(BaseModel):
    amount: int = 0
    bullets: int = 0


class FamilyGiveBulletsRequest(BaseModel):
    user_id: str
    bullets: int


class CompoundDepositRequest(BaseModel):
    cash: int = 0
    points: int = 0
    loot_pieces: int = 0


class CompoundWithdrawRequest(BaseModel):
    cash: int = 0
    points: int = 0
    loot_pieces: int = 0


class CompoundReturnToMemberRequest(BaseModel):
    user_id: str


class CompoundClaimForFamilyRequest(BaseModel):
    user_id: str


class FamilyAttackRacketRequest(BaseModel):
    family_id: str
    racket_id: str


class FamilyCrewOCSetFeeRequest(BaseModel):
    fee: int


class FamilyCrewOCSetAutoAcceptRequest(BaseModel):
    auto_accept: bool


class FamilyCrewOCApplyRequest(BaseModel):
    family_id: str


class FamilyProfileTextRequest(BaseModel):
    profile_text: Optional[str] = None
    notepad_color: Optional[str] = None


class FamilyAvatarRequest(BaseModel):
    avatar_data: Optional[str] = None  # data URL (data:image/...); empty or null to clear


class WarTruceRequest(BaseModel):
    war_id: str


# ============ Helpers ============
def _racket_income_and_cooldown(racket_id: str, level: int, ev: dict):
    r = next((x for x in FAMILY_RACKETS if x["id"] == racket_id), None)
    if not r or level <= 0:
        return 0, 0
    base_income = r["base_income"] * level
    cooldown = r["cooldown_hours"]
    payout_mult = ev.get("racket_payout", 1.0)
    cooldown_mult = ev.get("racket_cooldown", 1.0)
    return int(base_income * payout_mult), cooldown * cooldown_mult


# When a family wins a war (enemy wiped), winner gets this % extra on all racket income (passive, permanent stack).
WAR_WIN_RACKET_INCOME_BONUS_PERCENT = 2.5
# Cap: bonus from war wins cannot exceed this (anything after 25% is not added).
RACKET_INCOME_BONUS_CAP_PERCENT = 25.0


def _racket_available_income(racket_id: str, level: int, last_collected_at: Optional[str], ev: dict, now=None, war_duration_seconds: float = 0):
    """Income that would be collected now if the racket is off cooldown; 0 if on cooldown. war_duration_seconds extends the cooldown (rackets don't produce during war)."""
    if level <= 0:
        return 0
    income, cooldown_h = _racket_income_and_cooldown(racket_id, level, ev)
    if cooldown_h <= 0:
        return income
    if not last_collected_at:
        return income
    try:
        last_dt = datetime.fromisoformat(str(last_collected_at).replace("Z", "+00:00"))
        if now is None:
            now = datetime.now(timezone.utc)
        effective_cooldown_end = last_dt + timedelta(hours=cooldown_h) + timedelta(seconds=war_duration_seconds)
        if effective_cooldown_end <= now:
            return income
    except Exception:
        return income
    return 0


def compute_loser_racket_cash(rackets: dict, ev: dict, now=None, war_doc: Optional[dict] = None):
    """Sum of uncollected (available) income from all rackets. Used when awarding war winner. If war_doc provided, exclude war period (rackets don't produce during war)."""
    if now is None:
        now = datetime.now(timezone.utc)
    if war_doc:
        try:
            war_start = datetime.fromisoformat(str(war_doc.get("created_at") or "").replace("Z", "+00:00"))
        except Exception:
            war_start = None
        war_end_raw = war_doc.get("ended_at")
        war_end = now
        if war_end_raw:
            try:
                war_end = datetime.fromisoformat(str(war_end_raw).replace("Z", "+00:00"))
            except Exception:
                pass
    total = 0
    for racket_id, state in (rackets or {}).items():
        level = state.get("level", 0)
        if level <= 0:
            continue
        last_at = state.get("last_collected_at")
        racket_war_sec = 0.0
        if war_doc and war_start and last_at:
            try:
                last_dt = datetime.fromisoformat(str(last_at).replace("Z", "+00:00"))
                overlap_start = max(last_dt, war_start)
                overlap_end = min(now, war_end)
                if overlap_start < overlap_end:
                    racket_war_sec = (overlap_end - overlap_start).total_seconds()
            except Exception:
                pass
        total += _racket_available_income(racket_id, level, last_at, ev, now=now, war_duration_seconds=racket_war_sec)
    return total


def _racket_previous_id(racket_id: str):
    ids = [x["id"] for x in FAMILY_RACKETS]
    if racket_id not in ids:
        return None
    i = ids.index(racket_id)
    return ids[i - 1] if i > 0 else None


async def cleanup_dead_families():
    """Mark families where all members are dead as wiped (soft-delete); transfer assets to war winners.
    Returns True if any family was marked as wiped (caller should invalidate list cache)."""
    families = await db.families.find({"wiped": {"$ne": True}}, {"_id": 0}).to_list(50)
    if not families:
        return False
    family_ids = [f["id"] for f in families]
    all_members = await db.family_members.find(
        {"family_id": {"$in": family_ids}},
        {"_id": 0, "family_id": 1, "user_id": 1},
    ).to_list(500)
    members_by_family: dict = defaultdict(list)
    user_ids = set()
    for m in all_members:
        fid = m.get("family_id")
        uid = m.get("user_id")
        if fid and uid:
            members_by_family[fid].append(m)
            user_ids.add(uid)
    alive_by_user_id: dict = {}
    if user_ids:
        async for u in db.users.find(
            {"id": {"$in": list(user_ids)}},
            {"_id": 0, "id": 1, "is_dead": 1},
        ):
            uid = u.get("id")
            if uid:
                alive_by_user_id[uid] = not u.get("is_dead", False)
    marked_any = False
    for fam in families:
        family_id = fam["id"]
        members = members_by_family.get(family_id, [])
        living_count = sum(1 for m in members if alive_by_user_id.get(m["user_id"]))
        if living_count == 0:
            active_wars = await db.family_wars.find({
                "$or": [{"family_a_id": family_id}, {"family_b_id": family_id}],
                "status": {"$in": ["active", "truce_offered"]}
            }, {"_id": 0}).to_list(10)
            now_dt = datetime.now(timezone.utc)
            now = now_dt.isoformat()
            rackets = fam.get("rackets") or {}
            treasury = int(fam.get("treasury", 0) or 0)
            compound_cash = int(fam.get("compound_cash", 0) or 0)
            compound_points = int(fam.get("compound_points", 0) or 0)
            compound_loot_pieces = int(fam.get("compound_loot_pieces", 0) or 0)
            ev = await get_effective_event()
            prize_racket_cash = compute_loser_racket_cash(rackets, ev, now=now_dt)
            total_cash_prize = treasury + prize_racket_cash + compound_cash
            assets_transferred = False
            winner_id = None
            winner_family_name = None
            winner_fam_doc = None
            # If all wars already ended (e.g. by kill path), get winner from most recent ended war
            if not active_wars:
                ended = await db.family_wars.find_one(
                    {"$or": [{"family_a_id": family_id}, {"family_b_id": family_id}], "status": {"$in": ["family_a_wins", "family_b_wins"]}},
                    {"_id": 0, "winner_family_id": 1, "winner_family_name": 1},
                    sort=[("ended_at", -1)],
                )
                if ended:
                    winner_id = ended.get("winner_family_id")
                    winner_family_name = (ended.get("winner_family_name") or "?").strip() or "?"
                    if winner_id:
                        winner_fam_doc = await db.families.find_one({"id": winner_id}, {"_id": 0, "name": 1, "tag": 1})
                        if winner_fam_doc:
                            winner_family_name = (winner_fam_doc.get("name") or winner_fam_doc.get("tag") or winner_id).strip() or winner_id
            for active_war in active_wars:
                winner_id = active_war["family_b_id"] if active_war["family_a_id"] == family_id else active_war["family_a_id"]
                loser_id = family_id
                war_status = "family_a_wins" if winner_id == active_war["family_a_id"] else "family_b_wins"
                prize_treasury = 0
                prize_racket_cash_record = 0
                if not assets_transferred:
                    total_crew_bank = 0
                    winner_fam = await db.families.find_one({"id": winner_id}, {"_id": 0, "treasury": 1, "racket_income_bonus_percent": 1, "boss_id": 1})
                    if winner_fam is not None:
                        if total_cash_prize > 0:
                            await db.families.update_one({"id": winner_id}, {"$inc": {"treasury": total_cash_prize}})
                            prize_treasury = treasury
                            prize_racket_cash_record = prize_racket_cash
                        if compound_points > 0 or compound_loot_pieces > 0:
                            await db.families.update_one(
                                {"id": winner_id},
                                {"$inc": {"compound_points": compound_points, "compound_loot_pieces": compound_loot_pieces}},
                            )
                        current_bonus = float((winner_fam.get("racket_income_bonus_percent") or 0) or 0)
                        new_bonus = min(current_bonus + WAR_WIN_RACKET_INCOME_BONUS_PERCENT, RACKET_INCOME_BONUS_CAP_PERCENT)
                        await db.families.update_one(
                            {"id": winner_id},
                            {"$set": {"racket_income_bonus_percent": new_bonus}}
                        )
                        # Transfer crew bank from loser members to winner's boss
                        loser_member_ids = [m["user_id"] for m in members]
                        crew_profiles = await db.racing_profiles.find({"user_id": {"$in": loser_member_ids}}, {"_id": 0, "crew_bank": 1}).to_list(100)
                        total_crew_bank = sum(int((p.get("crew_bank") or 0)) for p in crew_profiles)
                        winner_boss_id = winner_fam.get("boss_id")
                        if total_crew_bank > 0 and winner_boss_id:
                            await db.racing_profiles.update_one(
                                {"user_id": winner_boss_id},
                                {"$inc": {"crew_bank": total_crew_bank}},
                                upsert=True,
                            )
                    msg = (
                        f"The enemy family {fam['name']} has been destroyed! You received ${total_cash_prize:,} (their treasury + racket cash + compound) and a permanent +{WAR_WIN_RACKET_INCOME_BONUS_PERCENT}% on all your racket income."
                    )
                    if total_crew_bank > 0:
                        msg += f" Crew bank seized: ${total_crew_bank:,}."
                    await send_notification_to_family(winner_id, "🏆 WAR VICTORY!", msg, "system")
                    assets_transferred = True
                winner_fam_doc = await db.families.find_one({"id": winner_id}, {"_id": 0, "name": 1, "tag": 1})
                winner_family_name = (winner_fam_doc or {}).get("name") or (winner_fam_doc or {}).get("tag") or winner_id
                loser_family_name = fam.get("name") or fam.get("tag") or loser_id
                await db.family_wars.update_one(
                    {"id": active_war["id"]},
                    {"$set": {
                        "status": war_status,
                        "winner_family_id": winner_id,
                        "loser_family_id": loser_id,
                        "winner_family_name": winner_family_name,
                        "loser_family_name": loser_family_name,
                        "ended_at": now,
                        "prize_rackets": None,
                        "prize_treasury": prize_treasury,
                        "prize_racket_cash": prize_racket_cash_record,
                        "prize_compound_cash": compound_cash,
                        "prize_compound_points": compound_points,
                        "prize_compound_loot_pieces": compound_loot_pieces,
                    }}
                )
            head_state = (fam.get("head_of_state") or "").strip()
            if head_state:
                if winner_id:
                    # Check if winner's family already heads a state
                    winner_fam = await db.families.find_one({"id": winner_id}, {"_id": 0, "head_of_state": 1, "name": 1})
                    winner_current_state = (winner_fam or {}).get("head_of_state") or ""
                    if winner_current_state.strip():
                        # Winner already heads a state - offer them a choice to takeover
                        await db.families.update_one(
                            {"id": winner_id},
                            {"$set": {
                                "pending_state_takeover": head_state,
                                "pending_state_takeover_at": datetime.now(timezone.utc).isoformat(),
                            }}
                        )
                        # Clear the conquered state for now (they can claim it if they accept)
                        await set_state_head(head_state, None)
                    else:
                        # Winner doesn't head a state - give them this one directly
                        await set_state_head(head_state, winner_id)
                else:
                    # No winner - just clear the state
                    await set_state_head(head_state, None)
            # Keep family_members so wiped crew profile can show "In Memoriam" (all dead members)
            # Soft-delete: mark as wiped so crew profile still viewable (e.g. /game/family/:id)
            winner_name = (winner_fam_doc or {}).get("name") or (winner_fam_doc or {}).get("tag") or (winner_id or "?")
            await db.families.update_one(
                {"id": family_id},
                {"$set": {
                    "wiped": True,
                    "wiped_at": now,
                    "wiped_by_family_id": winner_id,
                    "wiped_by_family_name": winner_family_name,
                    "boss_id": None,
                    "rackets": {},
                    "treasury": 0,
                    "treasury_bullets": 0,
                    "treasury_points": 0,
                    "treasury_loot_pieces": 0,
                    "melt_treasury_pct": 0,
                    "melt_reward_tiers": [],
                    "compound_cash": 0,
                    "compound_points": 0,
                    "compound_loot_pieces": 0,
                    "compound_deposits_by_user": {},
                }}
            )
            marked_any = True

    return marked_any


_family_raid_locks: Dict[tuple, asyncio.Lock] = {}
_family_raid_locks_guard = asyncio.Lock()


async def _get_family_raid_lock(attacker_family_id: str, target_family_id: str) -> asyncio.Lock:
    key = (attacker_family_id, target_family_id)
    async with _family_raid_locks_guard:
        if key not in _family_raid_locks:
            _family_raid_locks[key] = asyncio.Lock()
        return _family_raid_locks[key]


# ============ Vendetta / war stats helpers ============
def _norm_fid(fid):
    """Return a stripped non-empty string or None."""
    if fid is None:
        return None
    s = str(fid).strip()
    return s if s else None


async def resolve_family_id(user_id: str):
    """Resolve a user's family_id: users.family_id → family_members → families.boss_id."""
    if not user_id:
        return None
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "family_id": 1})
    fid = _norm_fid((u or {}).get("family_id"))
    if fid:
        return fid
    m = await db.family_members.find_one({"user_id": user_id}, {"_id": 0, "family_id": 1})
    fid = _norm_fid((m or {}).get("family_id"))
    if fid:
        return fid
    fam = await db.families.find_one({"boss_id": user_id}, {"_id": 0, "id": 1})
    return _norm_fid((fam or {}).get("id"))


async def _batch_resolve_family_ids(user_ids: list) -> dict:
    """Map user_id -> family id (same rules as resolve_family_id, batched)."""
    out: dict = {}
    if not user_ids:
        return out
    user_ids = list(dict.fromkeys([u for u in user_ids if u]))
    udocs = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "family_id": 1}).to_list(len(user_ids))
    seen = {u.get("id") for u in udocs}
    need_member = []
    for u in udocs:
        uid = u.get("id")
        if not uid:
            continue
        fid = _norm_fid(u.get("family_id"))
        if fid:
            out[uid] = fid
        else:
            need_member.append(uid)
    for uid in user_ids:
        if uid not in seen:
            need_member.append(uid)
    need_member = list(dict.fromkeys([u for u in need_member if u not in out]))
    if need_member:
        mdocs = await db.family_members.find({"user_id": {"$in": need_member}}, {"_id": 0, "user_id": 1, "family_id": 1}).to_list(200)
        mby = {m["user_id"]: m for m in mdocs}
        need_boss = []
        for uid in need_member:
            if uid in out:
                continue
            m = mby.get(uid)
            fid = _norm_fid((m or {}).get("family_id")) if m else None
            if fid:
                out[uid] = fid
            else:
                need_boss.append(uid)
    else:
        need_boss = []
    if need_boss:
        fdocs = await db.families.find({"boss_id": {"$in": need_boss}}, {"_id": 0, "id": 1, "boss_id": 1}).to_list(50)
        for f in fdocs:
            bid = f.get("boss_id")
            if bid and bid not in out:
                out[bid] = _norm_fid(f.get("id"))
    return out


def _uid_str(uid) -> Optional[str]:
    """Normalize user ids for Mongo lookups (family_members.user_id vs users.id type mismatches)."""
    if uid is None:
        return None
    s = str(uid).strip()
    return s or None


async def _users_map_by_ids(user_ids: list, projection: Optional[dict] = None) -> dict:
    """Return dict id -> user doc for non-empty unique ids (keys are normalized string ids)."""
    if not user_ids:
        return {}
    uids = list(dict.fromkeys([s for u in user_ids if (s := _uid_str(u))]))
    proj = projection or {
        "_id": 0,
        "id": 1,
        "username": 1,
        "rank": 1,
        "is_dead": 1,
        "dead_at": 1,
        "bullets_melted": 1,
        "family_bullets_melted": 1,
        "family_melt_reward_money_earned": 1,
        "family_melt_reward_hits": 1,
    }
    # Match users.id whether stored as string or legacy int (Mongo $in is strict on type)
    or_clauses = []
    seen = set()
    for uid in uids:
        or_clauses.append({"id": uid})
        seen.add(uid)
        if uid.isdigit():
            try:
                n = int(uid)
                key = f"int:{n}"
                if key not in seen:
                    seen.add(key)
                    or_clauses.append({"id": n})
            except ValueError:
                pass
    docs = await db.users.find({"$or": or_clauses}, proj).to_list(200) if or_clauses else []
    out = {}
    for d in docs:
        k = _uid_str(d.get("id"))
        if k:
            out[k] = d
    return out


async def family_qualifies_for_state_head(family_id: str) -> bool:
    """True if the family's boss has prestige_level >= 1."""
    if not (family_id or "").strip():
        return False
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    if not fam or not (fam.get("boss_id") or "").strip():
        return False
    boss = await db.users.find_one(
        {"id": fam["boss_id"], "is_dead": {"$ne": True}},
        {"_id": 0, "prestige_level": 1},
    )
    if not boss:
        return False
    return int(boss.get("prestige_level") or 0) >= 1


# Promotion order when boss dies: next in line becomes boss, others shift up
PROMOTION_ORDER = ["underboss", "consigliere", "capo", "soldier", "associate"]
ASSIGNMENT_SEQUENCE = ["boss", "underboss", "consigliere"] + ["capo"] * 4 + ["soldier"] * 15 + ["associate"] * 30


async def maybe_promote_after_boss_death(dead_user_id: str) -> None:
    """If dead_user_id was the boss of a family, promote the next in line (underboss -> boss, etc.)."""
    fam = await db.families.find_one({"boss_id": dead_user_id}, {"_id": 0, "id": 1, "name": 1})
    if not fam:
        return
    family_id = fam["id"]
    members = await db.family_members.find(
        {"family_id": family_id},
        {"_id": 0, "user_id": 1, "role": 1},
    ).to_list(100)
    if not members:
        return
    member_by_uid = {m["user_id"]: m for m in members}
    alive_user_ids = [
        m["user_id"]
        for m in members
        if m["user_id"] != dead_user_id
    ]
    if not alive_user_ids:
        return
    alive_users = await db.users.find(
        {"id": {"$in": alive_user_ids}, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(len(alive_user_ids))
    alive_ids = {u["id"] for u in alive_users}
    alive_members = [m for m in members if m["user_id"] in alive_ids]
    if not alive_members:
        return
    # Sort by role seniority (underboss first, then consigliere, capo, soldier, associate)
    def sort_key(m):
        role = (m.get("role") or "").strip().lower()
        return (PROMOTION_ORDER.index(role) if role in PROMOTION_ORDER else 99, m["user_id"])
    alive_members.sort(key=sort_key)
    # Assign roles in order: first -> boss, second -> underboss, third -> consigliere, then capos, soldiers, associates
    role_assignments = []
    for i, m in enumerate(alive_members):
        role_assignments.append((m["user_id"], ASSIGNMENT_SEQUENCE[i] if i < len(ASSIGNMENT_SEQUENCE) else "associate"))
    new_boss_id = role_assignments[0][0]
    await db.families.update_one({"id": family_id}, {"$set": {"boss_id": new_boss_id}})
    for user_id, new_role in role_assignments:
        await db.family_members.update_one(
            {"family_id": family_id, "user_id": user_id},
            {"$set": {"role": new_role}},
        )
        await db.users.update_one({"id": user_id}, {"$set": {"family_role": new_role}})
        _invalidate_my_cache(user_id)
    _list_cache = None
    logger.info("Family %s: promoted %s to boss after previous boss died.", family_id, new_boss_id)


# ============ Cache helpers ============
def _invalidate_list_cache():
    global _list_cache
    _list_cache = None


def _invalidate_my_cache(user_id: str):
    _my_cache.pop(user_id, None)


# ============ Routes ============
async def families_list(current_user: dict = Depends(get_current_user)):
    marked = await cleanup_dead_families()
    if marked:
        _invalidate_list_cache()
    # No in-memory cache: multi-worker setups would show stale data (e.g. deleted families) until TTL
    cursor = db.families.find({"wiped": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "treasury": 1, "join_mode": 1})
    fams = await cursor.to_list(FAMILY_LIST_QUERY_LIMIT)
    out = []
    if fams:
        family_ids = [f["id"] for f in fams]
        # Batched queries: avoid 1 + N families + N*M users round-trips (was killing small Mongo tiers)
        all_members = await db.family_members.find(
            {"family_id": {"$in": family_ids}},
            {"_id": 0, "family_id": 1, "user_id": 1},
        ).to_list(500)
        members_by_family: dict = defaultdict(list)
        user_ids = set()
        for m in all_members:
            fid = m.get("family_id")
            uid = m.get("user_id")
            if fid and uid:
                members_by_family[fid].append(uid)
                user_ids.add(uid)
        alive_by_user_id: dict = {}
        if user_ids:
            ucursor = db.users.find(
                {"id": {"$in": list(user_ids)}},
                {"_id": 0, "id": 1, "is_dead": 1},
            )
            async for u in ucursor:
                uid = u.get("id")
                if uid:
                    alive_by_user_id[uid] = not u.get("is_dead", False)
        for f in fams:
            fid = f["id"]
            living_count = sum(1 for uid in members_by_family.get(fid, ()) if alive_by_user_id.get(uid))
            if living_count > 0:
                out.append({
                    "id": fid, "name": f["name"], "tag": f["tag"],
                    "member_count": living_count, "treasury": f.get("treasury", 0),
                    "at_war": False,
                    "join_mode": f.get("join_mode") or "open",
                })
    # Tag families that are currently in an active war
    active_wars = await db.family_wars.find(
        {"status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0, "family_a_id": 1, "family_b_id": 1},
    ).to_list(50)
    at_war_fids = set()
    for w in active_wars:
        at_war_fids.add(w["family_a_id"])
        at_war_fids.add(w["family_b_id"])
    for f in out:
        if f["id"] in at_war_fids:
            f["at_war"] = True
    return out


async def families_config(current_user: dict = Depends(get_current_user)):
    global _config_cache
    if _config_cache is None:
        _config_cache = {
            "family_create_cost": FAMILY_CREATE_COST,
            "roles": FAMILY_ROLES,
            "ranks": RANKS,
            "racket_max_level": RACKET_MAX_LEVEL,
            "rackets": FAMILY_RACKETS,
            "racket_upgrade_cost": RACKET_UPGRADE_COST,
            "racket_unlock_cost": RACKET_UNLOCK_COST,
            "family_melt_treasury_pct_max": FAMILY_MELT_TREASURY_PCT_MAX,
            "family_melt_reward_threshold_step": FAMILY_MELT_REWARD_THRESHOLD_STEP,
        }
    toward_cap = await count_families_toward_player_cap()
    return {
        **_config_cache,
        "max_families": MAX_FAMILIES,
        "player_cap_families_count": toward_cap,
    }


async def families_my(current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    now_ts = time.monotonic()
    entry = _my_cache.get(uid)
    if entry is not None and entry[1] > now_ts:
        return entry[0]
    family_id = current_user.get("family_id")
    if not family_id:
        return {"family": None, "members": [], "rackets": [], "my_role": None}
    fam = await db.families.find_one({"id": family_id}, {"_id": 0})
    if not fam:
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_id": None, "family_role": None}})
        return {"family": None, "members": [], "rackets": [], "my_role": None}
    members_docs = await db.family_members.find({"family_id": family_id}, {"_id": 0}).to_list(100)
    my_role = current_user.get("family_role")
    my_member = next((m for m in members_docs if m["user_id"] == current_user["id"]), None)
    if my_member and my_member.get("role"):
        my_role = str(my_member["role"]).strip().lower() or my_role
        if my_role and current_user.get("family_role") != my_role:
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_role": my_role}})
    if my_role:
        my_role = str(my_role).strip().lower()
    ev = await get_effective_event()
    member_uids = [m["user_id"] for m in members_docs if m.get("user_id")]
    users_by_id = await _users_map_by_ids(member_uids)
    members = []
    fallen = []
    for m in members_docs:
        u = users_by_id.get(_uid_str(m["user_id"]))
        rank_name = "—"
        if u:
            rid = u.get("rank", 1)
            rn = next((x["name"] for x in RANKS if x.get("id") == rid), str(rid))
            rank_name = rn
        entry = {
            "user_id": m["user_id"],
            "username": (u or {}).get("username", "?"),
            "role": str(m.get("role", "")).strip().lower() or "associate",
            "rank_name": rank_name,
            "bullets_melted": int((u or {}).get("bullets_melted") or 0),
            "family_bullets_melted": int((u or {}).get("family_bullets_melted") or 0),
            "family_melt_reward_money_earned": int((u or {}).get("family_melt_reward_money_earned") or 0),
            "family_melt_reward_hits": int((u or {}).get("family_melt_reward_hits") or 0),
        }
        if (u or {}).get("is_dead"):
            entry["dead_at"] = (u or {}).get("dead_at")
            fallen.append(entry)
        else:
            members.append(entry)
    rackets_raw = fam.get("rackets") or {}
    staff_debug = _is_admin(current_user)
    racket_bonus_pct = float((fam.get("racket_income_bonus_percent") or 0) or 0)
    rackets = []
    now = datetime.now(timezone.utc)
    racket_ids_ordered = [x["id"] for x in FAMILY_RACKETS]
    for idx, r in enumerate(FAMILY_RACKETS):
        try:
            rid = r["id"]
            state = rackets_raw.get(rid) or {}
            level = int(state.get("level", 0) or 0)
            locked = level <= 0
            prev_id = racket_ids_ordered[idx - 1] if idx > 0 else None
            required_racket_name = None
            can_unlock = False
            if locked and prev_id:
                required_racket_name = next((x["name"] for x in FAMILY_RACKETS if x["id"] == prev_id), prev_id)
                prev_level = int((rackets_raw.get(prev_id) or {}).get("level", 0) or 0)
                can_unlock = prev_level >= RACKET_MAX_LEVEL
            elif locked and idx == 0:
                can_unlock = True
            last_at = state.get("last_collected_at")
            income_per, cooldown_h = _racket_income_and_cooldown(rid, level, ev)
            effective_income = int(income_per * (1 + racket_bonus_pct / 100.0))
            next_collect_at = None
            if last_at and level > 0 and cooldown_h > 0:
                try:
                    last_dt = datetime.fromisoformat(str(last_at).replace("Z", "+00:00"))
                    war_sec = await _family_war_duration_seconds(family_id, last_dt, now)
                    next_dt = last_dt + timedelta(hours=cooldown_h) + timedelta(seconds=war_sec)
                    next_collect_at = next_dt.isoformat() if next_dt > now else None
                except Exception:
                    next_collect_at = None
            if next_collect_at is None and level > 0:
                next_collect_at = now.isoformat()
            rackets.append({
                "id": rid, "name": r["name"], "description": r.get("description", ""),
                "level": level, "locked": locked, "required_racket_name": required_racket_name, "can_unlock": can_unlock,
                "unlock_cost": RACKET_UNLOCK_COST if locked else None,
                "cooldown_hours": r["cooldown_hours"], "effective_cooldown_hours": cooldown_h,
                "income_per_collect": income_per, "effective_income_per_collect": effective_income,
                "next_collect_at": next_collect_at,
                "debug_last_collected_at": last_at if staff_debug else None,
                "debug_next_collect_at": next_collect_at if staff_debug else None,
            })
        except Exception:
            continue
    crew_oc_applications = []
    if family_id:
        app_cursor = db.family_crew_oc_applications.find({"family_id": family_id}, {"_id": 0}).sort("created_at", -1)
        crew_oc_applications = await app_cursor.to_list(50)
    qualifies_for_state_head = await family_qualifies_for_state_head(family_id)
    vault_and_rackets_locked = await _family_in_active_war(family_id)
    compound_cash = int((fam.get("compound_cash") or 0) or 0)
    compound_points = int((fam.get("compound_points") or 0) or 0)
    compound_loot_pieces = int((fam.get("compound_loot_pieces") or 0) or 0)
    compound_deposits_by_user = fam.get("compound_deposits_by_user") or {}
    my_compound = compound_deposits_by_user.get(current_user["id"]) or {}
    my_compound_cash = int((my_compound.get("cash") or 0) or 0)
    my_compound_points = int((my_compound.get("points") or 0) or 0)
    my_compound_loot_pieces = int((my_compound.get("loot_pieces") or 0) or 0)
    my_compound_cars = 0
    compound_cars = fam.get("compound_cars") or []
    for car in compound_cars:
        if car.get("deposited_by_user_id") == current_user["id"]:
            my_compound_cars += 1
    returning_raw = []
    if my_role and my_role in ("boss", "underboss", "consigliere"):
        member_ids = {m["user_id"] for m in members_docs}
        for uid, attrib in compound_deposits_by_user.items():
            if uid in member_ids:
                ac = int((attrib.get("cash") or 0) or 0)
                ap = int((attrib.get("points") or 0) or 0)
                al = int((attrib.get("loot_pieces") or 0) or 0)
                cars_count = sum(1 for c in compound_cars if c.get("deposited_by_user_id") == uid)
                if ac > 0 or ap > 0 or al > 0 or cars_count > 0:
                    returning_raw.append({
                        "user_id": uid,
                        "compound_cash": ac, "compound_points": ap, "compound_loot_pieces": al,
                        "compound_cars": cars_count,
                    })
    returning_members_with_balance = []
    if returning_raw:
        rb_map = await _users_map_by_ids([r["user_id"] for r in returning_raw], {"_id": 0, "id": 1, "username": 1})
        for r in returning_raw:
            u = rb_map.get(_uid_str(r["user_id"]))
            returning_members_with_balance.append({
                **r,
                "username": (u or {}).get("username", "?"),
            })
    join_applications = []
    if my_role and my_role in ("boss", "underboss"):
        join_apps = await db.family_join_applications.find(
            {"family_id": family_id, "status": "pending"},
            {"_id": 0, "id": 1, "user_id": 1, "username": 1, "rank": 1, "applied_at": 1},
        ).sort("applied_at", 1).to_list(100)
        ja_uids = [a["user_id"] for a in join_apps if a.get("user_id")]
        ja_users = await _users_map_by_ids(ja_uids, {"_id": 0, "id": 1, "username": 1, "rank": 1})
        for a in join_apps:
            u = ja_users.get(_uid_str(a["user_id"]))
            if u:
                a["username"] = u.get("username") or a.get("username") or "?"
                a["rank"] = u.get("rank", 1)
            a["rank_name"] = next((x["name"] for x in RANKS if x.get("id") == a.get("rank", 1)), str(a.get("rank", 1)))
            join_applications.append(a)
    state_head_casino_week_stats = {}
    head_of_state = fam.get("head_of_state")
    if head_of_state:
        state_head_casino_week_stats = await _state_head_casino_week_stats(head_of_state)

    payload = {
        "family": {
            "id": fam["id"], "name": fam["name"], "tag": fam["tag"],
            "treasury": fam.get("treasury", 0),
            "treasury_bullets": int(fam.get("treasury_bullets") or 0),
            "treasury_points": int(fam.get("treasury_points") or 0),
            "treasury_loot_pieces": int(fam.get("treasury_loot_pieces") or 0),
            "melt_treasury_pct": int(fam.get("melt_treasury_pct") or 0),
            "melt_reward_tiers": fam.get("melt_reward_tiers") or [],
            "crew_oc_cooldown_until": fam.get("crew_oc_cooldown_until"),
            "crew_oc_join_fee": int(fam.get("crew_oc_join_fee") or 0),
            "crew_oc_auto_accept": bool(fam.get("crew_oc_auto_accept")),
            "crew_oc_forum_topic_id": fam.get("crew_oc_forum_topic_id") if fam.get("crew_oc_forum_topic_id") and await db.forum_topics.find_one({"id": fam["crew_oc_forum_topic_id"]}, {"_id": 1}) else None,
            "profile_text": (fam.get("profile_text") or "").strip() or None,
            "profile_notepad_color": notepad_color_for_api_response(fam.get("profile_notepad_color")),
            "racket_income_bonus_percent": float((fam.get("racket_income_bonus_percent") or 0) or 0),
            "head_of_state": head_of_state,
            "state_head_income": fam.get("state_head_income") or {},
            "pending_state_takeover": fam.get("pending_state_takeover"),
            "pending_state_takeover_at": fam.get("pending_state_takeover_at"),
            "compound_cash": compound_cash, "compound_points": compound_points, "compound_loot_pieces": compound_loot_pieces,
            "join_mode": fam.get("join_mode") or "open",
            "join_auto_accept": fam.get("join_auto_accept") or "none",
            "join_auto_accept_rank_min": fam.get("join_auto_accept_rank_min"),
        },
        "members": members, "fallen": fallen, "rackets": rackets, "my_role": my_role,
        "vault_and_rackets_locked": vault_and_rackets_locked,
        "qualifies_for_state_head": qualifies_for_state_head,
        "crew_oc_committer_has_timer": bool(current_user.get("crew_oc_timer_reduced", False)),
        "crew_oc_applications": crew_oc_applications,
        "join_applications": join_applications,
        "compound_cars": compound_cars,
        "my_compound_cash": my_compound_cash, "my_compound_points": my_compound_points,
        "my_compound_loot_pieces": my_compound_loot_pieces, "my_compound_cars": my_compound_cars,
        "returning_members_with_balance": returning_members_with_balance,
        "state_head_casino_week_stats": state_head_casino_week_stats,
    }
    if len(_my_cache) >= _my_cache_max_entries:
        _my_cache.clear()
    _my_cache[uid] = (payload, now_ts + _my_cache_ttl_sec)
    return payload


async def families_lookup(tag: Optional[str] = None, id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    lookup_id = (id and str(id).strip()) or None
    tag_clean = (tag and str(tag).strip()) or None
    if not lookup_id and not tag_clean:
        raise HTTPException(status_code=400, detail="tag or id required")
    if lookup_id:
        fam = await db.families.find_one({"id": lookup_id}, {"_id": 0})
    else:
        fam = await db.families.find_one({"$or": [{"tag": tag_clean.upper()}, {"id": tag_clean}]}, {"_id": 0})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    members_docs = await db.family_members.find({"family_id": fam["id"]}, {"_id": 0}).to_list(100)
    lookup_uids = [m["user_id"] for m in members_docs if m.get("user_id")]
    bid = _uid_str(fam.get("boss_id"))
    if bid and all(_uid_str(x) != bid for x in lookup_uids):
        lookup_uids.append(bid)
    users_by_id = await _users_map_by_ids(lookup_uids)
    members = []
    fallen = []
    bid_norm = _uid_str(fam.get("boss_id"))
    for m in members_docs:
        uid_s = _uid_str(m["user_id"])
        u = users_by_id.get(uid_s) if uid_s else None
        role_norm = str(m.get("role", "")).strip().lower() or "associate"
        if role_norm == "don":
            role_norm = "boss"
        # Boss row must show the real Don: prefer families.boss_id if member row is stale or lookup missed
        if role_norm == "boss" and bid_norm and (not u or uid_s != bid_norm):
            u = users_by_id.get(bid_norm) or u
        rank_name = "—"
        if u and RANKS:
            rank_name = next((x["name"] for x in RANKS if x.get("id") == u.get("rank", 1)), str(u.get("rank", 1)))
        uname = ((u.get("username") if u else None) or "").strip() or "?"
        # Last resort: direct DB load for Don if map still missed (corrupt member user_id, etc.)
        if uname == "?" and role_norm == "boss" and bid_norm:
            or_c = [{"id": bid_norm}]
            if bid_norm.isdigit():
                try:
                    or_c.append({"id": int(bid_norm)})
                except ValueError:
                    pass
            bu = await db.users.find_one(
                {"$or": or_c},
                {"_id": 0, "username": 1, "rank": 1, "is_dead": 1, "dead_at": 1},
            )
            if bu:
                u = bu
                if RANKS:
                    rank_name = next((x["name"] for x in RANKS if x.get("id") == u.get("rank", 1)), str(u.get("rank", 1)))
                uname = ((u.get("username") if u else None) or "").strip() or "?"
        entry = {
            "user_id": m["user_id"],
            "username": uname,
            "role": role_norm,
            "rank_name": rank_name,
            "bullets_melted": int((u or {}).get("bullets_melted") or 0),
            "family_bullets_melted": int((u or {}).get("family_bullets_melted") or 0),
            "family_melt_reward_money_earned": int((u or {}).get("family_melt_reward_money_earned") or 0),
            "family_melt_reward_hits": int((u or {}).get("family_melt_reward_hits") or 0),
        }
        if (u or {}).get("is_dead"):
            entry["dead_at"] = (u or {}).get("dead_at")
            fallen.append(entry)
        else:
            members.append(entry)
    rackets_raw = fam.get("rackets") or {}
    rackets = []
    for r in FAMILY_RACKETS:
        state = rackets_raw.get(r["id"]) or {}
        level = state.get("level", 0)
        if level > 0:
            rackets.append({"id": r["id"], "name": r["name"], "level": level})
    my_role = None
    if current_user.get("family_id") == fam["id"]:
        my_role = current_user.get("family_role")
    crew_oc_join_fee = int(fam.get("crew_oc_join_fee") or 0)
    crew_oc_cooldown_until = fam.get("crew_oc_cooldown_until")
    crew_oc_forum_topic_id = fam.get("crew_oc_forum_topic_id")
    if crew_oc_forum_topic_id:
        topic_exists = await db.forum_topics.find_one({"id": crew_oc_forum_topic_id}, {"_id": 1})
        if not topic_exists:
            crew_oc_forum_topic_id = None
            await db.families.update_one({"id": fam["id"]}, {"$unset": {"crew_oc_forum_topic_id": ""}})
    crew_oc_application = None
    app = await db.family_crew_oc_applications.find_one(
        {"family_id": fam["id"], "user_id": current_user["id"]},
        {"_id": 0, "status": 1, "amount_paid": 1},
    )
    if app:
        crew_oc_application = {"status": app.get("status"), "amount_paid": int(app.get("amount_paid") or 0)}
    accepted_apps = await db.family_crew_oc_applications.find(
        {"family_id": fam["id"], "status": "accepted"},
        {"_id": 0, "username": 1},
    ).to_list(50)
    crew_oc_crew = [{"username": m["username"], "is_family_member": True} for m in members]
    crew_oc_crew += [{"username": a.get("username") or "?", "is_family_member": False} for a in accepted_apps]
    out = {
        "id": fam["id"], "name": fam["name"], "tag": fam["tag"], "treasury": fam.get("treasury", 0),
        "treasury_bullets": int(fam.get("treasury_bullets") or 0),
        "head_of_state": fam.get("head_of_state"),
        "profile_text": (fam.get("profile_text") or "").strip() or None,
        "profile_notepad_color": notepad_color_for_api_response(fam.get("profile_notepad_color")),
        "avatar_url": fam.get("avatar_url"),
        "member_count": len(members), "members": members, "fallen": fallen, "rackets": rackets, "my_role": my_role,
        "crew_oc_join_fee": crew_oc_join_fee, "crew_oc_cooldown_until": crew_oc_cooldown_until,
        "crew_oc_forum_topic_id": crew_oc_forum_topic_id,
        "crew_oc_application": crew_oc_application, "crew_oc_crew": crew_oc_crew,
        "join_mode": fam.get("join_mode") or "open",
        "melt_treasury_pct": int(fam.get("melt_treasury_pct") or 0),
        "melt_reward_tiers": fam.get("melt_reward_tiers") or [],
    }
    if fam.get("wiped"):
        out["wiped"] = True
        out["wiped_at"] = fam.get("wiped_at")
        out["wiped_by_family_id"] = fam.get("wiped_by_family_id")
        out["wiped_by_family_name"] = (fam.get("wiped_by_family_name") or "").strip() or None
        out["wiped_by_killer_id"] = fam.get("wiped_by_killer_id")
        out["wiped_by_killer_username"] = (fam.get("wiped_by_killer_username") or "").strip() or None
    return out


async def families_create(request: FamilyCreateRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_id"):
        raise HTTPException(status_code=400, detail="Already in a family")
    is_admin = _is_admin(current_user)
    name = (request.name or "").strip()[:30]
    tag = (request.tag or "").strip().upper().replace(" ", "")[:4]
    if len(name) < 2 or len(tag) < 2:
        raise HTTPException(status_code=400, detail="Name and tag must be at least 2 characters")
    await cleanup_dead_families()
    if not is_admin and await count_families_toward_player_cap() >= MAX_FAMILIES:
        raise HTTPException(status_code=400, detail="Maximum number of families reached")
    if await db.families.find_one({"wiped": {"$ne": True}, "$or": [{"name": name}, {"tag": tag}]}):
        raise HTTPException(status_code=400, detail="Name or tag already taken")
    family_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    first_racket_id = FAMILY_RACKETS[0]["id"]
    fam_doc = {
        "id": family_id, "name": name, "tag": tag, "boss_id": current_user["id"],
        "treasury": 0, "treasury_bullets": 0, "treasury_points": 0, "treasury_loot_pieces": 0, "created_at": now,
        "rackets": {first_racket_id: {"level": 1, "last_collected_at": None}},
        "compound_cash": 0, "compound_points": 0, "compound_loot_pieces": 0,
        "compound_deposits_by_user": {},
        "join_mode": "open",
        "join_auto_accept": "none",
        "join_auto_accept_rank_min": None,
        "melt_treasury_pct": 0,
        "melt_reward_tiers": [],
    }
    if is_admin:
        fam_doc["player_cap_exempt"] = True
    await db.families.insert_one(fam_doc)
    await db.family_members.insert_one({
        "id": str(uuid.uuid4()), "family_id": family_id, "user_id": current_user["id"],
        "role": "boss", "joined_at": now,
    })
    if is_admin:
        result = await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"family_id": family_id, "family_role": "boss"}},
        )
    else:
        result = await db.users.update_one(
            {"id": current_user["id"], "money": {"$gte": FAMILY_CREATE_COST}},
            {"$set": {"family_id": family_id, "family_role": "boss"}, "$inc": {"money": -FAMILY_CREATE_COST}},
        )
    if result.modified_count == 0:
        await db.families.delete_one({"id": family_id})
        await db.family_members.delete_one({"family_id": family_id, "user_id": current_user["id"]})
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not assign family to your account."
                if is_admin
                else f"You need ${FAMILY_CREATE_COST:,} to create a family."
            ),
        )
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    return {"message": "Family created", "family_id": family_id}


async def _add_member_to_family(family_id: str, user_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    await db.family_members.insert_one({
        "id": str(uuid.uuid4()), "family_id": family_id, "user_id": user_id,
        "role": "associate", "joined_at": now,
    })
    await db.users.update_one({"id": user_id}, {"$set": {"family_id": family_id, "family_role": "associate"}})


async def _resolve_family_id(identifier: str):
    """Resolve family by id or by tag. Returns (fam_doc, family_id) or (None, None)."""
    if not identifier or not str(identifier).strip():
        return None, None
    ident = str(identifier).strip()
    fam = await db.families.find_one({"id": ident}, {"_id": 0, "id": 1, "join_mode": 1, "join_auto_accept": 1, "join_auto_accept_rank_min": 1})
    if fam:
        return fam, fam["id"]
    tag_clean = ident.upper().replace(" ", "")[:4]
    if tag_clean:
        fam = await db.families.find_one({"tag": tag_clean, "wiped": {"$ne": True}}, {"_id": 0, "id": 1, "join_mode": 1, "join_auto_accept": 1, "join_auto_accept_rank_min": 1})
        if fam:
            return fam, fam["id"]
    return None, None


async def families_join(request: FamilyJoinRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_id"):
        raise HTTPException(status_code=400, detail="Already in a family")
    fam, family_id = await _resolve_family_id(request.family_id)
    if not fam or not family_id:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.get("join_mode") == "approval":
        raise HTTPException(status_code=400, detail="This family requires approval. Apply to join instead.")
    count = await db.family_members.count_documents({"family_id": family_id})
    if count >= sum(FAMILY_ROLE_LIMITS.values()):
        raise HTTPException(status_code=400, detail="Family is full")
    now = datetime.now(timezone.utc).isoformat()
    await db.family_members.insert_one({
        "id": str(uuid.uuid4()), "family_id": family_id, "user_id": current_user["id"],
        "role": "associate", "joined_at": now,
    })
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_id": family_id, "family_role": "associate"}})
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    return {"message": "Joined family"}


async def families_apply(request: FamilyApplyRequest, current_user: dict = Depends(get_current_user)):
    """Apply to join a family when join_mode is approval. May auto-accept if family settings allow."""
    if current_user.get("family_id"):
        raise HTTPException(status_code=400, detail="Already in a family")
    fam, family_id = await _resolve_family_id(request.family_id)
    if not fam or not family_id:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.get("join_mode") != "approval":
        raise HTTPException(status_code=400, detail="This family accepts direct join. Use Join instead.")
    count = await db.family_members.count_documents({"family_id": family_id})
    if count >= sum(FAMILY_ROLE_LIMITS.values()):
        raise HTTPException(status_code=400, detail="Family is full")
    existing = await db.family_join_applications.find_one(
        {"family_id": family_id, "user_id": current_user["id"], "status": "pending"},
        {"_id": 0, "id": 1},
    )
    if existing:
        raise HTTPException(status_code=400, detail="You already have a pending application")
    auto = (fam.get("join_auto_accept") or "none").strip().lower()
    rank_min = fam.get("join_auto_accept_rank_min")
    applicant_rank = int(current_user.get("rank") or 1)
    auto_accept = False
    if auto == "all":
        auto_accept = True
    elif auto == "rank_min" and rank_min is not None and applicant_rank >= int(rank_min):
        auto_accept = True
    if auto_accept:
        await _add_member_to_family(family_id, current_user["id"])
        _invalidate_list_cache()
        _invalidate_my_cache(current_user["id"])
        return {"message": "Joined family", "auto_accepted": True}
    now = datetime.now(timezone.utc).isoformat()
    app_id = str(uuid.uuid4())
    await db.family_join_applications.insert_one({
        "id": app_id, "family_id": family_id, "user_id": current_user["id"],
        "username": current_user.get("username") or "?",
        "rank": applicant_rank,
        "applied_at": now, "status": "pending",
    })
    return {"message": "Application submitted", "application_id": app_id}


async def families_join_applications_list(current_user: dict = Depends(get_current_user)):
    """List pending join applications for the current user's family. Boss/Underboss only."""
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Don or Underboss can view applications")
    cursor = db.family_join_applications.find(
        {"family_id": family_id, "status": "pending"},
        {"_id": 0, "id": 1, "user_id": 1, "username": 1, "rank": 1, "applied_at": 1},
    ).sort("applied_at", 1)
    apps = await cursor.to_list(100)
    app_uids = [a["user_id"] for a in apps if a.get("user_id")]
    app_users = await _users_map_by_ids(app_uids, {"_id": 0, "id": 1, "username": 1, "rank": 1})
    for a in apps:
        u = app_users.get(_uid_str(a["user_id"]))
        if u:
            a["username"] = u.get("username") or a.get("username") or "?"
            a["rank"] = u.get("rank", 1)
        a["rank_name"] = next((x["name"] for x in RANKS if x.get("id") == a.get("rank", 1)), str(a.get("rank", 1)))
    return {"applications": apps}


async def families_join_application_accept(application_id: str, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Don or Underboss can accept applications")
    app = await db.family_join_applications.find_one({"id": application_id, "family_id": family_id, "status": "pending"}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found or already processed")
    count = await db.family_members.count_documents({"family_id": family_id})
    if count >= sum(FAMILY_ROLE_LIMITS.values()):
        await db.family_join_applications.update_one({"id": application_id}, {"$set": {"status": "denied"}})
        raise HTTPException(status_code=400, detail="Family is full")
    user_id = app["user_id"]
    if await db.family_members.find_one({"family_id": family_id, "user_id": user_id}):
        await db.family_join_applications.update_one({"id": application_id}, {"$set": {"status": "denied"}})
        raise HTTPException(status_code=400, detail="User is already a member")
    await _add_member_to_family(family_id, user_id)
    await db.family_join_applications.update_one({"id": application_id}, {"$set": {"status": "accepted"}})
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(user_id)
    return {"message": "Application accepted"}


async def families_join_application_deny(application_id: str, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Don or Underboss can deny applications")
    res = await db.family_join_applications.update_one(
        {"id": application_id, "family_id": family_id, "status": "pending"},
        {"$set": {"status": "denied"}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=404, detail="Application not found or already processed")
    return {"message": "Application denied"}


async def families_join_settings(request: FamilyJoinSettingsRequest, current_user: dict = Depends(get_current_user)):
    """Update family join mode and auto-accept settings. Boss only."""
    if current_user.get("family_role") != "boss":
        raise HTTPException(status_code=403, detail="Only Don can change join settings")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    updates = {}
    if request.join_mode is not None:
        if request.join_mode not in ("open", "approval"):
            raise HTTPException(status_code=400, detail="join_mode must be 'open' or 'approval'")
        updates["join_mode"] = request.join_mode
    if request.join_auto_accept is not None:
        if request.join_auto_accept not in ("none", "all", "rank_min"):
            raise HTTPException(status_code=400, detail="join_auto_accept must be 'none', 'all', or 'rank_min'")
        updates["join_auto_accept"] = request.join_auto_accept
    if request.join_auto_accept_rank_min is not None:
        updates["join_auto_accept_rank_min"] = request.join_auto_accept_rank_min
    if not updates:
        return {"message": "No changes"}
    await db.families.update_one({"id": family_id}, {"$set": updates})
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    return {"message": "Join settings updated"}


def _normalize_melt_reward_tiers(tiers_raw: list) -> list:
    normalized = []
    for t in tiers_raw or []:
        threshold = int((t or {}).get("threshold_bullets") or 0)
        reward = int((t or {}).get("reward_money") or 0)
        if threshold < FAMILY_MELT_REWARD_THRESHOLD_STEP or threshold > FAMILY_MELT_REWARD_THRESHOLD_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"Tier threshold must be between {FAMILY_MELT_REWARD_THRESHOLD_STEP:,} and {FAMILY_MELT_REWARD_THRESHOLD_MAX:,}",
            )
        if threshold % FAMILY_MELT_REWARD_THRESHOLD_STEP != 0:
            raise HTTPException(
                status_code=400,
                detail=f"Tier threshold must be in {FAMILY_MELT_REWARD_THRESHOLD_STEP:,} bullet steps",
            )
        if reward <= 0 or reward > FAMILY_MELT_REWARD_MONEY_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"Tier reward must be between $1 and ${FAMILY_MELT_REWARD_MONEY_MAX:,}",
            )
        normalized.append({"threshold_bullets": threshold, "reward_money": reward})
    deduped = {}
    for t in normalized:
        deduped[t["threshold_bullets"]] = t["reward_money"]
    return [
        {"threshold_bullets": thr, "reward_money": deduped[thr]}
        for thr in sorted(deduped.keys())
    ]


async def families_melt_settings(request: FamilyMeltSettingsRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    role = (current_user.get("family_role") or "").lower()
    if role not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Only Don, Underboss, or Consigliere can change melt settings")
    updates = {}
    if request.melt_treasury_pct is not None:
        pct = int(request.melt_treasury_pct)
        if pct < 0 or pct > FAMILY_MELT_TREASURY_PCT_MAX:
            raise HTTPException(status_code=400, detail=f"melt_treasury_pct must be between 0 and {FAMILY_MELT_TREASURY_PCT_MAX}")
        updates["melt_treasury_pct"] = pct
    if request.melt_reward_tiers is not None:
        updates["melt_reward_tiers"] = _normalize_melt_reward_tiers([t.model_dump() for t in request.melt_reward_tiers])
    if not updates:
        return {"message": "No changes"}
    await db.families.update_one({"id": family_id}, {"$set": updates})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Melt settings updated", **updates}


RETRIBUTION_CHANCE = 0.5  # 50% chance family sends a hitman when you leave
RETRIBUTION_MAX_HEALTH_LOSS_PCT = 0.5  # Lose up to 50% of current health (you don't die)
MIN_HEALTH_PCT = 1  # Health can never drop below 1% (e.g. if user leaves multiple families in a row)


async def families_leave(current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    if fam and fam.get("boss_id") == current_user["id"]:
        raise HTTPException(status_code=400, detail="Boss must transfer leadership or dissolve family first")
    await db.family_members.delete_one({"family_id": family_id, "user_id": current_user["id"]})
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_id": None, "family_role": None}})
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])

    # 50% chance of retribution: family sends a hitman; you get shot and lose up to 50% health (you don't die)
    if _rng.random() < RETRIBUTION_CHANCE:
        user_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "health": 1})
        health = max(0, min(100, float(user_doc.get("health") or 100)))
        loss_pct = _rng.uniform(0, RETRIBUTION_MAX_HEALTH_LOSS_PCT)
        damage = health * loss_pct
        new_health = max(MIN_HEALTH_PCT, health - damage)
        retrib_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"health": new_health, "health_regen_last_at": retrib_iso}},
        )
        _invalidate_my_cache(current_user["id"])
        return {
            "message": "Left family. The family sent a hitman—you were shot and lost health. You survived.",
            "retribution": True,
            "health_lost_pct": round(loss_pct * 100, 1),
            "health_now": round(new_health, 1),
        }
    return {"message": "Left family"}


async def families_kick(request: FamilyKickRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can kick")
    if request.user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot kick yourself")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": request.user_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.get("role") == "boss":
        raise HTTPException(status_code=400, detail="Cannot kick the Boss")
    await db.family_members.delete_one({"family_id": family_id, "user_id": request.user_id})
    await db.users.update_one({"id": request.user_id}, {"$set": {"family_id": None, "family_role": None}})
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(request.user_id)
    return {"message": "Member kicked"}


async def families_assign_role(request: FamilyRoleRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") != "boss":
        raise HTTPException(status_code=403, detail="Only Boss can assign roles")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if request.role not in FAMILY_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    # Only the current boss can assign the boss role (transfer leadership)
    if request.role == "boss" and current_user.get("family_role") != "boss":
        raise HTTPException(status_code=400, detail="Only the Don can transfer leadership")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": request.user_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    counts = await db.family_members.aggregate([
        {"$match": {"family_id": family_id}},
        {"$group": {"_id": "$role", "c": {"$sum": 1}}},
    ]).to_list(20)
    by_role = {x["_id"]: x["c"] for x in counts}
    limit = FAMILY_ROLE_LIMITS.get(request.role, 0)
    # Allow leadership transfer even though boss limit is 1 (the boss role is moved, not added).
    if request.role != "boss" and limit and (by_role.get(request.role) or 0) >= limit and member.get("role") != request.role:
        raise HTTPException(status_code=400, detail=f"Role {request.role} limit reached")
    await db.family_members.update_one({"family_id": family_id, "user_id": request.user_id}, {"$set": {"role": request.role}})
    await db.users.update_one({"id": request.user_id}, {"$set": {"family_role": request.role}})
    if request.role == "boss":
        await db.families.update_one({"id": family_id}, {"$set": {"boss_id": request.user_id}})
        await db.family_members.update_one({"family_id": family_id, "user_id": current_user["id"]}, {"$set": {"role": "underboss"}})
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_role": "underboss"}})
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(request.user_id)
    return {"message": "Role updated"}


async def families_deposit(request: FamilyDepositRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    amount = int(request.amount or 0)
    bullets = int(request.bullets or 0)
    if amount < 0 or bullets < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if amount == 0 and bullets == 0:
        raise HTTPException(status_code=400, detail="Specify cash and/or bullets")
    user_filter = {"id": current_user["id"]}
    if amount > 0:
        user_filter["money"] = {"$gte": amount}
    if bullets > 0:
        user_filter["bullets"] = {"$gte": bullets}
    result = await db.users.find_one_and_update(
        user_filter,
        {"$inc": {"money": -amount, "bullets": -bullets}},
        return_document=False,
    )
    if not result:
        raise HTTPException(status_code=400, detail="Not enough cash or bullets")
    await db.families.update_one({"id": family_id}, {"$inc": {"treasury": amount, "treasury_bullets": bullets}})
    _invalidate_my_cache(current_user["id"])
    await log_activity(current_user["id"], current_user.get("username", "?"), "family_deposit", {"cash": amount, "bullets": bullets})
    return {"message": "Deposited to treasury"}


async def families_withdraw(request: FamilyWithdrawRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    amount = int(request.amount or 0)
    bullets = int(request.bullets or 0)
    if amount < 0 or bullets < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if amount == 0 and bullets == 0:
        raise HTTPException(status_code=400, detail="Specify cash and/or bullets")
    family_filter = {"id": family_id}
    if amount > 0:
        family_filter["treasury"] = {"$gte": amount}
    if bullets > 0:
        family_filter["treasury_bullets"] = {"$gte": bullets}
    result = await db.families.find_one_and_update(
        family_filter,
        {"$inc": {"treasury": -amount, "treasury_bullets": -bullets}},
        return_document=False,
    )
    if not result:
        raise HTTPException(status_code=400, detail="Not enough treasury cash or bullets")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": amount, "bullets": bullets}})
    _invalidate_my_cache(current_user["id"])
    await log_activity(current_user["id"], current_user.get("username", "?"), "family_withdraw", {"cash": amount, "bullets": bullets})
    return {"message": "Withdrew from treasury"}


async def families_give_bullets(request: FamilyGiveBulletsRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    target_id = str(request.user_id or "").strip()
    bullets = int(request.bullets or 0)
    if not target_id:
        raise HTTPException(status_code=400, detail="Target member is required")
    if bullets <= 0:
        raise HTTPException(status_code=400, detail="Invalid bullet amount")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": target_id}, {"_id": 0, "user_id": 1})
    if not member:
        raise HTTPException(status_code=404, detail="Target is not in your family")
    target_user = await db.users.find_one({"id": target_id}, {"_id": 0, "is_dead": 1})
    if not target_user or target_user.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target member must be alive")
    debited = await db.families.update_one(
        {"id": family_id, "treasury_bullets": {"$gte": bullets}},
        {"$inc": {"treasury_bullets": -bullets}},
    )
    if debited.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough family bullets")
    await db.users.update_one({"id": target_id}, {"$inc": {"bullets": bullets}})
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(target_id)
    return {"message": f"Gave {bullets:,} bullets to family member"}


async def families_split_all_bullets(current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury_bullets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    total_bullets = int(fam.get("treasury_bullets") or 0)
    if total_bullets <= 0:
        raise HTTPException(status_code=400, detail="No bullets in family vault")
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(200)
    member_ids = [str(m.get("user_id") or "").strip() for m in members if (m.get("user_id") or "").strip()]
    if not member_ids:
        raise HTTPException(status_code=400, detail="No family members found")
    living = await db.users.find(
        {"id": {"$in": member_ids}, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(200)
    living_ids = sorted({str(u.get("id") or "").strip() for u in living if (u.get("id") or "").strip()})
    if not living_ids:
        raise HTTPException(status_code=400, detail="No living family members")
    each = total_bullets // len(living_ids)
    remainder = total_bullets % len(living_ids)
    if each <= 0 and remainder <= 0:
        raise HTTPException(status_code=400, detail="Not enough bullets to split")
    distribution = {}
    for idx, uid in enumerate(living_ids):
        give = each + (1 if idx < remainder else 0)
        if give > 0:
            distribution[uid] = give
    to_distribute = sum(distribution.values())
    debited = await db.families.update_one(
        {"id": family_id, "treasury_bullets": {"$gte": to_distribute}},
        {"$inc": {"treasury_bullets": -to_distribute}},
    )
    if debited.modified_count == 0:
        raise HTTPException(status_code=409, detail="Vault changed, please try again")
    for uid, amt in distribution.items():
        await db.users.update_one({"id": uid}, {"$inc": {"bullets": amt}})
        _invalidate_my_cache(uid)
    _invalidate_my_cache(current_user["id"])
    return {
        "message": f"Split {to_distribute:,} bullets across {len(distribution)} living members",
        "total_split": to_distribute,
        "member_count": len(distribution),
        "each_base": each,
        "remainder_distributed": remainder,
    }


async def families_compound_deposit(request: CompoundDepositRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Compound is locked until the family war is over")
    cash = int(request.cash or 0)
    points = int(request.points or 0)
    loot_pieces = int(request.loot_pieces or 0)
    if cash < 0 or points < 0 or loot_pieces < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if cash == 0 and points == 0 and loot_pieces == 0:
        raise HTTPException(status_code=400, detail="Specify at least one amount to deposit")
    uid = current_user["id"]
    user_filter = {"id": uid}
    if cash > 0:
        user_filter["money"] = {"$gte": cash}
    if points > 0:
        user_filter["points"] = {"$gte": points}
    if loot_pieces > 0:
        user_filter["loot_box_pieces"] = {"$gte": loot_pieces}
    result = await db.users.update_one(
        user_filter,
        {"$inc": {"money": -cash, "points": -points, "loot_box_pieces": -loot_pieces}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient resources for deposit")
    inc_fields = {"compound_cash": cash, "compound_points": points, "compound_loot_pieces": loot_pieces}
    if cash > 0:
        inc_fields[f"compound_deposits_by_user.{uid}.cash"] = cash
    if points > 0:
        inc_fields[f"compound_deposits_by_user.{uid}.points"] = points
    if loot_pieces > 0:
        inc_fields[f"compound_deposits_by_user.{uid}.loot_pieces"] = loot_pieces
    await db.families.update_one({"id": family_id}, {"$inc": inc_fields})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Deposited to compound"}


async def families_compound_withdraw(request: CompoundWithdrawRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Compound is locked until the family war is over")
    cash = int(request.cash or 0)
    points = int(request.points or 0)
    loot_pieces = int(request.loot_pieces or 0)
    if cash < 0 or points < 0 or loot_pieces < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if cash == 0 and points == 0 and loot_pieces == 0:
        raise HTTPException(status_code=400, detail="Specify at least one amount to withdraw")
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "compound_cash": 1, "compound_points": 1, "compound_loot_pieces": 1, "compound_deposits_by_user": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    total_cash = int((fam.get("compound_cash") or 0) or 0)
    total_points = int((fam.get("compound_points") or 0) or 0)
    total_loot = int((fam.get("compound_loot_pieces") or 0) or 0)
    if total_cash < cash or total_points < points or total_loot < loot_pieces:
        raise HTTPException(status_code=400, detail="Not enough in compound")
    uid = current_user["id"]
    by_user = fam.get("compound_deposits_by_user") or {}
    my_deposits = dict((by_user.get(uid) or {}))
    my_cash = int(my_deposits.get("cash") or 0)
    my_points = int(my_deposits.get("points") or 0)
    my_loot = int(my_deposits.get("loot_pieces") or 0)
    cash_take = min(cash, total_cash, my_cash)
    points_take = min(points, total_points, my_points)
    loot_take = min(loot_pieces, total_loot, my_loot)
    if cash_take == 0 and points_take == 0 and loot_take == 0:
        raise HTTPException(status_code=400, detail="Nothing to withdraw from your share")
    my_deposits["cash"] = my_cash - cash_take
    my_deposits["points"] = my_points - points_take
    my_deposits["loot_pieces"] = my_loot - loot_take
    updates = {
        "$inc": {"compound_cash": -cash_take, "compound_points": -points_take, "compound_loot_pieces": -loot_take},
        "$set": {f"compound_deposits_by_user.{uid}": my_deposits},
    }
    await db.families.update_one({"id": family_id}, updates)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": cash_take, "points": points_take, "loot_box_pieces": loot_take}},
    )
    _invalidate_my_cache(current_user["id"])
    return {"message": "Withdrew from compound"}


async def families_compound_return_to_member(request: CompoundReturnToMemberRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    target_id = (request.user_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="user_id required")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": target_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "compound_cash": 1, "compound_points": 1, "compound_loot_pieces": 1, "compound_deposits_by_user": 1, "compound_cars": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    by_user = fam.get("compound_deposits_by_user") or {}
    attrib = by_user.get(target_id) or {}
    ac = int((attrib.get("cash") or 0) or 0)
    ap = int((attrib.get("points") or 0) or 0)
    al = int((attrib.get("loot_pieces") or 0) or 0)
    if ac == 0 and ap == 0 and al == 0:
        raise HTTPException(status_code=400, detail="Member has no compound share to return")
    total_cash = int((fam.get("compound_cash") or 0) or 0)
    total_points = int((fam.get("compound_points") or 0) or 0)
    total_loot = int((fam.get("compound_loot_pieces") or 0) or 0)
    if ac > total_cash or ap > total_points or al > total_loot:
        raise HTTPException(status_code=400, detail="Compound totals inconsistent")
    updates = {
        "$inc": {"compound_cash": -ac, "compound_points": -ap, "compound_loot_pieces": -al},
        "$unset": {f"compound_deposits_by_user.{target_id}": ""},
    }
    await db.families.update_one({"id": family_id}, updates)
    await db.users.update_one(
        {"id": target_id},
        {"$inc": {"money": ac, "points": ap, "loot_box_pieces": al}},
    )
    fam_name = fam.get("name") or fam.get("tag") or "Your family"
    officer = current_user.get("username") or "An officer"
    parts = []
    if ac > 0:
        parts.append(f"${ac:,}")
    if ap > 0:
        parts.append(f"{ap:,} pts")
    if al > 0:
        parts.append(f"{al:,} loot pieces")
    summary = ", ".join(parts) if parts else "your share"
    await send_notification(
        target_id,
        "Family Compound – Share returned",
        f"Your compound share has been returned to you by {officer}: {summary}.",
        "reward",
    )
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(target_id)
    return {"message": "Returned compound share to member"}


async def families_compound_claim_for_family(request: CompoundClaimForFamilyRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    target_id = (request.user_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="user_id required")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": target_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "compound_cash": 1, "compound_points": 1, "compound_loot_pieces": 1, "compound_deposits_by_user": 1, "compound_cars": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    by_user = fam.get("compound_deposits_by_user") or {}
    attrib = by_user.get(target_id) or {}
    ac = int((attrib.get("cash") or 0) or 0)
    ap = int((attrib.get("points") or 0) or 0)
    al = int((attrib.get("loot_pieces") or 0) or 0)
    if ac == 0 and ap == 0 and al == 0:
        raise HTTPException(status_code=400, detail="Member has no compound share to claim")
    total_cash = int((fam.get("compound_cash") or 0) or 0)
    total_points = int((fam.get("compound_points") or 0) or 0)
    total_loot = int((fam.get("compound_loot_pieces") or 0) or 0)
    if ac > total_cash or ap > total_points or al > total_loot:
        raise HTTPException(status_code=400, detail="Compound totals inconsistent")
    updates = {
        "$inc": {
            "compound_cash": -ac,
            "compound_points": -ap,
            "compound_loot_pieces": -al,
            "treasury": ac,
            "treasury_points": ap,
            "treasury_loot_pieces": al,
        },
        "$unset": {f"compound_deposits_by_user.{target_id}": ""},
    }
    await db.families.update_one({"id": family_id}, updates)
    fam_name = fam.get("name") or fam.get("tag") or "The family"
    officer = current_user.get("username") or "An officer"
    parts = []
    if ac > 0:
        parts.append(f"${ac:,}")
    if ap > 0:
        parts.append(f"{ap:,} pts")
    if al > 0:
        parts.append(f"{al:,} loot pieces")
    summary = ", ".join(parts) if parts else "your share"
    await send_notification(
        target_id,
        "Family Compound – Share claimed for vault",
        f"Your compound share was claimed for the family vault by {officer}: {summary}. It is now in {fam_name}'s vault.",
        "system",
    )
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(target_id)
    return {"message": "Claimed compound share for the family"}


async def families_crew_oc_set_fee(request: FamilyCrewOCSetFeeRequest, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can set Crew OC fee")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fee = int(request.fee or 0)
    if fee < 0:
        raise HTTPException(status_code=400, detail="Fee cannot be negative")
    await db.families.update_one({"id": family_id}, {"$set": {"crew_oc_join_fee": fee}})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Crew OC join fee updated.", "fee": fee}


async def families_crew_oc_set_auto_accept(request: FamilyCrewOCSetAutoAcceptRequest, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can set Crew OC auto-accept")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    auto_accept = bool(request.auto_accept)
    await db.families.update_one({"id": family_id}, {"$set": {"crew_oc_auto_accept": auto_accept}})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Crew OC auto-accept updated.", "auto_accept": auto_accept}


FAMILY_PROFILE_TEXT_MAX_LENGTH = 10000


async def families_update_profile_text(request: FamilyProfileTextRequest, current_user: dict = Depends(get_current_user)):
    """Update your family's profile text and/or notepad background colour (hex). Only Boss, Underboss, or Capo."""
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can edit family profile")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    updates = {}
    if request.profile_text is not None:
        raw = (request.profile_text or "").strip() or None
        if raw is not None and len(raw) > FAMILY_PROFILE_TEXT_MAX_LENGTH:
            raise HTTPException(status_code=400, detail=f"Profile text cannot exceed {FAMILY_PROFILE_TEXT_MAX_LENGTH} characters")
        updates["profile_text"] = raw if raw else ""
    if request.notepad_color is not None:
        updates["profile_notepad_color"] = normalize_notepad_color_for_set(request.notepad_color)
    if not updates:
        doc = await db.families.find_one({"id": family_id}, {"_id": 0, "profile_text": 1, "profile_notepad_color": 1})
        return {
            "message": "No profile changes",
            "profile_text": (doc.get("profile_text") or "").strip() or None,
            "profile_notepad_color": notepad_color_for_api_response(doc.get("profile_notepad_color")),
        }
    await db.families.update_one({"id": family_id}, {"$set": updates})
    _invalidate_my_cache(current_user["id"])
    _invalidate_list_cache()
    doc = await db.families.find_one({"id": family_id}, {"_id": 0, "profile_text": 1, "profile_notepad_color": 1})
    return {
        "message": "Family profile updated.",
        "profile_text": (doc.get("profile_text") or "").strip() or None,
        "profile_notepad_color": notepad_color_for_api_response(doc.get("profile_notepad_color")),
    }


FAMILY_AVATAR_MAX_BYTES = 250_000  # same as user avatar
FAMILY_AVATAR_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _validate_family_avatar(data_url: str) -> tuple[bool, str]:
    """
    Validate family avatar data URL for security.
    Returns (is_valid, error_message).
    """
    import base64
    import re

    if not data_url:
        return False, "No data provided"

    if not data_url.startswith("data:image/"):
        return False, "Avatar must be an image data URL"

    # Parse: data:image/TYPE;base64,DATA
    match = re.match(r"^data:(image/[a-zA-Z0-9+-]+);base64,(.+)$", data_url)
    if not match:
        return False, "Invalid data URL format. Must be base64 encoded."

    mime_type = match.group(1).lower()
    base64_data = match.group(2)

    # Block SVG (can contain JavaScript/XSS)
    if "svg" in mime_type:
        return False, "SVG images are not allowed for security reasons"

    if mime_type not in FAMILY_AVATAR_ALLOWED_TYPES:
        return False, "Invalid image type. Allowed: JPEG, PNG, GIF, WEBP"

    # Validate base64 characters
    if not re.match(r"^[A-Za-z0-9+/=]+$", base64_data):
        return False, "Invalid base64 encoding"

    try:
        decoded = base64.b64decode(base64_data)
    except Exception:
        return False, "Failed to decode base64 data"

    # Verify magic bytes
    magic_bytes = {
        "image/jpeg": [b"\xff\xd8\xff"],
        "image/png": [b"\x89PNG\r\n\x1a\n"],
        "image/gif": [b"GIF87a", b"GIF89a"],
        "image/webp": [b"RIFF"],
    }

    valid_magic = False
    for magic in magic_bytes.get(mime_type, []):
        if decoded.startswith(magic):
            valid_magic = True
            break

    if not valid_magic:
        return False, "Image data does not match declared type"

    if mime_type == "image/webp" and b"WEBP" not in decoded[:12]:
        return False, "Invalid WEBP image data"

    return True, ""


async def families_update_avatar(request: FamilyAvatarRequest, current_user: dict = Depends(get_current_user)):
    """Update your family's profile picture (data URL). Only Boss, Underboss, or Capo. Pass null or empty to clear."""
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can set family picture")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")

    avatar = (request.avatar_data or "").strip() or None

    if avatar is not None:
        # Size check first
        if len(avatar) > FAMILY_AVATAR_MAX_BYTES:
            raise HTTPException(status_code=400, detail="Image too large. Use a smaller image (max ~180KB).")
        # Security validation
        is_valid, error_msg = _validate_family_avatar(avatar)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)

    update = {"$set": {"avatar_url": avatar}} if avatar else {"$unset": {"avatar_url": ""}}
    await db.families.update_one({"id": family_id}, update)
    _invalidate_my_cache(current_user.get("id") or "")
    _invalidate_list_cache()
    return {"message": "Family picture updated.", "avatar_url": avatar}


CREW_OC_TOPIC_WINDOW_MINUTES = 10  # Can create Crew OC topic only when OC is available or within this many mins before


async def families_crew_oc_advertise(current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can advertise Crew OC")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "name": 1, "tag": 1, "crew_oc_forum_topic_id": 1, "crew_oc_cooldown_until": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    existing_topic_id = (fam.get("crew_oc_forum_topic_id") or "").strip()
    if existing_topic_id:
        topic_exists = await db.forum_topics.find_one({"id": existing_topic_id}, {"_id": 1})
        if topic_exists:
            raise HTTPException(status_code=400, detail="Family already has a Crew OC topic. Go to Forum → Crew OC to find it.")
        # Stale link from a deleted topic; clear it so a new ad can be posted.
        await db.families.update_one({"id": family_id}, {"$unset": {"crew_oc_forum_topic_id": ""}})
    # Only allow when Crew OC is available or within CREW_OC_TOPIC_WINDOW_MINUTES before it becomes available
    cooldown_until = fam.get("crew_oc_cooldown_until")
    if cooldown_until:
        try:
            until = datetime.fromisoformat(str(cooldown_until).replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            window_start = until - timedelta(minutes=CREW_OC_TOPIC_WINDOW_MINUTES)
            if now < window_start:
                raise HTTPException(
                    status_code=400,
                    detail=f"You can only create a Crew OC topic when your Crew OC is available or up to {CREW_OC_TOPIC_WINDOW_MINUTES} minutes before it becomes available.",
                )
        except HTTPException:
            raise
        except Exception:
            pass
    topic_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    title = f"Crew OC: {fam.get('name')} [{fam.get('tag')}]"
    content = f"Apply here to join {fam.get('name')} [{fam.get('tag')}] for their next Crew OC run. Set your join fee in Families → Crew OC."
    doc = {
        "id": topic_id, "title": title, "content": content, "category": "crew_oc",
        "crew_oc_family_id": family_id, "author_id": current_user["id"],
        "author_username": current_user.get("username") or "?", "created_at": now, "updated_at": now,
        "views": 0, "is_sticky": False, "is_important": False, "is_locked": False,
    }
    await db.forum_topics.insert_one(doc)
    await db.families.update_one({"id": family_id}, {"$set": {"crew_oc_forum_topic_id": topic_id}})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Crew OC topic created.", "topic_id": topic_id, "title": title}


async def families_crew_oc_apply(request: FamilyCrewOCApplyRequest, current_user: dict = Depends(get_current_user)):
    family_id = (request.family_id or "").strip()
    if not family_id:
        raise HTTPException(status_code=400, detail="family_id required")
    uid = current_user["id"]
    if current_user.get("family_id") == family_id:
        raise HTTPException(status_code=400, detail="You are already in this family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1, "crew_oc_join_fee": 1, "crew_oc_auto_accept": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    fee = int(fam.get("crew_oc_join_fee") or 0)
    auto_accept = bool(fam.get("crew_oc_auto_accept"))
    existing = await db.family_crew_oc_applications.find_one({"family_id": family_id, "user_id": uid}, {"_id": 0, "status": 1})
    if existing:
        status = (existing.get("status") or "").strip().lower()
        if status in ("pending", "accepted"):
            raise HTTPException(status_code=400, detail=f"You already applied (status: {existing.get('status')})")
        # kicked or rejected: allow reapply by removing the old application
        await db.family_crew_oc_applications.delete_one({"family_id": family_id, "user_id": uid})
    now = datetime.now(timezone.utc).isoformat()
    application_id = str(uuid.uuid4())
    if fee > 0:
        money = int(current_user.get("money") or 0)
        if money < fee:
            raise HTTPException(status_code=400, detail=f"Join fee is ${fee:,}. You need ${fee - money:,} more cash.")
        await db.users.update_one({"id": uid}, {"$inc": {"money": -fee}})
        await db.families.update_one({"id": family_id}, {"$inc": {"treasury": fee}})
        status = "accepted" if auto_accept else "pending"
        await db.family_crew_oc_applications.insert_one({
            "id": application_id, "family_id": family_id, "user_id": uid,
            "username": current_user.get("username") or "?", "status": status, "amount_paid": fee, "created_at": now,
        })
        fam_name = (fam.get("name") or fam.get("tag") or "the family").strip()
        if auto_accept:
            await send_notification(uid, "Crew OC – You're in", f"You paid ${fee:,} and joined {fam_name} Crew OC for their next run.", "reward", category="crew_oc")
            await send_notification_to_family(family_id, "Crew OC – New crew member", f'{current_user.get("username") or "?"} paid ${fee:,} and joined your Crew OC for the next run.', "reward", category="oc_invites", actor_username=current_user.get("username") or "?")
            _invalidate_my_cache(current_user["id"])
            return {"message": "You paid and joined the crew. You'll get rewards when they commit.", "status": "accepted", "amount_paid": fee}
        await send_notification_to_family(family_id, "Crew OC application", f'{current_user.get("username") or "?"} applied to your Crew OC (paid ${fee:,}). Accept or reject in Families → Crew OC.', "system", category="oc_invites", actor_username=current_user.get("username") or "?")
        _invalidate_my_cache(current_user["id"])
        return {"message": "Application sent. The family will accept or reject.", "status": "pending", "amount_paid": fee}
    status = "accepted" if auto_accept else "pending"
    await db.family_crew_oc_applications.insert_one({
        "id": application_id, "family_id": family_id, "user_id": uid,
        "username": current_user.get("username") or "?", "status": status, "amount_paid": 0, "created_at": now,
    })
    fam_name = (fam.get("name") or fam.get("tag") or "the family").strip()
    if auto_accept:
        await send_notification(uid, "Crew OC – You're in", f"You applied and joined {fam_name} Crew OC for their next run.", "reward", category="crew_oc")
        await send_notification_to_family(family_id, "Crew OC – New crew member", f'{current_user.get("username") or "?"} applied and joined your Crew OC for the next run.', "reward", category="oc_invites", actor_username=current_user.get("username") or "?")
        _invalidate_my_cache(current_user["id"])
        return {"message": "You joined the crew. You'll get rewards when they commit.", "status": "accepted"}
    await send_notification_to_family(family_id, "Crew OC application", f'{current_user.get("username") or "?"} applied to your Crew OC. Accept or reject in Families → Crew OC.', "system", category="oc_invites", actor_username=current_user.get("username") or "?")
    _invalidate_my_cache(current_user["id"])
    return {"message": "Application sent. The family will accept or reject.", "status": "pending"}


async def families_crew_oc_applications(current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    role = (current_user.get("family_role") or "").strip().lower()
    apps = await db.family_crew_oc_applications.find({"family_id": family_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"applications": apps, "can_manage": role in ("boss", "underboss", "capo")}


async def families_crew_oc_accept(application_id: str, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    app = await db.family_crew_oc_applications.find_one({"id": application_id, "family_id": family_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Application already processed")
    await db.family_crew_oc_applications.update_one({"id": application_id}, {"$set": {"status": "accepted"}})
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1})
    fam_name = (fam or {}).get("name") or (fam or {}).get("tag") or "the family"
    await send_notification(app["user_id"], "Crew OC – Accepted", f"Your application to join {fam_name} Crew OC was accepted. You'll get rewards when they commit.", "reward", category="crew_oc")
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(app["user_id"])
    return {"message": "Application accepted."}


async def families_crew_oc_reject(application_id: str, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    app = await db.family_crew_oc_applications.find_one({"id": application_id, "family_id": family_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Application already processed")
    await db.family_crew_oc_applications.update_one({"id": application_id}, {"$set": {"status": "rejected"}})
    amount_paid = int(app.get("amount_paid") or 0)
    refunded = 0
    if amount_paid > 0:
        refund_result = await db.families.find_one_and_update(
            {"id": family_id, "treasury": {"$gte": amount_paid}},
            {"$inc": {"treasury": -amount_paid}},
            return_document=False,
        )
        if refund_result:
            await db.users.update_one({"id": app["user_id"]}, {"$inc": {"money": amount_paid}})
            refunded = amount_paid
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(app["user_id"])
    return {"message": "Application rejected." + (f" ${refunded:,} refunded." if refunded > 0 else " (Treasury insufficient for refund)" if amount_paid > 0 else "")}


async def families_crew_oc_kick(application_id: str, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    app = await db.family_crew_oc_applications.find_one({"id": application_id, "family_id": family_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "accepted":
        raise HTTPException(status_code=400, detail="Can only kick accepted crew members")
    await db.family_crew_oc_applications.update_one({"id": application_id}, {"$set": {"status": "kicked"}})
    amount_paid = int(app.get("amount_paid") or 0)
    refunded = 0
    if amount_paid > 0:
        refund_result = await db.families.find_one_and_update(
            {"id": family_id, "treasury": {"$gte": amount_paid}},
            {"$inc": {"treasury": -amount_paid}},
            return_document=False,
        )
        if refund_result:
            await db.users.update_one({"id": app["user_id"]}, {"$inc": {"money": amount_paid}})
            refunded = amount_paid
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1})
    fam_name = (fam or {}).get("name") or (fam or {}).get("tag") or "the family"
    await send_notification(app["user_id"], "Crew OC – Kicked", f"You were removed from {fam_name} Crew OC." + (f" ${refunded:,} has been refunded." if refunded > 0 else ""), "system", category="crew_oc")
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(app["user_id"])
    return {"message": "Crew member kicked." + (f" ${refunded:,} refunded." if refunded > 0 else " (Treasury insufficient for refund)" if amount_paid > 0 else "")}


async def families_crew_oc_commit(current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can commit Crew OC")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1, "treasury": 1, "crew_oc_cooldown_until": 1, "crew_oc_forum_topic_id": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    now = datetime.now(timezone.utc)
    cooldown_until = fam.get("crew_oc_cooldown_until")
    if cooldown_until:
        try:
            until = datetime.fromisoformat(str(cooldown_until).replace("Z", "+00:00"))
            if until > now:
                secs = int((until - now).total_seconds())
                raise HTTPException(status_code=400, detail=f"Crew OC on cooldown. Try again in {secs}s")
        except HTTPException:
            raise
        except Exception:
            pass
    has_timer = bool(current_user.get("crew_oc_timer_reduced", False))
    cooldown_hours = CREW_OC_COOLDOWN_HOURS_REDUCED if has_timer else CREW_OC_COOLDOWN_HOURS
    new_cooldown_until = now + timedelta(hours=cooldown_hours)
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(100)
    member_ids = [m["user_id"] for m in members]
    accepted = await db.family_crew_oc_applications.find({"family_id": family_id, "status": "accepted"}, {"_id": 0, "user_id": 1}).to_list(50)
    accepted_ids = [a["user_id"] for a in accepted]
    roster_ids = list(dict.fromkeys(member_ids + accepted_ids))
    living = await db.users.find({"id": {"$in": roster_ids}, "is_dead": {"$ne": True}}, {"_id": 0, "id": 1, "rank_points": 1, "username": 1}).to_list(100)
    living_ids = [u["id"] for u in living]
    if not living_ids:
        raise HTTPException(status_code=400, detail="No living crew members")
    for u in living:
        uid = u["id"]
        rp_before = int(u.get("rank_points") or 0)
        await db.users.update_one({"id": uid}, {"$inc": {"rank_points": CREW_OC_REWARD_RP, "money": CREW_OC_REWARD_CASH, "bullets": CREW_OC_REWARD_BULLETS, "respect_points": CREW_OC_REWARD_POINTS, "booze": CREW_OC_REWARD_BOOZE}})
        if CREW_OC_REWARD_POINTS:
            await log_respect_earned(uid, CREW_OC_REWARD_POINTS, "crew_oc")
        try:
            await maybe_process_rank_up(uid, rp_before, CREW_OC_REWARD_RP, u.get("username", ""))
        except Exception:
            logging.exception("Rank-up notification (Crew OC)")
    await db.families.update_one({"id": family_id}, {"$inc": {"treasury": CREW_OC_TREASURY_LUMP}, "$set": {"crew_oc_cooldown_until": new_cooldown_until.isoformat()}, "$unset": {"crew_oc_forum_topic_id": ""}})
    await db.family_crew_oc_applications.delete_many({"family_id": family_id})
    topic_id = fam.get("crew_oc_forum_topic_id")
    if topic_id:
        await db.forum_topics.update_one({"id": topic_id}, {"$set": {"is_locked": True}})
    fam_name = (fam.get("name") or fam.get("tag") or "Crew").strip() or "Crew"
    for uid in living_ids:
        await send_notification(uid, "Crew OC committed", f"{fam_name} committed the Organised Crime. You received +{CREW_OC_REWARD_RP} RP, +${CREW_OC_REWARD_CASH:,} cash, +{CREW_OC_REWARD_BULLETS} bullets, +{CREW_OC_REWARD_POINTS} respect points, +{CREW_OC_REWARD_BOOZE} booze. Family Treasury +${CREW_OC_TREASURY_LUMP:,}.", "reward", category="crew_oc")
    _invalidate_my_cache(current_user["id"])
    return {"message": "Crew OC committed. All crew rewarded.", "crew_oc_cooldown_until": new_cooldown_until.isoformat(), "cooldown_hours": cooldown_hours}


async def families_racket_collect(racket_id: str, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1, "racket_income_bonus_percent": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level <= 0:
        raise HTTPException(status_code=400, detail="Racket not active")
    r_def = next((x for x in FAMILY_RACKETS if x["id"] == racket_id), None)
    if not r_def:
        raise HTTPException(status_code=404, detail="Racket not found")
    ev = await get_effective_event()
    income, cooldown_h = _racket_income_and_cooldown(racket_id, level, ev)
    bonus_pct = float((fam.get("racket_income_bonus_percent") or 0) or 0)
    income_final = int(income * (1 + bonus_pct / 100.0) * founding_member_income_mult(current_user))
    last_at = state.get("last_collected_at")
    now = datetime.now(timezone.utc)
    if last_at:
        try:
            last_dt = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
            war_sec = await _family_war_duration_seconds(family_id, last_dt, now)
            effective_cooldown_end = last_dt + timedelta(hours=cooldown_h) + timedelta(seconds=war_sec)
            if effective_cooldown_end > now:
                secs = max(1, int((effective_cooldown_end - now).total_seconds()))
                hrs = secs // 3600
                mins = (secs % 3600) // 60
                if hrs > 0:
                    detail = f"Racket on cooldown. Try again in {hrs}h {mins}m."
                else:
                    detail = f"Racket on cooldown. Try again in {mins}m."
                raise HTTPException(status_code=400, detail=detail)
        except HTTPException:
            raise
        except Exception:
            pass
    now_iso = now.isoformat()
    rackets[racket_id] = {**state, "level": level, "last_collected_at": now_iso}
    filter_cond: dict = {"id": family_id}
    if last_at:
        filter_cond[f"rackets.{racket_id}.last_collected_at"] = last_at
    else:
        # Unlocks store last_collected_at: null (field exists). {"$exists": false} does not match null → update never ran.
        lc_key = f"rackets.{racket_id}.last_collected_at"
        filter_cond["$or"] = [{lc_key: {"$exists": False}}, {lc_key: None}]
    collect_result = await db.families.update_one(filter_cond, {"$set": {"rackets": rackets}, "$inc": {"treasury": income_final}})
    if collect_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Racket on cooldown. Another collection likely just happened.")
    msg = _rng.choice(FAMILY_RACKET_COLLECT_SUCCESS_MESSAGES).format(income=income_final)
    _invalidate_my_cache(current_user["id"])
    return {"message": msg, "amount": income_final}


async def families_racket_unlock(racket_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Rackets are locked until the family war is over")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if racket_id not in [x["id"] for x in FAMILY_RACKETS]:
        raise HTTPException(status_code=404, detail="Racket not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level >= 1:
        raise HTTPException(status_code=400, detail="Racket already unlocked")
    prev_id = _racket_previous_id(racket_id)
    if prev_id:
        prev_level = (rackets.get(prev_id) or {}).get("level", 0)
        if prev_level < RACKET_MAX_LEVEL:
            prev_name = next((r["name"] for r in FAMILY_RACKETS if r["id"] == prev_id), prev_id)
            raise HTTPException(status_code=400, detail=f"Fully upgrade {prev_name} (level {RACKET_MAX_LEVEL}) before unlocking this racket")
    treasury = int((fam.get("treasury") or 0) or 0)
    if treasury < RACKET_UNLOCK_COST:
        raise HTTPException(status_code=400, detail=f"Not enough treasury (need ${RACKET_UNLOCK_COST:,})")
    rackets[racket_id] = {"level": 1, "last_collected_at": None}
    result = await db.families.update_one(
        {"id": family_id, "treasury": {"$gte": RACKET_UNLOCK_COST}},
        {"$set": {"rackets": rackets}, "$inc": {"treasury": -RACKET_UNLOCK_COST}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough treasury (balance may have changed)")
    _invalidate_my_cache(current_user["id"])
    return {"message": "Racket unlocked"}


async def families_racket_upgrade(racket_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Rackets are locked until the family war is over")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if racket_id not in [x["id"] for x in FAMILY_RACKETS]:
        raise HTTPException(status_code=404, detail="Racket not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level <= 0:
        raise HTTPException(status_code=400, detail="Unlock this racket first (previous racket must be fully upgraded)")
    if level >= RACKET_MAX_LEVEL:
        raise HTTPException(status_code=400, detail="Racket already max level")
    treasury = int((fam.get("treasury") or 0) or 0)
    if treasury < RACKET_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Not enough treasury")
    rackets[racket_id] = {**state, "level": level + 1, "last_collected_at": state.get("last_collected_at")}
    result = await db.families.update_one(
        {"id": family_id, "treasury": {"$gte": RACKET_UPGRADE_COST}},
        {"$set": {"rackets": rackets}, "$inc": {"treasury": -RACKET_UPGRADE_COST}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough treasury (balance may have changed)")
    _invalidate_my_cache(current_user["id"])
    return {"message": f"Upgraded to level {level + 1}"}


async def families_racket_attack_targets(debug: bool = False, current_user: dict = Depends(get_current_user)):
    my_family_id = current_user.get("family_id")
    if not my_family_id:
        return {"targets": []}
    all_other = await db.families.find({"id": {"$ne": my_family_id}, "wiped": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "treasury": 1, "rackets": 1}).to_list(50)
    ev = await get_effective_event()
    targets = []
    for fam in all_other:
        rackets = fam.get("rackets") or {}
        racket_list = []
        for rid, state in rackets.items():
            lv = state.get("level", 0)
            if lv < 1:
                continue
            r_def = next((x for x in FAMILY_RACKETS if x["id"] == rid), None)
            income, cooldown_h = _racket_income_and_cooldown(rid, lv, ev)
            potential_take = int(income * FAMILY_RACKET_ATTACK_REVENUE_PCT)
            success_chance = max(FAMILY_RACKET_ATTACK_MIN_SUCCESS, FAMILY_RACKET_ATTACK_BASE_SUCCESS - lv * FAMILY_RACKET_ATTACK_LEVEL_PENALTY)
            success_chance_pct = int(round(success_chance * 100))
            racket_list.append({"racket_id": rid, "racket_name": r_def["name"] if r_def else rid, "level": lv, "potential_take": potential_take, "success_chance_pct": success_chance_pct})
        if racket_list:
            window_start = datetime.now(timezone.utc) - timedelta(hours=FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS)
            window_start_iso = window_start.isoformat()
            raids_on_crew = await db.family_racket_attacks.count_documents({"attacker_family_id": my_family_id, "target_family_id": fam["id"], "last_at": {"$gte": window_start_iso}})
            raids_used = min(raids_on_crew, FAMILY_RACKET_ATTACK_MAX_PER_CREW)
            raids_remaining = max(0, FAMILY_RACKET_ATTACK_MAX_PER_CREW - raids_used)
            next_raid_at = None
            if raids_remaining == 0 and raids_on_crew > 0:
                oldest = await db.family_racket_attacks.find(
                    {"attacker_family_id": my_family_id, "target_family_id": fam["id"], "last_at": {"$gte": window_start_iso}},
                    {"_id": 0, "last_at": 1},
                ).sort("last_at", 1).limit(1).to_list(1)
                if oldest:
                    la_raw = oldest[0].get("last_at")
                    if la_raw is not None:
                        la_s = str(la_raw).replace("Z", "+00:00")
                        try:
                            la_dt = datetime.fromisoformat(la_s)
                            if la_dt.tzinfo is None:
                                la_dt = la_dt.replace(tzinfo=timezone.utc)
                            next_raid_at = (la_dt + timedelta(hours=FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS)).isoformat()
                        except (ValueError, TypeError):
                            next_raid_at = None
            targets.append(
                {
                    "family_id": fam["id"],
                    "family_name": fam["name"],
                    "family_tag": fam["tag"],
                    "treasury": fam.get("treasury", 0),
                    "rackets": racket_list,
                    "raids_used": raids_used,
                    "raids_remaining": raids_remaining,
                    "next_raid_at": next_raid_at,
                }
            )
    return {"targets": targets}


async def families_attack_racket(request: FamilyAttackRacketRequest, current_user: dict = Depends(get_current_user)):
    my_family_id = current_user.get("family_id")
    if not my_family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    target_fam = await db.families.find_one({"id": request.family_id}, {"_id": 0, "name": 1, "tag": 1, "treasury": 1, "rackets": 1})
    if not target_fam or request.family_id == my_family_id:
        raise HTTPException(status_code=404, detail="Family not found")
    state = (target_fam.get("rackets") or {}).get(request.racket_id) or {}
    level = state.get("level", 0)
    if level < 1:
        raise HTTPException(status_code=400, detail="Racket not active")
    lock = await _get_family_raid_lock(my_family_id, request.family_id)
    async with lock:
        window_start = datetime.now(timezone.utc) - timedelta(hours=FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS)
        raids_on_crew = await db.family_racket_attacks.count_documents({"attacker_family_id": my_family_id, "target_family_id": request.family_id, "last_at": {"$gte": window_start.isoformat()}})
        if raids_on_crew >= FAMILY_RACKET_ATTACK_MAX_PER_CREW:
            raise HTTPException(status_code=400, detail="Only 2 raids per family every 3 hours. You've used your raids on this crew.")
        ev = await get_effective_event()
        income_per, _ = _racket_income_and_cooldown(request.racket_id, level, ev)
        take = int(income_per * FAMILY_RACKET_ATTACK_REVENUE_PCT)
        success_chance = max(FAMILY_RACKET_ATTACK_MIN_SUCCESS, FAMILY_RACKET_ATTACK_BASE_SUCCESS - level * FAMILY_RACKET_ATTACK_LEVEL_PENALTY)
        success = _rng.random() < success_chance
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.family_racket_attacks.insert_one({"attacker_family_id": my_family_id, "target_family_id": request.family_id, "target_racket_id": request.racket_id, "last_at": now_iso})
        r_def = next((x for x in FAMILY_RACKETS if x["id"] == request.racket_id), None)
        racket_name = r_def["name"] if r_def else request.racket_id
        family_name = target_fam.get("name") or "Enemy"
        if success and take > 0:
            treasury = int((target_fam.get("treasury") or 0) or 0)
            actual = min(take, treasury)
            if actual > 0:
                raid_result = await db.families.find_one_and_update(
                    {"id": request.family_id, "treasury": {"$gte": actual}},
                    {"$inc": {"treasury": -actual}},
                    return_document=False,
                )
                if raid_result:
                    await db.families.update_one({"id": my_family_id}, {"$inc": {"treasury": actual}})
                else:
                    actual = 0
            msg = _rng.choice(FAMILY_RACKET_RAID_SUCCESS_MESSAGES).format(amount=actual, family_name=family_name, racket_name=racket_name)
            _invalidate_list_cache()
            _invalidate_my_cache(current_user["id"])
            return {"success": True, "message": msg, "amount": actual}
        fail_msg = _rng.choice(FAMILY_RACKET_RAID_FAIL_MESSAGES).format(family_name=family_name, racket_name=racket_name)
        return {"success": False, "message": fail_msg, "amount": 0}


async def families_war(current_user: dict = Depends(get_current_user)):
    """Lightweight: list active wars for current user's family (e.g. for sidebar badge)."""
    my_family_id = current_user.get("family_id")
    if not my_family_id:
        return {"wars": []}
    wars = await db.family_wars.find(
        {"$or": [{"family_a_id": my_family_id}, {"family_b_id": my_family_id}], "status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0, "id": 1, "status": 1}
    ).to_list(10)
    return {"wars": [{"id": w["id"], "status": w.get("status", "active")} for w in wars]}


async def families_war_stats(current_user: dict = Depends(get_current_user)):
    my_family_id = _norm_fid(current_user.get("family_id"))
    if not my_family_id:
        return {"wars": []}

    wars = await db.family_wars.find(
        {"$or": [{"family_a_id": my_family_id}, {"family_b_id": my_family_id}], "status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0},
    ).to_list(10)
    if not wars:
        return {"wars": []}

    war_ids = [w["id"] for w in wars]
    war_meta = []
    other_ids_set = set()
    for w in wars:
        war_fid_a = _norm_fid(w["family_a_id"])
        war_fid_b = _norm_fid(w["family_b_id"])
        other_id = war_fid_b if war_fid_a == my_family_id else war_fid_a
        war_meta.append((w, war_fid_a, war_fid_b, other_id))
        if other_id:
            other_ids_set.add(other_id)

    other_fams = {}
    if other_ids_set:
        async for f in db.families.find({"id": {"$in": list(other_ids_set)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}):
            if f.get("id"):
                other_fams[f["id"]] = f

    all_stats = await db.family_war_stats.find({"war_id": {"$in": war_ids}}, {"_id": 0}).to_list(5000)
    stats_by_war: dict = defaultdict(list)
    for s in all_stats:
        wid = s.get("war_id")
        if wid:
            stats_by_war[wid].append(s)

    need_resolve_uids = set()
    all_uids = set()
    all_fids = set()
    for (w, war_fid_a, war_fid_b, _other_id) in war_meta:
        for s in stats_by_war.get(w["id"], []):
            uid = s.get("user_id")
            if not uid:
                continue
            all_uids.add(uid)
            fid = _norm_fid(s.get("family_id"))
            if fid in (war_fid_a, war_fid_b):
                all_fids.add(fid)
            else:
                need_resolve_uids.add(uid)

    resolve_map = await _batch_resolve_family_ids(list(need_resolve_uids))
    for _uid, rfid in resolve_map.items():
        if rfid:
            all_fids.add(rfid)

    user_map = {}
    if all_uids:
        async for u in db.users.find({"id": {"$in": list(all_uids)}}, {"_id": 0, "id": 1, "username": 1}):
            if u.get("id"):
                user_map[u["id"]] = u

    fam_map = {}
    if all_fids:
        async for f in db.families.find({"id": {"$in": list(all_fids)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}):
            if f.get("id"):
                fam_map[f["id"]] = f

    out = []
    for (w, war_fid_a, war_fid_b, other_id) in war_meta:
        other_fam = other_fams.get(other_id, {})
        other_name = (other_fam or {}).get("name", "?")
        other_tag = (other_fam or {}).get("tag", "?")

        by_user: dict = {}
        for s in stats_by_war.get(w["id"], []):
            uid = s.get("user_id")
            if not uid:
                continue
            u = user_map.get(uid, {})
            fid = _norm_fid(s.get("family_id"))
            if fid not in (war_fid_a, war_fid_b):
                fid = resolve_map.get(uid) or fid
            fam_doc = fam_map.get(fid) if fid else None
            by_user[uid] = {
                **s,
                "family_id": fid,
                "family_name": (fam_doc or {}).get("name", "?"),
                "family_tag": (fam_doc or {}).get("tag", "?"),
                "username": u.get("username", "?"),
                "impact": (s.get("kills") or 0) + (s.get("bodyguard_kills") or 0),
            }

        all_entries = list(by_user.values())

        def _totals(fid):
            members = [e for e in all_entries if _norm_fid(e.get("family_id")) == fid]
            return {
                "kills": sum(e.get("kills") or 0 for e in members),
                "deaths": sum(e.get("deaths") or 0 for e in members),
                "bodyguard_kills": sum(e.get("bodyguard_kills") or 0 for e in members),
                "bodyguards_lost": sum(e.get("bodyguards_lost") or 0 for e in members),
            }

        my_totals = _totals(my_family_id)
        other_totals = _totals(other_id)

        top_bg = sorted(all_entries, key=lambda x: (-(x.get("bodyguard_kills") or 0), x.get("username", "")))[:10]
        top_lost = sorted(all_entries, key=lambda x: (-(x.get("bodyguards_lost") or 0), x.get("username", "")))[:10]
        top_killers = sorted(all_entries, key=lambda x: (-(x.get("kills") or 0), x.get("username", "")))[:10]
        mvp = sorted(all_entries, key=lambda x: (-(x.get("impact") or 0), x.get("username", "")))[:10]

        out.append({
            "war": {
                "id": w["id"],
                "family_a_id": w["family_a_id"],
                "family_b_id": w["family_b_id"],
                "status": w["status"],
                "other_family_id": other_id,
                "other_family_name": other_name,
                "other_family_tag": other_tag,
                "truce_offered_by_family_id": w.get("truce_offered_by_family_id"),
                "truce_offered_at": w.get("truce_offered_at"),
                "truce_cooldown_until": w.get("truce_cooldown_until"),
                "truce_timeout_minutes": 30,
            },
            "stats": {
                "my_family_totals": my_totals,
                "other_family_totals": other_totals,
                "top_bodyguard_killers": top_bg,
                "top_bodyguards_lost": top_lost,
                "top_killers": top_killers,
                "mvp": mvp,
            },
        })
    return {"wars": out}


TRUCE_OFFER_TIMEOUT_MINUTES = 30
TRUCE_COOLDOWN_HOURS = 24


async def _check_and_expire_truce(war: dict) -> dict | None:
    """Check if a truce offer has expired. If so, reset to active and set cooldown. Returns updated war or None."""
    if war.get("status") != "truce_offered":
        return None
    offered_at = war.get("truce_offered_at")
    if not offered_at:
        return None
    try:
        offered_dt = datetime.fromisoformat(offered_at.replace("Z", "+00:00"))
    except Exception:
        return None
    now = datetime.now(timezone.utc)
    if now > offered_dt + timedelta(minutes=TRUCE_OFFER_TIMEOUT_MINUTES):
        cooldown_until = (now + timedelta(hours=TRUCE_COOLDOWN_HOURS)).isoformat()
        await db.family_wars.update_one(
            {"id": war["id"], "status": "truce_offered"},
            {"$set": {"status": "active", "truce_cooldown_until": cooldown_until}, "$unset": {"truce_offered_by_family_id": "", "truce_offered_at": ""}},
        )
        return await db.family_wars.find_one({"id": war["id"]}, {"_id": 0})
    return None


async def families_war_truce_offer(request: WarTruceRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can offer truce")
    war = await db.family_wars.find_one({"id": request.war_id}, {"_id": 0})
    if not war or war.get("status") not in ("active", "truce_offered"):
        raise HTTPException(status_code=404, detail="War not found or not active")
    if family_id not in (war["family_a_id"], war["family_b_id"]):
        raise HTTPException(status_code=403, detail="Not your war")
    expired = await _check_and_expire_truce(war)
    if expired:
        war = expired
    if war.get("status") == "truce_offered":
        if war.get("truce_offered_by_family_id") == family_id:
            return {"message": "Truce already offered"}
        raise HTTPException(status_code=400, detail="A truce offer is already pending from the other side")
    cooldown_until = war.get("truce_cooldown_until")
    if cooldown_until:
        try:
            cooldown_dt = datetime.fromisoformat(cooldown_until.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < cooldown_dt:
                remaining = cooldown_dt - datetime.now(timezone.utc)
                hours_left = int(remaining.total_seconds() // 3600)
                mins_left = int((remaining.total_seconds() % 3600) // 60)
                raise HTTPException(status_code=400, detail=f"Truce on cooldown. Try again in {hours_left}h {mins_left}m.")
        except HTTPException:
            raise
        except Exception:
            pass
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.family_wars.update_one(
        {"id": request.war_id, "status": "active"},
        {"$set": {"status": "truce_offered", "truce_offered_by_family_id": family_id, "truce_offered_at": now_iso}},
    )
    if result.modified_count == 0:
        return {"message": "Truce already offered or war ended"}
    await send_notification_to_family(war["family_a_id"] if war["family_b_id"] == family_id else war["family_b_id"], "Truce offered", f"The enemy family has offered a truce. Boss or Underboss has {TRUCE_OFFER_TIMEOUT_MINUTES} minutes to accept.", "system")
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    return {"message": "Truce offered"}


async def families_war_truce_accept(request: WarTruceRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can accept truce")
    war = await db.family_wars.find_one({"id": request.war_id}, {"_id": 0})
    if not war or war.get("status") != "truce_offered":
        raise HTTPException(status_code=404, detail="War not found or no truce offered")
    if family_id not in (war["family_a_id"], war["family_b_id"]):
        raise HTTPException(status_code=403, detail="Not your war")
    if war.get("truce_offered_by_family_id") == family_id:
        raise HTTPException(status_code=400, detail="You offered the truce; the other side must accept")
    expired = await _check_and_expire_truce(war)
    if expired:
        raise HTTPException(status_code=400, detail="Truce offer has expired. A new truce cannot be offered for 24 hours.")
    now = datetime.now(timezone.utc).isoformat()
    result = await db.family_wars.update_one(
        {"id": request.war_id, "status": "truce_offered"},
        {"$set": {"status": "truce", "ended_at": now}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="War already ended or truce withdrawn")
    await send_notification_to_family(war["family_a_id"], "🤝 Truce accepted", "The war has ended by truce.", "system")
    await send_notification_to_family(war["family_b_id"], "🤝 Truce accepted", "The war has ended by truce.", "system")
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    return {"message": "Truce accepted. War ended."}


async def families_wars_history(current_user: dict = Depends(get_current_user)):
    wars = await db.family_wars.find({}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
    family_ids = set()
    for w in wars:
        family_ids.add(w.get("family_a_id"))
        family_ids.add(w.get("family_b_id"))
    family_map = {}
    if family_ids:
        for f in await db.families.find({"id": {"$in": list(family_ids)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}).to_list(20):
            family_map[f["id"]] = f
    out = []
    for w in wars:
        fa = family_map.get(w.get("family_a_id"), {})
        fb = family_map.get(w.get("family_b_id"), {})
        winner_id = w.get("winner_family_id")
        loser_id = w.get("loser_family_id")
        winner_fam = family_map.get(winner_id, {}) if winner_id else {}
        # Use names stored on the war document when family was defeated (so we keep the name even if family later deleted)
        family_a_name = fa.get("name") or (w.get("winner_family_name") if w.get("family_a_id") == winner_id else w.get("loser_family_name") if w.get("family_a_id") == loser_id else None) or "?"
        family_b_name = fb.get("name") or (w.get("winner_family_name") if w.get("family_b_id") == winner_id else w.get("loser_family_name") if w.get("family_b_id") == loser_id else None) or "?"
        family_a_tag = fa.get("tag") or "?"
        family_b_tag = fb.get("tag") or "?"
        winner_family_name = winner_fam.get("name") or w.get("winner_family_name") or "?"
        out.append({"id": w["id"], "family_a_id": w["family_a_id"], "family_b_id": w["family_b_id"], "family_a_name": family_a_name, "family_a_tag": family_a_tag, "family_b_name": family_b_name, "family_b_tag": family_b_tag, "status": w.get("status", "active"), "winner_family_id": winner_id, "winner_family_name": winner_family_name, "ended_at": w.get("ended_at"), "prize_exclusive_cars": w.get("prize_exclusive_cars"), "prize_rackets": w.get("prize_rackets") or []})
    return {"wars": out}


async def admin_debug_war_stats(current_user: dict = Depends(get_current_user)):
    """Admin: return raw family_war_stats and family_wars for debugging vendetta BG kill issues."""
    from server import _is_admin
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    wars = await db.family_wars.find({"status": {"$in": ["active", "truce_offered"]}}, {"_id": 0}).to_list(20)
    war_ids = [w["id"] for w in wars]
    fam_ids = set()
    for w in wars:
        if w.get("family_a_id"):
            fam_ids.add(w["family_a_id"])
        if w.get("family_b_id"):
            fam_ids.add(w["family_b_id"])
    fam_map = {}
    if fam_ids:
        async for f in db.families.find({"id": {"$in": list(fam_ids)}}, {"_id": 0, "id": 1, "name": 1}):
            if f.get("id"):
                fam_map[f["id"]] = f
    all_stats = await db.family_war_stats.find({"war_id": {"$in": war_ids}}, {"_id": 0}).to_list(2000)
    stats_by_war: dict = defaultdict(list)
    for s in all_stats:
        wid = s.get("war_id")
        if wid:
            stats_by_war[wid].append(s)
    result = []
    for w in wars:
        wid = w["id"]
        stats = stats_by_war.get(wid, [])
        fa = fam_map.get(w.get("family_a_id"), {})
        fb = fam_map.get(w.get("family_b_id"), {})
        result.append({
            "war_id": wid,
            "family_a": w.get("family_a_id"), "family_a_name": fa.get("name"),
            "family_b": w.get("family_b_id"), "family_b_name": fb.get("name"),
            "status": w.get("status"),
            "stat_count": len(stats),
            "stats": stats,
        })
    return {"wars": result}


async def families_war_feed(war_id: str, current_user: dict = Depends(get_current_user)):
    """Return the kill-event feed for a specific war plus aggregated totals. Public to all authenticated users."""
    war = await db.family_wars.find_one({"id": war_id}, {"_id": 0, "family_a_id": 1, "family_b_id": 1, "status": 1})
    if not war:
        raise HTTPException(status_code=404, detail="War not found")

    docs = await db.war_kill_feed.find({"war_id": war_id}, {"_id": 0}).sort("created_at", -1).to_list(200)

    # Resolve any missing usernames from DB
    uid_set = set()
    for d in docs:
        if not d.get("killer_username") or d.get("killer_username") == "?":
            uid_set.add(d.get("killer_id"))
        if not d.get("victim_username") or d.get("victim_username") == "?":
            uid_set.add(d.get("victim_id"))
    uid_set.discard(None)
    if uid_set:
        users = await db.users.find({"id": {"$in": list(uid_set)}}, {"_id": 0, "id": 1, "username": 1}).to_list(200)
        umap = {u["id"]: u.get("username", "?") for u in users}
        for d in docs:
            if not d.get("killer_username") or d.get("killer_username") == "?":
                d["killer_username"] = umap.get(d.get("killer_id"), "?")
            if not d.get("victim_username") or d.get("victim_username") == "?":
                d["victim_username"] = umap.get(d.get("victim_id"), "?")

    # Aggregate bullets used and bodyguard points spent per family
    war_over = war.get("status") not in ("active", "truce_offered")
    fid_a = _norm_fid(war["family_a_id"])
    fid_b = _norm_fid(war["family_b_id"])
    totals: dict = {
        fid_a: {"bullets_used": 0, "bg_points_spent": 0},
        fid_b: {"bullets_used": 0, "bg_points_spent": 0},
    }
    for d in docs:
        fid = _norm_fid(d.get("killer_family_id"))
        if fid in totals:
            totals[fid]["bullets_used"] += int(d.get("bullets_used") or 0)
        # bg_hire_cost is charged to the VICTIM family (they paid for the BG)
        victim_fid = _norm_fid(d.get("victim_family_id"))
        if victim_fid in totals:
            totals[victim_fid]["bg_points_spent"] += int(d.get("bg_hire_cost") or 0)

    my_family_id = current_user.get("family_id")
    my_fid = _norm_fid(my_family_id) if my_family_id else fid_a
    other_fid = fid_b if my_fid == fid_a else fid_a

    return {
        "feed": docs,
        "war_over": war_over,
        "my_totals": totals.get(my_fid, {"bullets_used": 0, "bg_points_spent": 0}),
        "other_totals": totals.get(other_fid, {"bullets_used": 0, "bg_points_spent": 0}),
        "family_a_id": fid_a,
        "family_b_id": fid_b,
    }


async def families_war_public_stats(war_id: str, current_user: dict = Depends(get_current_user)):
    """Public per-player stats for any war, readable by all authenticated users."""
    war = await db.family_wars.find_one({"id": war_id}, {"_id": 0})
    if not war:
        raise HTTPException(status_code=404, detail="War not found")

    fid_a = _norm_fid(war["family_a_id"])
    fid_b = _norm_fid(war["family_b_id"])
    fam_a = await db.families.find_one({"id": fid_a}, {"_id": 0, "name": 1, "tag": 1}) or {}
    fam_b = await db.families.find_one({"id": fid_b}, {"_id": 0, "name": 1, "tag": 1}) or {}
    winner_id = _norm_fid(war.get("winner_family_id"))
    loser_id = _norm_fid(war.get("loser_family_id"))
    family_a_name = fam_a.get("name") or (war.get("winner_family_name") if fid_a == winner_id else war.get("loser_family_name") if fid_a == loser_id else None) or "?"
    family_b_name = fam_b.get("name") or (war.get("winner_family_name") if fid_b == winner_id else war.get("loser_family_name") if fid_b == loser_id else None) or "?"
    family_a_tag = fam_a.get("tag") or "?"
    family_b_tag = fam_b.get("tag") or "?"

    stats_docs = await db.family_war_stats.find({"war_id": war_id}, {"_id": 0}).to_list(500)
    by_user: dict = {}
    for s in stats_docs:
        uid = s.get("user_id")
        if not uid:
            continue
        u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
        fid = _norm_fid(s.get("family_id"))
        if fid not in (fid_a, fid_b):
            fid = await resolve_family_id(uid)
        fam_doc = await db.families.find_one({"id": fid}, {"_id": 0, "name": 1, "tag": 1}) if fid else None
        by_user[uid] = {
            **s,
            "family_id": fid,
            "family_name": (fam_doc or {}).get("name", "?"),
            "family_tag": (fam_doc or {}).get("tag", "?"),
            "username": (u or {}).get("username", "?"),
            "impact": (s.get("kills") or 0) + (s.get("bodyguard_kills") or 0),
        }

    all_entries = list(by_user.values())

    def _totals(fid):
        members = [e for e in all_entries if _norm_fid(e.get("family_id")) == fid]
        return {
            "kills": sum(e.get("kills") or 0 for e in members),
            "deaths": sum(e.get("deaths") or 0 for e in members),
            "bodyguard_kills": sum(e.get("bodyguard_kills") or 0 for e in members),
            "bodyguards_lost": sum(e.get("bodyguards_lost") or 0 for e in members),
        }

    return {
        "war": {
            "id": war["id"],
            "family_a_id": fid_a,
            "family_a_name": family_a_name,
            "family_a_tag": family_a_tag,
            "family_b_id": fid_b,
            "family_b_name": family_b_name,
            "family_b_tag": family_b_tag,
            "status": war.get("status"),
            "ended_at": war.get("ended_at"),
            "winner_family_id": war.get("winner_family_id"),
        },
        "family_a_totals": _totals(fid_a),
        "family_b_totals": _totals(fid_b),
        "all_players": all_entries,
    }


# ─────────────────────────────────────────────────────────────────────────────
# State Takeover (when your family conquers a state but you already head one)
# ─────────────────────────────────────────────────────────────────────────────

async def state_takeover_accept(current_user: dict = Depends(get_current_user)):
    """Accept a pending state takeover offer. Your old state becomes unclaimed, you take the new one."""
    member = await db.family_members.find_one({"user_id": current_user["id"]}, {"_id": 0, "family_id": 1, "role": 1})
    if not member:
        raise HTTPException(status_code=400, detail="You are not in a family")
    _mr = str(member.get("role") or "").strip().lower()
    if _mr not in ("boss", "don", "underboss"):
        raise HTTPException(status_code=403, detail="Only the Don or Underboss can accept state takeovers")

    family_id = member["family_id"]
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "pending_state_takeover": 1, "head_of_state": 1, "name": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")

    pending_state = (fam.get("pending_state_takeover") or "").strip()
    if not pending_state:
        raise HTTPException(status_code=400, detail="No pending state takeover offer")

    current_state = (fam.get("head_of_state") or "").strip()

    # Clear our current state first
    if current_state:
        await set_state_head(current_state, None)

    # Take the new state (use force=True since we just cleared our old state)
    err = await set_state_head(pending_state, family_id, force=True)
    if err:
        raise HTTPException(status_code=400, detail=err)

    # Clear the pending offer
    await db.families.update_one(
        {"id": family_id},
        {"$unset": {"pending_state_takeover": "", "pending_state_takeover_at": ""}}
    )

    return {
        "message": f"Takeover accepted! Your family now controls {pending_state}. {current_state} is now unclaimed.",
        "new_state": pending_state,
        "old_state_released": current_state,
    }


async def state_takeover_reject(current_user: dict = Depends(get_current_user)):
    """Reject a pending state takeover offer. The conquered state remains unclaimed."""
    member = await db.family_members.find_one({"user_id": current_user["id"]}, {"_id": 0, "family_id": 1, "role": 1})
    if not member:
        raise HTTPException(status_code=400, detail="You are not in a family")
    _mr = str(member.get("role") or "").strip().lower()
    if _mr not in ("boss", "don", "underboss"):
        raise HTTPException(status_code=403, detail="Only the Don or Underboss can reject state takeovers")

    family_id = member["family_id"]
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "pending_state_takeover": 1, "head_of_state": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")

    pending_state = (fam.get("pending_state_takeover") or "").strip()
    if not pending_state:
        raise HTTPException(status_code=400, detail="No pending state takeover offer")

    current_state = (fam.get("head_of_state") or "").strip()

    # Clear the pending offer - the conquered state stays unclaimed
    await db.families.update_one(
        {"id": family_id},
        {"$unset": {"pending_state_takeover": "", "pending_state_takeover_at": ""}}
    )

    return {
        "message": f"Takeover rejected. {pending_state} remains unclaimed. You keep control of {current_state}.",
        "rejected_state": pending_state,
        "kept_state": current_state,
    }


def register(router):
    router.add_api_route("/admin/debug/war-stats", admin_debug_war_stats, methods=["GET"])
    router.add_api_route("/families", families_list, methods=["GET"])
    router.add_api_route("/families/config", families_config, methods=["GET"])
    router.add_api_route("/families/my", families_my, methods=["GET"])
    router.add_api_route("/families/lookup", families_lookup, methods=["GET"])
    router.add_api_route("/families", families_create, methods=["POST"])
    router.add_api_route("/families/join", families_join, methods=["POST"])
    router.add_api_route("/families/apply", families_apply, methods=["POST"])
    router.add_api_route("/families/join-applications", families_join_applications_list, methods=["GET"])
    router.add_api_route("/families/join-applications/{application_id}/accept", families_join_application_accept, methods=["POST"])
    router.add_api_route("/families/join-applications/{application_id}/deny", families_join_application_deny, methods=["POST"])
    router.add_api_route("/families/join-settings", families_join_settings, methods=["PATCH"])
    router.add_api_route("/families/melt-settings", families_melt_settings, methods=["PATCH"])
    router.add_api_route("/families/leave", families_leave, methods=["POST"])
    router.add_api_route("/families/kick", families_kick, methods=["POST"])
    router.add_api_route("/families/assign-role", families_assign_role, methods=["POST"])
    router.add_api_route("/families/deposit", families_deposit, methods=["POST"])
    router.add_api_route("/families/withdraw", families_withdraw, methods=["POST"])
    router.add_api_route("/families/bullets/give", families_give_bullets, methods=["POST"])
    router.add_api_route("/families/bullets/split-all", families_split_all_bullets, methods=["POST"])
    router.add_api_route("/families/compound/deposit", families_compound_deposit, methods=["POST"])
    router.add_api_route("/families/compound/withdraw", families_compound_withdraw, methods=["POST"])
    router.add_api_route("/families/compound/return-to-member", families_compound_return_to_member, methods=["POST"])
    router.add_api_route("/families/compound/claim-for-family", families_compound_claim_for_family, methods=["POST"])
    router.add_api_route("/families/crew-oc/set-fee", families_crew_oc_set_fee, methods=["POST"])
    router.add_api_route("/families/crew-oc/set-auto-accept", families_crew_oc_set_auto_accept, methods=["POST"])
    router.add_api_route("/families/profile-text", families_update_profile_text, methods=["PATCH"])
    router.add_api_route("/families/avatar", families_update_avatar, methods=["PATCH"])
    router.add_api_route("/families/crew-oc/advertise", families_crew_oc_advertise, methods=["POST"])
    router.add_api_route("/families/crew-oc/apply", families_crew_oc_apply, methods=["POST"])
    router.add_api_route("/families/crew-oc/applications", families_crew_oc_applications, methods=["GET"])
    router.add_api_route("/families/crew-oc/applications/{application_id}/accept", families_crew_oc_accept, methods=["POST"])
    router.add_api_route("/families/crew-oc/applications/{application_id}/reject", families_crew_oc_reject, methods=["POST"])
    router.add_api_route("/families/crew-oc/applications/{application_id}/kick", families_crew_oc_kick, methods=["POST"])
    router.add_api_route("/families/crew-oc/commit", families_crew_oc_commit, methods=["POST"])
    router.add_api_route("/families/rackets/{racket_id}/collect", families_racket_collect, methods=["POST"])
    router.add_api_route("/families/rackets/{racket_id}/unlock", families_racket_unlock, methods=["POST"])
    router.add_api_route("/families/rackets/{racket_id}/upgrade", families_racket_upgrade, methods=["POST"])
    router.add_api_route("/families/racket-attack-targets", families_racket_attack_targets, methods=["GET"])
    router.add_api_route("/families/attack-racket", families_attack_racket, methods=["POST"])
    router.add_api_route("/families/war", families_war, methods=["GET"])
    router.add_api_route("/families/war/stats", families_war_stats, methods=["GET"])
    router.add_api_route("/families/war/{war_id}/feed", families_war_feed, methods=["GET"])
    router.add_api_route("/families/war/{war_id}/stats", families_war_public_stats, methods=["GET"])
    router.add_api_route("/families/war/truce/offer", families_war_truce_offer, methods=["POST"])
    router.add_api_route("/families/war/truce/accept", families_war_truce_accept, methods=["POST"])
    router.add_api_route("/families/wars/history", families_wars_history, methods=["GET"])
    router.add_api_route("/families/state-takeover/accept", state_takeover_accept, methods=["POST"])
    router.add_api_route("/families/state-takeover/reject", state_takeover_reject, methods=["POST"])
