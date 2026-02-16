# Bank endpoints: meta, overview, interest deposit/claim, Swiss deposit/withdraw, transfer
from datetime import datetime, timezone, timedelta
import re
import time
import uuid
import os
import sys
from typing import Optional
from pydantic import BaseModel

from fastapi import Depends, HTTPException, Request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import db, get_current_user

# Set from server in register() (server keeps constants for UserProfile / new-user / auth/me)
SWISS_BANK_LIMIT_START = None
BANK_INTEREST_OPTIONS = None
update_objectives_progress = None
security_module = None
_username_pattern_fn = None
check_rate_limit = None

# Caching: meta is static (same for all users), overview per-user with short TTL
_bank_meta_cache: Optional[dict] = None
_overview_cache: dict = {}  # user_id -> (payload, expires_at)
_OVERVIEW_CACHE_TTL_SEC = 10
_OVERVIEW_CACHE_MAX_ENTRIES = 5000


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


def _interest_option(duration_hours: int) -> dict | None:
    try:
        h = int(duration_hours)
    except Exception:
        return None
    return next((o for o in BANK_INTEREST_OPTIONS if int(o.get("hours", 0) or 0) == h), None)


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


async def bank_meta(current_user: dict = Depends(get_current_user)):
    global _bank_meta_cache
    if _bank_meta_cache is not None:
        return _bank_meta_cache
    _bank_meta_cache = {
        "swiss_limit_start": SWISS_BANK_LIMIT_START,
        "interest_options": BANK_INTEREST_OPTIONS,
    }
    return _bank_meta_cache


async def bank_overview(current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    now_ts = time.monotonic()
    entry = _overview_cache.get(uid)
    if entry is not None and entry[1] > now_ts:
        return entry[0]

    now = datetime.now(timezone.utc)
    user = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1, "swiss_balance": 1, "swiss_limit": 1})
    money = int(user.get("money", 0) or 0) if user else 0
    swiss_balance = int((user or {}).get("swiss_balance", 0) or 0)
    swiss_limit = int((user or {}).get("swiss_limit", SWISS_BANK_LIMIT_START) or SWISS_BANK_LIMIT_START)

    deposits = await db.bank_deposits.find(
        {"user_id": uid},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    for d in deposits:
        mat = _parse_matures_at(d.get("matures_at"))
        d["matured"] = bool(mat is not None and now >= mat)

    transfers = await db.money_transfers.find(
        {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    for t in transfers:
        t["direction"] = "sent" if t.get("from_user_id") == uid else "received"

    payload = {
        "cash_on_hand": money,
        "swiss_balance": swiss_balance,
        "swiss_limit": swiss_limit,
        "deposits": deposits,
        "transfers": transfers,
    }
    if len(_overview_cache) >= _OVERVIEW_CACHE_MAX_ENTRIES:
        _overview_cache.clear()
    _overview_cache[uid] = (payload, now_ts + _OVERVIEW_CACHE_TTL_SEC)
    return payload


async def bank_interest_deposit(request: BankInterestDepositRequest, current_user: dict = Depends(get_current_user)):
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    opt = _interest_option(request.duration_hours)
    if not opt:
        raise HTTPException(status_code=400, detail="Invalid duration")
    rate = float(opt["rate"])
    hours = int(opt["hours"])

    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(user.get("money", 0) or 0) if user else 0
    if amount > money:
        raise HTTPException(status_code=400, detail="Insufficient cash on hand")
    
    # ECONOMY LIMIT: Max $50M total in unclaimed interest deposits
    MAX_INTEREST_DEPOSITS = 50_000_000
    existing_deposits = await db.bank_deposits.aggregate([
        {"$match": {"user_id": current_user["id"], "claimed_at": None}},
        {"$group": {"_id": None, "total_principal": {"$sum": "$principal"}}}
    ]).to_list(1)
    current_total = int(existing_deposits[0].get("total_principal", 0)) if existing_deposits else 0
    
    if current_total + amount > MAX_INTEREST_DEPOSITS:
        remaining = MAX_INTEREST_DEPOSITS - current_total
        raise HTTPException(
            status_code=400, 
            detail=f"Maximum ${MAX_INTEREST_DEPOSITS:,} in interest deposits allowed. You have ${current_total:,} deposited. You can deposit up to ${remaining:,} more."
        )

    now = datetime.now(timezone.utc)
    matures = now + timedelta(hours=hours)
    interest = int(round(amount * rate))

    deposit_id = str(uuid.uuid4())
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -amount}})
    await db.bank_deposits.insert_one({
        "id": deposit_id,
        "user_id": current_user["id"],
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
            await update_objectives_progress(current_user["id"], "deposit_interest", amount)
    except Exception:
        pass
    _invalidate_overview_cache(current_user["id"])
    return {"message": f"Deposited ${amount:,} for {hours}h", "deposit_id": deposit_id, "interest": interest, "matures_at": matures.isoformat()}


async def bank_interest_claim(request: BankDepositClaimRequest, current_user: dict = Depends(get_current_user)):
    """Claim a matured interest deposit. Early withdrawal is not allowed."""
    dep = await db.bank_deposits.find_one({"id": request.deposit_id, "user_id": current_user["id"]}, {"_id": 0})
    if not dep:
        raise HTTPException(status_code=404, detail="Deposit not found")
    if dep.get("claimed_at"):
        raise HTTPException(status_code=400, detail="Deposit already claimed")

    now = datetime.now(timezone.utc)
    mat = _parse_matures_at(dep.get("matures_at"))
    if mat is None:
        raise HTTPException(status_code=400, detail="Deposit missing or invalid maturity time")
    if now < mat:
        raise HTTPException(status_code=400, detail="Cannot withdraw early. Deposit has not matured yet.")

    principal = int(dep.get("principal", 0) or 0)
    interest = int(dep.get("interest_amount", 0) or 0)
    total = principal + interest

    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": total}})
    await db.bank_deposits.update_one({"id": dep["id"]}, {"$set": {"claimed_at": now.isoformat()}})
    _invalidate_overview_cache(current_user["id"])
    return {"message": f"Claimed ${total:,} (${principal:,} + ${interest:,} interest)", "total": total}


async def bank_swiss_deposit(request: BankSwissMoveRequest, current_user: dict = Depends(get_current_user)):
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1, "swiss_balance": 1, "swiss_limit": 1})
    money = int(user.get("money", 0) or 0) if user else 0
    swiss_balance = int(user.get("swiss_balance", 0) or 0) if user else 0
    swiss_limit = int(user.get("swiss_limit", SWISS_BANK_LIMIT_START) or SWISS_BANK_LIMIT_START) if user else SWISS_BANK_LIMIT_START
    if amount > money:
        raise HTTPException(status_code=400, detail="Insufficient cash on hand")
    if swiss_balance + amount > swiss_limit:
        raise HTTPException(status_code=400, detail=f"Swiss bank limit is ${swiss_limit:,}")

    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -amount, "swiss_balance": amount}}
    )
    _invalidate_overview_cache(current_user["id"])
    return {"message": f"Deposited ${amount:,} into Swiss Bank"}


