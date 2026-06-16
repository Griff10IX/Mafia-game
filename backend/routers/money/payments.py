# Payments: Stripe Checkout (redirect), status, webhook. Idempotent credit to prevent double-credit exploit.
import os
import asyncio
import logging
import hashlib
from datetime import datetime, timezone, timedelta, date

from typing import Any, Dict, Optional, Tuple

from fastapi import Depends, HTTPException, Query, Request
from pydantic import BaseModel

from server import send_notification, _get_staff_user_ids
from utils.game_pass_season import (
    DEFAULT_GAME_PASS_SEASON_END_AT,
    get_game_pass_season_public,
)
from utils.point_provenance import mint_purchase_lot_if_missing, log_points_event
from utils.store_points_pricing import (
    CUSTOM_POINTS_PACKAGE_ID,
    CUSTOM_POINTS_MAX,
    CUSTOM_POINTS_MIN,
    gbp_to_minor_pence,
    price_gbp_for_points,
    points_and_price_for_gbp_budget,
    validate_custom_gbp_budget,
    validate_custom_points_input,
)

logger = logging.getLogger(__name__)

# GBP store points (Stripe): bonus loot box pieces — 50 pieces per whole £1 charged (~5,000 per £100; currency must be GBP).
STORE_POINTS_LOOT_GBP_MINOR_PER_BLOCK = 100
STORE_POINTS_LOOT_PIECES_PER_BLOCK = 50
STORE_POINTS_EVENT_BONUS_RATE = 0.50

RANK_XP_PASS_PACKAGE_ID = "rank_xp_pass_499"
AUTO_RANK_PERMANENT_PACKAGE_ID = "auto_rank_permanent_2000"
# No new Game Pass checkout while an active pass is within this many days of rank_xp_pass_token_expires_at.
GAME_PASS_PURCHASE_CLOSE_WINDOW_DAYS = 7
GAME_PASS_SEASON_END_AT = DEFAULT_GAME_PASS_SEASON_END_AT


def game_pass_purchase_blocked_in_final_window(
    user: Optional[dict],
    now: datetime,
    *,
    season_end_at: Optional[str] = None,
) -> Optional[str]:
    """
    Block Game Pass purchases for everyone in the final N days before the global season end.
    """
    season_end_dt = _parse_utc(season_end_at or GAME_PASS_SEASON_END_AT)
    if not season_end_dt or season_end_dt <= now:
        return None
    remaining = season_end_dt - now
    if remaining > timedelta(days=GAME_PASS_PURCHASE_CLOSE_WINDOW_DAYS):
        return None
    return (
        f"Game Pass is not available for purchase in the final {GAME_PASS_PURCHASE_CLOSE_WINDOW_DAYS} days before this season ends. "
        "You can buy again when the new season releases."
    )


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
    """Add calendar months (e.g. Jan 31 -> Feb 28/29) in UTC."""
    import calendar

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    y = dt.year + (dt.month - 1 + months) // 12
    m = (dt.month - 1 + months) % 12 + 1
    # Clamp day to end of target month
    last_day = calendar.monthrange(y, m)[1]
    d = min(dt.day, last_day)
    return dt.replace(year=y, month=m, day=d)


class CheckoutRequest(BaseModel):
    package_id: str
    origin_url: str
    # When package_id is "custom", send exactly one of: integer points in [CUSTOM_POINTS_MIN, CUSTOM_POINTS_MAX], or GBP budget.
    custom_points: Optional[int] = None
    custom_gbp: Optional[float] = None


class BuyGamePassWithPointsRequest(BaseModel):
    """In-game purchase for the Game Pass using points (no Stripe)."""
    origin_url: Optional[str] = None


def _get_stripe_key():
    """Secret key for Stripe API. Prefer STRIPE_SECRET_KEY; fallback STRIPE_API_KEY."""
    return os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")


async def _notify_staff_manual_credit_pending(
    db,
    *,
    session_id: str,
    user_id: str,
    package_id: str,
    points: int,
    manual_eta: Optional[str],
) -> None:
    """Inbox all staff when a paid session is held for manual points credit (store_points_auto_credit off)."""
    username = ""
    try:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        if u:
            username = (u.get("username") or "").strip()[:64]
    except Exception:
        pass
    eta_line = (manual_eta or "").strip() or "—"
    title = "Store points — manual credit needed"
    msg = (
        "A player paid for points while automatic crediting is turned off in settings. "
        "Credit them in Admin → Payments (manual credit / check Stripe session).\n\n"
        f"User: {username or '(unknown)'} ({user_id})\n"
        f"Points: {points:,}\n"
        f"Package: {package_id}\n"
        f"Stripe session: {session_id}\n"
        f"ETA shown to players (informational): {eta_line}"
    )
    try:
        staff_ids = await _get_staff_user_ids()
        for staff_uid in staff_ids:
            try:
                await send_notification(staff_uid, title, msg, "staff_store_manual_credit")
            except Exception as e:
                logger.warning("staff manual credit inbox notify %s: %s", staff_uid, e)
    except Exception:
        logger.exception("notify_staff_manual_credit_pending failed")


async def _notify_staff_game_pass_fulfillment_blocked(
    db,
    *,
    session_id: str,
    user_id: str,
    detail: str,
) -> None:
    """Inbox staff when Stripe captured payment but Game Pass cannot be auto-fulfilled (e.g. final window rule)."""
    username = ""
    try:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        if u:
            username = (u.get("username") or "").strip()[:64]
    except Exception:
        pass
    title = "Game Pass payment — fulfillment blocked"
    msg = (
        "Stripe payment was received but the Game Pass was not granted automatically. "
        "Resolve in Admin (Payments / user account).\n\n"
        f"User: {username or '(unknown)'} ({user_id})\n"
        f"Stripe session: {session_id}\n"
        f"Detail: {(detail or '')[:800]}"
    )
    try:
        staff_ids = await _get_staff_user_ids()
        for staff_uid in staff_ids:
            try:
                await send_notification(staff_uid, title, msg, "staff_game_pass_fulfillment_blocked")
            except Exception as e:
                logger.warning("staff fulfillment blocked inbox notify %s: %s", staff_uid, e)
    except Exception:
        logger.exception("notify_staff_game_pass_fulfillment_blocked failed")


async def _notify_staff_custom_points_fulfillment_blocked(
    db,
    *,
    session_id: str,
    user_id: str,
    detail: str,
) -> None:
    """Inbox staff when Stripe paid amount does not match custom points checkout (possible tampering or bug)."""
    username = ""
    try:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        if u:
            username = (u.get("username") or "").strip()[:64]
    except Exception:
        pass
    title = "Store custom points — fulfillment blocked (amount mismatch)"
    msg = (
        "Stripe reported a paid amount that does not match the server-expected pence for a custom points checkout.\n\n"
        f"User: {username or '(unknown)'} ({user_id})\n"
        f"Stripe session: {session_id}\n"
        f"Detail: {(detail or '')[:800]}"
    )
    try:
        staff_ids = await _get_staff_user_ids()
        for staff_uid in staff_ids:
            try:
                await send_notification(staff_uid, title, msg, "staff_store_custom_fulfillment_blocked")
            except Exception as e:
                logger.warning("staff custom fulfillment blocked notify %s: %s", staff_uid, e)
    except Exception:
        logger.exception("notify_staff_custom_points_fulfillment_blocked failed")


