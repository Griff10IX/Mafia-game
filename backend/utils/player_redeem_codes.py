"""Player-created one-use redeem codes: deduct from the creator, grant on redeem.

Anti-alt: block if the two accounts share an IP, the redeem request IP is in the
other party's history, or a living non-NPC account bridges them on shared IPs.
Game Pass tokens cannot be moved. Unused codes can be cancelled for a refund.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from fastapi import HTTPException

from utils.cheat_detection_utils import user_ip_union
from utils.ip_normalize import normalize_ip_string

logger = logging.getLogger(__name__)

PLAYER_CODE_SOURCE = "player"
PLAYER_CODE_PREFIX = "P-"
MAX_ACTIVE_UNUSED_CODES = 10
MAX_MONEY_PER_CODE = 10_000_000_000_000  # 10T sanity cap
MAX_POINTS_PER_CODE = 10_000_000
MAX_TOKENS_PER_TYPE = 100_000

IP_USER_PROJECTION = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "is_dead": 1,
    "is_npc": 1,
    "registration_ip": 1,
    "last_login_ip": 1,
    "last_request_ip": 1,
    "login_ips": 1,
    "sessions": 1,
}

SAME_IP_DETAIL = (
    "Cannot use this with that player: same IP, or a living account on the same IP."
)


class PlayerRedeemError(ValueError):
    """Player-facing player-redeem-code failure."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _token_config() -> dict:
    from routers.kill.armoury import TOKEN_CONFIG

    return TOKEN_CONFIG


def transferable_token_types() -> Tuple[str, ...]:
    return tuple(sorted(t for t in _token_config() if t != "rank_xp_pass"))


def count_field_for_token(token_type: str) -> Optional[str]:
    cfg = _token_config().get(token_type)
    if not cfg:
        return None
    return cfg.get("count_field")


def normalized_ip_set(values: Iterable[str]) -> Set[str]:
    out: Set[str] = set()
    for raw in values or []:
        n = normalize_ip_string(str(raw or ""))
        if n:
            out.add(n)
    return out


def ips_from_user(user: Optional[dict], extra: Optional[Iterable[str]] = None) -> Set[str]:
    if not user:
        raw: List[str] = []
    else:
        raw, _ = user_ip_union(user, include_session_ips=True)
    if extra:
        raw = list(raw) + [str(x) for x in extra if x]
    return normalized_ip_set(raw)


def generate_player_code() -> str:
    return f"{PLAYER_CODE_PREFIX}{secrets.token_hex(4).upper()}"


def parse_player_rewards(
    *,
    money: Any = 0,
    points: Any = 0,
    tokens: Optional[dict] = None,
) -> dict:
    try:
        money_i = int(money or 0)
        points_i = int(points or 0)
    except (TypeError, ValueError) as exc:
        raise PlayerRedeemError("Cash and points must be whole numbers.") from exc
    if money_i < 0 or points_i < 0:
        raise PlayerRedeemError("Cash and points cannot be negative.")
    if money_i > MAX_MONEY_PER_CODE:
        raise PlayerRedeemError("Cash amount is too large for one code.")
    if points_i > MAX_POINTS_PER_CODE:
        raise PlayerRedeemError("Points amount is too large for one code.")

    allowed = set(transferable_token_types())
    token_dict: Dict[str, int] = {}
    for raw_type, raw_amt in (tokens or {}).items():
        tt = str(raw_type or "").strip()
        if not tt:
            continue
        if tt == "rank_xp_pass":
            raise PlayerRedeemError("Game Pass tokens cannot be put on a redeem code.")
        if tt not in allowed:
            raise PlayerRedeemError(f"Cannot include {tt.replace('_', ' ')} on a redeem code.")
        try:
            amt = int(raw_amt or 0)
        except (TypeError, ValueError) as exc:
            raise PlayerRedeemError("Token amounts must be whole numbers.") from exc
        if amt < 0:
            raise PlayerRedeemError("Token amounts cannot be negative.")
        if amt == 0:
            continue
        if amt > MAX_TOKENS_PER_TYPE:
            raise PlayerRedeemError("Token amount is too large for one code.")
        token_dict[tt] = amt

    rewards: Dict[str, Any] = {}
    if money_i:
        rewards["money"] = money_i
    if points_i:
        rewards["points"] = points_i
    if token_dict:
        rewards["tokens"] = token_dict
    if not rewards:
        raise PlayerRedeemError("Add cash, points, or tokens you hold.")
    return rewards