async def bank_swiss_withdraw(request: BankSwissMoveRequest, current_user: dict = Depends(get_current_user)):
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "swiss_balance": 1})
    swiss_balance = int(user.get("swiss_balance", 0) or 0) if user else 0
    if amount > swiss_balance:
        raise HTTPException(status_code=400, detail="Insufficient Swiss balance")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": amount, "swiss_balance": -amount}}
    )
    _invalidate_overview_cache(current_user["id"])
    return {"message": f"Withdrew ${amount:,} from Swiss Bank"}


async def bank_transfer(request: MoneyTransferRequest, req: Request, current_user: dict = Depends(get_current_user)):
    if check_rate_limit:
        try:
            allowed, error_msg = check_rate_limit(current_user["id"], "money_transfers")
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

    sender = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(sender.get("money", 0) or 0) if sender else 0
    if amount > money:
        raise HTTPException(status_code=400, detail="Insufficient cash on hand")

    now = datetime.now(timezone.utc).isoformat()
    transfer_id = str(uuid.uuid4())
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -amount}})
    await db.users.update_one({"id": recipient["id"]}, {"$inc": {"money": amount}})
    if security_module and getattr(security_module, "check_negative_balance", None):
        try:
            await security_module.check_negative_balance(db, current_user["id"], current_user.get("username", ""))
            await security_module.check_negative_balance(db, recipient["id"], recipient.get("username", ""))
        except Exception:
            pass
    await db.money_transfers.insert_one({
        "id": transfer_id,
        "from_user_id": current_user["id"],
        "from_username": current_user.get("username", ""),
        "to_user_id": recipient["id"],
        "to_username": recipient.get("username", ""),
        "amount": int(amount),
        "created_at": now,
    })
    _invalidate_overview_cache(current_user["id"])
    _invalidate_overview_cache(recipient["id"])
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

    router.add_api_route("/bank/meta", bank_meta, methods=["GET"])
    router.add_api_route("/bank/overview", bank_overview, methods=["GET"])
    router.add_api_route("/bank/interest/deposit", bank_interest_deposit, methods=["POST"])
    router.add_api_route("/bank/interest/claim", bank_interest_claim, methods=["POST"])
    router.add_api_route("/bank/swiss/deposit", bank_swiss_deposit, methods=["POST"])
    router.add_api_route("/bank/swiss/withdraw", bank_swiss_withdraw, methods=["POST"])
    router.add_api_route("/bank/transfer", bank_transfer, methods=["POST"])
