# Bank endpoints: meta, overview, interest deposit/claim, Swiss deposit/withdraw, transfer
import asyncio
from datetime import datetime, timezone, timedelta
import re
import time
import uuid
import os
import sys
from pydantic import BaseModel
from fastapi import Depends, HTTPException, Request
from pymongo import ReturnDocument

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import db, get_current_user, get_current_user_verified, log_activity, send_notification
from utils.bank_economy_settings import (
    get_bank_economy_config,
    interest_option_for_hours,
    personal_interest_limit,
    interest_limit_upgrade_add,
    interest_limit_max_upgrades,
    interest_limit_public,
    INTEREST_LIMIT_HARD_MAX,
    INTEREST_LIMIT_START,
    INTEREST_LIMIT_UPGRADE_COST,
    INTEREST_LIMIT_UPGRADES_FIELD,
)
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_BANK
from utils.transfer_display import redact_quicktrade_party_names

# Set from server in register() (server keeps constants for UserProfile / new-user / auth/me)
SWISS_BANK_LIMIT_START = None
BANK_INTEREST_OPTIONS = None
update_objectives_progress = None
security_module = None
_username_pattern_fn = None
check_rate_limit = None

# Overview per-user with short TTL (bank meta reads live game_settings)
_overview_cache: dict = {}  # user_id -> (payload, expires_at)
_OVERVIEW_CACHE_TTL_SEC = 10
_OVERVIEW_CACHE_MAX_ENTRIES = 5000


async def _bank_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_BANK)


_bank_rl_u = [Depends(_bank_sustained_rl_user)]


class BankInterestDepositRequest(BaseModel):
    amount: int
    duration_hours: int


class BankDepositClaimRequest(BaseModel):
    deposit_id: str


class BankSwissMoveRequest(BaseModel):
    amount: int


class MoneyTransferRequest(BaseModel):
    to_username: str
    amount: int


def _interest_option(duration_hours: int, options: list) -> dict | None:
    return interest_option_for_hours(options or [], duration_hours)


async def _unclaimed_interest_principal(user_id: str) -> int:
    rows = await db.bank_deposits.aggregate(
        [
            {"$match": {"user_id": user_id, "claimed_at": None}},
            {"$group": {"_id": None, "total_principal": {"$sum": "$principal"}}},
        ]
    ).to_list(1)
    return int(rows[0].get("total_principal", 0) or 0) if rows else 0


def _parse_matures_at(matures_at: str | None) -> datetime | None:
    """Parse deposit matures_at to timezone-aware UTC datetime. Returns None if missing/invalid."""
    if not matures_at:
        return None
    try:
        mat = datetime.fromisoformat(matures_at.replace("Z", "+00:00"))
        if mat.tzinfo is None:
            mat = mat.replace(tzinfo=timezone.utc)
        return mat
    except Exception:
        return None


def _invalidate_overview_cache(user_id: str):
    """Call after any bank write (deposit, claim, swiss, transfer) for this user."""
    _overview_cache.pop(user_id, None)


async def bank_meta(current_user: dict = Depends(get_current_user_verified)):
    cfg = await get_bank_economy_config(
        db,
        swiss_fallback=int(SWISS_BANK_LIMIT_START or 50_000_000),
        interest_max_fallback=INTEREST_LIMIT_START,
        interest_options_fallback=list(BANK_INTEREST_OPTIONS or []),
    )
    return {
        "swiss_limit_start": cfg["swiss_limit_start"],
        "interest_options": cfg["interest_options"],
        "interest_max_unclaimed_principal": cfg["interest_max_unclaimed_principal"],
        "interest_limit_max": cfg["interest_limit_hard_max"],
        "interest_limit_step": cfg["interest_limit_step"],
        "interest_limit_upgrade_cost": cfg["interest_limit_upgrade_cost"],
    }