def rewards_inc_map(rewards: dict, *, sign: int = 1) -> Dict[str, int]:
    inc: Dict[str, int] = {}
    if rewards.get("money"):
        inc["money"] = sign * int(rewards["money"])
    if rewards.get("points"):
        inc["points"] = sign * int(rewards["points"])
    for token_type, amount in (rewards.get("tokens") or {}).items():
        field = count_field_for_token(str(token_type))
        if field and amount:
            inc[field] = sign * int(amount)
    return inc


def format_rewards_line(rewards: dict) -> str:
    parts: List[str] = []
    if rewards.get("money"):
        parts.append(f"${int(rewards['money']):,} cash")
    if rewards.get("points"):
        parts.append(f"{int(rewards['points']):,} points")
    for token_type, amount in (rewards.get("tokens") or {}).items():
        if amount:
            parts.append(f"{int(amount)}× {str(token_type).replace('_', ' ')}")
    return ", ".join(parts) if parts else "nothing"


def _http(detail: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail=detail)


async def _alive_users_on_ips(db: Any, ips: Set[str], exclude_ids: Set[str]) -> List[dict]:
    if not ips:
        return []
    ip_list = list(ips)
    q: Dict[str, Any] = {
        "is_dead": {"$ne": True},
        "is_npc": {"$ne": True},
        "$or": [
            {"registration_ip": {"$in": ip_list}},
            {"last_login_ip": {"$in": ip_list}},
            {"last_request_ip": {"$in": ip_list}},
            {"login_ips": {"$in": ip_list}},
            {"sessions.ip": {"$in": ip_list}},
        ],
    }
    if exclude_ids:
        q["id"] = {"$nin": list(exclude_ids)}
    cursor = db.users.find(q, IP_USER_PROJECTION)
    if hasattr(cursor, "to_list"):
        return await cursor.to_list(50)
    rows = []
    async for doc in cursor:
        rows.append(doc)
        if len(rows) >= 50:
            break
    return rows


async def player_code_ip_blocked(
    db: Any,
    *,
    creator: dict,
    redeemer: dict,
    request_ip: str = "",
    creator_ip_snapshot: Optional[Iterable[str]] = None,
) -> bool:
    """True when creator/redeemer share IPs or a living alt bridges them."""
    creator_id = str(creator.get("id") or "")
    redeemer_id = str(redeemer.get("id") or "")
    if not creator_id or not redeemer_id:
        return True
    if creator_id == redeemer_id:
        return True

    creator_ips = ips_from_user(creator, extra=creator_ip_snapshot)
    redeemer_ips = ips_from_user(redeemer, extra=[request_ip] if request_ip else None)
    if creator_ips and redeemer_ips and (creator_ips & redeemer_ips):
        return True

    on_creator = await _alive_users_on_ips(db, creator_ips, {creator_id})
    if any(str(u.get("id") or "") == redeemer_id for u in on_creator):
        return True
    on_redeemer = await _alive_users_on_ips(db, redeemer_ips, {redeemer_id})
    if any(str(u.get("id") or "") == creator_id for u in on_redeemer):
        return True

    bridge_ids = {str(u.get("id") or "") for u in on_creator if str(u.get("id") or "") not in {creator_id, redeemer_id}}
    if bridge_ids and redeemer_ips:
        for other in on_creator:
            oid = str(other.get("id") or "")
            if oid not in bridge_ids:
                continue
            other_ips = ips_from_user(other)
            if other_ips & redeemer_ips:
                return True
    return False


