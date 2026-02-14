# Bank endpoints: meta, overview, interest deposit/claim, Swiss deposit/withdraw, transfer
from datetime import datetime, timezone, timedelta
import uuid
from typing import Optional
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    SWISS_BANK_LIMIT_START,
    BANK_INTEREST_OPTIONS,
)


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


def _interest_option(duration_hours: int) -> Optional[dict]:
    try:
        h = int(duration_hours)
    except Exception:
        return None
    return next((o for o in BANK_INTEREST_OPTIONS if int(o.get("hours", 0) or 0) == h), None)


def _parse_matures_at(matures_at: Optional[str]) -> Optional[datetime]:
    if not matures_at:
        return None
    try:
        mat = datetime.fromisoformat(matures_at.replace("Z", "+00:00"))
        if mat.tzinfo is None:
            mat = mat.replace(tzinfo=timezone.utc)
        return mat
    except Exception:
        return None


async def bank_meta(current_user: dict = Depends(get_current_user)):
    return {
        "swiss_limit_start": SWISS_BANK_LIMIT_START,
        "interest_options": BANK_INTEREST_OPTIONS,
    }


async def bank_overview(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1, "swiss_balance": 1, "swiss_limit": 1})
    money = int(user.get("money", 0) or 0) if user else 0
    swiss_balance = int((user or {}).get("swiss_balance", 0) or 0)
    swiss_limit = int((user or {}).get("swiss_limit", SWISS_BANK_LIMIT_START) or SWISS_BANK_LIMIT_START)
    deposits = await db.bank_deposits.find(
        {"user_id": current_user["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    for d in deposits:
        mat = _parse_matures_at(d.get("matures_at"))
        d["matured"] = bool(mat is not None and now >= mat)
    transfers = await db.money_transfers.find(
        {"$or": [{"from_user_id": current_user["id"]}, {"to_user_id": current_user["id"]}]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    for t in transfers:
        t["direction"] = "sent" if t.get("from_user_id") == current_user["id"] else "received"
    return {
        "cash_on_hand": money,
        "swiss_balance": swiss_balance,
        "swiss_limit": swiss_limit,
        "deposits": deposits,
        "transfers": transfers,
    }


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
    return {"message": f"Deposited ${amount:,} for {hours}h", "deposit_id": deposit_id, "interest": interest, "matures_at": matures.isoformat()}


async def bank_interest_claim(request: BankDepositClaimRequest, current_user: dict = Depends(get_current_user)):
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
    return {"message": f"Withdrew ${amount:,} from Swiss Bank"}


async def bank_transfer(request: MoneyTransferRequest, current_user: dict = Depends(get_current_user)):
    to_username = (request.to_username or "").strip()
    if not to_username:
        raise HTTPException(status_code=400, detail="Recipient username required")
    if to_username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Cannot send money to yourself")
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    recipient = await db.users.find_one({"username": to_username}, {"_id": 0})
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
    await db.money_transfers.insert_one({
        "id": transfer_id,
        "from_user_id": current_user["id"],
        "from_username": current_user["username"],
        "to_user_id": recipient["id"],
        "to_username": recipient["username"],
        "amount": int(amount),
        "created_at": now,
    })
    return {"message": f"Sent ${amount:,} to {recipient['username']}"}


def register(router):
    router.add_api_route("/bank/meta", bank_meta, methods=["GET"])
    router.add_api_route("/bank/overview", bank_overview, methods=["GET"])
    router.add_api_route("/bank/interest/deposit", bank_interest_deposit, methods=["POST"])
    router.add_api_route("/bank/interest/claim", bank_interest_claim, methods=["POST"])
    router.add_api_route("/bank/swiss/deposit", bank_swiss_deposit, methods=["POST"])
    router.add_api_route("/bank/swiss/withdraw", bank_swiss_withdraw, methods=["POST"])
    router.add_api_route("/bank/transfer", bank_transfer, methods=["POST"])
