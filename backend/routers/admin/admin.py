# Admin: ghost mode, act-as-normal, change-rank, add-points, give-all, add-car,
# security (summary, flags, rate-limits, telegram, clear), hitlist reset,
# force-online, lock/kill player, search time, clear searches, check, activity/gambling log,
# find-duplicates, cheat-detection, user-details, events, seed-families, create-test-users.
import asyncio
import ipaddress
import logging
import os
import random
import re
import uuid
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx
from fastapi import Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from middleware.security import is_proxy_or_vpn, get_ip_info
from utils.disposable_email import is_disposable_email
from utils.referral_ids import normalize_referred_by_ids
from utils.ip_normalize import normalize_ip_string
from utils.analytics_events import VALID_BUCKETS, bucket_start
from utils.cheat_detection_utils import (
    group_by_domain,
    group_by_similar_username_strip_digits,
    group_by_fuzzy_username,
    group_by_similar_email,
    group_by_same_day_same_ip,
    group_by_same_subnet,
    group_by_registration_ip_burst,
    group_by_referral_same_ip,
    user_ip_union,
    compute_dupe_risk_score,
)
from routers.kill.armoury import TOKEN_CONFIG
from utils.release_soft_launch import (
    DEFAULT_GAME_PASS_UNLOCK_AT,
    RELEASE_SOFT_LAUNCH_KEY,
    get_release_soft_launch_public,
)
from utils.game_pass_season import (
    GAME_PASS_SEASON_SETTINGS_KEY,
    get_game_pass_season_public,
    normalize_game_pass_season_end_at,
)
from utils.point_provenance import (
    chargeback_preview,
    execute_chargeback_best_effort,
    ensure_user_legacy_seed_lot,
    consume_points_fifo,
    log_points_event,
)
from utils.claim_costs import (
    CLAIM_COSTS_SETTINGS_KEY,
    invalidate_claim_costs_cache,
    load_claim_costs,
    merge_claim_costs,
)
from utils.keno_settings import (
    DEFAULT_KENO_MAX_BET,
    KENO_MAX_BET_SETTINGS_KEY,
    invalidate_keno_max_bet_cache,
    load_keno_max_bet,
)
from utils.bank_economy_settings import (
    get_bank_economy_config,
    compute_bank_interest_previews,
    normalize_interest_options,
    KEY_SWISS_DEFAULT,
    KEY_INTEREST_MAX,
    KEY_INTEREST_OPTIONS,
)
from utils.email_sender import is_email_configured, send_inactivity_reminder_email
from utils.staff_portal import staff_portal_password_configured, staff_portal_session_minutes
from utils.sustained_page_ratelimit import (
    _kill_sustain_setting_enabled,
    clamp_kill_rl_max_gap_ms,
    clamp_kill_rl_sustain_sec,
)

# Cloudflare API config for bot blocking toggle
CF_ZONE_ID = os.environ.get("CF_ZONE_ID", "")
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "")

# Mod-visible admin categories: which Admin Tool categories moderators can see (configurable by admin)
MOD_VISIBLE_CATEGORY_IDS_DEFAULT = [
    "admin-operations",
    "admin-economy-progression",
    "admin-world-systems",
    "admin-analytics-monitoring",
]
ADMIN_CATEGORY_IDS = {
    "admin-players",
    "admin-moderation",
    "admin-donations",
    "admin-gameworld",
    "admin-security",
    "admin-cheat",
    "admin-analytics",
    "admin-logs",
    "admin-testing",
    "admin-quick",
    "admin-database",
    "admin-staff",
    "admin-mod-tools",
    "admin-operations",
    "admin-economy-progression",
    "admin-world-systems",
    "admin-analytics-monitoring",
}


class AdminQuicktradeReason(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class AdminQuicktradeCasinoDedupeBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)
    dry_run: bool = False


class AdminRacingCrewBankAdjustBody(BaseModel):
    """Positive amount adds to the player's Bootleg crew bank; negative removes."""

    target_username: str = Field(..., min_length=1, max_length=80)
    amount: int = Field(..., ge=-2_000_000_000_000, le=2_000_000_000_000, description="Signed delta on racing_profiles.crew_bank")


class EventsToggleRequest(BaseModel):
    enabled: bool




class HealPreregReferralsRequest(BaseModel):
    """Backfill referred_by from preregistrations.referral_code for accounts that missed it at signup."""
    dry_run: bool = True
    max_scan: int = Field(2000, ge=1, le=10000)
    max_detail_rows: int = Field(500, ge=0, le=2000)


class ManualReferralAssignRequest(BaseModel):
    """Admin: set referee account as referred by referrer (same perks as signup where applicable)."""
    referee_username: str
    referrer_username: str
    force: bool = False
    grant_referee_signup_bonuses: bool = True
    grant_referrer_welcome_respect: int = Field(500, ge=0, le=5000)


class ManualReferralRemoveRequest(BaseModel):
    """Admin: remove referral link(s) from a referee. Omit referrer_username to clear all referrers."""
    referee_username: str
    referrer_username: Optional[str] = None  # if set, remove only this referrer from the list


class RedeemCodeRewards(BaseModel):
    money: Optional[int] = None
    points: Optional[int] = None
    respect_points: Optional[int] = None
    loot_box_pieces: Optional[int] = None
    cars: Optional[List[str]] = None
    tokens: Optional[Dict[str, int]] = None  # token_type -> amount


class RedeemCodeCreateRequest(BaseModel):
    code: str
    max_uses: Optional[int] = None  # null = unlimited
    rewards: RedeemCodeRewards = Field(default_factory=RedeemCodeRewards)


class RedeemCodePatchRequest(BaseModel):
    active: bool


class BetaSignupToggleRequest(BaseModel):
    enabled: bool


class AdminBankInterestOptionIn(BaseModel):
    hours: int
    rate: float


class AdminSettingsUpdate(BaseModel):
    admin_online_color: Optional[str] = None
    mod_default_online_color: Optional[str] = None  # default colour for Mod on Users Online (mods can override on profile)
    require_email_verification: Optional[bool] = None
    block_proxy_vpn_login: Optional[bool] = None
    block_script_user_agent_login: Optional[bool] = None  # UA + browser-like checks: auth + minigame routes
    block_script_user_agent_game_actions: Optional[bool] = None  # UA checks: crimes, GTA, jail, OC, bodyguards, attack
    game_actions_client_strict: Optional[bool] = None  # Stricter Sec-Fetch / Accept on game-action API writes (main doc)
    game_actions_turnstile_enabled: Optional[bool] = None  # Turnstile on selected gameplay POSTs (GTA melt, booze sell); uses minigame site key
    minigame_turnstile_enabled: Optional[bool] = None  # Cloudflare Turnstile before minigame run start
    minigame_turnstile_site_key: Optional[str] = None  # Public site key (secret stays in TURNSTILE_SECRET_KEY env)
    login_turnstile_enabled: Optional[bool] = None  # Turnstile on /auth/login; reuses site key above
    sustained_page_rl_jail_enabled: Optional[bool] = None  # Jail-style pacing (~750ms gap chain, ~22s sustain -> 10–15s cooldown)
    sustained_page_rl_entertainer_enabled: Optional[bool] = None  # Entertainer forum API (player routes)
    sustained_page_rl_forum_enabled: Optional[bool] = None  # Forum API
    sustained_page_rl_kill_enabled: Optional[bool] = None  # Kill / attack `/attack/*` POSTs (~300ms gap chain; ~12s sustain→cooldown); default on if unset
    sustained_page_rl_kill_max_gap_ms: Optional[float] = None  # Max gap (ms) between kill POSTs in a fast chain; clamped 50–2000; default 300 when unset
    sustained_page_rl_kill_sustain_sec: Optional[float] = None  # Wall-clock seconds in chain before cooldown; clamped 3–120; default 12 when unset
    sustained_page_rl_gta_enabled: Optional[bool] = None  # GTA GETs (jail-style math)
    sustained_page_rl_crimes_enabled: Optional[bool] = None  # Crimes list/stats/logs GETs (jail-style)
    sustained_page_rl_oc_enabled: Optional[bool] = None  # OC config/status GETs (jail-style)
    sustained_page_rl_booze_enabled: Optional[bool] = None  # Booze run config GET (jail-style)
    sustained_page_rl_game_chat_enabled: Optional[bool] = None  # Game chat messages/prefs GETs (jail-style)
    sustained_page_rl_store_enabled: Optional[bool] = None  # Store/points-related GETs (jail-style)
    sustained_page_rl_ranking_enabled: Optional[bool] = None  # Rank progress GET (jail-style)
    sustained_page_rl_notifications_enabled: Optional[bool] = None  # Inbox / notification list GETs (jail-style)
    sustained_page_rl_hitlist_enabled: Optional[bool] = None  # Hitlist GETs (jail-style)
    sustained_page_rl_bank_enabled: Optional[bool] = None  # Bank meta/overview GETs (jail-style)
    sustained_page_rl_leaderboard_enabled: Optional[bool] = None  # Leaderboard GETs (jail-style)
    sustained_page_rl_families_enabled: Optional[bool] = None  # Families / crew GETs (jail-style)
    sustained_page_rl_stock_market_enabled: Optional[bool] = None  # Stock market GETs (jail-style)
    sustained_page_rl_quicktrade_enabled: Optional[bool] = None  # Quick trade listing GETs (jail-style)
    sustained_page_rl_properties_enabled: Optional[bool] = None  # Properties GETs (jail-style)
    sustained_page_rl_armoury_enabled: Optional[bool] = None  # Armoury / inventory GETs (jail-style)
    sustained_page_rl_bodyguards_enabled: Optional[bool] = None  # Bodyguards GETs (jail-style)
    sustained_page_rl_missions_enabled: Optional[bool] = None  # Missions GETs (jail-style)
    sustained_page_rl_travel_enabled: Optional[bool] = None  # Travel / airports GETs (jail-style)
    sustained_page_rl_events_enabled: Optional[bool] = None  # Events / flash news GETs (jail-style)
    spotify_feature_enabled: Optional[bool] = None
    stock_market_max_points: Optional[int] = None
    sports_bet_max_total_open_stake: Optional[int] = None  # Max $ in open sports bets per user (default 25M)
    landing_banner_enabled: Optional[bool] = None
    landing_banner_message: Optional[str] = None
    login_lock_from: Optional[str] = None  # ISO datetime - start blocking logins from this date
    login_lock_until: Optional[str] = None  # ISO datetime - stop blocking logins after this date
    login_lock_message: Optional[str] = None  # Custom message shown on login page during lock
    preregister_landing_banner_enabled: Optional[bool] = None  # Slim banner on / login when login lock active (founding / ref info)
    preregister_landing_banner_preview_open: Optional[bool] = None  # Show same strip while logins are open (staff preview)
    preorder_points_release_date: Optional[str] = None  # ISO datetime - points held until this date
    store_points_auto_credit: Optional[bool] = None  # False = staff credits store points manually after payment
    store_points_manual_credit_eta: Optional[str] = None  # ISO datetime shown to users (informational)
    casino_global_max_bet: Optional[int] = None  # Max bet cap for all casinos (default 1B)
    casino_buyback_max_points: Optional[int] = None  # Max points for buy-back reward (default 15000)
    mp_poker_max_blind: Optional[int] = None  # Max MP poker small blind cap (default 2.5M)
    mod_visible_category_ids: Optional[List[str]] = None  # Admin Tool category ids visible to moderators
    bank_swiss_default_limit: Optional[int] = None  # Swiss cap default in game_settings: new signups, bank fallback, apply-to-all source
    bank_interest_max_unclaimed_principal: Optional[int] = None  # Max total $ in unclaimed interest deposits per user
    bank_interest_options: Optional[List[AdminBankInterestOptionIn]] = None  # Term structure: hours + rate (fractional, e.g. 0.025 = 2.5%)


class AdminMissionProgressSetRequest(BaseModel):
    """1-based ladder index of the next mission to complete (same order as in-game missions UI). 101 = all 100 done."""

    next_mission_display: int
    grant_skipped_rewards: bool = True  # When advancing, grant normal completion rewards for each newly completed mission


class AdminKenoSettingsPatch(BaseModel):
    """Live cap for state Keno max bet per round (stored in game_settings)."""

    max_bet: int


class AdminClaimCostsPatch(BaseModel):
    """Partial update for property/casino claim costs (cash/points in dollars / whole points)."""

    dice_cash: Optional[int] = None
    dice_points: Optional[int] = None
    roulette: Optional[int] = None
    blackjack: Optional[int] = None
    horseracing: Optional[int] = None
    video_poker: Optional[int] = None
    airport: Optional[int] = None
    armoury: Optional[int] = None


class TestUsersAutoRankRequest(BaseModel):
    enabled: bool


class GTAExclusivePoolRequest(BaseModel):
    """Release or retract the Al Capone exclusive (car20) into the GTA car pool. Only 1 in game at a time. drop_weight w ⇒ P(exclusive | successful steal) = w/(1+w), same for every GTA tier."""
    released: bool
    drop_weight: Optional[float] = None


class EditCarValueRequest(BaseModel):
    car_id: str
    value: int
    travel_bonus: Optional[int] = None

class GiveEveryoneExclusiveCarsRequest(BaseModel):
    """Give every user a car they don't already have. loot_exclusive = car21, al_capone = car20."""
    loot_exclusive: bool = False
    al_capone: bool = False


class AdminChangeEmailRequest(BaseModel):
    new_email: str


class AdminSetPasswordRequest(BaseModel):
    new_password: str


class AdminRevokeSessionRequest(BaseModel):
    target_username: str
    session_id: str


class AdminRevokeOldSessionsRequest(BaseModel):
    """Optional target_username: if set, only revoke old sessions for that user; otherwise all users."""
    target_username: Optional[str] = None


class DropUserCasinoRequest(BaseModel):
    user_id: str
    game_type: str  # dice, roulette, blackjack, horseracing, videopoker, slots
    location: str   # city for most, state for slots


class TakeoverUserCasinoRequest(BaseModel):
    """Reassign a casino from one player to another (default: acting admin). Admin only."""

    user_id: str  # current owner (from)
    game_type: str
    location: str  # city for most, state for slots
    to_username: Optional[str] = None  # if blank/None, new owner is current admin user


class DropUserCasinosPropertiesRequest(BaseModel):
    user_id: str


class ClearUserJailBustRewardRequest(BaseModel):
    user_id: str


class InactivityReminderEmailRequest(BaseModel):
    user_id: str


class InactivityReminderBulkEmailRequest(BaseModel):
    user_ids: List[str]


class AdminPresenceHeartbeatRequest(BaseModel):
    """Browser tab id (uuid) so one staff user can have multiple admin sessions listed separately."""
    tab_id: str = Field(..., min_length=8, max_length=80)
    section: Optional[str] = None  # e.g. overview, players, users-online
    path: Optional[str] = None  # e.g. /staffrole/admin/overview


class AdminToolAccessShellOpenRequest(BaseModel):
    """SPA route when staff shell becomes usable (one shot per tab from frontend)."""
    path: Optional[str] = Field(default=None, max_length=500)


class AdminToolAccessSpaUnauthorizedRequest(BaseModel):
    """Full SPA location when a non-staff account opened /staffrole/admin (path, query, hash) for audit + staff inbox."""
    path: Optional[str] = Field(default=None, max_length=2048)


class DeleteFamilyRequest(BaseModel):
    family_id: str


class AdminSetCasinoMaxBetRequest(BaseModel):
    game_type: str  # dice, roulette, blackjack, horseracing, videopoker, slots, or "all"
    location: Optional[str] = None  # city/state; if None, applies to all locations for that game type
    max_bet: int


class CrackSafeJackpotSetRequest(BaseModel):
    jackpot: int = Field(ge=0, description="New Crack the Safe jackpot in dollars")


class ForumMuteRequest(BaseModel):
    target_username: str
    duration_hours: Optional[int] = None  # set one of duration_hours, duration_days, or permanent
    duration_days: Optional[int] = None
    permanent: bool = False
    reason: Optional[str] = None


class GameChatMuteRequest(BaseModel):
    target_username: str
    muted: bool  # True = mute, False = unmute
    muted_until: Optional[str] = None  # ISO datetime; if set, mute expires at this time (optional; omit for permanent)


class PageLockUpdate(BaseModel):
    path: str
    message: Optional[str] = None
    locked: bool
    unlock_at: Optional[str] = None  # ISO datetime; lock auto-expires when past


class ChargebackRequest(BaseModel):
    payment_session_id: str


class ToastEventIngestRequest(BaseModel):
    toast_type: str = Field(default="default", max_length=32)
    message: str = Field(default="", max_length=500)
    description: Optional[str] = Field(default=None, max_length=1000)
    route_path: Optional[str] = Field(default=None, max_length=500)
    duration_ms: Optional[int] = Field(default=None, ge=0, le=120000)
    client_created_at: Optional[str] = Field(default=None, max_length=64)
    metadata: Optional[Dict[str, Any]] = None


# Seed configs (all may be created; families get player_cap_exempt and do not count toward player crew cap).
SEED_FAMILIES_CONFIG = [
    {"name": "Corleone", "tag": "CORL"},
    {"name": "Baranco", "tag": "BARN"},
    {"name": "Stracci", "tag": "STRC"},
    {"name": "Tattaglia", "tag": "TATT"},
    {"name": "Cuneo", "tag": "CUNO"},
    {"name": "Bruno", "tag": "BRUN"},
    {"name": "Molinaro", "tag": "MOLI"},
    {"name": "Zaluchi", "tag": "ZALU"},
    {"name": "Falcone", "tag": "FALC"},
    {"name": "Mariposa", "tag": "MARI"},
]
SEED_RANK_POINTS_BY_ROLE = {"boss": 24000, "underboss": 12000, "consigliere": 6000, "capo": 3000, "soldier": 1000, "associate": 500}
SEED_RACKETS_BY_FAMILY = {
    "Corleone": {"protection": 2, "gambling": 1, "loansharking": 1, "labour": 1},
    "Baranco": {"protection": 1, "gambling": 2, "loansharking": 1, "labour": 1},
    "Stracci": {"protection": 1, "gambling": 1, "loansharking": 1, "labour": 2},
}
SEED_TREASURY = 75_000
SEED_TEST_PASSWORD = "test1234"

# Bodyguard admin audit: hitlist_bodyguard_events types (excludes pure hitlist_* rows).
BODYGUARD_AUDIT_HITLIST_TYPES = frozenset(
    {
        "bodyguard_hired",
        "bodyguard_dropped",
        "bodyguard_invite_sent",
        "bodyguard_invite_accepted",
        "bodyguard_invite_declined",
        "bodyguard_invite_cancelled",
        "bodyguard_armour_upgrade",
        "bodyguard_slot_bought",
        "bodyguard_killed",
        "admin_robot_bodyguards_replaced",
    }
)


def _wallet_mdg_parse_origin_ref(ref: str) -> Tuple[Optional[str], Optional[str]]:
    if not ref or ":" not in ref:
        return None, None
    act, gid = ref.split(":", 1)
    act = act.strip().lower()
    gid = gid.strip()
    if act in ("create", "join", "payout", "refund") and gid:
        return act, gid
    return None, None


def _wallet_mdg_ref_from_gambling_details(d: Dict[str, Any]) -> Optional[str]:
    if not isinstance(d, dict):
        return None
    act = str(d.get("action") or "").strip().lower()
    gid = str(d.get("game_id") or "").strip()
    if act in ("create", "join", "payout", "refund") and gid:
        return f"{act}:{gid}"
    return None


def _wallet_mdg_collect_game_ids_from_merged(merged: List[Dict[str, Any]]) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for e in merged:
        src = e.get("source")
        gid = ""
        if src == "mdg":
            gl = (e.get("raw") or {}).get("gambling_log") or {}
            det = gl.get("details") if isinstance(gl.get("details"), dict) else {}
            gid = str(det.get("game_id") or "").strip()
        elif src == "point_ledger":
            raw = e.get("raw") or {}
            if str(raw.get("event_type") or "") != "casino_mdg":
                continue
            meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
            gid = str(meta.get("game_id") or "").strip()
            if not gid:
                _, g2 = _wallet_mdg_parse_origin_ref(str(raw.get("origin_ref") or ""))
                gid = (g2 or "").strip()
        if gid and gid not in seen:
            seen.add(gid)
            out.append(gid)
    return out


def _wallet_mdg_collapse_ledger_pairs(merged: List[Dict[str, Any]], viewer_uid: str) -> None:
    """Fold casino_mdg point_ledger legs into the sibling gambling_log row (same origin_ref); drop duplicate ledger rows."""
    absorb: Set[int] = set()
    for i, e in enumerate(merged):
        if e.get("source") != "mdg":
            continue
        raw_gl = (e.get("raw") or {}).get("gambling_log") or {}
        det = raw_gl.get("details") if isinstance(raw_gl.get("details"), dict) else {}
        ref = _wallet_mdg_ref_from_gambling_details(det)
        if not ref:
            continue
        ts = float(e.get("created_ts") or 0)
        for j, e2 in enumerate(merged):
            if j == i or j in absorb or e2.get("source") != "point_ledger":
                continue
            r2 = e2.get("raw") or {}
            if str(r2.get("event_type") or "") != "casino_mdg":
                continue
            if str(r2.get("user_id") or "") != str(viewer_uid):
                continue
            if str(r2.get("origin_ref") or "") != ref:
                continue
            if abs(float(e2.get("created_ts") or 0) - ts) > 25.0:
                continue
            wb = r2.get("wallet_points_before")
            wa = r2.get("wallet_points_after")
            if wb is not None:
                merged[i]["wallet_points_before"] = wb
            if wa is not None:
                merged[i]["wallet_points_after"] = wa
            absorb.add(j)
            break
    if absorb:
        merged[:] = [e for k, e in enumerate(merged) if k not in absorb]


def _wallet_mdg_narrative(viewer_id: str, game: Dict[str, Any], det: Dict[str, Any], act: str) -> Tuple[str, str, str]:
    """Return (title, summary, counterparty) for an MDG wallet row."""
    gid_short = str(det.get("game_id") or "")[:8] or "?"
    creator = str(game.get("created_by_username") or "?")
    max_p = game.get("max_players")
    max_s = str(max_p) if max_p is not None else "?"
    status = str(game.get("status") or "")
    winner_id = str(game.get("winner_id") or "")
    winner_name = str(game.get("winner_username") or "?")
    fee_pts = int(det.get("fee_points") or 0)
    fee_money = float(det.get("fee_money") or 0)
    extra_pts = int(det.get("extra_pot_points") or 0)
    extra_money = float(det.get("extra_pot_money") or 0)
    players_after = det.get("players_after")
    if players_after is None and isinstance(game.get("entries"), list):
        players_after = len(game.get("entries") or [])
    pa_s = str(players_after) if players_after is not None else "?"
    pot_pts = int(det.get("pot_points") or 0)
    pot_money = float(det.get("pot_money") or 0)
    trig = str(det.get("trigger") or "")

    outcome = ""
    if status == "completed" and winner_id:
        if viewer_id == winner_id:
            outcome = " Result: you won this game."
        else:
            outcome = f" Result: you did not win (winner: {winner_name})."
    elif status == "open":
        outcome = " Result: table still open in DB snapshot."
    elif not game:
        outcome = ""

    counterparty = f"{creator} · …{gid_short}" if gid_short != "?" else creator

    if act == "create":
        title = "MDG · you created a table"
        bits = ["You opened a new MDG table (you are the host)."]
        bits.append(f"Entry cost **{fee_pts:,}** pts" + (f" + **${fee_money:,.0f}** cash" if fee_money else "") + ".")
        if extra_pts or extra_money:
            bits.append(f"Extra pot **{extra_pts:,}** pts" + (f" + **${extra_money:,.0f}** cash" if extra_money else "") + ".")
        bits.append(f"Max **{max_s}** players; you count as player 1.")
        return title, "".join(bits) + outcome, counterparty

    if act == "join":
        title = f"MDG · joined {creator}'s table"
        bits = [
            f"You joined **{creator}'s** MDG.",
            f" Lobby had **{pa_s}** player(s) after you joined (max **{max_s}**).",
            f" Paid **{fee_pts:,}** pts" + (f" + **${fee_money:,.0f}** cash" if fee_money else "") + " to enter.",
        ]
        return title, "".join(bits) + outcome, counterparty

    if act == "payout":
        title = "MDG · you won the pot"
        bits = [
            f"You **won** the MDG pot created by **{creator}**.",
            f" Payout **+{pot_pts:,}** pts" + (f" + **${pot_money:,.0f}** cash" if pot_money else "") + ".",
        ]
        if trig:
            bits.append(f" Roll trigger: **{trig}**.")
        return title, "".join(bits), counterparty

    if act == "refund":
        title = "MDG · join fee refunded"
        summary = (
            f"Your join fee (**{fee_pts:,}** pts) was refunded — the table was full or your join raced another request."
            + outcome
        )
        return title, summary, counterparty

    return f"MDG · {act or 'event'}", f"Game …{gid_short} · action {act}" + outcome, counterparty


def _wallet_mdg_enrich_merged_entries(merged: List[Dict[str, Any]], viewer_id: str, games_by_id: Dict[str, Any]) -> None:
    for e in merged:
        src = e.get("source")
        det: Dict[str, Any] = {}
        gid = ""
        act = ""
        if src == "mdg":
            gl = (e.get("raw") or {}).get("gambling_log") or {}
            det = dict(gl.get("details") or {}) if isinstance(gl.get("details"), dict) else {}
            gid = str(det.get("game_id") or "").strip()
            act = str(det.get("action") or "").strip().lower()
        elif src == "point_ledger":
            raw = e.get("raw") or {}
            if str(raw.get("event_type") or "") != "casino_mdg":
                continue
            meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
            act, gid = _wallet_mdg_parse_origin_ref(str(raw.get("origin_ref") or ""))
            if not act:
                act = str(meta.get("action") or "").lower()
            if not gid:
                gid = str(meta.get("game_id") or "").strip()
            pts_raw = int(raw.get("points") or 0)
            det: Dict[str, Any] = {"action": act, "game_id": gid}
            oref = str(raw.get("origin_ref") or "")
            if oref.startswith("payout:") or act == "winner_payout":
                det["action"] = "payout"
                act = "payout"
                det["pot_points"] = pts_raw if pts_raw > 0 else int(meta.get("pot_points") or 0)
                det["pot_money"] = float(meta.get("pot_money") or 0)
                det["trigger"] = str(meta.get("trigger") or "")
            elif oref.startswith("refund:") or act == "join_refund":
                det["action"] = "refund"
                act = "refund"
                det["fee_points"] = int(meta.get("fee_points") or abs(pts_raw))
            elif oref.startswith("join:") or act == "join_fee":
                det["action"] = "join"
                act = "join"
                det["fee_points"] = int(meta.get("fee_points") or (abs(pts_raw) if pts_raw < 0 else pts_raw))
                det["fee_money"] = float(meta.get("fee_money") or 0)
            elif oref.startswith("create:") or act == "create_fee":
                det["action"] = "create"
                act = "create"
                det["fee_points"] = int(meta.get("fee_points") or 0)
                det["extra_pot_points"] = int(meta.get("extra_pot_points") or 0)
                if det["fee_points"] == 0 and pts_raw < 0:
                    det["fee_points"] = abs(pts_raw)
            else:
                det["fee_points"] = abs(pts_raw)
        else:
            continue
        if not gid:
            continue
        game = games_by_id.get(gid) or {}
        title, summary, cp = _wallet_mdg_narrative(viewer_id, game, det, act)
        e["title"] = title
        e["summary"] = summary
        if cp:
            e["counterparty"] = cp


# --- Economy spike audit (GET /admin/audit/economy-spikes) ---

ACTIVITY_ACTIONS_FOR_SPIKE_AUDIT: Set[str] = {
    "lottery_win",
    "attack_kill",
    "bank_transfer",
    "bank_interest_claim",
    "bank_deposit",
    "swiss_deposit",
    "swiss_withdraw",
    "property_collect",
    "booze_sell",
    "family_withdraw",
    "family_deposit",
    "speakeasy_collect",
    "racket_extort",
    "lottery_buy",
    "armoury_buy_bullets",
    "armoury_buy_armour",
    "gta_repair",
    "gta_attempt",
    "illegal_biz_raid",
    "oc_execute",
    "jail_bust",
    "bodyguard_hire",
    "property_buy",
    "stock_sell",
    "stock_buy",
    "admin_adjust_money",
    "admin_swiss_bank_wipe",
    "admin_racing_crew_bank_adjust",
    "store_purchase",
}


def _spike_parse_created_at(val: Any) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    if isinstance(val, str):
        try:
            s = val.strip().replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return None
    return None


def _activity_log_extract_spike_amounts(action: str, details: Any) -> Tuple[Optional[float], Optional[float]]:
    """Return (max_abs_cash_field, max_abs_points_field) for thresholding; None if not applicable."""
    if not isinstance(details, dict):
        return None, None
    a = (action or "").strip().lower()
    d = details

    def num(x: Any) -> Optional[float]:
        if x is None:
            return None
        try:
            return float(x)
        except (TypeError, ValueError):
            return None

    cash_vals: List[float] = []
    pt_vals: List[float] = []

    def take_cash(*keys: str) -> None:
        for k in keys:
            v = num(d.get(k))
            if v is not None and v != 0:
                cash_vals.append(abs(v))

    def take_pts(*keys: str) -> None:
        for k in keys:
            v = num(d.get(k))
            if v is not None and v != 0:
                pt_vals.append(abs(v))

    if a == "lottery_win":
        take_cash("payout")
    elif a == "attack_kill":
        take_cash("cash_loot")
    elif a == "bank_transfer":
        take_cash("amount")
    elif a == "bank_interest_claim":
        take_cash("total", "interest", "principal")
    elif a in ("bank_deposit", "swiss_deposit", "swiss_withdraw"):
        take_cash("amount")
    elif a == "property_collect":
        take_cash("income")
    elif a == "booze_sell":
        take_cash("profit", "revenue")
    elif a in ("family_withdraw", "family_deposit"):
        take_cash("cash")
    elif a == "speakeasy_collect":
        take_cash("cash")
    elif a == "racket_extort":
        take_cash("cash", "amount")
    elif a == "lottery_buy":
        take_cash("spent")
    elif a == "armoury_buy_bullets":
        take_cash("cost")
    elif a == "armoury_buy_armour":
        take_cash("cost", "price")
    elif a == "gta_repair":
        take_cash("cost")
    elif a == "gta_attempt":
        take_cash("reward_cash", "cash", "payout")
    elif a == "illegal_biz_raid":
        take_cash("cash", "loot_cash", "loot_money")
    elif a == "oc_execute":
        take_cash("cash", "payout", "reward_cash")
    elif a == "jail_bust":
        take_cash("cash", "reward", "amount")
    elif a == "bodyguard_hire":
        take_cash("cash", "cost")
        take_pts("points")
    elif a == "property_buy":
        take_cash("cost")
    elif a == "stock_sell":
        take_pts("profit_points", "value_points")
    elif a == "stock_buy":
        take_pts("points")
    elif a == "admin_adjust_money":
        take_cash("amount")
    elif a == "admin_racing_crew_bank_adjust":
        take_cash("amount")
    elif a == "admin_swiss_bank_wipe":
        take_cash("old_balance")
    elif a == "store_purchase":
        take_cash("cost")
        take_pts("points_spent")
    elif a.startswith("minigame_"):
        take_cash("cash")
        take_pts("respect")

    cmax = max(cash_vals) if cash_vals else None
    pmax = max(pt_vals) if pt_vals else None
    return cmax, pmax


def _activity_wallet_signed_cash_delta(action: str, details: Any) -> Optional[float]:
    """Signed change to on-hand wallet (users.money) when inferrable from activity_log details; else None."""
    if not isinstance(details, dict):
        return None
    a = (action or "").strip().lower()
    d = details

    def n(x: Any) -> Optional[float]:
        if x is None:
            return None
        try:
            return float(x)
        except (TypeError, ValueError):
            return None

    if a == "lottery_win":
        return n(d.get("payout"))
    if a == "attack_kill":
        return n(d.get("cash_loot"))
    if a == "bank_transfer":
        v = n(d.get("amount"))
        return -v if v is not None else None
    if a == "bank_interest_claim":
        t = n(d.get("total"))
        if t is not None:
            return t
        ip = n(d.get("interest"))
        pr = n(d.get("principal"))
        if ip is not None or pr is not None:
            return (ip or 0) + (pr or 0)
        return None
    if a == "bank_deposit":
        v = n(d.get("amount"))
        return -v if v is not None else None
    if a == "swiss_deposit":
        v = n(d.get("amount"))
        return -v if v is not None else None
    if a == "swiss_withdraw":
        return n(d.get("amount"))
    if a == "property_collect":
        return n(d.get("income"))
    if a == "booze_sell":
        pr = n(d.get("profit"))
        if pr is not None:
            return pr
        return n(d.get("revenue"))
    if a == "family_withdraw":
        return n(d.get("cash"))
    if a == "family_deposit":
        v = n(d.get("cash"))
        return -v if v is not None else None
    if a == "speakeasy_collect":
        return n(d.get("cash"))
    if a == "racket_extort":
        for k in ("cash", "amount"):
            v = n(d.get(k))
            if v is not None:
                return v
        return None
    if a == "lottery_buy":
        v = n(d.get("spent"))
        return -v if v is not None else None
    if a == "armoury_buy_bullets":
        v = n(d.get("cost"))
        return -v if v is not None else None
    if a == "armoury_buy_armour":
        for k in ("cost", "price"):
            v = n(d.get(k))
            if v is not None:
                return -v
        return None
    if a == "gta_repair":
        v = n(d.get("cost"))
        return -v if v is not None else None
    if a == "gta_attempt":
        for k in ("reward_cash", "payout", "cash"):
            v = n(d.get(k))
            if v is not None:
                return v
        return None
    if a == "illegal_biz_raid":
        best: Optional[float] = None
        for k in ("loot_cash", "loot_money", "cash"):
            v = n(d.get(k))
            if v is not None and v > 0:
                best = v if best is None else max(best, v)
        return best
    if a == "oc_execute":
        for k in ("cash", "payout", "reward_cash"):
            v = n(d.get(k))
            if v is not None:
                return v
        return None
    if a == "jail_bust":
        for k in ("cash", "reward", "amount"):
            v = n(d.get(k))
            if v is not None:
                return v
        return None
    if a == "bodyguard_hire":
        for k in ("cash", "cost"):
            v = n(d.get(k))
            if v is not None:
                return -v
        return None
    if a == "property_buy":
        v = n(d.get("cost"))
        return -v if v is not None else None
    if a == "admin_adjust_money":
        return n(d.get("amount"))
    if a == "admin_swiss_bank_wipe":
        return None
    if a == "store_purchase":
        v = n(d.get("cost"))
        return -v if v is not None else None
    if a.startswith("minigame_"):
        return n(d.get("cash"))
    return None


def _activity_log_row_matches_spike_whitelist(action: str) -> bool:
    a = (action or "").strip().lower()
    if a in ACTIVITY_ACTIONS_FOR_SPIKE_AUDIT:
        return True
    return a.startswith("minigame_")


def _economy_event_extract_spike(doc: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    """Rough (type, payout/spent) extraction for economy_events."""
    t = str(doc.get("type") or "").lower()
    if t == "lottery_draw":
        v = doc.get("payout")
        try:
            return (float(v), None) if v is not None else (None, None)
        except (TypeError, ValueError):
            return None, None
    if t == "lottery_buy":
        v = doc.get("spent")
        try:
            return (float(v), None) if v is not None else (None, None)
        except (TypeError, ValueError):
            return None, None
    return None, None


def register(router):
    """Register admin routes. Dependencies from server to avoid circular imports."""
    import server as srv
    from routers.account.auth import (
        apply_manual_referral_link,
        apply_manual_referral_remove,
        try_heal_referral_from_prereg,
    )
    from routers.game import leaderboard as leaderboard_module
    import middleware.security as security_module
    from routers.game.families import FAMILY_RACKETS
    from routers.kill.bodyguards import _create_robot_bodyguard_user
    from routers.social.forum import create_redeem_code_forum_topic, remove_redeem_code_forum_topic
    from bson import ObjectId
    from bson.errors import InvalidId
    from routers.money import lottery as lottery_audit_mod

    db = srv.db
    log_respect_delta = srv.log_respect_delta
    get_current_user = srv.get_current_user
    send_notification = srv.send_notification
    send_notification_to_all = srv.send_notification_to_all
    _is_admin = srv._is_admin
    _is_moderator = srv._is_moderator
    _is_hdo = srv._is_hdo
    _is_entertainer = srv._is_entertainer
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    cheat_detection_users_match = srv.cheat_detection_users_match
    cheat_detection_aggregate_first_match = srv.cheat_detection_aggregate_first_match
    cheat_detection_find_duplicates_username_match = srv.cheat_detection_find_duplicates_username_match
    user_has_dupe_exempt_email = getattr(srv, "user_has_dupe_exempt_email", lambda _u: False)
    user_has_admin_list_email = getattr(srv, "user_has_admin_list_email", lambda _u: False)
    _staff_exclude_user_filter = srv._staff_exclude_user_filter
    effective_player_kill_count = srv.effective_player_kill_count
    _admin_or_mod = srv._admin_or_mod
    require_admin = srv.require_admin
    require_admin_or_mod = srv.require_admin_or_mod
    from utils.staff_flags_payload import build_staff_flags_payload

    def _can_forum_mute(user: dict) -> bool:
        """Admin, mod, or HDO can mute/unmute forum users."""
        return _is_admin(user) or _is_moderator(user) or _is_hdo(user)

    _username_pattern = srv._username_pattern
    RANKS = srv.RANKS
    STATES = srv.STATES
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    get_rank_threshold_mult = srv.get_rank_threshold_mult
    CARS = srv.CARS
    maybe_process_rank_up = srv.maybe_process_rank_up
    get_rank_info = srv.get_rank_info
    get_password_hash = srv.get_password_hash
    DEFAULT_GARAGE_BATCH_LIMIT = srv.DEFAULT_GARAGE_BATCH_LIMIT
    SWISS_BANK_LIMIT_START = srv.SWISS_BANK_LIMIT_START
    DEFAULT_HEALTH = srv.DEFAULT_HEALTH
    get_events_enabled = srv.get_events_enabled
    get_effective_event_full = srv.get_effective_event_full
    force_rotate_random_events = srv.force_rotate_random_events
    POSITIVE_GAME_EVENTS = srv.POSITIVE_GAME_EVENTS
    GAME_EVENTS = srv.GAME_EVENTS

    from routers.money import crack_safe as _crack_safe_mod
    from routers.money.crack_safe import SAFE_JACKPOT_SEED as _CRACK_SAFE_JACKPOT_SEED

    def _normalize_ip(raw: str) -> Optional[str]:
        n = normalize_ip_string(raw)
        return n or None

    @router.get("/admin/whoami")
    async def admin_whoami(current_user: dict = Depends(get_current_user)):
        """Lightweight staff flags for UI gating."""
        return {
            "is_admin": bool(_is_admin(current_user)),
            "is_moderator": bool(_is_moderator(current_user)),
            "has_admin_email": bool(user_has_admin_list_email(current_user)),
            "is_help_desk_operator": bool(_is_hdo(current_user)),
            "admin_acting_as_normal": bool(current_user.get("admin_acting_as_normal", False)),
            "staff_login_session": bool(current_user.get("_jwt_staff_issued")),
        }

    @router.get("/admin/staff-access-denials")
    async def admin_list_staff_access_denials(
        limit: int = Query(100, ge=1, le=500),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """Recent HTTP 403 responses on audited staff API routes (signed-in users without permission). Admin or moderator."""
        from utils.staff_access_audit import COLLECTION as _STAFF_DENIAL_COL

        rows = await db[_STAFF_DENIAL_COL].find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
        return {"denials": rows, "count": len(rows)}

    @router.post("/admin/ip-normalize-mapped-v6")
    async def admin_ip_normalize_mapped_v6(
        dry_run: bool = Query(True, description="Preview only; no writes when true"),
        limit: int = Query(20000, ge=100, le=200000, description="Max users to scan"),
        current_user: dict = Depends(get_current_user),
    ):
        """Normalize stored IPv4-mapped IPv6 (::ffff:x.x.x.x) user IPs to plain IPv4."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        def _is_mapped_ipv6_raw(v: str) -> bool:
            s = str(v or "").strip().lower()
            return s.startswith("::ffff:") or s.startswith("[::ffff:")

        query = {
            "$or": [
                {"registration_ip": {"$regex": r"^::ffff:", "$options": "i"}},
                {"last_login_ip": {"$regex": r"^::ffff:", "$options": "i"}},
                {"last_request_ip": {"$regex": r"^::ffff:", "$options": "i"}},
                {"login_ips": {"$elemMatch": {"$regex": r"^::ffff:", "$options": "i"}}},
                {"sessions.ip": {"$regex": r"^::ffff:", "$options": "i"}},
            ]
        }
        users = await db.users.find(
            query,
            {"_id": 0, "id": 1, "username": 1, "registration_ip": 1, "last_login_ip": 1, "last_request_ip": 1, "login_ips": 1, "sessions": 1},
        ).limit(limit).to_list(limit)

        scanned = len(users)
        users_with_changes = 0
        fields_changed = 0
        sample = []

        for u in users:
            updates_set = {}
            changed_here = 0

            for key in ("registration_ip", "last_login_ip", "last_request_ip"):
                old = (u.get(key) or "").strip()
                if not old or not _is_mapped_ipv6_raw(old):
                    continue
                new = _normalize_ip(old)
                if new and new != old:
                    updates_set[key] = new
                    changed_here += 1

            login_ips = u.get("login_ips") or []
            if isinstance(login_ips, list) and login_ips:
                new_login_ips = []
                changed_login = 0
                for ip in login_ips:
                    old = (ip or "").strip()
                    if old and _is_mapped_ipv6_raw(old):
                        new = _normalize_ip(old)
                        if new and new != old:
                            new_login_ips.append(new)
                            changed_login += 1
                            continue
                    new_login_ips.append(old)
                if changed_login > 0:
                    updates_set["login_ips"] = new_login_ips
                    changed_here += changed_login

            sessions = u.get("sessions") or []
            if isinstance(sessions, list) and sessions:
                new_sessions = []
                changed_sessions = 0
                for s in sessions:
                    if not isinstance(s, dict):
                        new_sessions.append(s)
                        continue
                    ip_old = (s.get("ip") or "").strip()
                    if ip_old and _is_mapped_ipv6_raw(ip_old):
                        ip_new = _normalize_ip(ip_old)
                        if ip_new and ip_new != ip_old:
                            s2 = dict(s)
                            s2["ip"] = ip_new
                            new_sessions.append(s2)
                            changed_sessions += 1
                            continue
                    new_sessions.append(s)
                if changed_sessions > 0:
                    updates_set["sessions"] = new_sessions
                    changed_here += changed_sessions

            if changed_here <= 0:
                continue
            users_with_changes += 1
            fields_changed += changed_here
            if len(sample) < 20:
                sample.append({"user_id": u.get("id"), "username": u.get("username"), "changed_fields": changed_here})
            if not dry_run:
                await db.users.update_one({"id": u["id"]}, {"$set": updates_set})

        return {
            "dry_run": bool(dry_run),
            "scanned": scanned,
            "users_with_changes": users_with_changes,
            "fields_changed": fields_changed,
            "sample": sample,
            "message": (
                f"Dry run complete. {users_with_changes} user(s), {fields_changed} field(s) would be normalized."
                if dry_run
                else f"Normalized mapped IPv6 on {users_with_changes} user(s), {fields_changed} field(s)."
            ),
        }

    @router.post("/admin/ghost-mode")
    async def admin_toggle_ghost_mode(current_user: dict = Depends(get_current_user)):
        """Toggle ghost mode (appear offline). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        new_value = not current_user.get("admin_ghost_mode", False)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"admin_ghost_mode": new_value}}
        )
        return {"admin_ghost_mode": new_value, "message": "Ghost mode " + ("on" if new_value else "off")}

    @router.post("/admin/act-as-normal")
    async def admin_act_as_normal(acting: bool, current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"admin_acting_as_normal": bool(acting)}}
        )
        return {"admin_acting_as_normal": bool(acting), "message": "Act as normal user " + ("on" if acting else "off")}

    @router.post("/admin/change-rank")
    async def admin_change_rank(
        target_username: str,
        new_rank: int,
        prestige_level: Optional[int] = Query(None, ge=0, le=5, description="Prestige level 0–5; if omitted, keeps target's current prestige"),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not (1 <= new_rank <= len(RANKS)):
            raise HTTPException(status_code=400, detail=f"new_rank must be 1–{len(RANKS)}")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        # Resolve prestige: use provided level or keep target's current
        if prestige_level is not None:
            new_prestige_level = prestige_level
            new_prestige_mult = float(get_rank_threshold_mult(new_prestige_level))
        else:
            new_prestige_level = int(target.get("prestige_level") or 0)
            new_prestige_mult = float(target.get("prestige_rank_multiplier") or 1.0)

        rank_def = RANKS[new_rank - 1]
        required_pts_base = int(rank_def["required_points"])
        # Set rank_points so effective rank (rank_points / prestige_mult) equals the requested rank
        required_pts = int(required_pts_base * new_prestige_mult)

        old_rp = int(target.get("rank_points") or 0)
        updates = {"rank": new_rank, "rank_points": required_pts, "prestige_level": new_prestige_level, "prestige_rank_multiplier": new_prestige_mult}
        await db.users.update_one({"id": target["id"]}, {"$set": updates})

        rp_added = required_pts - old_rp
        if rp_added > 0:
            try:
                await maybe_process_rank_up(target["id"], old_rp, rp_added, target.get("username", ""), new_prestige_mult)
            except Exception as e:
                logging.exception("Rank-up notification (admin set rank): %s", e)

        prestige_msg = f", prestige {new_prestige_level}" if new_prestige_level > 0 else ""
        return {"message": f"Changed {target['username']}'s rank to {rank_def['name']} (rank_points set to {required_pts:,}{prestige_msg})"}

    @router.post("/admin/add-points")
    async def admin_add_points(target_username: str, points: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one(
            {"id": target["id"]},
            {"$inc": {"points": points}}
        )
        await log_points_event(
            db,
            user_id=target["id"],
            points=points,
            event_type="admin_add_points",
            event_ref=f"admin:{current_user.get('id') or 'unknown'}",
            meta={
                "admin_user_id": current_user.get("id"),
                "admin_username": current_user.get("username") or "?",
                "target_username": target.get("username") or target_username,
            },
        )
        return {"message": f"Added {points} points to {target_username}"}

    @router.post("/admin/remove-points")
    async def admin_remove_points(target_username: str, amount: int, current_user: dict = Depends(get_current_user)):
        """Remove up to `amount` rank points (clamped to current balance). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if amount <= 0:
            raise HTTPException(status_code=400, detail="amount must be a positive number")

        # Import locally to keep admin.py import graph stable.
        from utils.point_provenance import consume_points_fifo

        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "points": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        current_points = max(0, int(target.get("points") or 0))
        remove = min(int(amount), current_points)
        if remove <= 0:
            return {
                "message": f"{target.get('username') or target_username} has 0 points; nothing removed.",
                "removed": 0,
                "new_points": 0,
            }

        # Consume points from oldest FIFO lots and record provenance in point_lots/point_ledger_events.
        # consume_points_fifo returns the slices it actually removed (should equal `remove` after legacy seeding).
        slices = await consume_points_fifo(
            db,
            user_id=target["id"],
            points=remove,
            event_type="admin_remove_points",
            event_ref=f"admin:{current_user.get('id') or 'unknown'}",
            meta={
                "admin_user_id": current_user.get("id"),
                "admin_username": current_user.get("username") or "?",
                "source": "admin",
                "target_username": target.get("username") or target_username,
            },
        )
        actual_removed = sum(int(s.get("amount") or 0) for s in (slices or []))

        # Update the denormalized `users.points` balance to match what provenance consumed.
        await db.users.update_one({"id": target["id"]}, {"$inc": {"points": -actual_removed}})
        leaderboard_module.invalidate_leaderboard_cache()

        new_points = current_points - actual_removed
        return {
            "message": f"Removed {actual_removed:,} points from {target.get('username') or target_username} (balance now {new_points:,}).",
            "removed": actual_removed,
            "new_points": new_points,
        }

    @router.post("/admin/remove-respect-points")
    async def admin_remove_respect_points(
        target_username: str,
        amount: int,
        current_user: dict = Depends(get_current_user),
    ):
        """Remove up to `amount` respect points (clamped to current balance). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if amount <= 0:
            raise HTTPException(status_code=400, detail="amount must be a positive number")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "respect_points": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        current_rp = max(0, int(target.get("respect_points") or 0))
        remove = min(int(amount), current_rp)
        if remove <= 0:
            return {
                "message": f"{target.get('username') or target_username} has 0 respect points; nothing removed.",
                "removed": 0,
                "new_respect_points": 0,
            }
        await db.users.update_one({"id": target["id"]}, {"$inc": {"respect_points": -remove}})
        await log_respect_delta(target["id"], -remove, "admin_remove")
        leaderboard_module.invalidate_leaderboard_cache()
        new_bal = current_rp - remove
        return {
            "message": f"Removed {remove:,} respect from {target.get('username') or target_username} (balance now {new_bal:,}).",
            "removed": remove,
            "new_respect_points": new_bal,
        }

    @router.post("/admin/add-respect-points")
    async def admin_add_respect_points(
        target_username: str,
        amount: int,
        current_user: dict = Depends(get_current_user),
    ):
        """Grant respect points to a user. Logged as admin_add; does not pay cash. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if amount <= 0:
            raise HTTPException(status_code=400, detail="amount must be a positive number")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "respect_points": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        add = int(amount)
        current_rp = max(0, int(target.get("respect_points") or 0))
        await db.users.update_one({"id": target["id"]}, {"$inc": {"respect_points": add}})
        await log_respect_delta(target["id"], add, "admin_add")
        leaderboard_module.invalidate_leaderboard_cache()
        new_bal = current_rp + add
        return {
            "message": f"Added {add:,} respect to {target.get('username') or target_username} (balance now {new_bal:,}).",
            "added": add,
            "new_respect_points": new_bal,
        }

    @router.get("/admin/points/provenance/user/{user_id_or_username}")
    async def admin_points_provenance_user(user_id_or_username: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (user_id_or_username or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="User id or username required")
        u = await db.users.find_one({"id": raw}, {"_id": 0, "id": 1, "username": 1, "points": 1})
        if not u:
            username_pattern = _username_pattern(raw)
            u = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "points": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = u["id"]
        await ensure_user_legacy_seed_lot(db, user_id, int(u.get("points") or 0))
        lots = await db.point_lots.find(
            {"owner_user_id": user_id},
            {"_id": 0, "id": 1, "origin_type": 1, "origin_ref": 1, "remaining_points": 1, "root_purchase_ref": 1, "created_at": 1},
        ).sort([("created_at", 1), ("id", 1)]).to_list(5000)
        ledger = await db.point_ledger_events.find(
            {"user_id": user_id},
            {"_id": 0, "id": 1, "event_type": 1, "points": 1, "origin_ref": 1, "root_purchase_ref": 1, "created_at": 1},
        ).sort("created_at", -1).limit(200).to_list(200)
        return {"user": u, "lots": lots, "ledger": ledger}

    @router.get("/admin/missions/user/{user_id_or_username}")
    async def admin_get_missions_user(user_id_or_username: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (user_id_or_username or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="User id or username required")
        u = await db.users.find_one({"id": raw}, {"_id": 0})
        if not u:
            username_pattern = _username_pattern(raw)
            u = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        from routers.account import missions as missions_mod

        return await missions_mod.admin_missions_payload_for_user(u)

    @router.patch("/admin/missions/user/{user_id_or_username}")
    async def admin_set_missions_user(
        user_id_or_username: str,
        body: AdminMissionProgressSetRequest,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (user_id_or_username or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="User id or username required")
        u = await db.users.find_one({"id": raw}, {"_id": 0, "id": 1})
        if not u:
            username_pattern = _username_pattern(raw)
            u = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        from routers.account import missions as missions_mod

        out = await missions_mod.admin_apply_mission_progress(
            u["id"],
            int(body.next_mission_display),
            grant_skipped_rewards=bool(body.grant_skipped_rewards),
        )
        try:
            await srv.log_activity(
                current_user.get("id") or "",
                current_user.get("username") or "?",
                "admin_mission_progress_set",
                {
                    "target_user_id": u.get("id"),
                    "next_mission_display": int(body.next_mission_display),
                    "grant_skipped_rewards": bool(body.grant_skipped_rewards),
                },
            )
        except Exception:
            pass
        return out

    @router.get("/admin/points/sources/{user_id_or_username}")
    async def admin_points_sources(user_id_or_username: str, current_user: dict = Depends(get_current_user)):
        """Aggregate store-currency point sources: lots, ledger, completed Stripe payments, transfers, and key user counters."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (user_id_or_username or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="User id or username required")
        u = await db.users.find_one({"id": raw}, {"_id": 0})
        if not u:
            username_pattern = _username_pattern(raw)
            u = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = u["id"]

        lots_rows = await db.point_lots.aggregate(
            [
                {"$match": {"owner_user_id": user_id}},
                {
                    "$group": {
                        "_id": "$origin_type",
                        "remaining": {"$sum": "$remaining_points"},
                        "lots": {"$sum": 1},
                    }
                },
                {"$sort": {"remaining": -1}},
            ]
        ).to_list(200)

        ledger_in = await db.point_ledger_events.aggregate(
            [
                {"$match": {"user_id": user_id, "points": {"$gt": 0}}},
                {"$group": {"_id": "$event_type", "total": {"$sum": "$points"}, "n": {"$sum": 1}}},
                {"$sort": {"total": -1}},
            ]
        ).to_list(500)

        ledger_out = await db.point_ledger_events.aggregate(
            [
                {"$match": {"user_id": user_id, "points": {"$lt": 0}}},
                {"$group": {"_id": "$event_type", "total": {"$sum": "$points"}, "n": {"$sum": 1}}},
                {"$sort": {"total": 1}},
            ]
        ).to_list(500)

        pay_match = {"user_id": user_id, "payment_status": "completed"}
        pay_agg = await db.payment_transactions.aggregate(
            [
                {"$match": pay_match},
                {"$group": {"_id": None, "total_points": {"$sum": "$points"}, "count": {"$sum": 1}}},
            ]
        ).to_list(1)
        pay_total = int(pay_agg[0]["total_points"]) if pay_agg else 0
        pay_count = int(pay_agg[0]["count"]) if pay_agg else 0
        recent_payments = await db.payment_transactions.find(
            pay_match,
            {"_id": 0, "session_id": 1, "package_id": 1, "points": 1, "created_at": 1, "points_credited_at": 1},
        ).sort("created_at", -1).limit(40).to_list(40)

        tin = await db.points_transfers.aggregate(
            [
                {"$match": {"to_user_id": user_id}},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}, "n": {"$sum": 1}}},
            ]
        ).to_list(1)
        tout = await db.points_transfers.aggregate(
            [
                {"$match": {"from_user_id": user_id}},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}, "n": {"$sum": 1}}},
            ]
        ).to_list(1)

        lot_sum = sum(int(r.get("remaining") or 0) for r in lots_rows)
        balance = int(u.get("points") or 0)

        return {
            "user": {
                "id": user_id,
                "username": u.get("username"),
                "points": balance,
            },
            "user_stats": {
                "lifetime_points_spent": int(u.get("lifetime_points_spent") or 0),
                "redeem_codes_points_total": int(u.get("redeem_stats_total_points") or 0),
                "stock_market_profit_total_points": int(u.get("stock_market_profit_total") or 0),
            },
            "lots_remaining_by_origin": [
                {
                    "origin_type": r.get("_id"),
                    "remaining_points": int(r.get("remaining") or 0),
                    "lot_count": int(r.get("lots") or 0),
                }
                for r in lots_rows
            ],
            "lots_remaining_sum": lot_sum,
            "balance_matches_lots": lot_sum == balance,
            "ledger_inflows_by_event": [
                {
                    "event_type": r.get("_id"),
                    "points": int(r.get("total") or 0),
                    "events": int(r.get("n") or 0),
                }
                for r in ledger_in
            ],
            "ledger_outflows_by_event": [
                {
                    "event_type": r.get("_id"),
                    "points": int(r.get("total") or 0),
                    "events": int(r.get("n") or 0),
                }
                for r in ledger_out
            ],
            "stripe_purchases_completed": {
                "total_points": pay_total,
                "transaction_count": pay_count,
                "recent": recent_payments,
            },
            "points_transfers_received": {
                "total_points": int(tin[0]["total"]) if tin else 0,
                "transfer_count": int(tin[0]["n"]) if tin else 0,
            },
            "points_transfers_sent": {
                "total_points": int(tout[0]["total"]) if tout else 0,
                "transfer_count": int(tout[0]["n"]) if tout else 0,
            },
            "notes": [
                "This report is for store currency (users.points). Rank progression uses rank_points separately.",
                "Current balance is represented as FIFO lots; legacy or untracked grants (e.g. some in-game rewards, admin add-points) may be bucketed as legacy_seed.",
                "Ledger rows aggregate point_ledger_events; not every feature writes to this log.",
            ],
        }

    @router.get("/admin/points/store-bought-total")
    async def admin_points_store_bought_total(current_user: dict = Depends(get_current_user)):
        """
        Lifetime total points bought via store payments (completed checkout rows),
        regardless of whether points are still in circulation.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        agg = await db.payment_transactions.aggregate(
            [
                {"$match": {"payment_status": "completed"}},
                {
                    "$group": {
                        "_id": None,
                        "total_points_bought": {"$sum": {"$ifNull": ["$points", 0]}},
                        "purchase_count": {"$sum": 1},
                        "first_purchase_at": {"$min": "$created_at"},
                        "last_purchase_at": {"$max": "$created_at"},
                    }
                },
            ]
        ).to_list(1)
        row = agg[0] if agg else {}
        return {
            "total_points_bought": int(row.get("total_points_bought") or 0),
            "purchase_count": int(row.get("purchase_count") or 0),
            "first_purchase_at": row.get("first_purchase_at"),
            "last_purchase_at": row.get("last_purchase_at"),
            "scope": "completed payment_transactions only (historical store purchases, not current circulation)",
        }

    @router.get("/admin/points/chargeback/preview/{payment_session_id}")
    async def admin_points_chargeback_preview(payment_session_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        summary = await chargeback_preview(db, payment_session_id)
        return {"payment_session_id": payment_session_id, **summary}

    @router.get("/admin/points/provenance/payment/{payment_session_id}")
    async def admin_points_provenance_payment(payment_session_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        txn = await db.payment_transactions.find_one({"session_id": payment_session_id}, {"_id": 0})
        lots = await db.point_lots.find(
            {"root_purchase_ref": payment_session_id},
            {"_id": 0, "id": 1, "owner_user_id": 1, "origin_type": 1, "origin_ref": 1, "remaining_points": 1, "parent_lot_id": 1, "created_at": 1},
        ).sort([("created_at", 1), ("id", 1)]).to_list(10000)
        ledger = await db.point_ledger_events.find(
            {"root_purchase_ref": payment_session_id},
            {"_id": 0, "id": 1, "user_id": 1, "event_type": 1, "points": 1, "origin_ref": 1, "lot_id": 1, "created_at": 1},
        ).sort("created_at", -1).limit(2000).to_list(2000)
        return {"payment_session_id": payment_session_id, "transaction": txn, "lots": lots, "ledger": ledger}

    @router.post("/admin/points/chargeback/execute")
    async def admin_points_chargeback_execute(body: ChargebackRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        payer_username = "the purchasing account"
        txn = await db.payment_transactions.find_one(
            {"session_id": body.payment_session_id},
            {"_id": 0, "user_id": 1},
        )
        payer_user_id = (txn or {}).get("user_id")
        if payer_user_id:
            payer_user = await db.users.find_one(
                {"id": payer_user_id},
                {"_id": 0, "username": 1},
            )
            payer_username = (payer_user or {}).get("username") or payer_username
        summary = await execute_chargeback_best_effort(
            db,
            payment_session_id=body.payment_session_id,
            admin_user_id=current_user.get("id"),
            admin_username=current_user.get("username") or "?",
        )
        # Notify each affected user when points were reclaimed from their balance.
        for row in (summary.get("owners") or []):
            uid = row.get("user_id")
            reclaimed = int(row.get("reclaimed") or 0)
            if not uid or reclaimed <= 0:
                continue
            try:
                await send_notification(
                    uid,
                    "Points Adjustment Notice",
                    (
                        f"{reclaimed:,} points were removed from your account due to a payment chargeback/reversal "
                        f"for a purchase made by {payer_username}. "
                        "If those points were transferred to you or originated from a reversed payment, "
                        "they may be reclaimed during chargeback processing. "
                        "Even if you did not intentionally get points directly from the charged-back user "
                        "(for example, you bought them on Quick Trade), we still reserve the right to remove them "
                        "from the game if they are deemed fraudulent. "
                        "We apologize for any inconvenience this causes."
                    ),
                    "system",
                    category="system",
                )
            except Exception:
                logger.exception(
                    "chargeback notification failed: session=%s user_id=%s reclaimed=%s",
                    body.payment_session_id,
                    uid,
                    reclaimed,
                )
        return {"payment_session_id": body.payment_session_id, **summary}

    @router.post("/admin/set-founding-member")
    async def admin_set_founding_member(
        target_username: str,
        is_founding: bool = True,
        current_user: dict = Depends(get_current_user)
    ):
        """Set or remove founding member status for a user. When true, adds the badge; when false, removes it."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "badges": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        
        badge_name = "Founding Member"
        if is_founding:
            await db.users.update_one(
                {"id": target["id"]},
                {
                    "$set": {"founding_member": True},
                    "$addToSet": {"badges": badge_name}
                }
            )
            return {"message": f"Set {target['username']} as Founding Member with badge"}
        else:
            await db.users.update_one(
                {"id": target["id"]},
                {
                    "$set": {"founding_member": False},
                    "$pull": {"badges": badge_name}
                }
            )
            return {"message": f"Removed Founding Member status from {target['username']}"}

    @router.post("/admin/give-all-points")
    async def admin_give_all_points(points: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if points < 1:
            raise HTTPException(status_code=400, detail="Points must be at least 1")
        result = await db.users.update_many(
            {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}},
            {"$inc": {"points": points}}
        )
        await log_points_event(
            db,
            user_id=current_user.get("id") or "admin",
            points=points,
            event_type="admin_give_all_points",
            event_ref=f"admin_bulk:{result.modified_count}",
            meta={
                "admin_user_id": current_user.get("id"),
                "admin_username": current_user.get("username") or "?",
                "accounts_affected": result.modified_count,
            },
        )
        return {"message": f"Gave {points} points to {result.modified_count} accounts", "updated": result.modified_count}

    @router.post("/admin/remove-all-points")
    async def admin_remove_all_points(
        max_users: int = Query(5000, ge=1, le=100000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Remove rank points from (up to) `max_users` accounts that currently have points (alive players).
        Safe-ish for ledger consistency: consumes from point FIFO lots and writes point_lots + point_ledger_events.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        scope_match = {
            "is_dead": {"$ne": True},
            "is_npc": {"$ne": True},
            "is_bodyguard": {"$ne": True},
            "points": {"$gt": 0},
        }

        # Fetch a bounded set first (this is a single request; avoid huge timeouts).
        target_users = await db.users.find(
            scope_match,
            {"_id": 0, "id": 1, "username": 1, "points": 1},
        ).sort("points", -1).limit(int(max_users)).to_list(int(max_users))

        removed_total = 0
        processed = 0
        for u in (target_users or []):
            uid = u.get("id")
            if not uid:
                continue
            current_points = max(0, int(u.get("points") or 0))
            if current_points <= 0:
                continue

            slices = await consume_points_fifo(
                db,
                user_id=uid,
                points=current_points,
                event_type="admin_remove_all_points",
                event_ref=f"remove-all:{current_user.get('id') or 'unknown'}",
                meta={
                    "admin_user_id": current_user.get("id"),
                    "admin_username": current_user.get("username") or "?",
                    "scope": "alive_players",
                },
            )
            actual_removed = sum(int(s.get("amount") or 0) for s in (slices or []))
            if actual_removed <= 0:
                continue
            await db.users.update_one({"id": uid}, {"$inc": {"points": -actual_removed}})
            removed_total += actual_removed
            processed += 1

        # Also invalidate leaderboard cache so rank lists update.
        leaderboard_module.invalidate_leaderboard_cache()

        return {
            "message": f"Removed {removed_total:,} points from {processed} user(s) (max_users={max_users}).",
            "processed": processed,
            "removed_total": removed_total,
        }

    @router.post("/admin/zero-all-points")
    async def admin_zero_all_points(
        max_users: int = Query(5000, ge=1, le=100000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Set `users.points` to 0 for up to `max_users` alive accounts (safe against negative balances).
        This does not attempt to reconcile point_lots/ledger provenance; it is intended as an emergency admin reset.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        scope_match = {
            "is_dead": {"$ne": True},
            "is_npc": {"$ne": True},
            "is_bodyguard": {"$ne": True},
            "points": {"$ne": 0},
        }

        target_users = await db.users.find(
            scope_match,
            {"_id": 0, "id": 1},
        ).limit(int(max_users)).to_list(int(max_users))

        user_ids = [u.get("id") for u in (target_users or []) if u.get("id")]
        if not user_ids:
            return {"message": "No users with non-zero points found.", "updated": 0}

        res = await db.users.update_many({"id": {"$in": user_ids}}, {"$set": {"points": 0}})
        leaderboard_module.invalidate_leaderboard_cache()
        return {"message": f"Set points=0 for {res.modified_count} user(s).", "updated": res.modified_count}

    @router.get("/admin/points/spend-store")
    async def admin_points_spend_store_list(
        limit: int = Query(200, ge=1, le=1000),
        username: Optional[str] = Query(None, description="Filter by username (regex-ish via username pattern)"),
        store_event_ref: Optional[str] = Query(None, description="Filter by store spend origin_ref, e.g. buy-silencer"),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Lists store spends recorded in point_ledger_events (event_type='spend_store'), grouped by (user_id, origin_ref).
        This shows what users 'bought with points' at the provenance layer; refunds can be performed per row.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        base_match: Dict = {"event_type": "spend_store", "points": {"$lt": 0}}
        if store_event_ref:
            base_match["origin_ref"] = store_event_ref

        user_ids: Optional[List[str]] = None
        if username and str(username).strip():
            username_pattern = _username_pattern(str(username).strip())
            matched = await db.users.find({"username": username_pattern}, {"_id": 0, "id": 1}).limit(50).to_list(50)
            user_ids = [m.get("id") for m in matched if m.get("id")]
            if not user_ids:
                return {"spends": [], "count": 0}

        match_extra = base_match.copy()
        if user_ids:
            match_extra["user_id"] = {"$in": user_ids}

        pipeline = [
            {"$match": match_extra},
            {
                "$group": {
                    "_id": {"user_id": "$user_id", "origin_ref": "$origin_ref"},
                    "total_points_spent": {"$sum": {"$cond": [{"$lt": ["$points", 0]}, {"$multiply": ["$points", -1]}, 0]}},
                    "spend_count": {"$sum": 1},
                    "first_at": {"$min": "$created_at"},
                    "last_at": {"$max": "$created_at"},
                }
            },
            {"$sort": {"last_at": -1}},
            {"$limit": int(limit)},
            {
                "$lookup": {
                    "from": "users",
                    "localField": "_id.user_id",
                    "foreignField": "id",
                    "as": "u",
                }
            },
            {
                "$addFields": {
                    "username": {"$ifNull": [{"$arrayElemAt": ["$u.username", 0]}, "?"]},
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "user_id": "$_id.user_id",
                    "username": 1,
                    "store_event_ref": "$_id.origin_ref",
                    "total_points_spent": 1,
                    "spend_count": 1,
                    "first_at": 1,
                    "last_at": 1,
                }
            },
        ]

        rows = await db.point_ledger_events.aggregate(pipeline).to_list(int(limit))
        # Normalize numbers (Mongo returns ints but keep safe).
        spends = []
        for r in rows or []:
            spends.append(
                {
                    "user_id": r.get("user_id"),
                    "username": r.get("username") or "?",
                    "store_event_ref": r.get("store_event_ref"),
                    "total_points_spent": int(r.get("total_points_spent") or 0),
                    "spend_count": int(r.get("spend_count") or 0),
                    "first_at": r.get("first_at"),
                    "last_at": r.get("last_at"),
                }
            )

        return {"spends": spends, "count": len(spends)}

    @router.post("/admin/points/refund-store-spend")
    async def admin_refund_store_spend(
        user_id: str,
        store_event_ref: str,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Refund points back to a user for a specific store spend origin_ref (e.g. buy-silencer).
        Does NOT automatically undo the purchased item entitlement/flags; it only restores points balance + provenance.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not user_id or not store_event_ref:
            raise HTTPException(status_code=400, detail="user_id and store_event_ref are required")

        # If already refunded for this (user, store_event_ref), do not double-refund.
        refund_origin_ref = f"admin_store_refund:{user_id}:{store_event_ref}"
        existing = await db.point_ledger_events.find_one(
            {
                "event_type": "admin_refund_store_spend",
                "user_id": user_id,
                "origin_ref": refund_origin_ref,
            },
            {"_id": 1},
        )
        if existing:
            return {"message": "Already refunded for this user + store spend type.", "refunded": 0}

        total = await db.point_ledger_events.aggregate(
            [
                {"$match": {"event_type": "spend_store", "user_id": user_id, "origin_ref": store_event_ref, "points": {"$lt": 0}}},
                {
                    "$group": {
                        "_id": None,
                        "total_abs": {"$sum": {"$cond": [{"$lt": ["$points", 0]}, {"$multiply": ["$points", -1]}, 0]}},
                        "count": {"$sum": 1},
                    }
                },
            ]
        ).to_list(1)
        if not total:
            return {"message": "No matching spend_store events found.", "refunded": 0}
        refund_amount = int(total[0].get("total_abs") or 0)
        spend_count = int(total[0].get("count") or 0)
        if refund_amount <= 0:
            return {"message": "Nothing to refund (total spend was 0).", "refunded": 0}

        now_iso = datetime.now(timezone.utc).isoformat()
        lot_id = refund_origin_ref
        # Insert the lot + ledger event.
        await db.users.update_one({"id": user_id}, {"$inc": {"points": refund_amount}})
        await db.point_lots.insert_one(
            {
                "id": lot_id,
                "owner_user_id": user_id,
                "origin_type": "admin_refund_store_spend",
                "origin_ref": refund_origin_ref,
                "remaining_points": refund_amount,
                "root_purchase_ref": None,
                "parent_lot_id": None,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        )
        await db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": "admin_refund_store_spend",
                "user_id": user_id,
                "points": refund_amount,
                "lot_id": lot_id,
                "origin_ref": refund_origin_ref,
                "root_purchase_ref": None,
                "meta": {
                    "admin_user_id": current_user.get("id"),
                    "admin_username": current_user.get("username") or "?",
                    "store_event_ref": store_event_ref,
                    "refunded_from_spend_count": spend_count,
                },
                "created_at": now_iso,
            }
        )

        leaderboard_module.invalidate_leaderboard_cache()

        return {
            "message": f"Refunded {refund_amount:,} points for store spend `{store_event_ref}`.",
            "refunded": refund_amount,
            "store_event_ref": store_event_ref,
        }

    @router.post("/admin/points/retract-store-spend")
    async def admin_retract_store_spend(
        user_id: str,
        store_event_ref: str,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Retracts the store entitlement for a points purchase (spend_store origin_ref),
        and only re-deducts points if this user was previously refunded via this admin panel
        (i.e. if an admin_refund_store_spend ledger exists for this purchase).

        This avoids "refund points unless manually clicked" while still letting admins
        remove items granted via points they believe should not have been in-game.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not user_id or not store_event_ref:
            raise HTTPException(status_code=400, detail="user_id and store_event_ref are required")

        # Idempotency: once retracted, don't do it again.
        revoke_origin_ref = f"admin_store_retract:{user_id}:{store_event_ref}"
        existing = await db.point_ledger_events.find_one(
            {
                "event_type": "admin_retract_store_spend",
                "user_id": user_id,
                "origin_ref": revoke_origin_ref,
            },
            {"_id": 1},
        )
        if existing:
            return {"message": "Already retracted for this user + store spend.", "retracted": False}

        # Compute total points refunded earlier (if any).
        refund_origin_ref = f"admin_store_refund:{user_id}:{store_event_ref}"
        refund_rows = await db.point_ledger_events.aggregate(
            [
                {
                    "$match": {
                        "event_type": "admin_refund_store_spend",
                        "user_id": user_id,
                        "origin_ref": refund_origin_ref,
                    }
                },
                {
                    "$group": {
                        "_id": None,
                        "refunded_points": {"$sum": {"$ifNull": ["$points", 0]}},
                    }
                },
            ]
        ).to_list(1)
        refunded_points = int(refund_rows[0].get("refunded_points") or 0) if refund_rows else 0

        # Spend stats: how many purchases of this type were recorded and the points portion spent.
        spend_stats_rows = await db.point_ledger_events.aggregate(
            [
                {
                    "$match": {
                        "event_type": "spend_store",
                        "user_id": user_id,
                        "origin_ref": store_event_ref,
                        "points": {"$lt": 0},
                    }
                },
                {
                    "$group": {
                        "_id": None,
                        "spend_count": {"$sum": 1},
                        "total_abs_spent": {
                            "$sum": {
                                "$cond": [
                                    {"$lt": ["$points", 0]},
                                    {"$multiply": ["$points", -1]},
                                    0,
                                ]
                            }
                        },
                    }
                },
            ]
        ).to_list(1)
        spend_count = int(spend_stats_rows[0].get("spend_count") or 0) if spend_stats_rows else 0
        total_abs_spent = int(spend_stats_rows[0].get("total_abs_spent") or 0) if spend_stats_rows else 0

        # Optional: if previously refunded, re-deduct those refunded points back out.
        points_deducted = 0
        if refunded_points > 0:
            slices = await consume_points_fifo(
                db,
                user_id=user_id,
                points=refunded_points,
                event_type="admin_retract_store_spend",
                event_ref=revoke_origin_ref,
                meta={
                    "admin_user_id": current_user.get("id"),
                    "admin_username": current_user.get("username") or "?",
                    "store_event_ref": store_event_ref,
                    "reason": "retract_store_spend_after_refund",
                },
            )
            actual_removed = sum(int(s.get("amount") or 0) for s in (slices or []))
            if actual_removed > 0:
                await db.users.update_one({"id": user_id}, {"$inc": {"points": -actual_removed}})
                points_deducted = actual_removed
        else:
            # Insert marker event so idempotency works even if no points were refunded.
            now_iso = datetime.now(timezone.utc).isoformat()
            await db.point_ledger_events.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "event_type": "admin_retract_store_spend",
                    "user_id": user_id,
                    "points": 0,
                    "lot_id": None,
                    "origin_ref": revoke_origin_ref,
                    "root_purchase_ref": None,
                    "meta": {
                        "admin_user_id": current_user.get("id"),
                        "admin_username": current_user.get("username") or "?",
                        "store_event_ref": store_event_ref,
                        "reason": "retract_store_spend_item_only",
                    },
                    "created_at": now_iso,
                }
            )

        # Retract entitlement (item) based on store_event_ref.
        # Note: some store purchases are entitlement/flag flips (can be retracted exactly),
        # while others are token-count increments; we do best-effort subtraction based on spend_store stats.
        from routers.kill.armoury import TOKEN_CONFIG
        from routers.money.booze_run import BOOZE_CAPACITY_UPGRADE_AMOUNT, _invalidate_config_cache
        from server import (
            DEFAULT_GARAGE_BATCH_LIMIT,
            GARAGE_BATCH_UPGRADE_INCREMENT,
            GARAGE_BATCH_LIMIT_MAX,
        )

        retract_ops = {}
        set_updates = {}
        unset_updates = {}

        # Normalize: store_event_ref looks like:
        # - "buy-booze-capacity"
        # - "buy-silencer"
        # - "buy-token:booze" or "buy-token-bundle:<bid>"
        # - "upgrade-garage-batch"
        # - etc.
        try:
            if store_event_ref == "buy-rank-bar":
                set_updates["premium_rank_bar"] = False
            elif store_event_ref == "buy-silencer":
                set_updates["has_silencer"] = False
            elif store_event_ref == "buy-anti-snitch":
                set_updates["anti_snitch"] = False
            elif store_event_ref == "buy-oc-timer":
                set_updates["oc_timer_reduced"] = False
            elif store_event_ref == "buy-crew-oc-timer":
                set_updates["crew_oc_timer_reduced"] = False
            elif store_event_ref == "buy-auto-rank":
                set_updates["auto_rank_purchased"] = False
                set_updates["auto_rank_trial"] = False
                set_updates["auto_rank_enabled"] = False
                unset_updates["auto_rank_trial_until"] = ""
            elif store_event_ref == "buy-booze-capacity":
                # Best-effort: retract the total capacity bonus added by these purchases.
                # If purchases hit the cap, the exact previous value may be unknown; we clamp at 0.
                user = await db.users.find_one({"id": user_id}, {"_id": 0, "booze_capacity_bonus": 1})
                cur = int((user or {}).get("booze_capacity_bonus") or 0)
                dec = min(cur, int(spend_count) * int(BOOZE_CAPACITY_UPGRADE_AMOUNT or 0))
                if dec > 0:
                    set_updates["booze_capacity_bonus"] = max(0, cur - dec)
                    await db.users.update_one({"id": user_id}, {"$set": set_updates})
                    _invalidate_config_cache(user_id)
                    set_updates = {}
            elif store_event_ref == "buy-token-bundle":
                # Not expected: bundles are "buy-token-bundle:<bid>"
                pass
            elif store_event_ref.startswith("buy-token:"):
                token_type = store_event_ref.split(":", 1)[1] or ""
                if token_type in TOKEN_CONFIG:
                    count_field = TOKEN_CONFIG[token_type]["count_field"]
                    # Best-effort: assume points portion maps linearly to token amount.
                    unit_price = {
                        "xp_crimes": 42,
                        "xp_gta": 42,
                        "melt": 42,
                        "oc_reduced": 42,
                        "booze": 42,
                        "racket": 42,
                        "properties": 48,
                        "travel": 55,
                        "jailbust_bonus": 48,
                    }.get(token_type)
                    if unit_price:
                        remove_tokens = int(total_abs_spent // int(unit_price))
                        if remove_tokens > 0:
                            user = await db.users.find_one({"id": user_id}, {"_id": 0, count_field: 1})
                            cur = int((user or {}).get(count_field) or 0)
                            remove = min(cur, remove_tokens)
                            if remove > 0:
                                await db.users.update_one({"id": user_id}, {"$inc": {count_field: -remove}})
            elif store_event_ref.startswith("buy-token-bundle:"):
                bid = store_event_ref.split(":", 1)[1] or ""
                TOKEN_STORE_BUNDLES = {
                    "grinder": (75, {"xp_crimes_tokens": 1, "xp_gta_tokens": 1}),
                    "racket_runner": (78, {"racket_tokens": 1, "booze_tokens": 1}),
                    "builder": (100, {"travel_tokens": 1, "properties_tokens": 1}),
                }
                bundle = TOKEN_STORE_BUNDLES.get(bid)
                if bundle:
                    _, field_inc = bundle
                    user = await db.users.find_one({"id": user_id}, {"_id": 0, **{k: 1 for k in field_inc.keys()}})
                    for field, add in (field_inc or {}).items():
                        cur = int((user or {}).get(field) or 0)
                        remove = min(cur, int(spend_count) * int(add))
                        if remove > 0:
                            await db.users.update_one({"id": user_id}, {"$inc": {field: -remove}})
            elif store_event_ref == "upgrade-garage-batch":
                user = await db.users.find_one({"id": user_id}, {"_id": 0, "garage_batch_limit": 1})
                cur = int((user or {}).get("garage_batch_limit") or DEFAULT_GARAGE_BATCH_LIMIT or 0)
                dec = int(spend_count) * int(GARAGE_BATCH_UPGRADE_INCREMENT or 0)
                new_val = max(int(DEFAULT_GARAGE_BATCH_LIMIT or 0), cur - dec)
                new_val = min(int(GARAGE_BATCH_LIMIT_MAX or new_val), new_val)
                if new_val != cur:
                    await db.users.update_one({"id": user_id}, {"$set": {"garage_batch_limit": new_val}})
            elif store_event_ref == "buy-shooting-range-bonus":
                user = await db.users.find_one({"id": user_id}, {"_id": 0, "shooting_range_bonus_plays": 1})
                cur = int((user or {}).get("shooting_range_bonus_plays") or 0)
                # Each purchase adds 2 plays (best-effort).
                dec = int(spend_count) * 2
                new_val = max(0, cur - dec)
                if new_val != cur:
                    await db.users.update_one({"id": user_id}, {"$set": {"shooting_range_bonus_plays": new_val}})
        except Exception:
            # Item retraction should not break points retraction; log and continue.
            logger.exception("retract-store-spend item removal failed user_id=%s store_event_ref=%s", user_id, store_event_ref)

        # Apply remaining set/unset updates (flags) if any.
        if set_updates:
            await db.users.update_one({"id": user_id}, {"$set": set_updates})
        if unset_updates:
            await db.users.update_one({"id": user_id}, {"$unset": {k: "" for k in unset_updates.keys()}})

        return {
            "message": f"Retracted store spend `{store_event_ref}` for {user_id}.",
            "retracted": True,
            "points_deducted_if_refunded": points_deducted,
            "spend_count": spend_count,
        }

    @router.post("/admin/give-all-money")
    async def admin_give_all_money(amount: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if amount < 1:
            raise HTTPException(status_code=400, detail="Amount must be at least 1")
        result = await db.users.update_many(
            {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}},
            {"$inc": {"money": amount}}
        )
        return {"message": f"Gave ${amount:,} to {result.modified_count} accounts", "updated": result.modified_count}

    @router.post("/admin/adjust-money")
    async def admin_adjust_money(target_username: str, amount: int, current_user: dict = Depends(get_current_user)):
        """Add or remove money from a user. Positive = add, negative = remove. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if amount == 0:
            raise HTTPException(status_code=400, detail="Amount cannot be zero")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "money": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        current_money = int(target.get("money") or 0)
        if amount < 0 and current_money + amount < 0:
            raise HTTPException(status_code=400, detail=f"Cannot remove more than the user has (${current_money:,}).")
        await db.users.update_one(
            {"id": target["id"]},
            {"$inc": {"money": amount}},
        )
        verb = "Added" if amount > 0 else "Removed"
        display = abs(amount)
        new_balance = current_money + amount
        try:
            await srv.log_activity(
                target["id"],
                target.get("username") or "?",
                "admin_adjust_money",
                {
                    "amount": amount,
                    "admin_username": current_user.get("username", "?"),
                    "new_balance": new_balance,
                },
            )
        except Exception:
            pass
        return {
            "message": f"{verb} ${display:,} {'to' if amount > 0 else 'from'} {target['username']}. New balance: ${new_balance:,}",
            "new_balance": new_balance,
        }

    @router.get("/admin/quicktrade/overview")
    async def admin_quicktrade_overview_route(
        current_user: dict = Depends(get_current_user),
    ):
        """Global Quick Trade counts and escrow (excludes staff listings, same as economy capital breakdown). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.money import quicktrade as qt_mod

        staff_ids = await srv._get_staff_user_ids()
        excl = list(staff_ids) if staff_ids else None
        overview = await qt_mod.admin_quicktrade_overview(exclude_user_ids=excl, top_users_limit=10)
        return overview

    @router.get("/admin/quicktrade/user/{identifier}")
    async def admin_quicktrade_user_route(identifier: str, current_user: dict = Depends(get_current_user)):
        """Active sell/buy/token offers and property listings for a user (id or username). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (identifier or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="user id or username required")
        u = await db.users.find_one({"id": raw}, {"_id": 0, "id": 1, "username": 1, "points": 1, "money": 1})
        if not u:
            pat = _username_pattern(raw)
            if pat:
                u = await db.users.find_one({"username": pat}, {"_id": 0, "id": 1, "username": 1, "points": 1, "money": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        uid = u["id"]
        from routers.money import quicktrade as qt_mod

        detail = await qt_mod.admin_quicktrade_user_detail(uid)
        detail["user"] = u
        return detail

    @router.post("/admin/quicktrade/cancel-sell/{offer_id}")
    async def admin_quicktrade_cancel_sell(
        offer_id: str,
        body: AdminQuicktradeReason = Body(default=AdminQuicktradeReason()),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.money import quicktrade as qt_mod

        actor = str(current_user.get("id") or "")
        try:
            return await qt_mod.force_cancel_sell_offer_by_id(offer_id, actor_user_id=actor, reason=body.reason)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @router.post("/admin/quicktrade/cancel-buy/{offer_id}")
    async def admin_quicktrade_cancel_buy(
        offer_id: str,
        body: AdminQuicktradeReason = Body(default=AdminQuicktradeReason()),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.money import quicktrade as qt_mod

        actor = str(current_user.get("id") or "")
        try:
            return await qt_mod.force_cancel_buy_offer_by_id(offer_id, actor_user_id=actor, reason=body.reason)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @router.post("/admin/quicktrade/cancel-token/{offer_id}")
    async def admin_quicktrade_cancel_token(
        offer_id: str,
        body: AdminQuicktradeReason = Body(default=AdminQuicktradeReason()),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.money import quicktrade as qt_mod

        actor = str(current_user.get("id") or "")
        try:
            return await qt_mod.force_cancel_token_offer_by_id(offer_id, actor_user_id=actor, reason=body.reason)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @router.post("/admin/quicktrade/cancel-property/{property_id}")
    async def admin_quicktrade_cancel_property(
        property_id: str,
        body: AdminQuicktradeReason = Body(default=AdminQuicktradeReason()),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.money import quicktrade as qt_mod

        actor = str(current_user.get("id") or "")
        try:
            return await qt_mod.force_cancel_property_listing_by_id(property_id, actor_user_id=actor, reason=body.reason)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @router.post("/admin/quicktrade/deduplicate-casino-listings")
    async def admin_quicktrade_deduplicate_casino_listings_route(
        body: AdminQuicktradeCasinoDedupeBody = Body(default=AdminQuicktradeCasinoDedupeBody()),
        current_user: dict = Depends(get_current_user),
    ):
        """Remove stacked Quick Trade rows for the same casino slot + owner (keeps newest listing). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.money import quicktrade as qt_mod

        actor = str(current_user.get("id") or "")
        try:
            return await qt_mod.admin_quicktrade_deduplicate_casino_listings(
                actor_user_id=actor,
                dry_run=bool(body.dry_run),
                reason=body.reason,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @router.post("/admin/quicktrade/user/{identifier}/cancel-all")
    async def admin_quicktrade_cancel_all(
        identifier: str,
        body: AdminQuicktradeReason = Body(default=AdminQuicktradeReason()),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (identifier or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="user id or username required")
        u = await db.users.find_one({"id": raw}, {"_id": 0, "id": 1})
        if not u:
            pat = _username_pattern(raw)
            if pat:
                u = await db.users.find_one({"username": pat}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        uid = u["id"]
        from routers.money import quicktrade as qt_mod

        actor = str(current_user.get("id") or "")
        return await qt_mod.admin_quicktrade_cancel_all_for_user(uid, actor_user_id=actor, reason=body.reason)

    @router.get("/admin/swiss-bank/list")
    async def admin_swiss_bank_list(
        min_balance: int = Query(1, ge=0),
        current_user: dict = Depends(get_current_user),
    ):
        """List all users with swiss_balance >= min_balance, sorted by balance descending."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.users.find(
            {"swiss_balance": {"$gte": min_balance}},
            {"_id": 0, "id": 1, "username": 1, "swiss_balance": 1, "swiss_limit": 1},
        ).sort("swiss_balance", -1).limit(500)
        rows = await cursor.to_list(500)
        total = sum(int(r.get("swiss_balance") or 0) for r in rows)
        return {"users": rows, "count": len(rows), "total_swiss": total}

    @router.get("/admin/captcha-turnstile-failures")
    async def admin_captcha_turnstile_failures(
        limit: int = Query(100, ge=1, le=500),
        skip: int = Query(0, ge=0, le=10_000),
        user_id: Optional[str] = Query(None, description="Filter by user id (exact)"),
        current_user: dict = Depends(get_current_user),
    ):
        """Recent minigame Turnstile failures (missing token, verify failed, misconfigured hits). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.captcha_failure_log import CAPTCHA_TURNSTILE_FAILURES_COLLECTION

        coll = db[CAPTCHA_TURNSTILE_FAILURES_COLLECTION]
        q: Dict = {}
        if user_id and str(user_id).strip():
            q = {"user_id": str(user_id).strip()}
        total = await coll.count_documents(q)
        cursor = coll.find(q, {"_id": 0}).sort("at", -1).skip(skip).limit(limit)
        items = await cursor.to_list(limit)
        return {"total": total, "items": items, "limit": limit, "skip": skip}

    @router.post("/admin/swiss-bank/wipe")
    async def admin_swiss_bank_wipe(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Set a user's swiss_balance to 0. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "swiss_balance": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        old_balance = int(target.get("swiss_balance") or 0)
        if old_balance == 0:
            return {"message": f"{target['username']} already has $0 in Swiss Bank."}
        await db.users.update_one({"id": target["id"]}, {"$set": {"swiss_balance": 0}})
        try:
            await srv.log_activity(
                target["id"],
                target.get("username") or "?",
                "admin_swiss_bank_wipe",
                {
                    "old_balance": old_balance,
                    "admin_username": current_user.get("username", "?"),
                },
            )
        except Exception:
            pass
        return {"message": f"Wiped ${old_balance:,} from {target['username']}'s Swiss Bank.", "old_balance": old_balance}

    @router.get("/admin/interest-bank/players")
    async def admin_interest_bank_players(
        include_staff: bool = Query(False, description="If true, include staff deposits (default excludes staff, same as capital breakdown)."),
        limit: int = Query(500, ge=1, le=2000),
        current_user: dict = Depends(get_current_user),
    ):
        """Unclaimed interest-bank deposits aggregated by player, with usernames. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        match_q: Dict = {"claimed_at": None}
        if not include_staff:
            staff_ids = await srv._get_staff_user_ids()
            if staff_ids:
                match_q["user_id"] = {"$nin": list(staff_ids)}
        pipeline = [
            {"$match": match_q},
            {
                "$group": {
                    "_id": "$user_id",
                    "deposit_count": {"$sum": 1},
                    "principal": {"$sum": {"$ifNull": ["$principal", 0]}},
                    "interest_amount": {"$sum": {"$ifNull": ["$interest_amount", 0]}},
                }
            },
            {"$addFields": {"total_locked": {"$add": ["$principal", "$interest_amount"]}}},
            {"$sort": {"total_locked": -1}},
            {"$limit": limit},
            {
                "$lookup": {
                    "from": "users",
                    "localField": "_id",
                    "foreignField": "id",
                    "as": "_u",
                }
            },
            {
                "$addFields": {
                    "username": {"$ifNull": [{"$arrayElemAt": ["$_u.username", 0]}, "?"]},
                }
            },
            {"$project": {"_u": 0}},
        ]
        rows = await db.bank_deposits.aggregate(pipeline).to_list(limit)
        players: List[Dict] = []
        tp = ti = tt = 0
        for r in rows:
            uid = str(r.get("_id") or "")
            principal = int(r.get("principal") or 0)
            interest_amt = int(r.get("interest_amount") or 0)
            total_locked = principal + interest_amt
            tp += principal
            ti += interest_amt
            tt += total_locked
            players.append(
                {
                    "user_id": uid,
                    "username": (r.get("username") or "?") if isinstance(r.get("username"), str) else "?",
                    "deposit_count": int(r.get("deposit_count") or 0),
                    "principal": principal,
                    "interest_amount": interest_amt,
                    "total_locked": total_locked,
                }
            )
        return {
            "players": players,
            "count": len(players),
            "totals": {"principal": tp, "interest": ti, "total_locked": tt},
            "include_staff": include_staff,
            "limit": limit,
        }

    @router.post("/admin/add-loot-pieces")
    async def admin_add_loot_pieces(target_username: str, pieces: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if pieces < 0:
            raise HTTPException(status_code=400, detail="Pieces must be non-negative")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one(
            {"id": target["id"]},
            {"$inc": {"loot_box_pieces": pieces}},
        )
        return {"message": f"Added {pieces} loot box pieces to {target_username}"}

    # Token types and their count fields
    ADMIN_TOKEN_TYPES = {
        "xp_crimes": "xp_crimes_tokens",
        "xp_gta": "xp_gta_tokens",
        "auto_rank_2h": "auto_rank_2h_tokens",
        "melt": "melt_tokens",
        "oc_reduced": "oc_reduced_tokens",
        "booze": "booze_tokens",
        "racket": "racket_tokens",
        "travel": "travel_tokens",
        "properties": "properties_tokens",
        "jailbust_bonus": "jailbust_tokens",
    }

    @router.get("/admin/token-types")
    async def admin_get_token_types(current_user: dict = Depends(get_current_user)):
        """Get list of available token types."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return {"token_types": list(ADMIN_TOKEN_TYPES.keys())}

    @router.get("/admin/user-tokens")
    async def admin_user_tokens(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Inspect a user's full token state: balances, active boosts, expiry, and recent token activity."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        token_fields = {"_id": 0, "id": 1, "username": 1}
        for cfg in TOKEN_CONFIG.values():
            token_fields[cfg["count_field"]] = 1
            token_fields[cfg["until_field"]] = 1
            if cfg.get("expiry_field"):
                token_fields[cfg["expiry_field"]] = 1
        token_fields["tribute_tokens"] = 1
        token_fields["rank_xp_pass_rewards_granted"] = 1
        token_fields["rank_xp_pass_tier_snapshot"] = 1
        token_fields["rank_xp_pass_pending_tier_snapshot"] = 1
        token_fields["rank_xp_pass_last_granted_micro_tier"] = 1
        token_fields["rank_xp_pass_free_last_micro_tier_granted"] = 1
        token_fields["rank_xp_pass_prestige_carry_rp"] = 1
        token_fields["rank_points"] = 1
        target = await db.users.find_one({"username": username_pattern}, token_fields)
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        now = datetime.now(timezone.utc)
        tokens = []
        total_held = 0
        for ttype, cfg in TOKEN_CONFIG.items():
            count = int(target.get(cfg["count_field"]) or 0)
            until_raw = target.get(cfg["until_field"])
            until_iso = str(until_raw) if until_raw else None
            active = False
            expired = False
            if until_iso:
                try:
                    until_dt = datetime.fromisoformat(until_iso.replace("Z", "+00:00"))
                    if until_dt.tzinfo is None:
                        until_dt = until_dt.replace(tzinfo=timezone.utc)
                    active = until_dt > now
                    expired = not active
                except Exception:
                    pass

            entry = {
                "token_type": ttype,
                "label": ttype.replace("_", " ").title(),
                "held": count,
                "active_until": until_iso,
                "boost_active": active,
                "boost_expired": expired,
            }
            if cfg.get("expiry_field"):
                exp_raw = target.get(cfg["expiry_field"])
                exp_iso = str(exp_raw) if exp_raw else None
                token_expired = False
                if exp_iso:
                    try:
                        exp_dt = datetime.fromisoformat(exp_iso.replace("Z", "+00:00"))
                        if exp_dt.tzinfo is None:
                            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                        token_expired = exp_dt <= now
                    except Exception:
                        pass
                entry["token_expires_at"] = exp_iso
                entry["token_expired"] = token_expired
            total_held += count
            tokens.append(entry)

        game_pass = {
            "tokens_held": int(target.get("rank_xp_pass_tokens") or 0),
            "rewards_granted": bool(target.get("rank_xp_pass_rewards_granted")),
            "tier_snapshot": target.get("rank_xp_pass_tier_snapshot"),
            "pending_tier_snapshot": target.get("rank_xp_pass_pending_tier_snapshot"),
            "last_granted_micro_tier": int(target.get("rank_xp_pass_last_granted_micro_tier") or 0),
            "free_last_micro_tier_granted": int(target.get("rank_xp_pass_free_last_micro_tier_granted") or 0),
            "prestige_carry_rp": int(target.get("rank_xp_pass_prestige_carry_rp") or 0),
            "rank_points": int(target.get("rank_points") or 0),
        }

        activity_actions = [
            "store_purchase",
            "inventory_auto_rank_exchange",
        ]
        recent_activity = []
        cursor = db.activity_log.find(
            {"user_id": target["id"], "action": {"$in": activity_actions}},
            {"_id": 0, "action": 1, "details": 1, "created_at": 1},
        ).sort("created_at", -1).limit(50)
        async for doc in cursor:
            details = doc.get("details") or {}
            item = str(details.get("item") or "")
            if "token" in item.lower() or doc.get("action") == "inventory_auto_rank_exchange":
                recent_activity.append(doc)

        point_events = []
        pe_cursor = db.point_ledger_events.find(
            {"user_id": target["id"], "event_ref": {"$regex": "^buy-token"}},
            {"_id": 0, "event_type": 1, "event_ref": 1, "points": 1, "created_at": 1},
        ).sort("created_at", -1).limit(30)
        async for doc in pe_cursor:
            point_events.append(doc)

        return {
            "username": target.get("username"),
            "user_id": target["id"],
            "tokens": tokens,
            "total_held": total_held,
            "tribute_tokens": int(target.get("tribute_tokens") or 0),
            "game_pass": game_pass,
            "recent_token_activity": recent_activity,
            "recent_token_purchases": point_events,
        }

    @router.post("/admin/add-tokens")
    async def admin_add_tokens(
        target_username: str,
        token_type: str,
        amount: int,
        current_user: dict = Depends(get_current_user)
    ):
        """Add tokens to a user. token_type: xp_crimes, xp_gta, auto_rank_2h, melt, oc_reduced, booze, racket, travel, properties, jailbust_bonus. Game Pass: use POST /admin/grant-game-pass."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if token_type not in ADMIN_TOKEN_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid token type. Valid types: {list(ADMIN_TOKEN_TYPES.keys())}")
        if amount < 1:
            raise HTTPException(status_code=400, detail="Amount must be at least 1")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        field = ADMIN_TOKEN_TYPES[token_type]
        await db.users.update_one(
            {"id": target["id"]},
            {"$inc": {field: amount}}
        )
        token_label = token_type.replace("_", " ").title()
        return {"message": f"Added {amount} {token_label} token(s) to {target['username']}"}

    @router.post("/admin/pool-clear-cue-upgrades")
    async def admin_pool_clear_cue_upgrades(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Reset all 8-ball pool cue upgrade levels for every cue instance (power, curve, luck, aim, control, spin, preview)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        zero = {
            "power": 0,
            "curve": 0,
            "luck": 0,
            "aim": 0,
            "control": 0,
            "spin": 0,
            "preview": 0,
        }
        result = await db.pool_cue_upgrades.update_many({"user_id": uid}, {"$set": zero})
        un = target.get("username") or target_username
        return {
            "message": f"Reset 8-ball pool cue upgrades for {un} ({result.matched_count} cue(s); {result.modified_count} document(s) updated).",
            "matched_count": result.matched_count,
            "modified_count": result.modified_count,
        }

    @router.post("/admin/grant-game-pass")
    async def admin_grant_game_pass(
        target_username: str,
        tier_snapshot: Optional[int] = None,
        force: bool = True,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin tool: grant an *unactivated* Game Pass token (rank_xp_pass).
        Activation still happens via Armoury/My Inventory, which will then grant one-time rewards.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one(
            {"username": username_pattern},
            {"_id": 0, "id": 1, "username": 1, "rank_points": 1, "rank_xp_pass_tokens": 1, "rank_xp_pass_token_expires_at": 1, "rank_xp_pass_bonus_until": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        now = datetime.now(timezone.utc)

        def _parse_utc(s: Optional[str]):
            if not s:
                return None
            try:
                dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except Exception:
                return None

        def _add_months(dt: datetime, months: int) -> datetime:
            import calendar

            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)

            y = dt.year + (dt.month - 1 + months) // 12
            m = (dt.month - 1 + months) % 12 + 1
            last_day = calendar.monthrange(y, m)[1]
            d = min(dt.day, last_day)
            return dt.replace(year=y, month=m, day=d)

        expires_dt = _parse_utc(target.get("rank_xp_pass_token_expires_at"))
        unactivated_not_expired = bool(target.get("rank_xp_pass_tokens") and expires_dt and expires_dt > now)

        active_until = _parse_utc(target.get("rank_xp_pass_bonus_until"))
        active_token_not_expired = bool(active_until and active_until > now)

        if (active_token_not_expired or unactivated_not_expired) and not force:
            raise HTTPException(status_code=400, detail="User already has a valid Game Pass token")

        # If the caller doesn't provide a snapshot, use the user's current rank points.
        snap = int(tier_snapshot) if tier_snapshot is not None else int(target.get("rank_points") or 0)
        expires_at = _add_months(now, 1).isoformat()

        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "rank_xp_pass_tokens": 1,
                    "rank_xp_pass_bonus_until": None,
                    "rank_xp_pass_tier_snapshot": None,
                    "rank_xp_pass_token_expires_at": expires_at,
                    "rank_xp_pass_pending_tier_snapshot": snap,
                    "rank_xp_pass_rewards_granted": False,
                    "rank_xp_pass_last_granted_micro_tier": 0,
                    "rank_xp_pass_free_last_micro_tier_granted": 0,
                }
            },
        )

        from routers.kill.armoury import _activate_rank_xp_pass_and_grant_cumulative_micro_tiers
        free_cash_last_micro = int(target.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
        activated = await _activate_rank_xp_pass_and_grant_cumulative_micro_tiers(
            db,
            target["id"],
            snap,
            free_cash_last_micro_tier_granted=free_cash_last_micro,
        )

        un = target.get("username") or target_username
        if activated:
            return {"message": f"Granted and auto-activated Game Pass for {un}. VIP rewards applied."}
        return {"message": f"Granted Game Pass to {un} (activation pending — user should open Armoury)."}

    @router.post("/admin/remove-game-pass")
    async def admin_remove_game_pass(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin: clear Rank-XP / Game Pass entitlement (unactivated token, active window, snapshots).
        User can buy or be granted a pass again afterward.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        unset_gp = {
            "rank_xp_pass_bonus_until": "",
            "rank_xp_pass_token_expires_at": "",
            "rank_xp_pass_tier_snapshot": "",
            "rank_xp_pass_pending_tier_snapshot": "",
            "rank_xp_pass_free_last_micro_tier_granted": "",
        }
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "rank_xp_pass_tokens": 0,
                    "rank_xp_pass_rewards_granted": False,
                    "rank_xp_pass_last_granted_micro_tier": 0,
                },
                "$unset": unset_gp,
            },
        )
        un = target.get("username") or target_username
        return {
            "message": f"Removed Game Pass state for {un}. They can purchase or receive a grant again anytime.",
        }

    @router.post("/admin/reconcile-game-pass-tiers")
    async def admin_reconcile_game_pass_tiers(
        target_username: str,
        ignore_token_expiry: bool = Query(False),
        rewind_last_granted_to: Optional[int] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Grant any missing VIP Game Pass micro-tier rewards for the user's current rank XP
        (same logic as passive middleware). Use after bugfixes or stuck cursors.

        ignore_token_expiry: if True, also run when the Game Pass token date has passed (support only).
        rewind_last_granted_to: if set (0..100), sets rank_xp_pass_last_granted_micro_tier first
        (e.g. 0 to re-apply tiers after a bad cursor advance with no payout).
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        if rewind_last_granted_to is not None:
            from utils.game_pass_micro_rewards import MAX_MICRO_TIER

            try:
                rw = int(rewind_last_granted_to)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="rewind_last_granted_to must be an integer")
            rw = max(0, min(int(MAX_MICRO_TIER), rw))
            await db.users.update_one(
                {"id": target["id"]},
                {"$set": {"rank_xp_pass_last_granted_micro_tier": rw}},
            )
            target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
            if not target:
                raise HTTPException(status_code=404, detail="User not found")

        from utils.game_pass_tier_reconcile import grant_missing_vip_micro_tier_rewards

        result = await grant_missing_vip_micro_tier_rewards(
            db,
            target["id"],
            target,
            send_notifications=True,
            ignore_token_expiry=ignore_token_expiry,
        )
        un = target.get("username") or target_username
        if not result.get("ok"):
            reason = result.get("reason") or "unknown"
            if reason == "not_vip_claimed":
                raise HTTPException(
                    status_code=400,
                    detail=f"{un} has not activated Game Pass (VIP rewards not claimed).",
                )
            if reason == "vip_token_expired_or_inactive":
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{un}: Game Pass token window expired. "
                        "Retry with ignore_token_expiry=true only if you intend to grant missing tiers anyway."
                    ),
                )
            raise HTTPException(status_code=400, detail=reason)

        tiers = result.get("tiers_granted") or []
        reason = result.get("reason")
        repaired = result.get("cursor_repaired", False)
        if reason == "already_caught_up":
            msg = f"{un}: already up to date (micro tier {result.get('current_micro')}, last granted {result.get('last_granted')})."
        elif repaired and tiers:
            msg = f"{un}: cursor was ahead of progress — repaired and granted VIP tier reward(s) for micro tier(s) {tiers}."
        elif tiers:
            msg = f"{un}: granted VIP tier reward(s) for micro tier(s) {tiers}."
        else:
            msg = f"{un}: reconcile ran; no new tiers to grant."
        return {**result, "message": msg}

    @router.post("/admin/force-grant-game-pass-rewards")
    async def admin_force_grant_game_pass_rewards(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Force-grant VIP Game Pass rewards for all completed tiers.
        Bypasses all guards: resets cursor, computes rewards, directly $inc's them.
        Use when normal reconcile/activation doesn't credit rewards.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        from utils.game_pass_micro_rewards import (
            micro_tier_for_vip_game_pass,
            vip_rewards_after_free_dedupe,
        )

        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        uid = target["id"]
        un = target.get("username", target_username)
        rank_points = int(target.get("rank_points") or 0)
        current_micro = micro_tier_for_vip_game_pass(target)
        free_last = int(target.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
        old_last_granted = int(target.get("rank_xp_pass_last_granted_micro_tier") or 0)

        if current_micro <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"{un} has 0 completed micro tiers (rank_points={rank_points}, carry={int(target.get('rank_xp_pass_prestige_carry_rp') or 0)})",
            )

        total_inc: Dict[str, int] = {}
        tier_detail = []
        for t in range(1, current_micro + 1):
            rewards = vip_rewards_after_free_dedupe(t, free_last)
            for k, v in rewards.items():
                v = int(v or 0)
                if v > 0:
                    total_inc[k] = total_inc.get(k, 0) + v
            tier_detail.append({"tier": t, "rewards": {k: int(v) for k, v in rewards.items() if int(v or 0) > 0}})

        update_set = {
            "rank_xp_pass_rewards_granted": True,
            "rank_xp_pass_last_granted_micro_tier": current_micro,
        }
        update: Dict[str, Any] = {"$set": update_set}
        if total_inc:
            update["$inc"] = total_inc

        await db.users.update_one({"id": uid}, update)

        return {
            "message": f"Force-granted {un}: tiers 1–{current_micro} rewards credited. Old cursor was {old_last_granted}, now {current_micro}.",
            "username": un,
            "rank_points": rank_points,
            "current_micro": current_micro,
            "old_last_granted": old_last_granted,
            "total_credited": total_inc,
            "tier_detail": tier_detail,
        }

    @router.get("/admin/deleted-messages/{username}")
    async def admin_deleted_messages(
        username: str,
        limit_count: int = Query(100, ge=1, le=500),
        source_filter: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        """View a user's last N deleted messages from the archive."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        username_pattern = _username_pattern(username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        uid = target["id"]
        filt: Dict[str, Any] = {"user_id": uid}
        if source_filter:
            filt["source"] = source_filter

        cursor = db.deleted_messages_archive.find(filt, {"_id": 0}).sort("deleted_at", -1).limit(limit_count)
        rows = await cursor.to_list(length=limit_count)
        return {
            "username": target.get("username"),
            "user_id": uid,
            "count": len(rows),
            "messages": rows,
        }

    @router.get("/admin/user-inbox/{username}")
    async def admin_user_inbox(
        username: str,
        limit_count: int = Query(100, ge=1, le=200),
        scope: str = Query(
            "inbox",
            description="inbox = notifications except sent-folder copies; sent = outgoing DMs only; all = every row for this user_id",
        ),
        current_user: dict = Depends(get_current_user),
    ):
        """Admin: read live notifications collection for a player (same store as Social → Inbox)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        s = (scope or "inbox").strip().lower()
        if s not in ("inbox", "sent", "all"):
            raise HTTPException(status_code=400, detail="scope must be inbox, sent, or all")
        username_pattern = _username_pattern(username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        filt: Dict[str, Any] = {"user_id": uid}
        if s == "inbox":
            filt["notification_type"] = {"$ne": "user_message_sent"}
        elif s == "sent":
            filt["notification_type"] = "user_message_sent"
        cursor = db.notifications.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit_count)
        rows = await cursor.to_list(length=limit_count)
        unread = sum(1 for r in rows if not r.get("read")) if s != "sent" else 0
        return {
            "username": target.get("username"),
            "user_id": uid,
            "scope": s,
            "count": len(rows),
            "unread_count": unread,
            "notifications": rows,
        }

    @router.delete("/admin/user-inbox/{username}/notifications/{notification_id}")
    async def admin_delete_user_notification(
        username: str,
        notification_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Admin: delete one notification row for a player (archives then removes; same as user's own delete)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        nid = (notification_id or "").strip()
        if not nid:
            raise HTTPException(status_code=400, detail="notification_id required")
        username_pattern = _username_pattern(username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        doc = await db.notifications.find_one({"id": nid, "user_id": uid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Notification not found")
        from utils.deleted_messages_archive import archive_message
        from routers.game.notifications import invalidate_notifications_list_cache_for_user

        await archive_message(
            source="notification",
            doc=doc,
            deleted_by_id=current_user.get("id"),
            deleted_by_username=current_user.get("username"),
            reason="admin_user_inbox_delete",
        )
        await db.notifications.delete_one({"id": nid, "user_id": uid})
        invalidate_notifications_list_cache_for_user(uid)
        return {"message": "Notification deleted", "id": nid}

    @router.get("/admin/game-pass/stuck-cursors")
    async def admin_game_pass_stuck_cursors(
        fix: bool = Query(False),
        current_user: dict = Depends(get_current_user),
    ):
        """Find VIP users whose last_granted cursor is ahead of their actual micro tier (broken state).
        fix=true: force-grants rewards directly to each stuck user's account."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.game_pass_micro_rewards import micro_tier_for_vip_game_pass, vip_rewards_after_free_dedupe

        cursor = db.users.find(
            {"rank_xp_pass_rewards_granted": True, "rank_xp_pass_last_granted_micro_tier": {"$gt": 0}},
            {"_id": 0, "id": 1, "username": 1, "rank_points": 1, "rank_xp_pass_prestige_carry_rp": 1,
             "rank_xp_pass_last_granted_micro_tier": 1,
             "rank_xp_pass_token_expires_at": 1, "rank_xp_pass_free_last_micro_tier_granted": 1,
             "rank_xp_pass_rewards_granted": 1},
        )
        rows = await cursor.to_list(length=5000)

        stuck: List[Dict[str, Any]] = []
        fixed: List[str] = []
        for row in rows:
            current_micro = micro_tier_for_vip_game_pass(row)
            last_granted = int(row.get("rank_xp_pass_last_granted_micro_tier") or 0)
            if last_granted <= current_micro:
                continue
            entry = {
                "username": row.get("username"),
                "rank_points": int(row.get("rank_points") or 0),
                "rank_xp_pass_prestige_carry_rp": int(row.get("rank_xp_pass_prestige_carry_rp") or 0),
                "current_micro": current_micro,
                "last_granted": last_granted,
                "gap": last_granted - current_micro,
            }
            stuck.append(entry)

            if fix and current_micro > 0:
                free_last = int(row.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
                total_inc: Dict[str, int] = {}
                for t in range(1, current_micro + 1):
                    rewards = vip_rewards_after_free_dedupe(t, free_last)
                    for k, v in rewards.items():
                        v = int(v or 0)
                        if v > 0:
                            total_inc[k] = total_inc.get(k, 0) + v
                update: Dict[str, Any] = {
                    "$set": {
                        "rank_xp_pass_rewards_granted": True,
                        "rank_xp_pass_last_granted_micro_tier": current_micro,
                    }
                }
                if total_inc:
                    update["$inc"] = total_inc
                await db.users.update_one({"id": row["id"]}, update)
                entry["fix_result"] = "force_granted"
                entry["credited"] = total_inc
                fixed.append(row.get("username", "?"))

        stuck.sort(key=lambda x: x["gap"], reverse=True)
        return {
            "stuck_count": len(stuck),
            "fixed_count": len(fixed),
            "fixed_users": fixed,
            "stuck_users": stuck,
        }

    @router.get("/admin/game-pass/users")
    async def admin_game_pass_users_list(
        skip: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=100),
        q: Optional[str] = Query(None),
        without_stripe_purchase: bool = Query(
            False,
            description="Only users with token/VIP-style pass and no completed Stripe rank_xp_pass_499 payment",
        ),
        current_user: dict = Depends(get_current_user),
    ):
        """List users with any Game Pass–related state (admin only)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.game_pass_admin_inspect import (
            GAME_PASS_USER_PROJECTION,
            aggregate_game_pass_users_without_stripe_purchase,
            aggregate_latest_game_pass_entitlement_iso,
            escape_regex_fragment,
            game_pass_derived_fields,
            game_pass_mongo_filter,
        )
        from utils.game_pass_season_rp import (
            current_game_pass_season_id,
            reconcile_stale_game_pass_users_for_filter,
        )

        now = datetime.now(timezone.utc)
        esc = escape_regex_fragment(q or "") or None

        if without_stripe_purchase:
            out = await aggregate_game_pass_users_without_stripe_purchase(
                db,
                skip=skip,
                limit=limit,
                username_regex=esc,
                now_utc=now,
            )
            return {**out, "skip": skip, "limit": limit}

        filt = game_pass_mongo_filter()
        if esc:
            filt = {"$and": [filt, {"username": {"$regex": esc, "$options": "i"}}]}
        await reconcile_stale_game_pass_users_for_filter(db, filt)
        current_sid = await current_game_pass_season_id(db)
        cursor = db.users.find(filt, GAME_PASS_USER_PROJECTION).sort("username", 1).skip(skip).limit(limit)
        rows = await cursor.to_list(length=limit)
        uids = [str(r["id"]) for r in rows if r.get("id")]
        latest_stripe = await aggregate_latest_game_pass_entitlement_iso(db, uids)
        items: List[Dict[str, Any]] = []
        proj_keys = [k for k in GAME_PASS_USER_PROJECTION if k != "_id"]
        for row in rows:
            derived = game_pass_derived_fields(row, now_utc=now, current_season_id=current_sid)
            base = {k: row.get(k) for k in proj_keys}
            uid = str(row.get("id") or "")
            items.append(
                {
                    **base,
                    **derived,
                    "last_stripe_pass_entitled_at": latest_stripe.get(uid),
                }
            )
        total = await db.users.count_documents(filt)
        return {
            "items": items,
            "total": total,
            "skip": skip,
            "limit": limit,
            "list_mode": "all",
        }

    @router.get("/admin/game-pass/user")
    async def admin_game_pass_user_inspect(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Drill-down: Game Pass fields, derived status, Stripe txns, purchase source, optional entitlement estimate."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.game_pass_admin_inspect import (
            GAME_PASS_USER_PROJECTION,
            classify_purchase_source,
            estimate_entitlement_from_token_expiry,
            fetch_game_pass_payment_events,
            fetch_latest_points_game_pass_purchase,
            game_pass_derived_fields,
        )
        from utils.game_pass_season_rp import (
            current_game_pass_season_id,
            reconcile_user_game_pass_season_if_stale,
        )

        username_pattern = _username_pattern(target_username)
        u = await db.users.find_one({"username": username_pattern}, GAME_PASS_USER_PROJECTION)
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        await reconcile_user_game_pass_season_if_stale(db, user_id=str(u.get("id") or ""))
        u = await db.users.find_one({"username": username_pattern}, GAME_PASS_USER_PROJECTION)
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        now = datetime.now(timezone.utc)
        current_sid = await current_game_pass_season_id(db)
        derived = game_pass_derived_fields(u, now_utc=now, current_season_id=current_sid)
        uid = str(u["id"])
        events = await fetch_game_pass_payment_events(db, uid)
        points_gp_ledger = await fetch_latest_points_game_pass_purchase(db, uid)
        purchase_source = classify_purchase_source(
            events,
            u,
            has_points_game_pass_ledger=bool(points_gp_ledger),
        )
        estimated = None
        if not events and u.get("rank_xp_pass_token_expires_at"):
            estimated = estimate_entitlement_from_token_expiry(u.get("rank_xp_pass_token_expires_at"))
        proj_keys = [k for k in GAME_PASS_USER_PROJECTION if k != "_id"]
        user_out = {k: u.get(k) for k in proj_keys}
        return {
            "user": user_out,
            "derived": derived,
            "stripe_game_pass_events": events,
            "points_game_pass_ledger_latest": points_gp_ledger,
            "purchase_source": purchase_source,
            "estimated_entitlement": estimated,
        }

    @router.get("/admin/game-pass/points-diagnostic")
    async def admin_game_pass_points_diagnostic(
        target_username: Optional[str] = Query(None),
        target_user_id: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        """Detailed Game Pass points/reward diagnostic for one user."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not (target_username or target_user_id):
            raise HTTPException(status_code=400, detail="Provide target_username or target_user_id")
        from utils.game_pass_points_diagnostic import (
            build_game_pass_points_diagnostic,
            game_pass_points_projection,
        )

        proj = game_pass_points_projection()
        user = None
        if target_user_id:
            user = await db.users.find_one({"id": str(target_user_id).strip()}, proj)
        if not user and target_username:
            username_pattern = _username_pattern(target_username)
            user = await db.users.find_one({"username": username_pattern}, proj)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return await build_game_pass_points_diagnostic(db, user)

    @router.get("/admin/game-pass/first-vip-completion-preview")
    async def admin_first_vip_completion_preview(current_user: dict = Depends(get_current_user)):
        """Preview one-time bulk grant of VIP tiers (last_granted+1..100) for all VIP-claimed users."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.game_pass_first_vip_completion import preview_first_vip_completion

        return await preview_first_vip_completion(db)

    class FirstVipCompletionRunRequest(BaseModel):
        confirm: str = Field(..., min_length=1)
        dry_run: bool = False

    @router.post("/admin/game-pass/first-vip-completion-run")
    async def admin_first_vip_completion_run(
        req: FirstVipCompletionRunRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """
        One-time: credit all missing VIP micro-tier rewards through tier 100 and set cursor to 100.
        Live run is blocked after the first successful completion (game_settings).
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from server import send_notification
        from routers.kill.armoury import _try_grant_rank_xp_pass_micro_tier
        from utils.game_pass_first_vip_completion import (
            FIRST_GAME_PASS_CONFIRM_PHRASE,
            aggregate_vip_increment_after_cursor,
            eligible_vip_users_filter,
            first_vip_completion_user_projection,
            get_first_vip_completion_record,
            set_first_vip_completion_record,
        )
        from utils.game_pass_micro_rewards import MAX_MICRO_TIER, format_rewards_summary

        if (req.confirm or "").strip() != FIRST_GAME_PASS_CONFIRM_PHRASE:
            raise HTTPException(
                status_code=400,
                detail=f'Confirmation must be exactly: {FIRST_GAME_PASS_CONFIRM_PHRASE}',
            )

        record = await get_first_vip_completion_record(db)
        if not req.dry_run and record and record.get("live_completed_at"):
            raise HTTPException(
                status_code=409,
                detail="This one-time completion has already been run live. See completion_record on preview.",
            )

        filt = eligible_vip_users_filter()
        proj = first_vip_completion_user_projection()
        live_updated = 0
        skipped_complete = 0
        skipped_no_op = 0
        dry_would_receive = 0
        dry_run_samples: List[Dict[str, Any]] = []
        run_id = str(uuid.uuid4())
        admin_un = current_user.get("username", "?")

        async for row in db.users.find(filt, proj):
            uid = str(row.get("id") or "")
            if not uid:
                continue
            last = int(row.get("rank_xp_pass_last_granted_micro_tier") or 0)
            if last >= MAX_MICRO_TIER:
                skipped_complete += 1
                continue
            free_last = int(row.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
            inc = aggregate_vip_increment_after_cursor(last, free_last)
            un = row.get("username") or uid

            if req.dry_run:
                dry_would_receive += 1
                if len(dry_run_samples) < 50:
                    dry_run_samples.append(
                        {
                            "username": un,
                            "user_id": uid,
                            "last_granted_before": last,
                            "tiers_to_credit": MAX_MICRO_TIER - last,
                            "increment_keys": sorted(inc.keys()),
                            "increment_preview": {k: inc[k] for k in sorted(inc.keys())[:12]},
                        }
                    )
                continue

            points_delta = 0
            notify_totals: Dict[str, int] = {}
            for t in range(last + 1, MAX_MICRO_TIER + 1):
                applied = await _try_grant_rank_xp_pass_micro_tier(
                    db,
                    user_id=uid,
                    micro_tier=t,
                    free_cash_last_micro_tier_granted=free_last,
                )
                if not applied:
                    break
                points_delta += int(applied.get("points") or 0)
                for k, v in applied.items():
                    iv = int(v or 0)
                    if iv > 0:
                        notify_totals[k] = notify_totals.get(k, 0) + iv

            u_done = await db.users.find_one(
                {"id": uid},
                {"_id": 0, "rank_xp_pass_last_granted_micro_tier": 1},
            )
            if int((u_done or {}).get("rank_xp_pass_last_granted_micro_tier") or 0) < MAX_MICRO_TIER:
                skipped_no_op += 1
                continue

            live_updated += 1
            if points_delta != 0:
                before_pts = int(row.get("points") or 0)
                after_pts = before_pts + points_delta
                await log_points_event(
                    db,
                    user_id=uid,
                    points=points_delta,
                    event_type="first_game_pass_vip_completion",
                    event_ref=run_id,
                    meta={"admin": admin_un, "run_id": run_id},
                    wallet_points_before=before_pts,
                    wallet_points_after=after_pts,
                )
            summary = format_rewards_summary(notify_totals).strip() if notify_totals else ""
            body = (
                f"One-time first-season bonus: all remaining VIP Game Pass tier rewards through tier {MAX_MICRO_TIER} have been credited."
                + (f" {summary}" if summary else "")
            )
            await send_notification(
                uid,
                "First Game Pass bonus",
                body,
                "reward",
                tier_micro=MAX_MICRO_TIER,
                admin_run_id=run_id,
            )

        if not req.dry_run:
            now_iso = datetime.now(timezone.utc).isoformat()
            await set_first_vip_completion_record(
                db,
                {
                    "live_completed_at": now_iso,
                    "set_by": admin_un,
                    "run_id": run_id,
                    "affected_user_count": live_updated,
                    "skipped_already_complete": skipped_complete,
                    "skipped_no_op": skipped_no_op,
                    "dry_run": False,
                },
            )

        return {
            "dry_run": req.dry_run,
            "run_id": run_id,
            "would_receive_grant": dry_would_receive if req.dry_run else None,
            "live_updated_count": live_updated if not req.dry_run else None,
            "skipped_already_complete": skipped_complete,
            "skipped_no_op": skipped_no_op if not req.dry_run else None,
            "dry_run_samples": dry_run_samples if req.dry_run else [],
            "message": (
                f"Dry run: {dry_would_receive} user(s) would receive grants (sample up to 50); {skipped_complete} already at max tier."
                if req.dry_run
                else f"Live run complete: {live_updated} user(s) updated; {skipped_complete} already at max tier; {skipped_no_op} no-op."
            ),
        }

    @router.post("/admin/add-car")
    async def admin_add_car(target_username: str, car_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        car = next((c for c in CARS if c["id"] == car_id), None)
        if not car:
            raise HTTPException(status_code=404, detail="Car not found")
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.user_cars.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": target["id"],
                "car_id": car_id,
                "car_name": car["name"],
                "acquired_at": now_iso,
            }
        )
        if car.get("rarity") in ("exclusive", "loot_exclusive"):
            from utils.civilian_protection import maybe_revoke_civilian_protection

            await maybe_revoke_civilian_protection(db, target["id"], "exclusive_car")
        return {"message": f"Added {car['name']} to {target_username}'s garage"}

    @router.post("/admin/remove-car")
    async def admin_remove_car(target_username: str, car_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        car = next((c for c in CARS if c["id"] == car_id), None)
        if not car:
            raise HTTPException(status_code=404, detail="Car not found")
        result = await db.user_cars.delete_many({"user_id": target["id"], "car_id": car_id})
        removed = int(result.deleted_count or 0)
        return {
            "message": f"Removed {removed} {car['name']} from {target.get('username', target_username)}",
            "removed_count": removed,
            "car_id": car_id,
            "car_name": car["name"],
            "target_username": target.get("username", target_username),
        }

    @router.post("/admin/add-random-cars")
    async def admin_add_random_cars(target_username: str, count: int = 1000, current_user: dict = Depends(get_current_user)):
        """Give a user N random cars (default 1000). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        try:
            n = int(count)
        except (TypeError, ValueError):
            n = 1000
        n = max(1, min(5000, n))
        catalog = [c for c in (CARS or []) if c.get("id") and c.get("name")]
        if not catalog:
            raise HTTPException(status_code=500, detail="Car catalog is empty")

        now_iso = datetime.now(timezone.utc).isoformat()
        rng = uuid.uuid4  # fast unique ids; reuse stdlib
        import random
        docs = []
        uid = target["id"]
        for _ in range(n):
            c = random.choice(catalog)
            docs.append(
                {
                    "id": str(rng()),
                    "user_id": uid,
                    "car_id": c["id"],
                    "car_name": c["name"],
                    "acquired_at": now_iso,
                }
            )
        await db.user_cars.insert_many(docs, ordered=False)
        return {"message": f"Added {n:,} random car(s) to {target_username}'s garage", "count": n}

    GTA_EXCLUSIVE_POOL_CONFIG_ID = "gta_exclusive"
    GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT = 0.000006
    GTA_EXCLUSIVE_DROP_WEIGHT_MIN = 0.0000001
    GTA_EXCLUSIVE_DROP_WEIGHT_MAX = 0.05

    @router.get("/admin/gta/exclusive-pool")
    async def admin_gta_exclusive_pool_get(current_user: dict = Depends(get_current_user)):
        """Get whether the Al Capone exclusive is released into the GTA car pool. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_config.find_one({"id": GTA_EXCLUSIVE_POOL_CONFIG_ID}, {"_id": 0, "released": 1, "drop_weight": 1})
        drop_weight = float((doc or {}).get("drop_weight") or GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT)
        drop_weight = max(GTA_EXCLUSIVE_DROP_WEIGHT_MIN, min(GTA_EXCLUSIVE_DROP_WEIGHT_MAX, drop_weight))
        approx_one_in = int(round(1.0 / drop_weight)) if drop_weight > 0 else 0
        return {
            "released": bool(doc.get("released") if doc else False),
            "drop_weight": drop_weight,
            "approx_one_in": approx_one_in,
            "min_drop_weight": GTA_EXCLUSIVE_DROP_WEIGHT_MIN,
            "max_drop_weight": GTA_EXCLUSIVE_DROP_WEIGHT_MAX,
        }

    @router.post("/admin/gta/exclusive-pool")
    async def admin_gta_exclusive_pool_set(body: GTAExclusivePoolRequest, current_user: dict = Depends(get_current_user)):
        """Release or retract the Al Capone exclusive (car20) into the GTA car pool. When released, it can drop from any successful GTA tier (very rare); only 1 in game at a time. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        updates = {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID, "released": body.released}
        if body.drop_weight is not None:
            dw = float(body.drop_weight)
            if dw < GTA_EXCLUSIVE_DROP_WEIGHT_MIN or dw > GTA_EXCLUSIVE_DROP_WEIGHT_MAX:
                raise HTTPException(
                    status_code=400,
                    detail=f"drop_weight must be between {GTA_EXCLUSIVE_DROP_WEIGHT_MIN} and {GTA_EXCLUSIVE_DROP_WEIGHT_MAX}",
                )
            updates["drop_weight"] = dw
        await db.game_config.update_one(
            {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID},
            {"$set": updates},
            upsert=True,
        )
        cfg = await db.game_config.find_one({"id": GTA_EXCLUSIVE_POOL_CONFIG_ID}, {"_id": 0, "drop_weight": 1})
        drop_weight = float((cfg or {}).get("drop_weight") or GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT)
        drop_weight = max(GTA_EXCLUSIVE_DROP_WEIGHT_MIN, min(GTA_EXCLUSIVE_DROP_WEIGHT_MAX, drop_weight))
        approx_one_in = int(round(1.0 / drop_weight)) if drop_weight > 0 else 0
        return {
            "message": f"Al Capone exclusive {'released into' if body.released else 'retracted from'} GTA car pool",
            "released": body.released,
            "drop_weight": drop_weight,
            "approx_one_in": approx_one_in,
        }

    @router.post("/admin/give-everyone-exclusive-cars")
    async def admin_give_everyone_exclusive_cars(body: GiveEveryoneExclusiveCarsRequest, current_user: dict = Depends(get_current_user)):
        """Give every user the selected exclusive car(s) if they don't already have them. loot_exclusive = car21, al_capone = car20. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not body.loot_exclusive and not body.al_capone:
            raise HTTPException(status_code=400, detail="Select at least one: loot_exclusive or al_capone")
        now_iso = datetime.now(timezone.utc).isoformat()
        cars_to_give = []
        if body.loot_exclusive:
            c = next((x for x in CARS if x.get("id") == "car21"), None)
            if c:
                cars_to_give.append(("car21", c["name"]))
        if body.al_capone:
            c = next((x for x in CARS if x.get("id") == "car20"), None)
            if c:
                cars_to_give.append(("car20", c["name"]))
        if not cars_to_give:
            raise HTTPException(status_code=400, detail="Exclusive car(s) not found in catalog")
        users = await db.users.find({}, {"_id": 0, "id": 1}).to_list(100_000)
        given = {car_id: 0 for car_id, _ in cars_to_give}
        skipped = {car_id: 0 for car_id, _ in cars_to_give}
        for u in users:
            user_id = u.get("id")
            if not user_id:
                continue
            for car_id, car_name in cars_to_give:
                existing = await db.user_cars.find_one({"user_id": user_id, "car_id": car_id}, {"_id": 1})
                if existing:
                    skipped[car_id] += 1
                else:
                    await db.user_cars.insert_one({
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "car_id": car_id,
                        "car_name": car_name,
                        "acquired_at": now_iso,
                    })
                    given[car_id] += 1
        msg_parts = []
        if body.loot_exclusive:
            msg_parts.append(f"Loot exclusive (car21): {given['car21']} given, {skipped['car21']} already had")
        if body.al_capone:
            msg_parts.append(f"Al Capone (car20): {given['car20']} given, {skipped['car20']} already had")
        return {
            "message": "; ".join(msg_parts),
            "given": given,
            "skipped": skipped,
            "total_users": len(users),
        }

    @router.get("/admin/cars/values")
    async def admin_get_car_values(current_user: dict = Depends(get_current_user)):
        """Get all exclusive/loot_exclusive cars with their current values. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = []
        for c in CARS:
            if c.get("rarity") in ("exclusive", "loot_exclusive"):
                result.append({
                    "id": c["id"],
                    "name": c["name"],
                    "rarity": c["rarity"],
                    "value": c.get("value", 0),
                    "travel_bonus": c.get("travel_bonus", 0),
                })
        return {"cars": result}

    @router.get("/admin/cars/exclusive-owners")
    async def admin_get_exclusive_car_owners(current_user: dict = Depends(get_current_user)):
        """List who owns each exclusive / loot-exclusive car. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        exclusive_cars = [c for c in (CARS or []) if c.get("rarity") in ("exclusive", "loot_exclusive")]
        if not exclusive_cars:
            return {"cars": []}
        car_map = {c.get("id"): c for c in exclusive_cars if c.get("id")}
        car_ids = list(car_map.keys())
        per_car: Dict[str, Dict[str, Any]] = {
            cid: {
                "car_id": cid,
                "name": (car_map.get(cid) or {}).get("name") or cid,
                "rarity": (car_map.get(cid) or {}).get("rarity") or "",
                "owners_count": 0,
                "owned_count_total": 0,
                "owners": [],
            }
            for cid in car_ids
        }
        pipeline = [
            {"$match": {"car_id": {"$in": car_ids}}},
            {"$group": {"_id": {"car_id": "$car_id", "user_id": "$user_id"}, "owned_count": {"$sum": 1}}},
        ]
        rows = await db.user_cars.aggregate(pipeline).to_list(50_000)
        if not rows:
            return {"cars": list(per_car.values())}
        user_ids = sorted({r.get("_id", {}).get("user_id") for r in rows if r.get("_id", {}).get("user_id")})
        users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(60_000)
        usernames = {u.get("id"): u.get("username") or "?" for u in users}
        for r in rows:
            rid = r.get("_id") or {}
            cid = rid.get("car_id")
            uid = rid.get("user_id")
            if not cid or not uid or cid not in per_car:
                continue
            owned_count = int(r.get("owned_count") or 0)
            per_car[cid]["owners"].append(
                {"user_id": uid, "username": usernames.get(uid, "?"), "owned_count": owned_count}
            )
            per_car[cid]["owners_count"] += 1
            per_car[cid]["owned_count_total"] += owned_count
        for cid in per_car.keys():
            per_car[cid]["owners"] = sorted(
                per_car[cid]["owners"],
                key=lambda x: (-int(x.get("owned_count") or 0), (x.get("username") or "").lower()),
            )
        cars_out = sorted(
            per_car.values(),
            key=lambda x: (-int(x.get("owners_count") or 0), (x.get("name") or "").lower()),
        )
        return {"cars": cars_out}

    @router.post("/admin/cars/edit-value")
    async def admin_edit_car_value(body: EditCarValueRequest, current_user: dict = Depends(get_current_user)):
        """Edit the value and/or travel bonus of an exclusive car. Persists across restarts."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        car = next((c for c in CARS if c["id"] == body.car_id), None)
        if not car:
            raise HTTPException(status_code=404, detail=f"Car '{body.car_id}' not found")
        if car.get("rarity") not in ("exclusive", "loot_exclusive"):
            raise HTTPException(status_code=400, detail="Only exclusive and loot-exclusive cars can be edited")
        if body.value < 0:
            raise HTTPException(status_code=400, detail="Value must be >= 0")

        old_value = car.get("value", 0)
        old_travel = car.get("travel_bonus", 0)
        car["value"] = body.value
        if body.travel_bonus is not None:
            car["travel_bonus"] = max(0, body.travel_bonus)

        override = {"value": car["value"], "travel_bonus": car["travel_bonus"]}
        await db.game_config.update_one(
            {"id": f"car_override_{body.car_id}"},
            {"$set": {"car_id": body.car_id, "overrides": override}},
            upsert=True,
        )

        return {
            "message": f"Updated {car['name']}: value ${old_value:,} -> ${car['value']:,}" + (f", travel {old_travel} -> {car['travel_bonus']}" if body.travel_bonus is not None else ""),
            "car_id": body.car_id,
            "name": car["name"],
            "value": car["value"],
            "travel_bonus": car["travel_bonus"],
        }

    @router.post("/admin/slots/set-draw-in-minutes")
    async def admin_slots_set_draw_in_minutes(minutes: int = 1, current_user: dict = Depends(get_current_user)):
        """Set next_draw_at to now + minutes for all states (testing)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        next_at = (now + timedelta(minutes=max(1, min(minutes, 60 * 24)))).isoformat()
        for state in (STATES or []):
            await db.slots_ownership.update_one(
                {"state": state},
                {"$set": {"state": state, "next_draw_at": next_at}},
                upsert=True,
            )
        return {"message": f"Next slots draw set to {minutes} minute(s) from now (all states)"}

    @router.post("/admin/slots/reset-draw-default")
    async def admin_slots_reset_draw_default(current_user: dict = Depends(get_current_user)):
        """Reset next_draw_at to next 3h on the hour (00:00, 03:00, 06:00, … UTC) for all states."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.casinos.slots import get_next_slots_draw_on_the_hour_utc
        next_at = get_next_slots_draw_on_the_hour_utc()
        for state in (STATES or []):
            await db.slots_ownership.update_one(
                {"state": state},
                {"$set": {"state": state, "next_draw_at": next_at}},
                upsert=True,
            )
        return {"message": "Slots draw reset to default (every 3h on the hour) for all states"}

    @router.post("/admin/slots/clear-cooldowns")
    async def admin_slots_clear_cooldowns(current_user: dict = Depends(get_current_user)):
        """Clear slots_cooldown_until for all users so everyone can enter/win the draw again. For testing."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        # Unset for ALL users (no filter) so we clear the field regardless of how it was stored
        result = await db.users.update_many(
            {},
            {"$unset": {"slots_cooldown_until": ""}},
        )
        return {"message": f"Slots cooldown cleared for {result.modified_count} user(s). They are eligible for the next draw."}

    @router.get("/admin/crack-safe/jackpot")
    async def admin_crack_safe_jackpot_get(current_user: dict = Depends(get_current_user)):
        """Current Crack the Safe global jackpot (safe_game document)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        safe = await _crack_safe_mod._get_or_create_safe()
        return {
            "jackpot": int(safe.get("jackpot") or 0),
            "seed_default": _CRACK_SAFE_JACKPOT_SEED,
            "total_attempts": int(safe.get("total_attempts") or 0),
        }

    @router.post("/admin/crack-safe/set-jackpot")
    async def admin_crack_safe_jackpot_set(
        body: CrackSafeJackpotSetRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Set the global Crack the Safe jackpot (e.g. lower the pot without a win)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        await _crack_safe_mod._get_or_create_safe()
        new_j = int(body.jackpot)
        await db.safe_game.update_one({}, {"$set": {"jackpot": new_j}})
        return {
            "message": f"Crack the Safe jackpot set to ${new_j:,}.",
            "jackpot": new_j,
        }

    @router.get("/admin/lottery/rounds")
    async def admin_lottery_rounds_list(limit: int = 50, current_user: dict = Depends(get_current_user)):
        """Admin: recent lottery rounds (ids + summary) for money-trail audit."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        lim = max(1, min(int(limit or 50), 100))
        cursor = db.lottery_rounds.find(
            {},
            {
                "_id": 1,
                "status": 1,
                "closes_at": 1,
                "drawn_at": 1,
                "created_at": 1,
                "ticket_count": 1,
                "gross_pot": 1,
                "sink_amount": 1,
                "payout": 1,
                "exact_match_count": 1,
                "winner_username": 1,
                "rollover_to_next": 1,
            },
        ).sort("_id", -1).limit(lim)
        rows = await cursor.to_list(lim)
        out = []
        for r in rows:
            rid = r.get("_id")
            out.append(
                {
                    "round_id": str(rid),
                    "status": r.get("status"),
                    "closes_at": r.get("closes_at"),
                    "drawn_at": r.get("drawn_at"),
                    "created_at": r.get("created_at"),
                    "ticket_count": r.get("ticket_count"),
                    "gross_pot": r.get("gross_pot"),
                    "sink_amount": r.get("sink_amount"),
                    "payout": r.get("payout"),
                    "exact_match_count": r.get("exact_match_count"),
                    "winner_username": r.get("winner_username"),
                    "rollover_to_next": r.get("rollover_to_next"),
                }
            )
        return {"rounds": out, "ticket_price": lottery_audit_mod.TICKET_PRICE, "pot_tax_percent": lottery_audit_mod.POT_TAX_PERCENT}

    @router.get("/admin/racing/crew-banks")
    async def admin_racing_crew_banks(
        page: int = 1,
        limit: int = 50,
        sort: str = "crew_bank",
        sort_dir: str = Query("desc", alias="dir"),
        has_team_only: bool = True,
        current_user: dict = Depends(get_current_user),
    ):
        """Admin: racing crew bank vs wallet cash (join users). Paginated."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        lim = max(1, min(int(limit or 50), 200))
        pg = max(1, int(page or 1))
        skip = (pg - 1) * lim
        sort_key = (sort or "crew_bank").strip().lower()
        direction = -1 if (sort_dir or "desc").strip().lower() == "desc" else 1
        if sort_key not in ("crew_bank", "money", "username"):
            sort_key = "crew_bank"
        match: Dict[str, Any] = {}
        if has_team_only:
            match["team_name"] = {"$exists": True, "$nin": [None, ""]}

        total_count = await db.racing_profiles.count_documents(match)
        sum_pipeline = [
            {"$match": match},
            {"$group": {"_id": None, "total_crew_bank": {"$sum": {"$ifNull": ["$crew_bank", 0]}}}},
        ]
        sum_rows = await db.racing_profiles.aggregate(sum_pipeline).to_list(1)
        total_crew_bank_sum = int((sum_rows[0] or {}).get("total_crew_bank") or 0) if sum_rows else 0

        sort_field = {"crew_bank": "crew_bank", "money": "wallet_money", "username": "sort_username"}[sort_key]
        pipeline = [
            {"$match": match},
            {
                "$lookup": {
                    "from": "users",
                    "localField": "user_id",
                    "foreignField": "id",
                    "as": "u",
                }
            },
            {"$unwind": {"path": "$u", "preserveNullAndEmptyArrays": True}},
            {
                "$addFields": {
                    "wallet_money": {"$ifNull": ["$u.money", 0]},
                    "sort_username": {"$toLower": {"$ifNull": ["$u.username", ""]}},
                }
            },
            {"$sort": {sort_field: direction, "user_id": 1}},
            {"$skip": skip},
            {"$limit": lim},
            {
                "$project": {
                    "_id": 0,
                    "user_id": 1,
                    "team_name": 1,
                    "crew_bank": {"$ifNull": ["$crew_bank", 0]},
                    "races_completed": {"$ifNull": ["$races_completed", 0]},
                    "wins": {"$ifNull": ["$wins", 0]},
                    "racing_rep": {"$ifNull": ["$racing_rep", 0]},
                    "wallet_money": 1,
                    "username": {"$ifNull": ["$u.username", ""]},
                }
            },
        ]
        rows = await db.racing_profiles.aggregate(pipeline).to_list(lim)
        for r in rows:
            if not (r.get("username") or "").strip():
                r["username"] = r.get("user_id") or "?"
            r["wallet_money"] = int(r.get("wallet_money") or 0)
            r["crew_bank"] = int(r.get("crew_bank") or 0)
            r["races_completed"] = int(r.get("races_completed") or 0)
            r["wins"] = int(r.get("wins") or 0)
            r["racing_rep"] = int(r.get("racing_rep") or 0)
        return {
            "rows": rows,
            "page": pg,
            "limit": lim,
            "total_count": total_count,
            "total_crew_bank_sum": total_crew_bank_sum,
            "has_team_only": has_team_only,
        }

    @router.get("/admin/racing/user-lifetime-earnings")
    async def admin_racing_user_lifetime_earnings(
        username: str = Query(..., min_length=1, max_length=80, description="Exact username (case-insensitive)"),
        current_user: dict = Depends(get_current_user),
    ):
        """Admin: sum stored Bootleg racing economy for a user from completed races (crew prizes + H2H wallet)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern((username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        uid_str = str(uid)
        prof = await db.racing_profiles.find_one({"user_id": uid}, {"_id": 0})
        prof_out = {
            "crew_bank_now": int((prof or {}).get("crew_bank") or 0),
            "races_completed": int((prof or {}).get("races_completed") or 0),
            "wins": int((prof or {}).get("wins") or 0),
            "racing_rep": int((prof or {}).get("racing_rep") or 0),
            "team_name": (prof or {}).get("team_name") or None,
        }
        # Sum per-entrant reward rows (crew credits; legacy rows lack crew_bank_* — fall back to cash + sponsor)
        reward_pipe = [
            {"$match": {"state": "completed", "rewards": {"$exists": True, "$ne": []}}},
            {"$unwind": "$rewards"},
            {
                "$match": {
                    "$expr": {
                        "$eq": [{"$toString": {"$ifNull": ["$rewards.entrant_id", ""]}}, uid_str],
                    }
                }
            },
            {
                "$group": {
                    "_id": None,
                    "completed_races_counted": {"$sum": 1},
                    "sum_crew_bank_credited": {
                        "$sum": {
                            "$ifNull": [
                                "$rewards.crew_bank_credited",
                                {"$add": [{"$ifNull": ["$rewards.cash", 0]}, {"$ifNull": ["$rewards.sponsor_income", 0]}]},
                            ]
                        }
                    },
                    "sum_crew_prize_gross": {
                        "$sum": {
                            "$ifNull": [
                                "$rewards.crew_bank_gross",
                                {"$add": [{"$ifNull": ["$rewards.cash", 0]}, {"$ifNull": ["$rewards.sponsor_income", 0]}]},
                            ]
                        }
                    },
                    "sum_daily_cap_trimmed": {"$sum": {"$ifNull": ["$rewards.daily_cap_trimmed", 0]}},
                    "sum_rank_points": {"$sum": {"$ifNull": ["$rewards.rank_points", 0]}},
                }
            },
        ]
        reward_rows = await db.racing_races.aggregate(reward_pipe).to_list(1)
        rdoc = reward_rows[0] if reward_rows else {}
        h2h_pipe = [
            {"$match": {"state": "completed", "h2h_stake": {"$gt": 0}}},
            {"$addFields": {"winner": {"$arrayElemAt": ["$result_order", 0]}}},
            {
                "$match": {
                    "$expr": {
                        "$and": [
                            {"$eq": [{"$toString": {"$ifNull": ["$winner", ""]}}, uid_str]},
                            {
                                "$not": {
                                    "$in": [
                                        uid_str,
                                        {
                                            "$map": {
                                                "input": {"$ifNull": ["$dnf_ids", []]},
                                                "as": "d",
                                                "in": {"$toString": "$$d"},
                                            }
                                        },
                                    ]
                                }
                            },
                        ]
                    }
                }
            },
            {
                "$group": {
                    "_id": None,
                    "h2h_wins": {"$sum": 1},
                    "h2h_wallet_credited_total": {"$sum": {"$multiply": [2, "$h2h_stake"]}},
                }
            },
        ]
        h2h_rows = await db.racing_races.aggregate(h2h_pipe).to_list(1)
        hdoc = h2h_rows[0] if h2h_rows else {}
        crew_credited = int(rdoc.get("sum_crew_bank_credited") or 0)
        crew_gross = int(rdoc.get("sum_crew_prize_gross") or 0)
        cap_trim = int(rdoc.get("sum_daily_cap_trimmed") or 0)
        h2h_wins = int(hdoc.get("h2h_wins") or 0)
        h2h_wallet = int(hdoc.get("h2h_wallet_credited_total") or 0)
        races_rows = int(rdoc.get("completed_races_counted") or 0)
        return {
            "user_id": uid,
            "username": target.get("username") or "?",
            "profile": prof_out,
            "from_completed_bootleg_races": {
                "completed_races_with_reward_row": races_rows,
                "sum_crew_bank_credited": crew_credited,
                "sum_crew_prize_gross_pre_cap": crew_gross,
                "sum_daily_cap_trimmed": cap_trim,
                "sum_rank_points_awarded": int(rdoc.get("sum_rank_points") or 0),
            },
            "head_to_head_wallet": {
                "wins": h2h_wins,
                "sum_wallet_credited_on_win": h2h_wallet,
                "note": "Winner receives both stakes (2× stake); mostly a transfer from the opponent, not minted crew cash.",
            },
            "combined_racing_credits_tracked": crew_credited + h2h_wallet,
            "notes": (
                "Crew numbers are summed from stored racing_races.rewards after each finish (credited amount; legacy races fall back to cash+sponsor). "
                "Championship end cash, weekly leaderboard cash, and parimutuel racing bets are not included. "
                "Crew bank withdrawals to wallet are not summed here."
            ),
        }

    @router.post("/admin/racing/crew-bank/adjust")
    async def admin_racing_crew_bank_adjust(
        body: AdminRacingCrewBankAdjustBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Admin: add or remove cash from a player's racing crew bank (Bootleg crew_bank). Does not touch users.money."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        amt = int(body.amount)
        if amt == 0:
            raise HTTPException(status_code=400, detail="amount cannot be zero")
        username_pattern = _username_pattern((body.target_username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        uname = target.get("username") or "?"
        from routers.minigames import racing as racing_mod

        await racing_mod._ensure_racing_profile(uid)
        await db.racing_profiles.update_one({"user_id": uid}, {"$inc": {"crew_bank": amt}})
        prof = await db.racing_profiles.find_one({"user_id": uid}, {"_id": 0, "crew_bank": 1})
        new_bal = int((prof or {}).get("crew_bank") or 0)
        try:
            await srv.log_activity(
                uid,
                uname,
                "admin_racing_crew_bank_adjust",
                {
                    "amount": amt,
                    "crew_bank_after": new_bal,
                    "admin_username": current_user.get("username", "?"),
                },
            )
        except Exception:
            pass
        verb = "Added" if amt > 0 else "Removed"
        return {
            "message": f"{verb} ${abs(amt):,} {'to' if amt > 0 else 'from'} {uname}'s racing crew bank. New crew bank: ${new_bal:,}",
            "user_id": uid,
            "username": uname,
            "amount": amt,
            "crew_bank": new_bal,
        }

    @router.get("/admin/racing/completed-races")
    async def admin_racing_completed_races(
        limit: int = 50,
        current_user: dict = Depends(get_current_user),
    ):
        """Admin: recent completed Bootleg Runs with per-entrant payout breakdown from stored rewards."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        lim = max(1, min(int(limit or 50), 100))
        cursor = db.racing_races.find(
            {"state": "completed"},
            {
                "_id": 0,
                "id": 1,
                "completed_at": 1,
                "track_id": 1,
                "track_name": 1,
                "mode": 1,
                "automated": 1,
                "entry_fee": 1,
                "participants": 1,
                "rewards": 1,
            },
        ).sort("completed_at", -1).limit(lim)
        raw = await cursor.to_list(lim)
        races_out: List[Dict[str, Any]] = []
        for race in raw:
            participants = race.get("participants") or []
            entrant_to_p: Dict[str, dict] = {}
            for p in participants:
                if not isinstance(p, dict):
                    continue
                eid = p.get("user_id") or p.get("id")
                if eid is not None:
                    entrant_to_p[str(eid)] = p
            entrants: List[Dict[str, Any]] = []
            for rw in race.get("rewards") or []:
                if not isinstance(rw, dict):
                    continue
                eid = rw.get("entrant_id")
                if eid is None:
                    continue
                eid_str = str(eid)
                p = entrant_to_p.get(eid_str)
                is_npc = bool(p.get("is_npc")) if p else True
                uid = (p or {}).get("user_id")
                uname = (p or {}).get("username")
                if not uname and is_npc:
                    uname = f"NPC ({eid_str})"
                elif not uname:
                    uname = uid or "?"
                entrants.append(
                    {
                        "entrant_id": eid_str,
                        "user_id": uid,
                        "username": uname,
                        "is_npc": is_npc,
                        "position": int(rw.get("position") or 0),
                        "dnf": bool(rw.get("dnf")),
                        "prize_to_crew": int(rw.get("cash") or 0),
                        "sponsor_to_crew": int(rw.get("sponsor_income") or 0),
                        "driver_salary": int(rw.get("driver_salary") or 0),
                        "net_crew_bank": int(rw.get("net_crew_bank") or 0),
                        "rank_points": int(rw.get("rank_points") or 0),
                        "racing_rep": int(rw.get("racing_rep") or 0),
                    }
                )
            races_out.append(
                {
                    "race_id": race.get("id"),
                    "completed_at": race.get("completed_at"),
                    "track_id": race.get("track_id"),
                    "track_name": race.get("track_name"),
                    "mode": race.get("mode"),
                    "automated": bool(race.get("automated")),
                    "entry_fee": int(race.get("entry_fee") or 0),
                    "entrants": entrants,
                }
            )
        return {"races": races_out}

    @router.get("/admin/lottery/round/{round_id}/money-trail")
    async def admin_lottery_round_money_trail(round_id: str, current_user: dict = Depends(get_current_user)):
        """Admin: where pot / tax / payouts went for one round; recompute from tickets vs stored doc."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        try:
            oid = ObjectId(round_id.strip())
        except InvalidId:
            raise HTTPException(status_code=404, detail="Invalid round id")
        rd = await db.lottery_rounds.find_one({"_id": oid})
        if not rd:
            raise HTTPException(status_code=404, detail="Round not found")
        rid_str = str(oid)
        tickets = await db.lottery_tickets.find(
            {"round_id": oid},
            {"_id": 0, "user_id": 1, "username": 1, "numbers": 1, "ticket_id": 1, "created_at": 1},
        ).to_list(500_000)
        recomp = lottery_audit_mod.recompute_winner_payouts_from_round(rd, tickets)

        stored_payouts = rd.get("winner_payouts")
        if not isinstance(stored_payouts, list):
            stored_payouts = []

        stored_map = {str(x.get("user_id")): int(x.get("amount") or 0) for x in stored_payouts if isinstance(x, dict)}
        recomp_map = {str(x.get("user_id")): int(x.get("amount") or 0) for x in recomp.get("recomputed_payouts") or []}
        stored_vs_recompute_ok = stored_map == recomp_map if stored_map or recomp_map else True

        buy_events = await db.economy_events.find(
            {"type": "lottery_buy", "round_id": rid_str},
            {"_id": 0, "at": 1, "user_id": 1, "username": 1, "count": 1, "spent": 1},
        ).to_list(200_000)
        buy_ticket_sum = sum(int(e.get("count") or 0) for e in buy_events)
        buy_cash_sum = sum(int(e.get("spent") or 0) for e in buy_events)

        draw_ev = await db.economy_events.find_one(
            {"type": "lottery_draw", "round_id": rid_str},
            {"_id": 0},
            sort=[("at", -1)],
        )

        act_wins = await db.activity_log.find(
            {"action": "lottery_win", "details.round_id": rid_str},
            {"_id": 0, "user_id": 1, "username": 1, "details": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(500)

        ticket_row_count = len(tickets)
        stored_ticket_count = rd.get("ticket_count")
        ticket_count_match = stored_ticket_count == ticket_row_count if stored_ticket_count is not None else None

        round_summary = {
            "round_id": rid_str,
            "status": rd.get("status"),
            "closes_at": rd.get("closes_at"),
            "drawn_at": rd.get("drawn_at"),
            "ticket_count_stored": stored_ticket_count,
            "ticket_rows_in_db": ticket_row_count,
            "ticket_count_match": ticket_count_match,
            "gross_pot": rd.get("gross_pot"),
            "sink_amount": rd.get("sink_amount"),
            "payout": rd.get("payout"),
            "rollover_to_next": rd.get("rollover_to_next"),
            "winning_numbers": rd.get("winning_numbers"),
            "exact_match_count_stored": rd.get("exact_match_count"),
            "winner_user_id": rd.get("winner_user_id"),
            "winner_username": rd.get("winner_username"),
            "winner_payouts_stored": stored_payouts,
            "payout_errors": rd.get("payout_errors") or [],
        }

        return {
            "round": round_summary,
            "recompute": recomp,
            "stored_winner_payouts_match_recompute": stored_vs_recompute_ok,
            "economy_lottery_buy": {
                "event_rows": len(buy_events),
                "sum_count": buy_ticket_sum,
                "sum_spent": buy_cash_sum,
                "expected_revenue_if_all_recorded": buy_ticket_sum * lottery_audit_mod.TICKET_PRICE,
            },
            "economy_lottery_draw": draw_ev,
            "activity_lottery_wins": act_wins,
            "notes": (
                "Sink (tax) is removed from gross; net payout either goes to exact-match ticket holders in equal shares, "
                "or rolls into rollover_to_next when there are no matches. "
                "Compare economy lottery_buy sums to ticket_rows when diagnosing missing purchases."
            ),
        }

    @router.post("/admin/lottery/repair-stuck-rounds")
    async def admin_lottery_repair_stuck_rounds(current_user: dict = Depends(get_current_user)):
        """Admin: repair malformed open lottery rounds and settle any now due."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return await lottery_audit_mod.lottery_repair_stuck_rounds(True)

    @router.post("/admin/gauntlet/wipe-user-scores")
    async def admin_gauntlet_wipe_user_scores(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Delete Flappy Gangster (gauntlet) leaderboard rows and gauntlet minigame_plays for a user."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern((target_username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        ga = await db.gauntlet_scores.delete_many({"user_id": uid})
        mgp = await db.minigame_plays.delete_many({"user_id": uid, "game": "gauntlet"})
        return {
            "message": f"Wiped Flappy Gangster data for {target.get('username')}",
            "gauntlet_scores_deleted": ga.deleted_count,
            "minigame_plays_gauntlet_deleted": mgp.deleted_count,
        }

    @router.post("/admin/cars/delete-all")
    async def admin_delete_all_cars(current_user: dict = Depends(get_current_user)):
        """Disabled: bulk-delete all cars was removed from the API for security."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raise HTTPException(
            status_code=410,
            detail="Bulk delete-all-cars has been removed from the admin API. Use per-user fixes or a controlled DB script if needed.",
        )

    @router.get("/admin/security/summary")
    async def admin_security_summary(limit: int = 100, flag_type: str = None, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        summary = await security_module.get_security_summary(db, limit=limit, flag_type=flag_type)
        return summary

    @router.get("/admin/stats/login-page-unique-visitors")
    async def admin_login_page_unique_visitors(current_user: dict = Depends(get_current_user)):
        """Return login page visitor stats: unique IPs and total tracked views."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        try:
            # Count distinct IPs explicitly so duplicates are never counted,
            # even if legacy data or a bad import inserted duplicate rows.
            ips = await db.login_page_visits.distinct("ip", {"ip": {"$exists": True, "$ne": ""}})
            unique_visitors = len(ips or [])
            rows = await db.login_page_visits.find(
                {},
                {"_id": 0, "view_count": 1},
            ).to_list(200000)
            total_views = 0
            for r in rows:
                c = r.get("view_count")
                try:
                    total_views += int(c) if c is not None else 1
                except Exception:
                    total_views += 1
        except Exception:
            unique_visitors = 0
            total_views = 0
        return {"unique_visitors": unique_visitors, "total_views": total_views}

    @router.get("/admin/security/flags")
    async def admin_security_flags(
        limit: int = 100,
        flag_type: str = None,
        user_id: str = None,
        resolved: bool = None,
        current_user: dict = Depends(get_current_user)
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        query = {}
        if flag_type:
            query["flag_type"] = flag_type
        if user_id:
            query["user_id"] = user_id
        if resolved is not None:
            query["resolved"] = resolved
        flags = await db.security_flags.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
        return {"flags": flags, "count": len(flags)}

    @router.get("/admin/security/sustained-page-rl-events")
    async def admin_sustained_page_rl_events(
        limit: int = 50,
        skip: int = 0,
        user_id: Optional[str] = None,
        page_key: Optional[str] = None,
        since: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        """List sustained page pacing 429 incidents (admin-only; see Admin Safety)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        lim = max(1, min(200, int(limit or 50)))
        sk = max(0, int(skip or 0))
        query: Dict[str, Any] = {}
        if user_id and str(user_id).strip():
            query["user_id"] = str(user_id).strip()
        if page_key and str(page_key).strip():
            query["page_key"] = str(page_key).strip()
        if since and str(since).strip():
            s = str(since).strip().replace("Z", "+00:00")
            try:
                dt = datetime.fromisoformat(s)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                query["created_at"] = {"$gte": dt.isoformat().replace("+00:00", "Z")}
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Invalid since (use ISO-8601 UTC).")
        coll = db.admin_sustained_rl_events
        total = await coll.count_documents(query)
        rows = await coll.find(query, {"_id": 0}).sort("created_at", -1).skip(sk).limit(lim).to_list(lim)
        return {"events": rows, "count": len(rows), "total": total, "skip": sk, "limit": lim}

    @router.post("/admin/security/flags/{flag_id}/resolve")
    async def admin_resolve_security_flag(flag_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await db.security_flags.update_one(
            {"id": flag_id},
            {"$set": {"resolved": True, "resolved_at": datetime.now(timezone.utc).isoformat()}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Flag not found")
        return {"message": "Flag marked as resolved", "flag_id": flag_id}

    @router.get("/admin/security/cheat-detection-config")
    async def admin_get_cheat_detection_config(current_user: dict = Depends(get_current_user)):
        """Get cheat detection toggles and thresholds (duplicate request, negative balance, impossible gain)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return {
            "detect_duplicate_requests": getattr(security_module, "DETECT_DUPLICATE_REQUESTS", False),
            "duplicate_request_window_ms": getattr(security_module, "DUPLICATE_REQUEST_WINDOW_MS", 300),
            "detect_negative_balance": getattr(security_module, "DETECT_NEGATIVE_BALANCE", False),
            "detect_impossible_gain": getattr(security_module, "DETECT_IMPOSSIBLE_GAIN", 50_000_000),
        }

    @router.post("/admin/security/cheat-detection-config")
    async def admin_set_cheat_detection_config(
        detect_duplicate_requests: Optional[bool] = None,
        duplicate_request_window_ms: Optional[int] = None,
        detect_negative_balance: Optional[bool] = None,
        detect_impossible_gain: Optional[int] = None,
        current_user: dict = Depends(get_current_user)
    ):
        """Configure cheat detection toggles and thresholds."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        changes = []
        if detect_duplicate_requests is not None:
            security_module.DETECT_DUPLICATE_REQUESTS = detect_duplicate_requests
            changes.append(f"detect_duplicate_requests={detect_duplicate_requests}")
        if duplicate_request_window_ms is not None:
            if duplicate_request_window_ms < 100 or duplicate_request_window_ms > 1000:
                raise HTTPException(status_code=400, detail="duplicate_request_window_ms must be between 100 and 1000")
            security_module.DUPLICATE_REQUEST_WINDOW_MS = duplicate_request_window_ms
            changes.append(f"duplicate_request_window_ms={duplicate_request_window_ms}")
        if detect_negative_balance is not None:
            security_module.DETECT_NEGATIVE_BALANCE = detect_negative_balance
            changes.append(f"detect_negative_balance={detect_negative_balance}")
        if detect_impossible_gain is not None:
            if detect_impossible_gain < 1_000_000 or detect_impossible_gain > 1_000_000_000_000:
                raise HTTPException(status_code=400, detail="detect_impossible_gain must be between 1M and 1T")
            security_module.DETECT_IMPOSSIBLE_GAIN = detect_impossible_gain
            changes.append(f"detect_impossible_gain={detect_impossible_gain}")
        if not changes:
            return {"message": "No changes made"}
        return {
            "message": f"Cheat detection config updated: {', '.join(changes)}",
            "detect_duplicate_requests": security_module.DETECT_DUPLICATE_REQUESTS,
            "duplicate_request_window_ms": security_module.DUPLICATE_REQUEST_WINDOW_MS,
            "detect_negative_balance": security_module.DETECT_NEGATIVE_BALANCE,
            "detect_impossible_gain": security_module.DETECT_IMPOSSIBLE_GAIN,
        }

    @router.get("/admin/security/spam-config")
    async def admin_get_spam_config(current_user: dict = Depends(get_current_user)):
        """Get current spam/burst detection configuration."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return {
            "max_requests_per_second": security_module.MAX_REQUESTS_PER_SECOND,
            "burst_window_seconds": security_module.BURST_WINDOW_SECONDS,
            "burst_max_requests": security_module.BURST_MAX_REQUESTS,
        }

    @router.post("/admin/security/spam-config")
    async def admin_set_spam_config(
        max_requests_per_second: int = None,
        burst_window_seconds: float = None,
        burst_max_requests: int = None,
        current_user: dict = Depends(get_current_user)
    ):
        """Configure spam/burst detection thresholds."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        changes = []
        if max_requests_per_second is not None:
            if max_requests_per_second < 1 or max_requests_per_second > 100:
                raise HTTPException(status_code=400, detail="max_requests_per_second must be between 1 and 100")
            security_module.MAX_REQUESTS_PER_SECOND = max_requests_per_second
            changes.append(f"max_requests_per_second={max_requests_per_second}")
        if burst_window_seconds is not None:
            if burst_window_seconds < 0.1 or burst_window_seconds > 5.0:
                raise HTTPException(status_code=400, detail="burst_window_seconds must be between 0.1 and 5.0")
            security_module.BURST_WINDOW_SECONDS = burst_window_seconds
            changes.append(f"burst_window_seconds={burst_window_seconds}")
        if burst_max_requests is not None:
            if burst_max_requests < 1 or burst_max_requests > 50:
                raise HTTPException(status_code=400, detail="burst_max_requests must be between 1 and 50")
            security_module.BURST_MAX_REQUESTS = burst_max_requests
            changes.append(f"burst_max_requests={burst_max_requests}")
        if not changes:
            return {"message": "No changes made"}
        return {
            "message": f"Spam config updated: {', '.join(changes)}",
            "max_requests_per_second": security_module.MAX_REQUESTS_PER_SECOND,
            "burst_window_seconds": security_module.BURST_WINDOW_SECONDS,
            "burst_max_requests": security_module.BURST_MAX_REQUESTS,
        }

    @router.post("/admin/security/test-telegram")
    async def admin_test_telegram(payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        custom_message = ""
        if isinstance(payload, dict):
            custom_message = str(payload.get("message") or "").strip()
        if not security_module.TELEGRAM_ENABLED:
            return {
                "success": False,
                "message": "Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env file."
            }
        rendered_message = (
            f"Test from {current_user.get('username', 'Unknown')}: {custom_message}"
            if custom_message
            else f"🧪 Test alert from Mafia Game\n\nAdmin: {current_user.get('username', 'Unknown')}\n\nIf you see this, Telegram integration is working!"
        )
        await security_module.send_telegram_alert(
            rendered_message,
            "info"
        )
        await security_module.flush_telegram_alerts()
        return {
            "success": True,
            "message": "Test alert sent! Check your Telegram chat."
        }

    @router.post("/admin/security/clear-user-flags")
    async def admin_clear_user_flags(user_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        count = await security_module.clear_user_security_flags(db, user_id)
        return {"message": f"Cleared {count} flag(s) for user {user_id}", "cleared_count": count}

    @router.post("/admin/security/clear-old-flags")
    async def admin_clear_old_flags(days: int = 30, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        count = await security_module.clear_old_security_flags(db, days)
        return {
            "message": f"Cleared {count} flag(s) older than {days} days",
            "cleared_count": count,
            "days": days
        }

    @router.post("/admin/hitlist/reset-npc-timers")
    async def admin_reset_hitlist_npc_timers(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raise HTTPException(status_code=410, detail="Deprecated: NPC seeding tools have been removed")

    @router.post("/admin/oc/reset-all-timers")
    async def admin_reset_all_oc_timers(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await db.users.update_many(
            {},
            {"$unset": {"oc_cooldown_until": ""}}
        )
        return {"message": f"Reset OC timers for all users ({result.modified_count} accounts)", "modified_count": result.modified_count}

    @router.post("/admin/oc/clear-user-invites")
    async def admin_oc_clear_user_invites(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Clear one user's OC invite footprint: outgoing/incoming invites + their pending heist."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern((target_username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]

        invite_filter = {"$or": [{"creator_id": uid}, {"target_id": uid}]}
        invite_docs = await db.oc_invites.find(invite_filter, {"_id": 0, "pending_heist_id": 1, "role": 1}).to_list(1000)

        # Remove this user's own pending heists first.
        pending_deleted = await db.oc_pending_heists.delete_many({"creator_id": uid})
        invites_deleted = await db.oc_invites.delete_many(invite_filter)

        # Clear now-dangling role assignments on other creators' pending heists.
        slot_clears = 0
        for inv in invite_docs:
            pending_id = inv.get("pending_heist_id")
            role = inv.get("role")
            if pending_id and role:
                res = await db.oc_pending_heists.update_one({"id": pending_id}, {"$set": {role: None}})
                slot_clears += int(res.modified_count or 0)

        return {
            "message": f"Cleared OC invites for {target.get('username')}",
            "invites_deleted": invites_deleted.deleted_count,
            "pending_heists_deleted": pending_deleted.deleted_count,
            "pending_slots_cleared": slot_clears,
        }

    @router.post("/admin/minigames/clear-user-records")
    async def admin_minigames_clear_user_records(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Delete one user's minigame records/history rows across minigame collections."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern((target_username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]

        collections = {
            "snake_scores": db.snake_scores,
            "family_run_scores": db.family_run_scores,
            "whack_a_copper_scores": db.whack_a_copper_scores,
            "gauntlet_scores": db.gauntlet_scores,
            "shooting_range_scores": db.shooting_range_scores,
            "mafia_rpg_scores": db.mafia_rpg_scores,
            "minesweeper_wins": db.minesweeper_wins,
            "battleships_wins": db.battleships_wins,
            "the_getaway_runs": db.the_getaway_runs,
            "minigame_plays": db.minigame_plays,
            "minigame_run_sessions": db.minigame_run_sessions,
        }

        deleted_by_collection: Dict[str, int] = {}
        total_deleted = 0
        for key, coll in collections.items():
            res = await coll.delete_many({"user_id": uid})
            count = int(res.deleted_count or 0)
            deleted_by_collection[key] = count
            total_deleted += count

        return {
            "message": f"Cleared minigame records for {target.get('username')}",
            "total_deleted": total_deleted,
            "deleted_by_collection": deleted_by_collection,
        }

    class AdminMinigameLbStripBody(BaseModel):
        target_username: str = Field(..., min_length=1)
        remove_weekly_plays: bool = True
        weekly_scope: str = Field("current", description="'current' = this Mon 00:00 UK week only; 'all' = every minigame_plays row")
        remove_per_game_scores: bool = True
        games: Optional[List[str]] = Field(
            None,
            description="Optional list of game slugs (e.g. gauntlet, snake). If set, only those per-game collections are cleared.",
        )

    class AdminMinigameLbAddPlayBody(BaseModel):
        target_username: str = Field(..., min_length=1)
        game: str = Field(..., min_length=1)
        score: int = Field(..., ge=0, le=50_000_000)
        record_weekly_play: bool = Field(True, description="Append to minigame_plays for combined weekly leaderboard points")
        record_per_game_score: bool = Field(
            False,
            description="Insert one high-score row for games that support it (snake, gauntlet, shooting_range, mafia_rpg, family_run, whack_a_copper). No cash/respect.",
        )

    @router.post("/admin/minigames/leaderboard/strip-user")
    async def admin_minigame_leaderboard_strip_user(
        body: AdminMinigameLbStripBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Remove a user from the combined mini games weekly leaderboard rows and/or per-game score tables."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.minigame_admin_leaderboard import (
            current_week_start_iso,
            delete_minigame_weekly_plays_for_user,
            delete_per_game_score_rows_for_user,
        )

        username_pattern = _username_pattern((body.target_username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        ws = (body.weekly_scope or "current").strip().lower()
        if ws not in ("current", "all"):
            raise HTTPException(status_code=400, detail="weekly_scope must be 'current' or 'all'")

        weekly_deleted = 0
        if body.remove_weekly_plays:
            weekly_deleted = await delete_minigame_weekly_plays_for_user(db, user_id=uid, scope=ws)

        per_game_deleted: Dict[str, int] = {}
        if body.remove_per_game_scores:
            games_filter = [g.strip().lower() for g in (body.games or []) if (g or "").strip()]
            per_game_deleted = await delete_per_game_score_rows_for_user(
                db, user_id=uid, games=games_filter if games_filter else None
            )

        return {
            "message": f"Leaderboard data stripped for {target.get('username')}",
            "user_id": uid,
            "week_start_iso": current_week_start_iso() if ws == "current" else None,
            "weekly_plays_deleted": weekly_deleted,
            "per_game_deleted_by_slug": per_game_deleted,
        }

    @router.post("/admin/minigames/leaderboard/add-play")
    async def admin_minigame_leaderboard_add_play(
        body: AdminMinigameLbAddPlayBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Add a synthetic weekly play and/or per-game score row (no in-game cash/respect payout)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.minigame_admin_leaderboard import add_minigame_leaderboard_play_for_user

        username_pattern = _username_pattern((body.target_username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        uname = target.get("username") or "?"
        if not body.record_weekly_play and not body.record_per_game_score:
            raise HTTPException(status_code=400, detail="Enable at least one of record_weekly_play or record_per_game_score")

        try:
            detail = await add_minigame_leaderboard_play_for_user(
                db,
                user_id=uid,
                username=uname,
                game=body.game.strip().lower(),
                score=body.score,
                record_weekly=body.record_weekly_play,
                record_per_game=body.record_per_game_score,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return {"message": f"Recorded minigame leaderboard data for {uname}", **detail}

    class AdminMainLeaderboardStripBody(BaseModel):
        target_username: str = Field(..., min_length=1)
        scope: str = Field(
            "current",
            description="'current' = this Mon 00:00 UK week only (matches /leaderboards/top?period=weekly); 'all' = full history for selected categories",
        )
        respect_events: bool = Field(True, description="Respect points earned (weekly board)")
        melt_events: bool = Field(True, description="Bullets melted (weekly board)")
        stock_profit_rows: bool = Field(
            True,
            description="Zero profit_points on stock_transactions; adjust users.stock_market_profit_total",
        )
        booze_run_events: bool = Field(
            True,
            description="Zero profit on economy_events booze_run_sell; adjust users.booze_run_profit_total",
        )
        kills: bool = Field(False, description="attack_attempts with outcome killed")
        crimes: bool = Field(False, description="crime_events")
        gta: bool = Field(False, description="gta_events")
        jail_busts: bool = Field(False, description="bust_events success")

    @router.post("/admin/leaderboards/strip-user-inputs")
    async def admin_main_leaderboard_strip_user_inputs(
        body: AdminMainLeaderboardStripBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Remove or zero rows that feed the main /leaderboards/top boards (weekly and/or all history). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.main_leaderboard_strip import strip_user_main_leaderboard_inputs

        ws = (body.scope or "current").strip().lower()
        if ws not in ("current", "all"):
            raise HTTPException(status_code=400, detail="scope must be 'current' or 'all'")

        username_pattern = _username_pattern((body.target_username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]

        if not any(
            [
                body.respect_events,
                body.melt_events,
                body.stock_profit_rows,
                body.booze_run_events,
                body.kills,
                body.crimes,
                body.gta,
                body.jail_busts,
            ]
        ):
            raise HTTPException(status_code=400, detail="Select at least one category")

        try:
            detail = await strip_user_main_leaderboard_inputs(
                db,
                user_id=uid,
                scope=ws,
                respect_events=body.respect_events,
                melt_events=body.melt_events,
                stock_profit_rows=body.stock_profit_rows,
                booze_run_events=body.booze_run_events,
                kills=body.kills,
                crimes=body.crimes,
                gta=body.gta,
                jail_busts=body.jail_busts,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        leaderboard_module.invalidate_leaderboard_cache()
        return {
            "message": f"Main leaderboard inputs stripped for {target.get('username')}",
            "user_id": uid,
            **detail,
        }

    @router.get("/admin/leaderboards/user-scores")
    async def admin_leaderboard_user_scores(
        target_username: str = Query(..., min_length=1, description="Exact or case-insensitive username match"),
        current_user: dict = Depends(get_current_user),
    ):
        """Preview weekly (Mon 00:00 UK) vs all-time values that feed /leaderboards/top for one user. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.admin_leaderboard_user import get_user_leaderboard_scores

        username_pattern = _username_pattern((target_username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        scores = await get_user_leaderboard_scores(db, user_id=target["id"])
        return scores

    class AdminLeaderboardAdjustBody(BaseModel):
        target_username: str = Field(..., min_length=1)
        metric: str = Field(..., description="crimes | gta | jail_busts | kills | respect")
        period: str = Field(..., description="weekly | alltime")
        remove_count: int = Field(..., ge=1, le=50_000)
        dry_run: bool = Field(False)

    @router.post("/admin/leaderboards/adjust-user")
    async def admin_leaderboard_adjust_user(
        body: AdminLeaderboardAdjustBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Remove oldest N event rows for a user (weekly window or all-time); sync users.* counters for successes where applicable. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.admin_leaderboard_user import adjust_user_leaderboard_metric

        username_pattern = _username_pattern((body.target_username or "").strip())
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]
        try:
            result = await adjust_user_leaderboard_metric(
                db,
                user_id=uid,
                metric=body.metric,
                period=body.period,
                remove_count=body.remove_count,
                dry_run=body.dry_run,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        if not body.dry_run and (result.get("deleted_count") or 0) > 0:
            leaderboard_module.invalidate_leaderboard_cache()
            try:
                await srv.log_activity(
                    current_user.get("id") or "",
                    current_user.get("username") or "?",
                    "admin_leaderboard_adjust",
                    {
                        "target_user_id": uid,
                        "target_username": target.get("username"),
                        "metric": body.metric,
                        "period": body.period,
                        "remove_count": body.remove_count,
                        "deleted_count": result.get("deleted_count"),
                        "user_counter_delta": result.get("user_counter_delta"),
                    },
                )
            except Exception:
                pass

        return {
            "message": (
                f"Dry run: would remove {result.get('documents_matched', 0)} document(s)"
                if body.dry_run
                else f"Removed {result.get('deleted_count', 0)} document(s) for {target.get('username')}"
            ),
            "user_id": uid,
            "username": target.get("username"),
            **result,
        }

    @router.post("/admin/leaderboards/reset-weekly-booze-profit")
    async def admin_reset_weekly_booze_profit(current_user: dict = Depends(get_current_user)):
        """
        Zero this week's booze-run leaderboard inputs for ALL users by setting
        economy_events.profit = 0 on type=booze_run_sell rows in the current Mon 00:00 UK week.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        from utils.game_timezone import game_week_range_utc

        now = datetime.now(timezone.utc)
        week_start, week_end = game_week_range_utc(now)

        match = {
            "type": "booze_run_sell",
            "$expr": {"$and": [
                {"$gte": [{"$toDate": "$at"}, week_start]},
                {"$lt": [{"$toDate": "$at"}, week_end]},
            ]},
        }

        # Only touch rows where profit is non-zero to reduce writes.
        res = await db.economy_events.update_many(
            {**match, "profit": {"$ne": 0}},
            {"$set": {"profit": 0}},
        )
        leaderboard_module.invalidate_leaderboard_cache()
        return {
            "message": f"Reset weekly booze-run profit rows to 0 (modified {int(res.modified_count or 0)} rows).",
            "week_start_utc": week_start.isoformat().replace("+00:00", "Z"),
            "modified": int(res.modified_count or 0),
        }

    _REFERRAL_EARNINGS_KEYS = (
        "referral_earnings_booze",
        "referral_earnings_crime",
        "referral_earnings_oc",
        "referral_earnings_garage_scrap",
        "referral_earnings_melt_bullets",
    )

    @router.get("/admin/referrals/report")
    async def admin_referrals_report(
        referrer_username: Optional[str] = Query(None, description="Optional: filter to one referrer by username"),
        current_user: dict = Depends(get_current_user),
    ):
        """Who referred whom (referred_by) and lifetime referral earnings on each referrer (pooled across all referees). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        prereg_with_ref = await db.preregistrations.count_documents(
            {"referral_code": {"$exists": True, "$nin": [None, ""]}}
        )

        q: Dict[str, object] = {
            "$or": [
                {"$and": [{"referred_by": {"$type": "string"}}, {"referred_by": {"$ne": ""}}]},
                {"referred_by.0": {"$exists": True}},
            ]
        }
        ref_id_filter: Optional[str] = None
        if (referrer_username or "").strip():
            rp = _username_pattern(referrer_username.strip())
            ref_user = await db.users.find_one({"username": rp}, {"_id": 0, "id": 1, "username": 1})
            if not ref_user:
                raise HTTPException(status_code=404, detail="Referrer username not found")
            ref_id_filter = ref_user["id"]
            q = {"$and": [q, {"referred_by": ref_id_filter}]}

        proj = {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "created_at": 1,
            "referred_by": 1,
        }
        rows = await db.users.find(q, proj).sort("created_at", -1).limit(5000).to_list(5000)

        by_referrer: Dict[str, List[dict]] = defaultdict(list)
        for r in rows:
            for rid in normalize_referred_by_ids(r.get("referred_by")):
                if ref_id_filter and str(rid) != str(ref_id_filter):
                    continue
                by_referrer[str(rid)].append(
                    {
                        "user_id": r.get("id"),
                        "username": r.get("username"),
                        "email": r.get("email"),
                        "created_at": r.get("created_at"),
                    }
                )

        total_referee_edges = 0
        for r in rows:
            for rid in normalize_referred_by_ids(r.get("referred_by")):
                if ref_id_filter and str(rid) != str(ref_id_filter):
                    continue
                total_referee_edges += 1

        referrer_ids = list(by_referrer.keys())
        referrers_raw = []
        if referrer_ids:
            referrers_raw = await db.users.find(
                {"id": {"$in": referrer_ids}},
                {
                    "_id": 0,
                    "id": 1,
                    "username": 1,
                    **{k: 1 for k in _REFERRAL_EARNINGS_KEYS},
                },
            ).to_list(len(referrer_ids) + 1)

        ref_by_id = {str(x["id"]): x for x in referrers_raw}
        groups = []
        for rid, referees in sorted(by_referrer.items(), key=lambda x: len(x[1]), reverse=True):
            ru = ref_by_id.get(rid, {})
            earnings = {k: int(ru.get(k) or 0) for k in _REFERRAL_EARNINGS_KEYS}
            cash_like = (
                earnings["referral_earnings_booze"]
                + earnings["referral_earnings_crime"]
                + earnings["referral_earnings_oc"]
                + earnings["referral_earnings_garage_scrap"]
            )
            groups.append(
                {
                    "referrer_id": rid,
                    "referrer_username": ru.get("username") or "?",
                    "referee_count": len(referees),
                    "referral_earnings": earnings,
                    "referral_cash_like_total": cash_like,
                    "referral_bullets_from_melt": earnings["referral_earnings_melt_bullets"],
                    "referees": referees,
                }
            )

        return {
            "preregistrations_with_referral_code_stored": prereg_with_ref,
            "note": "Earnings are lifetime totals on the referrer account. A referee may have multiple referrers (referred_by list); referral cuts are split evenly among them on each payout.",
            "referrer_filter": ref_id_filter,
            "total_referee_links": total_referee_edges,
            "groups": groups,
        }

    @router.post("/admin/referrals/heal-prereg")
    async def admin_heal_prereg_referrals(
        body: HealPreregReferralsRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Backfill referred_by + signup bonuses for users whose prereg row has referral_code but account was created without referred_by.
        Run with dry_run=true first. Users also heal automatically on next login."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        preregs = (
            await db.preregistrations.find(
                {"referral_code": {"$exists": True, "$nin": [None, ""]}},
                {"_id": 0, "email": 1},
            )
            .limit(body.max_scan)
            .to_list(body.max_scan + 1)
        )
        seen: Set[str] = set()
        scanned = 0
        eligible = 0
        healed = 0
        cap = int(body.max_detail_rows)
        would_heal_rows: List[dict] = []
        healed_rows: List[dict] = []

        def _trim(d: dict) -> dict:
            return {k: v for k, v in d.items() if k != "dry_run"}

        for p in preregs:
            em = (p.get("email") or "").strip().lower()
            if not em or em in seen:
                continue
            seen.add(em)
            pat = re.compile("^" + re.escape(em) + "$", re.IGNORECASE)
            u = await db.users.find_one({"email": pat}, {"_id": 0})
            if not u:
                continue
            scanned += 1
            would = await try_heal_referral_from_prereg(db, u, dry_run=True)
            if not would:
                continue
            eligible += 1
            if body.dry_run:
                if cap <= 0 or len(would_heal_rows) < cap:
                    would_heal_rows.append(_trim(would))
            else:
                h = await try_heal_referral_from_prereg(db, u, dry_run=False)
                if h:
                    healed += 1
                    if cap <= 0 or len(healed_rows) < cap:
                        healed_rows.append(_trim(h))
        shown = len(would_heal_rows) if body.dry_run else len(healed_rows)
        detail_truncated = max(0, eligible - shown) if cap > 0 else 0
        return {
            "dry_run": body.dry_run,
            "prereg_rows_considered": len(preregs),
            "unique_emails_tried": len(seen),
            "users_matched": scanned,
            "eligible_for_heal": eligible,
            "healed": healed if not body.dry_run else 0,
            "would_heal": would_heal_rows if body.dry_run else [],
            "healed_rows": healed_rows if not body.dry_run else [],
            "detail_truncated": detail_truncated,
            "message": (
                "Dry run: no rows updated." if body.dry_run else f"Updated {healed} user account(s)."
            ),
        }

    @router.post("/admin/referrals/manual-assign")
    async def admin_referrals_manual_assign(
        body: ManualReferralAssignRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Link a referee account to a referrer (referred_by). Referee gets token/respect top-up to match normal referral; referrer welcome respect (default 500) when first link only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        try:
            out = await apply_manual_referral_link(
                db,
                referee_username=body.referee_username.strip(),
                referrer_username=body.referrer_username.strip(),
                force=body.force,
                grant_referee_signup_bonuses=body.grant_referee_signup_bonuses,
                grant_referrer_welcome_respect=int(body.grant_referrer_welcome_respect),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return out

    @router.post("/admin/referrals/remove")
    async def admin_referrals_remove(
        body: ManualReferralRemoveRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Remove one referrer from a referee's referred_by list, or clear the whole list if referrer_username is omitted."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        try:
            out = await apply_manual_referral_remove(
                db,
                referee_username=body.referee_username.strip(),
                referrer_username=(body.referrer_username or "").strip() or None,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return out

    @router.post("/admin/daily-rewards/reset-timer")
    async def admin_daily_rewards_reset_timer(
        target_username: Optional[str] = Query(None, description="Reset this user only; omit to reset all users"),
        current_user: dict = Depends(get_current_user),
    ):
        """Reset Daily Rewards timer (6h play window): clear rps_plays and any in-progress Noughts & Crosses game."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if target_username is not None and not (target_username or "").strip():
            raise HTTPException(status_code=400, detail="target_username cannot be empty")
        if target_username:
            username_pattern = _username_pattern(target_username.strip())
            target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
            if not target:
                raise HTTPException(status_code=404, detail="User not found")
            user_id = target["id"]
            u_res = await db.users.update_one({"id": user_id}, {"$set": {"rps_plays": []}})
            ttt_res = await db.daily_rewards_ttt.delete_many({"user_id": user_id})
            return {
                "message": f"Reset Daily Rewards timer for {target.get('username', target_username)}. Cleared plays and {ttt_res.deleted_count} in-progress game(s).",
                "modified_count": 1 if u_res.modified_count else 0,
                "ttt_deleted_count": ttt_res.deleted_count,
            }
        u_res = await db.users.update_many({}, {"$set": {"rps_plays": []}})
        ttt_res = await db.daily_rewards_ttt.delete_many({})
        return {
            "message": f"Reset Daily Rewards timer for all users. Cleared plays on {u_res.modified_count} accounts, removed {ttt_res.deleted_count} in-progress game(s).",
            "modified_count": u_res.modified_count,
            "ttt_deleted_count": ttt_res.deleted_count,
        }

    async def _normalize_user_crime_cooldowns(user_id: str) -> int:
        """Convert any datetime-typed cooldown_until values to ISO strings for a user.
        Returns number of documents fixed."""
        fixed = 0
        async for doc in db.user_crimes.find({"user_id": user_id, "cooldown_until": {"$exists": True}}):
            cd = doc.get("cooldown_until")
            if cd is not None and hasattr(cd, "isoformat") and not isinstance(cd, str):
                await db.user_crimes.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"cooldown_until": cd.isoformat()}},
                )
                fixed += 1
        return fixed

    @router.post("/admin/crimes/reset-timers")
    async def admin_crimes_reset_timers(
        target_username: str = Query(..., description="Username to clear crime cooldown timers for"),
        current_user: dict = Depends(get_current_user),
    ):
        """Clear all crime cooldown timers for one user by removing user_crimes.cooldown_until."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (target_username or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="target_username required")
        username_pattern = _username_pattern(raw)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        res = await db.user_crimes.update_many(
            {"user_id": target["id"]},
            {"$unset": {"cooldown_until": ""}},
        )
        norm = await _normalize_user_crime_cooldowns(target["id"])
        return {
            "message": f"Cleared crime cooldown timers for {target.get('username') or raw}.",
            "modified_count": int(res.modified_count or 0),
            "normalized_datetime_fields": norm,
        }

    @router.get("/admin/crimes/inspect/{target_username}")
    async def admin_crimes_inspect(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Return raw user_crimes documents for a user so admins can diagnose data issues."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (target_username or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="target_username required")
        username_pattern = _username_pattern(raw)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        docs = await db.user_crimes.find({"user_id": target["id"]}).to_list(5000)
        now = datetime.now(timezone.utc)
        from collections import Counter
        dup_counts = Counter(d.get("crime_id") for d in docs)
        seen = set()
        rows = []
        for d in docs:
            cid = d.get("crime_id")
            if cid in seen:
                continue
            seen.add(cid)
            cd = d.get("cooldown_until")
            cd_type = type(cd).__name__ if cd is not None else "unset"
            cd_str = cd.isoformat() if hasattr(cd, "isoformat") else str(cd) if cd is not None else None
            expired = True
            if cd is not None:
                try:
                    dt = cd if hasattr(cd, "year") else datetime.fromisoformat(str(cd).replace("Z", "+00:00"))
                    if getattr(dt, "tzinfo", None) is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    expired = dt <= now
                except Exception:
                    expired = None
            rows.append({
                "crime_id": cid,
                "duplicates": dup_counts.get(cid, 1),
                "cooldown_until_raw": cd_str,
                "cooldown_until_type": cd_type,
                "cooldown_expired": expired,
                "attempts": d.get("attempts", 0),
                "successes": d.get("successes", 0),
                "progress": d.get("progress"),
            })
        total_dupes = sum(max(0, c - 1) for c in dup_counts.values())
        return {
            "username": target.get("username"),
            "user_id": target["id"],
            "total_rows": len(docs),
            "unique_crimes": len(rows),
            "total_duplicates": total_dupes,
            "crimes": rows,
        }

    @router.post("/admin/crimes/dedup")
    async def admin_crimes_dedup(
        target_username: str = Query(..., description="Username to deduplicate crime rows for"),
        current_user: dict = Depends(get_current_user),
    ):
        """Remove duplicate user_crimes rows for a user, keeping one best row per crime_id."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (target_username or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="target_username required")
        username_pattern = _username_pattern(raw)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        docs = await db.user_crimes.find({"user_id": target["id"]}).to_list(5000)
        from collections import defaultdict as _dd
        by_cid = _dd(list)
        for d in docs:
            by_cid[d.get("crime_id")].append(d)
        total_removed = 0
        for cid, crime_docs in by_cid.items():
            if len(crime_docs) <= 1:
                continue
            best = max(crime_docs, key=lambda r: int(r.get("attempts", 0) or 0))
            ids_to_delete = [d["_id"] for d in crime_docs if d["_id"] != best["_id"]]
            if ids_to_delete:
                await db.user_crimes.delete_many({"_id": {"$in": ids_to_delete}})
                total_removed += len(ids_to_delete)
        return {
            "message": f"Deduped crimes for {target.get('username') or raw}.",
            "rows_before": len(docs),
            "rows_removed": total_removed,
            "rows_after": len(docs) - total_removed,
        }

    @router.post("/admin/force-online")
    async def admin_force_online(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        five_min_ago = now - timedelta(minutes=5)
        until = now + timedelta(hours=1)
        until_iso = until.isoformat()
        res = await db.users.update_many(
            {
                "is_dead": {"$ne": True},
                "$and": [
                    {
                        "$or": [
                            {"last_seen": {"$lt": five_min_ago.isoformat()}},
                            {"last_seen": None},
                            {"last_seen": {"$exists": False}},
                        ]
                    },
                    {
                        "$or": [
                            {"forced_online_until": {"$exists": False}},
                            {"forced_online_until": None},
                            {"forced_online_until": {"$lt": until_iso}},
                        ]
                    },
                ],
            },
            {"$set": {"forced_online_until": until_iso}},
        )
        return {"message": f"Forced offline users online until {until_iso}", "until": until_iso, "updated": res.modified_count}

    @router.post("/admin/force-online-user")
    async def admin_force_online_user(target_username: str, hours: int = 1, current_user: dict = Depends(get_current_user)):
        """Force a specific user to appear online for a number of hours. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        hours = max(1, min(hours, 24))  # Clamp between 1 and 24 hours
        now = datetime.now(timezone.utc)
        until = now + timedelta(hours=hours)
        until_iso = until.isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"forced_online_until": until_iso}},
        )
        return {"message": f"Forced {target['username']} online until {until_iso}", "until": until_iso, "username": target["username"]}

    class PresenceSimulatorBody(BaseModel):
        enabled: Optional[bool] = None
        interval_minutes: Optional[float] = None
        min_add_per_tick: Optional[int] = None
        max_add_per_tick: Optional[int] = None
        max_remove_per_tick: Optional[int] = None
        max_pool: Optional[int] = None
        skip_usernames: Optional[List[str]] = None
        gradual_add: Optional[bool] = None
        seconds_between_adds: Optional[int] = None
        run_now: bool = False

    @router.get("/admin/presence-simulator")
    async def admin_presence_simulator_get(current_user: dict = Depends(get_current_user)):
        """Read presence simulator config (rotating last_seen bumps for real players). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.presence_simulator import load_presence_config

        return await load_presence_config(db)

    @router.post("/admin/presence-simulator")
    async def admin_presence_simulator_set(
        body: PresenceSimulatorBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Enable/disable or tune the presence simulator; optional run_now runs one tick immediately."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.presence_simulator import (
            load_presence_config,
            save_presence_config,
            presence_simulator_tick,
            clear_presence_simulator_autorank,
        )

        cur = await load_presence_config(db)
        was_enabled = bool(cur.get("enabled"))
        if body.enabled is not None:
            cur["enabled"] = bool(body.enabled)
        if body.interval_minutes is not None:
            m = float(body.interval_minutes)
            cur["interval_seconds"] = int(max(2.0, min(60.0, m)) * 60)
        if body.min_add_per_tick is not None:
            cur["min_add_per_tick"] = body.min_add_per_tick
        if body.max_add_per_tick is not None:
            cur["max_add_per_tick"] = body.max_add_per_tick
        if body.max_remove_per_tick is not None:
            cur["max_remove_per_tick"] = body.max_remove_per_tick
        if body.max_pool is not None:
            cur["max_pool"] = body.max_pool
        if body.skip_usernames is not None:
            cur["skip_usernames"] = list(body.skip_usernames)
        if body.gradual_add is not None:
            cur["gradual_add"] = bool(body.gradual_add)
        if body.seconds_between_adds is not None:
            cur["seconds_between_adds"] = body.seconds_between_adds
        if was_enabled and body.enabled is False:
            # Turning simulator off: restore users that were temporarily put on auto-rank.
            await clear_presence_simulator_autorank(db)
            cur["active_user_ids"] = []
        await save_presence_config(db, cur)
        cur = await load_presence_config(db)
        if body.run_now and cur.get("enabled"):
            await presence_simulator_tick(db, list(ADMIN_EMAILS or []), force=True)
            cur = await load_presence_config(db)
        return cur

    @router.post("/admin/lock-player")
    async def admin_lock_player(target_username: str, lock_minutes: int = 0, current_user: dict = Depends(require_admin_or_mod)):
        """Lock account for investigation: user can only access /locked page and submit one comment until unlocked. lock_minutes ignored (kept for API compat). Admin or moderator."""
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "account_locked": True,
                    "account_locked_at": now_iso,
                },
                "$unset": {
                    "account_locked_comment": "",
                    "account_locked_comment_at": "",
                },
            },
        )
        return {"message": f"Locked {target_username} for investigation. They can only access the locked page and submit one comment."}

    @router.post("/admin/unlock-account")
    async def admin_unlock_account(target_username: str, current_user: dict = Depends(require_admin_or_mod)):
        """Unlock an account that was locked for investigation. Admin or moderator. Also clears login lockout (failed attempts) so they can log in again."""
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {"account_locked": False},
                "$unset": {"account_locked_at": "", "account_locked_comment": "", "account_locked_comment_at": "", "account_locked_until": "", "account_locked_admin_message": "", "account_locked_admin_message_at": "", "account_locked_user_reply": "", "account_locked_user_reply_at": ""},
            },
        )
        email_clean = (target.get("email") or "").strip().lower()
        if email_clean:
            await db.login_lockouts.delete_one({"email": email_clean})
        return {"message": f"Unlocked {target_username}. They can access the app again."}

    @router.get("/admin/locked-accounts")
    async def admin_locked_accounts(current_user: dict = Depends(require_admin_or_mod)):
        """List users currently locked for investigation (username, comment, dates). Admin or moderator."""
        cursor = db.users.find(
            {"account_locked": True},
            {"_id": 0, "username": 1, "account_locked_at": 1, "account_locked_until": 1, "account_locked_comment": 1, "account_locked_comment_at": 1, "account_locked_admin_message": 1, "account_locked_admin_message_at": 1, "account_locked_user_reply": 1, "account_locked_user_reply_at": 1},
        )
        users = await cursor.to_list(100)
        return {"locked": users}

    @router.get("/admin/users-online-live")
    async def admin_users_online_live(current_user: dict = Depends(require_admin_or_mod)):
        """List everyone actually online (last 5 min), with last click, last page, IP, and same-IP count. Admin or moderator."""
        now = datetime.now(timezone.utc)
        five_min_ago = now - timedelta(minutes=5)
        cursor = db.users.find(
            {
                "is_dead": {"$ne": True},
                "is_bodyguard": {"$ne": True},
                "$or": [
                    {"last_seen": {"$gte": five_min_ago.isoformat()}},
                    {"forced_online_until": {"$gt": now.isoformat()}},
                    {"auto_rank_enabled": True},
                ],
            },
            {"_id": 0, "id": 1, "username": 1, "last_seen": 1, "last_path": 1, "last_request_ip": 1, "last_login_ip": 1, "email": 1, "is_moderator": 1, "admin_ghost_mode": 1},
        )
        raw = await cursor.to_list(200)
        users = []
        for u in raw:
            if (user_has_admin_list_email(u) or _is_moderator(u)) and u.get("admin_ghost_mode"):
                continue
            ip = _normalize_ip(u.get("last_request_ip") or u.get("last_login_ip") or "")
            users.append({
                "id": u.get("id"),
                "username": u.get("username"),
                "last_seen": u.get("last_seen"),
                "last_path": u.get("last_path"),
                "ip": ip,
                "_dupe_exempt": bool(user_has_dupe_exempt_email(u)),
            })
        # Same-IP badge: ignore DUPE_DETECTION_EXEMPT_EMAILS accounts (not counted, never show linked).
        ip_counts = {}
        for u in users:
            if u.get("_dupe_exempt"):
                continue
            ip = u.get("ip")
            if ip:
                ip_counts[ip] = ip_counts.get(ip, 0) + 1
        for u in users:
            if u.pop("_dupe_exempt", False):
                u["same_ip_online_count"] = 0
                continue
            ip = u.get("ip")
            same = (ip_counts.get(ip, 0) - 1) if ip else 0
            u["same_ip_online_count"] = max(0, same)
        users.sort(key=lambda x: (x.get("last_seen") or ""), reverse=True)
        return {"users": users}

    @router.post("/admin/test-lock-self")
    async def admin_test_lock_self(current_user: dict = Depends(require_admin)):
        """Lock the current admin for 60 seconds (test the locked page flow). Admin only."""
        now = datetime.now(timezone.utc)
        until = now + timedelta(seconds=60)
        now_iso = now.isoformat()
        until_iso = until.isoformat()
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$set": {
                    "account_locked": True,
                    "account_locked_at": now_iso,
                    "account_locked_until": until_iso,
                },
                "$unset": {"account_locked_comment": "", "account_locked_comment_at": ""},
            },
        )
        return {"message": "You are locked for 60 seconds. You will be redirected to the locked page.", "account_locked_until": until_iso}

    class LockedAccountMessageBody(BaseModel):
        target_username: str
        message: str

    @router.post("/admin/locked-account-message")
    async def admin_locked_account_message(body: LockedAccountMessageBody, current_user: dict = Depends(require_admin_or_mod)):
        """Leave a message for a locked user; they see it on the locked page and can reply once. Admin or moderator."""
        username_pattern = _username_pattern(body.target_username)
        target = await db.users.find_one({"username": username_pattern, "account_locked": True}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found or not locked")
        msg = (body.message or "").strip()[:2000]
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"account_locked_admin_message": msg, "account_locked_admin_message_at": now_iso}},
        )
        return {"message": f"Message sent to {target.get('username', body.target_username)}.", "account_locked_admin_message_at": now_iso}

    @router.post("/admin/kill-player")
    async def admin_kill_player(target_username: str, current_user: dict = Depends(require_admin_or_mod)):
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is already dead")
        now_iso = datetime.now(timezone.utc).isoformat()
        # Store token counts at death for Dead > Alive restoration
        tokens_at_death = {}
        for token_type, cfg in TOKEN_CONFIG.items():
            count_field = cfg["count_field"]
            tokens_at_death[count_field] = int(target.get(count_field, 0) or 0)
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {
                "is_dead": True,
                "dead_at": now_iso,
                "death_by_staff": True,
                "points_at_death": int(target.get("points", 0) or 0),
                "money_at_death": int(target.get("money", 0) or 0),
                "tokens_at_death": tokens_at_death,
                "money": 0,
                "health": 0,
            }, "$inc": {"total_deaths": 1}}
        )
        try:
            from routers.game.families import maybe_promote_after_boss_death, _invalidate_list_cache
            await maybe_promote_after_boss_death(target["id"])
            _invalidate_list_cache()
        except Exception as e:
            logging.exception("Promote after boss death: %s", e)
        try:
            from routers.money.quicktrade import cancel_offers_on_death
            await cancel_offers_on_death(target["id"])
        except Exception as e:
            logging.exception("Quick trade offers on death: %s", e)
        return {"message": f"Killed {target_username}. Account is dead (cannot login); use Dead to Alive to revive."}

    @router.post("/admin/give-auto-rank")
    async def admin_give_auto_rank(target_username: str, current_user: dict = Depends(require_admin)):
        """Give a user auto rank: set auto_rank_purchased and auto_rank_enabled with default sub-options."""
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        updates = {
            "auto_rank_purchased": True,
            "auto_rank_enabled": True,
            "auto_rank_crimes": True,
            "auto_rank_gta": True,
            "auto_rank_bust_every_5_sec": False,
            "auto_rank_oc": False,
            "auto_rank_booze": False,
            "auto_rank_telegram_notify": True,
        }
        await db.users.update_one({"id": target["id"]}, {"$set": updates})
        return {"message": f"Auto rank given to {target.get('username', target_username)}", "username": target.get("username")}

    @router.post("/admin/remove-auto-rank")
    async def admin_remove_auto_rank(target_username: str, current_user: dict = Depends(require_admin)):
        """Remove auto rank from a user: clear purchased, enabled, and related fields/stats."""
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        unset = {
            "auto_rank_stats_since": "",
            "auto_rank_total_busts": "",
            "auto_rank_total_crimes": "",
            "auto_rank_total_gtas": "",
            "auto_rank_total_cash": "",
            "auto_rank_best_cars": "",
            "auto_rank_total_booze_runs": "",
            "auto_rank_total_booze_profit": "",
        }
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "auto_rank_purchased": False,
                    "auto_rank_enabled": False,
                    "auto_rank_crimes": False,
                    "auto_rank_gta": False,
                    "auto_rank_bust_every_5_sec": False,
                    "auto_rank_oc": False,
                    "auto_rank_booze": False,
                },
                "$unset": unset,
            },
        )
        return {"message": f"Auto rank removed from {target.get('username', target_username)}", "username": target.get("username")}

    @router.post("/admin/revive-player")
    async def admin_revive_player(target_username: str, current_user: dict = Depends(require_admin_or_mod)):
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if not target.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is not dead")
        current_state = target.get("current_state")
        if not current_state or current_state not in STATES:
            current_state = STATES[0]
        await db.users.update_one(
            {"id": target["id"]},
            {
                "$set": {
                    "is_dead": False,
                    "dead_at": None,
                    "health": DEFAULT_HEALTH,
                    "money": 1000,
                    "current_state": current_state,
                    "in_jail": False,
                },
                "$unset": {
                    "killed_by_username": "",
                    "killed_by_user_id": "",
                    "killed_by_family_name": "",
                    "death_by_staff": "",
                    "points_at_death": "",
                    "money_at_death": "",
                    "tokens_at_death": "",
                    "traveling_to": "",
                    "travel_arrives_at": "",
                    "jail_until": "",
                },
            },
        )
        await db.attacks.delete_many({"attacker_id": target["id"]})
        return {"message": f"Revived {target_username}. They can log in again."}

    @router.post("/admin/change-email")
    async def admin_change_email(
        target_username: str,
        body: AdminChangeEmailRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Change a user's email. New email must not be disposable and must be unique."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        new_email = (body.new_email or "").strip().lower()
        if not new_email or "@" not in new_email:
            raise HTTPException(status_code=400, detail="Valid email required")
        if is_disposable_email(new_email):
            raise HTTPException(status_code=400, detail="Disposable email addresses are not allowed.")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        existing = await db.users.find_one(
            {"email": re.compile("^" + re.escape(new_email) + "$", re.IGNORECASE), "id": {"$ne": target["id"]}},
            {"_id": 0, "id": 1},
        )
        if existing:
            raise HTTPException(status_code=400, detail="That email is already in use by another account.")
        await db.users.update_one({"id": target["id"]}, {"$set": {"email": new_email}})
        await db.login_lockouts.delete_many({"email": (target.get("email") or "").strip().lower()})
        return {"message": f"Email updated for {target.get('username', target_username)}", "username": target.get("username")}

    @router.post("/admin/log-out-user")
    async def admin_log_out_user(target_username: str, current_user: dict = Depends(get_current_user)):
        """Invalidate all sessions for the user; they must log in again."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"id": target["id"]}, {"$inc": {"token_version": 1}})
        return {"message": f"{target.get('username', target_username)} has been logged out. All their sessions are invalid."}

    @router.post("/admin/log-out-all-users")
    async def admin_log_out_all_users(current_user: dict = Depends(get_current_user)):
        """Bump token_version for every user except the caller so all JWTs invalidate; caller stays logged in."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        admin_id = current_user.get("id")
        if not admin_id:
            raise HTTPException(status_code=400, detail="Missing admin user id")
        result = await db.users.update_many(
            {"id": {"$ne": admin_id}},
            {"$inc": {"token_version": 1}},
        )
        return {
            "message": f"Logged out {result.modified_count} account(s). Your session stays active.",
            "modified_count": result.modified_count,
        }

    @router.get("/admin/user-sessions")
    async def admin_get_user_sessions(
        target_username: str = Query(..., description="Username to list sessions for"),
        current_user: dict = Depends(get_current_user),
    ):
        """List sessions (IP, device, last used) for a user. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one(
            {"username": username_pattern},
            {"_id": 0, "id": 1, "username": 1, "sessions": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        sessions_raw = target.get("sessions") or []
        sessions = [
            {
                "id": s.get("id"),
                "ip": (s.get("ip") or "").strip(),
                "device_type": (s.get("device_type") or "Unknown").strip(),
                "created_at": s.get("created_at"),
                "last_used_at": s.get("last_used_at"),
            }
            for s in sessions_raw
            if s.get("id")
        ]
        return {"username": target.get("username"), "sessions": sessions}

    @router.post("/admin/sessions/revoke")
    async def admin_revoke_session(
        body: AdminRevokeSessionRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Revoke one session for a user (by username and session_id). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        session_id = (body.session_id or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id required")
        username_pattern = _username_pattern(body.target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        result = await db.users.update_one(
            {"id": target["id"]},
            {"$pull": {"sessions": {"id": session_id}}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Session not found or already revoked")
        return {"message": f"Session revoked for {target.get('username', body.target_username)}."}

    def _session_datetime(session: dict) -> Optional[datetime]:
        """Parse last_used_at or created_at from a session entry; return None if unparseable."""
        for key in ("last_used_at", "created_at"):
            val = session.get(key)
            if not val:
                continue
            try:
                if isinstance(val, str):
                    dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                else:
                    dt = val
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except (ValueError, TypeError):
                continue
        return None

    @router.get("/admin/sessions/stats")
    async def admin_sessions_stats(current_user: dict = Depends(get_current_user)):
        """Return total active sessions and number of users with at least one session. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        pipeline = [
            {"$match": {"sessions": {"$exists": True, "$ne": []}}},
            {"$project": {"count": {"$size": "$sessions"}}},
            {"$group": {"_id": None, "total_sessions": {"$sum": "$count"}, "users_with_sessions": {"$sum": 1}}},
        ]
        cursor = db.users.aggregate(pipeline)
        row = await cursor.to_list(length=1)
        if not row:
            return {"total_sessions": 0, "users_with_sessions": 0}
        return {"total_sessions": row[0]["total_sessions"], "users_with_sessions": row[0]["users_with_sessions"]}

    @router.post("/admin/sessions/revoke-old")
    async def admin_revoke_old_sessions(
        body: AdminRevokeOldSessionsRequest = Body(default=None),
        current_user: dict = Depends(get_current_user),
    ):
        """Revoke all sessions older than 24 hours. Optionally limit to target_username. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        body = body or AdminRevokeOldSessionsRequest()
        target_username = (body.target_username or "").strip() or None

        if target_username:
            username_pattern = _username_pattern(target_username)
            target = await db.users.find_one(
                {"username": username_pattern},
                {"_id": 0, "id": 1, "username": 1, "sessions": 1},
            )
            if not target:
                raise HTTPException(status_code=404, detail="User not found")
            sessions_raw = target.get("sessions") or []
            keep = [
                s for s in sessions_raw
                if s.get("id") and (_session_datetime(s) is not None and _session_datetime(s) >= cutoff)
            ]
            removed = len(sessions_raw) - len(keep)
            if removed > 0:
                await db.users.update_one({"id": target["id"]}, {"$set": {"sessions": keep}})
            return {
                "message": f"Revoked {removed} session(s) older than 24h for {target.get('username', target_username)}.",
                "revoked_count": removed,
                "users_affected": 1 if removed > 0 else 0,
            }

        revoked_total = 0
        users_affected = 0
        async for user in db.users.find({"sessions": {"$exists": True, "$ne": []}}, {"_id": 0, "id": 1, "sessions": 1}):
            sessions_raw = user.get("sessions") or []
            keep = [
                s for s in sessions_raw
                if s.get("id") and (_session_datetime(s) is not None and _session_datetime(s) >= cutoff)
            ]
            removed = len(sessions_raw) - len(keep)
            if removed > 0:
                await db.users.update_one({"id": user["id"]}, {"$set": {"sessions": keep}})
                revoked_total += removed
                users_affected += 1
        return {
            "message": f"Revoked {revoked_total} session(s) older than 24h across {users_affected} user(s).",
            "revoked_count": revoked_total,
            "users_affected": users_affected,
        }

    @router.post("/admin/set-password")
    async def admin_set_password(
        target_username: str,
        body: AdminSetPasswordRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Set a user's password (e.g. temporary password). They can change it after logging in."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not (body.new_password or "").strip() or len((body.new_password or "").strip()) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        new_hash = get_password_hash((body.new_password or "").strip())
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"password_hash": new_hash, "sessions": []}, "$inc": {"token_version": 1}}
        )
        return {"message": f"Password set for {target.get('username', target_username)}. They have been logged out and must log in with the new password."}

    @router.get("/admin/profile-load-errors")
    async def admin_profile_load_errors(limit: int = Query(50, ge=1, le=200), current_user: dict = Depends(get_current_user)):
        """List recent profile load failures (auth/me 500) so admins can see what went wrong for which user."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        rows = await db.profile_load_errors.find(
            {},
            {"_id": 0, "id": 1, "user_id": 1, "username": 1, "error": 1, "traceback": 1, "created_at": 1},
        ).sort("created_at", -1).limit(limit).to_list(limit)
        return {"errors": rows, "count": len(rows)}

    @router.get("/admin/login-issues")
    async def admin_login_issues(limit: int = Query(100, ge=1, le=500), current_user: dict = Depends(get_current_user)):
        """List current login lockouts (too many failed attempts). Shows email, failed count, locked until, and username if account exists. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        cursor = db.login_lockouts.find({}, {"_id": 0, "email": 1, "failed_count": 1, "locked_until": 1, "updated_at": 1}).sort("updated_at", -1).limit(limit)
        rows = await cursor.to_list(limit)
        out = []
        for r in rows:
            email = (r.get("email") or "").strip().lower()
            locked_until = r.get("locked_until")
            if isinstance(locked_until, str):
                try:
                    locked_until = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
                except ValueError:
                    locked_until = None
            still_locked = locked_until and locked_until > now
            user = await db.users.find_one({"email": re.compile("^" + re.escape(email) + "$", re.IGNORECASE)}, {"_id": 0, "username": 1}) if email else None
            out.append({
                "email": email,
                "username": user.get("username") if user else None,
                "failed_count": r.get("failed_count", 0),
                "locked_until": r.get("locked_until"),
                "updated_at": r.get("updated_at"),
                "still_locked": still_locked,
            })
        return {"lockouts": out, "count": len(out)}

    @router.post("/admin/clear-login-lockout")
    async def admin_clear_login_lockout(target_username: str, current_user: dict = Depends(get_current_user)):
        """Clear login lockout for a user (by their current email), so they can try logging in again. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        email = (target.get("email") or "").strip().lower()
        if email:
            result = await db.login_lockouts.delete_many({"email": email})
            return {"message": f"Login lockout cleared for {target.get('username', target_username)}", "deleted_count": result.deleted_count}
        return {"message": f"No email on account; nothing to clear.", "username": target.get("username")}

    @router.post("/admin/clear-login-lockout-by-email")
    async def admin_clear_login_lockout_by_email(email: str, current_user: dict = Depends(get_current_user)):
        """Clear login lockout for an email (e.g. from the login-issues list). Use when you don't know the username. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        email_clean = (email or "").strip().lower()
        if not email_clean or "@" not in email_clean:
            raise HTTPException(status_code=400, detail="Valid email required")
        result = await db.login_lockouts.delete_many({"email": email_clean})
        return {"message": f"Login lockout cleared for {email_clean}", "deleted_count": result.deleted_count}

    @router.post("/admin/set-search-time")
    async def admin_set_search_time(target_username: str, search_minutes: int, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        if not username_pattern:
            raise HTTPException(status_code=404, detail="User not found")
        attacker = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not attacker:
            raise HTTPException(status_code=404, detail="User not found")
        if int(search_minutes) <= 0:
            await db.users.update_one({"id": attacker["id"]}, {"$unset": {"search_minutes_override": ""}})
            return {"message": f"Cleared {target_username}'s search time override (back to default)"}
        await db.users.update_one({"id": attacker["id"]}, {"$set": {"search_minutes_override": int(search_minutes)}})
        new_found_time = datetime.now(timezone.utc) + timedelta(minutes=int(search_minutes))
        await db.attacks.update_many(
            {"attacker_id": attacker["id"], "status": "searching"},
            {"$set": {"found_at": new_found_time.isoformat()}}
        )
        return {"message": f"Set {target_username}'s search time to {search_minutes} minutes (persistent)"}

    @router.post("/admin/set-all-search-time")
    async def admin_set_all_search_time(search_minutes: int = 5, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if search_minutes <= 0:
            raise HTTPException(status_code=400, detail="search_minutes must be positive")
        res = await db.users.update_many(
            {},
            {"$set": {"search_minutes_override": int(search_minutes)}}
        )
        await db.game_config.update_one(
            {"id": "main"},
            {"$set": {"default_search_minutes": int(search_minutes)}},
            upsert=True
        )
        new_found_time = datetime.now(timezone.utc) + timedelta(minutes=int(search_minutes))
        await db.attacks.update_many(
            {"status": "searching"},
            {"$set": {"found_at": new_found_time.isoformat()}}
        )
        return {"message": f"Set all users' search time to {search_minutes} minutes, persistent for everyone including new users ({res.modified_count} users updated)"}

    @router.post("/admin/clear-all-searches")
    async def admin_clear_all_searches(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        res = await db.attacks.delete_many({})
        return {"message": f"Cleared all searches ({res.deleted_count} deleted)"}

    @router.get("/admin/exclusive-loot")
    async def admin_exclusive_loot(current_user: dict = Depends(get_current_user)):
        """List users who own exclusive loot (cars, weapon, armour, property). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cars_catalog = {c["id"]: c for c in (CARS or [])}
        # Exclusive cars: car20 (exclusive), car21 (loot_exclusive)
        exclusive_car_ids = {c["id"] for c in (CARS or []) if c.get("rarity") in ("exclusive", "loot_exclusive")}
        users_by_id = {}
        async def _add_user(uid: str, category: str, item: str):
            if uid not in users_by_id:
                u = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "username": 1})
                users_by_id[uid] = {"username": (u or {}).get("username", "?"), "items": []}
            users_by_id[uid]["items"].append({"category": category, "item": item})
        # Cars
        cursor = db.user_cars.find({"car_id": {"$in": list(exclusive_car_ids)}}, {"_id": 0, "user_id": 1, "car_id": 1})
        async for uc in cursor:
            info = cars_catalog.get(uc.get("car_id"), {})
            name = info.get("name") or uc.get("car_id") or "?"
            await _add_user(uc["user_id"], "car", name)
        # Weapon (Colt Monitor / weapon_loot)
        cursor = db.user_weapons.find({"weapon_id": "weapon_loot", "quantity": {"$gte": 1}}, {"_id": 0, "user_id": 1})
        async for uw in cursor:
            await _add_user(uw["user_id"], "weapon", "Colt Monitor")
        # Armour level 6 (Steel Plate Vest 1922)
        cursor = db.users.find({"$or": [{"armour_level": 6}, {"armour_owned_level_max": {"$gte": 6}}]}, {"_id": 0, "id": 1, "username": 1})
        async for u in cursor:
            uid = u["id"]
            if uid not in users_by_id:
                users_by_id[uid] = {"username": u.get("username", "?"), "items": []}
            users_by_id[uid]["items"].append({"category": "armour", "item": "Steel Plate Vest 1922"})
        # Exclusive property (Speakeasy)
        cursor = db.exclusive_properties.find({"type": "speakeasy"}, {"_id": 0, "owner_id": 1})
        async for ep in cursor:
            await _add_user(ep["owner_id"], "property", "Speakeasy")
        out = sorted(users_by_id.values(), key=lambda x: (-len(x["items"]), x["username"].lower()))
        return {"owners": out}

    def _staff_shell_access(user: dict) -> bool:
        """Same gate as Admin SPA shell: listed admin email, moderator, or full admin powers."""
        return bool(_is_admin(user) or _is_moderator(user) or user_has_admin_list_email(user))

    def _presence_ip(request: Request) -> str:
        cf_ip = request.headers.get("cf-connecting-ip")
        if cf_ip:
            n = normalize_ip_string(cf_ip)
            if n:
                return n[:45]
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            n = normalize_ip_string(first)
            if n:
                return n[:45]
        if request.client:
            return (normalize_ip_string(request.client.host or "") or "")[:45]
        return ""

    def _device_type_from_ua(ua: str) -> str:
        if not (ua or "").strip():
            return "Unknown"
        u_lower = (ua or "").lower()
        if "ipad" in u_lower or ("android" in u_lower and "mobile" not in u_lower) or "tablet" in u_lower:
            return "Tablet"
        if "mobile" in u_lower or "android" in u_lower or "iphone" in u_lower or "ipod" in u_lower:
            return "Mobile"
        return "Desktop"

    PRESENCE_STALE_SEC = 90

    async def _admin_presence_active_viewers(me_id: str, presence_within_hours: Optional[int] = None):
        """List admin_tool_presence rows with last_seen in the lookback window (default ~90s live; optional hours for audit)."""
        if presence_within_hours is not None and presence_within_hours > 0:
            h = min(168, max(1, int(presence_within_hours)))
            lookback_sec = h * 3600
            max_rows = 500
        else:
            lookback_sec = PRESENCE_STALE_SEC
            max_rows = 200
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=lookback_sec)
        cursor = db.admin_tool_presence.find(
            {"last_seen_at": {"$gte": cutoff}},
            {"_id": 0, "user_id": 1, "username": 1, "tab_id": 1, "section": 1, "route_path": 1, "last_seen_at": 1, "ip": 1, "device_type": 1},
        ).sort("last_seen_at", -1)
        rows = await cursor.to_list(max_rows)
        viewers = []
        for r in rows:
            uid = str(r.get("user_id") or "")
            ts = r.get("last_seen_at")
            viewers.append(
                {
                    "user_id": uid,
                    "username": r.get("username") or "?",
                    "tab_id": r.get("tab_id"),
                    "section": r.get("section"),
                    "route_path": r.get("route_path"),
                    "ip": r.get("ip") or "",
                    "device_type": r.get("device_type") or "",
                    "last_seen_at": ts.isoformat() if hasattr(ts, "isoformat") else (str(ts) if ts else ""),
                    "is_self": uid == me_id,
                }
            )
        return viewers

    def _summarize_presence_accounts(viewers: list) -> list:
        """One row per user_id: latest heartbeat, tab count, distinct IPs, last route (for overview popover)."""
        by_uid: Dict[str, Dict[str, Any]] = {}
        for v in viewers or []:
            uid = str(v.get("user_id") or "").strip()
            if not uid:
                continue
            ts_str = str(v.get("last_seen_at") or "")
            ip = (v.get("ip") or "").strip()
            if uid not in by_uid:
                by_uid[uid] = {
                    "user_id": uid,
                    "username": v.get("username") or "?",
                    "last_seen_at": ts_str,
                    "tab_count": 0,
                    "ips": set(),
                    "last_section": v.get("section"),
                    "last_route_path": v.get("route_path"),
                    "is_self": bool(v.get("is_self")),
                }
            ent = by_uid[uid]
            ent["tab_count"] = int(ent.get("tab_count") or 0) + 1
            if ip:
                ent["ips"].add(ip)
            old_ts = str(ent.get("last_seen_at") or "")
            if ts_str and (not old_ts or ts_str > old_ts):
                ent["last_seen_at"] = ts_str
                ent["username"] = v.get("username") or ent.get("username") or "?"
                ent["last_section"] = v.get("section")
                ent["last_route_path"] = v.get("route_path")
                ent["is_self"] = bool(v.get("is_self"))
        out: list = []
        for ent in by_uid.values():
            ips_set = ent.pop("ips", set())
            ent["ips"] = sorted(ips_set) if isinstance(ips_set, set) else []
            out.append(ent)
        out.sort(key=lambda x: str(x.get("last_seen_at") or ""), reverse=True)
        return out

    @router.post("/admin/presence/heartbeat")
    async def admin_presence_heartbeat(
        body: AdminPresenceHeartbeatRequest,
        request: Request,
        current_user: dict = Depends(get_current_user),
    ):
        """Register/update this browser tab as viewing staff tools (expires after ~90s without heartbeat)."""
        if not _staff_shell_access(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        uid = str(current_user.get("id") or "")
        un = str(current_user.get("username") or "?")
        ua = request.headers.get("user-agent") or ""
        await db.admin_tool_presence.update_one(
            {"user_id": uid, "tab_id": body.tab_id.strip()},
            {
                "$set": {
                    "username": un,
                    "section": (body.section or "").strip()[:120] or None,
                    "route_path": (body.path or "").strip()[:400] or None,
                    "last_seen_at": now,
                    "ip": _presence_ip(request),
                    "device_type": _device_type_from_ua(ua),
                    "user_agent_short": ua[:200] if ua else "",
                }
            },
            upsert=True,
        )
        return {"ok": True}

    @router.get("/admin/presence")
    async def admin_presence_list(
        current_user: dict = Depends(get_current_user),
        within_hours: Optional[int] = Query(
            default=None,
            ge=1,
            le=168,
            description="If set, include tabs whose last admin heartbeat was within this many hours (default ~90s).",
        ),
    ):
        """Who has staff admin open: default live window (~90s); optional within_hours for day/week overview."""
        if not _staff_shell_access(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        me_id = str(current_user.get("id") or "")
        if within_hours is not None and within_hours > 0:
            presence_window_seconds = min(168, max(1, int(within_hours))) * 3600
        else:
            presence_window_seconds = PRESENCE_STALE_SEC
        viewers = await _admin_presence_active_viewers(me_id, presence_within_hours=within_hours)
        unique_accounts = _summarize_presence_accounts(viewers)
        return {
            "viewers": viewers,
            "stale_after_seconds": PRESENCE_STALE_SEC,
            "presence_within_hours": within_hours,
            "presence_window_seconds": presence_window_seconds,
            "unique_accounts": unique_accounts,
        }

    @router.post("/admin/tool-access/shell-open")
    async def admin_tool_access_shell_open(
        body: AdminToolAccessShellOpenRequest,
        request: Request,
        current_user: dict = Depends(get_current_user),
    ):
        """Record that this browser tab reached a usable staff shell (2xx staff JWT + portal if enabled)."""
        if not _staff_shell_access(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from utils.admin_tool_access_log import record_shell_open_event

        uid = str(current_user.get("id") or "")
        un = str(current_user.get("username") or "?")
        em = str(current_user.get("email") or "")
        await record_shell_open_event(
            db,
            user_id=uid,
            username=un,
            email=em,
            client_ip=_presence_ip(request),
            route_path=(body.path or "").strip() or None,
        )
        return {"ok": True}

    @router.post("/admin/tool-access/report-spa-unauthorized")
    async def admin_tool_access_report_spa_unauthorized(
        body: AdminToolAccessSpaUnauthorizedRequest,
        request: Request,
        current_user: dict = Depends(get_current_user),
    ):
        """Non-staff loads /staffrole/admin in the SPA; log + inbox staff here (throttled)."""
        if _staff_shell_access(current_user):
            return {"ok": True, "recorded": False}
        from utils.staff_access_audit import record_staff_spa_unauthorized_visit

        uid = str(current_user.get("id") or "")
        un = str(current_user.get("username") or "?")
        em = str(current_user.get("email") or "")
        p = (body.path or "").strip() or None
        recorded = await record_staff_spa_unauthorized_visit(
            db,
            spa_path=p,
            user_id=uid,
            username=un,
            email=em,
            client_ip=_presence_ip(request),
            send_notification=send_notification,
            get_notify_user_ids=srv._get_staff_user_ids,
        )
        return {"ok": True, "recorded": recorded}

    @router.get("/admin/tool-access-audit")
    async def admin_tool_access_audit(
        hours: int = Query(72, ge=1, le=720),
        event_limit: int = Query(500, ge=1, le=2000),
        denial_limit: int = Query(150, ge=0, le=500),
        presence_within_hours: Optional[int] = Query(
            default=None,
            ge=1,
            le=168,
            description="If set, list admin tabs whose last heartbeat was within this many hours (default is ~90s live only).",
        ),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """Recent successful staff API usage, SPA shell opens, live admin tabs, and staff-route denials."""
        from utils.admin_tool_access_log import COLLECTION as _TOOL_ACCESS_COL
        from utils.staff_access_audit import COLLECTION as _DENIAL_COL

        now = datetime.now(timezone.utc)
        cutoff_iso = (now - timedelta(hours=hours)).isoformat()
        me_id = str(current_user.get("id") or "")
        if presence_within_hours is not None and presence_within_hours > 0:
            presence_window_seconds = min(168, max(1, int(presence_within_hours))) * 3600
        else:
            presence_window_seconds = PRESENCE_STALE_SEC
        viewers = await _admin_presence_active_viewers(me_id, presence_within_hours=presence_within_hours)
        unique_accounts = _summarize_presence_accounts(viewers)

        ev_cursor = db[_TOOL_ACCESS_COL].find({"created_at": {"$gte": cutoff_iso}}, {"_id": 0}).sort("created_at", -1).limit(
            event_limit
        )
        events = await ev_cursor.to_list(event_limit)

        denials: list = []
        if denial_limit > 0:
            d_cursor = (
                db[_DENIAL_COL].find({"created_at": {"$gte": cutoff_iso}}, {"_id": 0}).sort("created_at", -1).limit(denial_limit)
            )
            denials = await d_cursor.to_list(denial_limit)

        return {
            "hours": hours,
            "stale_after_seconds": PRESENCE_STALE_SEC,
            "presence_window_seconds": presence_window_seconds,
            "presence_within_hours": presence_within_hours,
            "active_viewers": viewers,
            "unique_accounts": unique_accounts,
            "events": events,
            "denials": denials,
        }

    @router.get("/admin/check")
    async def admin_check(current_user: dict = Depends(require_admin_or_mod)):
        return await build_staff_flags_payload(db, current_user)

    @router.get("/admin/moderators")
    async def admin_list_moderators(current_user: dict = Depends(get_current_user)):
        """List users who are moderators. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.users.find(
            {"is_moderator": True},
            {"_id": 0, "id": 1, "username": 1, "email": 1},
        )
        mods = await cursor.to_list(500)
        return {"moderators": mods}

    @router.post("/admin/promote-moderator")
    async def admin_promote_moderator(target_username: str, current_user: dict = Depends(get_current_user)):
        """Promote a user to moderator. Admin only. Moderators can view logs, account info, and lock users; they cannot give/take wealth or change rank."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1, "is_moderator": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("email") in ADMIN_EMAILS:
            raise HTTPException(status_code=400, detail="Admins are already full admins; no need to promote as moderator")
        if target.get("is_moderator"):
            return {"message": f"{target.get('username', target_username)} is already a moderator."}
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_moderator": True}})
        return {"message": f"Promoted {target.get('username', target_username)} to moderator."}

    @router.post("/admin/demote-moderator")
    async def admin_demote_moderator(target_username: str, current_user: dict = Depends(get_current_user)):
        """Remove moderator role from a user. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_moderator": False}})
        return {"message": f"Removed moderator role from {target.get('username', target_username)}."}

    @router.get("/admin/help-desk-operators")
    async def admin_list_hdos(current_user: dict = Depends(get_current_user)):
        """List Help Desk Operators. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.users.find(
            {"is_help_desk_operator": True},
            {"_id": 0, "id": 1, "username": 1, "email": 1},
        )
        hdos = await cursor.to_list(500)
        return {"help_desk_operators": hdos}

    @router.post("/admin/promote-hdo")
    async def admin_promote_hdo(target_username: str, current_user: dict = Depends(get_current_user)):
        """Promote a user to Help Desk Operator. Admin or moderator. HDOs can reply to and close help desk tickets."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "is_help_desk_operator": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("is_help_desk_operator"):
            return {"message": f"{target.get('username', target_username)} is already a Help Desk Operator."}
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_help_desk_operator": True}})
        return {"message": f"Promoted {target.get('username', target_username)} to Help Desk Operator."}

    @router.post("/admin/demote-hdo")
    async def admin_demote_hdo(target_username: str, current_user: dict = Depends(get_current_user)):
        """Remove Help Desk Operator role. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_help_desk_operator": False}})
        return {"message": f"Removed Help Desk Operator role from {target.get('username', target_username)}."}

    async def _ensure_hdo_point_request_indexes_admin():
        coll = db.help_desk_hdo_point_requests
        await coll.create_index([("status", 1), ("created_at", -1)])
        await coll.create_index([("hdo_user_id", 1), ("status", 1)])
        await coll.create_index("ticket_id", unique=True)

    @router.get("/admin/help-desk/hdo-point-requests")
    async def admin_list_hdo_point_requests(
        status: str = Query("pending", description="pending | approved | rejected | all"),
        limit: int = Query(50, ge=1, le=200),
        current_user: dict = Depends(get_current_user),
    ):
        """Admin: list HDO close-reward requests for approval."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        await _ensure_hdo_point_request_indexes_admin()
        coll = db.help_desk_hdo_point_requests
        if status == "all":
            query = {}
        elif status in ("pending", "approved", "rejected"):
            query = {"status": status}
        else:
            raise HTTPException(status_code=400, detail="status must be pending, approved, rejected, or all")
        cursor = coll.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
        rows = await cursor.to_list(limit)
        return {"requests": rows}

    @router.post("/admin/help-desk/hdo-point-requests/{request_id}/approve")
    async def admin_approve_hdo_point_request(
        request_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        await _ensure_hdo_point_request_indexes_admin()
        req = await db.help_desk_hdo_point_requests.find_one({"id": request_id}, {"_id": 0})
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req.get("status") != "pending":
            raise HTTPException(status_code=400, detail="Request is not pending")
        hdo_uid = req.get("hdo_user_id")
        amt = int(req.get("amount") or 0)
        if not hdo_uid or amt <= 0:
            raise HTTPException(status_code=400, detail="Invalid request")
        now = datetime.now(timezone.utc).isoformat()
        res = await db.help_desk_hdo_point_requests.update_one(
            {"id": request_id, "status": "pending"},
            {
                "$set": {
                    "status": "approved",
                    "resolved_at": now,
                    "resolved_by_id": current_user["id"],
                    "resolved_by_username": current_user.get("username") or "?",
                }
            },
        )
        if res.modified_count == 0:
            raise HTTPException(status_code=400, detail="Request already processed")
        u_before = await db.users.find_one({"id": hdo_uid}, {"_id": 0, "points": 1})
        pts_before = int((u_before or {}).get("points") or 0)
        await db.users.update_one({"id": hdo_uid}, {"$inc": {"points": amt}})
        pts_after = pts_before + amt
        await log_points_event(
            db,
            user_id=hdo_uid,
            points=amt,
            event_type="hdo_ticket_close_reward",
            event_ref=request_id,
            meta={
                "ticket_id": req.get("ticket_id"),
                "approved_by": current_user.get("id"),
            },
            wallet_points_before=pts_before,
            wallet_points_after=pts_after,
        )
        return {"message": f"Approved {amt} points", "request_id": request_id}

    @router.post("/admin/help-desk/hdo-point-requests/{request_id}/reject")
    async def admin_reject_hdo_point_request(
        request_id: str,
        reason: Optional[str] = Body(None, embed=True),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        await _ensure_hdo_point_request_indexes_admin()
        req = await db.help_desk_hdo_point_requests.find_one({"id": request_id}, {"_id": 0})
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req.get("status") != "pending":
            raise HTTPException(status_code=400, detail="Request is not pending")
        now = datetime.now(timezone.utc).isoformat()
        reason_clean = (reason or "").strip()[:500] or None
        res = await db.help_desk_hdo_point_requests.update_one(
            {"id": request_id, "status": "pending"},
            {
                "$set": {
                    "status": "rejected",
                    "resolved_at": now,
                    "resolved_by_id": current_user["id"],
                    "resolved_by_username": current_user.get("username") or "?",
                    "reject_reason": reason_clean,
                }
            },
        )
        if res.modified_count == 0:
            raise HTTPException(status_code=400, detail="Request already processed")
        return {"message": "Rejected", "request_id": request_id}

    @router.get("/admin/entertainers")
    async def admin_list_entertainers(current_user: dict = Depends(get_current_user)):
        """List Entertainers. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.users.find(
            {"is_entertainer": True},
            {"_id": 0, "id": 1, "username": 1, "email": 1},
        )
        rows = await cursor.to_list(500)
        return {"entertainers": rows}

    @router.post("/admin/promote-entertainer")
    async def admin_promote_entertainer(target_username: str, current_user: dict = Depends(get_current_user)):
        """Promote a user to Entertainer. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one(
            {"username": username_pattern},
            {"_id": 0, "id": 1, "username": 1, "is_entertainer": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("is_entertainer"):
            return {"message": f"{target.get('username', target_username)} is already an Entertainer."}
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_entertainer": True}})
        try:
            await send_notification(
                target["id"],
                "Entertainer role",
                "You have been promoted to Entertainer. Open Entertainer Hub from the menu to view your fund, stats, and daily top-ups.",
                "system",
                category="entertainer",
            )
        except Exception:
            pass
        return {"message": f"Promoted {target.get('username', target_username)} to Entertainer."}

    @router.post("/admin/demote-entertainer")
    async def admin_demote_entertainer(target_username: str, current_user: dict = Depends(get_current_user)):
        """Remove Entertainer role. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one({"id": target["id"]}, {"$set": {"is_entertainer": False}})
        return {"message": f"Removed Entertainer role from {target.get('username', target_username)}."}

    @router.get("/admin/forum-mutes")
    async def admin_list_forum_mutes(
        status_filter: Optional[str] = Query(None, description="active, pending_review, or None for all"),
        current_user: dict = Depends(get_current_user),
    ):
        """List forum mutes. Admin, mod, or HDO. Auto-expires mutes whose expires_at has passed so they disappear from active list."""
        if not _can_forum_mute(current_user):
            raise HTTPException(status_code=403, detail="Access required")
        now_iso = datetime.now(timezone.utc).isoformat()
        # Auto-expire: mark mutes that have passed their expiry so they disappear and user can post again
        await db.forum_mutes.update_many(
            {"status": "active", "expires_at": {"$ne": None, "$lt": now_iso}},
            {"$set": {"status": "expired", "expired_at": now_iso}},
        )
        query = {}
        if status_filter in ("active", "pending_review"):
            query["status"] = status_filter
        else:
            query["status"] = {"$in": ["active", "pending_review"]}
        cursor = db.forum_mutes.find(query, {"_id": 0}).sort("created_at", -1).limit(200)
        mutes = await cursor.to_list(200)
        return {"mutes": mutes}

    @router.post("/admin/forum-mute")
    async def admin_forum_mute(body: ForumMuteRequest, current_user: dict = Depends(get_current_user)):
        """Mute a user from the forum (stops them posting). HDO: hours/days or permanent (pending review). Admin/mod: same, permanent is active immediately."""
        if not _can_forum_mute(current_user):
            raise HTTPException(status_code=403, detail="Access required")
        username_pattern = _username_pattern(body.target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("email") in ADMIN_EMAILS:
            raise HTTPException(status_code=400, detail="Cannot mute admins")
        if _is_moderator(target) or _is_hdo(target):
            raise HTTPException(status_code=400, detail="Cannot mute staff")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        permanent = bool(body.permanent)
        hours = body.duration_hours
        days = body.duration_days
        if permanent:
            expires_at = None
            status = "pending_review" if _is_hdo(current_user) and not _admin_or_mod(current_user) else "active"
        else:
            total_hours = 0
            if hours is not None and hours > 0:
                total_hours += hours
            if days is not None and days > 0:
                total_hours += days * 24
            if total_hours <= 0:
                raise HTTPException(status_code=400, detail="Set duration_hours, duration_days, or permanent=True")
            expires_at = (now + timedelta(hours=total_hours)).isoformat()
            status = "active"
            # Human-readable duration for the notification
            if days and days > 0 and (hours or 0) == 0:
                duration_text = f"{int(days)} day(s)" if days else ""
            elif hours and hours > 0 and (days or 0) == 0:
                duration_text = f"{int(hours)} hour(s)" if hours else ""
            else:
                duration_text = f"{total_hours:.0f} hours"
        mute_id = str(uuid.uuid4())
        reason = (body.reason or "").strip() or None
        doc = {
            "id": mute_id,
            "user_id": target["id"],
            "username": target.get("username") or body.target_username,
            "muted_by_id": current_user["id"],
            "muted_by_username": current_user.get("username") or "?",
            "reason": reason,
            "expires_at": expires_at,
            "status": status,
            "created_at": now_iso,
        }
        await db.forum_mutes.insert_one(doc)
        # Notify muted user in inbox: reason, duration, and when they will be auto-unmuted (if applicable)
        title = "Forum mute"
        parts = []
        if reason:
            parts.append(f"Reason: {reason}")
        if permanent:
            if status == "pending_review":
                parts.append("Duration: Permanent (pending staff approval). You cannot post on the forum until a staff member unmutes you.")
            else:
                parts.append("Duration: Permanent. You cannot post on the forum until a staff member unmutes you.")
        else:
            try:
                exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                exp_str = exp_dt.strftime("%b %d, %Y at %I:%M %p UTC")
            except Exception:
                exp_str = expires_at
            parts.append(f"Duration: {duration_text}. You will be auto-unmuted on {exp_str}. You cannot post on the forum until then.")
        message = "\n\n".join(parts)
        try:
            await send_notification(target["id"], title, message, "system", category="system")
        except Exception as e:
            logging.exception("Forum mute inbox notification: %s", e)
        msg = f"Muted {target.get('username')} from forum"
        if status == "pending_review":
            msg += " (permanent — pending admin/mod review)"
        elif expires_at:
            msg += f" until {expires_at}"
        return {"message": msg, "mute": {**doc, "_id": 0}}

    @router.post("/admin/forum-unmute")
    async def admin_forum_unmute(target_username: str, current_user: dict = Depends(get_current_user)):
        """Remove forum mute. Admin, mod, or HDO. Keeps record in mute log (status=unmuted)."""
        if not _can_forum_mute(current_user):
            raise HTTPException(status_code=403, detail="Access required")
        username_pattern = _username_pattern(target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        now_iso = datetime.now(timezone.utc).isoformat()
        res = await db.forum_mutes.update_many(
            {"user_id": target["id"], "status": {"$in": ["active", "pending_review"]}},
            {"$set": {"status": "unmuted", "unmuted_at": now_iso}},
        )
        return {"message": f"Unmuted {target.get('username', target_username)} from forum", "updated": res.modified_count}

    @router.post("/admin/forum-mute-approve")
    async def admin_forum_mute_approve(mute_id: str, current_user: dict = Depends(get_current_user)):
        """Approve a permanent mute (pending_review -> active). Admin or mod only."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator required")
        mute = await db.forum_mutes.find_one({"id": mute_id}, {"_id": 0})
        if not mute:
            raise HTTPException(status_code=404, detail="Mute not found")
        if mute.get("status") != "pending_review":
            raise HTTPException(status_code=400, detail="Mute is not pending review")
        await db.forum_mutes.update_one({"id": mute_id}, {"$set": {"status": "active"}})
        try:
            await send_notification(
                mute["user_id"],
                "Forum mute (permanent approved)",
                "Your permanent forum mute has been approved. You cannot post on the forum until a staff member unmutes you.",
                "system",
                category="system",
            )
        except Exception as e:
            logging.exception("Forum mute approval inbox notification: %s", e)
        return {"message": "Permanent mute approved", "mute_id": mute_id}

    @router.get("/admin/forum-mutes-log")
    async def admin_forum_mutes_log(current_user: dict = Depends(get_current_user)):
        """Past forum mutes (expired or unmuted) with reason. Admin, mod, or HDO."""
        if not _can_forum_mute(current_user):
            raise HTTPException(status_code=403, detail="Access required")
        cursor = db.forum_mutes.find(
            {"status": {"$in": ["expired", "unmuted"]}},
            {"_id": 0, "id": 1, "username": 1, "user_id": 1, "reason": 1, "muted_by_username": 1, "created_at": 1, "expires_at": 1, "expired_at": 1, "unmuted_at": 1, "status": 1},
        ).sort("created_at", -1).limit(500)
        entries = await cursor.to_list(500)
        return {"log": entries}

    @router.post("/admin/game-chat-mute")
    async def admin_game_chat_mute(body: GameChatMuteRequest, current_user: dict = Depends(get_current_user)):
        """Mute or unmute a user from game chat. Admin or mod only. Muted users cannot send messages."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator required")
        username_pattern = _username_pattern(body.target_username)
        target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "email": 1, "is_moderator": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("email") in ADMIN_EMAILS:
            raise HTTPException(status_code=400, detail="Cannot mute admins")
        if _is_moderator(target):
            raise HTTPException(status_code=400, detail="Cannot mute moderators")
        if body.muted:
            set_payload = {"game_chat_muted": True}
            unset_payload = {}
            if (body.muted_until or "").strip():
                set_payload["game_chat_muted_until"] = body.muted_until.strip()
            else:
                unset_payload["game_chat_muted_until"] = ""
            await db.users.update_one(
                {"id": target["id"]},
                {"$set": set_payload, **({"$unset": unset_payload} if unset_payload else {})},
            )
            try:
                until_msg = f" until {body.muted_until}" if (body.muted_until or "").strip() else ". Contact staff if you think this is a mistake."
                await send_notification(
                    target["id"],
                    "Game chat mute",
                    f"You have been muted from game chat{until_msg}",
                    "system",
                    category="system",
                )
            except Exception as e:
                logging.exception("Game chat mute notification: %s", e)
            return {"message": f"Muted {target.get('username')} from game chat"}
        else:
            await db.users.update_one(
                {"id": target["id"]},
                {"$set": {"game_chat_muted": False}, "$unset": {"game_chat_muted_until": ""}},
            )
            try:
                await send_notification(
                    target["id"],
                    "Game chat unmute",
                    "You can post in game chat again.",
                    "system",
                    category="system",
                )
            except Exception as e:
                logging.exception("Game chat unmute notification: %s", e)
            return {"message": f"Unmuted {target.get('username')} from game chat"}

    async def _bank_economy_admin_payload():
        import server as srv

        fb_sw = int(getattr(srv, "SWISS_BANK_LIMIT_START", 50_000_000) or 50_000_000)
        fb_opts = list(getattr(srv, "BANK_INTEREST_OPTIONS", []) or [])
        cfg = await get_bank_economy_config(
            db,
            swiss_fallback=fb_sw,
            interest_max_fallback=50_000_000,
            interest_options_fallback=fb_opts,
        )
        principals = [1_000_000, 10_000_000, 50_000_000]
        previews = compute_bank_interest_previews(cfg["interest_options"], principals)
        return {
            "bank_swiss_default_limit": cfg["swiss_limit_start"],
            "bank_interest_max_unclaimed_principal": cfg["interest_max_unclaimed_principal"],
            "bank_interest_options": cfg["interest_options"],
            "bank_interest_previews": previews,
            "bank_interest_preview_sample_principals": principals,
            "code_default_interest_options": [dict(x) for x in fb_opts],
        }

    @router.get("/admin/settings")
    async def admin_get_settings(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        MOD_DEFAULT = "#1e3a5f"
        doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (doc.get("value") or "#a78bfa") if doc else "#a78bfa"
        if not isinstance(admin_online_color, str) or not admin_online_color.strip():
            admin_online_color = "#a78bfa"
        mod_doc = await db.game_settings.find_one({"key": "mod_default_online_color"}, {"_id": 0, "value": 1})
        mod_default_online_color = (mod_doc.get("value") or MOD_DEFAULT) if mod_doc else MOD_DEFAULT
        if not isinstance(mod_default_online_color, str) or not mod_default_online_color.strip():
            mod_default_online_color = MOD_DEFAULT
        req_doc = await db.game_settings.find_one({"key": "require_email_verification"}, {"_id": 0, "value": 1})
        require_email_verification = bool(req_doc.get("value") if req_doc else True)  # default True when missing
        sm_doc = await db.game_settings.find_one({"key": "stock_market_max_points"}, {"_id": 0, "value": 1})
        stock_market_max_points = int(sm_doc["value"]) if sm_doc and sm_doc.get("value") is not None else 3000
        try:
            stock_market_max_points = max(1, int(stock_market_max_points))
        except (TypeError, ValueError):
            stock_market_max_points = 3000
        sb_cap_doc = await db.game_settings.find_one({"key": "sports_bet_max_total_open_stake"}, {"_id": 0, "value": 1})
        sports_bet_max_total_open_stake = 25_000_000
        if sb_cap_doc and sb_cap_doc.get("value") is not None:
            try:
                sports_bet_max_total_open_stake = max(1, min(int(sb_cap_doc["value"]), 10**15))
            except (TypeError, ValueError):
                sports_bet_max_total_open_stake = 25_000_000
        banner_doc = await db.game_settings.find_one({"key": "landing_banner_enabled"}, {"_id": 0, "value": 1})
        landing_banner_enabled = bool(banner_doc.get("value") if banner_doc else False)
        msg_doc = await db.game_settings.find_one({"key": "landing_banner_message"}, {"_id": 0, "value": 1})
        landing_banner_message = (msg_doc.get("value") or "") if msg_doc and msg_doc.get("value") is not None else ""
        main_doc = await db.game_settings.find_one({"_id": "main"})
        login_lock_from = main_doc.get("login_lock_from") if main_doc else None
        login_lock_until = main_doc.get("login_lock_until") if main_doc else None
        login_lock_message = main_doc.get("login_lock_message") if main_doc else None
        preregister_landing_banner_enabled = main_doc.get("preregister_landing_banner_enabled") if main_doc else None
        if preregister_landing_banner_enabled is None:
            preregister_landing_banner_enabled = True
        preregister_landing_banner_preview_open = bool(main_doc.get("preregister_landing_banner_preview_open")) if main_doc else False
        block_proxy_vpn_login = True if not main_doc else bool(main_doc.get("block_proxy_vpn_login", True))
        block_script_user_agent_login = True if not main_doc else bool(main_doc.get("block_script_user_agent_login", True))
        block_script_user_agent_game_actions = True if not main_doc else bool(main_doc.get("block_script_user_agent_game_actions", True))
        game_actions_client_strict = bool(main_doc.get("game_actions_client_strict")) if main_doc else False
        game_actions_turnstile_enabled = bool(main_doc.get("game_actions_turnstile_enabled")) if main_doc else False
        minigame_turnstile_enabled = bool(main_doc.get("minigame_turnstile_enabled")) if main_doc else False
        minigame_turnstile_site_key = (main_doc.get("minigame_turnstile_site_key") or "") if main_doc else ""
        login_turnstile_enabled = bool(main_doc.get("login_turnstile_enabled")) if main_doc else False
        sustained_page_rl_jail_enabled = bool(main_doc.get("sustained_page_rl_jail_enabled")) if main_doc else False
        sustained_page_rl_entertainer_enabled = bool(main_doc.get("sustained_page_rl_entertainer_enabled")) if main_doc else False
        sustained_page_rl_forum_enabled = bool(main_doc.get("sustained_page_rl_forum_enabled")) if main_doc else False
        sustained_page_rl_kill_enabled = (
            _kill_sustain_setting_enabled(main_doc.get("sustained_page_rl_kill_enabled")) if main_doc else True
        )
        sustained_page_rl_kill_max_gap_ms = clamp_kill_rl_max_gap_ms(
            main_doc.get("sustained_page_rl_kill_max_gap_ms") if main_doc else None
        )
        sustained_page_rl_kill_sustain_sec = clamp_kill_rl_sustain_sec(
            main_doc.get("sustained_page_rl_kill_sustain_sec") if main_doc else None
        )
        sustained_page_rl_gta_enabled = bool(main_doc.get("sustained_page_rl_gta_enabled")) if main_doc else False
        sustained_page_rl_crimes_enabled = bool(main_doc.get("sustained_page_rl_crimes_enabled")) if main_doc else False
        sustained_page_rl_oc_enabled = bool(main_doc.get("sustained_page_rl_oc_enabled")) if main_doc else False
        sustained_page_rl_booze_enabled = bool(main_doc.get("sustained_page_rl_booze_enabled")) if main_doc else False
        sustained_page_rl_game_chat_enabled = bool(main_doc.get("sustained_page_rl_game_chat_enabled")) if main_doc else False
        sustained_page_rl_store_enabled = bool(main_doc.get("sustained_page_rl_store_enabled")) if main_doc else False
        sustained_page_rl_ranking_enabled = bool(main_doc.get("sustained_page_rl_ranking_enabled")) if main_doc else False
        sustained_page_rl_notifications_enabled = bool(main_doc.get("sustained_page_rl_notifications_enabled")) if main_doc else False
        sustained_page_rl_hitlist_enabled = bool(main_doc.get("sustained_page_rl_hitlist_enabled")) if main_doc else False
        sustained_page_rl_bank_enabled = bool(main_doc.get("sustained_page_rl_bank_enabled")) if main_doc else False
        sustained_page_rl_leaderboard_enabled = bool(main_doc.get("sustained_page_rl_leaderboard_enabled")) if main_doc else False
        sustained_page_rl_families_enabled = bool(main_doc.get("sustained_page_rl_families_enabled")) if main_doc else False
        sustained_page_rl_stock_market_enabled = bool(main_doc.get("sustained_page_rl_stock_market_enabled")) if main_doc else False
        sustained_page_rl_quicktrade_enabled = bool(main_doc.get("sustained_page_rl_quicktrade_enabled")) if main_doc else False
        sustained_page_rl_properties_enabled = bool(main_doc.get("sustained_page_rl_properties_enabled")) if main_doc else False
        sustained_page_rl_armoury_enabled = bool(main_doc.get("sustained_page_rl_armoury_enabled")) if main_doc else False
        sustained_page_rl_bodyguards_enabled = bool(main_doc.get("sustained_page_rl_bodyguards_enabled")) if main_doc else False
        sustained_page_rl_missions_enabled = bool(main_doc.get("sustained_page_rl_missions_enabled")) if main_doc else False
        sustained_page_rl_travel_enabled = bool(main_doc.get("sustained_page_rl_travel_enabled")) if main_doc else False
        sustained_page_rl_events_enabled = bool(main_doc.get("sustained_page_rl_events_enabled")) if main_doc else False
        spotify_feature_enabled = bool(main_doc.get("spotify_feature_enabled", False)) if main_doc else False
        preorder_points_release_date = main_doc.get("preorder_points_release_date") if main_doc else None
        store_points_auto_credit = main_doc.get("store_points_auto_credit") if main_doc else None
        if store_points_auto_credit is None:
            store_points_auto_credit = True
        store_points_manual_credit_eta = main_doc.get("store_points_manual_credit_eta") if main_doc else None
        casino_global_max_bet = int(main_doc.get("casino_global_max_bet") or 1_000_000_000) if main_doc else 1_000_000_000
        casino_buyback_max_points = int(main_doc.get("casino_buyback_max_points") or 15_000) if main_doc else 15_000
        mp_poker_max_blind = int(main_doc.get("mp_poker_max_blind") or 2_500_000) if main_doc else 2_500_000
        mod_cat_doc = await db.game_settings.find_one({"key": "mod_visible_category_ids"}, {"_id": 0, "value": 1})
        raw_mod_cats = mod_cat_doc.get("value") if mod_cat_doc else None
        if isinstance(raw_mod_cats, list) and raw_mod_cats and all(isinstance(x, str) and x in ADMIN_CATEGORY_IDS for x in raw_mod_cats):
            mod_visible_category_ids = raw_mod_cats
        else:
            mod_visible_category_ids = list(MOD_VISIBLE_CATEGORY_IDS_DEFAULT)
        bank_payload = await _bank_economy_admin_payload()
        return {
            "admin_online_color": admin_online_color.strip(),
            "mod_default_online_color": mod_default_online_color.strip(),
            "require_email_verification": require_email_verification,
            "block_proxy_vpn_login": block_proxy_vpn_login,
            "block_script_user_agent_login": block_script_user_agent_login,
            "block_script_user_agent_game_actions": block_script_user_agent_game_actions,
            "game_actions_client_strict": game_actions_client_strict,
            "game_actions_turnstile_enabled": game_actions_turnstile_enabled,
            "minigame_turnstile_enabled": minigame_turnstile_enabled,
            "minigame_turnstile_site_key": (minigame_turnstile_site_key or "").strip(),
            "login_turnstile_enabled": login_turnstile_enabled,
            "sustained_page_rl_jail_enabled": sustained_page_rl_jail_enabled,
            "sustained_page_rl_entertainer_enabled": sustained_page_rl_entertainer_enabled,
            "sustained_page_rl_forum_enabled": sustained_page_rl_forum_enabled,
            "sustained_page_rl_kill_enabled": sustained_page_rl_kill_enabled,
            "sustained_page_rl_kill_max_gap_ms": sustained_page_rl_kill_max_gap_ms,
            "sustained_page_rl_kill_sustain_sec": sustained_page_rl_kill_sustain_sec,
            "sustained_page_rl_gta_enabled": sustained_page_rl_gta_enabled,
            "sustained_page_rl_crimes_enabled": sustained_page_rl_crimes_enabled,
            "sustained_page_rl_oc_enabled": sustained_page_rl_oc_enabled,
            "sustained_page_rl_booze_enabled": sustained_page_rl_booze_enabled,
            "sustained_page_rl_game_chat_enabled": sustained_page_rl_game_chat_enabled,
            "sustained_page_rl_store_enabled": sustained_page_rl_store_enabled,
            "sustained_page_rl_ranking_enabled": sustained_page_rl_ranking_enabled,
            "sustained_page_rl_notifications_enabled": sustained_page_rl_notifications_enabled,
            "sustained_page_rl_hitlist_enabled": sustained_page_rl_hitlist_enabled,
            "sustained_page_rl_bank_enabled": sustained_page_rl_bank_enabled,
            "sustained_page_rl_leaderboard_enabled": sustained_page_rl_leaderboard_enabled,
            "sustained_page_rl_families_enabled": sustained_page_rl_families_enabled,
            "sustained_page_rl_stock_market_enabled": sustained_page_rl_stock_market_enabled,
            "sustained_page_rl_quicktrade_enabled": sustained_page_rl_quicktrade_enabled,
            "sustained_page_rl_properties_enabled": sustained_page_rl_properties_enabled,
            "sustained_page_rl_armoury_enabled": sustained_page_rl_armoury_enabled,
            "sustained_page_rl_bodyguards_enabled": sustained_page_rl_bodyguards_enabled,
            "sustained_page_rl_missions_enabled": sustained_page_rl_missions_enabled,
            "sustained_page_rl_travel_enabled": sustained_page_rl_travel_enabled,
            "sustained_page_rl_events_enabled": sustained_page_rl_events_enabled,
            "spotify_feature_enabled": spotify_feature_enabled,
            "stock_market_max_points": stock_market_max_points,
            "sports_bet_max_total_open_stake": sports_bet_max_total_open_stake,
            "landing_banner_enabled": landing_banner_enabled,
            "landing_banner_message": landing_banner_message,
            "login_lock_from": login_lock_from,
            "login_lock_until": login_lock_until,
            "login_lock_message": login_lock_message,
            "preregister_landing_banner_enabled": bool(preregister_landing_banner_enabled),
            "preregister_landing_banner_preview_open": preregister_landing_banner_preview_open,
            "preorder_points_release_date": preorder_points_release_date,
            "store_points_auto_credit": bool(store_points_auto_credit),
            "store_points_manual_credit_eta": store_points_manual_credit_eta,
            "casino_global_max_bet": casino_global_max_bet,
            "casino_buyback_max_points": casino_buyback_max_points,
            "mp_poker_max_blind": mp_poker_max_blind,
            "mod_visible_category_ids": mod_visible_category_ids,
            **bank_payload,
        }

    @router.patch("/admin/settings")
    async def admin_patch_settings(body: AdminSettingsUpdate, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if body.admin_online_color is not None:
            val = (body.admin_online_color or "").strip() or "#a78bfa"
            if not val.startswith("#"):
                val = "#" + val
            await db.game_settings.update_one(
                {"key": "admin_online_color"},
                {"$set": {"value": val}},
                upsert=True,
            )
        if body.mod_default_online_color is not None:
            mod_default = "#1e3a5f"
            val = (body.mod_default_online_color or "").strip() or mod_default
            if not val.startswith("#"):
                val = "#" + val
            if len(val) > 9:
                val = mod_default
            await db.game_settings.update_one(
                {"key": "mod_default_online_color"},
                {"$set": {"value": val}},
                upsert=True,
            )
        if body.require_email_verification is not None:
            await db.game_settings.update_one(
                {"key": "require_email_verification"},
                {"$set": {"value": body.require_email_verification}},
                upsert=True,
            )
        if body.block_proxy_vpn_login is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"block_proxy_vpn_login": bool(body.block_proxy_vpn_login)}},
                upsert=True,
            )
        if body.block_script_user_agent_login is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"block_script_user_agent_login": bool(body.block_script_user_agent_login)}},
                upsert=True,
            )
        if body.block_script_user_agent_game_actions is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"block_script_user_agent_game_actions": bool(body.block_script_user_agent_game_actions)}},
                upsert=True,
            )
        if body.game_actions_client_strict is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"game_actions_client_strict": bool(body.game_actions_client_strict)}},
                upsert=True,
            )
        if body.game_actions_turnstile_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"game_actions_turnstile_enabled": bool(body.game_actions_turnstile_enabled)}},
                upsert=True,
            )
        if body.minigame_turnstile_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"minigame_turnstile_enabled": bool(body.minigame_turnstile_enabled)}},
                upsert=True,
            )
        if body.minigame_turnstile_site_key is not None:
            sk = (body.minigame_turnstile_site_key or "").strip()
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"minigame_turnstile_site_key": sk or None}},
                upsert=True,
            )
        if body.login_turnstile_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"login_turnstile_enabled": bool(body.login_turnstile_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_jail_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_jail_enabled": bool(body.sustained_page_rl_jail_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_entertainer_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_entertainer_enabled": bool(body.sustained_page_rl_entertainer_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_forum_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_forum_enabled": bool(body.sustained_page_rl_forum_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_kill_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_kill_enabled": bool(body.sustained_page_rl_kill_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_kill_max_gap_ms is not None:
            gap = clamp_kill_rl_max_gap_ms(body.sustained_page_rl_kill_max_gap_ms)
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_kill_max_gap_ms": gap}},
                upsert=True,
            )
        if body.sustained_page_rl_kill_sustain_sec is not None:
            sec = clamp_kill_rl_sustain_sec(body.sustained_page_rl_kill_sustain_sec)
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_kill_sustain_sec": sec}},
                upsert=True,
            )
        if body.sustained_page_rl_gta_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_gta_enabled": bool(body.sustained_page_rl_gta_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_crimes_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_crimes_enabled": bool(body.sustained_page_rl_crimes_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_oc_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_oc_enabled": bool(body.sustained_page_rl_oc_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_booze_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_booze_enabled": bool(body.sustained_page_rl_booze_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_game_chat_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_game_chat_enabled": bool(body.sustained_page_rl_game_chat_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_store_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_store_enabled": bool(body.sustained_page_rl_store_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_ranking_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_ranking_enabled": bool(body.sustained_page_rl_ranking_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_notifications_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_notifications_enabled": bool(body.sustained_page_rl_notifications_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_hitlist_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_hitlist_enabled": bool(body.sustained_page_rl_hitlist_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_bank_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_bank_enabled": bool(body.sustained_page_rl_bank_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_leaderboard_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_leaderboard_enabled": bool(body.sustained_page_rl_leaderboard_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_families_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_families_enabled": bool(body.sustained_page_rl_families_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_stock_market_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_stock_market_enabled": bool(body.sustained_page_rl_stock_market_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_quicktrade_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_quicktrade_enabled": bool(body.sustained_page_rl_quicktrade_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_properties_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_properties_enabled": bool(body.sustained_page_rl_properties_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_armoury_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_armoury_enabled": bool(body.sustained_page_rl_armoury_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_bodyguards_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_bodyguards_enabled": bool(body.sustained_page_rl_bodyguards_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_missions_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_missions_enabled": bool(body.sustained_page_rl_missions_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_travel_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_travel_enabled": bool(body.sustained_page_rl_travel_enabled)}},
                upsert=True,
            )
        if body.sustained_page_rl_events_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"sustained_page_rl_events_enabled": bool(body.sustained_page_rl_events_enabled)}},
                upsert=True,
            )
        if body.spotify_feature_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"spotify_feature_enabled": bool(body.spotify_feature_enabled)}},
                upsert=True,
            )
        if body.stock_market_max_points is not None:
            val = max(1, int(body.stock_market_max_points))
            await db.game_settings.update_one(
                {"key": "stock_market_max_points"},
                {"$set": {"value": val}},
                upsert=True,
            )
        if body.sports_bet_max_total_open_stake is not None:
            sb_val = max(1, min(int(body.sports_bet_max_total_open_stake), 10**15))
            await db.game_settings.update_one(
                {"key": "sports_bet_max_total_open_stake"},
                {"$set": {"value": sb_val}},
                upsert=True,
            )
        if body.landing_banner_enabled is not None:
            await db.game_settings.update_one(
                {"key": "landing_banner_enabled"},
                {"$set": {"value": body.landing_banner_enabled}},
                upsert=True,
            )
        if body.landing_banner_message is not None:
            await db.game_settings.update_one(
                {"key": "landing_banner_message"},
                {"$set": {"value": body.landing_banner_message}},
                upsert=True,
            )
        if body.login_lock_from is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"login_lock_from": body.login_lock_from if body.login_lock_from else None}},
                upsert=True,
            )
        if body.login_lock_until is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"login_lock_until": body.login_lock_until if body.login_lock_until else None}},
                upsert=True,
            )
        if body.login_lock_message is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"login_lock_message": body.login_lock_message if body.login_lock_message else None}},
                upsert=True,
            )
        if body.preregister_landing_banner_enabled is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"preregister_landing_banner_enabled": bool(body.preregister_landing_banner_enabled)}},
                upsert=True,
            )
        if body.preregister_landing_banner_preview_open is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"preregister_landing_banner_preview_open": bool(body.preregister_landing_banner_preview_open)}},
                upsert=True,
            )
        if body.preorder_points_release_date is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"preorder_points_release_date": body.preorder_points_release_date if body.preorder_points_release_date else None}},
                upsert=True,
            )
        if body.store_points_auto_credit is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"store_points_auto_credit": bool(body.store_points_auto_credit)}},
                upsert=True,
            )
        if body.store_points_manual_credit_eta is not None:
            eta = (body.store_points_manual_credit_eta or "").strip() or None
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"store_points_manual_credit_eta": eta}},
                upsert=True,
            )
        if body.casino_global_max_bet is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"casino_global_max_bet": max(50_000, int(body.casino_global_max_bet))}},
                upsert=True,
            )
        if body.casino_buyback_max_points is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"casino_buyback_max_points": max(0, int(body.casino_buyback_max_points))}},
                upsert=True,
            )
        if body.mp_poker_max_blind is not None:
            await db.game_settings.update_one(
                {"_id": "main"},
                {"$set": {"mp_poker_max_blind": max(1_000, int(body.mp_poker_max_blind))}},
                upsert=True,
            )
        if body.mod_visible_category_ids is not None:
            ids = list(body.mod_visible_category_ids) if isinstance(body.mod_visible_category_ids, list) else []
            if not all(isinstance(x, str) and x in ADMIN_CATEGORY_IDS for x in ids):
                raise HTTPException(status_code=400, detail="mod_visible_category_ids must be a list of valid admin category ids")
            await db.game_settings.update_one(
                {"key": "mod_visible_category_ids"},
                {"$set": {"value": ids}},
                upsert=True,
            )
        if body.bank_swiss_default_limit is not None:
            bv = max(1_000, min(int(body.bank_swiss_default_limit), 10**15))
            await db.game_settings.update_one(
                {"key": KEY_SWISS_DEFAULT},
                {"$set": {"key": KEY_SWISS_DEFAULT, "value": bv}},
                upsert=True,
            )
        if body.bank_interest_max_unclaimed_principal is not None:
            mv = max(1, min(int(body.bank_interest_max_unclaimed_principal), 10**15))
            await db.game_settings.update_one(
                {"key": KEY_INTEREST_MAX},
                {"$set": {"key": KEY_INTEREST_MAX, "value": mv}},
                upsert=True,
            )
        if body.bank_interest_options is not None:
            import server as srv

            raw_list = [x.model_dump() for x in body.bank_interest_options]
            fb_opts = list(getattr(srv, "BANK_INTEREST_OPTIONS", []) or [])
            cleaned = normalize_interest_options(raw_list, fb_opts)
            await db.game_settings.update_one(
                {"key": KEY_INTEREST_OPTIONS},
                {"$set": {"key": KEY_INTEREST_OPTIONS, "value": cleaned}},
                upsert=True,
            )
        MOD_DEFAULT = "#1e3a5f"
        doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
        admin_online_color = (doc.get("value") or "#a78bfa") if doc else "#a78bfa"
        mod_doc = await db.game_settings.find_one({"key": "mod_default_online_color"}, {"_id": 0, "value": 1})
        mod_default_online_color = (mod_doc.get("value") or MOD_DEFAULT) if mod_doc else MOD_DEFAULT
        if not isinstance(mod_default_online_color, str) or not mod_default_online_color.strip():
            mod_default_online_color = MOD_DEFAULT
        req_doc = await db.game_settings.find_one({"key": "require_email_verification"}, {"_id": 0, "value": 1})
        require_email_verification = bool(req_doc.get("value") if req_doc else True)  # default True when missing
        sm_doc = await db.game_settings.find_one({"key": "stock_market_max_points"}, {"_id": 0, "value": 1})
        stock_market_max_points = int(sm_doc["value"]) if sm_doc and sm_doc.get("value") is not None else 3000
        stock_market_max_points = max(1, stock_market_max_points)
        sb_cap_doc = await db.game_settings.find_one({"key": "sports_bet_max_total_open_stake"}, {"_id": 0, "value": 1})
        sports_bet_max_total_open_stake = 25_000_000
        if sb_cap_doc and sb_cap_doc.get("value") is not None:
            try:
                sports_bet_max_total_open_stake = max(1, min(int(sb_cap_doc["value"]), 10**15))
            except (TypeError, ValueError):
                sports_bet_max_total_open_stake = 25_000_000
        banner_doc = await db.game_settings.find_one({"key": "landing_banner_enabled"}, {"_id": 0, "value": 1})
        landing_banner_enabled = bool(banner_doc.get("value") if banner_doc else False)
        msg_doc = await db.game_settings.find_one({"key": "landing_banner_message"}, {"_id": 0, "value": 1})
        landing_banner_message = (msg_doc.get("value") or "") if msg_doc and msg_doc.get("value") is not None else ""
        main_doc = await db.game_settings.find_one({"_id": "main"})
        login_lock_from = main_doc.get("login_lock_from") if main_doc else None
        login_lock_until = main_doc.get("login_lock_until") if main_doc else None
        login_lock_message = main_doc.get("login_lock_message") if main_doc else None
        preregister_landing_banner_enabled = main_doc.get("preregister_landing_banner_enabled")
        if preregister_landing_banner_enabled is None:
            preregister_landing_banner_enabled = True
        preregister_landing_banner_preview_open = bool(main_doc.get("preregister_landing_banner_preview_open")) if main_doc else False
        block_proxy_vpn_login = True if not main_doc else bool(main_doc.get("block_proxy_vpn_login", True))
        block_script_user_agent_login = True if not main_doc else bool(main_doc.get("block_script_user_agent_login", True))
        block_script_user_agent_game_actions = True if not main_doc else bool(main_doc.get("block_script_user_agent_game_actions", True))
        game_actions_client_strict = bool(main_doc.get("game_actions_client_strict")) if main_doc else False
        game_actions_turnstile_enabled = bool(main_doc.get("game_actions_turnstile_enabled")) if main_doc else False
        minigame_turnstile_enabled = bool(main_doc.get("minigame_turnstile_enabled")) if main_doc else False
        minigame_turnstile_site_key = (main_doc.get("minigame_turnstile_site_key") or "") if main_doc else ""
        login_turnstile_enabled = bool(main_doc.get("login_turnstile_enabled")) if main_doc else False
        sustained_page_rl_jail_enabled = bool(main_doc.get("sustained_page_rl_jail_enabled")) if main_doc else False
        sustained_page_rl_entertainer_enabled = bool(main_doc.get("sustained_page_rl_entertainer_enabled")) if main_doc else False
        sustained_page_rl_forum_enabled = bool(main_doc.get("sustained_page_rl_forum_enabled")) if main_doc else False
        sustained_page_rl_kill_enabled = (
            _kill_sustain_setting_enabled(main_doc.get("sustained_page_rl_kill_enabled")) if main_doc else True
        )
        sustained_page_rl_kill_max_gap_ms = clamp_kill_rl_max_gap_ms(
            main_doc.get("sustained_page_rl_kill_max_gap_ms") if main_doc else None
        )
        sustained_page_rl_kill_sustain_sec = clamp_kill_rl_sustain_sec(
            main_doc.get("sustained_page_rl_kill_sustain_sec") if main_doc else None
        )
        sustained_page_rl_gta_enabled = bool(main_doc.get("sustained_page_rl_gta_enabled")) if main_doc else False
        sustained_page_rl_crimes_enabled = bool(main_doc.get("sustained_page_rl_crimes_enabled")) if main_doc else False
        sustained_page_rl_oc_enabled = bool(main_doc.get("sustained_page_rl_oc_enabled")) if main_doc else False
        sustained_page_rl_booze_enabled = bool(main_doc.get("sustained_page_rl_booze_enabled")) if main_doc else False
        sustained_page_rl_game_chat_enabled = bool(main_doc.get("sustained_page_rl_game_chat_enabled")) if main_doc else False
        sustained_page_rl_store_enabled = bool(main_doc.get("sustained_page_rl_store_enabled")) if main_doc else False
        sustained_page_rl_ranking_enabled = bool(main_doc.get("sustained_page_rl_ranking_enabled")) if main_doc else False
        sustained_page_rl_notifications_enabled = bool(main_doc.get("sustained_page_rl_notifications_enabled")) if main_doc else False
        sustained_page_rl_hitlist_enabled = bool(main_doc.get("sustained_page_rl_hitlist_enabled")) if main_doc else False
        sustained_page_rl_bank_enabled = bool(main_doc.get("sustained_page_rl_bank_enabled")) if main_doc else False
        sustained_page_rl_leaderboard_enabled = bool(main_doc.get("sustained_page_rl_leaderboard_enabled")) if main_doc else False
        sustained_page_rl_families_enabled = bool(main_doc.get("sustained_page_rl_families_enabled")) if main_doc else False
        sustained_page_rl_stock_market_enabled = bool(main_doc.get("sustained_page_rl_stock_market_enabled")) if main_doc else False
        sustained_page_rl_quicktrade_enabled = bool(main_doc.get("sustained_page_rl_quicktrade_enabled")) if main_doc else False
        sustained_page_rl_properties_enabled = bool(main_doc.get("sustained_page_rl_properties_enabled")) if main_doc else False
        sustained_page_rl_armoury_enabled = bool(main_doc.get("sustained_page_rl_armoury_enabled")) if main_doc else False
        sustained_page_rl_bodyguards_enabled = bool(main_doc.get("sustained_page_rl_bodyguards_enabled")) if main_doc else False
        sustained_page_rl_missions_enabled = bool(main_doc.get("sustained_page_rl_missions_enabled")) if main_doc else False
        sustained_page_rl_travel_enabled = bool(main_doc.get("sustained_page_rl_travel_enabled")) if main_doc else False
        sustained_page_rl_events_enabled = bool(main_doc.get("sustained_page_rl_events_enabled")) if main_doc else False
        spotify_feature_enabled = bool(main_doc.get("spotify_feature_enabled", False)) if main_doc else False
        preorder_points_release_date = main_doc.get("preorder_points_release_date") if main_doc else None
        store_points_auto_credit = main_doc.get("store_points_auto_credit") if main_doc else None
        if store_points_auto_credit is None:
            store_points_auto_credit = True
        store_points_manual_credit_eta = main_doc.get("store_points_manual_credit_eta") if main_doc else None
        casino_global_max_bet = int(main_doc.get("casino_global_max_bet") or 1_000_000_000) if main_doc else 1_000_000_000
        casino_buyback_max_points = int(main_doc.get("casino_buyback_max_points") or 15_000) if main_doc else 15_000
        mp_poker_max_blind = int(main_doc.get("mp_poker_max_blind") or 2_500_000) if main_doc else 2_500_000
        bank_payload = await _bank_economy_admin_payload()
        return {
            "admin_online_color": admin_online_color,
            "mod_default_online_color": mod_default_online_color.strip() if isinstance(mod_default_online_color, str) else MOD_DEFAULT,
            "require_email_verification": require_email_verification,
            "block_proxy_vpn_login": block_proxy_vpn_login,
            "block_script_user_agent_login": block_script_user_agent_login,
            "block_script_user_agent_game_actions": block_script_user_agent_game_actions,
            "game_actions_client_strict": game_actions_client_strict,
            "game_actions_turnstile_enabled": game_actions_turnstile_enabled,
            "minigame_turnstile_enabled": minigame_turnstile_enabled,
            "minigame_turnstile_site_key": (minigame_turnstile_site_key or "").strip(),
            "login_turnstile_enabled": login_turnstile_enabled,
            "sustained_page_rl_jail_enabled": sustained_page_rl_jail_enabled,
            "sustained_page_rl_entertainer_enabled": sustained_page_rl_entertainer_enabled,
            "sustained_page_rl_forum_enabled": sustained_page_rl_forum_enabled,
            "sustained_page_rl_kill_enabled": sustained_page_rl_kill_enabled,
            "sustained_page_rl_kill_max_gap_ms": sustained_page_rl_kill_max_gap_ms,
            "sustained_page_rl_kill_sustain_sec": sustained_page_rl_kill_sustain_sec,
            "sustained_page_rl_gta_enabled": sustained_page_rl_gta_enabled,
            "sustained_page_rl_crimes_enabled": sustained_page_rl_crimes_enabled,
            "sustained_page_rl_oc_enabled": sustained_page_rl_oc_enabled,
            "sustained_page_rl_booze_enabled": sustained_page_rl_booze_enabled,
            "sustained_page_rl_game_chat_enabled": sustained_page_rl_game_chat_enabled,
            "sustained_page_rl_store_enabled": sustained_page_rl_store_enabled,
            "sustained_page_rl_ranking_enabled": sustained_page_rl_ranking_enabled,
            "sustained_page_rl_notifications_enabled": sustained_page_rl_notifications_enabled,
            "sustained_page_rl_hitlist_enabled": sustained_page_rl_hitlist_enabled,
            "sustained_page_rl_bank_enabled": sustained_page_rl_bank_enabled,
            "sustained_page_rl_leaderboard_enabled": sustained_page_rl_leaderboard_enabled,
            "sustained_page_rl_families_enabled": sustained_page_rl_families_enabled,
            "sustained_page_rl_stock_market_enabled": sustained_page_rl_stock_market_enabled,
            "sustained_page_rl_quicktrade_enabled": sustained_page_rl_quicktrade_enabled,
            "sustained_page_rl_properties_enabled": sustained_page_rl_properties_enabled,
            "sustained_page_rl_armoury_enabled": sustained_page_rl_armoury_enabled,
            "sustained_page_rl_bodyguards_enabled": sustained_page_rl_bodyguards_enabled,
            "sustained_page_rl_missions_enabled": sustained_page_rl_missions_enabled,
            "sustained_page_rl_travel_enabled": sustained_page_rl_travel_enabled,
            "sustained_page_rl_events_enabled": sustained_page_rl_events_enabled,
            "spotify_feature_enabled": spotify_feature_enabled,
            "stock_market_max_points": stock_market_max_points,
            "sports_bet_max_total_open_stake": sports_bet_max_total_open_stake,
            "landing_banner_enabled": landing_banner_enabled,
            "landing_banner_message": landing_banner_message,
            "login_lock_from": login_lock_from,
            "login_lock_until": login_lock_until,
            "login_lock_message": login_lock_message,
            "preregister_landing_banner_enabled": bool(preregister_landing_banner_enabled),
            "preregister_landing_banner_preview_open": preregister_landing_banner_preview_open,
            "preorder_points_release_date": preorder_points_release_date,
            "store_points_auto_credit": bool(store_points_auto_credit),
            "store_points_manual_credit_eta": store_points_manual_credit_eta,
            "casino_global_max_bet": casino_global_max_bet,
            "casino_buyback_max_points": casino_buyback_max_points,
            "mp_poker_max_blind": mp_poker_max_blind,
            **bank_payload,
        }

    @router.post("/admin/bank/apply-swiss-default-to-all-users")
    async def admin_apply_swiss_default_to_all_users(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        import server as srv

        fb_sw = int(getattr(srv, "SWISS_BANK_LIMIT_START", 50_000_000) or 50_000_000)
        fb_opts = list(getattr(srv, "BANK_INTEREST_OPTIONS", []) or [])
        cfg = await get_bank_economy_config(
            db,
            swiss_fallback=fb_sw,
            interest_max_fallback=50_000_000,
            interest_options_fallback=fb_opts,
        )
        lim = int(cfg["swiss_limit_start"])
        result = await db.users.update_many({}, {"$set": {"swiss_limit": lim}})
        return {
            "message": f"Set swiss_limit to ${lim:,} on {result.modified_count} user document(s) (matched {result.matched_count}).",
            "swiss_limit": lim,
            "matched_count": result.matched_count,
            "modified_count": result.modified_count,
        }

    _CLAIM_COST_MAX = 10**15

    @router.get("/admin/claim-costs")
    async def admin_get_claim_costs(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return await load_claim_costs(db, ttl_sec=0.0)

    @router.patch("/admin/claim-costs")
    async def admin_patch_claim_costs(body: AdminClaimCostsPatch, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        def _ok(n: int) -> bool:
            return 0 <= n <= _CLAIM_COST_MAX

        doc = await db.game_settings.find_one({"key": CLAIM_COSTS_SETTINGS_KEY}, {"_id": 0, "value": 1})
        raw = (doc or {}).get("value")
        merged = merge_claim_costs(raw if isinstance(raw, dict) else None)
        patch = body.model_dump(exclude_unset=True)
        for key, val in patch.items():
            if val is None:
                continue
            try:
                n = int(val)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Invalid integer for {key}")
            if not _ok(n):
                raise HTTPException(status_code=400, detail=f"{key} must be between 0 and {_CLAIM_COST_MAX:,}")
            merged[key] = n
        await db.game_settings.update_one(
            {"key": CLAIM_COSTS_SETTINGS_KEY},
            {"$set": {"key": CLAIM_COSTS_SETTINGS_KEY, "value": merged}},
            upsert=True,
        )
        invalidate_claim_costs_cache()
        try:
            from routers.admin.airport import _invalidate_airports_list_cache

            _invalidate_airports_list_cache()
        except Exception:
            pass
        return await load_claim_costs(db)

    PAGE_LOCKS_KEY = "page_locks"

    @router.get("/page-locks")
    async def get_page_locks_public():
        """Public: return which paths are locked and their message. Locks with unlock_at in the past are excluded."""
        from datetime import datetime, timezone
        doc = await db.game_settings.find_one({"key": PAGE_LOCKS_KEY}, {"_id": 0, "value": 1})
        raw = (doc.get("value") or {}).get("paths") if doc else {}
        if not isinstance(raw, dict):
            raw = {}
        now = datetime.now(timezone.utc)
        paths = {}
        for p, v in raw.items():
            if isinstance(v, dict):
                uat = v.get("unlock_at")
                if uat:
                    try:
                        until = datetime.fromisoformat(uat.replace("Z", "+00:00"))
                        if until.tzinfo is None:
                            until = until.replace(tzinfo=timezone.utc)
                        if now >= until:
                            continue
                    except Exception:
                        pass
                paths[p] = v.get("message", "Down for maintenance")
            elif isinstance(v, str):
                paths[p] = v
        return {"paths": paths}

    DEFAULT_LANDING_BANNER_MESSAGE = (
        "Beta round end: March 24 6pm. Full game release March 28th 6pm. "
        "This beta lets you try the game and features before launch."
    )

    @router.get("/landing-banner")
    async def get_landing_banner_public():
        """Public: return whether the beta banner is enabled and its message. No auth required."""
        doc = await db.game_settings.find_one({"key": "landing_banner_enabled"}, {"_id": 0, "value": 1})
        enabled = bool(doc.get("value") if doc else False)
        msg_doc = await db.game_settings.find_one({"key": "landing_banner_message"}, {"_id": 0, "value": 1})
        message = (msg_doc.get("value") or "").strip() if msg_doc and msg_doc.get("value") is not None else ""
        if enabled and not message:
            message = DEFAULT_LANDING_BANNER_MESSAGE
        return {"enabled": enabled, "message": message}

    @router.get("/admin/page-locks")
    async def admin_get_page_locks(current_user: dict = Depends(get_current_user)):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        doc = await db.game_settings.find_one({"key": PAGE_LOCKS_KEY}, {"_id": 0, "value": 1})
        raw = (doc.get("value") or {}).get("paths") if doc else {}
        if not isinstance(raw, dict):
            raw = {}
        paths = {}
        for p, v in raw.items():
            if isinstance(v, dict):
                paths[p] = {"message": v.get("message", "Down for maintenance"), "unlock_at": v.get("unlock_at")}
            else:
                paths[p] = {"message": (v or "Down for maintenance") if isinstance(v, str) else "Down for maintenance", "unlock_at": None}
        return {"paths": paths}

    @router.patch("/admin/page-locks")
    async def admin_patch_page_locks(body: PageLockUpdate, current_user: dict = Depends(get_current_user)):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        path = (body.path or "").strip().rstrip("/") or "/"
        if not path.startswith("/"):
            path = "/" + path
        doc = await db.game_settings.find_one({"key": PAGE_LOCKS_KEY}, {"_id": 0, "value": 1})
        value = (doc.get("value") or {}) if doc else {}
        raw = dict(value.get("paths") or {}) if isinstance(value.get("paths"), dict) else {}
        for k, v in list(raw.items()):
            if isinstance(v, str):
                raw[k] = {"message": v, "unlock_at": None}
        if body.locked:
            msg = (body.message or "").strip() or "Down for maintenance"
            uat = (body.unlock_at or "").strip() or None
            raw[path] = {"message": msg, "unlock_at": uat}
        else:
            raw.pop(path, None)
        await db.game_settings.update_one(
            {"key": PAGE_LOCKS_KEY},
            {"$set": {"value": {"paths": raw}}},
            upsert=True,
        )
        paths_out = {p: v.get("message", "Down for maintenance") if isinstance(v, dict) else v for p, v in raw.items()}
        return {"paths": paths_out}

    @router.get("/admin/activity-log")
    async def admin_activity_log(
        limit: int = 100,
        username: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        limit = min(max(1, limit), 500)
        query = {}
        if username and username.strip():
            uname_pattern = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE)
            query["username"] = uname_pattern
        cursor = db.activity_log.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
        entries = await cursor.to_list(limit)
        return {"entries": entries, "count": len(entries)}

    @router.post("/admin/toast-events/ingest")
    async def admin_ingest_toast_event(
        body: ToastEventIngestRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Ingest frontend toast notifications shown to authenticated users."""
        user_id = str(current_user.get("id") or "").strip()
        username = str(current_user.get("username") or "").strip()
        if not user_id or not username:
            raise HTTPException(status_code=400, detail="User context unavailable")

        toast_type = str(body.toast_type or "default").strip().lower()[:32] or "default"
        if toast_type not in {"default", "success", "error", "info", "warning", "loading", "message"}:
            toast_type = "default"
        message = str(body.message or "").strip()[:500]
        description = (str(body.description).strip()[:1000] if body.description is not None else None) or None
        route_path = (str(body.route_path).strip()[:500] if body.route_path is not None else None) or None
        duration_ms = int(body.duration_ms) if body.duration_ms is not None else None
        client_created_at = (str(body.client_created_at).strip()[:64] if body.client_created_at is not None else None) or None
        metadata = body.metadata if isinstance(body.metadata, dict) else None
        if metadata is not None:
            safe_meta = {}
            for k, v in metadata.items():
                ks = str(k)[:80]
                if not ks:
                    continue
                if isinstance(v, (str, int, float, bool)) or v is None:
                    safe_meta[ks] = v if not isinstance(v, str) else v[:300]
                else:
                    safe_meta[ks] = str(v)[:300]
            metadata = safe_meta or None

        await db.toast_events.insert_one(
            {
                "id": uuid.uuid4().hex,
                "user_id": user_id,
                "username": username,
                "toast_type": toast_type,
                "message": message,
                "description": description,
                "route_path": route_path,
                "duration_ms": duration_ms,
                "client_created_at": client_created_at,
                "metadata": metadata,
                "created_at": datetime.now(timezone.utc),
            }
        )
        return {"ok": True}

    @router.get("/admin/toast-events")
    async def admin_toast_events(
        limit: int = Query(200, ge=1, le=1000),
        username: Optional[str] = None,
        toast_type: Optional[str] = None,
        contains: Optional[str] = None,
        since: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        query: Dict[str, Any] = {}
        uname = (username or "").strip()
        if uname:
            query["username"] = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)

        tt = (toast_type or "").strip().lower()
        if tt:
            query["toast_type"] = tt

        needle = (contains or "").strip()
        if needle:
            pat = re.compile(re.escape(needle), re.IGNORECASE)
            query["$or"] = [{"message": pat}, {"description": pat}, {"route_path": pat}]

        since_raw = (since or "").strip()
        if since_raw:
            try:
                since_dt = datetime.fromisoformat(since_raw.replace("Z", "+00:00"))
                if since_dt.tzinfo is None:
                    since_dt = since_dt.replace(tzinfo=timezone.utc)
                query["created_at"] = {"$gte": since_dt}
            except Exception:
                pass

        rows = (
            await db.toast_events.find(query, {"_id": 0})
            .sort("created_at", -1)
            .limit(int(limit))
            .to_list(int(limit))
        )
        for r in rows:
            if isinstance(r.get("created_at"), datetime):
                r["created_at"] = r["created_at"].isoformat()
            if isinstance(r.get("client_created_at"), datetime):
                r["client_created_at"] = r["client_created_at"].isoformat()
        return {"entries": rows, "count": len(rows)}

    @router.get("/admin/activity-feed")
    async def admin_activity_feed(
        limit: int = Query(200, ge=1, le=500),
        action: Optional[str] = None,
        username: Optional[str] = None,
        username_mode: str = Query("exact", pattern="^(exact|contains)$"),
        sources: Optional[str] = None,
        min_amount: Optional[int] = Query(None, ge=0),
        since_minutes: int = Query(60, ge=1, le=1440),
        exclude_auto_rank: bool = Query(True),
        current_user: dict = Depends(get_current_user),
    ):
        """Combined admin feed across recent activity sources with filters and normalized rows."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since_dt = now - timedelta(minutes=int(since_minutes))
        since_iso = since_dt.isoformat()
        limit = min(max(1, limit), 500)

        selected_sources = {s.strip().lower() for s in (sources or "").split(",") if s.strip()}
        if not selected_sources:
            selected_sources = {"activity", "gambling", "minigame"}
        allowed_sources = {"activity", "gambling", "minigame"}
        selected_sources = {s for s in selected_sources if s in allowed_sources}
        if not selected_sources:
            selected_sources = {"activity", "gambling", "minigame"}

        source_limit = min(1000, max(limit * 4, 200))

        def _ts_filter(field: str = "created_at") -> dict:
            # Support both datetime and legacy ISO-string timestamps.
            return {
                "$or": [
                    {field: {"$gte": since_dt}},
                    {field: {"$type": "string", "$gte": since_iso}},
                ]
            }

        def _to_dt(v):
            if isinstance(v, datetime):
                return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
            if isinstance(v, str):
                try:
                    return datetime.fromisoformat(v.replace("Z", "+00:00"))
                except Exception:
                    return None
            return None

        def _to_iso(v) -> str:
            dt = _to_dt(v)
            return dt.isoformat() if dt else (str(v) if v is not None else "")

        uname = (username or "").strip()
        action_filter = (action or "").strip().lower()
        username_contains = username_mode == "contains"
        min_amt = int(min_amount or 0)

        def _activity_row_is_auto_rank(action_raw: Any, details_raw: Any) -> bool:
            d = details_raw if isinstance(details_raw, dict) else {}
            if d.get("via_auto_rank") is True:
                return True
            a = str(action_raw or "").strip().lower()
            if a in ("garage_melt", "garage_scrap") and d.get("source") == "auto_rank_or_internal":
                return True
            return False

        async def _read_activity_rows():
            parts: List[dict] = [_ts_filter("created_at")]
            if uname:
                if username_contains:
                    pat = re.compile(re.escape(uname), re.IGNORECASE)
                else:
                    pat = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)
                parts.append({
                    "$or": [
                        {"username": pat},
                        {"details.seller_username": pat},
                        {"details.buyer_username": pat},
                    ]
                })
            if action_filter:
                parts.append({"action": re.compile(re.escape(action_filter), re.IGNORECASE)})
            query: dict = parts[0] if len(parts) == 1 else {"$and": parts}
            return await db.activity_log.find(query, {"_id": 0}).sort("created_at", -1).limit(source_limit).to_list(source_limit)

        async def _read_gambling_rows():
            query: dict = _ts_filter("created_at")
            if uname:
                if username_contains:
                    query["username"] = re.compile(re.escape(uname), re.IGNORECASE)
                else:
                    query["username"] = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)
            if action_filter:
                query["game_type"] = re.compile(re.escape(action_filter), re.IGNORECASE)
            return await db.gambling_log.find(query, {"_id": 0}).sort("created_at", -1).limit(source_limit).to_list(source_limit)

        async def _read_minigame_rows():
            query: dict = _ts_filter("created_at")
            if uname:
                if username_contains:
                    query["username"] = re.compile(re.escape(uname), re.IGNORECASE)
                else:
                    query["username"] = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)
            if action_filter:
                query["game"] = re.compile(re.escape(action_filter), re.IGNORECASE)
            return await db.minigame_play_payouts.find(query, {"_id": 0}).sort("created_at", -1).limit(source_limit).to_list(source_limit)

        merged = []
        if "activity" in selected_sources:
            for row in await _read_activity_rows():
                created_dt = _to_dt(row.get("created_at"))
                if created_dt is None or created_dt < since_dt:
                    continue
                details = row.get("details") or {}
                if exclude_auto_rank and _activity_row_is_auto_rank(row.get("action"), details):
                    continue
                amount = int(details.get("amount") or 0)
                act_lc = str(row.get("action") or "").lower()
                if amount == 0 and act_lc.startswith("quicktrade_"):
                    amount = max(
                        int(details.get("audit_cash") or details.get("cost_paid") or details.get("cash_received") or details.get("offer") or 0),
                        int(details.get("points_received") or details.get("points_sold") or details.get("points") or 0),
                    )
                category = "bank_transfer" if (
                    "bank" in str(row.get("action") or "").lower()
                    or "transfer" in str(row.get("action") or "").lower()
                    or details.get("recipient") is not None
                ) else "action"
                merged.append({
                    "source": "activity",
                    "category": category,
                    "user_id": row.get("user_id"),
                    "username": row.get("username"),
                    "action": row.get("action"),
                    "details": details,
                    "amount": amount,
                    "created_at": _to_iso(row.get("created_at")),
                })

        if "gambling" in selected_sources:
            for row in await _read_gambling_rows():
                created_dt = _to_dt(row.get("created_at"))
                if created_dt is None or created_dt < since_dt:
                    continue
                details = row.get("details") or {}
                # Standard games use stake/bet + payout; MP blackjack/poker use buy_in + winnings.
                stake = int(details.get("stake") or details.get("bet") or details.get("buy_in") or 0)
                payout = int(details.get("payout") or details.get("winnings") or 0)
                merged.append({
                    "source": "gambling",
                    "category": "casino",
                    "user_id": row.get("user_id"),
                    "username": row.get("username"),
                    "action": row.get("game_type"),
                    "details": {
                        "stake": stake,
                        "payout": payout,
                        "win": details.get("win"),
                        **{k: v for k, v in details.items() if k not in ("stake", "bet", "payout", "win", "buy_in", "winnings")},
                    },
                    "amount": max(stake, payout),
                    "created_at": _to_iso(row.get("created_at")),
                })

        if "minigame" in selected_sources:
            for row in await _read_minigame_rows():
                created_dt = _to_dt(row.get("created_at"))
                if created_dt is None or created_dt < since_dt:
                    continue
                details = {
                    "game": row.get("game"),
                    "score": int(row.get("score") or 0),
                    "cash": int(row.get("cash") or 0),
                    "respect": int(row.get("respect") or 0),
                    "points": int(row.get("points") or 0),
                }
                merged.append({
                    "source": "minigame",
                    "category": "minigame",
                    "user_id": row.get("user_id"),
                    "username": row.get("username"),
                    "action": f"minigame_{row.get('game') or 'play'}",
                    "details": details,
                    "amount": max(int(row.get("cash") or 0), int(row.get("points") or 0)),
                    "created_at": _to_iso(row.get("created_at")),
                })

        if min_amt > 0:
            merged = [e for e in merged if int(e.get("amount") or 0) >= min_amt]

        merged.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        merged = merged[:limit]

        counts_by_source: Dict[str, int] = {"activity": 0, "gambling": 0, "minigame": 0}
        for e in merged:
            src = str(e.get("source") or "")
            if src in counts_by_source:
                counts_by_source[src] += 1

        return {
            "entries": merged,
            "count": len(merged),
            "counts_by_source": counts_by_source,
            "since_minutes": since_minutes,
            "window_start": since_iso,
            "window_end": now.isoformat(),
            "applied_filters": {
                "username": uname,
                "username_mode": username_mode,
                "action": action_filter,
                "sources": sorted(selected_sources),
                "min_amount": min_amt if min_amount is not None else None,
                "exclude_auto_rank": exclude_auto_rank,
            },
        }

    @router.get("/admin/gambling-log")
    async def admin_gambling_log(
        limit: int = 100,
        username: Optional[str] = None,
        game_type: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        limit = min(max(1, limit), 500)
        query = {}
        if username and username.strip():
            uname_pattern = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE)
            query["username"] = uname_pattern
        if game_type and game_type.strip():
            query["game_type"] = game_type.strip().lower()
        cursor = db.gambling_log.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
        entries = await cursor.to_list(limit)
        return {"entries": entries, "count": len(entries)}

    @router.get("/admin/casinos/keno-economy")
    async def admin_casinos_keno_economy(
        days: int = Query(30, ge=1, le=366),
        current_user: dict = Depends(get_current_user),
    ):
        """Aggregate state-owned Keno plays from gambling_log: stakes, payouts, house net, by state."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        match: Dict[str, Any] = {"game_type": "keno", "created_at": {"$gte": cutoff}}
        bet_expr: Dict[str, Any] = {"$convert": {"input": "$details.bet", "to": "double", "onError": 0.0, "onNull": 0.0}}
        payout_expr: Dict[str, Any] = {"$convert": {"input": "$details.payout", "to": "double", "onError": 0.0, "onNull": 0.0}}
        pipeline: List[Dict[str, Any]] = [
            {"$match": match},
            {
                "$facet": {
                    "totals": [
                        {
                            "$group": {
                                "_id": None,
                                "rounds": {"$sum": 1},
                                "total_stake": {"$sum": bet_expr},
                                "total_payout": {"$sum": payout_expr},
                                "win_rounds": {"$sum": {"$cond": [{"$gt": [payout_expr, 0.0]}, 1, 0]}},
                                "max_payout": {"$max": payout_expr},
                                "users": {"$addToSet": "$user_id"},
                            }
                        },
                        {
                            "$project": {
                                "_id": 0,
                                "rounds": 1,
                                "total_stake": 1,
                                "total_payout": 1,
                                "win_rounds": 1,
                                "max_payout": 1,
                                "unique_users": {"$size": "$users"},
                            }
                        },
                    ],
                    "by_state": [
                        {
                            "$group": {
                                "_id": {"$ifNull": ["$details.state", ""]},
                                "rounds": {"$sum": 1},
                                "total_stake": {"$sum": bet_expr},
                                "total_payout": {"$sum": payout_expr},
                            }
                        },
                        {"$sort": {"total_stake": -1}},
                    ],
                    "recent": [
                        {"$sort": {"created_at": -1}},
                        {"$limit": 30},
                        {
                            "$project": {
                                "_id": 0,
                                "id": 1,
                                "username": 1,
                                "user_id": 1,
                                "created_at": 1,
                                "details.bet": 1,
                                "details.payout": 1,
                                "details.hits": 1,
                                "details.picks": 1,
                                "details.state": 1,
                            }
                        },
                    ],
                    "top_wins": [
                        {"$match": match},
                        {"$addFields": {"_payout": payout_expr, "_bet": bet_expr}},
                        {"$match": {"_payout": {"$gt": 0}}},
                        {"$sort": {"_payout": -1}},
                        {"$limit": 10},
                        {
                            "$project": {
                                "_id": 0,
                                "username": 1,
                                "user_id": 1,
                                "payout": "$_payout",
                                "bet": "$_bet",
                                "created_at": 1,
                                "state": "$details.state",
                                "hits": "$details.hits",
                                "pick_count": {"$size": {"$ifNull": ["$details.picks", []]}},
                            }
                        },
                    ],
                }
            },
        ]
        agg = await db.gambling_log.aggregate(pipeline).to_list(1)
        facet = (agg[0] if agg else {}) or {}
        totals_list = facet.get("totals") or []
        totals_row = totals_list[0] if totals_list else {}
        rounds = int(totals_row.get("rounds") or 0)
        total_stake = float(totals_row.get("total_stake") or 0)
        total_payout = float(totals_row.get("total_payout") or 0)
        win_rounds = int(totals_row.get("win_rounds") or 0)
        max_payout = float(totals_row.get("max_payout") or 0)
        unique_users = int(totals_row.get("unique_users") or 0)
        house_net = total_stake - total_payout
        avg_bet = (total_stake / rounds) if rounds else 0.0
        rtp_pct = (100.0 * total_payout / total_stake) if total_stake > 0 else None

        by_state_raw = facet.get("by_state") or []
        by_state: List[Dict[str, Any]] = []
        for row in by_state_raw:
            st = str(row.get("_id") or "").strip() or "(unknown)"
            rs = int(row.get("rounds") or 0)
            ts = float(row.get("total_stake") or 0)
            tp = float(row.get("total_payout") or 0)
            by_state.append(
                {
                    "state": st,
                    "rounds": rs,
                    "total_stake": ts,
                    "total_payout": tp,
                    "house_net": ts - tp,
                }
            )

        def _iso(dt: Any) -> Optional[str]:
            if dt is None:
                return None
            if isinstance(dt, datetime):
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.isoformat().replace("+00:00", "Z")
            return str(dt)

        recent_out: List[Dict[str, Any]] = []
        for r in facet.get("recent") or []:
            det = r.get("details") or {}
            recent_out.append(
                {
                    "id": r.get("id"),
                    "username": r.get("username"),
                    "user_id": r.get("user_id"),
                    "created_at": _iso(r.get("created_at")),
                    "bet": float(det.get("bet") or 0),
                    "payout": float(det.get("payout") or 0),
                    "hits": int(det.get("hits") or 0),
                    "pick_count": len(det.get("picks") or []) if isinstance(det.get("picks"), list) else None,
                    "state": det.get("state"),
                }
            )

        top_wins_out: List[Dict[str, Any]] = []
        for r in facet.get("top_wins") or []:
            top_wins_out.append(
                {
                    "username": r.get("username"),
                    "user_id": r.get("user_id"),
                    "created_at": _iso(r.get("created_at")),
                    "bet": float(r.get("bet") or 0),
                    "payout": float(r.get("payout") or 0),
                    "hits": int(r.get("hits") or 0),
                    "pick_count": int(r.get("pick_count") or 0),
                    "state": r.get("state"),
                }
            )

        return {
            "days": days,
            "cutoff_iso": cutoff.isoformat().replace("+00:00", "Z"),
            "summary": {
                "rounds": rounds,
                "unique_players": unique_users,
                "total_stake": total_stake,
                "total_payout": total_payout,
                "house_net": house_net,
                "win_rounds": win_rounds,
                "lose_rounds": max(0, rounds - win_rounds),
                "max_single_payout": max_payout,
                "avg_bet": avg_bet,
                "rtp_percent": round(rtp_pct, 4) if rtp_pct is not None else None,
            },
            "by_state": by_state,
            "recent": recent_out,
            "top_wins": top_wins_out,
        }

    @router.get("/admin/casinos/keno-economy/user")
    async def admin_casinos_keno_economy_user(
        username: str = Query(..., min_length=1, max_length=80, description="Exact username (case-insensitive)"),
        days: int = Query(30, ge=1, le=366),
        limit: int = Query(200, ge=1, le=500),
        current_user: dict = Depends(get_current_user),
    ):
        """Per-user Keno rounds and totals from gambling_log in the window (exact username match)."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        uname = (username or "").strip()
        if not uname:
            raise HTTPException(status_code=400, detail="username required")
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        uname_pattern = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)
        user_match: Dict[str, Any] = {
            "game_type": "keno",
            "created_at": {"$gte": cutoff},
            "username": uname_pattern,
        }
        bet_expr: Dict[str, Any] = {"$convert": {"input": "$details.bet", "to": "double", "onError": 0.0, "onNull": 0.0}}
        payout_expr: Dict[str, Any] = {"$convert": {"input": "$details.payout", "to": "double", "onError": 0.0, "onNull": 0.0}}
        pipeline: List[Dict[str, Any]] = [
            {"$match": user_match},
            {
                "$facet": {
                    "summary": [
                        {
                            "$group": {
                                "_id": None,
                                "rounds": {"$sum": 1},
                                "total_stake": {"$sum": bet_expr},
                                "total_payout": {"$sum": payout_expr},
                                "win_rounds": {"$sum": {"$cond": [{"$gt": [payout_expr, 0.0]}, 1, 0]}},
                                "max_payout": {"$max": payout_expr},
                            }
                        },
                        {
                            "$project": {
                                "_id": 0,
                                "rounds": 1,
                                "total_stake": 1,
                                "total_payout": 1,
                                "win_rounds": 1,
                                "lose_rounds": {"$subtract": ["$rounds", "$win_rounds"]},
                                "max_payout": 1,
                                "avg_bet": {
                                    "$cond": [
                                        {"$gt": ["$rounds", 0]},
                                        {"$divide": ["$total_stake", "$rounds"]},
                                        0.0,
                                    ]
                                },
                            }
                        },
                    ],
                    "rounds": [
                        {"$sort": {"created_at": -1}},
                        {"$limit": limit},
                        {
                            "$project": {
                                "_id": 0,
                                "id": 1,
                                "username": 1,
                                "user_id": 1,
                                "created_at": 1,
                                "details.bet": 1,
                                "details.payout": 1,
                                "details.hits": 1,
                                "details.picks": 1,
                                "details.state": 1,
                            }
                        },
                    ],
                }
            },
        ]
        agg = await db.gambling_log.aggregate(pipeline).to_list(1)
        facet = (agg[0] if agg else {}) or {}
        totals_list = facet.get("summary") or []
        totals_row = totals_list[0] if totals_list else {}
        rounds_n = int(totals_row.get("rounds") or 0)
        total_stake = float(totals_row.get("total_stake") or 0)
        total_payout = float(totals_row.get("total_payout") or 0)
        win_rounds = int(totals_row.get("win_rounds") or 0)
        lose_rounds = int(totals_row.get("lose_rounds") or max(0, rounds_n - win_rounds))
        max_payout = float(totals_row.get("max_payout") or 0)
        avg_bet = float(totals_row.get("avg_bet") or 0)
        player_net = total_payout - total_stake
        rtp_pct = (100.0 * total_payout / total_stake) if total_stake > 0 else None

        def _iso(dt: Any) -> Optional[str]:
            if dt is None:
                return None
            if isinstance(dt, datetime):
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.isoformat().replace("+00:00", "Z")
            return str(dt)

        rounds_out: List[Dict[str, Any]] = []
        for r in facet.get("rounds") or []:
            det = r.get("details") or {}
            rounds_out.append(
                {
                    "id": r.get("id"),
                    "username": r.get("username"),
                    "user_id": r.get("user_id"),
                    "created_at": _iso(r.get("created_at")),
                    "bet": float(det.get("bet") or 0),
                    "payout": float(det.get("payout") or 0),
                    "hits": int(det.get("hits") or 0),
                    "pick_count": len(det.get("picks") or []) if isinstance(det.get("picks"), list) else None,
                    "state": det.get("state"),
                    "win": float(det.get("payout") or 0) > 0,
                }
            )

        return {
            "username": uname,
            "days": days,
            "limit": limit,
            "cutoff_iso": cutoff.isoformat().replace("+00:00", "Z"),
            "summary": {
                "rounds": rounds_n,
                "total_stake": total_stake,
                "total_payout": total_payout,
                "win_rounds": win_rounds,
                "lose_rounds": lose_rounds,
                "max_payout": max_payout,
                "avg_bet": avg_bet,
                "player_net": player_net,
                "rtp_percent": round(rtp_pct, 4) if rtp_pct is not None else None,
            },
            "rounds": rounds_out,
        }

    @router.get("/admin/casinos/keno-settings")
    async def admin_casinos_keno_settings_get(current_user: dict = Depends(get_current_user)):
        """Current Keno max bet (live); falls back to code default if unset."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        max_bet = await load_keno_max_bet(db, ttl_sec=0.0)
        return {"max_bet": max_bet, "default_max_bet": DEFAULT_KENO_MAX_BET}

    @router.patch("/admin/casinos/keno-settings")
    async def admin_casinos_keno_settings_patch(
        body: AdminKenoSettingsPatch,
        current_user: dict = Depends(get_current_user),
    ):
        """Set live Keno max bet (game_settings). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        n = int(body.max_bet)
        if n < 1 or n > 10**15:
            raise HTTPException(status_code=400, detail="max_bet must be between 1 and 1e15 inclusive")
        await db.game_settings.update_one(
            {"key": KENO_MAX_BET_SETTINGS_KEY},
            {"$set": {"key": KENO_MAX_BET_SETTINGS_KEY, "value": n}},
            upsert=True,
        )
        invalidate_keno_max_bet_cache()
        return {"max_bet": await load_keno_max_bet(db, ttl_sec=0.0), "default_max_bet": DEFAULT_KENO_MAX_BET}

    @router.get("/admin/mdg/games-log")
    async def admin_mdg_games_log(
        limit: int = Query(50, ge=1, le=300),
        skip: int = Query(0, ge=0, le=100_000),
        status: Optional[str] = Query(None, description="Filter: open | completed"),
        automated: Optional[bool] = Query(None, description="True = house auto games only; False = player-created only"),
        username: Optional[str] = Query(None, description="Creator, winner, or any entrant username (exact, case-insensitive)"),
        game_id: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        """MDG (pot game) rows from mdg_games: entrants, winner, roll, pots; plus mdg_house_stats summary."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        clauses: List[Dict[str, Any]] = []
        gid = (game_id or "").strip()
        if gid:
            clauses.append({"id": gid})
        else:
            st = (status or "").strip().lower()
            if st in ("open", "completed"):
                clauses.append({"status": st})
            if automated is True:
                clauses.append({"is_automated": True})
            elif automated is False:
                clauses.append({"$or": [{"is_automated": {"$exists": False}}, {"is_automated": False}]})
            uname = (username or "").strip()
            if uname:
                pat = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)
                clauses.append(
                    {
                        "$or": [
                            {"created_by_username": pat},
                            {"winner_username": pat},
                            {"entries": {"$elemMatch": {"username": pat}}},
                        ]
                    }
                )

        query: Dict[str, Any] = {"$and": clauses} if len(clauses) > 1 else (clauses[0] if clauses else {})

        lim = min(max(1, int(limit)), 300)
        sk = min(max(0, int(skip)), 100_000)
        total = await db.mdg_games.count_documents(query)
        raw = await db.mdg_games.find(query, {"_id": 0}).sort("created_at", -1).skip(sk).limit(lim).to_list(lim)

        def _enrich(g: Dict[str, Any]) -> Dict[str, Any]:
            entries = list(g.get("entries") or [])
            wid = g.get("winner_id")
            st = str(g.get("status") or "")
            house_won = wid == "__house__"
            loser_count = 0
            outcome = "open"
            if st == "completed":
                if house_won:
                    outcome = "house_win"
                    loser_count = len(entries)
                elif wid:
                    outcome = "player_win"
                    loser_count = len([e for e in entries if e.get("user_id") != wid])
                else:
                    outcome = "closed"
            return {
                **g,
                "entry_count": len(entries),
                "loser_count": loser_count,
                "outcome": outcome,
                "house_won": bool(house_won) if st == "completed" else None,
            }

        games = [_enrich(dict(g)) for g in raw]
        stats = await db.mdg_house_stats.find_one({"id": "global"}, {"_id": 0})
        return {
            "games": games,
            "total": total,
            "skip": sk,
            "limit": lim,
            "house_stats": stats,
        }

    @router.get("/admin/casino-seizures")
    async def admin_casino_seizures(
        limit: int = Query(100, ge=1, le=500),
        game_type: Optional[str] = None,
        username: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        """Gambling rows where ownership transferred to the winner (insufficient owner bankroll). Winner is log user_id/username."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cap = min(max(1, int(limit)), 500)
        query: Dict[str, Any] = {"details.ownership_transferred": True}
        if game_type and game_type.strip():
            query["game_type"] = game_type.strip().lower()
        if username and username.strip():
            query["username"] = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE)
        cursor = db.gambling_log.find(query, {"_id": 0}).sort("created_at", -1).limit(cap)
        raw = await cursor.to_list(cap)

        def _i(v: Any) -> Optional[int]:
            if v is None:
                return None
            try:
                return int(v)
            except (TypeError, ValueError):
                return None

        def _ca_iso(v: Any) -> Optional[str]:
            if v is None:
                return None
            if hasattr(v, "isoformat"):
                return v.isoformat()
            return str(v)

        out: List[Dict[str, Any]] = []
        for row in raw:
            d = row.get("details") or {}
            gt = (row.get("game_type") or "") or ""
            gt_l = gt.lower()
            loc = (str(d.get("city") or d.get("state") or "").strip() or "—")
            ap = _i(d.get("actual_payout"))
            sh = _i(d.get("shortfall"))
            full = _i(d.get("total_payout"))
            if full is None:
                full = _i(d.get("payout"))
            if gt_l == "blackjack" and ap is not None and sh is not None:
                full = ap + sh
            if sh is None and full is not None and ap is not None:
                sh = max(0, full - ap)
            if ap is None and full is not None:
                ap = full if sh is None else max(0, full - sh)
            bb = _i(d.get("buy_back_points_offered")) or 0
            out.append(
                {
                    "id": row.get("id"),
                    "created_at": _ca_iso(row.get("created_at")),
                    "winner_user_id": row.get("user_id"),
                    "winner_username": row.get("username"),
                    "game_type": gt,
                    "location": loc,
                    "full_payout": full,
                    "actual_payout": ap,
                    "shortfall": sh,
                    "buy_back_points_offered": bb,
                    "buy_back_outcome": d.get("buy_back_outcome"),
                }
            )
        return {"entries": out, "count": len(out)}

    @router.get("/admin/casino-buyback-history")
    async def admin_casino_buyback_history(
        username: str = Query(..., min_length=1, max_length=80),
        limit: int = Query(200, ge=1, le=500),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator: point ledger rows for casino buy-back (escrow hold/release/refund, seizure-offer credit)
        plus any pending buy-back offers involving this user (as former owner or acquirer).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1, "points": 1})
        if not user:
            user = await db.users.find_one(
                {"username": re.compile("^" + re.escape(key) + "$", re.IGNORECASE)},
                {"_id": 0, "id": 1, "username": 1, "points": 1},
            )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = str(user["id"])
        cap = min(max(1, int(limit)), 500)
        ledger_q: Dict[str, Any] = {
            "user_id": uid,
            "$or": [
                {"origin_ref": {"$in": ["buyback_hold", "buyback_release", "buyback_refund"]}},
                {"origin_ref": {"$regex": r"^buyback:"}},
                {"meta.action": {"$in": ["buyback_hold", "buyback_release", "buyback_refund", "buyback_credit"]}},
            ],
        }
        raw_rows = await (
            db.point_ledger_events.find(ledger_q, {"_id": 0}).sort("created_at", -1).limit(cap).to_list(cap)
        )

        def _summarize(ev: Dict[str, Any]) -> str:
            m = ev.get("meta") if isinstance(ev.get("meta"), dict) else {}
            act = str((m or {}).get("action") or "").strip()
            et = str(ev.get("event_type") or "").strip().replace("casino_", "").replace("_", " ")
            loc = str((m or {}).get("city") or (m or {}).get("state") or "—")
            pts = int(ev.get("points") or 0)
            if act == "buyback_hold":
                return f"Raised buy-back escrow ({et} @ {loc}). Wallet Δ {pts:,} pts; escrow held {m.get('from_held', '—')} → {m.get('to_held', '—')}."
            if act == "buyback_release":
                return f"Lowered/removed buy-back escrow ({et} @ {loc}). Wallet +{pts:,} pts; escrow held {m.get('from_held', '—')} → {m.get('to_held', '—')}."
            if act == "buyback_refund":
                rsn = str((m or {}).get("reason") or "").strip() or "refund"
                return f"Buy-back refund ({et} @ {loc}). Wallet +{pts:,} pts ({rsn})."
            if act == "buyback_credit":
                return f"Buy-back offer accepted — points credited ({et} @ {loc}). Wallet +{pts:,} pts."
            return str(act or ev.get("origin_ref") or "buy-back")

        ledger_out: List[Dict[str, Any]] = []
        for r in raw_rows:
            m = r.get("meta") if isinstance(r.get("meta"), dict) else {}
            ledger_out.append(
                {
                    "id": r.get("id"),
                    "created_at": r.get("created_at"),
                    "event_type": r.get("event_type"),
                    "origin_ref": r.get("origin_ref"),
                    "points_delta": r.get("points"),
                    "summary": _summarize(r),
                    "wallet_balance_before": m.get("wallet_balance_before"),
                    "wallet_balance_after": m.get("wallet_balance_after"),
                    "from_held": m.get("from_held"),
                    "to_held": m.get("to_held"),
                    "city": m.get("city"),
                    "state": m.get("state"),
                    "offer_id": m.get("offer_id"),
                    "reason": m.get("reason"),
                }
            )

        offer_specs = [
            ("dice", "dice_buy_back_offers"),
            ("roulette", "roulette_buy_back_offers"),
            ("blackjack", "blackjack_buy_back_offers"),
            ("horseracing", "horseracing_buy_back_offers"),
            ("videopoker", "videopoker_buy_back_offers"),
            ("slots", "slots_buy_back_offers"),
        ]
        pending: List[Dict[str, Any]] = []
        for game, coll in offer_specs:
            try:
                offers = await db[coll].find(
                    {"$or": [{"from_owner_id": uid}, {"to_user_id": uid}]},
                    {"_id": 0},
                ).limit(50).to_list(50)
            except Exception:
                offers = []
            for o in offers or []:
                pending.append(
                    {
                        "game": game,
                        "offer_id": o.get("id"),
                        "from_owner_id": o.get("from_owner_id"),
                        "from_owner_username": o.get("from_owner_username"),
                        "to_user_id": o.get("to_user_id"),
                        "to_username": o.get("to_username"),
                        "points_offered": int(o.get("points_offered") or 0),
                        "amount_shortfall": o.get("amount_shortfall"),
                        "owner_paid": o.get("owner_paid"),
                        "city": o.get("city"),
                        "state": o.get("state"),
                        "expires_at": o.get("expires_at"),
                    }
                )

        return {
            "user": {
                "id": uid,
                "username": user.get("username"),
                "points_current": int(user.get("points") or 0),
            },
            "ledger": ledger_out,
            "ledger_count": len(ledger_out),
            "pending_buy_back_offers": pending,
        }

    @router.get("/admin/respect-points-log")
    async def admin_respect_points_log(
        user_id: str = Query(..., min_length=1),
        limit: int = Query(200, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """Respect audit from respect_events (earned positives; negative rows = admin removal or store respect spend logged after deploy). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        uid = user_id.strip()
        user = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1, "respect_points": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        cap = min(int(limit), 1000)
        raw = await db.respect_events.find({"user_id": uid}, {"_id": 0}).to_list(8000)

        def _ts(d: dict) -> str:
            v = d.get("at") or d.get("created_at")
            return str(v) if v else ""

        def _amt(d: dict) -> int:
            try:
                return int(d.get("amount") or 0)
            except (TypeError, ValueError):
                return 0

        def _src(d: dict) -> str:
            s = d.get("source")
            if s is not None and str(s).strip():
                return str(s).strip()[:120]
            r = d.get("reason")
            if r is not None and str(r).strip():
                return str(r).strip()[:120]
            return "unknown"

        raw.sort(key=_ts, reverse=True)
        events_slice = raw[:cap]
        total_amount = sum(_amt(e) for e in events_slice)
        by_map: Dict[str, Dict[str, int]] = defaultdict(lambda: {"events": 0, "total_amount": 0})
        for e in events_slice:
            src = _src(e)
            by_map[src]["events"] += 1
            by_map[src]["total_amount"] += _amt(e)
        by_source = sorted(
            ({"source": k, **v} for k, v in by_map.items()),
            key=lambda x: (-x["total_amount"], -x["events"], x["source"]),
        )
        recent = [
            {"at": _ts(e), "amount": _amt(e), "source": _src(e)}
            for e in events_slice
        ]
        return {
            "user_id": uid,
            "username": user.get("username"),
            "current_respect_balance": int(user.get("respect_points") or 0),
            "summary": {
                "events_in_view": len(events_slice),
                "total_amount_in_view": total_amount,
                "unique_sources": len(by_map),
                "total_events_in_db": len(raw),
            },
            "by_source": by_source,
            "events": recent,
        }

    @router.get("/admin/currency-spend-audit/{user_id_or_username}")
    async def admin_currency_spend_audit(
        user_id_or_username: str,
        ledger_limit: int = Query(500, ge=1, le=2000),
        respect_limit: int = Query(500, ge=1, le=2000),
        current_user: dict = Depends(get_current_user),
    ):
        """Points + respect spending audit (ledger outflows, store origin refs, respect deltas). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw_key = (user_id_or_username or "").strip()
        if not raw_key:
            raise HTTPException(status_code=400, detail="User id or username required")
        u = await db.users.find_one({"id": raw_key}, {"_id": 0})
        if not u:
            username_pattern = _username_pattern(raw_key)
            u = await db.users.find_one({"username": username_pattern}, {"_id": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        uid = u["id"]
        cap = int(ledger_limit)
        res_cap = int(respect_limit)

        user_fields = {
            "id": uid,
            "username": u.get("username"),
            "points": int(u.get("points") or 0),
            "respect_points": int(u.get("respect_points") or 0),
            "lifetime_points_spent": int(u.get("lifetime_points_spent") or 0),
            "lifetime_respect_points_spent": int(u.get("lifetime_respect_points_spent") or 0),
            "custom_car_name": u.get("custom_car_name"),
            "premium_rank_bar": bool(u.get("premium_rank_bar")),
            "has_silencer": bool(u.get("has_silencer")),
            "anti_snitch": bool(u.get("anti_snitch")),
            "oc_timer_reduced": bool(u.get("oc_timer_reduced")),
            "crew_oc_timer_reduced": bool(u.get("crew_oc_timer_reduced")),
            "auto_rank_purchased": bool(u.get("auto_rank_purchased")),
            "garage_batch_limit": u.get("garage_batch_limit"),
        }

        neg_match = {"user_id": uid, "points": {"$lt": 0}}
        by_type = await db.point_ledger_events.aggregate(
            [
                {"$match": neg_match},
                {"$group": {"_id": "$event_type", "total": {"$sum": "$points"}, "n": {"$sum": 1}}},
                {"$sort": {"total": 1}},
            ]
        ).to_list(300)

        recent_ledger = await db.point_ledger_events.find(
            neg_match,
            {"_id": 0, "id": 1, "event_type": 1, "points": 1, "origin_ref": 1, "root_purchase_ref": 1, "created_at": 1, "meta": 1},
        ).sort("created_at", -1).limit(cap).to_list(cap)

        store_by_ref = await db.point_ledger_events.aggregate(
            [
                {"$match": {"user_id": uid, "event_type": "spend_store", "points": {"$lt": 0}}},
                {
                    "$group": {
                        "_id": "$origin_ref",
                        "total_points": {"$sum": {"$abs": "$points"}},
                        "n": {"$sum": 1},
                        "last_at": {"$max": "$created_at"},
                    }
                },
                {"$sort": {"last_at": -1}},
                {"$limit": 120},
            ]
        ).to_list(120)

        respect_spent = await db.respect_events.find(
            {"user_id": uid, "amount": {"$lt": 0}},
            {"_id": 0, "amount": 1, "at": 1, "source": 1},
        ).sort("at", -1).limit(res_cap).to_list(res_cap)

        return {
            "user": user_fields,
            "points_spent_by_ledger_event_type": [
                {"event_type": x.get("_id"), "total_points": int(x.get("total") or 0), "events": int(x.get("n") or 0)}
                for x in (by_type or [])
            ],
            "points_ledger_recent": recent_ledger,
            "store_point_spends_by_origin_ref": [
                {
                    "origin_ref": x.get("_id"),
                    "total_points_spent": int(x.get("total_points") or 0),
                    "purchase_count": int(x.get("n") or 0),
                    "last_at": x.get("last_at"),
                }
                for x in (store_by_ref or [])
            ],
            "respect_spent_events": respect_spent,
            "notes": [
                "Negative point_ledger_events are currency leaving the account (store FIFO, transfers, game spends, etc.).",
                "Rows with source store:* in respect_events are logged when a store purchase used respect (from deploy forward). Older respect-only store spend may only appear in lifetime_respect_points_spent.",
                "Custom car: spend_store origin_ref buy-custom-car and sets custom_car_name.",
            ],
        }

    @router.get("/admin/crimes/analytics/summary")
    async def admin_crimes_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        limit: int = Query(100, ge=1, le=500),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Per-crime analytics summary for the last N days.
        Admin or moderator only. Uses compact crime_events documents.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        pipeline = [
            {"$match": {"at": {"$gte": since}}},
            {
                "$group": {
                    "_id": "$crime_id",
                    "crime_name": {"$last": "$crime_name"},
                    "crime_type": {"$last": "$crime_type"},
                    "attempts": {"$sum": 1},
                    "successes": {"$sum": {"$cond": ["$success", 1, 0]}},
                    "total_profit": {"$sum": "$profit"},
                    "last_at": {"$max": "$at"},
                }
            },
            {"$sort": {"attempts": -1}},
            {"$limit": int(limit)},
        ]
        cursor = db.crime_events.aggregate(pipeline)
        docs = await cursor.to_list(int(limit))
        total_attempts = sum(int(d.get("attempts", 0) or 0) for d in docs) or 1
        out = []
        for d in docs:
            attempts = int(d.get("attempts", 0) or 0)
            successes = int(d.get("successes", 0) or 0)
            total_profit = int(d.get("total_profit", 0) or 0)
            success_rate = successes / attempts if attempts > 0 else 0.0
            avg_profit = total_profit / attempts if attempts > 0 else 0.0
            usage_share = attempts / total_attempts if total_attempts > 0 else 0.0
            out.append(
                {
                    "crime_id": d.get("_id"),
                    "crime_name": d.get("crime_name") or d.get("_id"),
                    "crime_type": d.get("crime_type") or "normal",
                    "attempts": attempts,
                    "successes": successes,
                    "success_rate": success_rate,
                    "avg_profit": avg_profit,
                    "total_profit": total_profit,
                    "usage_share": usage_share,
                    "last_at": d.get("last_at"),
                }
            )
        return {"generated_at": now.isoformat(), "days": days, "items": out}

    @router.get("/admin/casinos/analytics/summary")
    async def admin_casinos_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Per-game casino analytics summary for the last N days.
        Admin or moderator only. Uses compact gambling_log documents.
        """
        from routers.game.stats import (
            _gambling_profit_from_details,
            _gambling_analytics_bucket,
            _gambling_stake_payout_for_analytics,
        )

        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()

        cursor = db.gambling_log.find(
            {"created_at": {"$gte": since_iso}},
            {"_id": 0, "game_type": 1, "details": 1},
        )
        stats = {}
        async for row in cursor:
            gt = (row.get("game_type") or "").strip() or "unknown"
            details = row.get("details") or {}
            profit = _gambling_profit_from_details(gt, details)
            stake, payout = _gambling_stake_payout_for_analytics(gt, details)
            bucket = _gambling_analytics_bucket(gt, details)
            s = stats.setdefault(
                bucket,
                {
                    "game_type": bucket,
                    "attempts": 0,
                    "wins": 0,
                    "total_stake": 0,
                    "total_payout": 0,
                    "total_profit": 0,
                },
            )
            s["attempts"] += 1
            s["total_stake"] += stake
            s["total_payout"] += payout
            s["total_profit"] += profit
            if profit > 0:
                s["wins"] += 1

        items = []
        total_attempts = sum(v["attempts"] for v in stats.values()) or 1
        for gt, s in sorted(stats.items(), key=lambda kv: -kv[1]["attempts"]):
            attempts = s["attempts"]
            wins = s["wins"]
            total_profit = s["total_profit"]
            avg_profit = total_profit / attempts if attempts > 0 else 0.0
            win_rate = wins / attempts if attempts > 0 else 0.0
            usage_share = attempts / total_attempts if total_attempts > 0 else 0.0
            house_profit = s["total_stake"] - s["total_payout"]
            items.append(
                {
                    "game_type": gt,
                    "attempts": attempts,
                    "wins": wins,
                    "win_rate": win_rate,
                    "total_stake": s["total_stake"],
                    "total_payout": s["total_payout"],
                    "total_profit": total_profit,
                    "house_profit": house_profit,
                    "avg_profit": avg_profit,
                    "usage_share": usage_share,
                }
            )
        totals = {
            "total_attempts": sum(v["attempts"] for v in stats.values()),
            "total_wins": sum(v["wins"] for v in stats.values()),
            "total_stake": sum(v["total_stake"] for v in stats.values()),
            "total_payout": sum(v["total_payout"] for v in stats.values()),
            "total_profit": sum(v["total_profit"] for v in stats.values()),
            "total_house_profit": sum(v["total_stake"] for v in stats.values()) - sum(v["total_payout"] for v in stats.values()),
            "unique_games": len(stats),
        }
        return {"generated_at": now.isoformat(), "days": days, "items": items, "totals": totals}

    @router.get("/admin/casinos/ownership-profits")
    async def admin_casinos_ownership_profits(
        current_user: dict = Depends(get_current_user),
    ):
        """
        Aggregate per-table profit and lifetime net from all casino ownership collections.

        * **profit** — resettable owner P/L (in-game “reset profit” zeros only this field).
        * **total_earnings** — lifetime net for that table using the same signed deltas as profit
          (player wins reduce it; house wins increase it). It is **not** cleared by reset-profit, so
          a row can show profit **$0** while lifetime net is still a large negative. Dice/Slots mirror
          both fields on each bet; legacy rows may differ until touched by new play.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        collections = {
            "Dice": "dice_ownership",
            "Roulette": "roulette_ownership",
            "Blackjack": "blackjack_ownership",
            "Slots": "slots_ownership",
            "Video Poker": "videopoker_ownership",
            "Horse Racing": "horseracing_ownership",
        }
        items = []
        grand_total_profit = 0
        grand_total_earnings = 0
        errors = []
        for game_name, coll_name in collections.items():
            try:
                coll = db[coll_name]
                docs = await coll.find({}, {"_id": 0, "profit": 1, "total_earnings": 1, "owner_id": 1, "owner_username": 1, "city": 1, "state": 1}).to_list(200)
                for doc in docs:
                    try:
                        profit = int(float(doc.get("profit") or 0))
                        total_earnings = int(float(doc.get("total_earnings") or 0))
                    except (TypeError, ValueError):
                        profit = 0
                        total_earnings = 0
                    owner_id = doc.get("owner_id")
                    owner_username = str(doc.get("owner_username") or "—")
                    city = str(doc.get("city") or doc.get("state") or "—")
                    grand_total_profit += profit
                    grand_total_earnings += total_earnings
                    items.append({
                        "game": game_name,
                        "city": city,
                        "owner_id": owner_id,
                        "owner_username": owner_username,
                        "profit": profit,
                        "total_earnings": total_earnings,
                    })
            except Exception as exc:
                errors.append(f"{game_name}: {exc}")
        items.sort(key=lambda x: -abs(x["profit"]))
        resp = {
            "items": items,
            "grand_total_profit": grand_total_profit,
            "grand_total_earnings": grand_total_earnings,
        }
        if errors:
            resp["errors"] = errors
        return resp

    @router.get("/admin/casinos/gambling-anomalies")
    async def admin_gambling_anomalies(
        days: int = Query(7, ge=1, le=90),
        min_plays: int = Query(20, ge=5, le=500),
        std_threshold: float = Query(3.0, ge=2.0, le=5.0),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Flag users with gambling profit far above expected (>N std dev).
        Uses gambling_log; useful for cheat detection (e.g. manipulated RNG).
        Admin or moderator only.
        """
        from routers.game.stats import _gambling_profit_from_details

        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()

        cursor = db.gambling_log.find(
            {"created_at": {"$gte": since_iso}},
            {"_id": 0, "user_id": 1, "username": 1, "game_type": 1, "details": 1},
        )
        by_user: dict = {}
        async for row in cursor:
            uid = (row.get("user_id") or "").strip()
            if not uid:
                continue
            details = row.get("details") or {}
            profit = _gambling_profit_from_details((row.get("game_type") or "").strip(), details)
            if uid not in by_user:
                by_user[uid] = {"user_id": uid, "username": row.get("username", ""), "plays": 0, "total_profit": 0}
            by_user[uid]["plays"] += 1
            by_user[uid]["total_profit"] += profit

        eligible = [u for u in by_user.values() if u["plays"] >= min_plays]
        if len(eligible) < 3:
            return {"generated_at": now.isoformat(), "days": days, "anomalies": [], "note": "Not enough users with min_plays"}
        profits = [u["total_profit"] for u in eligible]
        mean_p = sum(profits) / len(profits)
        var = sum((p - mean_p) ** 2 for p in profits) / len(profits)
        std_p = (var ** 0.5) if var > 0 else 0
        threshold = mean_p + std_threshold * std_p if std_p > 0 else mean_p
        anomalies = [
            {**u, "z_score": round((u["total_profit"] - mean_p) / std_p, 2) if std_p > 0 else 0}
            for u in eligible
            if u["total_profit"] > threshold
        ]
        anomalies.sort(key=lambda x: -x["total_profit"])
        return {
            "generated_at": now.isoformat(),
            "days": days,
            "min_plays": min_plays,
            "std_threshold": std_threshold,
            "mean_profit": round(mean_p, 2),
            "std_profit": round(std_p, 2),
            "anomalies": anomalies[:50],
        }

    def _trade_events_since_filter(since: datetime, since_iso: str) -> Dict[str, Any]:
        """Quick Trade logs use BSON Date for `at`; match both Date and legacy ISO strings."""
        return {"$or": [{"at": {"$gte": since}}, {"at": {"$gte": since_iso}}]}

    def _quicktrade_event_summary(e: Dict[str, Any]) -> str:
        t = (e.get("type") or "").strip()
        if t == "sell_offer_accepted":
            b, s = e.get("buyer_username") or "?", e.get("seller_username") or "?"
            pts, cash = int(e.get("points") or 0), int(e.get("money") or 0)
            return (
                f"{b} bought {s}'s points for ${cash:,} cash ({pts:,} pts). "
                f"Buyer paid cash and received points; seller received the cash."
            )
        if t == "buy_offer_accepted":
            slr, buy = e.get("seller_username") or "?", e.get("buyer_username") or "?"
            pts, cash = int(e.get("points") or 0), int(e.get("money") or 0)
            return (
                f"{slr} sold {pts:,} pts into {buy}'s buy order for ${cash:,} cash. "
                f"Seller sent points and took the cash; buyer's escrow funded the trade."
            )
        if t == "sell_offer_created":
            u = e.get("username") or "?"
            return f"{u} created sell listing: {int(e.get('points') or 0):,} pts asking ${int(e.get('money') or 0):,}."
        if t == "buy_offer_created":
            u = e.get("username") or "?"
            return f"{u} created buy order (cash held): {int(e.get('points') or 0):,} pts for ${int(e.get('money') or 0):,}."
        if t == "sell_offer_cancelled":
            u = e.get("username") or e.get("user_id") or "?"
            return f"Sell offer cancelled · lister {u}"
        if t == "buy_offer_cancelled":
            u = e.get("username") or e.get("user_id") or "?"
            return f"Buy order cancelled · buyer {u}"
        if t == "token_offer_accepted":
            slr, buy = e.get("seller_username") or "?", e.get("buyer_username") or "?"
            tt = (e.get("token_type") or "?").replace("_", " ")
            q = int(e.get("quantity") or 0)
            cur = (e.get("price_currency") or "points").strip().lower()
            if cur == "money":
                return f"{buy} bought {q}× {tt} from {slr} for ${int(e.get('money') or 0):,} cash."
            return f"{buy} bought {q}× {tt} from {slr} for {int(e.get('points') or 0):,} points."
        if t == "property_purchase":
            b, s = e.get("buyer_username") or "?", e.get("seller_username") or "?"
            nm = e.get("property_name") or "Property"
            pts = int(e.get("points") or 0)
            return f"{b} bought {nm} from {s} for {pts:,} points."
        if t == "token_offer_cancelled":
            return f"Token listing cancelled · seller {e.get('user_id') or '?'}"
        if t == "property_listing_cancelled":
            return f"Property listing cancelled · {e.get('property_name') or '—'}"
        return t or "trade event"

    def _trade_event_ledger_row(raw: Dict[str, Any]) -> Dict[str, Any]:
        e = dict(raw)
        at = e.get("at")
        if hasattr(at, "isoformat"):
            try:
                e["at"] = at.isoformat()
            except Exception:
                e["at"] = str(at)
        e["summary"] = _quicktrade_event_summary(e)
        return e

    @router.get("/admin/trades/analytics/summary")
    async def admin_trades_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        ledger_limit: int = Query(250, ge=0, le=500),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Quicktrade analytics summary for the last N days.
        Admin or moderator only. Uses compact trade_events documents.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()
        tfilter = _trade_events_since_filter(since, since_iso)

        def _trade_at_ts(val: Any) -> float:
            if val is None:
                return 0.0
            if hasattr(val, "timestamp"):
                try:
                    return float(val.timestamp())
                except Exception:
                    return 0.0
            if isinstance(val, str):
                try:
                    return datetime.fromisoformat(val.replace("Z", "+00:00")).timestamp()
                except Exception:
                    return 0.0
            return 0.0

        cursor = db.trade_events.find(tfilter, {"_id": 0})
        stats: Dict[Tuple[str, str], Dict[str, Any]] = {}
        raw_ledger: List[Dict[str, Any]] = []
        async for e in cursor:
            raw_ledger.append(e)
            ev_type = (e.get("type") or "").strip() or "unknown"
            direction = (e.get("direction") or "").strip() or "unknown"
            key = (ev_type, direction)
            s = stats.setdefault(
                key,
                {
                    "event_type": ev_type,
                    "direction": direction,
                    "count": 0,
                    "total_points": 0,
                    "total_money": 0,
                },
            )
            s["count"] += 1
            s["total_points"] += int(e.get("points") or 0)
            s["total_money"] += int(e.get("money") or 0)

        items = []
        total_events = sum(v["count"] for v in stats.values()) or 1
        for (_ev, _dir), s in sorted(stats.items(), key=lambda kv: -kv[1]["count"]):
            count = s["count"]
            usage_share = count / total_events if total_events > 0 else 0.0
            avg_points = s["total_points"] / count if count > 0 else 0.0
            avg_money = s["total_money"] / count if count > 0 else 0.0
            items.append(
                {
                    "event_type": s["event_type"],
                    "direction": s["direction"],
                    "count": count,
                    "total_points": s["total_points"],
                    "total_money": s["total_money"],
                    "avg_points": avg_points,
                    "avg_money": avg_money,
                    "usage_share": usage_share,
                }
            )
        ledger: List[Dict[str, Any]] = []
        if ledger_limit > 0 and raw_ledger:
            raw_ledger.sort(key=lambda r: _trade_at_ts(r.get("at")), reverse=True)
            ledger = [_trade_event_ledger_row(r) for r in raw_ledger[: int(ledger_limit)]]
        return {
            "generated_at": now.isoformat(),
            "days": days,
            "items": items,
            "ledger": ledger,
            "ledger_limit": ledger_limit,
        }

    @router.get("/admin/hitlist-bodyguards/analytics/summary")
    async def admin_hitlist_bodyguards_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Hitlist and bodyguard event analytics for the last N days.
        Admin or moderator only. Uses hitlist_bodyguard_events.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()

        cursor = db.hitlist_bodyguard_events.find(
            {"at": {"$gte": since_iso}},
            {"_id": 0},
        )
        by_type = {}
        async for e in cursor:
            ev_type = (e.get("type") or "").strip() or "unknown"
            s = by_type.setdefault(
                ev_type,
                {"event_type": ev_type, "count": 0, "total_cost_cash": 0, "total_cost_points": 0, "total_hire_cost": 0},
            )
            s["count"] += 1
            s["total_cost_cash"] += int(e.get("cost_cash") or 0)
            s["total_cost_points"] += int(e.get("cost_points") or 0)
            s["total_hire_cost"] += int(e.get("hire_cost") or e.get("cost") or 0)

        items = []
        total_events = sum(v["count"] for v in by_type.values()) or 1
        for ev_type, s in sorted(by_type.items(), key=lambda kv: -kv[1]["count"]):
            count = s["count"]
            usage_share = count / total_events if total_events > 0 else 0.0
            items.append(
                {
                    "event_type": s["event_type"],
                    "count": count,
                    "total_cost_cash": s["total_cost_cash"],
                    "total_cost_points": s["total_cost_points"],
                    "total_hire_cost": s["total_hire_cost"],
                    "usage_share": usage_share,
                }
            )
        return {"generated_at": now.isoformat(), "days": days, "items": items}

    @router.get("/admin/economy/analytics/summary")
    async def admin_economy_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Economy event analytics (car trades, property buys, loot drops, loot box opens, booze runs) for the last N days.
        Admin or moderator only. Uses economy_events.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()

        cursor = db.economy_events.find(
            {"at": {"$gte": since_iso}},
            {"_id": 0},
        )
        by_type = {}
        async for e in cursor:
            ev_type = (e.get("type") or "").strip() or "unknown"
            s = by_type.setdefault(
                ev_type,
                {
                    "event_type": ev_type,
                    "count": 0,
                    "total_price": 0,
                    "total_cost": 0,
                    "total_profit": 0,
                    "total_revenue": 0,
                    "total_pieces": 0,
                },
            )
            s["count"] += 1
            s["total_price"] += int(e.get("price") or 0)
            s["total_cost"] += int(e.get("cost") or 0)
            s["total_profit"] += int(e.get("profit") or 0)
            s["total_revenue"] += int(e.get("revenue") or 0)
            s["total_pieces"] += int(e.get("pieces") or 0)

        items = []
        total_events = sum(v["count"] for v in by_type.values()) or 1
        for ev_type, s in sorted(by_type.items(), key=lambda kv: -kv[1]["count"]):
            count = s["count"]
            usage_share = count / total_events if total_events > 0 else 0.0
            items.append(
                {
                    "event_type": s["event_type"],
                    "count": count,
                    "total_price": s["total_price"],
                    "total_cost": s["total_cost"],
                    "total_profit": s["total_profit"],
                    "total_revenue": s["total_revenue"],
                    "total_pieces": s["total_pieces"],
                    "usage_share": usage_share,
                }
            )
        return {"generated_at": now.isoformat(), "days": days, "items": items}

    @router.get("/admin/booze-run/analytics/overview")
    async def admin_booze_run_analytics_overview(
        days: int = Query(30, ge=1, le=365),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Booze-run economy overview for the last N days (economy_events: booze_run_sell, booze_run_jail).
        Admin or moderator only.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since_iso = (now - timedelta(days=int(days))).isoformat()
        sell_count = 0
        sell_profit = 0
        sell_revenue = 0
        sell_users: Set[str] = set()
        jail_count = 0
        jail_loss = 0
        jail_buy = 0
        jail_sell = 0
        jail_users: Set[str] = set()
        cursor = db.economy_events.find(
            {
                "at": {"$gte": since_iso},
                "type": {"$in": ["booze_run_sell", "booze_run_jail"]},
            },
            {
                "_id": 0,
                "type": 1,
                "user_id": 1,
                "profit": 1,
                "revenue": 1,
                "phase": 1,
                "inventory_loss_basis": 1,
            },
        )
        async for e in cursor:
            t = (e.get("type") or "").strip()
            uid = (e.get("user_id") or "").strip()
            if t == "booze_run_sell":
                sell_count += 1
                sell_profit += int(e.get("profit") or 0)
                sell_revenue += int(e.get("revenue") or 0)
                if uid:
                    sell_users.add(uid)
            elif t == "booze_run_jail":
                jail_count += 1
                jail_loss += int(e.get("inventory_loss_basis") or 0)
                ph = (e.get("phase") or "").strip()
                if ph == "buy":
                    jail_buy += 1
                elif ph == "sell":
                    jail_sell += 1
                if uid:
                    jail_users.add(uid)
        # Revenue = cash from completed sells; profit = net after buy cost & run multipliers.
        # Sum(revenue) − sum(profit) ≈ aggregate buy cost for goods sold (per-event identity in game code).
        buy_cost_approx = max(0, sell_revenue - sell_profit)
        avg_profit = round((sell_profit / sell_count), 2) if sell_count > 0 else 0.0
        avg_revenue = round((sell_revenue / sell_count), 2) if sell_count > 0 else 0.0
        profit_pct_of_revenue = (
            round(100.0 * (sell_profit / sell_revenue), 2) if sell_revenue > 0 else 0.0
        )
        return {
            "generated_at": now.isoformat(),
            "days": days,
            "booze_run_sell": {
                "count": sell_count,
                "total_profit": sell_profit,
                "total_revenue": sell_revenue,
                "total_buy_cost_approx": buy_cost_approx,
                "avg_profit_per_sell": avg_profit,
                "avg_revenue_per_sell": avg_revenue,
                "profit_pct_of_revenue": profit_pct_of_revenue,
                "unique_users": len(sell_users),
            },
            "booze_run_jail": {
                "count": jail_count,
                "total_inventory_loss_basis": jail_loss,
                "buy_phase_count": jail_buy,
                "sell_phase_count": jail_sell,
                "unique_users": len(jail_users),
            },
            "unique_users_any": len(sell_users | jail_users),
        }

    @router.get("/admin/booze-run/analytics/leaders")
    async def admin_booze_run_analytics_leaders(
        limit: int = Query(50, ge=1, le=200),
        sort: str = Query("profit"),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Top users by lifetime booze stats (users collection). sort=profit|runs|jails.
        avg_profit_per_run_lifetime = booze_run_profit_total / max(booze_runs_count,1) (net of confiscation).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        s = (sort or "profit").strip().lower()
        if s not in ("profit", "runs", "jails"):
            raise HTTPException(status_code=400, detail="sort must be profit, runs, or jails")
        sort_field = {"profit": "booze_run_profit_total", "runs": "booze_runs_count", "jails": "booze_jail_count"}[s]
        cursor = (
            db.users.find(
                {
                    "$or": [
                        {"booze_runs_count": {"$gt": 0}},
                        {"booze_jail_count": {"$gt": 0}},
                    ]
                },
                {
                    "_id": 0,
                    "id": 1,
                    "username": 1,
                    "booze_runs_count": 1,
                    "booze_jail_count": 1,
                    "booze_run_profit_total": 1,
                    "booze_profit_total": 1,
                    "auto_rank_total_booze_runs": 1,
                    "auto_rank_total_booze_profit": 1,
                },
            )
            .sort(sort_field, -1)
            .limit(limit)
        )
        rows = await cursor.to_list(limit)
        leaders = []
        for r in rows:
            rc = int(r.get("booze_runs_count") or 0)
            pt = int(r.get("booze_run_profit_total") or 0)
            avg = (pt / rc) if rc > 0 else 0.0
            leaders.append(
                {
                    "id": r.get("id"),
                    "username": r.get("username") or "?",
                    "booze_runs_count": rc,
                    "booze_jail_count": int(r.get("booze_jail_count") or 0),
                    "booze_run_profit_total": pt,
                    "booze_profit_total": int(r.get("booze_profit_total") or 0),
                    "avg_profit_per_run_lifetime": round(avg, 2),
                    "auto_rank_total_booze_runs": int(r.get("auto_rank_total_booze_runs") or 0),
                    "auto_rank_total_booze_profit": int(r.get("auto_rank_total_booze_profit") or 0),
                }
            )
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sort": s,
            "limit": limit,
            "leaders": leaders,
        }

    @router.post("/admin/booze-run/repair-double-counted-profit")
    async def admin_booze_run_repair_double_counted_profit(
        dry_run: bool = Query(True, description="If true, only return counts and a sample preview; no DB writes"),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Fix legacy double-count: Auto Rank once added booze_run_profit_total twice (impl + stats).
        Sets booze_run_profit_total := max(0, booze_run_profit_total - auto_rank_total_booze_profit).
        Admin only. Test on backup/staging first.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")

        dedup_flag = "booze_run_profit_auto_rank_dedup_applied"
        match = {
            "auto_rank_total_booze_profit": {"$gt": 0},
            dedup_flag: {"$ne": True},
        }
        n_match = await db.users.count_documents(match)

        sample = []
        async for r in db.users.aggregate(
            [
                {"$match": match},
                {
                    "$project": {
                        "_id": 0,
                        "id": 1,
                        "username": 1,
                        "before": {"$ifNull": ["$booze_run_profit_total", 0]},
                        "subtract": {"$ifNull": ["$auto_rank_total_booze_profit", 0]},
                        "after": {
                            "$max": [
                                0,
                                {
                                    "$subtract": [
                                        {"$ifNull": ["$booze_run_profit_total", 0]},
                                        {"$ifNull": ["$auto_rank_total_booze_profit", 0]},
                                    ]
                                },
                            ]
                        },
                    }
                },
                {"$limit": 20},
            ]
        ):
            sample.append(
                {
                    "id": r.get("id"),
                    "username": r.get("username") or "?",
                    "booze_run_profit_total_before": int(r.get("before") or 0),
                    "subtract": int(r.get("subtract") or 0),
                    "booze_run_profit_total_after": int(r.get("after") or 0),
                }
            )

        if dry_run:
            return {
                "dry_run": True,
                "users_matched": n_match,
                "sample": sample,
                "message": "No changes applied. Call with dry_run=false to apply.",
            }

        now_iso = datetime.now(timezone.utc).isoformat()
        pipeline = [
            {
                "$set": {
                    "booze_run_profit_total": {
                        "$max": [
                            0,
                            {
                                "$subtract": [
                                    {"$ifNull": ["$booze_run_profit_total", 0]},
                                    {"$ifNull": ["$auto_rank_total_booze_profit", 0]},
                                ]
                            },
                        ]
                    },
                    dedup_flag: True,
                    "booze_run_profit_auto_rank_dedup_applied_at": now_iso,
                }
            }
        ]
        result = await db.users.update_many(match, pipeline)
        from routers.game import leaderboard as leaderboard_module

        leaderboard_module.invalidate_leaderboard_cache()
        return {
            "dry_run": False,
            "users_matched": result.matched_count,
            "users_modified": result.modified_count,
            "sample": sample,
        }

    @router.get("/admin/booze-run/analytics/user/{user_id_or_username}")
    async def admin_booze_run_analytics_user(
        user_id_or_username: str,
        days: int = Query(90, ge=1, le=365),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Per-user booze snapshot: lifetime counters, last-N-days from economy_events, recent history.
        Lookup by user id or username (case-insensitive).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (user_id_or_username or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="Missing user")
        proj = {
            "_id": 0,
            "id": 1,
            "username": 1,
            "booze_runs_count": 1,
            "booze_jail_count": 1,
            "booze_run_profit_total": 1,
            "booze_profit_total": 1,
            "booze_profit_today": 1,
            "booze_profit_today_date": 1,
            "booze_profit_by_type": 1,
            "booze_run_history": 1,
            "auto_rank_total_booze_runs": 1,
            "auto_rank_total_booze_profit": 1,
        }
        user = await db.users.find_one({"id": key}, proj)
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, proj)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        now = datetime.now(timezone.utc)
        since_iso = (now - timedelta(days=int(days))).isoformat()
        match = {
            "user_id": uid,
            "type": {"$in": ["booze_run_sell", "booze_run_jail"]},
            "at": {"$gte": since_iso},
        }
        agg_rows = await db.economy_events.aggregate(
            [
                {"$match": match},
                {
                    "$group": {
                        "_id": None,
                        "win_sells": {"$sum": {"$cond": [{"$eq": ["$type", "booze_run_sell"]}, 1, 0]}},
                        "win_profit": {
                            "$sum": {"$cond": [{"$eq": ["$type", "booze_run_sell"]}, {"$ifNull": ["$profit", 0]}, 0]}
                        },
                        "win_revenue": {
                            "$sum": {"$cond": [{"$eq": ["$type", "booze_run_sell"]}, {"$ifNull": ["$revenue", 0]}, 0]}
                        },
                        "win_jails": {"$sum": {"$cond": [{"$eq": ["$type", "booze_run_jail"]}, 1, 0]}},
                        "win_loss_basis": {
                            "$sum": {
                                "$cond": [
                                    {"$eq": ["$type", "booze_run_jail"]},
                                    {"$ifNull": ["$inventory_loss_basis", 0]},
                                    0,
                                ]
                            }
                        },
                    }
                },
            ]
        ).to_list(1)
        g = agg_rows[0] if agg_rows else {}
        win_sells = int(g.get("win_sells") or 0)
        win_profit = int(g.get("win_profit") or 0)
        win_revenue = int(g.get("win_revenue") or 0)
        win_jails = int(g.get("win_jails") or 0)
        win_loss_basis = int(g.get("win_loss_basis") or 0)
        win_buy_cost_approx = max(0, win_revenue - win_profit)
        recent_events: List[dict] = []
        ev_cursor = db.economy_events.find(match, {"_id": 0}).sort("at", -1).limit(100)
        async for e in ev_cursor:
            slim = {
                "at": e.get("at"),
                "type": e.get("type"),
                "profit": e.get("profit"),
                "revenue": e.get("revenue"),
                "amount": e.get("amount"),
                "booze_id": e.get("booze_id"),
                "booze_name": e.get("booze_name"),
                "phase": e.get("phase"),
                "inventory_loss_basis": e.get("inventory_loss_basis"),
            }
            recent_events.append({k: v for k, v in slim.items() if v is not None})
        rc = int(user.get("booze_runs_count") or 0)
        pt = int(user.get("booze_run_profit_total") or 0)
        lifetime_avg = round((pt / rc) if rc > 0 else 0.0, 2)
        win_avg = round((win_profit / win_sells) if win_sells > 0 else 0.0, 2)
        return {
            "generated_at": now.isoformat(),
            "user_id": uid,
            "username": user.get("username") or "?",
            "lifetime": {
                "booze_runs_count": rc,
                "booze_jail_count": int(user.get("booze_jail_count") or 0),
                "booze_run_profit_total": pt,
                "booze_profit_total": int(user.get("booze_profit_total") or 0),
                "booze_profit_today": int(user.get("booze_profit_today") or 0),
                "booze_profit_today_date": user.get("booze_profit_today_date"),
                "booze_profit_by_type": user.get("booze_profit_by_type") or {},
                "avg_profit_per_completed_run": lifetime_avg,
                "auto_rank_total_booze_runs": int(user.get("auto_rank_total_booze_runs") or 0),
                "auto_rank_total_booze_profit": int(user.get("auto_rank_total_booze_profit") or 0),
            },
            "window_days": days,
            "window": {
                "completed_runs": win_sells,
                "total_profit": win_profit,
                "total_revenue": win_revenue,
                "total_buy_cost_approx": win_buy_cost_approx,
                "avg_profit_per_run": win_avg,
                "jail_events": win_jails,
                "total_confiscation_basis": win_loss_basis,
            },
            "booze_run_history": user.get("booze_run_history") or [],
            "recent_events": recent_events,
        }

    def _analytics_since(now: datetime, bucket: str, periods: int) -> datetime:
        p = max(1, int(periods or 1))
        if bucket == "realtime_5m":
            return now - timedelta(minutes=5 * p)
        if bucket == "daily":
            return now - timedelta(days=p)
        if bucket == "weekly":
            return now - timedelta(days=7 * p)
        if bucket == "monthly":
            return now - timedelta(days=31 * p)
        raise HTTPException(status_code=400, detail="Invalid bucket")

    @router.get("/admin/analytics/v2/overview")
    async def admin_analytics_v2_overview(
        bucket: str = Query("daily"),
        periods: int = Query(7, ge=1, le=365),
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        b = (bucket or "daily").strip().lower()
        if b not in VALID_BUCKETS:
            raise HTTPException(status_code=400, detail=f"bucket must be one of {', '.join(VALID_BUCKETS)}")
        now = datetime.now(timezone.utc)
        since_iso = _analytics_since(now, b, periods).isoformat()
        pipeline = [
            {"$match": {"created_at": {"$gte": since_iso}}},
            {
                "$group": {
                    "_id": "$domain",
                    "events": {"$sum": 1},
                    "total_value": {"$sum": "$value"},
                    "users": {"$addToSet": "$user_id"},
                }
            },
            {"$sort": {"events": -1}},
        ]
        rows = await db.analytics_events.aggregate(pipeline).to_list(200)
        items = [
            {
                "domain": r.get("_id") or "unknown",
                "events": int(r.get("events") or 0),
                "total_value": float(r.get("total_value") or 0),
                "unique_users": len(r.get("users") or []),
            }
            for r in rows
        ]
        total_events = sum(x["events"] for x in items)
        total_value = sum(x["total_value"] for x in items)
        return {
            "generated_at": now.isoformat(),
            "bucket": b,
            "periods": int(periods),
            "total_events": total_events,
            "total_value": total_value,
            "items": items,
        }

    @router.get("/admin/analytics/v2/trends")
    async def admin_analytics_v2_trends(
        bucket: str = Query("daily"),
        periods: int = Query(14, ge=1, le=365),
        domain: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        b = (bucket or "daily").strip().lower()
        if b not in VALID_BUCKETS:
            raise HTTPException(status_code=400, detail=f"bucket must be one of {', '.join(VALID_BUCKETS)}")
        now = datetime.now(timezone.utc)
        since_iso = _analytics_since(now, b, periods).isoformat()
        match: Dict[str, Any] = {"created_at": {"$gte": since_iso}}
        if domain and domain.strip():
            match["domain"] = domain.strip()
        pipeline = [
            {"$match": match},
            {
                "$group": {
                    "_id": {"bucket": f"$buckets.{b}", "domain": "$domain"},
                    "events": {"$sum": 1},
                    "total_value": {"$sum": "$value"},
                }
            },
            {"$sort": {"_id.bucket": 1, "_id.domain": 1}},
        ]
        rows = await db.analytics_events.aggregate(pipeline).to_list(5000)
        series = [
            {
                "bucket_start": (r.get("_id") or {}).get("bucket"),
                "domain": (r.get("_id") or {}).get("domain") or "unknown",
                "events": int(r.get("events") or 0),
                "total_value": float(r.get("total_value") or 0),
            }
            for r in rows
        ]
        return {"generated_at": now.isoformat(), "bucket": b, "periods": int(periods), "series": series}

    @router.get("/admin/analytics/v2/leaders")
    async def admin_analytics_v2_leaders(
        domain: str = Query(...),
        bucket: str = Query("daily"),
        periods: int = Query(30, ge=1, le=365),
        limit: int = Query(25, ge=1, le=200),
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        b = (bucket or "daily").strip().lower()
        if b not in VALID_BUCKETS:
            raise HTTPException(status_code=400, detail=f"bucket must be one of {', '.join(VALID_BUCKETS)}")
        d = (domain or "").strip()
        if not d:
            raise HTTPException(status_code=400, detail="domain required")
        now = datetime.now(timezone.utc)
        since_iso = _analytics_since(now, b, periods).isoformat()
        pipeline = [
            {"$match": {"created_at": {"$gte": since_iso}, "domain": d}},
            {
                "$group": {
                    "_id": "$user_id",
                    "username": {"$last": "$username"},
                    "events": {"$sum": 1},
                    "total_value": {"$sum": "$value"},
                }
            },
            {"$sort": {"total_value": -1, "events": -1}},
            {"$limit": int(limit)},
        ]
        rows = await db.analytics_events.aggregate(pipeline).to_list(int(limit))
        leaders = [
            {
                "user_id": r.get("_id"),
                "username": r.get("username") or "?",
                "events": int(r.get("events") or 0),
                "total_value": float(r.get("total_value") or 0),
            }
            for r in rows
        ]
        return {"generated_at": now.isoformat(), "domain": d, "bucket": b, "periods": int(periods), "leaders": leaders}

    @router.post("/admin/analytics/v2/rollups/run")
    async def admin_analytics_v2_rollups_run(
        days_back: int = Query(31, ge=1, le=365),
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days_back))
        docs = await db.analytics_events.find(
            {"created_at": {"$gte": since.isoformat()}},
            {"_id": 0, "domain": 1, "value": 1, "user_id": 1, "buckets": 1},
        ).limit(500000).to_list(500000)
        aggregates: Dict[tuple, dict] = {}
        for d in docs:
            domain = (d.get("domain") or "unknown").strip() or "unknown"
            val = float(d.get("value") or 0)
            uid = d.get("user_id")
            bmap = d.get("buckets") or {}
            for b in ("realtime_5m", "daily", "weekly", "monthly"):
                start = (bmap.get(b) or "").strip()
                if not start:
                    continue
                key = (b, start, domain)
                row = aggregates.setdefault(key, {"events": 0, "total_value": 0.0, "users": set()})
                row["events"] += 1
                row["total_value"] += val
                if uid:
                    row["users"].add(uid)
        upserts = 0
        for (b, start, domain), row in aggregates.items():
            await db.analytics_rollups.update_one(
                {"bucket": b, "bucket_start": start, "domain": domain},
                {
                    "$set": {
                        "bucket": b,
                        "bucket_start": start,
                        "domain": domain,
                        "events": int(row["events"]),
                        "total_value": float(row["total_value"]),
                        "unique_users": len(row["users"]),
                        "updated_at": now.isoformat(),
                    }
                },
                upsert=True,
            )
            upserts += 1
        return {
            "generated_at": now.isoformat(),
            "days_back": int(days_back),
            "source_events_scanned": len(docs),
            "rollup_rows_upserted": upserts,
        }

    @router.get("/admin/analytics/v2/history")
    async def admin_analytics_v2_history(
        bucket: str = Query("daily"),
        domain: Optional[str] = Query(None),
        periods: int = Query(31, ge=1, le=365),
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        b = (bucket or "daily").strip().lower()
        if b not in VALID_BUCKETS:
            raise HTTPException(status_code=400, detail=f"bucket must be one of {', '.join(VALID_BUCKETS)}")
        now = datetime.now(timezone.utc)
        since = _analytics_since(now, b, periods)
        since_start = bucket_start(since, b).isoformat().replace("+00:00", "Z")
        q: Dict[str, Any] = {"bucket": b, "bucket_start": {"$gte": since_start}}
        if domain and domain.strip():
            q["domain"] = domain.strip()
        rows = await db.analytics_rollups.find(q, {"_id": 0}).sort("bucket_start", 1).to_list(5000)
        return {"generated_at": now.isoformat(), "bucket": b, "periods": int(periods), "rows": rows}

    @router.get("/admin/attacks/analytics/summary")
    async def admin_attacks_analytics_summary(
        days: int = Query(7, ge=1, le=90),
        limit: int = Query(100, ge=1, le=500),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Per-weapon attack analytics summary for the last N days.
        Admin or moderator only. Uses compact attack_attempts documents.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=int(days))
        since_iso = since.isoformat()
        pipeline = [
            {"$match": {"created_at": {"$gte": since_iso}}},
            {
                "$group": {
                    "_id": {"weapon_name": "$weapon_name", "weapon_id": "$weapon_id"},
                    "weapon_name": {"$last": "$weapon_name"},
                    "weapon_id": {"$last": "$weapon_id"},
                    "attempts": {"$sum": 1},
                    "kills": {
                        "$sum": {
                            "$cond": [{"$eq": ["$outcome", "killed"]}, 1, 0],
                        }
                    },
                    "total_bullets_spent": {"$sum": {"$ifNull": ["$bullets_spent", "$bullets_used"]}},
                    "total_damage_done": {"$sum": {"$ifNull": ["$damage_done", 0]}},
                    "last_at": {"$max": "$created_at"},
                }
            },
            {"$sort": {"attempts": -1}},
            {"$limit": int(limit)},
        ]
        cursor = db.attack_attempts.aggregate(pipeline)
        docs = await cursor.to_list(int(limit))
        total_attempts = sum(int(d.get("attempts", 0) or 0) for d in docs) or 1
        total_kills = sum(int(d.get("kills", 0) or 0) for d in docs)
        total_bullets = sum(int(d.get("total_bullets_spent", 0) or 0) for d in docs)
        total_damage = sum(float(d.get("total_damage_done", 0.0) or 0.0) for d in docs)
        items = []
        for d in docs:
            attempts = int(d.get("attempts", 0) or 0)
            kills = int(d.get("kills", 0) or 0)
            total_b = int(d.get("total_bullets_spent", 0) or 0)
            total_dmg = float(d.get("total_damage_done", 0.0) or 0.0)
            kill_rate = kills / attempts if attempts > 0 else 0.0
            avg_bullets_per_attempt = total_b / attempts if attempts > 0 else 0.0
            avg_bullets_per_kill = total_b / kills if kills > 0 else 0.0
            avg_damage = total_dmg / attempts if attempts > 0 else 0.0
            usage_share = attempts / total_attempts if total_attempts > 0 else 0.0
            items.append(
                {
                    "weapon_id": d.get("weapon_id"),
                    "weapon_name": d.get("weapon_name") or (d.get("_id") or {}).get("weapon_name") or "Unknown",
                    "attempts": attempts,
                    "kills": kills,
                    "kill_rate": kill_rate,
                    "avg_bullets_per_attempt": avg_bullets_per_attempt,
                    "avg_bullets_per_kill": avg_bullets_per_kill,
                    "avg_damage": avg_damage,
                    "total_bullets_spent": total_b,
                    "total_damage_done": total_dmg,
                    "usage_share": usage_share,
                    "last_at": d.get("last_at"),
                }
            )
        global_stats = {
            "attempts": int(total_attempts),
            "kills": int(total_kills),
            "kill_rate": (total_kills / total_attempts) if total_attempts > 0 else 0.0,
            "avg_bullets_per_attempt": (total_bullets / total_attempts) if total_attempts > 0 else 0.0,
            "avg_damage_per_attempt": (total_damage / total_attempts) if total_attempts > 0 else 0.0,
        }
        return {
            "generated_at": now.isoformat(),
            "days": days,
            "items": items,
            "global": global_stats,
        }

    @router.get("/admin/attacks/user/{user_id}")
    async def admin_attacks_user_profile(
        user_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Per-user attack profile for admins/moderators.
        Aggregates stats for the user as attacker and as target, plus recent attack events.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        # Allow lookup by either user id or username (case-insensitive) so admins can paste a username
        # directly when inspecting attack logs.
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "current_state": 1},
        )
        if not user:
            key = (user_id or "").strip()
            if key:
                pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
                user = await db.users.find_one(
                    {"username": pattern},
                    {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "current_state": 1},
                )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user["id"]

        # Aggregate attacker summary
        attacker_pipeline = [
            {"$match": {"attacker_id": user_id}},
            {
                "$group": {
                    "_id": None,
                    "attempts": {"$sum": 1},
                    "kills": {
                        "$sum": {
                            "$cond": [{"$eq": ["$outcome", "killed"]}, 1, 0],
                        }
                    },
                    "total_bullets_spent": {"$sum": {"$ifNull": ["$bullets_spent", "$bullets_used"]}},
                    "total_damage_done": {"$sum": {"$ifNull": ["$damage_done", 0]}},
                }
            },
        ]
        attacker_cursor = db.attack_attempts.aggregate(attacker_pipeline)
        attacker_docs = await attacker_cursor.to_list(1)
        attacker_summary_raw = attacker_docs[0] if attacker_docs else {}
        attacker_attempts = int(attacker_summary_raw.get("attempts", 0) or 0)
        attacker_kills = int(attacker_summary_raw.get("kills", 0) or 0)
        attacker_bullets = int(attacker_summary_raw.get("total_bullets_spent", 0) or 0)
        attacker_damage = float(attacker_summary_raw.get("total_damage_done", 0.0) or 0.0)
        attacker_summary = {
            "attempts": attacker_attempts,
            "kills": attacker_kills,
            "kill_rate": (attacker_kills / attacker_attempts) if attacker_attempts > 0 else 0.0,
            "total_bullets_spent": attacker_bullets,
            "total_damage_done": attacker_damage,
            "avg_bullets_per_attempt": (attacker_bullets / attacker_attempts) if attacker_attempts > 0 else 0.0,
            "avg_damage_per_attempt": (attacker_damage / attacker_attempts) if attacker_attempts > 0 else 0.0,
        }

        # Aggregate target/victim summary
        target_pipeline = [
            {"$match": {"target_id": user_id}},
            {
                "$group": {
                    "_id": None,
                    "times_attacked": {"$sum": 1},
                    "times_killed": {
                        "$sum": {
                            "$cond": [{"$eq": ["$outcome", "killed"]}, 1, 0],
                        }
                    },
                }
            },
        ]
        target_cursor = db.attack_attempts.aggregate(target_pipeline)
        target_docs = await target_cursor.to_list(1)
        target_summary_raw = target_docs[0] if target_docs else {}
        target_attempts = int(target_summary_raw.get("times_attacked", 0) or 0)
        target_killed = int(target_summary_raw.get("times_killed", 0) or 0)
        target_summary = {
            "times_attacked": target_attempts,
            "times_killed": target_killed,
            "death_rate": (target_killed / target_attempts) if target_attempts > 0 else 0.0,
        }

        # Top weapons used by this user as attacker
        weapons_pipeline = [
            {"$match": {"attacker_id": user_id}},
            {
                "$group": {
                    "_id": {"weapon_name": "$weapon_name", "weapon_id": "$weapon_id"},
                    "weapon_name": {"$last": "$weapon_name"},
                    "weapon_id": {"$last": "$weapon_id"},
                    "attempts": {"$sum": 1},
                    "kills": {
                        "$sum": {
                            "$cond": [{"$eq": ["$outcome", "killed"]}, 1, 0],
                        }
                    },
                    "total_bullets_spent": {"$sum": {"$ifNull": ["$bullets_spent", "$bullets_used"]}},
                    "total_damage_done": {"$sum": {"$ifNull": ["$damage_done", 0]}},
                }
            },
            {"$sort": {"attempts": -1}},
            {"$limit": 10},
        ]
        weapons_cursor = db.attack_attempts.aggregate(weapons_pipeline)
        weapon_docs = await weapons_cursor.to_list(10)
        top_weapons = []
        for d in weapon_docs:
            attempts = int(d.get("attempts", 0) or 0)
            kills = int(d.get("kills", 0) or 0)
            total_b = int(d.get("total_bullets_spent", 0) or 0)
            total_dmg = float(d.get("total_damage_done", 0.0) or 0.0)
            top_weapons.append(
                {
                    "weapon_id": d.get("weapon_id"),
                    "weapon_name": d.get("weapon_name") or (d.get("_id") or {}).get("weapon_name") or "Unknown",
                    "attempts": attempts,
                    "kills": kills,
                    "kill_rate": (kills / attempts) if attempts > 0 else 0.0,
                    "avg_bullets_per_attempt": (total_b / attempts) if attempts > 0 else 0.0,
                    "avg_damage_per_attempt": (total_dmg / attempts) if attempts > 0 else 0.0,
                }
            )

        # Recent attacks as attacker and as target (most recent first)
        recent_attacker = (
            await db.attack_attempts.find(
                {"attacker_id": user_id},
                {"_id": 0},
            )
            .sort("created_at", -1)
            .to_list(50)
        )
        recent_target = (
            await db.attack_attempts.find(
                {"target_id": user_id},
                {"_id": 0},
            )
            .sort("created_at", -1)
            .to_list(50)
        )

        return {
            "user": user,
            "attacker_summary": attacker_summary,
            "target_summary": target_summary,
            "top_weapons": top_weapons,
            "recent_as_attacker": recent_attacker,
            "recent_as_target": recent_target,
        }

    def _attack_attempts_query_exclude_hitlist_npcs(base: Dict[str, Any]) -> Dict[str, Any]:
        """Omit hitlist / NPC targets (PvP-only log). Uses flags + legacy target_username '(NPC)'."""
        npc_name_pat = re.compile(r"\(NPC\)", re.IGNORECASE)
        non_npc: Dict[str, Any] = {
            "$and": [
                {"$or": [{"target_is_npc": {"$ne": True}}, {"target_is_npc": {"$exists": False}}]},
                {"$or": [{"is_npc_kill": {"$ne": True}}, {"is_npc_kill": {"$exists": False}}]},
                {
                    "$or": [
                        {"target_username": {"$exists": False}},
                        {"target_username": None},
                        {"target_username": {"$not": npc_name_pat}},
                    ]
                },
            ]
        }
        if not base:
            return non_npc
        return {"$and": [base, non_npc]}

    @router.get("/admin/attacks/logs")
    async def admin_attacks_logs(
        username: Optional[str] = Query(
            None,
            description="If omitted or empty, return recent attempts for all players (newest first).",
        ),
        limit: int = Query(500, ge=1, le=1000),
        since: Optional[str] = Query(None, description="ISO created_at; return only attempts after this (for live refresh)"),
        exclude_target_npc: bool = Query(
            False,
            description="If true, exclude hitlist/NPC targets (target_is_npc, is_npc_kill, or '(NPC)' in target_username).",
        ),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return raw attack_attempts for a user (as attacker or target),
        or the most recent attempts globally when username is omitted.
        Full post data: who shot whom, outcome, bodyguard, bullets, location, etc.
        Use since= to fetch only new entries (e.g. for live refresh).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        key = (username or "").strip()
        if not key or key.lower() in ("*", "all"):
            q: Dict[str, Any] = {}
            if since:
                q["created_at"] = {"$gt": since}
            if exclude_target_npc:
                q = _attack_attempts_query_exclude_hitlist_npcs(q)
            effective_limit = min(limit, 100) if since else limit
            docs = (
                await db.attack_attempts.find(q, {"_id": 0})
                .sort("created_at", -1)
                .to_list(effective_limit)
            )
            return {"username": None, "scope": "all", "logs": docs, "exclude_target_npc": exclude_target_npc}
        user = await db.users.find_one(
            {"id": key},
            {"_id": 0, "id": 1, "username": 1},
        )
        if not user:
            # Exact username first (uses index), then case-insensitive regex
            user = await db.users.find_one(
                {"username": key},
                {"_id": 0, "id": 1, "username": 1},
            )
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one(
                {"username": pattern},
                {"_id": 0, "id": 1, "username": 1},
            )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        q = {"$or": [{"attacker_id": uid}, {"target_id": uid}]}
        if since:
            q["created_at"] = {"$gt": since}
        if exclude_target_npc:
            q = _attack_attempts_query_exclude_hitlist_npcs(q)
        effective_limit = min(limit, 100) if since else limit
        docs = (
            await db.attack_attempts.find(q, {"_id": 0})
            .sort("created_at", -1)
            .to_list(effective_limit)
        )
        return {"username": user.get("username"), "scope": "user", "logs": docs, "exclude_target_npc": exclude_target_npc}

    def _audit_iso(val: Any) -> str:
        if val is None:
            return ""
        if isinstance(val, datetime):
            return val.isoformat()
        if hasattr(val, "isoformat") and callable(getattr(val, "isoformat", None)):
            try:
                return val.isoformat()
            except Exception:
                return str(val)
        return str(val)

    def _sanitize_audit_doc(doc: Optional[dict]) -> Optional[dict]:
        if not doc:
            return None
        out: Dict[str, Any] = {}
        for k, v in doc.items():
            if k == "_id":
                continue
            if isinstance(v, dict):
                out[k] = _sanitize_audit_doc(v)
            elif isinstance(v, list):
                out[k] = [
                    _sanitize_audit_doc(x) if isinstance(x, dict) else _audit_iso(x) if hasattr(x, "isoformat") else x
                    for x in v
                ]
            elif hasattr(v, "isoformat") and callable(getattr(v, "isoformat", None)):
                out[k] = _audit_iso(v)
            else:
                out[k] = v
        return out

    @router.get("/admin/bodyguards/audit")
    async def admin_bodyguards_audit(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=2000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin or moderator only. Per-user bodyguard snapshot, payouts, point ledger slice,
        activity_log slice, attack rows for bodyguard kills, war feed slice, hitlist_bodyguard_events,
        and a merged timeline (newest first).
        Hire inflation breakdown exists for hires after server deploy; older rows may omit those fields.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        key = (username or "").strip()
        user = await db.users.find_one(
            {"id": key},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "bodyguard_slots": 1,
                "bodyguard_inflation_level": 1,
                "bodyguard_inflation_until": 1,
                "is_bodyguard": 1,
                "bodyguard_owner_id": 1,
            },
        )
        if not user:
            user = await db.users.find_one(
                {"username": key},
                {
                    "_id": 0,
                    "id": 1,
                    "username": 1,
                    "bodyguard_slots": 1,
                    "bodyguard_inflation_level": 1,
                    "bodyguard_inflation_until": 1,
                    "is_bodyguard": 1,
                    "bodyguard_owner_id": 1,
                },
            )
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one(
                {"username": pattern},
                {
                    "_id": 0,
                    "id": 1,
                    "username": 1,
                    "bodyguard_slots": 1,
                    "bodyguard_inflation_level": 1,
                    "bodyguard_inflation_until": 1,
                    "is_bodyguard": 1,
                    "bodyguard_owner_id": 1,
                },
            )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]

        owned_bodyguards = await db.bodyguards.find({"user_id": uid}, {"_id": 0}).sort("slot_number", 1).to_list(10)
        employed_as_guard = await db.bodyguards.find_one({"bodyguard_user_id": uid}, {"_id": 0})

        guard_user_ids: Set[str] = set()
        for row in owned_bodyguards:
            gid = row.get("bodyguard_user_id")
            if gid:
                guard_user_ids.add(str(gid))
        async for r in db.users.find({"bodyguard_owner_id": uid, "is_npc": True}, {"_id": 0, "id": 1}):
            guard_user_ids.add(r["id"])

        dropped_rows = await db.hitlist_bodyguard_events.find(
            {"owner_id": uid, "type": "bodyguard_dropped", "guard_id": {"$nin": [None, ""]}},
            {"_id": 0, "guard_id": 1},
        ).limit(500).to_list(500)
        for r in dropped_rows:
            if r.get("guard_id"):
                guard_user_ids.add(str(r["guard_id"]))

        accepted_rows = await db.hitlist_bodyguard_events.find(
            {
                "inviter_id": uid,
                "type": "bodyguard_invite_accepted",
                "invitee_id": {"$nin": [None, ""]},
            },
            {"_id": 0, "invitee_id": 1},
        ).limit(500).to_list(500)
        for r in accepted_rows:
            if r.get("invitee_id"):
                guard_user_ids.add(str(r["invitee_id"]))

        hbe_q = {
            "type": {"$in": list(BODYGUARD_AUDIT_HITLIST_TYPES)},
            "$or": [
                {"owner_id": uid},
                {"user_id": uid},
                {"guard_id": uid},
                {"guard_user_id": uid},
                {"inviter_id": uid},
                {"invitee_id": uid},
                {"killer_id": uid},
            ],
        }
        hitlist_bodyguard_timeline = (
            await db.hitlist_bodyguard_events.find(hbe_q, {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)
        )
        hitlist_bodyguard_timeline = [_sanitize_audit_doc(d) for d in hitlist_bodyguard_timeline]

        glist = list(guard_user_ids)
        if glist:
            ak_q = {
                "is_bodyguard_kill": True,
                "outcome": "killed",
                "$or": [{"target_id": {"$in": glist}}, {"target_id": uid}],
            }
        else:
            ak_q = {"is_bodyguard_kill": True, "outcome": "killed", "target_id": uid}
        bodyguard_kills = (
            await db.attack_attempts.find(ak_q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
        )
        bodyguard_kills = [_sanitize_audit_doc(d) for d in bodyguard_kills]

        point_ledger_bodyguard = (
            await db.point_ledger_events.find({"user_id": uid, "event_type": {"$regex": r"^bodyguard_"}}, {"_id": 0})
            .sort("created_at", -1)
            .limit(limit)
            .to_list(limit)
        )
        point_ledger_bodyguard = [_sanitize_audit_doc(d) for d in point_ledger_bodyguard]

        activity_bodyguard = (
            await db.activity_log.find(
                {"user_id": uid, "action": {"$in": ["bodyguard_hire", "bodyguard_drop"]}},
                {"_id": 0},
            )
            .sort("created_at", -1)
            .limit(limit)
            .to_list(limit)
        )
        activity_bodyguard = [_sanitize_audit_doc(d) for d in activity_bodyguard]

        payouts = await db.bodyguard_payouts.find(
            {"$or": [{"owner_id": uid}, {"guard_id": uid}]},
            {"_id": 0},
        ).sort("payout_date", -1).limit(limit).to_list(limit)
        payouts = [_sanitize_audit_doc(d) for d in payouts]

        war_bodyguard_kills = (
            await db.war_kill_feed.find({"kill_type": "bodyguard", "victim_id": uid}, {"_id": 0})
            .sort("created_at", -1)
            .limit(limit)
            .to_list(limit)
        )
        war_bodyguard_kills = [_sanitize_audit_doc(d) for d in war_bodyguard_kills]

        merged: List[Dict[str, Any]] = []
        for d in hitlist_bodyguard_timeline:
            merged.append(
                {
                    "source": "hitlist_bodyguard_events",
                    "at": _audit_iso(d.get("at") if isinstance(d, dict) else None),
                    "kind": (d or {}).get("type") if isinstance(d, dict) else None,
                    "data": d,
                }
            )
        for d in bodyguard_kills:
            merged.append(
                {
                    "source": "attack_attempts",
                    "at": _audit_iso(d.get("created_at") if isinstance(d, dict) else None),
                    "kind": "bodyguard_kill_attempt",
                    "data": d,
                }
            )
        for d in point_ledger_bodyguard:
            merged.append(
                {
                    "source": "point_ledger_events",
                    "at": _audit_iso(d.get("created_at") if isinstance(d, dict) else None),
                    "kind": (d or {}).get("event_type") if isinstance(d, dict) else None,
                    "data": d,
                }
            )
        for d in activity_bodyguard:
            merged.append(
                {
                    "source": "activity_log",
                    "at": _audit_iso(d.get("created_at") if isinstance(d, dict) else None),
                    "kind": (d or {}).get("action") if isinstance(d, dict) else None,
                    "data": d,
                }
            )

        def _merged_sort_key(item: dict) -> str:
            return (item.get("at") or "")[:30]

        merged.sort(key=_merged_sort_key, reverse=True)
        merged = merged[:limit]

        return {
            "user": _sanitize_audit_doc(user),
            "guard_user_ids_for_attacks": sorted(guard_user_ids),
            "owned_bodyguards": [_sanitize_audit_doc(d) for d in owned_bodyguards],
            "employed_as_guard": _sanitize_audit_doc(employed_as_guard),
            "hitlist_bodyguard_timeline": hitlist_bodyguard_timeline,
            "bodyguard_kills": bodyguard_kills,
            "point_ledger_bodyguard": point_ledger_bodyguard,
            "activity_bodyguard": activity_bodyguard,
            "payouts": payouts,
            "war_bodyguard_kills": war_bodyguard_kills,
            "merged_timeline": merged,
            "note": "Hire inflation fields (inflation_level_before, inflation_mult, event_bodyguard_cost_mult, base_slot_cost) are stored for new hires only. bodyguard_killed events and attack_attempts.bodyguard_owner_id apply to new kills only.",
        }

    def _robot_hires_parse_dt(val: Any) -> Optional[datetime]:
        if val is None:
            return None
        if isinstance(val, datetime):
            return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
        if isinstance(val, str):
            try:
                s = val.replace("Z", "+00:00")
                dt = datetime.fromisoformat(s)
                return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
            except Exception:
                return None
        return None

    @router.get("/admin/bodyguards/robot-hires")
    async def admin_bodyguards_robot_hires(
        username: str = Query(..., min_length=1),
        limit: int = Query(100, ge=1, le=200),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin or moderator. Last N robot bodyguard hires for a player (hitlist_bodyguard_events),
        enriched with point_ledger correlation, kill/replace lifecycle, and active-slot check.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        key = (username or "").strip()
        user = await db.users.find_one(
            {"id": key},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "bodyguard_slots": 1,
                "bodyguard_inflation_level": 1,
                "bodyguard_inflation_until": 1,
                "is_bodyguard": 1,
                "bodyguard_owner_id": 1,
            },
        )
        if not user:
            user = await db.users.find_one(
                {"username": key},
                {
                    "_id": 0,
                    "id": 1,
                    "username": 1,
                    "bodyguard_slots": 1,
                    "bodyguard_inflation_level": 1,
                    "bodyguard_inflation_until": 1,
                    "is_bodyguard": 1,
                    "bodyguard_owner_id": 1,
                },
            )
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one(
                {"username": pattern},
                {
                    "_id": 0,
                    "id": 1,
                    "username": 1,
                    "bodyguard_slots": 1,
                    "bodyguard_inflation_level": 1,
                    "bodyguard_inflation_until": 1,
                    "is_bodyguard": 1,
                    "bodyguard_owner_id": 1,
                },
            )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]

        hire_rows_raw = (
            await db.hitlist_bodyguard_events.find(
                {"owner_id": uid, "type": "bodyguard_hired", "is_robot": True},
                {"_id": 0},
            )
            .sort("at", -1)
            .limit(limit)
            .to_list(limit)
        )

        ledger_rows = (
            await db.point_ledger_events.find(
                {"user_id": uid, "event_type": "bodyguard_hire"},
                {"_id": 0},
            )
            .sort("created_at", -1)
            .limit(2500)
            .to_list(2500)
        )

        kill_rows = (
            await db.hitlist_bodyguard_events.find(
                {"owner_id": uid, "type": "bodyguard_killed"},
                {"_id": 0},
            )
            .sort("at", 1)
            .limit(2500)
            .to_list(2500)
        )

        replace_rows = (
            await db.hitlist_bodyguard_events.find(
                {"owner_id": uid, "type": "admin_robot_bodyguards_replaced"},
                {"_id": 0},
            )
            .sort("at", 1)
            .limit(500)
            .to_list(500)
        )

        owned = await db.bodyguards.find({"user_id": uid}, {"_id": 0, "slot_number": 1, "bodyguard_user_id": 1, "robot_name": 1}).to_list(10)
        ledger_parsed: List[Tuple[Optional[datetime], Dict[str, Any]]] = []
        for lr in ledger_rows:
            ledger_parsed.append((_robot_hires_parse_dt(lr.get("created_at")), lr))

        window = timedelta(minutes=2)
        hires_out: List[Dict[str, Any]] = []

        def _uname_match(a: Optional[str], b: Optional[str]) -> bool:
            if not a or not b:
                return False
            return str(a).strip().lower() == str(b).strip().lower()

        for raw_hire in hire_rows_raw:
            hire_clean = _sanitize_audit_doc(dict(raw_hire)) or {}
            hire_at = _robot_hires_parse_dt(raw_hire.get("at"))
            slot_val = raw_hire.get("slot")
            try:
                slot_int = int(slot_val) if slot_val is not None else None
            except Exception:
                slot_int = None
            guard_uid = raw_hire.get("guard_user_id")
            guard_uid_str = str(guard_uid).strip() if guard_uid else None
            bg_username = raw_hire.get("bodyguard_username")

            ledger_match: Optional[Dict[str, Any]] = None
            if hire_at:
                best_delta: Optional[timedelta] = None
                for created_dt, ledger_doc in ledger_parsed:
                    if created_dt is None:
                        continue
                    meta = ledger_doc.get("meta") if isinstance(ledger_doc.get("meta"), dict) else {}
                    ledger_slot = meta.get("slot")
                    try:
                        ls = int(ledger_slot) if ledger_slot is not None else None
                    except Exception:
                        ls = None
                    if slot_int is not None and ls is not None and ls != slot_int:
                        continue
                    if meta.get("is_robot") is False:
                        continue
                    delta = abs(created_dt - hire_at)
                    if delta <= window:
                        if best_delta is None or delta < best_delta:
                            best_delta = delta
                            ledger_match = ledger_doc

            ledger_sanitized = _sanitize_audit_doc(dict(ledger_match)) if ledger_match else None

            still_active = False
            if guard_uid_str:
                for ob in owned:
                    if str(ob.get("bodyguard_user_id") or "").strip() == guard_uid_str:
                        still_active = True
                        break
            if not still_active and bg_username and slot_int is not None:
                for ob in owned:
                    if int(ob.get("slot_number") or 0) == slot_int and _uname_match(ob.get("robot_name"), bg_username):
                        still_active = True
                        break

            kill_hit: Optional[Dict[str, Any]] = None
            replace_hit: Optional[Dict[str, Any]] = None
            replace_reason: Optional[str] = None

            kill_candidates: List[Tuple[datetime, Dict[str, Any]]] = []
            for kr in kill_rows:
                kat = _robot_hires_parse_dt(kr.get("at"))
                if hire_at and kat and kat < hire_at:
                    continue
                gid_raw = kr.get("guard_user_id")
                gid_ok = bool(guard_uid_str) and gid_raw is not None and str(gid_raw).strip() == guard_uid_str
                uname_ok = bool(bg_username) and _uname_match(bg_username, kr.get("guard_username"))
                if guard_uid_str:
                    if gid_ok:
                        kill_candidates.append((kat or datetime.min.replace(tzinfo=timezone.utc), kr))
                elif uname_ok:
                    kill_candidates.append((kat or datetime.min.replace(tzinfo=timezone.utc), kr))
            kill_candidates.sort(key=lambda x: x[0])
            if kill_candidates:
                kill_hit = kill_candidates[0][1]

            for rr in replace_rows:
                rat = _robot_hires_parse_dt(rr.get("at"))
                if hire_at and rat and rat < hire_at:
                    continue
                prev_list = rr.get("previous") if isinstance(rr.get("previous"), list) else []
                matched = False
                for pv in prev_list:
                    if not isinstance(pv, dict):
                        continue
                    old_uid = pv.get("old_robot_user_id")
                    old_name = pv.get("old_robot_name")
                    ps = pv.get("slot")
                    try:
                        ps_int = int(ps) if ps is not None else None
                    except Exception:
                        ps_int = None
                    if guard_uid_str and old_uid and str(old_uid).strip() == guard_uid_str:
                        matched = True
                        replace_reason = f"slot {ps_int or '?'}"
                        break
                    if bg_username and _uname_match(old_name, bg_username) and (slot_int is None or ps_int is None or ps_int == slot_int):
                        matched = True
                        replace_reason = f"slot {ps_int or '?'}"
                        break
                if matched:
                    replace_hit = rr
                    break

            outcome_label = "Unknown"
            outcome_detail: Dict[str, Any] = {}
            outcome_at_iso = ""
            if still_active:
                outcome_label = "Active"
            elif kill_hit:
                outcome_label = "Killed"
                outcome_detail = {
                    "guard_username": kill_hit.get("guard_username"),
                    "guard_user_id": kill_hit.get("guard_user_id"),
                    "killer_username": kill_hit.get("killer_username"),
                    "killer_id": kill_hit.get("killer_id"),
                    "bullets_used": kill_hit.get("bullets_used"),
                    "location_state": kill_hit.get("location_state"),
                    "hire_cost_snapshot": kill_hit.get("hire_cost"),
                }
                outcome_at_iso = _audit_iso(kill_hit.get("at"))
            elif replace_hit:
                outcome_label = "Replaced"
                outcome_detail = {
                    "reason": replace_reason or "admin_robot_bodyguards_replaced",
                    "admin_username": replace_hit.get("admin_username"),
                    "admin_id": replace_hit.get("admin_id"),
                    "count": replace_hit.get("count"),
                    "new_usernames": replace_hit.get("new_usernames"),
                }
                outcome_at_iso = _audit_iso(replace_hit.get("at"))

            hires_out.append(
                {
                    "hire": hire_clean,
                    "point_ledger": ledger_sanitized,
                    "outcome_label": outcome_label,
                    "outcome_at": outcome_at_iso,
                    "outcome_detail": _sanitize_audit_doc(outcome_detail) if outcome_detail else {},
                    "still_active": still_active,
                }
            )

        note = (
            "guard_user_id and bodyguard_slot_row_id appear on hires after deploy. "
            "Legacy hires match kills by bodyguard_username. "
            "Point ledger tied when meta.slot matches and created_at within 2 minutes of hire at."
        )
        return {
            "user": _sanitize_audit_doc(user),
            "hires": hires_out,
            "note": note,
        }

    @router.get("/admin/bodyguards/searching")
    async def admin_bodyguards_searching(
        username: str = Query(..., min_length=1),
        limit: int = Query(200, ge=1, le=2000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin or moderator. Bodyguard hunts currently in `searching` for this attacker,
        with elapsed and remaining find-time.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            user = await db.users.find_one({"username": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]

        attacks = (
            await db.attacks.find(
                {"attacker_id": uid, "status": "searching"},
                {"_id": 0},
            )
            .sort("search_started", -1)
            .limit(limit)
            .to_list(limit)
        )
        if not attacks:
            return {
                "user": _sanitize_audit_doc(user),
                "rows": [],
                "note": "No active searching rows for this user.",
            }

        target_ids = [a.get("target_id") for a in attacks if a.get("target_id")]
        target_ids = list(dict.fromkeys(target_ids))
        targets_by_id: Dict[str, Dict[str, Any]] = {}
        if target_ids:
            async for tu in db.users.find(
                {"id": {"$in": target_ids}},
                {"_id": 0, "id": 1, "username": 1, "is_bodyguard": 1, "is_npc": 1, "bodyguard_owner_id": 1},
            ):
                targets_by_id[str(tu["id"])] = tu

        owner_ids = list(
            {
                str(t.get("bodyguard_owner_id"))
                for t in targets_by_id.values()
                if t.get("is_bodyguard") and t.get("bodyguard_owner_id")
            }
        )
        owners_by_id: Dict[str, str] = {}
        if owner_ids:
            async for ou in db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "username": 1}):
                owners_by_id[str(ou["id"])] = str(ou.get("username") or "?")

        now = datetime.now(timezone.utc)
        out_rows: List[Dict[str, Any]] = []
        for a in attacks:
            tid = str(a.get("target_id") or "")
            t = targets_by_id.get(tid) or {}
            if not t.get("is_bodyguard"):
                continue
            started_dt = _robot_hires_parse_dt(a.get("search_started"))
            found_dt = _robot_hires_parse_dt(a.get("found_at"))
            elapsed_seconds = int(max(0.0, (now - started_dt).total_seconds())) if started_dt else None
            remaining_seconds = int(max(0.0, (found_dt - now).total_seconds())) if found_dt else None
            total_seconds = int(max(0.0, (found_dt - started_dt).total_seconds())) if started_dt and found_dt else None

            owner_id = str(t.get("bodyguard_owner_id") or "")
            out_rows.append(
                {
                    "attack_id": a.get("id"),
                    "target_id": tid or None,
                    "target_username": a.get("target_username") or t.get("username") or "?",
                    "search_started": _audit_iso(a.get("search_started")),
                    "found_at": _audit_iso(a.get("found_at")),
                    "elapsed_seconds": elapsed_seconds,
                    "remaining_seconds": remaining_seconds,
                    "search_total_seconds": total_seconds,
                    "bodyguard_owner_id": owner_id or None,
                    "bodyguard_owner_username": owners_by_id.get(owner_id) if owner_id else None,
                    "target_is_npc": bool(t.get("is_npc")),
                }
            )

        return {
            "user": _sanitize_audit_doc(user),
            "rows": out_rows,
            "generated_at": now.isoformat(),
            "note": "Rows are limited to status=searching where the target is a bodyguard account. Remaining time derives from attacks.found_at minus server now.",
        }

    @router.get("/admin/crimes/logs")
    async def admin_crimes_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return raw crime_events for a user (full post data).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one(
            {"id": key},
            {"_id": 0, "id": 1, "username": 1},
        )
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one(
                {"username": pattern},
                {"_id": 0, "id": 1, "username": 1},
            )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        docs = (
            await db.crime_events.find(
                {"user_id": uid},
                {"_id": 0},
            )
            .sort("at", -1)
            .to_list(limit)
            )
        return {"username": user.get("username"), "logs": docs}

    @router.get("/admin/gta/logs")
    async def admin_gta_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return raw gta_events for a user (full post data: option, car, success, jailed, etc.).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        cursor = db.gta_events.find({"user_id": uid}, {"_id": 0}).sort("at", -1).limit(limit)
        docs = await cursor.to_list(limit)
        for d in docs:
            if isinstance(d.get("at"), datetime):
                d["at"] = d["at"].isoformat()
        return {"username": user.get("username"), "logs": docs}

    @router.get("/admin/jail/logs")
    async def admin_jail_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return raw bust_events for a user (full post data: target, success, profit, NPC vs player).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        cursor = db.bust_events.find({"user_id": uid}, {"_id": 0}).sort("at", -1).limit(limit)
        docs = await cursor.to_list(limit)
        for d in docs:
            if isinstance(d.get("at"), datetime):
                d["at"] = d["at"].isoformat()
        return {"username": user.get("username"), "logs": docs}

    @router.get("/admin/bank/logs")
    async def admin_bank_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(100, ge=1, le=500),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return bank activity for a user: money transfers (sent/received) and interest deposits.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        transfers_cursor = db.money_transfers.find(
            {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]},
            {"_id": 0},
        ).sort("created_at", -1).limit(limit)
        deposits_cursor = db.bank_deposits.find(
            {"user_id": uid},
            {"_id": 0},
        ).sort("created_at", -1).limit(limit)
        transfers = await transfers_cursor.to_list(limit)
        deposits = await deposits_cursor.to_list(limit)
        for t in transfers:
            t["direction"] = "sent" if t.get("from_user_id") == uid else "received"
        return {
            "username": user.get("username"),
            "transfers": transfers,
            "deposits": deposits,
        }

    @router.get("/admin/wallet-activity")
    async def admin_wallet_activity(
        username: str = Query(..., min_length=1, max_length=80),
        limit: int = Query(200, ge=1, le=500),
        kind: str = Query("all", description="Filter: all | cash_transfer | points_transfer | bank_interest | mdg | point_ledger"),
        since: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator. Unified chronological feed: cash transfers, points transfers, bank interest
        deposits/claims, MDG gambling rows, and curated point_ledger_events (no duplicate P2P ledger legs).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1, "money": 1, "points": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1, "money": 1, "points": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = str(user["id"])
        cap = min(max(1, int(limit)), 500)
        per_source = min(300, max(cap, 120))
        since_raw = (since or "").strip()
        since_dt: Optional[datetime] = None
        since_iso = ""
        if since_raw:
            try:
                since_dt = datetime.fromisoformat(since_raw.replace("Z", "+00:00"))
                if since_dt.tzinfo is None:
                    since_dt = since_dt.replace(tzinfo=timezone.utc)
                since_iso = since_dt.isoformat()
            except Exception:
                since_dt = None

        def _row_ts(created: Any) -> float:
            if created is None:
                return 0.0
            if isinstance(created, datetime):
                try:
                    return created.timestamp()
                except Exception:
                    return 0.0
            if isinstance(created, str):
                try:
                    return datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
                except Exception:
                    return 0.0
            return 0.0

        def _iso(created: Any) -> str:
            if created is None:
                return ""
            if isinstance(created, datetime):
                try:
                    return created.isoformat()
                except Exception:
                    return str(created)
            return str(created)

        def _passes_since(created: Any) -> bool:
            if since_dt is None:
                return True
            return _row_ts(created) >= since_dt.timestamp()

        async def _fetch_money():
            q: Dict[str, Any] = {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]}
            if since_iso:
                q["created_at"] = {"$gte": since_iso}
            return await db.money_transfers.find(q, {"_id": 0}).sort("created_at", -1).limit(per_source).to_list(per_source)

        async def _fetch_points():
            q: Dict[str, Any] = {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]}
            if since_iso:
                q["created_at"] = {"$gte": since_iso}
            return await db.points_transfers.find(q, {"_id": 0}).sort("created_at", -1).limit(per_source).to_list(per_source)

        async def _fetch_deposits():
            q: Dict[str, Any] = {"user_id": uid}
            if since_iso:
                q["created_at"] = {"$gte": since_iso}
            return await db.bank_deposits.find(q, {"_id": 0}).sort("created_at", -1).limit(per_source).to_list(per_source)

        async def _fetch_mdg_gambling():
            # created_at may be datetime or legacy string — filter with _passes_since after fetch
            q: Dict[str, Any] = {"user_id": uid, "game_type": "mdg"}
            return await db.gambling_log.find(q, {"_id": 0}).sort("created_at", -1).limit(per_source).to_list(per_source)

        ple_types = (
            "casino_mdg",
            "quicktrade_buy",
            "quicktrade_sell",
            "quicktrade_create",
            "quicktrade_cancel",
            "quicktrade_property",
            "quicktrade_item_shop",
            "buy_game_pass_points",
            "spend_store",
        )

        async def _fetch_ple():
            q: Dict[str, Any] = {"user_id": uid, "event_type": {"$in": list(ple_types)}}
            if since_iso:
                q["created_at"] = {"$gte": since_iso}
            return await db.point_ledger_events.find(q, {"_id": 0}).sort("created_at", -1).limit(per_source).to_list(per_source)

        money_rows, points_rows, dep_rows, mdg_rows, ple_rows = await asyncio.gather(
            _fetch_money(),
            _fetch_points(),
            _fetch_deposits(),
            _fetch_mdg_gambling(),
            _fetch_ple(),
        )

        merged: List[Dict[str, Any]] = []

        for doc in money_rows:
            if not _passes_since(doc.get("created_at")):
                continue
            amt = int(doc.get("amount") or 0)
            is_sender = doc.get("from_user_id") == uid
            other = (doc.get("to_username") if is_sender else doc.get("from_username")) or "?"
            merged.append(
                {
                    "id": str(doc.get("id") or ""),
                    "source": "cash_transfer",
                    "kind_label": "Cash",
                    "created_at": _iso(doc.get("created_at")),
                    "created_ts": _row_ts(doc.get("created_at")),
                    "title": "Cash sent" if is_sender else "Cash received",
                    "summary": f"${amt:,} {'to' if is_sender else 'from'} {other}",
                    "cash_delta": -amt if is_sender else amt,
                    "points_delta": None,
                    "wallet_cash_before": (doc.get("sender_money_before") if is_sender else doc.get("recipient_money_before")),
                    "wallet_cash_after": (doc.get("sender_money_after") if is_sender else doc.get("recipient_money_after")),
                    "wallet_points_before": None,
                    "wallet_points_after": None,
                    "counterparty": other,
                    "raw": doc,
                }
            )

        for doc in points_rows:
            if not _passes_since(doc.get("created_at")):
                continue
            amt = int(doc.get("amount") or 0)
            is_sender = doc.get("from_user_id") == uid
            other = (doc.get("to_username") if is_sender else doc.get("from_username")) or "?"
            merged.append(
                {
                    "id": str(doc.get("id") or ""),
                    "source": "points_transfer",
                    "kind_label": "Points",
                    "created_at": _iso(doc.get("created_at")),
                    "created_ts": _row_ts(doc.get("created_at")),
                    "title": "Points sent" if is_sender else "Points received",
                    "summary": f"{amt:,} pts {'to' if is_sender else 'from'} {other}",
                    "cash_delta": None,
                    "points_delta": -amt if is_sender else amt,
                    "wallet_cash_before": None,
                    "wallet_cash_after": None,
                    "wallet_points_before": (doc.get("sender_points_before") if is_sender else doc.get("recipient_points_before")),
                    "wallet_points_after": (doc.get("sender_points_after") if is_sender else doc.get("recipient_points_after")),
                    "counterparty": other,
                    "raw": doc,
                }
            )

        for doc in dep_rows:
            if not _passes_since(doc.get("created_at")):
                continue
            principal = int(doc.get("principal") or 0)
            interest_amt = int(doc.get("interest_amount") or 0)
            hours = int(doc.get("duration_hours") or 0)
            dep_id = str(doc.get("id") or "")
            merged.append(
                {
                    "id": f"bd-open-{dep_id}",
                    "source": "bank_interest",
                    "kind_label": "Bank",
                    "created_at": _iso(doc.get("created_at")),
                    "created_ts": _row_ts(doc.get("created_at")),
                    "title": "Interest deposit opened",
                    "summary": f"Locked ${principal:,} principal · est. +${interest_amt:,} interest · {hours}h",
                    "cash_delta": -principal,
                    "points_delta": None,
                    "wallet_cash_before": None,
                    "wallet_cash_after": None,
                    "wallet_points_before": None,
                    "wallet_points_after": None,
                    "counterparty": None,
                    "raw": doc,
                }
            )
            claimed = doc.get("claimed_at")
            if claimed and _passes_since(claimed):
                total = principal + interest_amt
                merged.append(
                    {
                        "id": f"bd-claim-{dep_id}",
                        "source": "bank_interest",
                        "kind_label": "Bank",
                        "created_at": _iso(claimed),
                        "created_ts": _row_ts(claimed),
                        "title": "Interest deposit claimed",
                        "summary": f"Returned ${principal:,} + ${interest_amt:,} interest = ${total:,}",
                        "cash_delta": total,
                        "points_delta": None,
                        "wallet_cash_before": None,
                        "wallet_cash_after": None,
                        "wallet_points_before": None,
                        "wallet_points_after": None,
                        "counterparty": None,
                        "raw": doc,
                    }
                )

        for row in mdg_rows:
            if not _passes_since(row.get("created_at")):
                continue
            d = row.get("details") if isinstance(row.get("details"), dict) else {}
            act = str(d.get("action") or "").lower()
            game_id = str(d.get("game_id") or "")
            fee_pts = int(d.get("fee_points") or 0)
            fee_money = float(d.get("fee_money") or 0)
            extra_pts = int(d.get("extra_pot_points") or 0)
            extra_money = float(d.get("extra_pot_money") or 0)
            pot_pts = int(d.get("pot_points") or 0)
            pot_money = float(d.get("pot_money") or 0)
            trig = str(d.get("trigger") or "")
            if act == "create":
                sm = (
                    f"Created MDG game {game_id}: fee {fee_pts:,} pts + ${fee_money:,.0f} cash"
                    + (f"; extra pot {extra_pts:,} pts + ${extra_money:,.0f}" if (extra_pts or extra_money) else "")
                    + "."
                )
            elif act == "join":
                sm = f"Joined MDG {game_id}: paid {fee_pts:,} pts + ${fee_money:,.0f} cash. Players after: {d.get('players_after', '?')}."
            elif act == "payout":
                sm = (
                    f"MDG payout {game_id}: pot {pot_pts:,} pts + ${pot_money:,.0f} cash"
                    + (f" ({trig})" if trig else "")
                    + "."
                )
            else:
                sm = f"MDG {act or 'event'} {game_id}".strip()
            stake = int(d.get("stake") or d.get("bet") or d.get("buy_in") or 0)
            payout = int(d.get("payout") or d.get("winnings") or 0)
            if act == "create":
                pts_d = -(fee_pts + extra_pts)
                cash_d = -int(round(fee_money + extra_money))
            elif act == "join":
                pts_d = -fee_pts
                cash_d = -int(round(fee_money)) if fee_money else None
            elif act == "payout":
                pts_d = pot_pts
                cash_d = int(round(pot_money))
            else:
                pts_d = None
                cash_d = None
            merged.append(
                {
                    "id": str(row.get("id") or ""),
                    "source": "mdg",
                    "kind_label": "MDG",
                    "created_at": _iso(row.get("created_at")),
                    "created_ts": _row_ts(row.get("created_at")),
                    "title": f"MDG · {act or 'event'}",
                    "summary": sm,
                    "cash_delta": cash_d,
                    "points_delta": pts_d,
                    "wallet_cash_before": None,
                    "wallet_cash_after": None,
                    "wallet_points_before": None,
                    "wallet_points_after": None,
                    "counterparty": game_id or None,
                    "raw": {"gambling_log": row, "stake": stake, "payout": payout},
                }
            )

        for doc in ple_rows:
            if not _passes_since(doc.get("created_at")):
                continue
            et = str(doc.get("event_type") or "")
            pts = int(doc.get("points") or 0)
            meta = doc.get("meta") if isinstance(doc.get("meta"), dict) else {}
            merged.append(
                {
                    "id": str(doc.get("id") or ""),
                    "source": "point_ledger",
                    "kind_label": "Points",
                    "created_at": _iso(doc.get("created_at")),
                    "created_ts": _row_ts(doc.get("created_at")),
                    "title": et,
                    "summary": f"{pts:+,} pts · {doc.get('origin_ref') or '—'}" + (f" · {meta.get('action')}" if meta.get("action") else ""),
                    "cash_delta": None,
                    "points_delta": pts,
                    "wallet_cash_before": None,
                    "wallet_cash_after": None,
                    "wallet_points_before": doc.get("wallet_points_before"),
                    "wallet_points_after": doc.get("wallet_points_after"),
                    "counterparty": str(meta.get("to_username") or meta.get("offer_id") or "") or None,
                    "raw": doc,
                }
            )

        merged.sort(key=lambda x: float(x.get("created_ts") or 0), reverse=True)
        mdg_game_ids = _wallet_mdg_collect_game_ids_from_merged(merged)
        games_by_id: Dict[str, Any] = {}
        if mdg_game_ids:
            game_docs = await db.mdg_games.find({"id": {"$in": mdg_game_ids[:300]}}, {"_id": 0}).to_list(300)
            games_by_id = {str(g.get("id")): g for g in game_docs if g.get("id")}
        _wallet_mdg_collapse_ledger_pairs(merged, uid)
        _wallet_mdg_enrich_merged_entries(merged, uid, games_by_id)
        kind_lc = (kind or "all").strip().lower()
        allowed_kinds = {"all", "cash_transfer", "points_transfer", "bank_interest", "mdg", "point_ledger"}
        if kind_lc not in allowed_kinds:
            kind_lc = "all"
        if kind_lc != "all":
            merged = [e for e in merged if str(e.get("source") or "") == kind_lc]
        merged = merged[:cap]
        for e in merged:
            e.pop("created_ts", None)

        return {
            "user": {
                "id": uid,
                "username": user.get("username"),
                "money_current": int(user.get("money") or 0),
                "points_current": int(user.get("points") or 0),
            },
            "entries": merged,
            "count": len(merged),
            "applied_filters": {"username": key, "kind": kind_lc, "since": since_raw or None, "limit": cap},
        }

    @router.get("/admin/stock/logs")
    async def admin_stock_logs(
        username: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=1000),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/moderator only. Return stock_transactions for a user (buys, sells, shorts, covers).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        key = (username or "").strip()
        user = await db.users.find_one({"id": key}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            pattern = re.compile("^" + re.escape(key) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        cursor = db.stock_transactions.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).limit(limit)
        docs = await cursor.to_list(limit)
        return {"username": user.get("username"), "logs": docs}

    @router.post("/admin/gambling-log/clear")
    async def admin_gambling_log_clear(
        days: int = 30,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if days < 1:
            days = 1
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        res = await db.gambling_log.delete_many({"created_at": {"$lt": cutoff}})
        return {"message": f"Cleared {res.deleted_count} gambling log entries older than {days} days", "deleted_count": res.deleted_count}

    @router.get("/admin/find-duplicates")
    async def admin_find_duplicates(username: str = None, current_user: dict = Depends(get_current_user)):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        if username:
            pattern = re.compile(f".*{re.escape(username)}.*", re.IGNORECASE)
            users = await db.users.find(
                cheat_detection_find_duplicates_username_match(pattern),
                {"_id": 0, "id": 1, "username": 1, "email": 1, "total_kills": 1, "money": 1, "rank_points": 1, "current_state": 1, "created_at": 1, "is_dead": 1}
            ).to_list(50)
            return {"query": username, "count": len(users), "users": users}
        pipeline = [
            {"$match": cheat_detection_aggregate_first_match()},
            {"$group": {"_id": {"$toLower": "$username"}, "count": {"$sum": 1}, "users": {"$push": {"id": "$id", "username": "$username", "email": "$email", "total_kills": "$total_kills", "money": "$money", "created_at": "$created_at"}}}},
            {"$match": {"count": {"$gt": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 20}
        ]
        duplicates = await db.users.aggregate(pipeline).to_list(20)
        return {"duplicates": duplicates}

    @router.get("/admin/cheat-detection/same-ip")
    async def admin_cheat_same_ip(current_user: dict = Depends(get_current_user)):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        users = await db.users.find(
            cheat_detection_users_match(),
            {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "login_ips": 1, "last_login_ip": 1, "last_request_ip": 1, "created_at": 1},
        ).to_list(5000)
        ip_to_users = {}
        for u in users:
            summary = {"id": u["id"], "username": u.get("username"), "email": u.get("email"), "created_at": u.get("created_at")}
            reg_ip = (u.get("registration_ip") or "").strip()
            if reg_ip:
                ip_to_users.setdefault(reg_ip, []).append({**summary, "source": "registration"})
            for lip in (u.get("login_ips") or []):
                lip = (lip or "").strip()
                if lip and lip != reg_ip:
                    ip_to_users.setdefault(lip, []).append({**summary, "source": "login"})
            req_ip = (u.get("last_request_ip") or "").strip()
            if req_ip and req_ip != reg_ip and req_ip not in (u.get("login_ips") or []):
                ip_to_users.setdefault(req_ip, []).append({**summary, "source": "request"})
        groups = []
        for ip, accs in ip_to_users.items():
            if len(accs) < 2:
                continue
            sources = set(a.get("source") for a in accs)
            if "registration" in sources and ("login" in sources or "request" in sources):
                label = "registration_and_activity"
                risk = "high"
            elif "registration" in sources:
                label = "registration_only"
                risk = "medium"
            else:
                label = "activity_only"
                risk = "low"
            groups.append({"ip": ip, "count": len(accs), "accounts": accs, "label": label, "risk": risk})
        groups.sort(key=lambda g: (0 if g["risk"] == "high" else 1 if g["risk"] == "medium" else 2, -g["count"]))
        return {"groups": groups[:100], "total_groups": len(groups)}

    @router.get("/admin/cheat-detection/login-attempts")
    async def admin_cheat_login_attempts(
        limit: int = Query(200, ge=1, le=1000),
        since: Optional[str] = Query(None, description="ISO date or datetime; only events at or after this time"),
        ip: Optional[str] = Query(None, description="Filter by attempt IP"),
        username: Optional[str] = Query(None, description="Filter by username or login_input contains"),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Suspicious login attempts: wrong password or unknown account
        from an IP that already has at least one other alive account.
        Admin or moderator.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        q = {}
        if since and since.strip():
            q["at"] = {"$gte": since.strip()}
        if ip and ip.strip():
            q["ip"] = ip.strip()
        if username and username.strip():
            pattern = re.compile(re.escape(username.strip()), re.IGNORECASE)
            q["$or"] = [
                {"username": pattern},
                {"login_input": pattern},
            ]
        cursor = (
            db.suspicious_logins.find(q, {"_id": 0})
            .sort("at", -1)
            .limit(limit)
        )
        events = await cursor.to_list(limit)
        return {"events": events}

    @router.get("/admin/cheat-detection/duplicate-suspects")
    async def admin_cheat_duplicate_suspects(
        username: str = Query(None, description="Optional: filter by username contains"),
        limit_domain: int = Query(50, ge=1, le=200),
        limit_username: int = Query(50, ge=1, le=200),
        include_fuzzy: bool = Query(True, description="Include fuzzy username matching"),
        current_user: dict = Depends(get_current_user),
    ):
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        extra_dup: dict = {}
        if username and username.strip():
            extra_dup["username"] = re.compile(re.escape(username.strip()), re.IGNORECASE)
        users = await db.users.find(
            cheat_detection_users_match(extra_dup if extra_dup else None),
            {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "created_at": 1},
        ).to_list(2000)
        domain_groups = group_by_domain(users)
        name_groups = group_by_similar_username_strip_digits(users)
        similar_email_groups = group_by_similar_email(users)
        same_day_ip_groups = group_by_same_day_same_ip(users)
        fuzzy_groups = group_by_fuzzy_username(users) if include_fuzzy else []
        for g in domain_groups:
            g["risk_score"] = compute_dupe_risk_score("domain", g["count"])
        for g in name_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_username", g["count"])
        for g in similar_email_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_email", g["count"])
        for g in same_day_ip_groups:
            g["risk_score"] = compute_dupe_risk_score("same_day_ip", g["count"])
        for g in fuzzy_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_username", g["count"])
        return {
            "by_domain": domain_groups[:limit_domain],
            "by_similar_username": name_groups[:limit_username],
            "by_similar_email": similar_email_groups[:limit_domain],
            "by_same_day_same_ip": same_day_ip_groups[:30],
            "by_fuzzy_username": fuzzy_groups[:30],
        }

    @router.get("/admin/cheat-detection/dupe-check-intelligent")
    async def admin_cheat_dupe_check_intelligent(
        username: str = Query(None, description="Optional: filter by username contains"),
        check_vpn: bool = Query(True, description="Check shared IPs for VPN/proxy (rate-limited)"),
        max_vpn_checks: int = Query(50, ge=0, le=100),
        include_dead_ip: bool = Query(True, description="Alive vs dead accounts sharing an IP"),
        include_dead_fingerprint: bool = Query(True, description="Alive vs dead sharing device_fingerprint"),
        suspicious_days: int = Query(30, ge=1, le=365, description="Window for suspicious_logins aggregation"),
        suspicious_limit: int = Query(3000, ge=100, le=8000, description="Max suspicious_logins docs to scan"),
        transfer_days: int = Query(14, ge=1, le=90, description="Window for heavy money_transfers"),
        transfer_min_count: int = Query(3, ge=2, le=50, description="Min transfers per ordered pair"),
        transfer_limit: int = Query(50, ge=1, le=150),
        registration_burst_hours: float = Query(2.0, ge=0.5, le=24, description="Registration burst time bucket (hours)"),
        include_session_ips: bool = Query(True, description="Include JWT session IPs in IP union"),
        include_prereg_cross: bool = Query(True, description="Prereg IP overlapping other accounts"),
        include_security_flags: bool = Query(True, description="Unresolved security_flags for batch users"),
        include_password_resets: bool = Query(True, description="Frequent password reset requests"),
        flags_days: int = Query(30, ge=1, le=365),
        password_reset_days: int = Query(7, ge=1, le=90),
        password_reset_min: int = Query(3, ge=2, le=30),
        cadence_days: int = Query(7, ge=1, le=30, description="Window for automation cadence analysis"),
        cadence_limit: int = Query(4000, ge=500, le=12000, description="Max activity/security docs to scan for cadence"),
        session_overlap_hours: int = Query(8, ge=1, le=48, description="Recent session overlap window in hours"),
        referral_min_accounts: int = Query(3, ge=2, le=20, description="Min referees for referral abuse grouping"),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Single report: same IP (full IP history), same user-agent, device fingerprint,
        same subnet, domain/similar-username/fuzzy-username/similar-email/same-day-same-IP,
        risk scores, optional VPN/proxy flags, alive/dead overlap, suspicious-login hotspots,
        registration bursts, referral+IP, heavy transfers, and optional wave-2 signals.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        def _ip_network_type(ip: str) -> str:
            meta = ip_meta.get(ip) or {}
            if ip_vpn.get(ip):
                return "vpn_or_proxy"
            if bool(meta.get("proxy")):
                return "vpn_or_proxy"
            if bool(meta.get("hosting")):
                return "datacenter_or_hosting"
            if meta.get("isp") or meta.get("org") or meta.get("as"):
                return "consumer_paid_isp"
            return "unknown"

        def _confidence_from_evidence(evidence_count: int) -> str:
            if evidence_count >= 3:
                return "high"
            if evidence_count >= 2:
                return "medium"
            return "low"

        def _confidence_rank(conf: str) -> int:
            if conf == "high":
                return 3
            if conf == "medium":
                return 2
            return 1

        def _all_ips(u: dict) -> Tuple[List[str], dict]:
            return user_ip_union(u, include_session_ips=include_session_ips)

        extra_intel: dict = {}
        if username and username.strip():
            extra_intel["username"] = re.compile(re.escape(username.strip()), re.IGNORECASE)
        query = cheat_detection_users_match(extra_intel if extra_intel else None)
        proj = {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "registration_ip": 1,
            "login_ips": 1,
            "last_login_ip": 1,
            "last_request_ip": 1,
            "last_user_agent": 1,
            "device_fingerprint": 1,
            "created_at": 1,
            "referred_by": 1,
            "sessions": 1,
        }
        users = await db.users.find(query, proj).to_list(5000)

        ip_to_accounts = {}
        for u in users:
            ips, sources = _all_ips(u)
            if not ips:
                continue
            summary = {
                "id": u["id"],
                "username": u.get("username"),
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                "all_ips": ips,
                "sources": sources,
            }
            for ip in ips:
                if sources.get("registration") == ip:
                    role = "registration"
                elif ip in (sources.get("login_ips") or []):
                    role = "login"
                elif ip in (sources.get("session_ips") or []):
                    role = "session"
                else:
                    role = "request"
                ip_to_accounts.setdefault(ip, []).append({**summary, "role_at_this_ip": role})
        same_ip_groups = []
        seen_ip = set()
        for ip, accs in ip_to_accounts.items():
            if len(accs) < 2 or ip in seen_ip:
                continue
            seen_ip.add(ip)
            by_user = {}
            for a in accs:
                uid = a.get("id")
                if uid not in by_user:
                    by_user[uid] = {
                        "id": a["id"],
                        "username": a["username"],
                        "email": a["email"],
                        "created_at": a["created_at"],
                        "all_ips": a["all_ips"],
                        "sources": a["sources"],
                        "role_at_this_ip": a.get("role_at_this_ip"),
                    }
            has_reg = any(a.get("sources", {}).get("registration") == ip for a in accs) and len(by_user) >= 2
            risk = "high" if has_reg else "medium"
            risk_score = compute_dupe_risk_score("same_ip", len(by_user), has_registration_ip=has_reg)
            evidence_reasons = ["shared_ip"]
            evidence_count = 1
            if has_reg:
                evidence_count += 1
                evidence_reasons.append("shared_registration_ip")
            same_ip_groups.append({
                "ip": ip,
                "count": len(by_user),
                "accounts": list(by_user.values()),
                "risk": risk,
                "risk_score": risk_score,
                "evidence_count": evidence_count,
                "evidence_reasons": evidence_reasons,
                "confidence": _confidence_from_evidence(evidence_count),
            })
        same_ip_groups.sort(key=lambda g: (-_confidence_rank(g.get("confidence", "low")), -g["risk_score"], -g["count"]))

        same_subnet_groups = group_by_same_subnet(users, include_session_ips=include_session_ips)

        fp_to_users = {}
        for u in users:
            fp = (u.get("device_fingerprint") or "").strip()
            if not fp:
                continue
            ips, _ = _all_ips(u)
            fp_to_users.setdefault(fp, []).append({
                "id": u["id"],
                "username": u.get("username"),
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                "all_ips": ips,
            })
        same_fingerprint_groups = []
        for fp, accs in fp_to_users.items():
            if len(accs) < 2:
                continue
            all_ips = set()
            for a in accs:
                all_ips.update(a.get("all_ips") or [])
            same_fingerprint_groups.append({
                "device_fingerprint": fp[:32] + ("..." if len(fp) > 32 else ""),
                "account_count": len(accs),
                "distinct_ip_count": len(all_ips),
                "accounts": accs,
                "risk_score": compute_dupe_risk_score("same_ua", len(accs), has_same_device=True),
                "evidence_count": 2 if len(all_ips) >= 2 else 1,
                "evidence_reasons": ["shared_fingerprint"] + (["multiple_ips"] if len(all_ips) >= 2 else []),
                "confidence": _confidence_from_evidence(2 if len(all_ips) >= 2 else 1),
            })
        same_fingerprint_groups.sort(key=lambda g: (-_confidence_rank(g.get("confidence", "low")), -g["risk_score"], -g["account_count"]))

        ua_to_users = {}
        ua_raw_sample = {}
        for u in users:
            ua_raw = (u.get("last_user_agent") or "").strip()
            if not ua_raw:
                continue
            ua_norm = re.sub(r"/\d+[\d.]*", "", ua_raw) or ua_raw
            if ua_norm not in ua_raw_sample:
                ua_raw_sample[ua_norm] = ua_raw
            ips, _ = _all_ips(u)
            ua_to_users.setdefault(ua_norm, []).append({
                "id": u["id"],
                "username": u.get("username"),
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                "all_ips": ips,
            })
        same_ua_groups = []
        for ua_norm, accs in ua_to_users.items():
            if len(accs) < 2:
                continue
            all_ips = set()
            for a in accs:
                all_ips.update(a.get("all_ips") or [])
            if len(all_ips) < 2:
                continue
            sample_raw = ua_raw_sample.get(ua_norm, ua_norm)
            risk_score = compute_dupe_risk_score("same_ua", len(accs), has_same_device=True)
            same_ua_groups.append({
                "user_agent": ua_norm[:120] + ("..." if len(ua_norm) > 120 else ""),
                "user_agent_full": sample_raw[:200] + ("..." if len(sample_raw) > 200 else ""),
                "account_count": len(accs),
                "distinct_ip_count": len(all_ips),
                "accounts": accs,
                "risk_score": risk_score,
                "evidence_count": 2,
                "evidence_reasons": ["shared_user_agent", "multiple_ips"],
                "confidence": _confidence_from_evidence(2),
            })
        same_ua_groups.sort(key=lambda g: (-_confidence_rank(g.get("confidence", "low")), -g["risk_score"], -g["account_count"]))

        domain_groups = group_by_domain(users)
        name_groups = group_by_similar_username_strip_digits(users)
        fuzzy_groups = group_by_fuzzy_username(users)
        similar_email_groups = group_by_similar_email(users)
        same_day_ip_groups = group_by_same_day_same_ip(users)
        for g in domain_groups:
            g["risk_score"] = compute_dupe_risk_score("domain", g["count"])
        for g in name_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_username", g["count"])
        for g in fuzzy_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_username", g["count"])
        for g in similar_email_groups:
            g["risk_score"] = compute_dupe_risk_score("similar_email", g["count"])
        for g in same_day_ip_groups:
            g["risk_score"] = compute_dupe_risk_score("same_day_ip", g["count"])

        registration_burst_groups = group_by_registration_ip_burst(users, max_hours=registration_burst_hours)
        for g in registration_burst_groups:
            g["risk_score"] = compute_dupe_risk_score("registration_burst", g["count"])
        referral_same_ip_groups = group_by_referral_same_ip(users)
        id_to_user = {u["id"]: u for u in users}
        need_ref_ids = {g["referred_by"] for g in referral_same_ip_groups if g.get("referred_by") and g["referred_by"] not in id_to_user}
        ref_username_map: Dict[str, str] = {}
        if need_ref_ids:
            ref_docs = await db.users.find(
                {"id": {"$in": list(need_ref_ids)}},
                {"_id": 0, "id": 1, "username": 1},
            ).to_list(len(need_ref_ids))
            ref_username_map = {r["id"]: (r.get("username") or "") for r in ref_docs}
        for g in referral_same_ip_groups:
            rid = g.get("referred_by")
            g["referred_by_username"] = (id_to_user.get(rid) or {}).get("username") or ref_username_map.get(rid) or None
            g["risk_score"] = compute_dupe_risk_score("referral_same_ip", g["count"])

        ip_vpn: Dict[str, bool] = {}
        ip_meta: Dict[str, dict] = {}
        if check_vpn and same_ip_groups:
            unique_ips = set()
            for g in same_ip_groups:
                unique_ips.add(g["ip"])
            to_check = list(unique_ips)[:max_vpn_checks]
            for ip in to_check:
                try:
                    ip_vpn[ip] = await is_proxy_or_vpn(ip)
                except Exception:
                    ip_vpn[ip] = False
                try:
                    ip_meta[ip] = await get_ip_info(ip)
                except Exception:
                    ip_meta[ip] = {}
                await asyncio.sleep(0.15)
        for g in same_ip_groups:
            ip = g.get("ip")
            meta = ip_meta.get(ip) or {}
            network_type = _ip_network_type(ip)
            g["ip_vpn"] = ip_vpn.get(ip, False)
            g["ip_network_type"] = network_type
            g["ip_isp"] = meta.get("isp") or None
            g["ip_org"] = meta.get("org") or None
            g["ip_as"] = meta.get("as") or None
            g["ip_proxy"] = bool(meta.get("proxy"))
            g["ip_hosting"] = bool(meta.get("hosting"))
            if network_type in ("vpn_or_proxy", "datacenter_or_hosting"):
                g["evidence_count"] = int(g.get("evidence_count") or 0) + 1
                reasons = list(g.get("evidence_reasons") or [])
                reasons.append("ip_reputation_strong")
                g["evidence_reasons"] = sorted(set(reasons))
                g["confidence"] = _confidence_from_evidence(g["evidence_count"])
                g["ip_accuracy_note"] = "Strong IP evidence (VPN/proxy or hosting/datacenter)."
            elif network_type == "consumer_paid_isp":
                g["ip_accuracy_note"] = "Likely paid/residential ISP; shared IP alone may be weaker evidence (CGNAT/mobile risk)."
                if not any(a.get("role_at_this_ip") == "registration" for a in (g.get("accounts") or [])):
                    g["risk_score"] = max(0, int(g.get("risk_score") or 0) - 5)
            else:
                g["ip_accuracy_note"] = "IP intelligence unavailable; treat as neutral."
            if g.get("ip_vpn"):
                g["risk_score"] = min(100, g["risk_score"] + 10)
            g["risk_score"] = min(100, max(0, int(g.get("risk_score") or 0)))
        same_ip_groups.sort(key=lambda g: (-_confidence_rank(g.get("confidence", "low")), -g["risk_score"], -g["count"]))

        # Proxy/VPN users: users whose IPs are detected as VPN/proxy (beyond same_ip_groups)
        proxy_users_list: List[dict] = []
        if check_vpn:
            all_unique_ips = set()
            for u in users:
                ips, _ = _all_ips(u)
                all_unique_ips.update(ips)
            ips_to_check = [ip for ip in all_unique_ips if ip not in ip_vpn][:max_vpn_checks]
            for ip in ips_to_check:
                try:
                    ip_vpn[ip] = await is_proxy_or_vpn(ip)
                except Exception:
                    ip_vpn[ip] = False
                await asyncio.sleep(0.15)
            vpn_ips = {ip for ip, v in ip_vpn.items() if v}
            seen_proxy_ids = set()
            for u in users:
                ips, sources = _all_ips(u)
                vpn_used = [ip for ip in ips if ip in vpn_ips]
                if vpn_used and u.get("id") not in seen_proxy_ids:
                    seen_proxy_ids.add(u["id"])
                    proxy_users_list.append({
                        "id": u["id"],
                        "username": u.get("username"),
                        "email": u.get("email"),
                        "created_at": u.get("created_at"),
                        "vpn_ips": vpn_used,
                        "registration_from_vpn": bool(sources.get("registration") and sources["registration"] in vpn_ips),
                    })
        proxy_users_list.sort(key=lambda x: (-int(x.get("registration_from_vpn", False)), x.get("created_at") or ""))

        now_utc = datetime.now(timezone.utc)
        user_ids = [u["id"] for u in users]
        living_ip_set: Set[str] = set()
        for u in users:
            ips, _ = _all_ips(u)
            living_ip_set.update(ips)

        alive_dead_ip_groups: List[dict] = []
        if include_dead_ip and living_ip_set:
            dead_pair_seen: Set[Tuple[str, str]] = set()
            dead_by_ip: Dict[str, List[dict]] = defaultdict(list)
            ip_list = sorted(living_ip_set)
            for i in range(0, len(ip_list), 400):
                chunk = ip_list[i : i + 400]
                dead_docs = await db.users.find(
                    {
                        "is_dead": True,
                        "is_npc": {"$ne": True},
                        "$or": [{"registration_ip": {"$in": chunk}}, {"login_ips": {"$in": chunk}}],
                    },
                    {"_id": 0, "id": 1, "username": 1, "registration_ip": 1, "login_ips": 1, "dead_at": 1, "created_at": 1},
                ).to_list(2500)
                for d in dead_docs:
                    d_ips: Set[str] = set()
                    ri = (d.get("registration_ip") or "").strip()
                    if ri:
                        d_ips.add(ri)
                    for x in d.get("login_ips") or []:
                        xs = (x or "").strip()
                        if xs:
                            d_ips.add(xs)
                    for ip in d_ips:
                        if ip not in living_ip_set:
                            continue
                        key = (ip, d["id"])
                        if key in dead_pair_seen:
                            continue
                        dead_pair_seen.add(key)
                        dead_by_ip[ip].append({
                            "id": d["id"],
                            "username": d.get("username"),
                            "dead_at": d.get("dead_at"),
                            "created_at": d.get("created_at"),
                        })
            for ip, dead_accs in dead_by_ip.items():
                raw_alive = ip_to_accounts.get(ip) or []
                by_aid = {}
                for a in raw_alive:
                    uid = a.get("id")
                    if uid and uid not in by_aid:
                        by_aid[uid] = {
                            "id": a["id"],
                            "username": a["username"],
                            "email": a["email"],
                            "created_at": a["created_at"],
                            "all_ips": a["all_ips"],
                            "role_at_this_ip": a.get("role_at_this_ip"),
                        }
                alive_accs = list(by_aid.values())
                if len(alive_accs) < 1 or len(dead_accs) < 1:
                    continue
                n = len(alive_accs) + len(dead_accs)
                alive_dead_ip_groups.append({
                    "ip": ip,
                    "alive_accounts": alive_accs,
                    "dead_accounts": dead_accs[:25],
                    "alive_count": len(alive_accs),
                    "dead_count": len(dead_accs),
                    "risk_score": compute_dupe_risk_score("dead_ip_overlap", n),
                })
            alive_dead_ip_groups.sort(key=lambda g: (-g["risk_score"], -g["alive_count"], -g["dead_count"]))

        susp_cut = (now_utc - timedelta(days=suspicious_days)).isoformat()
        sl_docs = await db.suspicious_logins.find(
            {"at": {"$gte": susp_cut}},
            {"_id": 0, "ip": 1, "at": 1, "reason": 1, "login_input": 1, "username": 1, "user_id": 1},
        ).sort("at", -1).limit(suspicious_limit).to_list(suspicious_limit)
        high_reasons = frozenset({"no_account_same_ip_alive", "wrong_password_same_ip_other_alive"})
        ip_events: Dict[str, List[dict]] = defaultdict(list)
        for doc in sl_docs:
            sip = (doc.get("ip") or "").strip()
            if sip:
                ip_events[sip].append(doc)
        suspicious_ip_correlations: List[dict] = []
        for sip, events in ip_events.items():
            if len(events) < 2 and not any(e.get("reason") in high_reasons for e in events):
                continue
            raw_alive = ip_to_accounts.get(sip) or []
            by_aid = {}
            for a in raw_alive:
                uid = a.get("id")
                if uid and uid not in by_aid:
                    by_aid[uid] = {
                        "id": a["id"],
                        "username": a["username"],
                        "email": a["email"],
                        "created_at": a["created_at"],
                        "all_ips": a["all_ips"],
                        "role_at_this_ip": a.get("role_at_this_ip"),
                    }
            alive_accs = list(by_aid.values())
            if not alive_accs:
                continue
            sample = events[:8]
            suspicious_ip_correlations.append({
                "ip": sip,
                "event_count": len(events),
                "sample_events": [
                    {"at": e.get("at"), "reason": e.get("reason"), "login_input": e.get("login_input"), "username": e.get("username")}
                    for e in sample
                ],
                "correlated_alive_accounts": alive_accs[:12],
                "risk_score": compute_dupe_risk_score("suspicious_ip", len(events)),
            })
        suspicious_ip_correlations.sort(key=lambda g: (-g["risk_score"], -g["event_count"]))

        uid_ips: Dict[str, Set[str]] = {}
        for u in users:
            ips, _ = _all_ips(u)
            uid_ips[u["id"]] = set(ips)

        transfer_cut = (now_utc - timedelta(days=transfer_days)).isoformat()
        xfer_pipe = [
            {"$match": {"created_at": {"$gte": transfer_cut}}},
            {"$group": {"_id": {"from": "$from_user_id", "to": "$to_user_id"}, "transfer_count": {"$sum": 1}}},
            {"$match": {"transfer_count": {"$gte": transfer_min_count}}},
            {"$sort": {"transfer_count": -1}},
            {"$limit": transfer_limit},
        ]
        xfer_agg = await db.money_transfers.aggregate(xfer_pipe).to_list(transfer_limit)
        heavy_transfer_pairs: List[dict] = []
        for row in xfer_agg:
            ids = row.get("_id") or {}
            fid = ids.get("from")
            tid = ids.get("to")
            if not fid or not tid or fid == tid:
                continue
            cnt = int(row.get("transfer_count") or 0)
            s1 = uid_ips.get(fid, set())
            s2 = uid_ips.get(tid, set())
            overlap = sorted(s1 & s2)[:15]
            u1 = id_to_user.get(fid) or {}
            u2 = id_to_user.get(tid) or {}
            heavy_transfer_pairs.append({
                "from_user_id": fid,
                "to_user_id": tid,
                "from_username": u1.get("username"),
                "to_username": u2.get("username"),
                "transfer_count": cnt,
                "shared_ips": overlap,
                "shared_ip_count": len(s1 & s2),
                "risk_score": compute_dupe_risk_score("heavy_transfers", cnt),
            })

        transfer_ring_groups: List[dict] = []
        edge_count: Dict[Tuple[str, str], int] = {}
        next_nodes: Dict[str, Set[str]] = defaultdict(set)
        for row in xfer_agg:
            ids = row.get("_id") or {}
            fid = ids.get("from")
            tid = ids.get("to")
            if not fid or not tid or fid == tid:
                continue
            cnt = int(row.get("transfer_count") or 0)
            if cnt <= 0:
                continue
            edge_count[(fid, tid)] = cnt
            next_nodes[fid].add(tid)
        seen_cycles: Set[Tuple[str, str, str]] = set()
        for a, bset in next_nodes.items():
            for b in bset:
                cset = next_nodes.get(b) or set()
                for c in cset:
                    if c == a or c == b:
                        continue
                    if a not in (next_nodes.get(c) or set()):
                        continue
                    cyc = tuple(sorted([a, b, c]))
                    if cyc in seen_cycles:
                        continue
                    seen_cycles.add(cyc)
                    members = list(cyc)
                    c1 = edge_count.get((a, b), 0)
                    c2 = edge_count.get((b, c), 0)
                    c3 = edge_count.get((c, a), 0)
                    edge_total = c1 + c2 + c3
                    shared_ip_count = len(uid_ips.get(a, set()) & uid_ips.get(b, set()) & uid_ips.get(c, set()))
                    member_rows = []
                    for uid in members:
                        u0 = id_to_user.get(uid) or {}
                        member_rows.append({"user_id": uid, "username": u0.get("username"), "email": u0.get("email")})
                    evidence_count = 1
                    evidence_reasons = ["transfer_cycle"]
                    if edge_total >= max(3, transfer_min_count * 3):
                        evidence_count += 1
                        evidence_reasons.append("high_transfer_volume")
                    if shared_ip_count > 0:
                        evidence_count += 1
                        evidence_reasons.append("shared_ip")
                    risk_score = compute_dupe_risk_score("transfer_ring", max(3, edge_total // max(1, transfer_min_count)))
                    transfer_ring_groups.append({
                        "member_count": 3,
                        "members": member_rows,
                        "edge_total": edge_total,
                        "shared_ip_count": shared_ip_count,
                        "risk_score": risk_score,
                        "evidence_count": evidence_count,
                        "evidence_reasons": evidence_reasons,
                        "confidence": _confidence_from_evidence(evidence_count),
                    })
        transfer_ring_groups.sort(key=lambda g: (-_confidence_rank(g.get("confidence", "low")), -g["risk_score"], -g["edge_total"]))

        prereg_ip_cross_accounts: List[dict] = []
        if include_prereg_cross and users:
            emails_lower = []
            for u in users:
                em = (u.get("email") or "").strip().lower()
                if em:
                    emails_lower.append(em)
            emails_lower = list(dict.fromkeys(emails_lower))
            if emails_lower:
                email_prereg_ip: Dict[str, str] = {}
                for j in range(0, len(emails_lower), 400):
                    ch = emails_lower[j : j + 400]
                    prs = await db.preregistrations.find(
                        {"email": {"$in": ch}},
                        {"_id": 0, "email": 1, "ip": 1, "created_at": 1},
                    ).to_list(800)
                    for pr in prs:
                        e = (pr.get("email") or "").strip().lower()
                        p = (pr.get("ip") or "").strip()
                        if e and p:
                            email_prereg_ip[e] = p
                ip_to_uids: Dict[str, Set[str]] = defaultdict(set)
                for u in users:
                    uid = u["id"]
                    ips, _ = _all_ips(u)
                    for ip in ips:
                        ip_to_uids[ip].add(uid)
                for u in users:
                    em = (u.get("email") or "").strip().lower()
                    if not em or em not in email_prereg_ip:
                        continue
                    pr_ip = email_prereg_ip[em]
                    others = ip_to_uids.get(pr_ip, set()) - {u["id"]}
                    if others:
                        olist = list(others)[:15]
                        prereg_ip_cross_accounts.append({
                            "user_id": u["id"],
                            "username": u.get("username"),
                            "email": em,
                            "prereg_ip": pr_ip,
                            "other_user_ids": olist,
                            "risk_score": compute_dupe_risk_score("prereg_ip_cross", 1 + len(olist)),
                        })
                prereg_ip_cross_accounts.sort(key=lambda g: (-g["risk_score"], g.get("username") or ""))

        overlapping_session_device_groups: List[dict] = []
        session_cutoff = now_utc - timedelta(hours=session_overlap_hours)
        fp_session_map: Dict[str, List[dict]] = defaultdict(list)
        for u in users:
            fp = (u.get("device_fingerprint") or "").strip()
            if not fp:
                continue
            sess = u.get("sessions") or []
            if not isinstance(sess, list) or not sess:
                continue
            for s in sess:
                if not isinstance(s, dict):
                    continue
                la = s.get("last_used_at") or s.get("created_at")
                if not la:
                    continue
                try:
                    dt = datetime.fromisoformat(str(la).replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                if dt < session_cutoff:
                    continue
                fp_session_map[fp].append({"user_id": u["id"], "username": u.get("username"), "at": dt, "ip": (s.get("ip") or "").strip()})
        for fp, rows in fp_session_map.items():
            users_seen = {}
            for r in rows:
                users_seen[r["user_id"]] = r.get("username")
            if len(users_seen) < 2:
                continue
            rows_sorted = sorted(rows, key=lambda x: x["at"])
            overlap_hits = 0
            for i in range(len(rows_sorted) - 1):
                a = rows_sorted[i]
                b = rows_sorted[i + 1]
                if a["user_id"] == b["user_id"]:
                    continue
                if (b["at"] - a["at"]).total_seconds() <= 600:
                    overlap_hits += 1
            if overlap_hits <= 0:
                continue
            member_ids = list(users_seen.keys())
            shared_ip = False
            if len(member_ids) >= 2:
                base = uid_ips.get(member_ids[0], set())
                for uid in member_ids[1:]:
                    base = base & uid_ips.get(uid, set())
                shared_ip = bool(base)
            evidence_count = 1 + (1 if overlap_hits >= 2 else 0) + (1 if shared_ip else 0)
            overlapping_session_device_groups.append({
                "device_fingerprint": fp[:32] + ("..." if len(fp) > 32 else ""),
                "account_count": len(users_seen),
                "overlap_hits": overlap_hits,
                "shared_ip": shared_ip,
                "members": [{"user_id": uid, "username": uname} for uid, uname in users_seen.items()],
                "risk_score": compute_dupe_risk_score("session_overlap_device", len(users_seen)),
                "evidence_count": evidence_count,
                "evidence_reasons": ["shared_fingerprint", "session_overlap"] + (["shared_ip"] if shared_ip else []),
                "confidence": _confidence_from_evidence(evidence_count),
            })
        overlapping_session_device_groups.sort(key=lambda g: (-_confidence_rank(g.get("confidence", "low")), -g["risk_score"], -g["overlap_hits"]))

        automation_cadence_groups: List[dict] = []
        cadence_cut = (now_utc - timedelta(days=cadence_days)).isoformat()
        act_docs = await db.activity_log.find(
            {"created_at": {"$gte": cadence_cut}},
            {"_id": 0, "user_id": 1, "username": 1, "created_at": 1, "action": 1, "endpoint": 1},
        ).sort("created_at", -1).limit(cadence_limit).to_list(cadence_limit)
        by_user_times: Dict[str, List[datetime]] = defaultdict(list)
        by_user_name: Dict[str, str] = {}
        for d in act_docs:
            uid = d.get("user_id")
            if not uid:
                continue
            if uid not in id_to_user:
                continue
            raw = d.get("created_at")
            if not raw:
                continue
            try:
                dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                continue
            by_user_times[uid].append(dt)
            by_user_name[uid] = (id_to_user.get(uid) or {}).get("username") or d.get("username")
        cadence_signature_users: Dict[int, List[str]] = defaultdict(list)
        cadence_samples: Dict[int, List[int]] = {}
        for uid, times in by_user_times.items():
            if len(times) < 8:
                continue
            ts = sorted(times)
            diffs = [int((ts[i + 1] - ts[i]).total_seconds()) for i in range(len(ts) - 1)]
            diffs = [x for x in diffs if x >= 0]
            if len(diffs) < 6:
                continue
            c = Counter(diffs)
            mode_val, mode_count = c.most_common(1)[0]
            if mode_val > 20:
                continue
            ratio = mode_count / max(1, len(diffs))
            if ratio < 0.7:
                continue
            sig = mode_val
            cadence_signature_users[sig].append(uid)
            cadence_samples[sig] = diffs[:8]
        for sig, uids in cadence_signature_users.items():
            if len(uids) < 2:
                continue
            shared_ip_any = False
            for i in range(len(uids)):
                for j in range(i + 1, len(uids)):
                    if uid_ips.get(uids[i], set()) & uid_ips.get(uids[j], set()):
                        shared_ip_any = True
                        break
                if shared_ip_any:
                    break
            if not shared_ip_any:
                continue
            evidence_count = 3
            automation_cadence_groups.append({
                "cadence_seconds": sig,
                "account_count": len(uids),
                "members": [{"user_id": uid, "username": by_user_name.get(uid) or uid} for uid in uids[:20]],
                "sample_intervals": cadence_samples.get(sig) or [],
                "risk_score": compute_dupe_risk_score("automation_cadence", len(uids)),
                "evidence_count": evidence_count,
                "evidence_reasons": ["regular_action_cadence", "multi_account_pattern", "shared_ip"],
                "confidence": _confidence_from_evidence(evidence_count),
            })
        automation_cadence_groups.sort(key=lambda g: (-_confidence_rank(g.get("confidence", "low")), -g["risk_score"], -g["account_count"]))

        referral_abuse_groups: List[dict] = []
        ref_to_refs: Dict[str, List[str]] = defaultdict(list)
        for u in users:
            uid = u.get("id")
            if not uid:
                continue
            for rid in normalize_referred_by_ids(u.get("referred_by")):
                ref_to_refs[rid].append(uid)
        for rid, refs in ref_to_refs.items():
            uniq_refs = sorted(set(refs))
            if len(uniq_refs) < referral_min_accounts:
                continue
            ref_ips = uid_ips.get(rid, set())
            shared_with_ref = sum(1 for uid in uniq_refs if ref_ips & uid_ips.get(uid, set()))
            shared_between_refs = 0
            for i in range(len(uniq_refs)):
                for j in range(i + 1, len(uniq_refs)):
                    if uid_ips.get(uniq_refs[i], set()) & uid_ips.get(uniq_refs[j], set()):
                        shared_between_refs += 1
            if shared_with_ref <= 0 and shared_between_refs <= 0:
                continue
            evidence_count = 1 + (1 if shared_with_ref > 0 else 0) + (1 if shared_between_refs > 0 else 0)
            ruser = id_to_user.get(rid) or {}
            members = []
            for uid in uniq_refs[:25]:
                u0 = id_to_user.get(uid) or {}
                members.append({"user_id": uid, "username": u0.get("username"), "email": u0.get("email")})
            referral_abuse_groups.append({
                "referrer_user_id": rid,
                "referrer_username": ruser.get("username"),
                "referee_count": len(uniq_refs),
                "shared_ip_with_referrer_count": shared_with_ref,
                "shared_ip_pairs_among_referees": shared_between_refs,
                "members": members,
                "risk_score": compute_dupe_risk_score("referral_abuse_graph", len(uniq_refs)),
                "evidence_count": evidence_count,
                "evidence_reasons": ["referral_cluster"] + (["shared_ip_with_referrer"] if shared_with_ref > 0 else []) + (["shared_ip_among_referees"] if shared_between_refs > 0 else []),
                "confidence": _confidence_from_evidence(evidence_count),
            })
        referral_abuse_groups.sort(key=lambda g: (-_confidence_rank(g.get("confidence", "low")), -g["risk_score"], -g["referee_count"]))

        alive_dead_fingerprint_groups: List[dict] = []
        if include_dead_fingerprint:
            living_fp_set: Set[str] = set()
            fp_to_living: Dict[str, List[dict]] = defaultdict(list)
            for u in users:
                fp = (u.get("device_fingerprint") or "").strip()
                if not fp:
                    continue
                living_fp_set.add(fp)
                ips, _ = _all_ips(u)
                fp_to_living[fp].append({
                    "id": u["id"],
                    "username": u.get("username"),
                    "email": u.get("email"),
                    "created_at": u.get("created_at"),
                    "all_ips": sorted(ips),
                })
            fp_list = sorted(living_fp_set)
            dead_fp_seen: Set[Tuple[str, str]] = set()
            dead_by_fp: Dict[str, List[dict]] = defaultdict(list)
            for i in range(0, len(fp_list), 200):
                chunk = fp_list[i : i + 200]
                ddocs = await db.users.find(
                    {"is_dead": True, "is_npc": {"$ne": True}, "device_fingerprint": {"$in": chunk}},
                    {"_id": 0, "id": 1, "username": 1, "device_fingerprint": 1, "dead_at": 1, "created_at": 1},
                ).to_list(1500)
                for d in ddocs:
                    fp = (d.get("device_fingerprint") or "").strip()
                    if fp not in living_fp_set:
                        continue
                    key = (fp, d["id"])
                    if key in dead_fp_seen:
                        continue
                    dead_fp_seen.add(key)
                    dead_by_fp[fp].append({
                        "id": d["id"],
                        "username": d.get("username"),
                        "dead_at": d.get("dead_at"),
                        "created_at": d.get("created_at"),
                        "device_fingerprint": fp[:24] + ("..." if len(fp) > 24 else ""),
                    })
            for fp, dead_accs in dead_by_fp.items():
                live_accs = fp_to_living.get(fp) or []
                if len(live_accs) < 1 or len(dead_accs) < 1:
                    continue
                n = len(live_accs) + len(dead_accs)
                alive_dead_fingerprint_groups.append({
                    "device_fingerprint": fp[:32] + ("..." if len(fp) > 32 else ""),
                    "alive_accounts": live_accs[:15],
                    "dead_accounts": dead_accs[:20],
                    "risk_score": compute_dupe_risk_score("dead_fingerprint_overlap", n, has_same_device=True),
                })
            alive_dead_fingerprint_groups.sort(key=lambda g: (-g["risk_score"], -len(g["alive_accounts"])))

        users_with_security_flags: List[dict] = []
        if include_security_flags and user_ids:
            fc = (now_utc - timedelta(days=flags_days)).isoformat()
            fl_docs = await db.security_flags.find(
                {"user_id": {"$in": user_ids}, "created_at": {"$gte": fc}, "resolved": {"$ne": True}},
                {"_id": 0, "user_id": 1, "flag_type": 1, "reason": 1, "created_at": 1},
            ).limit(8000).to_list(8000)
            by_uid: Dict[str, List[dict]] = defaultdict(list)
            for f in fl_docs:
                uid = f.get("user_id")
                if uid:
                    by_uid[uid].append({
                        "flag_type": f.get("flag_type"),
                        "reason": f.get("reason"),
                        "created_at": f.get("created_at"),
                    })
            for uid, items in by_uid.items():
                u0 = id_to_user.get(uid) or {}
                users_with_security_flags.append({
                    "user_id": uid,
                    "username": u0.get("username"),
                    "flag_count": len(items),
                    "flags": items[:12],
                    "risk_score": compute_dupe_risk_score("security_flag_user", len(items)),
                })
            users_with_security_flags.sort(key=lambda g: (-g["risk_score"], -g["flag_count"]))

        password_reset_heavy_users: List[dict] = []
        if include_password_resets and user_ids:
            pr_cut = (now_utc - timedelta(days=password_reset_days)).isoformat()
            pr_docs = await db.password_resets.find(
                {"user_id": {"$in": user_ids}, "created_at": {"$gte": pr_cut}},
                {"_id": 0, "user_id": 1},
            ).limit(20000).to_list(20000)
            pr_count: Dict[str, int] = defaultdict(int)
            for p in pr_docs:
                uid = p.get("user_id")
                if uid:
                    pr_count[uid] += 1
            for uid, c in pr_count.items():
                if c < password_reset_min:
                    continue
                u0 = id_to_user.get(uid) or {}
                password_reset_heavy_users.append({
                    "user_id": uid,
                    "username": u0.get("username"),
                    "reset_count": c,
                    "risk_score": compute_dupe_risk_score("password_reset_heavy", c),
                })
            password_reset_heavy_users.sort(key=lambda g: (-g["risk_score"], -g["reset_count"]))

        return {
            "same_ip_groups": same_ip_groups[:80],
            "total_same_ip_groups": len(same_ip_groups),
            "same_subnet_groups": same_subnet_groups[:40],
            "total_same_subnet_groups": len(same_subnet_groups),
            "same_fingerprint_groups": same_fingerprint_groups[:30],
            "total_same_fingerprint_groups": len(same_fingerprint_groups),
            "same_user_agent_groups": same_ua_groups[:50],
            "total_same_ua_groups": len(same_ua_groups),
            "by_domain": domain_groups[:50],
            "by_similar_username": name_groups[:50],
            "by_fuzzy_username": fuzzy_groups[:30],
            "by_similar_email": similar_email_groups[:50],
            "by_same_day_same_ip": same_day_ip_groups[:30],
            "ip_vpn": ip_vpn,
            "proxy_users": proxy_users_list[:100],
            "total_proxy_users": len(proxy_users_list),
            "ip_union_includes_sessions": include_session_ips,
            "alive_dead_ip_groups": alive_dead_ip_groups[:40],
            "total_alive_dead_ip_groups": len(alive_dead_ip_groups),
            "suspicious_ip_correlations": suspicious_ip_correlations[:45],
            "total_suspicious_ip_correlations": len(suspicious_ip_correlations),
            "registration_burst_groups": registration_burst_groups[:35],
            "total_registration_burst_groups": len(registration_burst_groups),
            "referral_same_ip_groups": referral_same_ip_groups[:40],
            "total_referral_same_ip_groups": len(referral_same_ip_groups),
            "heavy_transfer_pairs": heavy_transfer_pairs[:transfer_limit],
            "total_heavy_transfer_pairs": len(heavy_transfer_pairs),
            "transfer_ring_groups": transfer_ring_groups[:40],
            "total_transfer_ring_groups": len(transfer_ring_groups),
            "overlapping_session_device_groups": overlapping_session_device_groups[:40],
            "total_overlapping_session_device_groups": len(overlapping_session_device_groups),
            "automation_cadence_groups": automation_cadence_groups[:40],
            "total_automation_cadence_groups": len(automation_cadence_groups),
            "referral_abuse_groups": referral_abuse_groups[:40],
            "total_referral_abuse_groups": len(referral_abuse_groups),
            "prereg_ip_cross_accounts": prereg_ip_cross_accounts[:80],
            "total_prereg_ip_cross_accounts": len(prereg_ip_cross_accounts),
            "alive_dead_fingerprint_groups": alive_dead_fingerprint_groups[:35],
            "total_alive_dead_fingerprint_groups": len(alive_dead_fingerprint_groups),
            "users_with_security_flags": users_with_security_flags[:80],
            "total_users_with_security_flags": len(users_with_security_flags),
            "password_reset_heavy_users": password_reset_heavy_users[:60],
            "total_password_reset_heavy_users": len(password_reset_heavy_users),
        }

    def _normalize_user_agent(ua: str) -> str:
        """Strip version numbers (e.g. /121.0.0.0) so same browser different version groups together."""
        if not ua or not ua.strip():
            return ua or ""
        return re.sub(r"/\d+[\d.]*", "", ua.strip())

    @router.get("/admin/cheat-detection/same-device-different-ips")
    async def admin_cheat_same_device_different_ips(current_user: dict = Depends(get_current_user)):
        """
        Find users who share the same browser/device (last_user_agent or device_fingerprint) but use different IPs.
        UA is normalized (version numbers stripped). Also includes device_fingerprint groups.
        Admin or moderator only.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        users = await db.users.find(
            cheat_detection_users_match(),
            {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "login_ips": 1, "last_login_ip": 1, "last_request_ip": 1, "last_user_agent": 1, "device_fingerprint": 1},
        ).to_list(10000)

        def _get_ips(u):
            ips = set()
            for key in ("registration_ip", "last_login_ip", "last_request_ip"):
                v = (u.get(key) or "").strip()
                if v:
                    ips.add(v)
            for lip in (u.get("login_ips") or []):
                lip = (lip or "").strip()
                if lip:
                    ips.add(lip)
            return sorted(ips)

        ua_to_users = {}
        ua_raw_sample = {}
        for u in users:
            ua_raw = (u.get("last_user_agent") or "").strip()
            if not ua_raw:
                continue
            ua_norm = _normalize_user_agent(ua_raw)
            if not ua_norm:
                continue
            if ua_norm not in ua_raw_sample:
                ua_raw_sample[ua_norm] = ua_raw
            summary = {"id": u["id"], "username": u.get("username"), "email": u.get("email"), "ips": _get_ips(u)}
            ua_to_users.setdefault(ua_norm, []).append(summary)
        groups = []
        for ua_norm, accs in ua_to_users.items():
            if len(accs) < 2:
                continue
            all_ips = set()
            for a in accs:
                all_ips.update(a["ips"])
            if len(all_ips) < 2:
                continue
            sample_raw = ua_raw_sample.get(ua_norm, ua_norm)
            risk_score = compute_dupe_risk_score("same_ua", len(accs), has_same_device=True)
            groups.append({
                "user_agent": ua_norm[:120] + ("..." if len(ua_norm) > 120 else ""),
                "user_agent_full": sample_raw[:200] + ("..." if len(sample_raw) > 200 else ""),
                "users": accs,
                "account_count": len(accs),
                "distinct_ip_count": len(all_ips),
                "risk_score": risk_score,
                "device_type": "user_agent",
            })
        fp_to_users = {}
        for u in users:
            fp = (u.get("device_fingerprint") or "").strip()
            if not fp:
                continue
            summary = {"id": u["id"], "username": u.get("username"), "email": u.get("email"), "ips": _get_ips(u)}
            fp_to_users.setdefault(fp, []).append(summary)
        for fp, accs in fp_to_users.items():
            if len(accs) < 2:
                continue
            all_ips = set()
            for a in accs:
                all_ips.update(a["ips"])
            if len(all_ips) < 2:
                continue
            risk_score = compute_dupe_risk_score("same_ua", len(accs), has_same_device=True)
            groups.append({
                "user_agent": f"Fingerprint:{fp[:24]}...",
                "user_agent_full": fp[:64] + ("..." if len(fp) > 64 else ""),
                "users": accs,
                "account_count": len(accs),
                "distinct_ip_count": len(all_ips),
                "risk_score": risk_score,
                "device_type": "fingerprint",
            })
        groups.sort(key=lambda g: (-g["risk_score"], -g["account_count"]))
        return {"groups": groups[:80], "total_groups": len(groups)}

    @router.get("/admin/users/search")
    async def admin_search_users(
        q: str = Query(..., min_length=1, max_length=100),
        limit: int = Query(50, ge=1, le=100),
        current_user: dict = Depends(get_current_user),
    ):
        """Search users by username or email (substring, case-insensitive). Admin or moderator. Returns id, username, email, is_dead, created_at."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        q_clean = (q or "").strip()
        if not q_clean:
            return {"users": []}
        pattern = re.compile(re.escape(q_clean), re.IGNORECASE)
        cursor = db.users.find(
            {"$or": [{"username": {"$regex": pattern}}, {"email": {"$regex": pattern}}]},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "created_at": 1},
        ).limit(limit)
        raw = await cursor.to_list(limit)
        users = [
            {"id": u.get("id"), "username": u.get("username"), "email": u.get("email"), "is_dead": bool(u.get("is_dead")), "created_at": u.get("created_at")}
            for u in raw
        ]
        return {"users": users}

    @router.get("/admin/users/list")
    async def admin_list_users(
        filter_type: str = Query("all", description="all | alive | dead | npc | non_npc"),
        sort: str = Query("username_asc", description="username_asc | username_desc | alive_first | dead_first | npc_first | non_npc_first | created_asc | created_desc"),
        limit: int = Query(500, ge=1, le=2000),
        skip: int = Query(0, ge=0),
        current_user: dict = Depends(get_current_user),
    ):
        """List all registered users. Admin only. Filter by alive/dead/npc/non_npc and sort."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        query = {}
        if filter_type == "alive":
            query["is_dead"] = {"$ne": True}
        elif filter_type == "dead":
            query["is_dead"] = True
        elif filter_type == "npc":
            query["$or"] = [{"is_npc": True}, {"is_bodyguard": True}]
        elif filter_type == "non_npc":
            query["$and"] = [
                {"$or": [{"is_npc": {"$ne": True}}, {"is_npc": {"$exists": False}}]},
                {"$or": [{"is_bodyguard": {"$ne": True}}, {"is_bodyguard": {"$exists": False}}]},
            ]
        # else "all" -> no filter

        sort_spec = []
        if sort == "username_asc":
            sort_spec = [("username", 1)]
        elif sort == "username_desc":
            sort_spec = [("username", -1)]
        elif sort == "alive_first":
            sort_spec = [("is_dead", 1), ("username", 1)]  # false first, then true
        elif sort == "dead_first":
            sort_spec = [("is_dead", -1), ("username", 1)]
        elif sort == "npc_first":
            sort_spec = [("is_bodyguard", -1), ("username", 1)]  # true first
        elif sort == "non_npc_first":
            sort_spec = [("is_bodyguard", 1), ("username", 1)]  # false first (asc)
        elif sort == "created_asc":
            sort_spec = [("created_at", 1)]
        elif sort == "created_desc":
            sort_spec = [("created_at", -1)]
        else:
            sort_spec = [("username", 1)]

        cursor = db.users.find(
            query,
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "email": 1,
                "is_dead": 1,
                "is_bodyguard": 1,
                "is_npc": 1,
                "created_at": 1,
                "email_verified": 1,
                "last_seen": 1,
                "inactivity_reminder_sent_at": 1,
            },
        ).sort(sort_spec).skip(skip).limit(limit)
        raw = await cursor.to_list(limit)
        total = await db.users.count_documents(query)
        users = [
            {
                "id": u.get("id"),
                "username": u.get("username"),
                "email": u.get("email"),
                "is_dead": bool(u.get("is_dead")),
                "is_bodyguard": bool(u.get("is_bodyguard")),
                "is_npc": bool(u.get("is_npc")),
                "created_at": u.get("created_at"),
                "email_verified": bool(u.get("email_verified", True)),
                "last_seen": u.get("last_seen"),
                "inactivity_reminder_sent_at": u.get("inactivity_reminder_sent_at"),
            }
            for u in raw
        ]
        return {"users": users, "total": total, "count": len(users)}

    @router.get("/admin/user-registration")
    async def admin_user_registration(target_username: str, current_user: dict = Depends(get_current_user)):
        """Get a user's registration info (email, username, created_at, IPs) by username. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern(target_username)
        user = await db.users.find_one(
            {"username": username_pattern},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "created_at": 1, "registration_ip": 1, "last_login_ip": 1, "login_ips": 1, "is_dead": 1},
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return {"user": user}

    @router.get("/admin/user-inspect")
    async def admin_user_inspect(email: str = Query(..., description="User's email (to diagnose login 500)"), current_user: dict = Depends(get_current_user)):
        """Inspect a user document by email: returns keys and value types (no secrets). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        import re
        email_clean = (email or "").strip().lower()
        if not email_clean:
            raise HTTPException(status_code=400, detail="email query param required")
        pattern = re.compile("^" + re.escape(email_clean) + "$", re.IGNORECASE)
        user = await db.users.find_one({"email": pattern}, {"_id": 0, "password_hash": 0})
        if not user:
            return {"found": False, "email": email_clean, "message": "No user with this email."}
        keys = list(user.keys())
        value_types = {}
        for k, v in user.items():
            if v is None:
                value_types[k] = "null"
            elif isinstance(v, datetime):
                value_types[k] = "datetime"
            elif isinstance(v, bool):
                value_types[k] = "bool"
            elif isinstance(v, (int, float)):
                value_types[k] = "number"
            elif isinstance(v, str):
                value_types[k] = "str"
            elif isinstance(v, list):
                value_types[k] = f"list(len={len(v)})"
            elif isinstance(v, dict):
                value_types[k] = "dict"
            else:
                value_types[k] = type(v).__name__
        has_id = "id" in user
        id_type = value_types.get("id", "missing")
        return {
            "found": True,
            "email": email_clean,
            "username": user.get("username"),
            "user_id": user.get("id"),
            "has_id": has_id,
            "id_type": id_type,
            "last_device_type": user.get("last_device_type"),
            "last_user_agent": user.get("last_user_agent"),
            "keys": sorted(keys),
            "value_types": value_types,
        }

    @router.post("/admin/auth/fix-login-fields")
    async def admin_fix_login_fields(
        target_username: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Repair malformed login-related fields for one user and clear lockout."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        username_pattern = _username_pattern((target_username or "").strip())
        user = await db.users.find_one(
            {"username": username_pattern},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "login_ips": 1, "sessions": 1, "last_login_ip": 1, "last_request_ip": 1},
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        def _to_clean_str(v) -> Optional[str]:
            if v is None:
                return None
            s = str(v).strip()
            return s[:200] if s else None

        # login_ips must be a short list of strings
        login_ips_raw = user.get("login_ips")
        login_ips_before_type = type(login_ips_raw).__name__
        login_ips_clean: List[str] = []
        if isinstance(login_ips_raw, list):
            seen = set()
            for item in login_ips_raw:
                s = _to_clean_str(item)
                if not s or s in seen:
                    continue
                seen.add(s)
                login_ips_clean.append(s)
            login_ips_clean = login_ips_clean[-20:]

        # sessions must be a list of small dicts
        sessions_raw = user.get("sessions")
        sessions_before_type = type(sessions_raw).__name__
        sessions_clean: List[dict] = []
        if isinstance(sessions_raw, list):
            for ent in sessions_raw:
                if not isinstance(ent, dict):
                    continue
                sid = _to_clean_str(ent.get("id")) or str(uuid.uuid4())
                ip = _to_clean_str(ent.get("ip")) or ""
                device_type = _to_clean_str(ent.get("device_type")) or "Unknown"
                created_at = _to_clean_str(ent.get("created_at")) or datetime.now(timezone.utc).isoformat()
                last_used_at = _to_clean_str(ent.get("last_used_at")) or created_at
                sessions_clean.append({
                    "id": sid,
                    "ip": ip,
                    "device_type": device_type,
                    "created_at": created_at,
                    "last_used_at": last_used_at,
                })
            sessions_clean = sessions_clean[:10]

        set_updates: Dict[str, object] = {
            "login_ips": login_ips_clean,
            "sessions": sessions_clean,
        }
        unset_updates: Dict[str, str] = {}
        for ip_key in ("last_login_ip", "last_request_ip"):
            val = user.get(ip_key)
            if val is None:
                continue
            if isinstance(val, str):
                set_updates[ip_key] = val.strip()[:200]
            else:
                unset_updates[ip_key] = ""

        update_doc: Dict[str, object] = {"$set": set_updates}
        if unset_updates:
            update_doc["$unset"] = unset_updates
        await db.users.update_one({"id": user["id"]}, update_doc)

        # Clear failed-attempt lockout for this account so they can retry immediately.
        lockout_deleted = 0
        email_clean = (user.get("email") or "").strip().lower()
        if email_clean:
            lockout_res = await db.login_lockouts.delete_many({"email": email_clean})
            lockout_deleted = int(lockout_res.deleted_count or 0)

        return {
            "message": f"Repaired login fields for {user.get('username')}",
            "username": user.get("username"),
            "user_id": user.get("id"),
            "login_ips_before_type": login_ips_before_type,
            "sessions_before_type": sessions_before_type,
            "login_ips_after_count": len(login_ips_clean),
            "sessions_after_count": len(sessions_clean),
            "lockouts_cleared": lockout_deleted,
        }

    @router.get("/admin/user-details/{user_id}")
    async def admin_user_details(user_id: str, current_user: dict = Depends(get_current_user)):
        """View user document and all casino ownerships. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "password_hash": 0},
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        dice_owned = await db.dice_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        roulette_owned = await db.roulette_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        blackjack_owned = await db.blackjack_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        horseracing_owned = await db.horseracing_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        videopoker_owned = await db.videopoker_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        slots_owned = await db.slots_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(20)
        casinos_owned = []
        for d in dice_owned:
            casinos_owned.append({"game_type": "dice", "location": d.get("city") or "?"})
        for d in roulette_owned:
            casinos_owned.append({"game_type": "roulette", "location": d.get("city") or "?"})
        for d in blackjack_owned:
            casinos_owned.append({"game_type": "blackjack", "location": d.get("city") or "?"})
        for d in horseracing_owned:
            casinos_owned.append({"game_type": "horseracing", "location": d.get("city") or "?"})
        for d in videopoker_owned:
            casinos_owned.append({"game_type": "videopoker", "location": d.get("city") or "?"})
        for d in slots_owned:
            casinos_owned.append({"game_type": "slots", "location": d.get("state") or "?"})
        return {"user": user, "dice_owned": dice_owned, "casinos_owned": casinos_owned}

    @router.post("/admin/users/inactivity-reminder-email")
    async def admin_send_inactivity_reminder_email(
        body: InactivityReminderEmailRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Send a comeback email to a player who has been inactive (last_seen older than configured days). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not is_email_configured():
            raise HTTPException(
                status_code=503,
                detail="Email is not configured on this server (set SMTP_* or RESEND_API_KEY and MAIL_FROM).",
            )
        try:
            min_days = max(1, int(os.environ.get("INACTIVITY_REMINDER_MIN_DAYS", "3")))
        except ValueError:
            min_days = 3
        try:
            cooldown_days = max(1, int(os.environ.get("INACTIVITY_REMINDER_COOLDOWN_DAYS", "7")))
        except ValueError:
            cooldown_days = 7

        user_id = (body.user_id or "").strip()
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id is required")

        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "last_seen": 1, "is_npc": 1, "is_dead": 1, "inactivity_reminder_sent_at": 1},
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if user.get("is_npc"):
            raise HTTPException(status_code=400, detail="Cannot send to NPC accounts")
        if user.get("is_dead"):
            raise HTTPException(status_code=400, detail="Cannot send to dead accounts")

        to_email = (user.get("email") or "").strip()
        if not to_email:
            raise HTTPException(status_code=400, detail="User has no email address")

        now = datetime.now(timezone.utc)
        sent_raw = user.get("inactivity_reminder_sent_at")
        if sent_raw:
            try:
                sent_dt = datetime.fromisoformat(str(sent_raw).replace("Z", "+00:00"))
                if sent_dt.tzinfo is None:
                    sent_dt = sent_dt.replace(tzinfo=timezone.utc)
                else:
                    sent_dt = sent_dt.astimezone(timezone.utc)
                if (now - sent_dt).total_seconds() < cooldown_days * 86400:
                    raise HTTPException(
                        status_code=429,
                        detail=f"A reminder was already sent within the last {cooldown_days} day(s).",
                    )
            except HTTPException:
                raise
            except Exception:
                pass

        ls_raw = user.get("last_seen")
        ls_dt = None
        if ls_raw:
            try:
                ls_dt = datetime.fromisoformat(str(ls_raw).replace("Z", "+00:00"))
                if ls_dt.tzinfo is None:
                    ls_dt = ls_dt.replace(tzinfo=timezone.utc)
                else:
                    ls_dt = ls_dt.astimezone(timezone.utc)
            except Exception:
                logging.warning(
                    "inactivity reminder: invalid last_seen for user_id=%s raw=%r",
                    user_id,
                    ls_raw,
                )
        if ls_dt is not None:
            if ls_dt > now - timedelta(days=min_days):
                raise HTTPException(
                    status_code=400,
                    detail=f"User was active within the last {min_days} day(s) (last_seen).",
                )
        else:
            logging.warning(
                "inactivity reminder: user_id=%s has missing or unparseable last_seen; allowing send (admin discretion)",
                user_id,
            )

        username = (user.get("username") or "Player").strip() or "Player"
        ok = send_inactivity_reminder_email(to_email, username)
        if not ok:
            raise HTTPException(
                status_code=502,
                detail="Email could not be sent (check server logs / mail provider).",
            )

        await db.users.update_one(
            {"id": user_id},
            {"$set": {"inactivity_reminder_sent_at": now.replace(microsecond=0).isoformat().replace("+00:00", "Z")}},
        )
        logging.info(
            "Admin inactivity reminder email: target_user_id=%s username=%s to=%s by %s",
            user_id,
            username,
            to_email,
            current_user.get("email") or current_user.get("username") or "?",
        )
        return {
            "message": f"Inactive reminder email sent to {to_email}",
            "user_id": user_id,
            "username": username,
        }

    @router.post("/admin/users/inactivity-reminder-email/bulk")
    async def admin_send_inactivity_reminder_email_bulk(
        body: InactivityReminderBulkEmailRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Send inactivity reminder emails to many users (best-effort per user). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        ids = []
        seen = set()
        for raw in (body.user_ids or []):
            uid = str(raw or "").strip()
            if uid and uid not in seen:
                ids.append(uid)
                seen.add(uid)
        if not ids:
            raise HTTPException(status_code=400, detail="Provide at least one user_id")
        if len(ids) > 1000:
            raise HTTPException(status_code=400, detail="Too many users in one request (max 1000)")

        sent = 0
        skipped = 0
        failed = 0
        failures = []
        for uid in ids:
            try:
                await admin_send_inactivity_reminder_email(
                    InactivityReminderEmailRequest(user_id=uid),
                    current_user=current_user,
                )
                sent += 1
            except HTTPException as e:
                code = int(getattr(e, "status_code", 500) or 500)
                detail = e.detail if isinstance(e.detail, str) else "Failed"
                if code in (400, 404, 429):
                    skipped += 1
                else:
                    failed += 1
                failures.append({"user_id": uid, "status_code": code, "detail": detail})
            except Exception:
                failed += 1
                failures.append({"user_id": uid, "status_code": 500, "detail": "Unexpected error"})

        return {
            "message": f"Inactive reminders processed: sent {sent}, skipped {skipped}, failed {failed}.",
            "requested": len(ids),
            "sent": sent,
            "skipped": skipped,
            "failed": failed,
            "failures": failures[:100],
        }

    @router.post("/admin/clear-user-jail-bust-reward")
    async def admin_clear_user_jail_bust_reward(
        body: ClearUserJailBustRewardRequest, current_user: dict = Depends(get_current_user)
    ):
        """Set user's jail bust reward (bust_reward_cash) to 0. Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        user_id = (body.user_id or "").strip()
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id is required")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "bust_reward_cash": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        try:
            prev = int(user.get("bust_reward_cash") or 0)
        except (TypeError, ValueError):
            prev = 0
        await db.users.update_one({"id": user_id}, {"$set": {"bust_reward_cash": 0}})
        logging.info(
            "Admin clear jail bust reward: user_id=%s username=%s previous=%s by %s",
            user_id,
            user.get("username"),
            prev,
            current_user.get("email"),
        )
        return {
            "message": f"Cleared jail bust reward for {user.get('username')}",
            "username": user.get("username"),
            "user_id": user_id,
            "previous_bust_reward_cash": prev,
            "bust_reward_cash": 0,
        }

    @router.get("/admin/casinos-on-dead-owners")
    async def admin_casinos_on_dead_owners(current_user: dict = Depends(get_current_user)):
        """List casino tables owned by dead characters (invalid; use takeover or drop in user dossier). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        scan_specs = [
            ("dice", db.dice_ownership, "city"),
            ("roulette", db.roulette_ownership, "city"),
            ("blackjack", db.blackjack_ownership, "city"),
            ("horseracing", db.horseracing_ownership, "city"),
            ("videopoker", db.videopoker_ownership, "city"),
            ("slots", db.slots_ownership, "state"),
        ]
        rows: List[Dict[str, Any]] = []
        for game_type, coll, loc_key in scan_specs:
            proj = {"_id": 0, "owner_id": 1, "owner_username": 1, loc_key: 1, "buy_back_reward": 1, "buy_back_points_held": 1}
            try:
                chunk = await coll.find({"owner_id": {"$nin": [None, ""]}}, proj).to_list(400)
            except Exception:
                chunk = []
            for doc in chunk:
                oid = (doc.get("owner_id") or "").strip()
                if not oid:
                    continue
                loc = doc.get(loc_key)
                rows.append(
                    {
                        "game_type": game_type,
                        "location": str(loc or "").strip(),
                        "owner_id": oid,
                        "owner_username": (doc.get("owner_username") or "").strip() or None,
                        "buy_back_reward": int(doc.get("buy_back_reward") or 0),
                        "buy_back_points_held": int(doc.get("buy_back_points_held") or 0),
                    }
                )
        owner_ids = list({r["owner_id"] for r in rows})
        if not owner_ids:
            return {"entries": []}
        users = await db.users.find(
            {"id": {"$in": owner_ids}},
            {"_id": 0, "id": 1, "username": 1, "is_dead": 1},
        ).to_list(len(owner_ids))
        by_id = {str(u.get("id") or ""): u for u in users}
        entries: List[Dict[str, Any]] = []
        for r in rows:
            u = by_id.get(r["owner_id"])
            if not u or not u.get("is_dead"):
                continue
            entries.append(
                {
                    **r,
                    "username": u.get("username") or r.get("owner_username") or "?",
                }
            )
        entries.sort(key=lambda x: (x.get("username") or "", x.get("game_type") or "", x.get("location") or ""))
        return {"entries": entries}

    @router.post("/admin/drop-user-casino")
    async def admin_drop_user_casino(body: DropUserCasinoRequest, current_user: dict = Depends(get_current_user)):
        """Remove one casino from a user (ownership becomes unowned). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        game_type = (body.game_type or "").strip().lower()
        location = (body.location or "").strip()
        if not location:
            raise HTTPException(status_code=400, detail="location is required")
        user_id = (body.user_id or "").strip()
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id is required")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        coll_map = {
            "dice": (db.dice_ownership, "city"),
            "roulette": (db.roulette_ownership, "city"),
            "blackjack": (db.blackjack_ownership, "city"),
            "horseracing": (db.horseracing_ownership, "city"),
            "videopoker": (db.videopoker_ownership, "city"),
            "slots": (db.slots_ownership, "state"),
        }
        if game_type not in coll_map:
            raise HTTPException(status_code=400, detail="Invalid game_type; use dice, roulette, blackjack, horseracing, videopoker, or slots")
        coll, loc_key = coll_map[game_type]
        res = await coll.update_one(
            {"owner_id": user_id, loc_key: location},
            {"$set": {"owner_id": None, "owner_username": None}},
        )
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail=f"No {game_type} casino in {location} owned by this user")
        return {"message": f"Dropped {game_type} casino ({location}) from user", "matched": res.matched_count, "modified": res.modified_count}

    @router.post("/admin/takeover-user-casino")
    async def admin_takeover_user_casino(body: TakeoverUserCasinoRequest, current_user: dict = Depends(get_current_user)):
        """Assign a player's casino to you or another user (support / recovery). Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        import importlib

        from server import CAPO_RANK_ID, _user_owns_any_casino, raise_if_dead_casino_transfer_target, user_prestige_rank_mult
        from utils.quicktrade_casino_cleanup import cancel_quicktrade_casino_listings_by_locations

        game_type = (body.game_type or "").strip().lower()
        location = (body.location or "").strip()
        from_uid = (body.user_id or "").strip()
        if not location:
            raise HTTPException(status_code=400, detail="location is required")
        if not from_uid:
            raise HTTPException(status_code=400, detail="user_id is required")

        coll_map = {
            "dice": (db.dice_ownership, "city"),
            "roulette": (db.roulette_ownership, "city"),
            "blackjack": (db.blackjack_ownership, "city"),
            "horseracing": (db.horseracing_ownership, "city"),
            "videopoker": (db.videopoker_ownership, "city"),
            "slots": (db.slots_ownership, "state"),
        }
        qt_type_map = {
            "dice": "casino_dice",
            "roulette": "casino_rlt",
            "blackjack": "casino_blackjack",
            "horseracing": "casino_horseracing",
            "videopoker": "casino_videopoker",
        }
        if game_type not in coll_map:
            raise HTTPException(
                status_code=400,
                detail="Invalid game_type; use dice, roulette, blackjack, horseracing, videopoker, or slots",
            )

        victim = await db.users.find_one({"id": from_uid}, {"_id": 0, "id": 1, "username": 1})
        if not victim:
            raise HTTPException(status_code=404, detail="User not found")

        to_username_raw = (body.to_username or "").strip()
        if to_username_raw:
            to_user = await db.users.find_one(
                {"username": {"$regex": f"^{re.escape(to_username_raw)}$", "$options": "i"}},
                {"_id": 0, "id": 1, "username": 1, "rank_points": 1, "prestige_level": 1, "is_dead": 1},
            )
            if not to_user:
                raise HTTPException(status_code=404, detail=f"No user with username {to_username_raw!r}")
        else:
            to_user = await db.users.find_one(
                {"id": current_user.get("id") or ""},
                {"_id": 0, "id": 1, "username": 1, "rank_points": 1, "prestige_level": 1, "is_dead": 1},
            )
            if not to_user:
                raise HTTPException(status_code=400, detail="Could not resolve acting admin user")

        raise_if_dead_casino_transfer_target(to_user)
        to_uid = str(to_user.get("id") or "")
        to_un = str(to_user.get("username") or "").strip() or "?"
        if to_uid == from_uid:
            raise HTTPException(status_code=400, detail="Source and destination user are the same")

        coll, loc_key = coll_map[game_type]
        doc = await coll.find_one({loc_key: location, "owner_id": from_uid})
        if not doc:
            raise HTTPException(status_code=404, detail=f"No {game_type} casino at {location!r} owned by this user")

        if int(doc.get("buy_back_reward") or 0) > 0 or int(doc.get("buy_back_points_held") or 0) > 0:
            raise HTTPException(
                status_code=400,
                detail="This casino has an active buy-back (reward or held points). Clear buy-back in-game before takeover.",
            )

        owned_other = await _user_owns_any_casino(to_uid)
        if owned_other:
            otype = owned_other.get("type")
            ocity = owned_other.get("city")
            if otype != game_type or str(ocity or "") != str(location):
                raise HTTPException(
                    status_code=400,
                    detail=f"Destination user already owns a casino ({otype} · {ocity}). They may only hold one.",
                )

        rank_id, _ = get_rank_info(int(to_user.get("rank_points") or 0), user_prestige_rank_mult(to_user))
        set_doc: Dict[str, Any] = {"owner_id": to_uid, "owner_username": to_un}
        if rank_id < CAPO_RANK_ID:
            set_doc["below_capo_acquired_at"] = datetime.now(timezone.utc)
        update_op: Dict[str, Any] = {"$set": set_doc}
        if rank_id >= CAPO_RANK_ID:
            update_op["$unset"] = {"below_capo_acquired_at": ""}

        res = await coll.update_one({loc_key: location, "owner_id": from_uid}, update_op)
        if not res.modified_count:
            raise HTTPException(status_code=500, detail="Casino takeover did not apply; try again")

        qt = qt_type_map.get(game_type)
        if qt:
            stored_loc = doc.get(loc_key) or location
            try:
                await cancel_quicktrade_casino_listings_by_locations(qt, stored_loc, location)
            except Exception:
                logging.exception("takeover-user-casino: quicktrade cleanup failed game=%s loc=%s", game_type, location)

        casino_modules = (
            "routers.casinos.dice",
            "routers.casinos.roulette",
            "routers.casinos.blackjack",
            "routers.casinos.horseracing",
            "routers.casinos.video_poker",
            "routers.casinos.slots",
        )
        for uid in (from_uid, to_uid):
            if not uid:
                continue
            for mod_path in casino_modules:
                try:
                    mod = importlib.import_module(mod_path)
                    inv = getattr(mod, "_invalidate_ownership_cache", None)
                    if callable(inv):
                        inv(uid)
                except Exception:
                    pass

        try:
            await db.users.update_one({"id": from_uid}, {"$inc": {"casinos_lost": 1}})
            await db.users.update_one({"id": to_uid}, {"$inc": {"casinos_seized": 1}})
        except Exception:
            logging.exception("takeover-user-casino: stats increment failed")

        logging.info(
            "Admin casino takeover: %s %s from user_id=%s to user_id=%s (%s) by %s",
            game_type,
            location,
            from_uid,
            to_uid,
            to_un,
            current_user.get("email") or current_user.get("username"),
        )
        return {
            "message": f"Assigned {game_type} casino ({location}) to {to_un}",
            "game_type": game_type,
            "location": location,
            "from_user_id": from_uid,
            "to_user_id": to_uid,
            "to_username": to_un,
        }

    _CASINO_PROPERTY_COLLECTIONS = [
        (db.dice_ownership, "dice_ownership"),
        (db.roulette_ownership, "roulette_ownership"),
        (db.blackjack_ownership, "blackjack_ownership"),
        (db.horseracing_ownership, "horseracing_ownership"),
        (db.videopoker_ownership, "videopoker_ownership"),
        (db.slots_ownership, "slots_ownership"),
        (db.airport_ownership, "airport_ownership"),
        (db.bullet_factory, "bullet_factory"),
    ]

    @router.post("/admin/drop-user-casinos-properties")
    async def admin_drop_user_casinos_properties(body: DropUserCasinosPropertiesRequest, current_user: dict = Depends(get_current_user)):
        """Drop all casinos and properties for a single user (ownership becomes unclaimed). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator required")
        user_id = (body.user_id or "").strip()
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id is required")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        unset = {"$set": {"owner_id": None, "owner_username": None}}
        result = {}
        for coll, name in _CASINO_PROPERTY_COLLECTIONS:
            res = await coll.update_many({"owner_id": user_id}, unset)
            result[name] = res.modified_count
        total = sum(result.values())
        logging.info(f"Admin drop user casinos/properties: user_id={user_id} by {current_user.get('email')}, modified={result}")
        return {"message": f"Dropped all casinos and properties for user", "user_id": user_id, "details": result, "total_modified": total}

    @router.post("/admin/drop-all-casinos-properties")
    async def admin_drop_all_casinos_properties(current_user: dict = Depends(get_current_user)):
        """Disabled: global unclaim was removed from the API for security."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raise HTTPException(
            status_code=410,
            detail="Global drop-all-casinos-properties has been removed from the admin API.",
        )

    @router.post("/admin/set-casino-max-bet")
    async def admin_set_casino_max_bet(body: AdminSetCasinoMaxBetRequest, current_user: dict = Depends(get_current_user)):
        """Set max bet for a casino game type. Admin only.
        game_type: dice, roulette, blackjack, horseracing, videopoker, slots, or 'all'
        location: specific city/state, or None/empty to apply to all locations
        max_bet: the new max bet value
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        game_type = (body.game_type or "").strip().lower()
        location = (body.location or "").strip() if body.location else None
        max_bet = body.max_bet
        if max_bet < 1:
            raise HTTPException(status_code=400, detail="max_bet must be at least 1")
        coll_map = {
            "dice": (db.dice_ownership, "city"),
            "roulette": (db.roulette_ownership, "city"),
            "blackjack": (db.blackjack_ownership, "city"),
            "horseracing": (db.horseracing_ownership, "city"),
            "videopoker": (db.videopoker_ownership, "city"),
            "slots": (db.slots_ownership, "state"),
        }
        results = {}
        
        async def upsert_all_locations(coll, loc_key, gtype):
            """Upsert max_bet for all cities/states so unclaimed casinos also get updated."""
            count = 0
            for loc in (STATES or []):
                res = await coll.update_one(
                    {loc_key: loc},
                    {"$set": {"max_bet": max_bet}},
                    upsert=True
                )
                if res.modified_count or res.upserted_id:
                    count += 1
            return count
        
        if game_type == "all":
            for gtype, (coll, loc_key) in coll_map.items():
                if location:
                    res = await coll.update_one({loc_key: location}, {"$set": {"max_bet": max_bet}}, upsert=True)
                    results[gtype] = 1 if (res.modified_count or res.upserted_id) else 0
                else:
                    results[gtype] = await upsert_all_locations(coll, loc_key, gtype)
            total = sum(results.values())
            logging.info(f"Admin set casino max bet (all games): max_bet={max_bet}, location={location or 'all'}, by {current_user.get('email')}, modified={results}")
            return {"message": f"Set max bet to ${max_bet:,} for all casino types", "location": location or "all", "max_bet": max_bet, "details": results, "total_modified": total}
        if game_type not in coll_map:
            raise HTTPException(status_code=400, detail="Invalid game_type; use dice, roulette, blackjack, horseracing, videopoker, slots, or 'all'")
        coll, loc_key = coll_map[game_type]
        if location:
            res = await coll.update_one({loc_key: location}, {"$set": {"max_bet": max_bet}}, upsert=True)
            count = 1 if (res.modified_count or res.upserted_id) else 0
        else:
            count = await upsert_all_locations(coll, loc_key, game_type)
        logging.info(f"Admin set casino max bet: game_type={game_type}, max_bet={max_bet}, location={location or 'all'}, by {current_user.get('email')}, modified={count}")
        return {"message": f"Set max bet to ${max_bet:,} for {game_type}", "game_type": game_type, "location": location or "all", "max_bet": max_bet, "modified": count}

    @router.get("/admin/casino-max-bets")
    async def admin_get_casino_max_bets(current_user: dict = Depends(get_current_user)):
        """Get current max bets for all casino types by location. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        coll_map = {
            "dice": (db.dice_ownership, "city"),
            "roulette": (db.roulette_ownership, "city"),
            "blackjack": (db.blackjack_ownership, "city"),
            "horseracing": (db.horseracing_ownership, "city"),
            "videopoker": (db.videopoker_ownership, "city"),
            "slots": (db.slots_ownership, "state"),
        }
        result = {}
        for gtype, (coll, loc_key) in coll_map.items():
            docs = await coll.find({}, {"_id": 0, loc_key: 1, "max_bet": 1, "owner_username": 1}).to_list(100)
            result[gtype] = [{"location": d.get(loc_key), "max_bet": d.get("max_bet"), "owner": d.get("owner_username")} for d in docs]
        return result

    @router.post("/admin/wipe-all-users")
    async def admin_wipe_all_users(current_user: dict = Depends(get_current_user)):
        """Disabled: full user/database wipe was removed from the API for security."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raise HTTPException(
            status_code=410,
            detail="Bulk wipe-all-users has been removed from the admin API. Restore from backup or run a controlled maintenance script with server access.",
        )

    @router.post("/admin/database-fresh")
    async def admin_database_fresh(current_user: dict = Depends(get_current_user)):
        """Disabled: full database reset was removed from the API for security."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raise HTTPException(
            status_code=410,
            detail="Full database-fresh / new-release reset has been removed from the admin API. Use backups and out-of-band tooling if a reset is required.",
        )

    @router.post("/admin/delete-user/{user_id}")
    async def admin_delete_single_user(user_id: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw = (user_id or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="User ID or username required")
        user = await db.users.find_one({"id": raw}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            username_pattern = re.compile("^" + re.escape(raw) + "$", re.IGNORECASE)
            user = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        resolved_id = user["id"]
        deleted = {}
        username = user.get("username", "?")
        deleted["user"] = (await db.users.delete_one({"id": resolved_id})).deleted_count
        deleted["family_members"] = (await db.family_members.delete_many({"user_id": resolved_id})).deleted_count
        deleted["bodyguards"] = (await db.bodyguards.delete_many({"$or": [{"user_id": resolved_id}, {"bodyguard_user_id": resolved_id}]})).deleted_count
        deleted["bodyguard_invites"] = (await db.bodyguard_invites.delete_many({"$or": [{"from_user_id": resolved_id}, {"to_user_id": resolved_id}]})).deleted_count
        deleted["user_cars"] = (await db.user_cars.delete_many({"user_id": resolved_id})).deleted_count
        deleted["user_properties"] = (await db.user_properties.delete_many({"user_id": resolved_id})).deleted_count
        deleted["user_weapons"] = (await db.user_weapons.delete_many({"user_id": resolved_id})).deleted_count
        deleted["attacks"] = (await db.attacks.delete_many({"$or": [{"attacker_id": resolved_id}, {"target_id": resolved_id}]})).deleted_count
        deleted["notifications"] = (await db.notifications.delete_many({"user_id": resolved_id})).deleted_count
        deleted["extortions"] = (await db.extortions.delete_many({"$or": [{"extorter_id": resolved_id}, {"target_id": resolved_id}]})).deleted_count
        deleted["sports_bets"] = (await db.sports_bets.delete_many({"user_id": resolved_id})).deleted_count
        deleted["blackjack_games"] = (await db.blackjack_games.delete_many({"user_id": resolved_id})).deleted_count
        deleted["dice_ownership"] = (await db.dice_ownership.update_many({"owner_id": resolved_id}, {"$set": {"owner_id": None, "owner_username": None}})).modified_count
        deleted["dice_buy_back_offers"] = (await db.dice_buy_back_offers.delete_many({"$or": [{"from_owner_id": resolved_id}, {"to_user_id": resolved_id}]})).deleted_count
        deleted["slots_ownership"] = (await db.slots_ownership.update_many({"owner_id": resolved_id}, {"$set": {"owner_id": None, "owner_username": None}})).modified_count
        await db.slots_entries.update_many({}, {"$pull": {"user_ids": resolved_id}})
        deleted["slots_buy_back_offers"] = (await db.slots_buy_back_offers.delete_many({"$or": [{"from_owner_id": resolved_id}, {"to_user_id": resolved_id}]})).deleted_count
        deleted["interest_deposits"] = (await db.interest_deposits.delete_many({"user_id": resolved_id})).deleted_count
        deleted["family_war_stats"] = (await db.family_war_stats.delete_many({"user_id": resolved_id})).deleted_count
        total = sum(deleted.values())
        return {"message": f"Deleted user '{username}' and {total} related documents", "details": deleted}

    @router.get("/admin/families-list")
    async def admin_families_list(current_user: dict = Depends(get_current_user)):
        """List all families (including wiped) for admin dropdown. Returns id, name, tag, wiped."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        fams = await db.families.find({}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "wiped": 1}).sort("name", 1).to_list(50)
        return {"families": [{"id": f["id"], "name": f.get("name", "?"), "tag": f.get("tag", "?"), "wiped": bool(f.get("wiped"))} for f in fams]}

    @router.post("/admin/delete-family")
    async def admin_delete_family(request: DeleteFamilyRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        family_id = (request.family_id or "").strip()
        if not family_id:
            raise HTTPException(status_code=400, detail="Family ID required")
        fam = await db.families.find_one({"id": family_id}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "head_of_state": 1})
        if not fam:
            raise HTTPException(status_code=404, detail="Family not found")
        set_state_head = srv.set_state_head
        head_state = (fam.get("head_of_state") or "").strip()
        if head_state:
            await set_state_head(head_state, None)
        member_ids = [m["user_id"] for m in await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(500)]
        await db.users.update_many({"id": {"$in": member_ids}}, {"$set": {"family_id": None, "family_role": None}})
        deleted = {}
        deleted["family_members"] = (await db.family_members.delete_many({"family_id": family_id})).deleted_count
        deleted["family_wars"] = (await db.family_wars.delete_many({"$or": [{"family_a_id": family_id}, {"family_b_id": family_id}]})).deleted_count
        deleted["family_war_stats"] = (await db.family_war_stats.delete_many({"family_id": family_id})).deleted_count
        deleted["family_racket_attacks"] = (await db.family_racket_attacks.delete_many({"$or": [{"attacker_family_id": family_id}, {"target_family_id": family_id}]})).deleted_count
        deleted["family_crew_oc_applications"] = (await db.family_crew_oc_applications.delete_many({"family_id": family_id})).deleted_count
        deleted["family_join_applications"] = (await db.family_join_applications.delete_many({"family_id": family_id})).deleted_count
        deleted["families"] = (await db.families.delete_one({"id": family_id})).deleted_count
        try:
            from routers.game.families import _invalidate_list_cache
            _invalidate_list_cache()
        except Exception:
            pass
        total = sum(deleted.values())
        return {"message": f"Deleted family '{fam.get('name', '?')}' [{fam.get('tag', '?')}] and {total} related documents", "details": deleted}

    @router.post("/admin/wipe-all-families")
    async def admin_wipe_all_families(current_user: dict = Depends(get_current_user)):
        """Disabled: bulk wipe all families was removed from the API for security."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raise HTTPException(
            status_code=410,
            detail="Wipe-all-families has been removed from the admin API. Delete individual families from the admin panel or use a controlled script.",
        )

    @router.get("/admin/events")
    async def admin_get_events(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = await get_events_enabled()
        full = await get_effective_event_full() if enabled else {"event": None, "event_ids": [], "expires_at": None, "duration_hours": 0}
        pool = [{"id": ev["id"], "name": ev["name"], "message": ev.get("message", "")} for ev in POSITIVE_GAME_EVENTS]
        return {
            "events_enabled": enabled,
            "active_event": full["event"],
            "active_event_ids": full["event_ids"],
            "expires_at": full["expires_at"],
            "duration_hours": full["duration_hours"],
            "pool": pool,
        }

    @router.post("/admin/events/toggle")
    async def admin_toggle_events(request: EventsToggleRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = request.enabled
        await db.game_config.update_one(
            {"id": "main"},
            {"$set": {"events_enabled": bool(enabled)}},
            upsert=True,
        )
        return {"message": "Game events " + ("enabled" if enabled else "disabled"), "events_enabled": bool(enabled)}

    @router.post("/admin/events/force-rotate")
    async def admin_force_rotate_events(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await force_rotate_random_events()
        names = [srv.GAME_EVENTS_BY_ID.get(eid, {}).get("name", eid) for eid in result["event_ids"]]
        return {
            "message": f"New events rolled: {', '.join(names)} ({result['duration_hours']:.1f}h)",
            "active_event": result["event"],
            "active_event_ids": result["event_ids"],
            "expires_at": result["expires_at"],
            "duration_hours": result["duration_hours"],
        }

    def _redeem_forum_reward_lines(reward_dict: dict) -> List[str]:
        lines: List[str] = []
        if reward_dict.get("money"):
            lines.append(f"${int(reward_dict['money']):,} cash")
        if reward_dict.get("points"):
            lines.append(f"{int(reward_dict['points']):,} points")
        if reward_dict.get("respect_points"):
            lines.append(f"{int(reward_dict['respect_points']):,} respect")
        if reward_dict.get("loot_box_pieces"):
            lines.append(f"{int(reward_dict['loot_box_pieces'])} loot box pieces")
        for car_id in reward_dict.get("cars") or []:
            car_info = next((c for c in CARS if c.get("id") == car_id), None)
            lines.append(car_info.get("name", car_id) if car_info else str(car_id))
        for token_type, amount in (reward_dict.get("tokens") or {}).items():
            if amount:
                lines.append(f"{int(amount)} {str(token_type).replace('_', ' ')} token(s)")
        return lines

    @router.get("/admin/redeem-codes")
    async def admin_get_redeem_codes(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cursor = db.redeem_codes.find({}, {"_id": 0, "used_by": 0})
        codes = []
        async for doc in cursor:
            codes.append({
                "code": doc.get("code", ""),
                "rewards": doc.get("rewards", {}),
                "max_uses": doc.get("max_uses"),
                "used_count": int(doc.get("used_count", 0)),
                "active": bool(doc.get("active", True)),
            })
        return {"codes": codes}

    @router.post("/admin/redeem-codes")
    async def admin_create_redeem_code(request: RedeemCodeCreateRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raw_code = (request.code or "").strip()
        if not raw_code:
            raise HTTPException(status_code=400, detail="Code is required")
        code_normalized = raw_code.upper()
        existing = await db.redeem_codes.find_one({"code": code_normalized}, {"_id": 1})
        if existing:
            raise HTTPException(status_code=400, detail="A redeem code with this value already exists")
        rewards = request.rewards or RedeemCodeRewards()
        reward_dict = {}
        if (rewards.money or 0) > 0:
            reward_dict["money"] = int(rewards.money)
        if (rewards.points or 0) > 0:
            reward_dict["points"] = int(rewards.points)
        if (rewards.respect_points or 0) > 0:
            reward_dict["respect_points"] = int(rewards.respect_points)
        if (rewards.loot_box_pieces or 0) > 0:
            reward_dict["loot_box_pieces"] = int(rewards.loot_box_pieces)
        if rewards.cars:
            valid_car_ids = {c["id"] for c in CARS}
            car_list = [str(cid).strip() for cid in rewards.cars if str(cid).strip() in valid_car_ids]
            if car_list:
                reward_dict["cars"] = car_list
        if rewards.tokens:
            token_dict = {}
            for tt, amt in rewards.tokens.items():
                if tt not in ADMIN_TOKEN_TYPES or not (amt and int(amt) > 0):
                    continue
                token_dict[str(tt)] = int(amt)
            if token_dict:
                reward_dict["tokens"] = token_dict
        if not reward_dict:
            raise HTTPException(status_code=400, detail="At least one reward is required")
        max_uses = None
        if request.max_uses is not None and request.max_uses > 0:
            max_uses = int(request.max_uses)
        doc = {
            "code": code_normalized,
            "rewards": reward_dict,
            "max_uses": max_uses,
            "used_count": 0,
            "used_by": [],
            "active": True,
        }
        await db.redeem_codes.insert_one(doc)
        try:
            topic_id = await create_redeem_code_forum_topic(
                code_normalized,
                _redeem_forum_reward_lines(reward_dict),
                max_uses,
            )
            await db.redeem_codes.update_one({"code": code_normalized}, {"$set": {"forum_topic_id": topic_id}})
        except Exception:
            await db.redeem_codes.delete_one({"code": code_normalized})
            raise HTTPException(status_code=500, detail="Redeem code was not saved: forum topic creation failed.")
        return {"message": "Redeem code created", "code": code_normalized, "forum_topic_id": topic_id}

    @router.patch("/admin/redeem-codes/{code}")
    async def admin_patch_redeem_code(
        code: str,
        request: RedeemCodePatchRequest,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        code_normalized = (code or "").strip().upper()
        doc = await db.redeem_codes.find_one({"code": code_normalized}, {"_id": 0, "forum_topic_id": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Redeem code not found")
        if request.active is False:
            await remove_redeem_code_forum_topic(doc.get("forum_topic_id"))
            await db.redeem_codes.update_one(
                {"code": code_normalized},
                {"$set": {"active": False}, "$unset": {"forum_topic_id": ""}},
            )
            return {"message": "Redeem code deactivated; forum topic removed", "code": code_normalized, "active": False}
        await db.redeem_codes.update_one({"code": code_normalized}, {"$set": {"active": True}})
        return {"message": "Redeem code activated (no forum topic recreated)", "code": code_normalized, "active": True}

    @router.delete("/admin/redeem-codes/{code}")
    async def admin_delete_redeem_code(code: str, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        code_normalized = (code or "").strip().upper()
        doc = await db.redeem_codes.find_one({"code": code_normalized}, {"_id": 0, "forum_topic_id": 1})
        if doc:
            await remove_redeem_code_forum_topic(doc.get("forum_topic_id"))
        result = await db.redeem_codes.delete_one({"code": code_normalized})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Redeem code not found")
        return {"message": "Redeem code deleted", "code": code_normalized}

    @router.get("/admin/beta-signup")
    async def admin_get_beta_signup(current_user: dict = Depends(get_current_user)):
        """Get beta signup mode status."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_config.find_one({"id": "main"}, {"_id": 0, "beta_signup_enabled": 1})
        return {"beta_signup_enabled": bool(doc.get("beta_signup_enabled", False)) if doc else False}

    @router.post("/admin/beta-signup/toggle")
    async def admin_toggle_beta_signup(request: BetaSignupToggleRequest, current_user: dict = Depends(get_current_user)):
        """Toggle beta signup mode. When enabled, new signups get 15k points, $1B cash, 15k respect."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = request.enabled
        await db.game_config.update_one(
            {"id": "main"},
            {"$set": {"beta_signup_enabled": bool(enabled)}},
            upsert=True,
        )
        return {"message": "Beta signup " + ("enabled" if enabled else "disabled"), "beta_signup_enabled": bool(enabled)}

    # Pre-register emails are stored in preregistrations; tolerate legacy/alternate collection names.
    _PREREG_COLLECTION_CANDIDATES = ("preregistrations", "preregistration", "pre_registrations")

    async def _resolve_preregistration_collection():
        """Pick first candidate that has documents; else default to preregistrations (may be empty)."""
        for name in _PREREG_COLLECTION_CANDIDATES:
            coll = db[name]
            try:
                n = await coll.count_documents({})
            except Exception:
                n = 0
            if n > 0:
                return coll, name
        return db.preregistrations, "preregistrations"

    @router.get("/admin/preregistrations")
    async def admin_get_preregistrations(
        limit: int = Query(500, ge=1, le=5000),
        current_user: dict = Depends(get_current_user),
    ):
        """Admin or moderator: list pre-registered emails (newest first)."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        coll, coll_name = await _resolve_preregistration_collection()
        total = await coll.count_documents({})
        cursor = coll.find(
            {},
            {"_id": 0, "email": 1, "Email": 1, "source": 1, "created_at": 1, "ip": 1, "user_agent": 1},
        ).sort("_id", -1).limit(limit)
        items = await cursor.to_list(limit)
        for row in items:
            em = row.get("email") or row.get("Email")
            if em:
                row["email"] = em
            row.pop("Email", None)
        if coll_name != "preregistrations" and total:
            logging.info(
                "admin preregistrations: list served from collection %r (total=%s)",
                coll_name,
                total,
            )
        # Founding rewards also apply to full signups during login-lock (no preregistrations row).
        founding_total = await db.users.count_documents({"founding_member": True})
        founding_cursor = (
            db.users.find(
                {"founding_member": True},
                {"_id": 0, "id": 1, "email": 1, "username": 1, "created_at": 1, "is_dead": 1},
            )
            .sort("created_at", -1)
            .limit(limit)
        )
        founding_items = await founding_cursor.to_list(limit)
        return {
            "total": total,
            "count": len(items),
            "items": items,
            "collection": coll_name,
            "founding_member_total": founding_total,
            "founding_member_count": len(founding_items),
            "founding_member_items": founding_items,
        }

    def _seed_family_roles(size: int):
        """Return role list for 10-15 members: boss, underboss, consigliere, 2 capos, rest soldiers."""
        roles = ["boss", "underboss", "consigliere", "capo", "capo"]
        n = max(0, min(10, (size - 5)))
        roles.extend(["soldier"] * n)
        return roles

    @router.post("/admin/seed-families")
    async def admin_seed_families(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        raise HTTPException(status_code=410, detail="Deprecated: NPC seeding tools have been removed")
        import random
        from routers.game.families import cleanup_dead_families, _invalidate_list_cache
        await cleanup_dead_families()
        _invalidate_list_cache()
        password_hash = get_password_hash(SEED_TEST_PASSWORD)
        now = datetime.now(timezone.utc).isoformat()
        created_users = []
        created_families = []
        for fam_cfg in SEED_FAMILIES_CONFIG:
            name, tag = fam_cfg["name"], fam_cfg["tag"]
            existing = await db.families.find_one({"$or": [{"name": name}, {"tag": tag}]})
            if existing:
                continue
            member_count = random.randint(10, 15)
            roles = _seed_family_roles(member_count)
            family_id = str(uuid.uuid4())
            user_ids = []
            for i, role in enumerate(roles):
                user_id = str(uuid.uuid4())
                base = f"{tag.lower()}_{role}"
                username = f"{base}_{i}"
                email = f"{base}{i}@test.mafia"
                if await db.users.find_one({"$or": [{"email": email}, {"username": username}]}):
                    continue
                rank_points = SEED_RANK_POINTS_BY_ROLE.get(role, 0)
                rank_id, _ = get_rank_info(rank_points)
                user_doc = {
                    "id": user_id,
                    "email": email,
                    "username": username,
                    "password_hash": password_hash,
                    "rank": rank_id,
                    "money": 1000.0,
                    "points": 0,
                    "rank_points": rank_points,
                    "bodyguard_slots": 2,
                    "bullets": 0,
                    "avatar_url": None,
                    "jail_busts": 0,
                    "jail_bust_attempts": 0,
                    "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
                    "total_crimes": 0,
                    "crime_profit": 0,
                    "total_gta": 0,
                    "total_oc_heists": 0,
                    "oc_timer_reduced": False,
                    "current_state": "Chicago",
                    "swiss_balance": 0,
                    "swiss_limit": SWISS_BANK_LIMIT_START,
                    "total_kills": 0,
                    "total_kills_excludes_npc_v1": True,
                    "total_deaths": 0,
                    "in_jail": False,
                    "jail_until": None,
                    "premium_rank_bar": False,
                    "custom_car_name": None,
                    "travels_this_hour": 0,
                    "travel_reset_time": now,
                    "extra_airmiles": 0,
                    "health": DEFAULT_HEALTH,
                    "armour_level": 0,
                    "armour_owned_level_max": 0,
                    "equipped_weapon_id": None,
                    "kill_inflation": 0.0,
                    "kill_inflation_updated_at": now,
                    "is_dead": False,
                    "dead_at": None,
                    "points_at_death": None,
                    "retrieval_used": False,
                    "last_seen": now,
                    "created_at": now,
                }
                await db.users.insert_one(user_doc)
                created_users.append({"username": username, "email": email, "role": role, "family": name})
                user_ids.append((user_id, role, username))
            boss_id = user_ids[0][0] if user_ids else None
            if not boss_id:
                continue
            first_racket_id = FAMILY_RACKETS[0]["id"]
            rackets = {first_racket_id: {"level": 1, "last_collected_at": None}}
            await db.families.insert_one({
                "id": family_id,
                "name": name,
                "tag": tag,
                "boss_id": boss_id,
                "treasury": SEED_TREASURY,
                "created_at": now,
                "rackets": rackets,
                "player_cap_exempt": True,
            })
            created_families.append({"name": name, "tag": tag, "member_count": len(user_ids)})
            for uid, role, _ in user_ids:
                await db.family_members.insert_one({
                    "id": str(uuid.uuid4()),
                    "family_id": family_id,
                    "user_id": uid,
                    "role": role,
                    "joined_at": now,
                })
                await db.users.update_one(
                    {"id": uid},
                    {"$set": {"family_id": family_id, "family_role": role}},
                )
            for uid, role, owner_username in user_ids:
                owner = {"id": uid, "current_state": "Chicago"}
                for slot in range(1, 3):
                    try:
                        robot_user_id, robot_username, _ = await _create_robot_bodyguard_user(owner)
                        await db.bodyguards.insert_one({
                            "id": str(uuid.uuid4()),
                            "user_id": uid,
                            "owner_username": owner_username,
                            "slot_number": slot,
                            "is_robot": True,
                            "robot_name": robot_username,
                            "bodyguard_user_id": robot_user_id,
                            "health": 100,
                            "armour_level": 0,
                            "hired_at": now,
                        })
                    except Exception as e:
                        logging.exception("Seed bodyguard for %s slot %s: %s", uid, slot, e)
        return {
            "message": f"Seeded {len(created_families)} families with {len(created_users)} users (each with 2 robot bodyguards). Password for all: test1234",
            "families": created_families,
            "users": created_users,
        }

    @router.post("/admin/create-test-users")
    async def admin_create_test_users(current_user: dict = Depends(get_current_user)):
        """Create 30 real (non-NPC) test users with random ranks, in crews, owning available casinos and properties. Password: test1234."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.casinos.dice import DICE_MAX_BET
        from routers.casinos.roulette import ROULETTE_MAX_BET
        from routers.casinos.blackjack import BLACKJACK_DEFAULT_MAX_BET
        from routers.casinos.horseracing import HORSERACING_MAX_BET
        from routers.casinos.video_poker import VIDEO_POKER_DEFAULT_MAX_BET
        from routers.admin.airport import AIRPORT_SLOTS_PER_STATE, AIRPORT_COST

        COUNT = 30
        FAMILY_SIZE = 5
        NUM_FAMILIES = (COUNT + FAMILY_SIZE - 1) // FAMILY_SIZE
        ROLES = ["boss", "underboss", "consigliere", "capo", "soldier"]
        TEST_PASSWORD = "test1234"
        # Vary auto-rank sub-settings per user (all get auto_rank_enabled + auto_rank_purchased)
        AUTO_RANK_PRESETS = [
            {"auto_rank_crimes": True, "auto_rank_gta": False, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": False, "auto_rank_booze": False},
            {"auto_rank_crimes": False, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": False, "auto_rank_booze": False},
            {"auto_rank_crimes": True, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": False, "auto_rank_booze": False},
            {"auto_rank_crimes": True, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": True, "auto_rank_booze": False},
            {"auto_rank_crimes": True, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": False, "auto_rank_booze": True},
            {"auto_rank_crimes": True, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": True, "auto_rank_oc": False, "auto_rank_booze": False},
        ]
        password_hash = get_password_hash(TEST_PASSWORD)
        now_dt = datetime.now(timezone.utc)
        now = now_dt.isoformat()
        forced_online_until = (now_dt + timedelta(hours=1)).isoformat()
        created_users = []
        created_families = []
        user_pool = []  # list of (user_id, username) for assigning ownership
        user_index = [0]

        for f in range(NUM_FAMILIES):
            family_id = str(uuid.uuid4())
            name = f"TestCrew{f+1}"
            tag = f"T{f+1:02d}"
            members = []
            for i in range(FAMILY_SIZE):
                if len(created_users) >= COUNT:
                    break
                user_id = str(uuid.uuid4())
                role = ROLES[i % len(ROLES)]
                username = f"test_{tag}_{role}_{i}"
                email = f"test{tag}{i}@test.mafia"
                if await db.users.find_one({"$or": [{"email": email}, {"username": username}]}):
                    continue
                rank_id = random.randint(1, len(RANKS))
                rank_def = RANKS[rank_id - 1]
                req = int(rank_def["required_points"])
                if rank_id < len(RANKS):
                    next_req = int(RANKS[rank_id]["required_points"])
                    rank_points = random.randint(req, min(req + max(1, (next_req - req) // 2), next_req - 1))
                else:
                    rank_points = random.randint(req, req + 50000)
                preset = AUTO_RANK_PRESETS[user_index[0] % len(AUTO_RANK_PRESETS)]
                user_index[0] += 1
                user_doc = {
                    "id": user_id,
                    "email": email,
                    "username": username,
                    "password_hash": password_hash,
                    "rank": rank_id,
                    "money": 500_000.0,
                    "points": 100,
                    "rank_points": rank_points,
                    "bodyguard_slots": 0,
                    "bullets": 0,
                    "avatar_url": None,
                    "jail_busts": 0,
                    "jail_bust_attempts": 0,
                    "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
                    "total_crimes": 0,
                    "crime_profit": 0,
                    "total_gta": 0,
                    "total_oc_heists": 0,
                    "oc_timer_reduced": False,
                    "current_state": random.choice(STATES) if STATES else "Chicago",
                    "swiss_balance": 0,
                    "swiss_limit": SWISS_BANK_LIMIT_START,
                    "total_kills": 0,
                    "total_kills_excludes_npc_v1": True,
                    "total_deaths": 0,
                    "in_jail": False,
                    "jail_until": None,
                    "premium_rank_bar": False,
                    "has_silencer": False,
                    "custom_car_name": None,
                    "travels_this_hour": 0,
                    "travel_reset_time": now,
                    "extra_airmiles": 0,
                    "health": DEFAULT_HEALTH,
                    "armour_level": 0,
                    "armour_owned_level_max": 0,
                    "equipped_weapon_id": None,
                    "kill_inflation": 0.0,
                    "kill_inflation_updated_at": now,
                    "is_dead": False,
                    "dead_at": None,
                    "points_at_death": None,
                    "retrieval_used": False,
                    "last_seen": now,
                    "created_at": now,
                    "forced_online_until": forced_online_until,
                    "auto_rank_purchased": True,
                    "auto_rank_enabled": True,
                    **preset,
                }
                await db.users.insert_one(user_doc)
                created_users.append({"username": username, "email": email, "rank": rank_id, "family": name})
                user_pool.append((user_id, username))
                members.append((user_id, role))
            if not members:
                continue
            first_racket_id = FAMILY_RACKETS[0]["id"]
            rackets = {first_racket_id: {"level": 1, "last_collected_at": None}}
            await db.families.insert_one({
                "id": family_id,
                "name": name,
                "tag": tag,
                "boss_id": members[0][0],
                "treasury": 50_000,
                "created_at": now,
                "rackets": rackets,
                "player_cap_exempt": True,
            })
            created_families.append({"name": name, "tag": tag})
            for user_id, role in members:
                await db.family_members.insert_one({
                    "id": str(uuid.uuid4()),
                    "family_id": family_id,
                    "user_id": user_id,
                    "role": role,
                    "joined_at": now,
                })
                await db.users.update_one({"id": user_id}, {"$set": {"family_id": family_id, "family_role": role}})

        # Assign unowned casino tables (each user at most one)
        casino_slots = []
        for city in (STATES or []):
            for game_type, coll, max_bet in [
                ("dice", db.dice_ownership, DICE_MAX_BET),
                ("roulette", db.roulette_ownership, ROULETTE_MAX_BET),
                ("blackjack", db.blackjack_ownership, BLACKJACK_DEFAULT_MAX_BET),
                ("horseracing", db.horseracing_ownership, HORSERACING_MAX_BET),
                ("videopoker", db.videopoker_ownership, VIDEO_POKER_DEFAULT_MAX_BET),
            ]:
                doc = await coll.find_one({"city": city}, {"_id": 0, "owner_id": 1})
                if not doc or not doc.get("owner_id"):
                    casino_slots.append((city, game_type, coll, max_bet))
        casino_assigned = set()
        for idx, (city, game_type, coll, max_bet) in enumerate(casino_slots):
            if idx >= len(user_pool):
                break
            user_id, username = user_pool[idx]
            if user_id in casino_assigned:
                continue
            if game_type == "dice":
                await coll.update_one(
                    {"city": city},
                    {"$set": {"owner_id": user_id, "owner_username": username, "max_bet": max_bet, "buy_back_reward": 0, "profit": 0}},
                    upsert=True,
                )
            elif game_type == "roulette":
                await coll.update_one(
                    {"city": city},
                    {"$set": {"owner_id": user_id, "owner_username": username, "max_bet": max_bet, "total_earnings": 0}},
                    upsert=True,
                )
            elif game_type in ("blackjack", "horseracing", "videopoker"):
                extra = {"buy_back_reward": 0} if game_type == "blackjack" else {}
                await coll.update_one(
                    {"city": city},
                    {"$set": {"owner_id": user_id, "owner_username": username, "max_bet": max_bet, "total_earnings": 0, "profit": 0, **extra}},
                    upsert=True,
                )
            casino_assigned.add(user_id)

        # Assign unowned airport slots (each user at most one property)
        property_assigned = set()
        for state in (STATES or []):
            for slot in range(1, AIRPORT_SLOTS_PER_STATE + 1):
                doc = await db.airport_ownership.find_one({"state": state, "slot": slot}, {"_id": 0, "owner_id": 1})
                if not doc:
                    await db.airport_ownership.insert_one({
                        "state": state, "slot": slot, "owner_id": None, "owner_username": None, "price_per_travel": AIRPORT_COST,
                    })
                    doc = {}
                if doc.get("owner_id"):
                    continue
                for user_id, username in user_pool:
                    if user_id in property_assigned:
                        continue
                    await db.airport_ownership.update_one(
                        {"state": state, "slot": slot},
                        {"$set": {"owner_id": user_id, "owner_username": username}},
                    )
                    property_assigned.add(user_id)
                    break

        # Assign unowned bullet factories
        for state in (STATES or []):
            doc = await db.bullet_factory.find_one({"state": state}, {"_id": 0, "owner_id": 1})
            if not doc:
                await db.bullet_factory.insert_one({
                    "state": state,
                    "owner_id": None,
                    "owner_username": None,
                    "last_collected_at": now,
                    "price_per_bullet": None,
                    "unowned_price": random.randint(2500, 4000),
                })
                doc = {}
            if doc.get("owner_id"):
                continue
            for user_id, username in user_pool:
                if user_id in property_assigned:
                    continue
                await db.bullet_factory.update_one(
                    {"state": state},
                    {"$set": {"owner_id": user_id, "owner_username": username}},
                )
                property_assigned.add(user_id)
                break

        return {
            "message": f"Created {len(created_users)} test users in {len(created_families)} crews. Assigned available casinos and properties. Password: test1234",
            "users": created_users,
            "families": created_families,
        }

    def _test_users_filter():
        """Users created by Create 30 test users: username test_* or email *@test.mafia."""
        return {
            "is_dead": {"$ne": True},
            "$or": [
                {"username": re.compile(r"^test_", re.IGNORECASE)},
                {"email": re.compile(r"@test\.mafia$", re.IGNORECASE)},
            ],
        }

    @router.post("/admin/test-users-auto-rank")
    async def admin_test_users_auto_rank(request: TestUsersAutoRankRequest, current_user: dict = Depends(get_current_user)):
        """Enable or disable auto-rank for all test users (username test_* or email *@test.mafia)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = request.enabled
        updates = {"auto_rank_enabled": enabled}
        if not enabled:
            updates["auto_rank_crimes"] = False
            updates["auto_rank_gta"] = False
            updates["auto_rank_bust_every_5_sec"] = False
            updates["auto_rank_oc"] = False
            updates["auto_rank_booze"] = False
            op = {"$set": updates, "$unset": {"auto_rank_stats_since": ""}}
        else:
            op = {"$set": updates}
        res = await db.users.update_many(_test_users_filter(), op)
        return {
            "message": f"Auto-rank {'enabled' if enabled else 'disabled'} for all test users.",
            "enabled": enabled,
            "updated_count": res.modified_count,
        }

    def _seeded_users_filter():
        """Users from Seed Families (Corleone, Baranco, Stracci): username corl_*, barn_*, strc_*."""
        return {
            "is_dead": {"$ne": True},
            "$or": [
                {"username": re.compile(r"^corl_", re.IGNORECASE)},
                {"username": re.compile(r"^barn_", re.IGNORECASE)},
                {"username": re.compile(r"^strc_", re.IGNORECASE)},
            ],
        }

    @router.post("/admin/seeded-users-auto-rank")
    async def admin_seeded_users_auto_rank(request: TestUsersAutoRankRequest, current_user: dict = Depends(get_current_user)):
        """Enable or disable auto-rank for all seeded family users (Corleone, Baranco, Stracci)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        enabled = request.enabled
        updates = {"auto_rank_enabled": enabled}
        if not enabled:
            updates["auto_rank_crimes"] = False
            updates["auto_rank_gta"] = False
            updates["auto_rank_bust_every_5_sec"] = False
            updates["auto_rank_oc"] = False
            updates["auto_rank_booze"] = False
            op = {"$set": updates, "$unset": {"auto_rank_stats_since": ""}}
        else:
            op = {"$set": updates}
        res = await db.users.update_many(_seeded_users_filter(), op)
        return {
            "message": f"Auto-rank {'enabled' if enabled else 'disabled'} for all seeded users.",
            "enabled": enabled,
            "updated_count": res.modified_count,
        }

    # ──────────────────────────────────────────────────────────────────────────────
    # Cloudflare Bot Blocking Toggle
    # ──────────────────────────────────────────────────────────────────────────────

    async def _cf_get_rule_status(rule_name: str) -> dict:
        """Helper to get Cloudflare firewall rule status by name."""
        if not CF_ZONE_ID or not CF_API_TOKEN:
            return {"enabled": None, "error": "Cloudflare not configured (CF_ZONE_ID / CF_API_TOKEN missing)"}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"https://api.cloudflare.com/client/v4/zones/{CF_ZONE_ID}/firewall/rules",
                    headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
                )
                data = resp.json()
                if not data.get("success"):
                    return {"enabled": None, "error": data.get("errors", "Unknown error")}
                rules = data.get("result", [])
                for rule in rules:
                    if rule_name.lower() in (rule.get("description") or "").lower():
                        return {"enabled": not rule.get("paused", False), "rule_id": rule.get("id")}
                return {"enabled": None, "error": f"Rule '{rule_name}' not found"}
        except Exception as e:
            logging.exception("Cloudflare API error")
            return {"enabled": None, "error": str(e)}

    async def _cf_toggle_rule(rule_name: str, enabled: bool) -> dict:
        """Helper to toggle a Cloudflare firewall rule by name."""
        if not CF_ZONE_ID or not CF_API_TOKEN:
            raise HTTPException(status_code=500, detail="Cloudflare not configured (CF_ZONE_ID / CF_API_TOKEN missing)")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"https://api.cloudflare.com/client/v4/zones/{CF_ZONE_ID}/firewall/rules",
                    headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
                )
                data = resp.json()
                if not data.get("success"):
                    raise HTTPException(status_code=500, detail=f"Cloudflare error: {data.get('errors')}")
                rules = data.get("result", [])
                rule_id = None
                for rule in rules:
                    if rule_name.lower() in (rule.get("description") or "").lower():
                        rule_id = rule.get("id")
                        break
                if not rule_id:
                    raise HTTPException(status_code=404, detail=f"Rule '{rule_name}' not found in Cloudflare")
                update_resp = await client.patch(
                    f"https://api.cloudflare.com/client/v4/zones/{CF_ZONE_ID}/firewall/rules/{rule_id}",
                    headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
                    json={"paused": not enabled},
                )
                update_data = update_resp.json()
                if not update_data.get("success"):
                    raise HTTPException(status_code=500, detail=f"Cloudflare update error: {update_data.get('errors')}")
                return {"enabled": enabled}
        except HTTPException:
            raise
        except Exception as e:
            logging.exception("Cloudflare API error")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/admin/cloudflare/bot-block-status")
    async def admin_cloudflare_bot_block_status(current_user: dict = Depends(get_current_user)):
        """Get current status of the 'Block All Bots' rule in Cloudflare."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return await _cf_get_rule_status("Block All Bots")

    @router.post("/admin/cloudflare/bot-block-toggle")
    async def admin_cloudflare_bot_block_toggle(enabled: bool, current_user: dict = Depends(get_current_user)):
        """Enable or disable the 'Block All Bots' Cloudflare firewall rule."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await _cf_toggle_rule("Block All Bots", enabled)
        return {"message": f"Bot blocking {'enabled' if enabled else 'disabled'}", **result}

    @router.get("/admin/cloudflare/automation-block-status")
    async def admin_cloudflare_automation_block_status(current_user: dict = Depends(get_current_user)):
        """Get current status of the 'Block Automation Scripts' rule in Cloudflare."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return await _cf_get_rule_status("Block Automation")

    @router.post("/admin/cloudflare/automation-block-toggle")
    async def admin_cloudflare_automation_block_toggle(enabled: bool, current_user: dict = Depends(get_current_user)):
        """Enable or disable the 'Block Automation Scripts' Cloudflare firewall rule."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await _cf_toggle_rule("Block Automation", enabled)
        return {"message": f"Automation script blocking {'enabled' if enabled else 'disabled'}", **result}

    # ──────────────────────────────────────────────────────────────────────────────
    # New Admin Tools
    # ──────────────────────────────────────────────────────────────────────────────

    @router.get("/admin/economy/overview")
    async def admin_economy_overview(current_user: dict = Depends(get_current_user)):
        """Economy snapshot: total money, points, average wealth, top 5 richest."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        base_match = srv.alive_real_player_wallet_match()
        pipeline = [
            {"$match": base_match},
            {"$group": {
                "_id": None,
                "total_money": {"$sum": {"$ifNull": ["$money", 0]}},
                "total_bank": {"$sum": {"$ifNull": ["$bank_balance", 0]}},
                "total_swiss": {"$sum": {"$ifNull": ["$swiss_balance", 0]}},
                "total_points": {"$sum": {"$ifNull": ["$points", 0]}},
                "avg_money": {"$avg": {"$ifNull": ["$money", 0]}},
                "player_count": {"$sum": 1},
            }},
        ]
        agg = await db.users.aggregate(pipeline).to_list(1)
        stats = agg[0] if agg else {}
        top5 = await db.users.find(
            base_match,
            {"_id": 0, "username": 1, "money": 1, "bank_balance": 1, "swiss_balance": 1, "points": 1},
        ).sort("money", -1).limit(5).to_list(5)
        top5_points = await db.users.find(
            base_match,
            {"_id": 0, "username": 1, "points": 1},
        ).sort("points", -1).limit(5).to_list(5)
        player_count = stats.get("player_count", 1) or 1
        total_bank = int(stats.get("total_bank", 0) or 0)
        total_swiss = int(stats.get("total_swiss", 0) or 0)
        return {
            "total_money": stats.get("total_money", 0),
            "total_bank": total_bank,
            "total_swiss": total_swiss,
            "total_banked": total_bank + total_swiss,
            "total_points": stats.get("total_points", 0),
            "avg_money": round(stats.get("avg_money", 0)),
            "avg_points": round(stats.get("total_points", 0) / player_count),
            "player_count": stats.get("player_count", 0),
            "top5_richest": [
                {
                    "username": u.get("username", "?"),
                    "money": u.get("money", 0),
                    "bank": u.get("bank_balance", 0),
                    "swiss": u.get("swiss_balance", 0),
                    "banked_total": int(u.get("bank_balance", 0) or 0) + int(u.get("swiss_balance", 0) or 0),
                    "points": u.get("points", 0),
                }
                for u in (top5 or [])
            ],
            "top5_points": [
                {"username": u.get("username", "?"), "points": u.get("points", 0)}
                for u in (top5_points or [])
            ],
        }

    @router.get("/admin/economy/cash-holders")
    async def admin_economy_cash_holders(
        offset: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=200),
        sort: str = Query("money_desc", description="money_desc | money_asc | username_asc"),
        search: Optional[str] = Query(None, max_length=80),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Paginated list of wallet cash (users.money) for the same segment as GET /admin/economy/overview total_money:
        alive, not moderator, not in ADMIN_EMAILS. Optional username search (case-insensitive substring).
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if sort not in ("money_desc", "money_asc", "username_asc"):
            raise HTTPException(status_code=400, detail="sort must be money_desc, money_asc, or username_asc")
        base_match: dict = srv.alive_real_player_wallet_match()
        q = (search or "").strip()
        if q:
            base_match["username"] = {"$regex": re.escape(q), "$options": "i"}
        if sort == "money_desc":
            sort_spec: list = [("money", -1), ("username", 1)]
        elif sort == "money_asc":
            sort_spec = [("money", 1), ("username", 1)]
        else:
            sort_spec = [("username", 1)]

        sum_pipe = [
            {"$match": base_match},
            {"$group": {"_id": None, "t": {"$sum": {"$ifNull": ["$money", 0]}}}},
        ]
        agg_sum, total_accounts, rows = await asyncio.gather(
            db.users.aggregate(sum_pipe).to_list(1),
            db.users.count_documents(base_match),
            db.users.find(
                base_match,
                {"_id": 0, "id": 1, "username": 1, "money": 1, "bank_balance": 1, "swiss_balance": 1, "is_npc": 1},
            )
            .sort(sort_spec)
            .skip(offset)
            .limit(limit)
            .to_list(limit),
        )
        total_cash = int((agg_sum[0].get("t", 0) if agg_sum else 0) or 0)
        return {
            "match_note": (
                "Alive real players (excl. NPCs, moderators, ADMIN_EMAILS) — same segment as Economy overview → Cash in circulation and Stats Total cash wallets portion."
                + (" Filtered by username search." if q else "")
            ),
            "total_cash_on_hand": total_cash,
            "total_accounts": int(total_accounts or 0),
            "offset": offset,
            "limit": limit,
            "sort": sort,
            "search": q or None,
            "rows": [
                {
                    "id": r.get("id") or "",
                    "username": r.get("username") or "?",
                    "money": int(r.get("money") or 0),
                    "bank_balance": int(r.get("bank_balance") or 0),
                    "swiss_balance": int(r.get("swiss_balance") or 0),
                    "is_npc": bool(r.get("is_npc")),
                }
                for r in (rows or [])
            ],
        }

    @router.get("/admin/economy/capital-breakdown")
    async def admin_economy_capital_breakdown(current_user: dict = Depends(get_current_user)):
        """
        Where dollars sit: player wallets (by segment), bank balances, Swiss, interest-bank deposits,
        family treasuries, trade escrow. Aligns with /stats/overview game_capital where noted. Admin only.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        staff_filter = _staff_exclude_user_filter()
        staff_ids = await srv._get_staff_user_ids()
        real_user_match = {"is_npc": {"$ne": True}, **staff_filter}
        alive_real_match = {"is_npc": {"$ne": True}, "is_dead": {"$ne": True}, **staff_filter}
        dead_real_match = {"is_npc": {"$ne": True}, "is_dead": True, **staff_filter}
        npc_match = {"is_npc": True}
        staff_match = {"id": {"$in": staff_ids}} if staff_ids else {"id": "__no_staff__"}

        async def _user_cash_sums(match: dict) -> dict:
            rows = await db.users.aggregate(
                [
                    {"$match": match},
                    {
                        "$group": {
                            "_id": None,
                            "money": {"$sum": {"$ifNull": ["$money", 0]}},
                            "bank_balance": {"$sum": {"$ifNull": ["$bank_balance", 0]}},
                            "swiss_balance": {"$sum": {"$ifNull": ["$swiss_balance", 0]}},
                            "users": {"$sum": 1},
                        }
                    },
                ]
            ).to_list(1)
            r = rows[0] if rows else {}
            return {
                "money": int(r.get("money") or 0),
                "bank_balance": int(r.get("bank_balance") or 0),
                "swiss_balance": int(r.get("swiss_balance") or 0),
                "user_count": int(r.get("users") or 0),
            }

        bank_dep_match = {"claimed_at": None}
        if staff_ids:
            bank_dep_match["user_id"] = {"$nin": staff_ids}
        qt_match = {"status": "active"}
        if staff_ids:
            qt_match["user_id"] = {"$nin": staff_ids}

        (
            alive_sums,
            dead_sums,
            npc_sums,
            staff_sums,
            interest_rows,
            family_rows,
            qt_rows,
            qt_sell_rows,
            top_wallets,
            top_liquid,
        ) = await asyncio.gather(
            _user_cash_sums(alive_real_match),
            _user_cash_sums(dead_real_match),
            _user_cash_sums(npc_match),
            _user_cash_sums(staff_match),
            db.bank_deposits.aggregate(
                [
                    {"$match": bank_dep_match},
                    {
                        "$group": {
                            "_id": None,
                            "principal": {"$sum": {"$ifNull": ["$principal", 0]}},
                            "interest": {"$sum": {"$ifNull": ["$interest_amount", 0]}},
                            "deposits": {"$sum": 1},
                        }
                    },
                ]
            ).to_list(1),
            db.families.aggregate([{"$group": {"_id": None, "treasury": {"$sum": {"$ifNull": ["$treasury", 0]}}}}]).to_list(1),
            db.trade_buy_offers.aggregate(
                [{"$match": qt_match}, {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$offer", 0]}}, "offers": {"$sum": 1}}}]
            ).to_list(1),
            db.trade_sell_offers.aggregate(
                [
                    {"$match": qt_match},
                    {
                        "$group": {
                            "_id": None,
                            "total_points": {"$sum": {"$ifNull": ["$original_points", "$points"]}},
                            "offers": {"$sum": 1},
                        }
                    },
                ]
            ).to_list(1),
            db.users.find(alive_real_match, {"_id": 0, "username": 1, "money": 1, "bank_balance": 1, "swiss_balance": 1})
            .sort("money", -1)
            .limit(20)
            .to_list(20),
            db.users.aggregate(
                [
                    {"$match": alive_real_match},
                    {
                        "$addFields": {
                            "liquid": {
                                "$add": [
                                    {"$ifNull": ["$money", 0]},
                                    {"$ifNull": ["$bank_balance", 0]},
                                    {"$ifNull": ["$swiss_balance", 0]},
                                ]
                            }
                        }
                    },
                    {"$sort": {"liquid": -1}},
                    {"$limit": 15},
                    {
                        "$project": {
                            "_id": 0,
                            "username": 1,
                            "money": 1,
                            "bank_balance": 1,
                            "swiss_balance": 1,
                            "liquid": 1,
                        }
                    },
                ]
            ).to_list(15),
        )

        int_doc = interest_rows[0] if interest_rows else {}
        interest_principal = int(int_doc.get("principal") or 0)
        interest_accrued = int(int_doc.get("interest") or 0)
        interest_total = interest_principal + interest_accrued
        interest_deposit_count = int(int_doc.get("deposits") or 0)

        fam_doc = family_rows[0] if family_rows else {}
        family_treasury = int(fam_doc.get("treasury") or 0)

        qt_doc = qt_rows[0] if qt_rows else {}
        quicktrade_escrow = int(qt_doc.get("total") or 0)
        quicktrade_offers = int(qt_doc.get("offers") or 0)

        qt_sell_doc = qt_sell_rows[0] if qt_sell_rows else {}
        quicktrade_sell_points_escrow = int(qt_sell_doc.get("total_points") or 0)
        quicktrade_sell_offers = int(qt_sell_doc.get("offers") or 0)

        # Same definitions as GET /stats/overview game_capital (total_cash = wallets + buy-offer escrow)
        public_total_cash = alive_sums["money"] + quicktrade_escrow
        swiss_rows = await db.users.aggregate(
            [
                {"$match": real_user_match},
                {"$group": {"_id": None, "t": {"$sum": {"$ifNull": ["$swiss_balance", 0]}}}},
            ]
        ).to_list(1)
        public_swiss_total = int((swiss_rows[0].get("t", 0) if swiss_rows else 0) or 0)

        real_alive_bank = alive_sums["bank_balance"]
        npc_total = npc_sums["money"] + npc_sums["bank_balance"] + npc_sums["swiss_balance"]
        staff_total = staff_sums["money"] + staff_sums["bank_balance"] + staff_sums["swiss_balance"]

        alive_liquid_player = alive_sums["money"] + alive_sums["bank_balance"] + alive_sums["swiss_balance"]
        approximate_all_in_system = (
            alive_liquid_player
            + dead_sums["money"]
            + dead_sums["bank_balance"]
            + dead_sums["swiss_balance"]
            + npc_total
            + staff_total
            + interest_total
            + family_treasury
            + quicktrade_escrow
        )

        buckets = [
            {
                "id": "wallet_alive_players",
                "label": "Cash on hand (alive players, excl. staff/NPC)",
                "amount": alive_sums["money"],
                "note": "Wallets only. Public Stats → Total cash = this plus Quick Trade buy-offer escrow (trade_buy_escrow bucket).",
            },
            {
                "id": "bank_alive_players",
                "label": "Classic bank balance (same players)",
                "amount": real_alive_bank,
                "note": "users.bank_balance; not included in public Total cash line.",
            },
            {
                "id": "swiss_all_real_players",
                "label": "Swiss bank (all real players, excl. staff)",
                "amount": public_swiss_total,
                "note": "Matches public Stats → Swiss bank cash (includes dead players’ Swiss).",
            },
            {
                "id": "wallet_dead_players",
                "label": "Cash on hand (dead players, excl. staff)",
                "amount": dead_sums["money"],
                "note": "Stranded wallets.",
            },
            {
                "id": "bank_dead_players",
                "label": "Bank + Swiss (dead players)",
                "amount": dead_sums["bank_balance"] + dead_sums["swiss_balance"],
                "note": "",
            },
            {
                "id": "npc_all",
                "label": "NPC accounts (cash + bank + Swiss)",
                "amount": npc_total,
                "note": f"{npc_sums['user_count']} NPC rows.",
            },
            {
                "id": "staff_all",
                "label": "Staff accounts (admins/mods, cash + bank + Swiss)",
                "amount": staff_total,
                "note": f"{staff_sums['user_count']} staff users (excluded from public stats).",
            },
            {
                "id": "interest_bank_unclaimed",
                "label": "Interest bank (unclaimed deposits)",
                "amount": interest_total,
                "note": f"Principal ${interest_principal:,} + accrued ${interest_accrued:,} · {interest_deposit_count} deposits. Matches public Stats line.",
            },
            {
                "id": "family_treasury",
                "label": "Family treasuries",
                "amount": family_treasury,
                "note": "families.treasury sum.",
            },
            {
                "id": "trade_buy_escrow",
                "label": "Quick trade — active buy offers (escrow)",
                "amount": quicktrade_escrow,
                "note": f"{quicktrade_offers} offers. Cash locked out of wallets while active.",
            },
            {
                "id": "trade_sell_escrow_points",
                "label": "Quick trade — active sell offers (points escrow)",
                "amount": quicktrade_sell_points_escrow,
                "note": f"{quicktrade_sell_offers} offers. Points deducted from balances while listed (not USD; do not add to dollar totals).",
            },
        ]

        return {
            "generated_at": now.isoformat(),
            "public_stats_alignment": {
                "total_cash": public_total_cash,
                "swiss_total": public_swiss_total,
                "interest_bank_total": interest_total,
            },
            "segments": {
                "alive_players_ex_staff": alive_sums,
                "dead_players_ex_staff": dead_sums,
                "npc": npc_sums,
                "staff": staff_sums,
            },
            "buckets": buckets,
            "totals": {
                "alive_players_liquid_cash_bank_swiss": alive_liquid_player,
                "approximate_all_locations_summed": approximate_all_in_system,
            },
            "top_cash_on_hand": [
                {
                    "username": u.get("username") or "?",
                    "money": int(u.get("money") or 0),
                    "bank_balance": int(u.get("bank_balance") or 0),
                    "swiss_balance": int(u.get("swiss_balance") or 0),
                }
                for u in (top_wallets or [])
            ],
            "top_combined_liquid": [
                {
                    "username": u.get("username") or "?",
                    "money": int(u.get("money") or 0),
                    "bank_balance": int(u.get("bank_balance") or 0),
                    "swiss_balance": int(u.get("swiss_balance") or 0),
                    "liquid": int(u.get("liquid") or 0),
                }
                for u in (top_liquid or [])
            ],
        }

    @router.get("/admin/audit/economy-spikes")
    async def admin_audit_economy_spikes(
        days: int = Query(7, ge=1, le=30),
        min_cash: float = Query(50_000_000, ge=0, description="Minimum abs cash signal (wallet / payout / etc.)"),
        min_points: int = Query(100_000, ge=0),
        wallet_gains_only: bool = Query(
            False,
            description="When true, activity/economy rows use signed on-hand wallet (users.money) deltas: "
            "only increases ≥ min_cash (hides shop spends, bank send, deposits, lottery buys). "
            "Gambling/analytics already reflect payouts. Not all wallet $inc paths are logged.",
        ),
        username: Optional[str] = Query(None, max_length=80, description="Substring match on username when present"),
        limit_per_source: int = Query(100, ge=1, le=500),
        sources: Optional[str] = Query(
            None,
            description="Comma-separated: points,gambling,activity,economy,analytics (default: all)",
        ),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Best-effort audit: large point_ledger_events, gambling_log payouts, whitelisted activity_log rows,
        select economy_events, and high-payout analytics_events. Does not cover every wallet $inc.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        now = datetime.now(timezone.utc)
        start_dt = now - timedelta(days=days)
        start_iso = start_dt.isoformat().replace("+00:00", "Z")
        want = {s.strip().lower() for s in (sources or "").split(",") if s.strip()}
        if not want:
            want = {"points", "gambling", "activity", "economy", "analytics"}

        q_user = (username or "").strip()
        uid_filter: Optional[List[str]] = None
        if q_user:
            pat = re.compile(re.escape(q_user), re.IGNORECASE)
            uhits = await db.users.find({"username": pat}, {"_id": 0, "id": 1}).limit(500).to_list(500)
            uid_filter = [u["id"] for u in uhits if u.get("id")]
            if not uid_filter:
                return {
                    "window": {"start": start_iso, "end": now.isoformat().replace("+00:00", "Z"), "days": days},
                    "thresholds": {"min_cash": min_cash, "min_points": min_points, "wallet_gains_only": wallet_gains_only},
                    "sources_used": sorted(want),
                    "limit_per_source": limit_per_source,
                    "note": "No users matched the username filter.",
                    "rows": [],
                    "row_count": 0,
                }

        rows_out: List[Dict[str, Any]] = []

        async def _fetch_points() -> None:
            if "points" not in want:
                return
            match: Dict[str, Any] = {
                "created_at": {"$gte": start_iso},
                "$expr": {"$gte": [{"$abs": {"$toDouble": {"$ifNull": ["$points", 0]}}}, float(min_points)]},
            }
            if uid_filter is not None:
                match["user_id"] = {"$in": uid_filter}
            cur = (
                db.point_ledger_events.find(
                    match,
                    {"_id": 0, "id": 1, "user_id": 1, "event_type": 1, "points": 1, "created_at": 1, "meta": 1, "origin_ref": 1},
                )
                .sort("created_at", -1)
                .limit(limit_per_source)
            )
            async for doc in cur:
                at = _spike_parse_created_at(doc.get("created_at")) or now
                rows_out.append(
                    {
                        "at": at.isoformat(),
                        "source": "point_ledger",
                        "user_id": doc.get("user_id"),
                        "username": None,
                        "kind": doc.get("event_type"),
                        "cash_delta": None,
                        "points_delta": int(doc.get("points") or 0),
                        "raw_ref": {
                            "id": doc.get("id"),
                            "origin_ref": doc.get("origin_ref"),
                            "meta": doc.get("meta"),
                        },
                    }
                )

        async def _fetch_gambling() -> None:
            if "gambling" not in want:
                return
            m0: Dict[str, Any] = {"created_at": {"$gte": start_dt}}
            if uid_filter is not None:
                m0["user_id"] = {"$in": uid_filter}
            pipeline = [
                {"$match": m0},
                {
                    "$addFields": {
                        "payout_n": {
                            "$convert": {
                                "input": "$details.payout",
                                "to": "double",
                                "onError": 0.0,
                                "onNull": 0.0,
                            }
                        },
                        "winnings_n": {
                            "$convert": {
                                "input": "$details.winnings",
                                "to": "double",
                                "onError": 0.0,
                                "onNull": 0.0,
                            }
                        },
                    }
                },
                {"$addFields": {"mx": {"$max": ["$payout_n", "$winnings_n"]}}},
                {"$match": {"mx": {"$gte": float(min_cash)}}},
                {"$sort": {"created_at": -1}},
                {"$limit": limit_per_source},
            ]
            async for doc in db.gambling_log.aggregate(pipeline):
                at = _spike_parse_created_at(doc.get("created_at")) or now
                det = doc.get("details") if isinstance(doc.get("details"), dict) else {}
                rows_out.append(
                    {
                        "at": at.isoformat(),
                        "source": "gambling_log",
                        "user_id": doc.get("user_id"),
                        "username": doc.get("username"),
                        "kind": doc.get("game_type"),
                        "cash_delta": float(doc.get("mx") or 0),
                        "points_delta": None,
                        "raw_ref": {"id": doc.get("id"), "details": det},
                    }
                )

        async def _fetch_activity() -> None:
            if "activity" not in want:
                return
            and_parts: List[Dict[str, Any]] = [
                {"created_at": {"$gte": start_dt}},
                {
                    "$or": [
                        {"action": {"$in": list(ACTIVITY_ACTIONS_FOR_SPIKE_AUDIT)}},
                        {"action": {"$regex": r"^minigame_", "$options": "i"}},
                    ]
                },
            ]
            if uid_filter is not None:
                and_parts.append({"user_id": {"$in": uid_filter}})
            match_a = {"$and": and_parts}
            cur = (
                db.activity_log.find(match_a, {"_id": 0, "id": 1, "user_id": 1, "username": 1, "action": 1, "details": 1, "created_at": 1})
                .sort("created_at", -1)
                .limit(min(3000, limit_per_source * 30))
            )
            n = 0
            async for doc in cur:
                if n >= limit_per_source:
                    break
                act = str(doc.get("action") or "")
                if not _activity_log_row_matches_spike_whitelist(act):
                    continue
                det = doc.get("details")
                cmax, pmax = _activity_log_extract_spike_amounts(act, det)
                if cmax is None and pmax is None:
                    continue
                if wallet_gains_only:
                    wsigned = _activity_wallet_signed_cash_delta(act, det)
                    cash_ok = wsigned is not None and wsigned >= float(min_cash)
                    pts_ok = (pmax or 0) >= float(min_points)
                    if not cash_ok and not pts_ok:
                        continue
                    cash_out = float(wsigned) if cash_ok else None
                    pts_out = int(pmax) if pts_ok and pmax is not None else None
                else:
                    if (cmax or 0) < float(min_cash) and (pmax or 0) < float(min_points):
                        continue
                    cash_out = cmax
                    pts_out = int(pmax) if pmax is not None else None
                at = _spike_parse_created_at(doc.get("created_at")) or now
                rows_out.append(
                    {
                        "at": at.isoformat(),
                        "source": "activity_log",
                        "user_id": doc.get("user_id"),
                        "username": doc.get("username"),
                        "kind": act,
                        "cash_delta": cash_out,
                        "points_delta": pts_out,
                        "raw_ref": {"id": doc.get("id"), "details": det},
                    }
                )
                n += 1

        async def _fetch_economy() -> None:
            if "economy" not in want:
                return
            econ_types = ["lottery_draw"] if wallet_gains_only else ["lottery_draw", "lottery_buy"]
            match_e: Dict[str, Any] = {"at": {"$gte": start_iso}, "type": {"$in": econ_types}}
            if uid_filter is not None:
                match_e["user_id"] = {"$in": uid_filter}
            cur = (
                db.economy_events.find(match_e, {"_id": 0})
                .sort("at", -1)
                .limit(min(2000, limit_per_source * 20))
            )
            n = 0
            async for doc in cur:
                if n >= limit_per_source:
                    break
                cash_e, _pts_e = _economy_event_extract_spike(doc)
                if cash_e is None or cash_e < float(min_cash):
                    continue
                at = _spike_parse_created_at(doc.get("at")) or now
                rows_out.append(
                    {
                        "at": at.isoformat(),
                        "source": "economy_events",
                        "user_id": doc.get("user_id"),
                        "username": doc.get("username"),
                        "kind": doc.get("type"),
                        "cash_delta": cash_e,
                        "points_delta": None,
                        "raw_ref": {k: v for k, v in doc.items() if k not in ("_id",)},
                    }
                )
                n += 1

        async def _fetch_analytics() -> None:
            if "analytics" not in want:
                return
            am0: Dict[str, Any] = {"created_at": {"$gte": start_dt}, "domain": {"$in": ["casino", "minigames"]}}
            if uid_filter is not None:
                am0["user_id"] = {"$in": uid_filter}
            pipeline = [
                {"$match": am0},
                {
                    "$addFields": {
                        "payout_tag": {
                            "$convert": {
                                "input": "$tags.payout",
                                "to": "double",
                                "onError": 0.0,
                                "onNull": 0.0,
                            }
                        },
                    }
                },
                {"$match": {"payout_tag": {"$gte": float(min_cash)}}},
                {"$sort": {"created_at": -1}},
                {"$limit": limit_per_source},
            ]
            async for doc in db.analytics_events.aggregate(pipeline):
                at = _spike_parse_created_at(doc.get("created_at")) or now
                rows_out.append(
                    {
                        "at": at.isoformat(),
                        "source": "analytics_events",
                        "user_id": doc.get("user_id"),
                        "username": doc.get("username"),
                        "kind": f'{doc.get("domain")}:{doc.get("metric")}',
                        "cash_delta": float(doc.get("payout_tag") or 0),
                        "points_delta": None,
                        "raw_ref": {
                            "idempotency_key": doc.get("idempotency_key"),
                            "value": doc.get("value"),
                            "tags": doc.get("tags"),
                        },
                    }
                )

        await asyncio.gather(_fetch_points(), _fetch_gambling(), _fetch_activity(), _fetch_economy(), _fetch_analytics())

        # Resolve usernames for point_ledger rows
        missing_ids = {r["user_id"] for r in rows_out if r.get("source") == "point_ledger" and r.get("user_id") and not r.get("username")}
        if missing_ids:
            udocs = await db.users.find({"id": {"$in": list(missing_ids)}}, {"_id": 0, "id": 1, "username": 1}).to_list(len(missing_ids))
            umap = {u["id"]: u.get("username") for u in udocs}
            for r in rows_out:
                if r.get("source") == "point_ledger" and r.get("user_id") in umap:
                    r["username"] = umap.get(r["user_id"])

        rows_out.sort(key=lambda r: r.get("at") or "", reverse=True)
        note_parts = [
            "Best-effort from existing logs; not every wallet $inc is logged.",
            "Economy overview 'Cash in circulation' is wallets only; stats Total cash includes Quick Trade escrow.",
        ]
        if wallet_gains_only:
            note_parts.insert(
                1,
                "Wallet-gains mode: activity rows use signed on-hand cash (hides spends, transfers out, shop buys).",
            )
        return {
            "window": {"start": start_iso, "end": now.isoformat().replace("+00:00", "Z"), "days": days},
            "thresholds": {"min_cash": min_cash, "min_points": min_points, "wallet_gains_only": wallet_gains_only},
            "sources_used": sorted(want),
            "limit_per_source": limit_per_source,
            "note": " ".join(note_parts),
            "rows": rows_out[: min(2000, len(rows_out))],
            "row_count": len(rows_out),
        }

    @router.get("/admin/players/activity-summary")
    async def admin_players_activity_summary(current_user: dict = Depends(get_current_user)):
        """What online players are doing: count per feature area (last 5 min)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        online = await db.users.find(
            {"last_action_at": {"$gte": cutoff}, "is_dead": {"$ne": True}},
            {"_id": 0, "last_action_page": 1},
        ).to_list(500)
        counts = {}
        for u in (online or []):
            page = u.get("last_action_page") or "unknown"
            counts[page] = counts.get(page, 0) + 1
        sorted_counts = sorted(counts.items(), key=lambda x: x[1], reverse=True)
        return {"total_online": len(online), "by_page": [{"page": p, "count": c} for p, c in sorted_counts]}

    @router.get("/admin/players/compare")
    async def admin_players_compare(
        user1: str = Query(..., description="Username 1"),
        user2: str = Query(..., description="Username 2"),
        current_user: dict = Depends(get_current_user),
    ):
        """Side-by-side comparison of two players for alt investigation."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or mod access required")
        fields = {
            "_id": 0, "id": 1, "username": 1, "email": 1, "money": 1, "bank_balance": 1,
            "points": 1, "rank_points": 1, "health": 1, "created_at": 1, "last_login": 1,
            "last_action_at": 1, "registration_ip": 1, "last_login_ip": 1,
            "device_fingerprint": 1, "user_agent": 1, "is_dead": 1, "prestige": 1,
        }
        u1 = await db.users.find_one({"username": re.compile(f"^{re.escape(user1)}$", re.IGNORECASE)}, fields)
        u2 = await db.users.find_one({"username": re.compile(f"^{re.escape(user2)}$", re.IGNORECASE)}, fields)
        if not u1:
            raise HTTPException(status_code=404, detail=f"User '{user1}' not found")
        if not u2:
            raise HTTPException(status_code=404, detail=f"User '{user2}' not found")
        same_ip = bool(
            u1.get("registration_ip") and u2.get("registration_ip")
            and u1["registration_ip"] == u2["registration_ip"]
        )
        same_device = bool(
            u1.get("device_fingerprint") and u2.get("device_fingerprint")
            and u1["device_fingerprint"] == u2["device_fingerprint"]
        )
        return {"user1": u1, "user2": u2, "same_ip": same_ip, "same_device": same_device}

    @router.get("/admin/system/health")
    async def admin_system_health(current_user: dict = Depends(get_current_user)):
        """System health: DB stats, document counts, server info."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        try:
            user_count = await db.users.count_documents({})
            alive_count = await db.users.count_documents({"is_dead": {"$ne": True}})
            car_count = await db.user_cars.count_documents({})
            family_count = await db.families.count_documents({})
            flag_count = await db.security_flags.count_documents({"resolved": {"$ne": True}})
            cutoff_5m = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            online_count = await db.users.count_documents({"last_action_at": {"$gte": cutoff_5m}, "is_dead": {"$ne": True}})
            return {
                "status": "healthy",
                "users_total": user_count,
                "users_alive": alive_count,
                "users_online": online_count,
                "cars": car_count,
                "families": family_count,
                "unresolved_flags": flag_count,
                "server_time": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            return {"status": "degraded", "error": str(e)}

    class MaintenanceBannerRequest(BaseModel):
        enabled: bool
        message: Optional[str] = None
        starts_at: Optional[str] = None
        duration_minutes: Optional[int] = None

    @router.get("/admin/maintenance-banner")
    async def admin_get_maintenance_banner(current_user: dict = Depends(get_current_user)):
        """Get current maintenance banner state."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_settings.find_one({"key": "maintenance_banner"}, {"_id": 0})
        if not doc:
            return {"enabled": False}
        return doc.get("value", {"enabled": False})

    @router.post("/admin/maintenance-banner")
    async def admin_set_maintenance_banner(req: MaintenanceBannerRequest, current_user: dict = Depends(get_current_user)):
        """Set or clear the maintenance banner."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        value = {
            "enabled": req.enabled,
            "message": req.message or "Scheduled maintenance in progress.",
            "starts_at": req.starts_at,
            "duration_minutes": req.duration_minutes,
            "set_by": current_user.get("username", "?"),
            "set_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.game_settings.update_one(
            {"key": "maintenance_banner"},
            {"$set": {"key": "maintenance_banner", "value": value}},
            upsert=True,
        )
        return {"message": f"Maintenance banner {'enabled' if req.enabled else 'disabled'}", **value}

    class ReleaseSoftLaunchRequest(BaseModel):
        enabled: bool
        game_pass_unlock_at: Optional[str] = None
        pvp_kills_unlock_at: Optional[str] = None
        force_game_pass_purchase_locked: Optional[bool] = None

    class GamePassSeasonSettingsRequest(BaseModel):
        season_end_at: str
        season_id: Optional[str] = None

    @router.get("/admin/release-soft-launch")
    async def admin_get_release_soft_launch(current_user: dict = Depends(get_current_user)):
        """Release soft-launch: separate unlock times for points/Game Pass vs PvP kills."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_settings.find_one({"key": RELEASE_SOFT_LAUNCH_KEY}, {"_id": 0, "value": 1})
        stored = (doc or {}).get("value") if doc else None
        if not isinstance(stored, dict):
            stored = {}
        pub = await get_release_soft_launch_public(db)
        return {**pub, "stored": stored}

    @router.post("/admin/release-soft-launch")
    async def admin_set_release_soft_launch(req: ReleaseSoftLaunchRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        doc = await db.game_settings.find_one({"key": RELEASE_SOFT_LAUNCH_KEY}, {"_id": 0, "value": 1})
        prev = (doc or {}).get("value") if isinstance((doc or {}).get("value"), dict) else {}
        unlock_raw = (req.game_pass_unlock_at or "").strip() if req.game_pass_unlock_at else ""
        game_pass_unlock_at = unlock_raw or prev.get("game_pass_unlock_at") or DEFAULT_GAME_PASS_UNLOCK_AT
        pvp_raw = (req.pvp_kills_unlock_at or "").strip() if req.pvp_kills_unlock_at else ""
        if pvp_raw:
            pvp_kills_unlock_at = pvp_raw
        else:
            pvp_kills_unlock_at = prev.get("pvp_kills_unlock_at") or game_pass_unlock_at
        if req.force_game_pass_purchase_locked is None:
            force_game_pass_purchase_locked = bool(prev.get("force_game_pass_purchase_locked"))
        else:
            force_game_pass_purchase_locked = bool(req.force_game_pass_purchase_locked)
        value = {
            "enabled": req.enabled,
            "game_pass_unlock_at": game_pass_unlock_at,
            "pvp_kills_unlock_at": pvp_kills_unlock_at,
            "force_game_pass_purchase_locked": force_game_pass_purchase_locked,
            "set_by": current_user.get("username", "?"),
            "set_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.game_settings.update_one(
            {"key": RELEASE_SOFT_LAUNCH_KEY},
            {"$set": {"key": RELEASE_SOFT_LAUNCH_KEY, "value": value}},
            upsert=True,
        )
        pub = await get_release_soft_launch_public(db)
        return {
            "message": f"Release soft-launch {'enabled' if req.enabled else 'disabled'}",
            **pub,
            "stored": value,
        }

    @router.get("/admin/game-pass-season")
    async def admin_get_game_pass_season(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        return await get_game_pass_season_public(db)

    @router.post("/admin/game-pass-season")
    async def admin_set_game_pass_season(req: GamePassSeasonSettingsRequest, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        season_end_at = normalize_game_pass_season_end_at(req.season_end_at)
        prev_doc = await db.game_settings.find_one({"key": GAME_PASS_SEASON_SETTINGS_KEY}, {"_id": 0, "value": 1})
        prev_raw = (prev_doc or {}).get("value")
        prev_val = prev_raw if isinstance(prev_raw, dict) else {}
        prev_sid = str(prev_val.get("season_id") or "").strip() or None
        new_sid = (req.season_id or "").strip() if req.season_id is not None else None
        season_id_out = new_sid if new_sid else (prev_sid or "1")
        value = {
            "season_end_at": season_end_at,
            "season_id": season_id_out,
            "set_by": current_user.get("username", "?"),
            "set_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.game_settings.update_one(
            {"key": GAME_PASS_SEASON_SETTINGS_KEY},
            {"$set": {"key": GAME_PASS_SEASON_SETTINGS_KEY, "value": value}},
            upsert=True,
        )
        return {
            "message": "Game Pass season end updated",
            **(await get_game_pass_season_public(db)),
        }

    class BulkUserActionRequest(BaseModel):
        usernames: list
        action: str  # give_points, give_money, lock, unlock, reset_daily_rewards
        value: Optional[int] = None

    @router.post("/admin/bulk-action")
    async def admin_bulk_user_action(req: BulkUserActionRequest, current_user: dict = Depends(get_current_user)):
        """Apply an action to multiple users at once."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        if not req.usernames or len(req.usernames) > 50:
            raise HTTPException(status_code=400, detail="Provide 1-50 usernames")
        usernames_lower = [u.strip().lower() for u in req.usernames if u.strip()]
        user_filter = {"username": {"$in": [re.compile(f"^{re.escape(u)}$", re.IGNORECASE) for u in usernames_lower]}}
        affected = 0
        if req.action == "give_points" and req.value:
            r = await db.users.update_many(user_filter, {"$inc": {"points": req.value}})
            affected = r.modified_count
        elif req.action == "give_money" and req.value:
            r = await db.users.update_many(user_filter, {"$inc": {"money": req.value}})
            affected = r.modified_count
        elif req.action == "lock":
            r = await db.users.update_many(user_filter, {"$set": {"locked": True, "locked_at": datetime.now(timezone.utc).isoformat(), "locked_reason": "Bulk lock by admin"}})
            affected = r.modified_count
        elif req.action == "unlock":
            r = await db.users.update_many(user_filter, {"$set": {"locked": False}, "$unset": {"locked_at": "", "locked_reason": ""}})
            affected = r.modified_count
        elif req.action == "reset_daily_rewards":
            r = await db.users.update_many(user_filter, {"$set": {"rps_plays": []}})
            ttt = await db.daily_rewards_ttt.delete_many({"user_id": {"$in": usernames_lower}})
            affected = r.modified_count
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")
        return {"message": f"Bulk '{req.action}' applied to {affected} user(s)", "affected": affected}

    # ─────────────────────────────────────────────────────────────────────────────
    # State Heads Admin (manage which family controls each state)
    # ─────────────────────────────────────────────────────────────────────────────

    @router.get("/admin/state-heads")
    async def admin_get_state_heads(current_user: dict = Depends(get_current_user)):
        """Get all state heads and detect families that are head of multiple states."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        get_state_heads = srv.get_state_heads
        heads = await get_state_heads()

        # Get family names for each head
        family_ids = [fid for fid in heads.values() if fid]
        families = {}
        if family_ids:
            fam_docs = await db.families.find({"id": {"$in": family_ids}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "head_of_state": 1}).to_list(len(family_ids))
            families = {f["id"]: f for f in fam_docs}

        # Build result with family info
        result = {}
        family_state_count = {}
        for state, fid in heads.items():
            if fid:
                fam = families.get(fid, {})
                result[state] = {
                    "family_id": fid,
                    "family_name": fam.get("name", "?"),
                    "family_tag": fam.get("tag", "?"),
                    "family_head_of_state_field": fam.get("head_of_state"),
                }
                family_state_count[fid] = family_state_count.get(fid, 0) + 1
            else:
                result[state] = None

        # Detect duplicates (families that are head of multiple states)
        duplicates = {fid: count for fid, count in family_state_count.items() if count > 1}
        duplicate_families = []
        for fid, count in duplicates.items():
            fam = families.get(fid, {})
            states_headed = [s for s, f in heads.items() if f == fid]
            duplicate_families.append({
                "family_id": fid,
                "family_name": fam.get("name", "?"),
                "states_headed": states_headed,
                "count": count,
            })

        return {
            "state_heads": result,
            "duplicates": duplicate_families,
            "has_duplicates": len(duplicate_families) > 0,
        }

    class ClearStateHeadRequest(BaseModel):
        state: str

    @router.post("/admin/state-heads/clear")
    async def admin_clear_state_head(req: ClearStateHeadRequest, current_user: dict = Depends(get_current_user)):
        """Clear the head family from a specific state."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")

        state = (req.state or "").strip()
        if state not in STATES:
            raise HTTPException(status_code=400, detail=f"Invalid state. Valid: {', '.join(STATES)}")

        set_state_head = srv.set_state_head
        get_state_heads = srv.get_state_heads

        heads = await get_state_heads()
        old_fid = heads.get(state)
        if not old_fid:
            return {"message": f"{state} has no head family", "state": state, "cleared": False}

        old_fam = await db.families.find_one({"id": old_fid}, {"_id": 0, "name": 1})
        await set_state_head(state, None)

        return {
            "message": f"Cleared {(old_fam or {}).get('name', old_fid)} from {state}",
            "state": state,
            "cleared_family_id": old_fid,
            "cleared_family_name": (old_fam or {}).get("name", "?"),
            "cleared": True,
        }

    @router.post("/admin/rackets/reset-cooldown")
    async def admin_reset_racket_cooldown(
        family_id: str,
        racket_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Reset a family racket's cooldown so it can be collected immediately. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        from routers.game.families import FAMILY_RACKETS
        valid_racket_ids = [r["id"] for r in FAMILY_RACKETS]
        if racket_id not in valid_racket_ids:
            raise HTTPException(status_code=400, detail=f"Invalid racket_id. Valid: {', '.join(valid_racket_ids)}")
        fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "rackets": 1})
        if not fam:
            raise HTTPException(status_code=404, detail="Family not found")
        rackets = (fam.get("rackets") or {}).copy()
        state = rackets.get(racket_id) or {}
        if state.get("level", 0) <= 0:
            raise HTTPException(status_code=400, detail="Racket not active (level 0)")
        # Set last_collected_at to 48h ago so cooldown has passed for any racket
        from datetime import datetime, timezone, timedelta
        past_time = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        rackets[racket_id] = {**state, "last_collected_at": past_time}
        await db.families.update_one({"id": family_id}, {"$set": {"rackets": rackets}})
        racket_name = next((r["name"] for r in FAMILY_RACKETS if r["id"] == racket_id), racket_id)
        return {
            "message": f"Reset {racket_name} cooldown for {(fam.get('name') or family_id)}. Racket can be collected now.",
            "family_id": family_id,
            "family_name": fam.get("name"),
            "racket_id": racket_id,
            "racket_name": racket_name,
        }

    # ─────────────────────────────────────────────────────────────────────────────
    # Mini Games Weekly Leaderboard Admin
    # ─────────────────────────────────────────────────────────────────────────────
    from routers.minigames.minigame_leaderboard import MINIGAME_LB_CONFIG_ID, DEFAULT_REWARDS, run_minigame_weekly_payout

    @router.get("/admin/minigame-leaderboard/config")
    async def get_minigame_lb_config(current_user: dict = Depends(get_current_user)):
        """Get mini games weekly leaderboard reward configuration."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cfg = await db.game_config.find_one({"id": MINIGAME_LB_CONFIG_ID}, {"_id": 0})
        rewards = (cfg or {}).get("rewards") or DEFAULT_REWARDS
        rewards_out = {}
        for k, v in rewards.items():
            rewards_out[str(k)] = v
        return {
            "config_id": MINIGAME_LB_CONFIG_ID,
            "rewards": rewards_out,
            "last_payout_week_start": (cfg or {}).get("last_payout_week_start"),
        }

    class MinigameLBRewardsUpdate(BaseModel):
        rewards: dict

    @router.post("/admin/minigame-leaderboard/config")
    async def update_minigame_lb_config(body: MinigameLBRewardsUpdate, current_user: dict = Depends(get_current_user)):
        """Update mini games weekly leaderboard rewards. rewards = {1: {cash, respect, loot_pieces, bullets}, ...}"""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        rewards = body.rewards or {}
        clean_rewards = {}
        for rank in range(1, 6):
            r = rewards.get(rank) or rewards.get(str(rank)) or DEFAULT_REWARDS.get(rank, {})
            clean_rewards[rank] = {
                "cash": int(r.get("cash") or 0),
                "respect": int(r.get("respect") or 0),
                "loot_pieces": int(r.get("loot_pieces") or 0),
                "bullets": int(r.get("bullets") or 0),
            }
        await db.game_config.update_one(
            {"id": MINIGAME_LB_CONFIG_ID},
            {"$set": {"rewards": clean_rewards}},
            upsert=True,
        )
        return {"message": "Mini games leaderboard rewards updated", "rewards": clean_rewards}

    @router.post("/admin/minigame-leaderboard/test-payout")
    async def test_minigame_lb_payout(current_user: dict = Depends(get_current_user)):
        """Test mini games weekly payout (no actual rewards given)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        await run_minigame_weekly_payout(db, test_run=True)
        return {"message": "Test payout completed (no rewards given). Check logs for details."}

    @router.get("/admin/minigame-leaderboard/history")
    async def get_minigame_lb_payout_history(current_user: dict = Depends(get_current_user)):
        """Get past mini games payout history."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cursor = db.minigame_payout_history.find({}, {"_id": 0}).sort("paid_at", -1).limit(10)
        history = await cursor.to_list(10)
        return {"history": history}

    @router.get("/admin/leaderboard-weekly-payouts")
    async def get_weekly_leaderboard_payouts(
        username: str = "",
        category: str = "",
        week_start: str = "",
        limit: int = 200,
        current_user: dict = Depends(get_current_user),
    ):
        """Get past main-game weekly leaderboard payout entries (admin audit)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")

        query: Dict[str, object] = {}
        if username.strip():
            # Exact username match, case-insensitive
            u = username.strip()
            query["username"] = {"$regex": f"^{u}$", "$options": "i"}

        cat = (category or "").strip().lower()
        if cat and cat != "all":
            allowed = {"kills", "crimes", "gta", "jail_busts"}
            if cat not in allowed:
                raise HTTPException(status_code=400, detail=f"Invalid category. Allowed: {sorted(allowed)}")
            query["category"] = cat

        if week_start.strip():
            query["week_start"] = week_start.strip()

        cap = min(max(1, int(limit) if limit is not None else 200), 1000)
        cursor = (
            db.leaderboard_weekly_payouts.find(query, {"_id": 0})
            .sort("paid_at", -1)
            .limit(cap)
        )
        rows = await cursor.to_list(cap)
        return {"entries": rows, "count": len(rows)}

    class WeeklyLbWrongPointsFixBody(BaseModel):
        week_starts: List[str] = Field(
            ...,
            min_length=1,
            description="week_start values matching leaderboard_weekly_payouts (YYYY-MM-DD, Monday UTC week key)",
        )
        dry_run: bool = Field(True, description="If true, only return preview (no DB writes)")
        refund_points: bool = Field(True, description="Add back wrongly removed game points")
        reverse_duplicate_respect: bool = Field(
            True,
            description="Subtract the same amount from respect_points (undoes duplicate from mistaken second pass)",
        )
        force_repeat: bool = Field(False, description="Apply even if a week is already listed in weekly_lb_points_fix_applied_weeks")

    @router.post("/admin/leaderboard-weekly-payouts/fix-wrong-points-deduction")
    async def admin_fix_weekly_lb_wrong_points_deduction(
        body: WeeklyLbWrongPointsFixBody,
        current_user: dict = Depends(get_current_user),
    ):
        """
        Reverses the bug where a follow-up weekly payout tick debited `users.points` (and duplicated `respect_points`)
        after a correct respect-only payout. Uses audit rows in leaderboard_weekly_payouts to compute per-user amounts.

        Run with dry_run=true first, then dry_run=false. Weeks are recorded in game_config.leaderboard_weekly_payout.weekly_lb_points_fix_applied_weeks to avoid double-apply.
        """
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")

        cfg = await db.game_config.find_one(
            {"id": leaderboard_module.LEADERBOARD_PAYOUT_CONFIG_ID},
            {"_id": 0, "weekly_lb_points_fix_applied_weeks": 1},
        )
        applied: Set[str] = set(cfg.get("weekly_lb_points_fix_applied_weeks") or [])

        weeks_in = [str(w).strip() for w in body.week_starts if str(w).strip()]
        if not weeks_in:
            raise HTTPException(status_code=400, detail="No valid week_starts")

        skipped_weeks: List[str] = []
        to_process: List[str] = []
        for w in weeks_in:
            if w in applied and not body.force_repeat:
                skipped_weeks.append(w)
            else:
                to_process.append(w)

        preview: List[Dict[str, Any]] = []
        total_users = 0
        total_points_refund = 0

        for week in to_process:
            rows = await leaderboard_module.aggregate_weekly_payout_refund_amounts_by_user(db, week)
            if not rows:
                preview.append({"week_start": week, "error": "no_audit_rows", "users": []})
                continue
            for r in rows:
                preview.append(
                    {
                        "week_start": week,
                        "user_id": r["user_id"],
                        "username": r.get("username") or "",
                        "refund_points": r["refund_points"],
                    }
                )
            total_users += len(rows)
            total_points_refund += sum(int(r["refund_points"]) for r in rows)

        out: Dict[str, Any] = {
            "dry_run": body.dry_run,
            "skipped_weeks": skipped_weeks,
            "weeks_to_process": to_process,
            "preview_rows": preview,
            "distinct_users": total_users,
            "sum_refund_points": total_points_refund,
        }

        if body.dry_run or not to_process:
            return out

        updated_users = 0
        for week in to_process:
            rows = await leaderboard_module.aggregate_weekly_payout_refund_amounts_by_user(db, week)
            if not rows:
                continue
            for r in rows:
                uid = r["user_id"]
                amt = int(r["refund_points"])
                if amt <= 0:
                    continue
                inc: Dict[str, int] = {}
                if body.refund_points:
                    inc["points"] = amt
                if body.reverse_duplicate_respect:
                    inc["respect_points"] = -amt
                if not inc:
                    continue
                await db.users.update_one({"id": uid}, {"$inc": inc})
                updated_users += 1
                if body.refund_points:
                    await log_points_event(
                        db,
                        user_id=uid,
                        points=amt,
                        event_type="leaderboard_payout_points_correction",
                        meta={"week_start": week, "admin": current_user.get("username")},
                    )
                if body.reverse_duplicate_respect:
                    await log_respect_delta(uid, -amt, "leaderboard_weekly_payout_correction")

        await db.game_config.update_one(
            {"id": leaderboard_module.LEADERBOARD_PAYOUT_CONFIG_ID},
            {"$addToSet": {"weekly_lb_points_fix_applied_weeks": {"$each": to_process}}},
        )
        leaderboard_module.invalidate_leaderboard_cache()
        out["applied"] = True
        out["users_updated"] = updated_users
        return out

    @router.get("/admin/leaderboard-weekly-payouts/compare-weeks")
    async def admin_compare_weekly_lb_bug_weeks(
        week_a: str = Query(..., description="First week_start (YYYY-MM-DD)"),
        week_b: str = Query(..., description="Second week_start (YYYY-MM-DD)"),
        current_user: dict = Depends(get_current_user),
    ):
        """Compare two weeks for leaderboard points-bug impact and refunds."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")

        wa = (week_a or "").strip()
        wb = (week_b or "").strip()
        if not wa or not wb:
            raise HTTPException(status_code=400, detail="Both week_a and week_b are required")

        async def _get_refunded_points_by_user(week_start: str) -> Dict[str, int]:
            pipeline = [
                {
                    "$match": {
                        "event_type": "leaderboard_payout_points_correction",
                        "meta.week_start": week_start,
                    }
                },
                {
                    "$group": {
                        "_id": "$user_id",
                        "points_refunded": {
                            "$sum": {
                                "$cond": [
                                    {"$gt": ["$points", 0]},
                                    "$points",
                                    0,
                                ]
                            }
                        },
                    }
                },
            ]
            rows = await db.point_ledger_events.aggregate(pipeline).to_list(5000)
            out: Dict[str, int] = {}
            for row in rows:
                uid = str(row.get("_id") or "").strip()
                if not uid:
                    continue
                out[uid] = int(row.get("points_refunded") or 0)
            return out

        async def _build_week_summary(week_start: str) -> Dict[str, Any]:
            taken_rows = await leaderboard_module.aggregate_weekly_payout_refund_amounts_by_user(db, week_start)
            refunded_map = await _get_refunded_points_by_user(week_start)

            taken_map: Dict[str, int] = {}
            all_ids: Set[str] = set()
            for row in taken_rows:
                uid = str(row.get("user_id") or "").strip()
                if not uid:
                    continue
                all_ids.add(uid)
                taken_map[uid] = int(row.get("refund_points") or 0)
            all_ids.update(refunded_map.keys())

            users_map: Dict[str, str] = {}
            if all_ids:
                users = await db.users.find(
                    {"id": {"$in": list(all_ids)}},
                    {"_id": 0, "id": 1, "username": 1},
                ).to_list(len(all_ids) + 1)
                users_map = {str(u.get("id") or ""): (u.get("username") or "") for u in users}

            user_rows: List[Dict[str, Any]] = []
            for uid in sorted(all_ids):
                taken_amt = int(taken_map.get(uid) or 0)
                refunded_amt = int(refunded_map.get(uid) or 0)
                if taken_amt <= 0 and refunded_amt <= 0:
                    continue
                user_rows.append(
                    {
                        "user_id": uid,
                        "username": users_map.get(uid) or "",
                        "points_taken_from_bug": taken_amt,
                        "points_refunded_from_bug": refunded_amt,
                        "points_outstanding": taken_amt - refunded_amt,
                    }
                )
            user_rows.sort(
                key=lambda x: (
                    -(int(x.get("points_taken_from_bug") or 0)),
                    -(int(x.get("points_refunded_from_bug") or 0)),
                    str(x.get("username") or ""),
                )
            )

            total_taken = sum(int(r.get("points_taken_from_bug") or 0) for r in user_rows)
            total_refunded = sum(int(r.get("points_refunded_from_bug") or 0) for r in user_rows)
            return {
                "week_start": week_start,
                "user_count": len(user_rows),
                "points_taken_from_bug_total": total_taken,
                "points_refunded_from_bug_total": total_refunded,
                "points_outstanding_total": total_taken - total_refunded,
                "users": user_rows,
            }

        summary_a, summary_b = await asyncio.gather(
            _build_week_summary(wa),
            _build_week_summary(wb),
        )
        return {
            "week_a": summary_a,
            "week_b": summary_b,
            "delta_week_b_minus_week_a": {
                "points_taken_from_bug_total": int(summary_b["points_taken_from_bug_total"]) - int(summary_a["points_taken_from_bug_total"]),
                "points_refunded_from_bug_total": int(summary_b["points_refunded_from_bug_total"]) - int(summary_a["points_refunded_from_bug_total"]),
                "points_outstanding_total": int(summary_b["points_outstanding_total"]) - int(summary_a["points_outstanding_total"]),
            },
        }

    @router.get("/admin/leaderboard-weekly-payouts/verify-rewards")
    async def admin_verify_weekly_lb_rewards(
        week_start: str = Query(..., description="week_start (YYYY-MM-DD)"),
        include_entries: bool = Query(True, description="Include category/rank entry list"),
        current_user: dict = Depends(get_current_user),
    ):
        """Verify weekly leaderboard rewards using payout audit + correction ledger."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")

        ws = (week_start or "").strip()
        if not ws:
            raise HTTPException(status_code=400, detail="week_start is required")

        # Configured rewards (same source as weekly payout runner).
        cfg = await db.game_config.find_one(
            {"id": leaderboard_module.LEADERBOARD_PAYOUT_CONFIG_ID},
            {
                "_id": 0,
                "top1_points": 1,
                "top2_points": 1,
                "top3_points": 1,
                "top4_10_points": 1,
            },
        ) or {}
        top1 = int(cfg.get("top1_points", leaderboard_module.DEFAULT_TOP1_POINTS) or leaderboard_module.DEFAULT_TOP1_POINTS)
        top2 = int(cfg.get("top2_points", leaderboard_module.DEFAULT_TOP2_POINTS) or leaderboard_module.DEFAULT_TOP2_POINTS)
        top3 = int(cfg.get("top3_points", leaderboard_module.DEFAULT_TOP3_POINTS) or leaderboard_module.DEFAULT_TOP3_POINTS)
        top4_10 = int(cfg.get("top4_10_points", leaderboard_module.DEFAULT_TOP4_10_POINTS) or leaderboard_module.DEFAULT_TOP4_10_POINTS)

        def _expected_for_rank(rank: int) -> int:
            r = int(rank or 0)
            if r <= 0:
                return 0
            if r == 1:
                return top1
            if r == 2:
                return top2
            if r == 3:
                return top3
            if 4 <= r <= 10:
                return top4_10
            return 0

        payout_entries = await db.leaderboard_weekly_payouts.find(
            {"week_start": ws},
            {"_id": 0},
        ).sort([("category", 1), ("rank", 1), ("user_id", 1)]).to_list(2000)

        if not payout_entries:
            return {
                "week_start": ws,
                "summary": {
                    "winners_count": 0,
                    "entries_count": 0,
                    "respect_expected_total": 0,
                    "points_taken_from_bug_total": 0,
                    "points_refunded_from_bug_total": 0,
                    "points_outstanding_total": 0,
                    "structure_mismatch_count": 0,
                },
                "users": [],
                "entries": [],
            }

        by_user: Dict[str, Dict[str, Any]] = {}
        structure_mismatch_count = 0
        for row in payout_entries:
            uid = str(row.get("user_id") or "").strip()
            if not uid:
                continue
            if uid not in by_user:
                by_user[uid] = {
                    "user_id": uid,
                    "username": row.get("username") or "",
                    "respect_expected": 0,
                    "points_taken_from_bug": 0,
                    "points_refunded_from_bug": 0,
                    "points_outstanding_from_bug": 0,
                    "user_week_total_points_reported": 0,
                    "structure_status": "match",
                    "structure_notes": [],
                    "entries": [],
                }

            rank = int(row.get("rank") or 0)
            points_awarded = int(row.get("points_awarded") or 0)
            expected_for_rank = _expected_for_rank(rank)
            if points_awarded != expected_for_rank:
                structure_mismatch_count += 1
                by_user[uid]["structure_status"] = "mismatch"
                by_user[uid]["structure_notes"].append(
                    f"{row.get('category') or '?'} rank {rank}: expected {expected_for_rank}, recorded {points_awarded}"
                )

            by_user[uid]["respect_expected"] += points_awarded
            by_user[uid]["points_taken_from_bug"] += points_awarded
            by_user[uid]["user_week_total_points_reported"] = int(
                row.get("user_week_total_points") or by_user[uid]["user_week_total_points_reported"] or 0
            )
            by_user[uid]["entries"].append(
                {
                    "category": row.get("category") or "",
                    "rank": rank,
                    "event_value": int(row.get("event_value") or 0),
                    "points_awarded": points_awarded,
                    "expected_points_for_rank": expected_for_rank,
                    "paid_at": row.get("paid_at"),
                }
            )

        # Validate per-user total from row-level entries against stored `user_week_total_points`.
        for u in by_user.values():
            calc_total = sum(int(e.get("points_awarded") or 0) for e in u.get("entries") or [])
            reported_total = int(u.get("user_week_total_points_reported") or 0)
            if calc_total != reported_total:
                u["structure_status"] = "mismatch"
                u["structure_notes"].append(
                    f"user_week_total_points mismatch: expected sum {calc_total}, recorded {reported_total}"
                )
                structure_mismatch_count += 1

        refund_rows = await db.point_ledger_events.aggregate(
            [
                {
                    "$match": {
                        "event_type": "leaderboard_payout_points_correction",
                        "meta.week_start": ws,
                    }
                },
                {
                    "$group": {
                        "_id": "$user_id",
                        "points_refunded": {
                            "$sum": {
                                "$cond": [
                                    {"$gt": ["$points", 0]},
                                    "$points",
                                    0,
                                ]
                            }
                        },
                    }
                },
            ]
        ).to_list(5000)
        refunds_by_user = {str(r.get("_id") or ""): int(r.get("points_refunded") or 0) for r in refund_rows}

        for uid, u in by_user.items():
            refunded = int(refunds_by_user.get(uid) or 0)
            taken = int(u.get("points_taken_from_bug") or 0)
            outstanding = taken - refunded
            u["points_refunded_from_bug"] = refunded
            u["points_outstanding_from_bug"] = outstanding
            if refunded == 0:
                refund_status = "none"
            elif refunded < taken:
                refund_status = "partial"
            elif refunded == taken:
                refund_status = "full"
            else:
                refund_status = "over"
            u["bug_refund_status"] = refund_status
            if include_entries is not True:
                u.pop("entries", None)

        user_rows = list(by_user.values())
        user_rows.sort(
            key=lambda r: (
                str(r.get("structure_status") or ""),
                str(r.get("bug_refund_status") or ""),
                -int(r.get("respect_expected") or 0),
                str(r.get("username") or ""),
            )
        )

        respect_expected_total = sum(int(r.get("respect_expected") or 0) for r in user_rows)
        points_refunded_total = sum(int(r.get("points_refunded_from_bug") or 0) for r in user_rows)
        points_taken_total = sum(int(r.get("points_taken_from_bug") or 0) for r in user_rows)

        return {
            "week_start": ws,
            "reward_config": {
                "top1_points": top1,
                "top2_points": top2,
                "top3_points": top3,
                "top4_10_points": top4_10,
            },
            "summary": {
                "winners_count": len(user_rows),
                "entries_count": len(payout_entries),
                "respect_expected_total": respect_expected_total,
                "points_taken_from_bug_total": points_taken_total,
                "points_refunded_from_bug_total": points_refunded_total,
                "points_outstanding_total": points_taken_total - points_refunded_total,
                "structure_mismatch_count": structure_mismatch_count,
            },
            "users": user_rows,
            "entries": payout_entries if include_entries else [],
        }

    # ─────────────────────────────────────────────────────────────────────────────
    # Minigame Play Payouts Log (Admin Only)
    # ─────────────────────────────────────────────────────────────────────────────
    @router.get("/admin/minigame-payouts")
    async def get_minigame_play_payouts(
        username: str = "",
        game: str = "",
        limit: int = 100,
        current_user: dict = Depends(get_current_user),
    ):
        """Return recent minigame play payout records for admin auditing."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        query = {}
        if username.strip():
            query["username"] = {"$regex": f"^{username.strip()}$", "$options": "i"}
        if game.strip():
            query["game"] = game.strip()
        cap = min(max(1, limit), 500)
        cursor = db.minigame_play_payouts.find(query, {"_id": 0}).sort("created_at", -1).limit(cap)
        rows = await cursor.to_list(cap)
        return {"entries": rows, "count": len(rows)}

    # ─────────────────────────────────────────────────────────────────────────────
    # Lifetime Objectives Testing (Admin Only)
    # ─────────────────────────────────────────────────────────────────────────────
    from routers.account.objectives import OBJECTIVE_TYPES_LIFETIME

    @router.post("/admin/test-lifetime-objectives-almost-complete")
    async def admin_test_lifetime_objectives_almost_complete(current_user: dict = Depends(get_current_user)):
        """Populate admin's account to be almost complete on lifetime objectives (5 crimes away).
        Sets all lifetime objective progress fields to target - 5 (crimes) or target (others).
        This is for testing the admin notification when a user is close to completing."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")

        user_id = current_user["id"]

        # Build update doc: set all lifetime stats to near-completion values
        update_set = {
            "objectives_lifetime_close_notified": False,  # Reset so notification triggers again
            "objectives_lifetime_claimed": False,  # Reset so they can test claiming
        }
        update_inc = {}

        # Set direct user fields for lifetime objectives
        # crimes is set to target - 5, all others to target
        for obj in OBJECTIVE_TYPES_LIFETIME:
            key = obj["progress_key"]
            target = obj["target"]
            if obj["id"] == "crimes":
                update_set["total_crimes"] = target - 5  # 5 crimes away from completion
            elif key == "total_gta":
                update_set["total_gta"] = target
            elif key == "total_oc_heists":
                update_set["total_oc_heists"] = target
            elif key == "jail_busts":
                update_set["jail_busts"] = target
            elif key == "bullets_melted":
                update_set["bullets_melted"] = target
            elif key == "crime_profit":
                update_set["crime_profit"] = target
            elif key == "booze_runs_count":
                update_set["booze_runs_count"] = target
            elif key == "hitlist_npc_kills":
                update_set["hitlist_npc_kills"] = target

        # For lifetime_respect_earned (aggregate) - insert respect events
        # Delete existing and insert new to reach target
        respect_target = 15000
        await db.respect_events.delete_many({"user_id": user_id})
        await db.respect_events.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "amount": respect_target,
            "reason": "Admin test - lifetime objectives",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        # For minigame_plays (aggregate) - insert minigame play records
        minigame_target = 1000
        await db.minigame_plays.delete_many({"user_id": user_id})
        for i in range(minigame_target):
            await db.minigame_plays.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "game": "test",
                "score": 0,
                "played_at": datetime.now(timezone.utc).isoformat(),
            })

        await db.users.update_one({"id": user_id}, {"$set": update_set})

        return {
            "message": "Lifetime objectives set to almost complete (5 crimes away). Visit objectives page to trigger admin notification.",
            "total_crimes_set_to": update_set.get("total_crimes"),
            "all_other_objectives": "completed",
        }

    @router.get("/admin/kill-debug/{username}")
    async def admin_kill_debug(username: str, current_user: dict = Depends(get_current_user)):
        """Return the actual attack_attempts that count toward a user's kill total. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin access required")
        target = await db.users.find_one(
            {"username": _username_pattern(username)},
            {"_id": 0, "id": 1, "username": 1, "total_kills": 1,
             "hitlist_npc_kills": 1, "robot_bodyguard_kills": 1,
             "total_kills_excludes_npc_v1": 1, "is_npc": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        uid = target["id"]

        npc_ids = []
        async for npc in db.users.find({"is_npc": True, "is_bodyguard": {"$ne": True}}, {"_id": 0, "id": 1}):
            if npc.get("id"):
                npc_ids.append(npc["id"])

        query = {
            "attacker_id": uid,
            "outcome": "killed",
            "$or": [
                {"target_id": {"$nin": npc_ids}},
                {"is_bodyguard_kill": True},
            ],
        }
        counted_kills = []
        async for doc in db.attack_attempts.find(query).sort("created_at", -1).limit(50):
            counted_kills.append({
                "id": doc.get("id"),
                "target_username": doc.get("target_username"),
                "target_id": doc.get("target_id"),
                "target_is_npc": doc.get("target_is_npc"),
                "is_npc_kill": doc.get("is_npc_kill"),
                "is_bodyguard_kill": doc.get("is_bodyguard_kill"),
                "outcome": doc.get("outcome"),
                "created_at": str(doc.get("created_at") or ""),
            })
        counted_total = await db.attack_attempts.count_documents(query)

        effective = effective_player_kill_count(target)

        return {
            "username": target.get("username"),
            "stored_total_kills": int(target.get("total_kills") or 0),
            "effective_kill_count": effective,
            "total_kills_excludes_npc_v1": bool(target.get("total_kills_excludes_npc_v1")),
            "hitlist_npc_kills": int(target.get("hitlist_npc_kills") or 0),
            "robot_bodyguard_kills": int(target.get("robot_bodyguard_kills") or 0),
            "npc_ids_excluded": len(npc_ids),
            "counted_from_attempts": counted_total,
            "attempts": counted_kills,
        }