def loot_box_pieces_for_gbp_stripe_minor(amount_minor: Optional[int], currency: Optional[str]) -> int:
    """Whole £1 blocks (100 pence each) → 50 loot box pieces (~5,000 per £100). Non-GBP or invalid → 0."""
    if amount_minor is None:
        return 0
    cur = (currency or "gbp").strip().lower()
    if cur != "gbp":
        return 0
    try:
        m = int(amount_minor)
    except (TypeError, ValueError):
        return 0
    if m <= 0:
        return 0
    return (m // STORE_POINTS_LOOT_GBP_MINOR_PER_BLOCK) * STORE_POINTS_LOOT_PIECES_PER_BLOCK


def _utc_epoch_day(dt: datetime) -> int:
    n = dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    midnight = datetime(n.year, n.month, n.day, tzinfo=timezone.utc)
    return int(midnight.timestamp() // 86400)


def _store_points_event_base_active_on_epoch_day(epoch_day: int) -> bool:
    seed = hashlib.sha256(f"store-points-event-day:{epoch_day}".encode("utf-8")).digest()
    return (seed[0] % 3) != 0  # ~67% random on-days


def _store_points_event_active_on_epoch_day(epoch_day: int) -> bool:
    """Deterministic per UTC day; never two consecutive inactive days."""
    if _store_points_event_base_active_on_epoch_day(epoch_day):
        return True
    if epoch_day > 0 and not _store_points_event_base_active_on_epoch_day(epoch_day - 1):
        return True
    return False


def _store_points_event_active_weekdays_for_week(year: int, week: int) -> list[int]:
    """ISO week weekdays (0=Mon … 6=Sun) when the sale is scheduled on."""
    out: list[int] = []
    for iso_wd in range(1, 8):
        d = date.fromisocalendar(year, week, iso_wd)
        ed = _utc_epoch_day(datetime(d.year, d.month, d.day, tzinfo=timezone.utc))
        if _store_points_event_active_on_epoch_day(ed):
            out.append(iso_wd - 1)
    return out


def _store_points_event_payload(
    now: Optional[datetime] = None,
    *,
    enabled: bool = True,
    force_until: Optional[str] = None,
) -> dict:
    """Deterministic store points sale: ~random daily schedule, never off two UTC days in a row."""
    n = now or datetime.now(timezone.utc)
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    n = n.astimezone(timezone.utc)
    iso = n.isocalendar()
    week_key = f"{iso.year}-W{iso.week:02d}"
    epoch_day = _utc_epoch_day(n)
    schedule_active = _store_points_event_active_on_epoch_day(epoch_day)
    active_weekdays = _store_points_event_active_weekdays_for_week(iso.year, iso.week)
    forced_until_dt = _parse_utc(force_until)
    forced_active = bool(enabled) and bool(forced_until_dt and forced_until_dt > n)
    active = bool(enabled) and (forced_active or schedule_active)
    mult = 1.0 + STORE_POINTS_EVENT_BONUS_RATE
    bonus_pct = int(round(STORE_POINTS_EVENT_BONUS_RATE * 100))
    return {
        "id": f"store_points_bonus_{week_key}",
        "name": "Store Points Bonus",
        "message": f"Store point purchases get +{bonus_pct}% extra points today.",
        "enabled": bool(enabled),
        "active": active,
        "forced_active": forced_active,
        "force_until": force_until if forced_active else None,
        "bonus_rate": STORE_POINTS_EVENT_BONUS_RATE,
        "multiplier": mult,
        "active_weekdays": active_weekdays,
        "week_key": week_key,
    }


async def _store_points_event_payload_for_db(db, now: Optional[datetime] = None) -> dict:
    settings = await db.game_settings.find_one(
        {"_id": "main"},
        {"_id": 0, "store_points_event_enabled": 1, "store_points_event_force_until": 1},
    )
    enabled = True if settings is None or settings.get("store_points_event_enabled") is None else bool(settings.get("store_points_event_enabled"))
    return _store_points_event_payload(now, enabled=enabled, force_until=(settings or {}).get("store_points_event_force_until"))


def _apply_store_points_event_bonus(base_points: int, event: Optional[dict]) -> tuple[int, int, Optional[dict]]:
    base = max(0, int(base_points or 0))
    ev = event or _store_points_event_payload(enabled=False)
    if base <= 0 or not ev.get("active"):
        return base, 0, None
    bonus = int(base * STORE_POINTS_EVENT_BONUS_RATE)
    return base + bonus, bonus, ev


def _minor_and_currency_for_store_points_loot_bonus(
    txn: Optional[Dict[str, Any]],
    package_id: str,
    POINT_PACKAGES: dict,
) -> Tuple[Optional[int], str]:
    """
    Resolve Stripe total (minor units) + currency for loot bonus on a points purchase.
    Prefer recorded Stripe amount; else custom expected pence; else catalog GBP price as pence.
    """
    t = txn or {}
    cur = str(t.get("stripe_currency") or "gbp").strip().lower() or "gbp"
    raw = t.get("stripe_amount_total_minor")
    if raw is not None:
        try:
            return int(raw), cur
        except (TypeError, ValueError):
            pass
    if package_id == CUSTOM_POINTS_PACKAGE_ID:
        exp = t.get("expected_amount_minor")
        if exp is not None:
            try:
                return int(exp), "gbp"
            except (TypeError, ValueError):
                pass
        return None, cur
    pkg = POINT_PACKAGES.get(package_id) or {}
    price = pkg.get("price_gbp")
    if price is not None:
        try:
            return gbp_to_minor_pence(float(price)), "gbp"
        except (TypeError, ValueError):
            pass
    return None, cur


def _resolve_points_for_stripe_payment(
    package_id: str,
    stripe_amount_total_minor: Optional[int],
    txn: Optional[dict],
    POINT_PACKAGES: dict,
) -> Tuple[int, Optional[str]]:
    """
    Resolve points to credit for a Stripe Checkout session.
    Custom package: points and expected pence must come from payment_transactions; Stripe amount must match.
    """
    if package_id == CUSTOM_POINTS_PACKAGE_ID:
        if not txn:
            return 0, "missing_transaction"
        pts = int(txn.get("points") or 0)
        exp = txn.get("expected_amount_minor")
        if exp is None:
            return 0, "missing_expected_amount"
        if stripe_amount_total_minor is not None and int(stripe_amount_total_minor) != int(exp):
            return 0, "stripe_amount_mismatch"
        if pts <= 0:
            return 0, "invalid_points"
        return pts, None
    if package_id != RANK_XP_PASS_PACKAGE_ID and package_id != AUTO_RANK_PERMANENT_PACKAGE_ID and txn:
        pts = int(txn.get("points") or 0)
        if pts > 0:
            return pts, None
    pkg = POINT_PACKAGES.get(package_id) or {}
    pts = int(pkg.get("points") or 0)
    return pts, None


def _format_paid_display_from_minor(minor: int, currency: str) -> str:
    cur = (currency or "gbp").lower()
    try:
        m = int(minor)
    except (TypeError, ValueError):
        return "—"
    if cur == "gbp":
        return f"£{m / 100:.2f}"
    return f"{m} {cur.upper()}"


def _attach_admin_paid_display(t: dict, POINT_PACKAGES: dict) -> None:
    """Set paid_display on an admin payment log row; consumes ephemeral _stripe_session_* keys."""
    minor = None
    cur = None
    raw_m = t.get("stripe_amount_total_minor")
    if raw_m is not None:
        try:
            minor = int(raw_m)
            cur = (t.get("stripe_currency") or "gbp").strip().lower()
        except (TypeError, ValueError):
            minor = None
    if minor is None:
        sess_minor = t.pop("_stripe_session_amount_minor", None)
        sess_cur = t.pop("_stripe_session_currency", None)
        if sess_minor is not None:
            try:
                minor = int(sess_minor)
            except (TypeError, ValueError):
                minor = None
            cur = (sess_cur or "gbp").lower()
    else:
        t.pop("_stripe_session_amount_minor", None)
        t.pop("_stripe_session_currency", None)
    package_id = t.get("package_id") or ""
    paid_display = None
    if minor is not None:
        paid_display = _format_paid_display_from_minor(minor, cur or "gbp")
    elif package_id == CUSTOM_POINTS_PACKAGE_ID and t.get("expected_amount_minor") is not None:
        try:
            paid_display = _format_paid_display_from_minor(int(t["expected_amount_minor"]), "gbp")
        except (TypeError, ValueError):
            paid_display = None
    else:
        pkg = POINT_PACKAGES.get(package_id) or {}
        price = pkg.get("price_gbp")
        if price is not None:
            try:
                paid_display = f"£{float(price):.2f}"
            except (TypeError, ValueError):
                paid_display = None
    t["paid_display"] = paid_display


async def _notify_staff_preorder_points_held(
    db,
    *,
    session_id: str,
    user_id: str,
    package_id: str,
    points: int,
    release_date_str: str,
) -> None:
    """Inbox staff when a points purchase is paid but held until pre-order release (no balance credit yet)."""
    username = ""
    try:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        if u:
            username = (u.get("username") or "").strip()[:64]
    except Exception:
        pass
    title = "Store points — pre-order (not credited yet)"
    msg = (
        "A player completed payment for points that are held until the configured pre-order release date "
        "(balance not credited until then).\n\n"
        f"User: {username or '(unknown)'} ({user_id})\n"
        f"Points: {points:,}\n"
        f"Package: {package_id}\n"
        f"Stripe session: {session_id}\n"
        f"Release date (settings): {release_date_str or '—'}"
    )
    try:
        staff_ids = await _get_staff_user_ids()
        for staff_uid in staff_ids:
            try:
                await send_notification(staff_uid, title, msg, "staff_store_preorder_held")
            except Exception as e:
                logger.warning("staff preorder held inbox notify %s: %s", staff_uid, e)
    except Exception:
        logger.exception("notify_staff_preorder_points_held failed")


async def _notify_staff_paid_stuck_pending(
    db,
    *,
    session_id: str,
    user_id: str,
    package_id: str,
    points: int,
    context: str,
) -> None:
    """
    Inbox staff once per session when Stripe is paid but the transaction row is still `pending`
    after a credit attempt (unexpected — needs investigation / manual credit).
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    marked = await db.payment_transactions.update_one(
        {
            "session_id": session_id,
            "payment_status": "pending",
            "$or": [
                {"payment_issue_staff_notified_at": {"$exists": False}},
                {"payment_issue_staff_notified_at": None},
            ],
        },
        {"$set": {"payment_issue_staff_notified_at": now_iso}},
    )
    if marked.modified_count == 0:
        return
    username = ""
    try:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        if u:
            username = (u.get("username") or "").strip()[:64]
    except Exception:
        pass
    title = "Store payment — points not credited (investigate)"
    msg = (
        "Stripe reports this checkout as paid, but the payment row is still pending after the server tried to credit. "
        "Check Admin → Payments and Stripe; credit manually if needed.\n\n"
        f"User: {username or '(unknown)'} ({user_id})\n"
        f"Points (package): {points:,}\n"
        f"Package: {package_id}\n"
        f"Stripe session: {session_id}\n"
        f"Detected from: {context}"
    )
    try:
        staff_ids = await _get_staff_user_ids()
        for staff_uid in staff_ids:
            try:
                await send_notification(staff_uid, title, msg, "staff_store_paid_stuck_pending")
            except Exception as e:
                logger.warning("staff stuck pending inbox notify %s: %s", staff_uid, e)
    except Exception:
        logger.exception("notify_staff_paid_stuck_pending failed")


async def _credit_payment_if_pending(db, session_id: str, user_id: str, package_id: str, points: int) -> dict:
    """
    Credit points only once per session (idempotent). Returns dict with status info.
    If store_points_auto_credit is false, marks paid sessions as manual_credit_pending (staff credits later).
    If preorder mode is active and auto-credit is on, stores points as preorder_pending instead of crediting.
    Use server-side points from POINT_PACKAGES only; do not trust client/metadata for amount.
    Logs points_before and points_after on the transaction for admin audit.
    """
    is_rank_xp_pass = package_id == RANK_XP_PASS_PACKAGE_ID
    is_auto_rank_permanent = package_id == AUTO_RANK_PERMANENT_PACKAGE_ID
    if not user_id or (points <= 0 and not is_rank_xp_pass and not is_auto_rank_permanent):
        return {"credited": False, "preorder": False}
    
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    
    # Rank-XP pass entitlement: does not credit points; grants token entitlement + tier snapshot.
    if is_rank_xp_pass:
        user = await db.users.find_one(
            {"id": user_id},
            {
                "_id": 0,
                "points": 1,
                "rank_points": 1,
                "rank_xp_pass_tokens": 1,
                "rank_xp_pass_token_expires_at": 1,
                "rank_xp_pass_rewards_granted": 1,
                "rank_xp_pass_free_last_micro_tier_granted": 1,
            },
        )
        season = await get_game_pass_season_public(db)
        block_msg = game_pass_purchase_blocked_in_final_window(
            user,
            now,
            season_end_at=season.get("game_pass_season_end_at"),
        )
        if block_msg:
            blocked = await db.payment_transactions.update_one(
                {"session_id": session_id, "payment_status": "pending"},
                {
                    "$set": {
                        "payment_status": "fulfillment_blocked",
                        "fulfillment_blocked_at": now.isoformat(),
                        "fulfillment_blocked_detail": block_msg[:1000],
                    }
                },
            )
            if blocked.modified_count:
                logger.error(
                    "Game Pass Stripe payment will not be auto-fulfilled (final %s-day window): session_id=%s user_id=%s",
                    GAME_PASS_PURCHASE_CLOSE_WINDOW_DAYS,
                    session_id,
                    user_id,
                )
                try:
                    await _notify_staff_game_pass_fulfillment_blocked(
                        db,
                        session_id=session_id,
                        user_id=user_id,
                        detail=block_msg or "",
                    )
                except Exception:
                    logger.exception("staff inbox notify fulfillment_blocked failed")
                return {"credited": False, "preorder": False, "fulfillment_blocked": True, "detail": block_msg}
            snap = await db.payment_transactions.find_one(
                {"session_id": session_id},
                {"payment_status": 1, "fulfillment_blocked_detail": 1},
            )
            ps = (snap or {}).get("payment_status")
            if ps == "fulfillment_blocked":
                return {
                    "credited": False,
                    "preorder": False,
                    "fulfillment_blocked": True,
                    "detail": (snap or {}).get("fulfillment_blocked_detail") or block_msg,
                }
            if ps != "completed":
                return {"credited": False, "preorder": False, "fulfillment_blocked": True, "detail": block_msg}
            # else: already completed — fall through to idempotent handling below

        points_before = int(user.get("points") or 0) if user else 0
        now_iso = now.isoformat()
        result = await db.payment_transactions.update_one(
            {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending", "manual_credit_pending"]}},
            {
                "$set": {
                    "payment_status": "completed",
                    "points_credited_at": now_iso,
                    "points_before": points_before,
                    "points_after": points_before,
                    "pass_entitled_at": now_iso,
                }
            },
        )
        if result.modified_count == 0:
            return {"credited": False, "preorder": False}

        season_rp = int((user or {}).get("rank_xp_pass_season_rp") or 0)
        expires_at = _add_months(now, 1).isoformat()
        # Same rank_xp_pass token fields as legacy points purchase (removed): clear stale VIP snapshots so activation
        # is not blocked by a previous pass / admin state.
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "rank_xp_pass_tokens": 1,
                    "rank_xp_pass_token_expires_at": expires_at,
                    # Store for the unactivated token; activation uses max(snapshot, live season RP).
                    "rank_xp_pass_pending_tier_snapshot": season_rp,
                    "rank_xp_pass_rewards_granted": False,
                    "rank_xp_pass_last_granted_micro_tier": 0,
                    "rank_xp_pass_tier_snapshot": None,
                    "rank_xp_pass_bonus_until": None,
                }
            },
        )
        # Auto-activate: grant VIP rewards for all tiers already completed.
        from routers.kill.armoury import _activate_rank_xp_pass_and_grant_cumulative_micro_tiers

        u2 = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "rank_xp_pass_season_rp": 1, "rank_xp_pass_free_last_micro_tier_granted": 1},
        )
        free_cash_last_micro = int((u2 or {}).get("rank_xp_pass_free_last_micro_tier_granted") or 0)
        activated = await _activate_rank_xp_pass_and_grant_cumulative_micro_tiers(
            db,
            user_id,
            season_rp,
            free_cash_last_micro_tier_granted=free_cash_last_micro,
        )
        # If auto-activation succeeded, consume the token in DB (same intent as points purchase response).
        # Otherwise users still see "1 token" and re-activating hits "already claimed" with no new rewards.
        if activated:
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"rank_xp_pass_tokens": 0}},
            )

        if activated:
            await send_notification(
                user_id,
                "Game Pass",
                "Your Game Pass has been activated and rewards have been granted!",
                "rank_xp_pass_activated",
            )
        else:
            await send_notification(
                user_id,
                "Game Pass",
                (
                    "Your Game Pass token is ready. "
                    "Use it in the Armoury/My Inventory to claim your one-time rewards."
                ),
                "rank_xp_pass_token_entitled",
            )
        logger.info(
            "Rank-XP pass entitlement granted: session_id=%s user_id=%s tier_snapshot=%s expires_at=%s auto_activated=%s",
            session_id,
            user_id,
            season_rp,
            expires_at,
            activated,
        )
        return {"credited": True, "preorder": False, "pass_entitled": True, "auto_activated": activated}

    # Permanent Auto Rank (email-tied; no points credited).
    if is_auto_rank_permanent:
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "email": 1, "email_verified": 1, "auto_rank_permanent": 1, "auto_rank_purchased": 1, "auto_rank_trial": 1},
        )
        email = (user or {}).get("email") or ""
        if not email or not (user or {}).get("email_verified"):
            blocked_detail = "Permanent Auto Rank requires a verified email on the purchasing account."
            blocked = await db.payment_transactions.update_one(
                {"session_id": session_id, "payment_status": "pending"},
                {
                    "$set": {
                        "payment_status": "fulfillment_blocked",
                        "fulfillment_blocked_at": now.isoformat(),
                        "fulfillment_blocked_detail": blocked_detail[:1000],
                    }
                },
            )
            if blocked.modified_count:
                logger.error(
                    "Auto Rank Stripe payment blocked (no verified email): session_id=%s user_id=%s",
                    session_id,
                    user_id,
                )
            return {"credited": False, "preorder": False, "fulfillment_blocked": True, "detail": blocked_detail}

        from utils.auto_rank_email_entitlement import (
            email_has_auto_rank_entitlement,
            grant_auto_rank_email_entitlement,
            sync_auto_rank_email_entitlement_to_user,
        )

        if await email_has_auto_rank_entitlement(db, email):
            blocked_detail = "Permanent Auto Rank is already entitled for this email."
            await db.payment_transactions.update_one(
                {"session_id": session_id, "payment_status": "pending"},
                {
                    "$set": {
                        "payment_status": "fulfillment_blocked",
                        "fulfillment_blocked_at": now.isoformat(),
                        "fulfillment_blocked_detail": blocked_detail[:1000],
                    }
                },
            )
            return {"credited": False, "preorder": False, "fulfillment_blocked": True, "detail": blocked_detail}

        points_before = int((user or {}).get("points") or 0) if user else 0
        result = await db.payment_transactions.update_one(
            {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending", "manual_credit_pending"]}},
            {
                "$set": {
                    "payment_status": "completed",
                    "points_credited_at": now_iso,
                    "points_before": points_before,
                    "points_after": points_before,
                    "entitlement_granted_at": now_iso,
                    "buyer_email": str(email).strip().lower(),
                }
            },
        )
        if result.modified_count == 0:
            snap = await db.payment_transactions.find_one({"session_id": session_id}, {"payment_status": 1})
            if (snap or {}).get("payment_status") == "completed":
                return {"credited": True, "preorder": False, "auto_rank_entitled": True}
            return {"credited": False, "preorder": False}

        await grant_auto_rank_email_entitlement(
            db,
            email,
            source="stripe",
            session_id=session_id,
            user_id=user_id,
        )
        await sync_auto_rank_email_entitlement_to_user(db, user_id, email)
        await send_notification(
            user_id,
            "Permanent Auto Rank",
            "Your permanent Auto Rank is active on this account and tied to your verified email.",
            "auto_rank_permanent_entitled",
        )
        logger.info(
            "Permanent Auto Rank entitlement granted: session_id=%s user_id=%s email=%s",
            session_id,
            user_id,
            str(email).strip().lower(),
        )
        return {"credited": True, "preorder": False, "auto_rank_entitled": True}

    settings = await db.game_settings.find_one({"_id": "main"})
    auto_credit = settings.get("store_points_auto_credit") if settings else None
    if auto_credit is None:
        auto_credit = True
    manual_eta = settings.get("store_points_manual_credit_eta") if settings else None

    if auto_credit is False:
        result = await db.payment_transactions.update_one(
            {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending", "manual_credit_pending"]}},
            {"$set": {
                "payment_status": "manual_credit_pending",
                "preorder_points": points,
                "manual_credit_marked_at": now_iso,
            }},
        )
        if result.modified_count == 0:
            txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0, "payment_status": 1})
            return {
                "credited": False,
                "preorder": False,
                "manual_credit_pending": txn.get("payment_status") == "manual_credit_pending" if txn else False,
            }
        logger.info(
            "Payment manual credit pending: session_id=%s user_id=%s package_id=%s points=%s",
            session_id, user_id, package_id, points,
        )
        try:
            await _notify_staff_manual_credit_pending(
                db,
                session_id=session_id,
                user_id=user_id,
                package_id=package_id,
                points=points,
                manual_eta=manual_eta,
            )
        except Exception:
            logger.exception("staff inbox notify manual credit pending failed")
        return {"credited": True, "preorder": False, "manual_credit_pending": True, "manual_credit_eta": manual_eta}

    # Preorder when auto-credit is on
    preorder_release_str = settings.get("preorder_points_release_date") if settings else None
    is_preorder = False
    if preorder_release_str:
        try:
            preorder_release = datetime.fromisoformat(preorder_release_str.replace("Z", "+00:00"))
            is_preorder = now < preorder_release
        except (ValueError, TypeError):
            pass
    
    if is_preorder:
        # Preorder mode: store as pending instead of crediting
        result = await db.payment_transactions.update_one(
            {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending", "manual_credit_pending"]}},
            {"$set": {
                "payment_status": "preorder_pending",
                "preorder_points": points,
                "preorder_release_date": preorder_release_str,
                "preorder_marked_at": now_iso,
            }},
        )
        if result.modified_count == 0:
            # Already processed
            txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0, "payment_status": 1})
            return {"credited": False, "preorder": txn.get("payment_status") == "preorder_pending" if txn else False}
        logger.info(
            "Payment preorder pending: session_id=%s user_id=%s package_id=%s points=%s release_date=%s",
            session_id, user_id, package_id, points, preorder_release_str,
        )
        try:
            await _notify_staff_preorder_points_held(
                db,
                session_id=session_id,
                user_id=user_id,
                package_id=package_id,
                points=points,
                release_date_str=preorder_release_str or "",
            )
        except Exception:
            logger.exception("staff inbox notify preorder held failed")
        return {"credited": True, "preorder": True, "preorder_release_date": preorder_release_str}
    
    # Normal mode: credit immediately
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1})
    points_before = int(user.get("points") or 0) if user else 0
    points_after = points_before + points
    result = await db.payment_transactions.update_one(
        {"session_id": session_id, "payment_status": {"$nin": ["completed", "preorder_pending", "manual_credit_pending"]}},
        {"$set": {
            "payment_status": "completed",
            "points_credited_at": now_iso,
            "points_before": points_before,
            "points_after": points_after,
        }},
    )
    if result.modified_count == 0:
        return {"credited": False, "preorder": False}
    import server as srv

    txn_row = await db.payment_transactions.find_one(
        {"session_id": session_id},
        {"_id": 0, "stripe_amount_total_minor": 1, "stripe_currency": 1, "expected_amount_minor": 1},
    )
    minor, cur = _minor_and_currency_for_store_points_loot_bonus(txn_row, package_id, srv.POINT_PACKAGES or {})
    loot_bonus = loot_box_pieces_for_gbp_stripe_minor(minor, cur)
    user_inc: Dict[str, int] = {"points": points}
    if loot_bonus:
        user_inc["loot_box_pieces"] = loot_bonus
    await db.users.update_one({"id": user_id}, {"$inc": user_inc})
    await mint_purchase_lot_if_missing(
        db,
        user_id=user_id,
        session_id=session_id,
        package_id=package_id,
        points=points,
    )
    logger.info(
        "Payment credited: session_id=%s user_id=%s package_id=%s points_added=%s points_before=%s points_after=%s loot_pieces_bonus=%s",
        session_id, user_id, package_id, points, points_before, points_after, loot_bonus,
    )
    loot_tail = f" You also received {loot_bonus:,} loot box pieces." if loot_bonus else ""
    await send_notification(
        user_id,
        "Points Credited",
        f"Your purchase of {points:,} points has been credited to your account. Balance: {points_before:,} → {points_after:,} points.{loot_tail}",
        "points_credited",
        category="system",
    )
    return {"credited": True, "preorder": False}


async def _credit_preorder_points(db, txn: dict) -> bool:
    """Credit preorder points that were held until release date."""
    session_id = txn.get("session_id")
    user_id = txn.get("user_id")
    points = txn.get("preorder_points") or txn.get("points", 0)
    package_id = txn.get("package_id", "")
    
    if not user_id or points <= 0:
        return False
    
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1})
    points_before = int(user.get("points") or 0) if user else 0
    points_after = points_before + points
    now_iso = datetime.now(timezone.utc).isoformat()
    
    result = await db.payment_transactions.update_one(
        {"session_id": session_id, "payment_status": "preorder_pending"},
        {"$set": {
            "payment_status": "completed",
            "points_credited_at": now_iso,
            "points_before": points_before,
            "points_after": points_after,
            "preorder_released_at": now_iso,
        }},
    )
    if result.modified_count == 0:
        return False
    import server as srv

    minor, cur = _minor_and_currency_for_store_points_loot_bonus(txn, package_id, srv.POINT_PACKAGES or {})
    loot_bonus = loot_box_pieces_for_gbp_stripe_minor(minor, cur)
    user_inc: Dict[str, int] = {"points": points}
    if loot_bonus:
        user_inc["loot_box_pieces"] = loot_bonus
    await db.users.update_one({"id": user_id}, {"$inc": user_inc})
    await mint_purchase_lot_if_missing(
        db,
        user_id=user_id,
        session_id=session_id,
        package_id=package_id,
        points=points,
    )
    logger.info(
        "Preorder points released: session_id=%s user_id=%s package_id=%s points=%s loot_pieces_bonus=%s",
        session_id, user_id, package_id, points, loot_bonus,
    )
    loot_tail = f" You also received {loot_bonus:,} loot box pieces." if loot_bonus else ""
    await send_notification(
        user_id,
        "Pre-Order Points Released",
        f"Your pre-order of {points:,} points has been credited to your account. Balance: {points_before:,} → {points_after:,} points.{loot_tail}",
        "preorder_released",
        category="system",
    )
    return True


async def _mark_pending_expired_checkouts_abandoned(db, user_id: str, api_key: Optional[str]) -> None:
    """Stripe sessions that expired (or completed without pay) → payment_status abandoned; hides misleading 'pending'."""
    if not api_key:
        return
    pending = await db.payment_transactions.find(
        {"user_id": user_id, "payment_status": "pending"}
    ).to_list(50)
    now_iso = datetime.now(timezone.utc).isoformat()
    for txn in pending:
        sid = txn.get("session_id")
        if not sid:
            continue
        try:
            def _retrieve():
                import stripe
                stripe.api_key = api_key
                return stripe.checkout.Session.retrieve(sid)

            session = await asyncio.to_thread(_retrieve)
        except Exception as e:
            logger.warning("reconcile pending checkout: session %s: %s", sid, e)
            continue
        if session.payment_status == "paid":
            continue
        st = session.status
        if st == "expired":
            await db.payment_transactions.update_one(
                {"session_id": sid, "payment_status": "pending"},
                {"$set": {"payment_status": "abandoned", "abandoned_at": now_iso, "abandoned_reason": "stripe_session_expired"}},
            )
        elif st == "complete" and session.payment_status != "paid":
            await db.payment_transactions.update_one(
                {"session_id": sid, "payment_status": "pending"},
                {"$set": {"payment_status": "abandoned", "abandoned_at": now_iso, "abandoned_reason": "stripe_complete_unpaid"}},
            )


async def _attach_pending_ui_labels(items: list, api_key: Optional[str]) -> None:
    """Human-readable status for unpaid pending rows (Stripe checkout started but not charged)."""
    if not items:
        return
    if not api_key:
        for t in items:
            if t.get("payment_status") == "pending":
                t["ui_status"] = "Could not verify payment"
        return
    for t in items:
        if t.get("payment_status") != "pending":
            continue
        sid = t.get("session_id")
        if not sid:
            t["ui_status"] = "Awaiting payment"
            continue
        try:
            def _retrieve():
                import stripe
                stripe.api_key = api_key
                return stripe.checkout.Session.retrieve(sid)

            session = await asyncio.to_thread(_retrieve)
        except Exception:
            t["ui_status"] = "Awaiting payment"
            continue
        if session.payment_status == "paid":
            t["ui_status"] = "Paid — awaiting credit"
        elif session.status == "open" and session.payment_status == "unpaid":
            t["ui_status"] = "Unpaid (checkout not completed)"
        else:
            t["ui_status"] = "Awaiting payment"


async def _enrich_admin_payment_log_rows(db, items: list, api_key: Optional[str], POINT_PACKAGES: dict) -> None:
    """Admin table: paid vs unpaid for DB `pending` rows, and whether manual Credit is safe.
    If Stripe is paid but the row is still `pending`, notify staff once (deduped via payment_issue_staff_notified_at)."""
    pending_rows = [t for t in items if t.get("payment_status") == "pending" and t.get("session_id")]

    sessions_by_id = {}
    if api_key and pending_rows:

        async def _fetch_session(sid: str):
            try:

                def _retrieve():
                    import stripe

                    stripe.api_key = api_key
                    return stripe.checkout.Session.retrieve(sid)

                sess = await asyncio.to_thread(_retrieve)
                return sid, sess
            except Exception as e:
                logger.warning("admin payment log: Stripe retrieve %s: %s", sid, e)
                return sid, None

        pairs = await asyncio.gather(*[_fetch_session(t["session_id"]) for t in pending_rows])
        sessions_by_id = {sid: s for sid, s in pairs if sid}

    for t in items:
        ps = t.get("payment_status")
        sid = t.get("session_id")
        t["provenance_lot_id"] = f"purchase:{sid}" if sid else None

        if ps == "completed":
            t["status_display"] = "Credited"
            t["allow_manual_credit"] = False
            continue
        if ps == "manual_credit_pending":
            t["status_display"] = "Paid — manual credit pending"
            t["allow_manual_credit"] = True
            t["stripe_payment_status"] = "paid"
            continue
        if ps == "preorder_pending":
            t["status_display"] = "Paid — pre-order pending"
            t["allow_manual_credit"] = True
            t["stripe_payment_status"] = "paid"
            continue
        if ps == "abandoned":
            t["status_display"] = "Unpaid (abandoned checkout)"
            t["allow_manual_credit"] = False
            continue
        if ps != "pending":
            t["status_display"] = ps or "Unknown"
            t["allow_manual_credit"] = False
            continue

        if not sid:
            t["status_display"] = "Pending (no session id)"
            t["allow_manual_credit"] = False
            continue
        if not api_key:
            t["status_display"] = "Pending (cannot verify — no Stripe key)"
            t["allow_manual_credit"] = False
            continue

        session = sessions_by_id.get(sid)
        if session is None:
            t["status_display"] = "Pending (could not load Stripe session)"
            t["allow_manual_credit"] = False
            continue

        amt = getattr(session, "amount_total", None)
        if amt is not None:
            try:
                t["_stripe_session_amount_minor"] = int(amt)
            except (TypeError, ValueError):
                pass
            t["_stripe_session_currency"] = (getattr(session, "currency", None) or "gbp").lower()

        t["stripe_session_status"] = session.status
        t["stripe_payment_status"] = session.payment_status

        if session.payment_status == "paid":
            t["status_display"] = "Paid — points not credited yet"
            t["allow_manual_credit"] = True
            pts = int(t.get("points") or 0)
            uid = (t.get("user_id") or "").strip()
            pkg = t.get("package_id") or ""
            if uid and pts > 0:
                try:
                    await _notify_staff_paid_stuck_pending(
                        db,
                        session_id=sid,
                        user_id=uid,
                        package_id=pkg,
                        points=pts,
                        context="Admin payments log (Stripe paid, DB still pending — webhook or reconcile may have missed)",
                    )
                except Exception:
                    logger.exception("staff stuck pending notify from admin payment log enrich failed")
        elif session.status == "expired":
            t["status_display"] = "Unpaid (checkout expired)"
            t["allow_manual_credit"] = False
        elif session.status == "open" and session.payment_status == "unpaid":
            t["status_display"] = "Unpaid (checkout not completed)"
            t["allow_manual_credit"] = False
        else:
            t["status_display"] = f"Unpaid (Stripe: {session.status} / {session.payment_status})"
            t["allow_manual_credit"] = False

    for t in items:
        _attach_admin_paid_display(t, POINT_PACKAGES)


def _admin_payment_log_row_is_unpaid_checkout_noise(t: dict) -> bool:
    """Rows hidden from admin log when include_open_unpaid=0 (open, expired, abandoned, other Stripe-unpaid)."""
    sd = t.get("status_display")
    return isinstance(sd, str) and sd.startswith("Unpaid (")


def register(router):
    """Register payment routes. Dependencies from server to avoid circular imports."""
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin
    POINT_PACKAGES = srv.POINT_PACKAGES

    from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_STORE

    async def _store_sustained_rl_user(current_user: dict = Depends(get_current_user)):
        await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_STORE)

    _store_rl_u = [Depends(_store_sustained_rl_user)]

    @router.get("/payments/game-pass-season")
    async def get_game_pass_season_status():
        """Public Game Pass season settings for page countdown and purchase windows."""
        season = await get_game_pass_season_public(db)
        return {
            **season,
            "game_pass_purchase_close_window_days": GAME_PASS_PURCHASE_CLOSE_WINDOW_DAYS,
        }

    @router.post("/payments/buy-game-pass-with-points")
    async def buy_game_pass_with_points(_request: BuyGamePassWithPointsRequest, current_user: dict = Depends(get_current_user)):
        """Deprecated: points purchase removed; use card checkout on Game Pass page."""
        raise HTTPException(
            status_code=400,
            detail="Game Pass cannot be purchased with points. Use the card purchase option on the Game Pass page.",
        )

    @router.post("/payments/checkout")
    async def create_checkout(request: CheckoutRequest, current_user: dict = Depends(get_current_user)):
        # Enforce /store/points lock (buying points disabled)
        doc = await db.game_settings.find_one({"key": "page_locks"}, {"_id": 0, "value": 1})
        raw = (doc.get("value") or {}).get("paths") if doc else {}
        entry = raw.get("/store/points") if isinstance(raw, dict) else None
        if entry:
            msg = entry.get("message", "Points purchase is temporarily unavailable") if isinstance(entry, dict) else "Points purchase is temporarily unavailable"
            uat = entry.get("unlock_at") if isinstance(entry, dict) else None
            is_locked = True
            if uat:
                try:
                    until = datetime.fromisoformat(str(uat).replace("Z", "+00:00"))
                    if until.tzinfo is None:
                        until = until.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) >= until:
                        is_locked = False  # unlock_at passed
                except Exception:
                    pass
            if is_locked:
                raise HTTPException(status_code=503, detail=msg)

        api_key = _get_stripe_key()
        if not api_key:
            raise HTTPException(status_code=503, detail="Payments not configured (set STRIPE_SECRET_KEY)")

        now = datetime.now(timezone.utc)
        package_id = (request.package_id or "").strip()
        points = 0
        base_points = 0
        bonus_points = 0
        store_points_event = await _store_points_event_payload_for_db(db, now)
        price_gbp = 0.0
        expected_amount_minor: Optional[int] = None

        if package_id == CUSTOM_POINTS_PACKAGE_ID:
            if (request.custom_points is None) == (request.custom_gbp is None):
                raise HTTPException(
                    status_code=400,
                    detail="For custom purchases, send exactly one of custom_points or custom_gbp.",
                )
            if request.custom_points is not None:
                msg = validate_custom_points_input(request.custom_points)
                if msg:
                    raise HTTPException(status_code=400, detail=msg)
                base_points = int(request.custom_points)
                price_gbp = float(price_gbp_for_points(base_points))
            else:
                msg = validate_custom_gbp_budget(request.custom_gbp)
                if msg:
                    raise HTTPException(status_code=400, detail=msg)
                base_points, price_gbp = points_and_price_for_gbp_budget(float(request.custom_gbp))
                price_gbp = float(price_gbp)
                if base_points <= 0:
                    raise HTTPException(status_code=400, detail="No points for that budget")
            points, bonus_points, active_store_points_event = _apply_store_points_event_bonus(base_points, store_points_event)
            store_points_event = active_store_points_event or store_points_event
            expected_amount_minor = gbp_to_minor_pence(price_gbp)
        else:
            if request.custom_points is not None or request.custom_gbp is not None:
                raise HTTPException(
                    status_code=400,
                    detail="custom_points and custom_gbp are only allowed when package_id is 'custom'.",
                )
            if package_id not in POINT_PACKAGES:
                raise HTTPException(status_code=400, detail="Invalid package")
            package = POINT_PACKAGES[package_id]
            base_points = int(package["points"])
            points = base_points
            if package_id not in (RANK_XP_PASS_PACKAGE_ID, AUTO_RANK_PERMANENT_PACKAGE_ID):
                points, bonus_points, active_store_points_event = _apply_store_points_event_bonus(base_points, store_points_event)
                store_points_event = active_store_points_event or store_points_event
            price_gbp = float(package["price_gbp"])

        unit_amount_minor = gbp_to_minor_pence(price_gbp)

        # Pre-check: disallow buying again while the user already has an unactivated pass token.
        if package_id == RANK_XP_PASS_PACKAGE_ID:
            season = await get_game_pass_season_public(db)
            block_msg = game_pass_purchase_blocked_in_final_window(
                current_user,
                now,
                season_end_at=season.get("game_pass_season_end_at"),
            )
            if block_msg:
                raise HTTPException(status_code=403, detail=block_msg)
            existing_tokens = int(current_user.get("rank_xp_pass_tokens") or 0)
            if existing_tokens > 0:
                expires_dt = _parse_utc(current_user.get("rank_xp_pass_token_expires_at"))
                # If expired, allow repurchase (and clear the old entitlement).
                if expires_dt and expires_dt <= now:
                    await db.users.update_one(
                        {"id": current_user["id"]},
                        {
                            "$set": {
                                "rank_xp_pass_tokens": 0,
                                "rank_xp_pass_rewards_granted": False,
                                "rank_xp_pass_pending_tier_snapshot": None,
                            },
                            "$unset": {"rank_xp_pass_token_expires_at": "", "rank_xp_pass_pending_tier_snapshot": ""},
                        },
                    )
                else:
                    raise HTTPException(
                        status_code=400,
                        detail="You already have an unactivated Game Pass token. Activate it before buying again.",
                    )
        if package_id == AUTO_RANK_PERMANENT_PACKAGE_ID:
            from utils.auto_rank_email_entitlement import email_has_auto_rank_entitlement

            buyer_email = (current_user.get("email") or "").strip().lower()
            if not buyer_email:
                raise HTTPException(status_code=400, detail="Link an email to your account before purchasing permanent Auto Rank.")
            if not current_user.get("email_verified"):
                raise HTTPException(status_code=400, detail="Verify your email before purchasing permanent Auto Rank.")
            if await email_has_auto_rank_entitlement(db, buyer_email):
                raise HTTPException(status_code=400, detail="Permanent Auto Rank is already entitled for this email.")
        # success_url: frontend sends origin_url like http://localhost:3000/store
        origin = (request.origin_url or "").rstrip("/")
        success_url = f"{origin}?session_id={{CHECKOUT_SESSION_ID}}"
        # Return with session id so we can mark DB row abandoned when user backs out without paying
        cancel_url = f"{origin}?tab=points&payment_cancel=1&session_id={{CHECKOUT_SESSION_ID}}"

        def _create():
            import stripe
            stripe.api_key = api_key
            product_name = f"{points} points"
            if bonus_points > 0:
                product_name = f"{points} points (includes +{bonus_points} bonus)"
            if package_id == RANK_XP_PASS_PACKAGE_ID:
                product_name = "Game Pass"
            if package_id == AUTO_RANK_PERMANENT_PACKAGE_ID:
                product_name = "Permanent Auto Rank"
            md = {
                "user_id": current_user["id"],
                "package_id": package_id,
                "points": str(points),
            }
            if bonus_points > 0:
                md["base_points"] = str(base_points)
                md["bonus_points"] = str(bonus_points)
                md["store_points_event_id"] = store_points_event.get("id") if store_points_event else ""
            if package_id == CUSTOM_POINTS_PACKAGE_ID and expected_amount_minor is not None:
                md["pricing_version"] = "1"
                md["expected_amount_minor"] = str(int(expected_amount_minor))
            session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                line_items=[{
                    "price_data": {
                        "currency": "gbp",
                        "unit_amount": int(unit_amount_minor),
                        "product_data": {
                            "name": product_name,
                            "metadata": {"package_id": package_id},
                        },
                    },
                    "quantity": 1,
                }],
                mode="payment",
                success_url=success_url,
                cancel_url=cancel_url,
                metadata=md,
            )
            return session

        try:
            session = await asyncio.to_thread(_create)
        except Exception as e:
            logger.exception("Stripe checkout create failed: %s", e)
            raise HTTPException(status_code=500, detail="Checkout failed")

        # Record pending transaction so status endpoint can fulfill
        txn_doc = {
            "session_id": session.id,
            "user_id": current_user["id"],
            "package_id": package_id,
            "points": points,
            "payment_status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if base_points and base_points != points:
            txn_doc["base_points"] = base_points
        if bonus_points:
            txn_doc["bonus_points"] = bonus_points
            txn_doc["store_points_event"] = store_points_event
        if expected_amount_minor is not None:
            txn_doc["expected_amount_minor"] = int(expected_amount_minor)
        if package_id == AUTO_RANK_PERMANENT_PACKAGE_ID:
            txn_doc["buyer_email"] = (current_user.get("email") or "").strip().lower()
        await db.payment_transactions.insert_one(txn_doc)

        # Refresh session activity: user is about to spend unbounded time on Stripe with no API calls;
        # inactivity-based session end would otherwise log them out before they can verify payment.
        sid = current_user.get("_session_id")
        if sid:
            now_iso = datetime.now(timezone.utc).isoformat()
            try:
                await db.users.update_one(
                    {"id": current_user["id"]},
                    {"$set": {"sessions.$[s].last_used_at": now_iso}},
                    array_filters=[{"s.id": sid}],
                )
            except Exception:
                logger.exception("checkout: failed to touch session last_used_at user=%s", current_user.get("id"))

        return {"url": session.url}

    @router.get("/payments/store-points-event", dependencies=_store_rl_u)
    async def payments_store_points_event(current_user: dict = Depends(get_current_user)):
        _ = current_user
        return {"event": await _store_points_event_payload_for_db(db)}

    @router.get("/payments/custom-quote", dependencies=_store_rl_u)
    async def payments_custom_quote(
        points: Optional[int] = Query(None),
        gbp: Optional[float] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        """Preview price for a custom points purchase (piecewise curve). Exactly one of `points` or `gbp`."""
        _ = current_user
        if (points is None) == (gbp is None):
            raise HTTPException(
                status_code=400,
                detail="Provide exactly one query parameter: points or gbp.",
            )
        if points is not None:
            msg = validate_custom_points_input(points)
            if msg:
                raise HTTPException(status_code=400, detail=msg)
            p = int(points)
            pr = price_gbp_for_points(p)
            m = gbp_to_minor_pence(pr)
            store_points_event = await _store_points_event_payload_for_db(db)
            credited_points, bonus_points, active_store_points_event = _apply_store_points_event_bonus(p, store_points_event)
            loot_box_pieces = loot_box_pieces_for_gbp_stripe_minor(m, "gbp")
            return {
                "mode": "points",
                "base_points": p,
                "points": credited_points,
                "bonus_points": bonus_points,
                "price_gbp": round(float(pr), 2),
                "expected_amount_minor": m,
                "loot_box_pieces": loot_box_pieces,
                "min_points": CUSTOM_POINTS_MIN,
                "max_points": CUSTOM_POINTS_MAX,
                "store_points_event": active_store_points_event,
            }
        msg = validate_custom_gbp_budget(float(gbp))
        if msg:
            raise HTTPException(status_code=400, detail=msg)
        pts, pr = points_and_price_for_gbp_budget(float(gbp))
        m = gbp_to_minor_pence(pr)
        store_points_event = await _store_points_event_payload_for_db(db)
        credited_points, bonus_points, active_store_points_event = _apply_store_points_event_bonus(pts, store_points_event)
        loot_box_pieces = loot_box_pieces_for_gbp_stripe_minor(m, "gbp")
        return {
            "mode": "gbp",
            "base_points": pts,
            "points": credited_points,
            "bonus_points": bonus_points,
            "price_gbp": round(float(pr), 2),
            "expected_amount_minor": m,
            "loot_box_pieces": loot_box_pieces,
            "min_points": CUSTOM_POINTS_MIN,
            "max_points": CUSTOM_POINTS_MAX,
            "store_points_event": active_store_points_event,
        }

    @router.post("/payments/mark-checkout-cancelled/{session_id}")
    async def mark_checkout_cancelled(session_id: str, current_user: dict = Depends(get_current_user)):
        """User hit Stripe cancel/back to store; checkout was not paid — mark row abandoned so Payments table is accurate."""
        txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        if not txn or txn.get("user_id") != current_user["id"]:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if txn.get("payment_status") != "pending":
            return {"ok": True}
        api_key = _get_stripe_key()
        if api_key:
            try:
                def _retrieve():
                    import stripe
                    stripe.api_key = api_key
                    return stripe.checkout.Session.retrieve(session_id)

                session = await asyncio.to_thread(_retrieve)
                if session.payment_status == "paid":
                    return {"ok": True, "paid": True}
            except Exception as e:
                logger.warning("mark_checkout_cancelled: Stripe %s: %s (still marking abandoned)", session_id, e)
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.payment_transactions.update_one(
            {"session_id": session_id, "payment_status": "pending"},
            {"$set": {
                "payment_status": "abandoned",
                "abandoned_at": now_iso,
                "abandoned_reason": "user_cancelled_checkout",
            }},
        )
        return {"ok": True}

    @router.get("/payments/status/{session_id}")
    async def get_payment_status(session_id: str, current_user: dict = Depends(get_current_user)):
        transaction = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        if transaction and transaction["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Unauthorized")

        if transaction and transaction.get("payment_status") == "fulfillment_blocked":
            return {
                "status": "fulfillment_blocked",
                "payment_status": "fulfillment_blocked",
                "points_added": 0,
                "detail": transaction.get("fulfillment_blocked_detail")
                or "This purchase could not be completed. If you were charged, contact support for a refund.",
            }

        if transaction and transaction.get("payment_status") == "completed":
            pkg = transaction.get("package_id") or ""
            out = {"status": "completed", "payment_status": "paid", "points_added": transaction["points"], "package_id": pkg}
            if pkg == RANK_XP_PASS_PACKAGE_ID:
                out["pass_entitled"] = True
            if pkg == AUTO_RANK_PERMANENT_PACKAGE_ID:
                out["auto_rank_entitled"] = True
            return out
        
        if transaction and transaction.get("payment_status") == "manual_credit_pending":
            settings = await db.game_settings.find_one({"_id": "main"})
            eta = settings.get("store_points_manual_credit_eta") if settings else None
            return {
                "status": "manual_credit_pending",
                "payment_status": "paid",
                "points_added": transaction.get("preorder_points") or transaction.get("points", 0),
                "manual_credit_pending": True,
                "manual_credit_eta": eta,
            }

        if transaction and transaction.get("payment_status") == "preorder_pending":
            return {
                "status": "preorder_pending",
                "payment_status": "paid",
                "points_added": transaction.get("preorder_points") or transaction.get("points", 0),
                "preorder": True,
                "preorder_release_date": transaction.get("preorder_release_date"),
            }

        # If no transaction or still pending, check Stripe
        api_key = _get_stripe_key()
        if api_key:
            def _retrieve():
                import stripe
                stripe.api_key = api_key
                return stripe.checkout.Session.retrieve(session_id)

            try:
                session = await asyncio.to_thread(_retrieve)
            except Exception as e:
                logger.warning("Stripe session retrieve failed: %s", e)
                if not transaction:
                    raise HTTPException(status_code=404, detail="Transaction not found")
                return {"status": "pending", "payment_status": "unknown"}

            logger.info("Stripe session status: id=%s payment_status=%s status=%s", session_id, session.payment_status, session.status)
            
            if session.payment_status == "paid" and session.metadata:
                user_id = session.metadata.get("user_id")
                package_id = session.metadata.get("package_id") or (transaction or {}).get("package_id")
                if user_id != current_user["id"]:
                    raise HTTPException(status_code=403, detail="Unauthorized")
                txn_row = transaction or await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
                if (
                    not txn_row
                    and (package_id == CUSTOM_POINTS_PACKAGE_ID or session.metadata.get("package_id") == CUSTOM_POINTS_PACKAGE_ID)
                ):
                    try:
                        exp_m = int(session.metadata.get("expected_amount_minor") or "")
                        pts_m = int(session.metadata.get("points") or 0)
                        txn_row = {"points": pts_m, "expected_amount_minor": exp_m}
                    except (TypeError, ValueError):
                        txn_row = None
                stripe_minor = getattr(session, "amount_total", None)
                points, rerr = _resolve_points_for_stripe_payment(
                    package_id or "",
                    stripe_minor,
                    txn_row,
                    POINT_PACKAGES,
                )
                if rerr == "stripe_amount_mismatch":
                    now_iso = datetime.now(timezone.utc).isoformat()
                    await db.payment_transactions.update_one(
                        {"session_id": session_id},
                        {
                            "$set": {
                                "payment_status": "fulfillment_blocked",
                                "fulfillment_blocked_at": now_iso,
                                "fulfillment_blocked_detail": "Stripe amount did not match expected custom checkout pence",
                            }
                        },
                    )
                    try:
                        await _notify_staff_custom_points_fulfillment_blocked(
                            db,
                            session_id=session_id,
                            user_id=user_id,
                            detail=f"stripe_minor={stripe_minor} txn={txn_row}",
                        )
                    except Exception:
                        logger.exception("notify custom mismatch from get_payment_status failed")
                    return {
                        "status": "fulfillment_blocked",
                        "payment_status": "fulfillment_blocked",
                        "points_added": 0,
                        "detail": "Payment could not be matched to this checkout. If you were charged, contact support.",
                    }
                if package_id == CUSTOM_POINTS_PACKAGE_ID and rerr:
                    logger.warning(
                        "GET /payments/status: custom resolve failed session=%s err=%s",
                        session_id,
                        rerr,
                    )
                    return {"status": "pending", "payment_status": "unknown"}
                is_rank_xp_pass = package_id == RANK_XP_PASS_PACKAGE_ID
                is_auto_rank_permanent = package_id == AUTO_RANK_PERMANENT_PACKAGE_ID
                if not points and not is_rank_xp_pass and not is_auto_rank_permanent:
                    logger.warning("GET /payments/status: no points for package session=%s", session_id)
                    return {"status": "pending", "payment_status": "unknown"}

                if not transaction:
                    ins = {
                        "session_id": session_id,
                        "user_id": user_id,
                        "package_id": package_id or "",
                        "points": points,
                        "payment_status": "pending",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                    if package_id == CUSTOM_POINTS_PACKAGE_ID and txn_row and txn_row.get("expected_amount_minor") is not None:
                        ins["expected_amount_minor"] = int(txn_row["expected_amount_minor"])
                    await db.payment_transactions.insert_one(ins)
                credit_result = await _credit_payment_if_pending(db, session_id, user_id, package_id or "", points)
                if (
                    session.payment_status == "paid"
                    and points > 0
                    and not credit_result.get("credited")
                    and not credit_result.get("fulfillment_blocked")
                ):
                    t_chk = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0, "payment_status": 1})
                    if (t_chk or {}).get("payment_status") == "pending":
                        try:
                            await _notify_staff_paid_stuck_pending(
                                db,
                                session_id=session_id,
                                user_id=user_id,
                                package_id=package_id or "",
                                points=points,
                                context="GET /payments/status (paid, credit attempt did not complete row)",
                            )
                        except Exception:
                            logger.exception("staff stuck pending notify from status failed")
                if credit_result.get("credited"):
                    if credit_result.get("manual_credit_pending"):
                        return {
                            "status": "manual_credit_pending",
                            "payment_status": "paid",
                            "points_added": points,
                            "manual_credit_pending": True,
                            "manual_credit_eta": credit_result.get("manual_credit_eta"),
                        }
                    if credit_result.get("preorder"):
                        return {
                            "status": "preorder_pending",
                            "payment_status": "paid",
                            "points_added": points,
                            "preorder": True,
                            "preorder_release_date": credit_result.get("preorder_release_date"),
                        }
                    out = {"status": "completed", "payment_status": "paid", "points_added": points, "package_id": package_id or ""}
                    if credit_result.get("pass_entitled"):
                        out["pass_entitled"] = True
                    if credit_result.get("auto_rank_entitled"):
                        out["auto_rank_entitled"] = True
                    return out
                    return {
                        "status": "fulfillment_blocked",
                        "payment_status": "fulfillment_blocked",
                        "points_added": 0,
                        "detail": credit_result.get("detail"),
                    }
                # Already completed or preorder pending (e.g. by webhook); return status with points
                t2 = await db.payment_transactions.find_one(
                    {"session_id": session_id},
                    {
                        "_id": 0,
                        "points": 1,
                        "payment_status": 1,
                        "preorder_release_date": 1,
                        "preorder_points": 1,
                        "fulfillment_blocked_detail": 1,
                    },
                )
                if t2:
                    if t2.get("payment_status") == "fulfillment_blocked":
                        return {
                            "status": "fulfillment_blocked",
                            "payment_status": "fulfillment_blocked",
                            "points_added": 0,
                            "detail": t2.get("fulfillment_blocked_detail"),
                        }
                    if t2.get("payment_status") == "completed":
                        out = {"status": "completed", "payment_status": "paid", "points_added": t2.get("points", points), "package_id": package_id or ""}
                        if (package_id or "") == RANK_XP_PASS_PACKAGE_ID:
                            out["pass_entitled"] = True
                        if (package_id or "") == AUTO_RANK_PERMANENT_PACKAGE_ID:
                            out["auto_rank_entitled"] = True
                        return out
                    if t2.get("payment_status") == "manual_credit_pending":
                        settings = await db.game_settings.find_one({"_id": "main"})
                        eta = settings.get("store_points_manual_credit_eta") if settings else None
                        return {
                            "status": "manual_credit_pending",
                            "payment_status": "paid",
                            "points_added": t2.get("preorder_points") or t2.get("points", points),
                            "manual_credit_pending": True,
                            "manual_credit_eta": eta,
                        }
                    if t2.get("payment_status") == "preorder_pending":
                        return {
                            "status": "preorder_pending",
                            "payment_status": "paid",
                            "points_added": t2.get("preorder_points") or t2.get("points", points),
                            "preorder": True,
                            "preorder_release_date": t2.get("preorder_release_date"),
                        }

            if session.status == "expired":
                return {"status": "expired", "payment_status": "expired"}
            # Open checkout, no charge yet — stop client polling (was stuck retrying forever)
            if session.status == "open" and getattr(session, "payment_status", None) == "unpaid":
                return {"status": "checkout_open", "payment_status": "unpaid"}

        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return {"status": "pending", "payment_status": "unknown"}

    @router.post("/webhook/stripe")
    async def stripe_webhook(request: Request):
        api_key = _get_stripe_key()
        if not api_key:
            raise HTTPException(status_code=503, detail="Payments not configured")
        body = await request.body()
        sig = request.headers.get("stripe-signature", "")
        webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")

        def _construct():
            import stripe
            stripe.api_key = api_key
            return stripe.Webhook.construct_event(body, sig, webhook_secret) if webhook_secret else None

        try:
            event = await asyncio.to_thread(_construct) if webhook_secret else None
        except Exception as e:
            logger.warning("Stripe webhook signature verify failed: %s", e)
            raise HTTPException(status_code=400, detail="Invalid signature")

        if not event:
            raise HTTPException(status_code=503, detail="Webhook secret not set")

        if event.type == "checkout.session.completed":
            session = event.data.object
            if session.payment_status == "paid":
                _at = getattr(session, "amount_total", None)
                _ac = getattr(session, "currency", None) or "gbp"
                if _at is not None:
                    try:
                        await db.payment_transactions.update_one(
                            {"session_id": session.id},
                            {
                                "$set": {
                                    "stripe_amount_total_minor": int(_at),
                                    "stripe_currency": str(_ac).lower(),
                                }
                            },
                        )
                    except Exception:
                        logger.exception("webhook: persist stripe_amount_total_minor failed session_id=%s", session.id)
            if session.payment_status == "paid" and session.metadata:
                user_id = session.metadata.get("user_id")
                package_id = session.metadata.get("package_id")
                txn_row = await db.payment_transactions.find_one({"session_id": session.id}, {"_id": 0})
                if not txn_row and package_id == CUSTOM_POINTS_PACKAGE_ID:
                    try:
                        txn_row = {
                            "points": int(session.metadata.get("points") or 0),
                            "expected_amount_minor": int(session.metadata.get("expected_amount_minor") or ""),
                        }
                    except (TypeError, ValueError):
                        txn_row = None
                stripe_minor = getattr(session, "amount_total", None)
                points, rerr = _resolve_points_for_stripe_payment(
                    package_id or "",
                    stripe_minor,
                    txn_row,
                    POINT_PACKAGES,
                )
                if rerr == "stripe_amount_mismatch":
                    now_iso = datetime.now(timezone.utc).isoformat()
                    await db.payment_transactions.update_one(
                        {"session_id": session.id},
                        {
                            "$set": {
                                "payment_status": "fulfillment_blocked",
                                "fulfillment_blocked_at": now_iso,
                                "fulfillment_blocked_detail": "Stripe amount did not match expected custom checkout pence",
                            }
                        },
                    )
                    try:
                        await _notify_staff_custom_points_fulfillment_blocked(
                            db,
                            session_id=session.id,
                            user_id=user_id or "",
                            detail=f"webhook stripe_minor={stripe_minor}",
                        )
                    except Exception:
                        logger.exception("notify custom mismatch from webhook failed")
                elif package_id == CUSTOM_POINTS_PACKAGE_ID and (rerr or points <= 0):
                    logger.warning(
                        "Stripe webhook: custom resolve failed session_id=%s err=%s",
                        session.id,
                        rerr,
                    )
                else:
                    is_rank_xp_pass = package_id == RANK_XP_PASS_PACKAGE_ID
                    if not user_id or (points <= 0 and not is_rank_xp_pass):
                        logger.warning("Stripe webhook: missing user_id or invalid package_id, session_id=%s", session.id)
                    else:
                        # Ensure we have a transaction row (status poll may not have run)
                        existing = await db.payment_transactions.find_one({"session_id": session.id}, {"_id": 1})
                        if not existing:
                            doc = {
                                "session_id": session.id,
                                "user_id": user_id,
                                "package_id": package_id or "",
                                "points": points,
                                "payment_status": "pending",
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            }
                            if package_id == CUSTOM_POINTS_PACKAGE_ID and txn_row and txn_row.get("expected_amount_minor") is not None:
                                doc["expected_amount_minor"] = int(txn_row["expected_amount_minor"])
                            await db.payment_transactions.insert_one(doc)
                        credit_result = await _credit_payment_if_pending(db, session.id, user_id, package_id or "", points)
                        if (
                            session.payment_status == "paid"
                            and points > 0
                            and not credit_result.get("credited")
                            and not credit_result.get("fulfillment_blocked")
                        ):
                            t_chk = await db.payment_transactions.find_one({"session_id": session.id}, {"_id": 0, "payment_status": 1})
                            if (t_chk or {}).get("payment_status") == "pending":
                                try:
                                    await _notify_staff_paid_stuck_pending(
                                        db,
                                        session_id=session.id,
                                        user_id=user_id,
                                        package_id=package_id or "",
                                        points=points,
                                        context="Stripe webhook checkout.session.completed",
                                    )
                                except Exception:
                                    logger.exception("staff stuck pending notify from webhook failed")

        return {"received": True}

    @router.get("/payments/my-transactions")
    async def my_payment_transactions(current_user: dict = Depends(get_current_user)):
        """List current user's payment transactions (for Store Payments section).
        Filters out old 'pending' transactions (abandoned checkouts) older than 30 minutes."""
        now = datetime.now(timezone.utc)
        thirty_mins_ago = (now - timedelta(minutes=30)).isoformat()
        api_key = _get_stripe_key()
        await _mark_pending_expired_checkouts_abandoned(db, current_user["id"], api_key)

        # Only show: completed, preorder_pending, manual_credit_pending, or recent pending (last 30 min).
        # Excludes abandoned (cancelled / expired checkout without payment).
        cursor = db.payment_transactions.find(
            {
                "user_id": current_user["id"],
                "payment_status": {"$ne": "abandoned"},
                "$or": [
                    {"payment_status": {"$in": ["completed", "preorder_pending", "manual_credit_pending"]}},
                    {"payment_status": "pending", "created_at": {"$gte": thirty_mins_ago}},
                ],
            },
            {"_id": 0, "session_id": 1, "package_id": 1, "points": 1, "payment_status": 1, "created_at": 1, "points_credited_at": 1},
        ).sort("created_at", -1).limit(50)
        items = await cursor.to_list(50)
        await _attach_pending_ui_labels(items, api_key)
        return {"transactions": items}

    @router.get("/payments/pending-points", dependencies=_store_rl_u)
    async def get_pending_points(current_user: dict = Depends(get_current_user)):
        """Pending points: preorder (scheduled release) and/or manual_credit_pending (staff credit)."""
        settings = await db.game_settings.find_one({"_id": "main"})
        release_date = settings.get("preorder_points_release_date") if settings else None
        auto_credit = settings.get("store_points_auto_credit") if settings else None
        if auto_credit is None:
            auto_credit = True
        manual_eta = settings.get("store_points_manual_credit_eta") if settings else None

        preorder_txns = await db.payment_transactions.find(
            {"user_id": current_user["id"], "payment_status": "preorder_pending"},
            {"_id": 0, "preorder_points": 1, "points": 1, "preorder_release_date": 1},
        ).to_list(100)
        manual_txns = await db.payment_transactions.find(
            {"user_id": current_user["id"], "payment_status": "manual_credit_pending"},
            {"_id": 0, "preorder_points": 1, "points": 1},
        ).to_list(100)
        preorder_pts = sum(t.get("preorder_points") or t.get("points", 0) for t in preorder_txns)
        manual_pts = sum(t.get("preorder_points") or t.get("points", 0) for t in manual_txns)
        return {
            "pending_points": preorder_pts + manual_pts,
            "preorder_pending_points": preorder_pts,
            "manual_pending_points": manual_pts,
            "transaction_count": len(preorder_txns) + len(manual_txns),
            "release_date": release_date,
            "store_points_auto_credit": auto_credit,
            "manual_credit_eta": manual_eta,
        }

    @router.post("/payments/check-release")
    async def check_and_release_pending_points(current_user: dict = Depends(get_current_user)):
        """Check for stuck 'pending' transactions with Stripe, then release any preorder_pending points."""
        settings = await db.game_settings.find_one({"_id": "main"})
        release_date_str = settings.get("preorder_points_release_date") if settings else None
        now = datetime.now(timezone.utc)
        
        # Parse release date if set
        release_date = None
        preorder_active = False
        if release_date_str:
            try:
                release_date = datetime.fromisoformat(release_date_str.replace("Z", "+00:00"))
                preorder_active = now < release_date
            except (ValueError, TypeError):
                pass
        
        # Pending + paid in Stripe: reconcile if checkout was created recently (webhook can be delayed/missed).
        seven_days_ago = (now - timedelta(days=7)).isoformat()
        stuck_pending = await db.payment_transactions.find(
            {"user_id": current_user["id"], "payment_status": "pending", "created_at": {"$gte": seven_days_ago}}
        ).to_list(100)
        
        processed_stuck = 0
        api_key = _get_stripe_key()
        if stuck_pending and api_key:
            for txn in stuck_pending:
                session_id = txn.get("session_id")
                if not session_id:
                    continue
                try:
                    def _retrieve():
                        import stripe
                        stripe.api_key = api_key
                        return stripe.checkout.Session.retrieve(session_id)
                    session = await asyncio.to_thread(_retrieve)
                    if session.payment_status == "paid":
                        user_id = txn.get("user_id")
                        package_id = txn.get("package_id", "")
                        points = txn.get("points", 0)
                        is_rank_xp_pass = package_id == RANK_XP_PASS_PACKAGE_ID
                        if user_id and (points > 0 or is_rank_xp_pass):
                            result = await _credit_payment_if_pending(db, session_id, user_id, package_id, points)
                            if result.get("credited"):
                                processed_stuck += 1
                                logger.info("Processed stuck pending transaction: session_id=%s user_id=%s points=%s", session_id, user_id, points)
                            elif (
                                points > 0
                                and not result.get("fulfillment_blocked")
                                and session.payment_status == "paid"
                            ):
                                t_chk = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0, "payment_status": 1})
                                if (t_chk or {}).get("payment_status") == "pending":
                                    try:
                                        await _notify_staff_paid_stuck_pending(
                                            db,
                                            session_id=session_id,
                                            user_id=user_id,
                                            package_id=package_id,
                                            points=points,
                                            context="POST /payments/check-release (paid, still pending)",
                                        )
                                    except Exception:
                                        logger.exception("staff stuck pending notify from check-release failed")
                except Exception as e:
                    logger.warning("Failed to check stuck transaction %s: %s", txn.get("session_id"), e)
        
        # If preorder is still active (release date in future), don't release preorder_pending yet
        if preorder_active:
            return {
                "released": 0,
                "processed_stuck": processed_stuck,
                "total_points": 0,
                "message": f"Processed {processed_stuck} stuck transaction(s). Release date has not passed yet." if processed_stuck else "Release date has not passed yet",
                "release_date": release_date_str,
            }
        
        # Now release any preorder_pending transactions
        pending_txns = await db.payment_transactions.find(
            {"user_id": current_user["id"], "payment_status": "preorder_pending"}
        ).to_list(100)
        
        released_count = 0
        total_points = 0
        for txn in pending_txns:
            if await _credit_preorder_points(db, txn):
                released_count += 1
                total_points += txn.get("preorder_points") or txn.get("points", 0)
        
        msg_parts = []
        if released_count:
            msg_parts.append(f"Released {total_points:,} points from {released_count} transaction(s)")
        if processed_stuck:
            msg_parts.append(f"Processed {processed_stuck} stuck transaction(s)")
        
        return {
            "released": released_count,
            "processed_stuck": processed_stuck,
            "total_points": total_points,
            "message": ". ".join(msg_parts) if msg_parts else "No pending points to release",
        }

    @router.post("/admin/payments/release-all-preorder")
    async def admin_release_all_preorder_points(current_user: dict = Depends(get_current_user)):
        """Admin only: Release all pending preorder points for all users (if release date has passed)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        
        settings = await db.game_settings.find_one({"_id": "main"})
        release_date_str = settings.get("preorder_points_release_date") if settings else None
        if not release_date_str:
            return {"released": 0, "message": "No preorder release date set"}
        
        now = datetime.now(timezone.utc)
        try:
            release_date = datetime.fromisoformat(release_date_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return {"released": 0, "message": "Invalid release date format"}
        
        if now < release_date:
            return {"released": 0, "message": "Release date has not passed yet", "release_date": release_date_str}
        
        pending_txns = await db.payment_transactions.find(
            {"payment_status": "preorder_pending"}
        ).to_list(10000)
        
        released_count = 0
        total_points = 0
        users_affected = set()
        for txn in pending_txns:
            if await _credit_preorder_points(db, txn):
                released_count += 1
                total_points += txn.get("preorder_points") or txn.get("points", 0)
                users_affected.add(txn.get("user_id"))
        
        logger.info(
            "Admin released all preorder points: %s transactions, %s points, %s users",
            released_count, total_points, len(users_affected),
        )
        return {
            "released": released_count,
            "total_points": total_points,
            "users_affected": len(users_affected),
            "message": f"Released {total_points:,} points from {released_count} transaction(s) for {len(users_affected)} user(s)" if released_count else "No pending preorder points to release",
        }

    @router.get("/admin/payments")
    async def admin_payment_log(
        current_user: dict = Depends(get_current_user),
        include_open_unpaid: int = Query(0, ge=0, le=1),
    ):
        """Admin only: list all payment transactions (donations) with username for audit.
        When include_open_unpaid is 0, unpaid checkout noise (open / expired / abandoned / etc.) is omitted."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cursor = db.payment_transactions.find(
            {},
            {
                "_id": 0,
                "session_id": 1,
                "user_id": 1,
                "package_id": 1,
                "points": 1,
                "payment_status": 1,
                "created_at": 1,
                "points_credited_at": 1,
                "points_before": 1,
                "points_after": 1,
                "preorder_points": 1,
                "expected_amount_minor": 1,
                "stripe_amount_total_minor": 1,
                "stripe_currency": 1,
            },
        ).sort("created_at", -1).limit(500)
        items = await cursor.to_list(500)
        user_ids = list({t["user_id"] for t in items if t.get("user_id")})
        users = await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "username": 1},
        ).to_list(len(user_ids) + 1)
        by_id = {u["id"]: u.get("username", "?") for u in users}
        for t in items:
            t["username"] = by_id.get(t.get("user_id"), "?")
        await _enrich_admin_payment_log_rows(db, items, _get_stripe_key(), POINT_PACKAGES)
        filtered_open_unpaid = sum(1 for t in items if _admin_payment_log_row_is_unpaid_checkout_noise(t))
        if not include_open_unpaid:
            items = [t for t in items if not _admin_payment_log_row_is_unpaid_checkout_noise(t)]
        return {
            "transactions": items,
            "filtered_open_unpaid": filtered_open_unpaid if not include_open_unpaid else 0,
        }

    class ManualCreditRequest(BaseModel):
        session_id: str

    @router.post("/admin/payments/check-stripe-session")
    async def admin_check_stripe_session(body: ManualCreditRequest, current_user: dict = Depends(get_current_user)):
        """Admin only: Check a Stripe session status and process it if paid."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        
        api_key = _get_stripe_key()
        if not api_key:
            raise HTTPException(status_code=503, detail="Stripe API key not configured")
        
        def _retrieve():
            import stripe
            stripe.api_key = api_key
            return stripe.checkout.Session.retrieve(body.session_id)
        
        try:
            session = await asyncio.to_thread(_retrieve)
        except Exception as e:
            logger.exception("Admin Stripe session check failed: %s", e)
            raise HTTPException(status_code=400, detail="Failed to retrieve session. Please try again.")

        if session.payment_status == "paid":
            _at = getattr(session, "amount_total", None)
            _ac = getattr(session, "currency", None) or "gbp"
            if _at is not None:
                try:
                    await db.payment_transactions.update_one(
                        {"session_id": body.session_id},
                        {
                            "$set": {
                                "stripe_amount_total_minor": int(_at),
                                "stripe_currency": str(_ac).lower(),
                            }
                        },
                    )
                except Exception:
                    logger.exception("admin_check_stripe_session: persist stripe_amount_total_minor failed")

        result = {
            "session_id": body.session_id,
            "stripe_status": session.status,
            "stripe_payment_status": session.payment_status,
            "metadata": dict(session.metadata) if session.metadata else {},
            "amount_total": session.amount_total,
            "currency": session.currency,
        }
        
        # Check our transaction record
        txn = await db.payment_transactions.find_one({"session_id": body.session_id}, {"_id": 0})
        result["our_transaction"] = txn
        
        # If Stripe shows paid but we haven't processed, process now
        if session.payment_status == "paid" and session.metadata:
            user_id = session.metadata.get("user_id")
            package_id = session.metadata.get("package_id")
            txn_row = txn
            if not txn_row and package_id == CUSTOM_POINTS_PACKAGE_ID:
                try:
                    txn_row = {
                        "points": int(session.metadata.get("points") or 0),
                        "expected_amount_minor": int(session.metadata.get("expected_amount_minor") or ""),
                    }
                except (TypeError, ValueError):
                    txn_row = None
            stripe_minor = getattr(session, "amount_total", None)
            points, rerr = _resolve_points_for_stripe_payment(
                package_id or "",
                stripe_minor,
                txn_row,
                POINT_PACKAGES,
            )
            if rerr == "stripe_amount_mismatch":
                result["message"] = "Stripe amount does not match expected custom checkout; not crediting"
            is_rank_xp_pass = package_id == RANK_XP_PASS_PACKAGE_ID
            if user_id and (points > 0 or is_rank_xp_pass) and rerr != "stripe_amount_mismatch":
                # Ensure transaction exists
                if not txn:
                    ins_ad = {
                        "session_id": body.session_id,
                        "user_id": user_id,
                        "package_id": package_id or "",
                        "points": points,
                        "payment_status": "pending",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                    if package_id == CUSTOM_POINTS_PACKAGE_ID and txn_row and txn_row.get("expected_amount_minor") is not None:
                        ins_ad["expected_amount_minor"] = int(txn_row["expected_amount_minor"])
                    await db.payment_transactions.insert_one(ins_ad)

                credit_result = await _credit_payment_if_pending(db, body.session_id, user_id, package_id or "", points)
                result["credit_attempted"] = True
                result["credit_result"] = credit_result
                t_after = await db.payment_transactions.find_one({"session_id": body.session_id}, {"_id": 0, "payment_status": 1})
                if (
                    session.payment_status == "paid"
                    and points > 0
                    and (t_after or {}).get("payment_status") == "pending"
                    and not credit_result.get("fulfillment_blocked")
                ):
                    try:
                        await _notify_staff_paid_stuck_pending(
                            db,
                            session_id=body.session_id,
                            user_id=user_id,
                            package_id=package_id or "",
                            points=points,
                            context="Admin Check & Process Stripe session (paid, still pending after credit attempt)",
                        )
                    except Exception:
                        logger.exception("staff stuck pending notify from admin check-stripe-session failed")

                if credit_result.get("credited"):
                    if credit_result.get("manual_credit_pending"):
                        result["message"] = f"Successfully processed: {points} points held for manual staff credit"
                    else:
                        result["message"] = f"Successfully processed: {points} points {'held for preorder' if credit_result.get('preorder') else 'credited'}"
                else:
                    result["message"] = "Already processed or failed to credit"
            elif rerr != "stripe_amount_mismatch":
                result["message"] = "Missing user_id or points in metadata"
        else:
            result["message"] = f"Stripe payment_status is '{session.payment_status}', not 'paid'"
        
        return result

    @router.post("/admin/payments/manual-credit")
    async def admin_manual_credit_transaction(body: ManualCreditRequest, current_user: dict = Depends(get_current_user)):
        """Admin only: Manually credit a non-completed paid transaction.
        Works for pending, preorder_pending, and manual_credit_pending."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")

        existing = await db.payment_transactions.find_one({"session_id": body.session_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Transaction not found")
        ps_existing = existing.get("payment_status")
        if ps_existing == "abandoned":
            raise HTTPException(status_code=400, detail="This checkout was abandoned; cannot credit")
        if ps_existing == "pending":
            api_key_mc = _get_stripe_key()
            if not api_key_mc:
                raise HTTPException(status_code=503, detail="Stripe key not configured; cannot verify payment")
            try:

                def _retrieve_mc():
                    import stripe

                    stripe.api_key = api_key_mc
                    return stripe.checkout.Session.retrieve(body.session_id)

                stripe_sess = await asyncio.to_thread(_retrieve_mc)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not verify Stripe session: {e}") from e
            if stripe_sess.payment_status != "paid":
                raise HTTPException(
                    status_code=400,
                    detail="Stripe reports this checkout was not paid; cannot credit points",
                )

        now_iso = datetime.now(timezone.utc).isoformat()
        txn = await db.payment_transactions.find_one_and_update(
            {"session_id": body.session_id, "payment_status": {"$ne": "completed"}},
            {"$set": {
                "payment_status": "completed",
                "points_credited_at": now_iso,
                "manual_credit_by": current_user.get("username"),
                "manual_credit_at": now_iso,
            }},
        )
        if not txn:
            existing = await db.payment_transactions.find_one({"session_id": body.session_id})
            if not existing:
                raise HTTPException(status_code=404, detail="Transaction not found")
            return {"message": "Transaction already completed", "credited": False}
        
        user_id = txn.get("user_id")
        package_id = txn.get("package_id")
        points = txn.get("preorder_points") or txn.get("points") or POINT_PACKAGES.get(package_id, {}).get("points", 0)
        
        if not user_id or points <= 0:
            raise HTTPException(status_code=400, detail="Invalid transaction: missing user_id or points")
        
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1, "username": 1})
        points_before = int(user.get("points") or 0) if user else 0
        points_after = points_before + points
        
        await db.payment_transactions.update_one(
            {"session_id": body.session_id},
            {"$set": {
                "points_before": points_before,
                "points_after": points_after,
            }},
        )
        minor, cur = _minor_and_currency_for_store_points_loot_bonus(txn, package_id, POINT_PACKAGES)
        loot_bonus = loot_box_pieces_for_gbp_stripe_minor(minor, cur)
        user_inc: Dict[str, int] = {"points": points}
        if loot_bonus:
            user_inc["loot_box_pieces"] = loot_bonus
        await db.users.update_one({"id": user_id}, {"$inc": user_inc})
        await mint_purchase_lot_if_missing(
            db,
            user_id=user_id,
            session_id=body.session_id,
            package_id=package_id or "",
            points=points,
        )
        
        logger.info(
            "Admin manual credit: session_id=%s user_id=%s points=%s loot_pieces_bonus=%s by=%s",
            body.session_id, user_id, points, loot_bonus, current_user.get("username"),
        )
        loot_tail = f" You also received {loot_bonus:,} loot box pieces." if loot_bonus else ""
        await send_notification(
            user_id,
            "Points Credited",
            f"Your purchase of {points:,} points has been credited. Balance: {points_before:,} → {points_after:,} points.{loot_tail}",
            "points_credited",
            category="system",
        )
        
        return {
            "message": f"Credited {points:,} points to {user.get('username', 'user')}",
            "credited": True,
            "points": points,
            "username": user.get("username"),
        }