async def bank_overview(current_user: dict = Depends(get_current_user_verified)):
    uid = current_user.get("id") or ""
    now_ts = time.monotonic()
    entry = _overview_cache.get(uid)
    if entry is not None and entry[1] > now_ts:
        return entry[0]

    now = datetime.now(timezone.utc)
    user = await db.users.find_one(
        {"id": uid},
        {"_id": 0, "money": 1, "swiss_balance": 1, "swiss_limit": 1, "points": 1, INTEREST_LIMIT_UPGRADES_FIELD: 1},
    )
    money = int(user.get("money", 0) or 0) if user else 0
    swiss_balance = int((user or {}).get("swiss_balance", 0) or 0)
    cfg_sw = await get_bank_economy_config(
        db,
        swiss_fallback=int(SWISS_BANK_LIMIT_START or 50_000_000),
        interest_max_fallback=INTEREST_LIMIT_START,
        interest_options_fallback=list(BANK_INTEREST_OPTIONS or []),
    )
    default_swiss = cfg_sw["swiss_limit_start"]
    swiss_limit = int((user or {}).get("swiss_limit", default_swiss) or default_swiss)

    deposits_raw, transfers_raw, unclaimed_principal = await asyncio.gather(
        db.bank_deposits.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(50),
        db.money_transfers.find(
            {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]},
            {"_id": 0}
        ).sort("created_at", -1).to_list(50),
        _unclaimed_interest_principal(uid),
    )
    deposits = list(deposits_raw)
    for d in deposits:
        mat = _parse_matures_at(d.get("matures_at"))
        d["matured"] = bool(mat is not None and now >= mat)
    interest_pub = interest_limit_public(
        user,
        cfg_sw["interest_max_unclaimed_principal"],
        principal=int(unclaimed_principal or 0),
        points=int((user or {}).get("points") or 0),
    )
    transfers = list(transfers_raw)
    for t in transfers:
        t["direction"] = "sent" if t.get("from_user_id") == uid else "received"
        r = redact_quicktrade_party_names(t, uid)
        t["from_username"] = r.get("from_username")
        t["to_username"] = r.get("to_username")
        t.pop("qt_anonymize_from", None)
        t.pop("qt_anonymize_to", None)

    payload = {
        "cash_on_hand": money,
        "swiss_balance": swiss_balance,
        "swiss_limit": swiss_limit,
        "deposits": deposits,
        "transfers": transfers,
        **interest_pub,
    }
    if len(_overview_cache) >= _OVERVIEW_CACHE_MAX_ENTRIES:
        _overview_cache.clear()
    _overview_cache[uid] = (payload, now_ts + _OVERVIEW_CACHE_TTL_SEC)
    return payload