async def raise_if_player_code_ip_blocked(
    db: Any,
    *,
    creator: dict,
    redeemer: dict,
    request_ip: str = "",
    creator_ip_snapshot: Optional[Iterable[str]] = None,
) -> None:
    blocked = await player_code_ip_blocked(
        db,
        creator=creator,
        redeemer=redeemer,
        request_ip=request_ip,
        creator_ip_snapshot=creator_ip_snapshot,
    )
    if blocked:
        raise PlayerRedeemError(SAME_IP_DETAIL)


async def assert_can_redeem_player_code(
    db: Any,
    *,
    code_doc: dict,
    redeemer: dict,
    request_ip: str = "",
) -> None:
    if (code_doc.get("source") or "") != PLAYER_CODE_SOURCE:
        return
    creator_id = str(code_doc.get("created_by_user_id") or "")
    redeemer_id = str(redeemer.get("id") or "")
    if not creator_id:
        raise PlayerRedeemError("This player code is missing its creator.")
    if creator_id == redeemer_id:
        raise PlayerRedeemError("You cannot redeem a code you created.")

    target = (code_doc.get("target_username") or "").strip()
    if target:
        from server import _username_pattern

        pat = _username_pattern(target)
        uname = (redeemer.get("username") or "").strip()
        if not uname or not pat or not pat.match(uname):
            raise PlayerRedeemError("This code is locked to a different player.")

    creator = await db.users.find_one({"id": creator_id}, IP_USER_PROJECTION) or {
        "id": creator_id,
        "username": code_doc.get("created_by_username") or "",
    }
    await raise_if_player_code_ip_blocked(
        db,
        creator=creator,
        redeemer=redeemer,
        request_ip=request_ip,
        creator_ip_snapshot=code_doc.get("creator_ips") or [],
    )


async def _log(user_id: str, username: str, action: str, details: dict) -> None:
    try:
        from server import log_activity

        await log_activity(user_id, username, action, details)
    except Exception:
        logger.exception("player redeem code activity log failed action=%s", action)


async def _notify(user_id: str, title: str, message: str) -> None:
    if not user_id:
        return
    try:
        from server import send_notification

        await send_notification(user_id, title, message, "player_redeem_code", category="economic")
    except Exception:
        logger.exception("player redeem code notify failed user_id=%s", user_id)


async def list_my_player_codes(db: Any, user_id: str) -> List[dict]:
    cursor = db.redeem_codes.find(
        {
            "source": PLAYER_CODE_SOURCE,
            "created_by_user_id": user_id,
            "active": True,
            "used_count": 0,
        },
        {
            "_id": 0,
            "code": 1,
            "rewards": 1,
            "target_username": 1,
            "created_at": 1,
            "max_uses": 1,
            "used_count": 1,
            "active": 1,
        },
    )
    if hasattr(cursor, "sort"):
        cursor = cursor.sort("created_at", -1)
    if hasattr(cursor, "to_list"):
        rows = await cursor.to_list(MAX_ACTIVE_UNUSED_CODES + 5)
    else:
        rows = [d async for d in cursor]
    out = []
    for doc in rows:
        out.append({
            "code": doc.get("code") or "",
            "rewards": doc.get("rewards") or {},
            "target_username": doc.get("target_username") or "",
            "created_at": doc.get("created_at"),
            "summary": format_rewards_line(doc.get("rewards") or {}),
        })
    return out