async def bank_interest_deposit(request: BankInterestDepositRequest, current_user: dict = Depends(get_current_user_verified)):
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    cfg = await get_bank_economy_config(
        db,
        swiss_fallback=int(SWISS_BANK_LIMIT_START or 50_000_000),
        interest_max_fallback=INTEREST_LIMIT_START,
        interest_options_fallback=list(BANK_INTEREST_OPTIONS or []),
    )
    opt = _interest_option(request.duration_hours, cfg["interest_options"])
    if not opt:
        raise HTTPException(status_code=400, detail="Invalid duration")
    rate = float(opt["rate"])
    hours = int(opt["hours"])
    uid = current_user.get("id") or ""

    owner = await db.users.find_one({"id": uid}, {"_id": 0, INTEREST_LIMIT_UPGRADES_FIELD: 1})
    MAX_INTEREST_DEPOSITS = personal_interest_limit(owner, cfg["interest_max_unclaimed_principal"])
    current_total = await _unclaimed_interest_principal(uid)
    
    if current_total + amount > MAX_INTEREST_DEPOSITS:
        remaining = max(0, MAX_INTEREST_DEPOSITS - current_total)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Maximum ${MAX_INTEREST_DEPOSITS:,} in active interest deposits allowed. "
                f"You have ${current_total:,} deposited. You can deposit up to ${remaining:,} more. "
                f"Raise the limit with points (1,000 pts per $2.5B, max $50,000,000,000)."
            ),
        )

    now = datetime.now(timezone.utc)
    matures = now + timedelta(hours=hours)
    interest = int(round(amount * rate))
    try:
        from utils.loot_reclaimable_passives import BUFF_BANK_INTEREST, get_reclaimable_passive_mults_from_user

        interest = int(
            round(
                interest
                * float(get_reclaimable_passive_mults_from_user(current_user).get(BUFF_BANK_INTEREST) or 1.0)
            )
        )
    except Exception:
        pass

    deposit_id = str(uuid.uuid4())
    result = await db.users.update_one(
        {"id": current_user.get("id") or "", "money": {"$gte": amount}},
        {"$inc": {"money": -amount, "total_interest_deposited": int(amount)}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient cash on hand")
    await db.bank_deposits.insert_one({
        "id": deposit_id,
        "user_id": current_user.get("id") or "",
        "principal": int(amount),
        "duration_hours": hours,
        "interest_rate": rate,
        "interest_amount": int(interest),
        "created_at": now.isoformat(),
        "matures_at": matures.isoformat(),
        "claimed_at": None,
    })
    try:
        if update_objectives_progress:
            await update_objectives_progress(current_user.get("id") or "", "deposit_interest", amount)
    except Exception:
        pass
    _invalidate_overview_cache(current_user.get("id") or "")
    await log_activity(current_user.get("id", ""), current_user.get("username", ""), "bank_deposit", {"amount": amount, "hours": hours, "interest": interest})
    return {"message": f"Deposited ${amount:,} for {hours}h", "deposit_id": deposit_id, "interest": interest, "matures_at": matures.isoformat()}


async def bank_interest_claim(request: BankDepositClaimRequest, current_user: dict = Depends(get_current_user_verified)):
    """Claim a matured interest deposit. Early withdrawal is not allowed."""
    uid = current_user.get("id") or ""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # Atomically mark claimed to prevent double-claim race condition
    dep = await db.bank_deposits.find_one_and_update(
        {"id": request.deposit_id, "user_id": uid, "claimed_at": None},
        {"$set": {"claimed_at": now_iso}},
    )
    if not dep:
        raise HTTPException(status_code=400, detail="Deposit not found or already claimed")

    mat = _parse_matures_at(dep.get("matures_at"))
    if mat is None or now < mat:
        # Not matured or invalid — undo the atomic claim
        await db.bank_deposits.update_one(
            {"id": request.deposit_id, "user_id": uid},
            {"$set": {"claimed_at": None}},
        )
        if mat is None:
            raise HTTPException(status_code=400, detail="Deposit missing or invalid maturity time")
        raise HTTPException(status_code=400, detail="Cannot withdraw early. Deposit has not matured yet.")

    principal = int(dep.get("principal", 0) or 0)
    interest = int(dep.get("interest_amount", 0) or 0)
    total = principal + interest

    await db.users.update_one({"id": uid}, {"$inc": {"money": total}})
    _invalidate_overview_cache(uid)
    await log_activity(uid, current_user.get("username", "?"), "bank_interest_claim", {"principal": principal, "interest": interest, "total": total})
    return {"message": f"Claimed ${total:,} (${principal:,} + ${interest:,} interest)", "total": total}


async def bank_interest_upgrade_limit(current_user: dict = Depends(get_current_user_verified)):
    """Spend 1,000 points to raise the interest deposit cap by $2.5B, up to $50B."""
    from utils.point_provenance import log_points_event

    uid = current_user.get("id") or ""
    cfg = await get_bank_economy_config(
        db,
        swiss_fallback=int(SWISS_BANK_LIMIT_START or 50_000_000),
        interest_max_fallback=INTEREST_LIMIT_START,
        interest_options_fallback=list(BANK_INTEREST_OPTIONS or []),
    )
    start = int(cfg["interest_max_unclaimed_principal"])
    max_upgrades = interest_limit_max_upgrades(start)
    if max_upgrades <= 0:
        raise HTTPException(status_code=400, detail="Interest limit is already at the $50,000,000,000 maximum")

    user = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1, INTEREST_LIMIT_UPGRADES_FIELD: 1})
    current_limit = personal_interest_limit(user, start)
    add = interest_limit_upgrade_add(current_limit)
    if add <= 0:
        raise HTTPException(status_code=400, detail="Interest limit is already at the $50,000,000,000 maximum")
    cost = int(INTEREST_LIMIT_UPGRADE_COST)
    if int((user or {}).get("points") or 0) < cost:
        raise HTTPException(status_code=400, detail=f"Not enough points (need {cost:,})")

    after = await db.users.find_one_and_update(
        {
            "id": uid,
            "points": {"$gte": cost},
            "$or": [
                {INTEREST_LIMIT_UPGRADES_FIELD: {"$exists": False}},
                {INTEREST_LIMIT_UPGRADES_FIELD: {"$lt": max_upgrades}},
            ],
        },
        {"$inc": {"points": -cost, INTEREST_LIMIT_UPGRADES_FIELD: 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not after:
        raise HTTPException(status_code=400, detail="Could not raise interest limit. Check points and try again.")

    new_limit = personal_interest_limit(after, start)
    await log_points_event(
        db,
        user_id=uid,
        points=-cost,
        event_type="bank_interest_limit",
        event_ref=f"interest_limit:{new_limit}",
        meta={"added": add, "new_limit": new_limit},
    )
    _invalidate_overview_cache(uid)
    return {
        "message": f"Interest limit raised to ${new_limit:,} for {cost:,} points",
        "interest_limit": new_limit,
        "added": add,
        "points": int(after.get("points") or 0),
    }


async def bank_swiss_deposit(request: BankSwissMoveRequest, current_user: dict = Depends(get_current_user_verified)):
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    cfg = await get_bank_economy_config(
        db,
        swiss_fallback=int(SWISS_BANK_LIMIT_START or 50_000_000),
        interest_max_fallback=INTEREST_LIMIT_START,
        interest_options_fallback=list(BANK_INTEREST_OPTIONS or []),
    )
    default_swiss = cfg["swiss_limit_start"]
    user = await db.users.find_one({"id": current_user.get("id") or ""}, {"_id": 0, "swiss_balance": 1, "swiss_limit": 1})
    swiss_balance = int(user.get("swiss_balance", 0) or 0) if user else 0
    swiss_limit = int(user.get("swiss_limit", default_swiss) or default_swiss) if user else default_swiss
    if swiss_balance + amount > swiss_limit:
        raise HTTPException(status_code=400, detail=f"Swiss bank limit is ${swiss_limit:,}")

    result = await db.users.update_one(
        {
            "id": current_user.get("id") or "",
            "money": {"$gte": amount},
            "$expr": {"$lte": [{"$add": ["$swiss_balance", amount]}, "$swiss_limit"]},
        },
        {"$inc": {"money": -amount, "swiss_balance": amount}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient cash on hand")
    _invalidate_overview_cache(current_user.get("id") or "")
    await log_activity(current_user.get("id", ""), current_user.get("username", ""), "swiss_deposit", {"amount": amount})
    return {"message": f"Deposited ${amount:,} into Swiss Bank"}


async def bank_swiss_withdraw(request: BankSwissMoveRequest, current_user: dict = Depends(get_current_user_verified)):
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    result = await db.users.update_one(
        {"id": current_user.get("id") or "", "swiss_balance": {"$gte": amount}},
        {"$inc": {"money": amount, "swiss_balance": -amount}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient Swiss balance")
    _invalidate_overview_cache(current_user.get("id") or "")
    await log_activity(current_user.get("id", ""), current_user.get("username", ""), "swiss_withdraw", {"amount": amount})
    return {"message": f"Withdrew ${amount:,} from Swiss Bank"}


async def bank_transfer(request: MoneyTransferRequest, req: Request, current_user: dict = Depends(get_current_user_verified)):
    if check_rate_limit:
        try:
            allowed, error_msg = check_rate_limit(current_user.get("id") or "", "money_transfers")
            if not allowed:
                raise HTTPException(status_code=429, detail=error_msg)
        except TypeError:
            pass
    to_username = (request.to_username or "").strip()
    if not to_username:
        raise HTTPException(status_code=400, detail="Recipient username required")
    if to_username.lower() == (current_user.get("username") or "").lower():
        raise HTTPException(status_code=400, detail="Cannot send money to yourself")
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    username_pattern = _username_pattern_fn(to_username) if _username_pattern_fn else re.compile("^" + re.escape(to_username) + "$", re.IGNORECASE)
    recipient = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if recipient.get("is_dead"):
        raise HTTPException(status_code=400, detail="Recipient is dead")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    transfer_id = str(uuid.uuid4())
    sender_id = current_user.get("id") or ""
    recipient_id = recipient["id"]

    duplicate_cutoff = (now - timedelta(seconds=5)).isoformat()
    recent_dup = await db.money_transfers.find_one({
        "from_user_id": sender_id,
        "to_user_id": recipient_id,
        "amount": int(amount),
        "created_at": {"$gte": duplicate_cutoff},
    })
    if recent_dup:
        raise HTTPException(status_code=400, detail="Duplicate transfer detected. Please wait a few seconds before sending again.")

    sender_row = await db.users.find_one({"id": sender_id}, {"_id": 0, "money": 1})
    if not sender_row:
        raise HTTPException(status_code=401, detail="Invalid session")
    sender_balance = int(sender_row.get("money") or 0)
    if sender_balance < amount:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient cash on hand (you have ${sender_balance:,}, tried to send ${amount:,}).",
        )

    # Atomically debit sender — still required for races (balance can change between read and write).
    debit_result = await db.users.update_one(
        {"id": sender_id, "money": {"$gte": amount}},
        {"$inc": {"money": -amount}},
    )
    if debit_result.modified_count == 0:
        raise HTTPException(
            status_code=400,
            detail="Insufficient cash on hand (your balance changed — try again with a lower amount).",
        )

    # Sender was debited. Now credit recipient.
    credit_result = await db.users.update_one(
        {"id": recipient_id},
        {"$inc": {"money": amount}},
    )
    if credit_result.modified_count == 0:
        # Recipient vanished — rollback sender debit
        await db.users.update_one({"id": sender_id}, {"$inc": {"money": amount}})
        raise HTTPException(status_code=400, detail="Transfer failed — recipient account unavailable.")

    sender_u = await db.users.find_one({"id": sender_id}, {"_id": 0, "money": 1})
    recipient_u = await db.users.find_one({"id": recipient_id}, {"_id": 0, "money": 1})
    sender_after = int((sender_u or {}).get("money") or 0)
    recipient_after = int((recipient_u or {}).get("money") or 0)
    sender_before = sender_after + int(amount)
    recipient_before = recipient_after - int(amount)

    transfer_doc = {
        "id": transfer_id,
        "from_user_id": sender_id,
        "from_username": current_user.get("username", ""),
        "to_user_id": recipient_id,
        "to_username": recipient.get("username", ""),
        "amount": int(amount),
        "created_at": now_iso,
        "sender_money_before": sender_before,
        "sender_money_after": sender_after,
        "recipient_money_before": recipient_before,
        "recipient_money_after": recipient_after,
    }
    await db.money_transfers.insert_one(transfer_doc)
    sender_display = (current_user.get("username") or "").strip() or "?"
    await send_notification(
        recipient_id,
        "Cash received",
        f"{sender_display} sent you ${amount:,}.",
        "reward",
    )
    if security_module and getattr(security_module, "check_negative_balance", None):
        try:
            await security_module.check_negative_balance(db, sender_id, current_user.get("username", ""))
            await security_module.check_negative_balance(db, recipient_id, recipient.get("username", ""))
        except Exception:
            pass
    _invalidate_overview_cache(sender_id)
    _invalidate_overview_cache(recipient_id)
    await log_activity(sender_id, current_user.get("username", ""), "bank_transfer", {"amount": amount, "recipient_id": recipient_id, "recipient": recipient.get("username", "")})
    return {"message": f"Sent ${amount:,} to {recipient.get('username', '')}"}


def register(router):
    """Register bank routes. Must be called after server module is fully loaded."""
    import server as srv
    global SWISS_BANK_LIMIT_START, BANK_INTEREST_OPTIONS, update_objectives_progress, security_module, _username_pattern_fn, check_rate_limit
    SWISS_BANK_LIMIT_START = getattr(srv, "SWISS_BANK_LIMIT_START", 50_000_000)
    BANK_INTEREST_OPTIONS = getattr(srv, "BANK_INTEREST_OPTIONS", [])
    update_objectives_progress = getattr(srv, "update_objectives_progress", None)
    security_module = getattr(srv, "security_module", None)
    _username_pattern_fn = getattr(srv, "_username_pattern", None)
    check_rate_limit = getattr(srv, "check_rate_limit", None)

    router.add_api_route("/bank/meta", bank_meta, methods=["GET"], dependencies=_bank_rl_u)
    router.add_api_route("/bank/overview", bank_overview, methods=["GET"], dependencies=_bank_rl_u)
    router.add_api_route("/bank/interest/deposit", bank_interest_deposit, methods=["POST"])
    router.add_api_route("/bank/interest/claim", bank_interest_claim, methods=["POST"])
    router.add_api_route("/bank/interest/upgrade-limit", bank_interest_upgrade_limit, methods=["POST"])
    router.add_api_route("/bank/swiss/deposit", bank_swiss_deposit, methods=["POST"])
    router.add_api_route("/bank/swiss/withdraw", bank_swiss_withdraw, methods=["POST"])
    router.add_api_route("/bank/transfer", bank_transfer, methods=["POST"])