async def create_player_redeem_code(
    db: Any,
    *,
    creator: dict,
    money: int = 0,
    points: int = 0,
    tokens: Optional[dict] = None,
    target_username: str = "",
    request_ip: str = "",
) -> dict:
    uid = str(creator.get("id") or "")
    uname = (creator.get("username") or "").strip() or "?"
    if not uid:
        raise PlayerRedeemError("Not authenticated")
    if creator.get("is_dead"):
        raise PlayerRedeemError("Dead accounts cannot create redeem codes.")
    if creator.get("is_npc"):
        raise PlayerRedeemError("Cannot create a redeem code.")

    rewards = parse_player_rewards(money=money, points=points, tokens=tokens)
    target = (target_username or "").strip()
    target_id = ""
    if target:
        from server import _username_pattern

        pat = _username_pattern(target)
        if not pat:
            raise PlayerRedeemError("Enter their exact in-game username.")
        recipient = await db.users.find_one({"username": pat}, IP_USER_PROJECTION)
        if not recipient:
            raise PlayerRedeemError("No player found with that username.")
        target_id = str(recipient.get("id") or "")
        if target_id == uid:
            raise PlayerRedeemError("You cannot make a code for yourself.")
        if recipient.get("is_dead"):
            raise PlayerRedeemError("That player is dead.")
        await raise_if_player_code_ip_blocked(
            db,
            creator=creator,
            redeemer=recipient,
            request_ip=request_ip,
        )
        target = (recipient.get("username") or target).strip()

    active_n = await db.redeem_codes.count_documents({
        "source": PLAYER_CODE_SOURCE,
        "created_by_user_id": uid,
        "active": True,
        "used_count": 0,
    })
    if int(active_n or 0) >= MAX_ACTIVE_UNUSED_CODES:
        raise PlayerRedeemError(
            f"You already have {MAX_ACTIVE_UNUSED_CODES} unused codes. Cancel one, or wait until one is redeemed."
        )

    inc = rewards_inc_map(rewards, sign=-1)
    filt: Dict[str, Any] = {"id": uid}
    for field, delta in inc.items():
        if delta < 0:
            filt[field] = {"$gte": abs(delta)}
    result = await db.users.update_one(filt, {"$inc": inc})
    if getattr(result, "modified_count", 0) == 0 and getattr(result, "matched_count", 0) == 0:
        raise PlayerRedeemError("Not enough cash, points, or tokens for this code.")
    if getattr(result, "modified_count", 0) == 0:
        raise PlayerRedeemError("Not enough cash, points, or tokens for this code.")

    if rewards.get("points"):
        try:
            from utils.point_provenance import log_points_event

            await log_points_event(
                db,
                user_id=uid,
                points=-int(rewards["points"]),
                event_type="player_redeem_code_create",
                event_ref=uid,
                meta={"rewards": rewards},
            )
        except Exception:
            logger.exception("player redeem create points log failed user_id=%s", uid)

    creator_ips = sorted(ips_from_user(creator, extra=[request_ip] if request_ip else None))
    code = generate_player_code()
    for _ in range(8):
        existing = await db.redeem_codes.find_one({"code": code}, {"_id": 1})
        if not existing:
            break
        code = generate_player_code()
    else:
        await db.users.update_one({"id": uid}, {"$inc": rewards_inc_map(rewards, sign=1)})
        raise PlayerRedeemError("Could not generate a unique code. Try again.")

    now = _now_iso()
    doc = {
        "code": code,
        "rewards": rewards,
        "max_uses": 1,
        "used_count": 0,
        "used_by": [],
        "active": True,
        "source": PLAYER_CODE_SOURCE,
        "created_by_user_id": uid,
        "created_by_username": uname,
        "created_at": now,
        "creator_ips": creator_ips,
        "target_username": target,
        "target_user_id": target_id,
    }
    try:
        await db.redeem_codes.insert_one(doc)
    except Exception:
        await db.users.update_one({"id": uid}, {"$inc": rewards_inc_map(rewards, sign=1)})
        logger.exception("player redeem insert failed user_id=%s", uid)
        raise PlayerRedeemError("Could not save the code. Your items were not taken.")

    await _log(uid, uname, "player_redeem_code_create", {
        "code": code,
        "rewards": rewards,
        "target_username": target or None,
        "summary": format_rewards_line(rewards),
    })
    return {
        "message": f"Code {code} created. Items have been taken from your inventory.",
        "code": code,
        "rewards": rewards,
        "target_username": target,
        "summary": format_rewards_line(rewards),
    }


async def cancel_player_redeem_code(db: Any, *, user: dict, code: str) -> dict:
    uid = str(user.get("id") or "")
    uname = (user.get("username") or "").strip() or "?"
    code_normalized = (code or "").strip().upper()
    if not uid or not code_normalized:
        raise PlayerRedeemError("Code is required")
    claimed = await db.redeem_codes.find_one_and_update(
        {
            "code": code_normalized,
            "source": PLAYER_CODE_SOURCE,
            "created_by_user_id": uid,
            "active": True,
            "used_count": 0,
        },
        {"$set": {"active": False, "cancelled_at": _now_iso(), "cancelled_by_user_id": uid}},
    )
    if not claimed:
        raise PlayerRedeemError("Unused code not found (already redeemed or cancelled).")
    rewards = claimed.get("rewards") or {}
    inc = rewards_inc_map(rewards, sign=1)
    if inc:
        await db.users.update_one({"id": uid}, {"$inc": inc})
    if rewards.get("points"):
        try:
            from utils.point_provenance import log_points_event

            await log_points_event(
                db,
                user_id=uid,
                points=int(rewards["points"]),
                event_type="player_redeem_code_cancel",
                event_ref=code_normalized,
                meta={"code": code_normalized, "rewards": rewards},
            )
        except Exception:
            logger.exception("player redeem cancel points log failed user_id=%s", uid)
    await _log(uid, uname, "player_redeem_code_cancel", {
        "code": code_normalized,
        "rewards": rewards,
        "summary": format_rewards_line(rewards),
    })
    return {
        "message": f"Cancelled {code_normalized}. Items returned to you.",
        "code": code_normalized,
        "rewards": rewards,
    }


async def refund_unused_player_code_as_admin(db: Any, *, code_doc: dict, admin_username: str) -> bool:
    """If this is an unused player code, refund the creator. Returns True if refunded."""
    if (code_doc.get("source") or "") != PLAYER_CODE_SOURCE:
        return False
    if int(code_doc.get("used_count") or 0) > 0:
        return False
    if code_doc.get("cancelled_at"):
        return False
    uid = str(code_doc.get("created_by_user_id") or "")
    rewards = code_doc.get("rewards") or {}
    inc = rewards_inc_map(rewards, sign=1)
    if uid and inc:
        await db.users.update_one({"id": uid}, {"$inc": inc})
    await db.redeem_codes.update_one(
        {"code": code_doc.get("code")},
        {"$set": {
            "active": False,
            "cancelled_at": _now_iso(),
            "cancelled_by_admin": admin_username,
        }},
    )
    await _log(
        uid or "admin",
        code_doc.get("created_by_username") or "?",
        "player_redeem_code_cancel",
        {
            "code": code_doc.get("code"),
            "rewards": rewards,
            "admin": admin_username,
            "summary": format_rewards_line(rewards),
        },
    )
    return True


async def log_player_code_redeemed(
    *,
    code_doc: dict,
    redeemer: dict,
    granted: List[str],
) -> None:
    code = code_doc.get("code") or ""
    rewards = code_doc.get("rewards") or {}
    creator_id = str(code_doc.get("created_by_user_id") or "")
    creator_name = code_doc.get("created_by_username") or "?"
    redeemer_id = str(redeemer.get("id") or "")
    redeemer_name = (redeemer.get("username") or "").strip() or "?"
    details = {
        "code": code,
        "rewards": rewards,
        "summary": format_rewards_line(rewards),
        "creator_user_id": creator_id,
        "creator_username": creator_name,
        "redeemer_user_id": redeemer_id,
        "redeemer_username": redeemer_name,
        "granted": granted,
    }
    await _log(redeemer_id, redeemer_name, "player_redeem_code_redeem", details)
    if creator_id and creator_id != redeemer_id:
        await _log(creator_id, creator_name, "player_redeem_code_claimed", details)
        await _notify(
            creator_id,
            "Redeem code claimed",
            f"{redeemer_name} redeemed {code} ({format_rewards_line(rewards)}).",
        )
