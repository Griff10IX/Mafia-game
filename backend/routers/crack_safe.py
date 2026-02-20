# Crack the Safe: jackpot game. 50 attempts/day free, +50 purchasable. Admins unlimited.
from datetime import datetime, timezone, timedelta
import random
from typing import List

from pydantic import BaseModel, field_validator
from fastapi import Depends, HTTPException

from server import db, get_current_user, _is_admin

SAFE_ENTRY_COST = 5_000_000
SAFE_JACKPOT_SEED = 100_000_000
SAFE_JACKPOT_SHARE = 0.90
SAFE_DIGITS = 5
SAFE_MIN = 1
SAFE_MAX = 9
FREE_DAILY_ATTEMPTS = 50
BONUS_ATTEMPTS = 50
BONUS_ATTEMPTS_COST = 50_000_000


class SafeGuessRequest(BaseModel):
    numbers: List[int]

    @field_validator("numbers")
    @classmethod
    def validate_numbers(cls, v):
        if len(v) != SAFE_DIGITS:
            raise ValueError(f"Must provide exactly {SAFE_DIGITS} numbers")
        for n in v:
            if not (SAFE_MIN <= n <= SAFE_MAX):
                raise ValueError(f"Each number must be between {SAFE_MIN} and {SAFE_MAX}")
        return v


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _get_daily(user_id: str) -> dict:
    """Get or create today's daily tracking doc for a user."""
    today = _today_str()
    doc = await db.safe_daily.find_one({"user_id": user_id, "date": today})
    if not doc:
        doc = {"user_id": user_id, "date": today, "attempts_used": 0, "bonus_purchased": False}
        await db.safe_daily.insert_one(doc)
        doc = await db.safe_daily.find_one({"user_id": user_id, "date": today})
    return doc


async def _get_or_create_safe():
    safe = await db.safe_game.find_one({})
    if not safe:
        combo = [random.randint(SAFE_MIN, SAFE_MAX) for _ in range(SAFE_DIGITS)]
        doc = {
            "combination": combo,
            "jackpot": SAFE_JACKPOT_SEED,
            "total_attempts": 0,
            "last_winner_username": None,
            "last_won_at": None,
            "created_at": datetime.now(timezone.utc),
        }
        await db.safe_game.insert_one(doc)
        safe = await db.safe_game.find_one({})
    return safe


def _generate_clues(combo: list, total_attempts: int) -> list:
    even_count = sum(1 for n in combo if n % 2 == 0)
    total_sum = sum(combo)
    high = max(combo)
    return [
        {"id": 1, "unlocked": True, "text": f"There are {even_count} even number{'s' if even_count != 1 else ''}", "unlock_after": 0},
        {"id": 2, "unlocked": total_attempts >= 5, "text": f"The sum of all numbers is {total_sum}", "unlock_after": 5},
        {"id": 3, "unlocked": total_attempts >= 15, "text": f"The highest number is {high}", "unlock_after": 15},
        {"id": 4, "unlocked": total_attempts >= 30, "text": f"The first number is {combo[0]}", "unlock_after": 30},
    ]


def register(router):
    @router.get("/crack-safe/info")
    async def crack_safe_info(user: dict = Depends(get_current_user)):
        safe = await _get_or_create_safe()
        combo = safe["combination"]
        total_attempts = safe.get("total_attempts", 0)
        clues = _generate_clues(combo, total_attempts)
        is_admin = _is_admin(user)

        if is_admin:
            response = {
                "jackpot": safe.get("jackpot", SAFE_JACKPOT_SEED),
                "total_attempts": total_attempts,
                "last_winner_username": safe.get("last_winner_username"),
                "last_won_at": safe.get("last_won_at").isoformat() if safe.get("last_won_at") else None,
                "can_guess": True,
                "next_guess_at": None,
                "entry_cost": SAFE_ENTRY_COST,
                "clues": clues,
                "attempts_used": 0,
                "attempts_limit": None,
                "bonus_purchased": False,
                "is_admin": True,
                "bonus_cost": BONUS_ATTEMPTS_COST,
                "admin_combination": combo,
            }
            return response

        daily = await _get_daily(user["id"])
        attempts_used = daily.get("attempts_used", 0)
        bonus_purchased = daily.get("bonus_purchased", False)
        attempts_limit = FREE_DAILY_ATTEMPTS + (BONUS_ATTEMPTS if bonus_purchased else 0)
        attempts_remaining = max(0, attempts_limit - attempts_used)
        can_guess = attempts_remaining > 0

        now = datetime.now(timezone.utc)
        midnight_tomorrow = (now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))
        next_guess_at = midnight_tomorrow.isoformat() if not can_guess else None

        return {
            "jackpot": safe.get("jackpot", SAFE_JACKPOT_SEED),
            "total_attempts": total_attempts,
            "last_winner_username": safe.get("last_winner_username"),
            "last_won_at": safe.get("last_won_at").isoformat() if safe.get("last_won_at") else None,
            "can_guess": can_guess,
            "next_guess_at": next_guess_at,
            "entry_cost": SAFE_ENTRY_COST,
            "clues": clues,
            "attempts_used": attempts_used,
            "attempts_limit": attempts_limit,
            "bonus_purchased": bonus_purchased,
            "is_admin": False,
            "bonus_cost": BONUS_ATTEMPTS_COST,
        }

    @router.post("/crack-safe/guess")
    async def crack_safe_guess(req: SafeGuessRequest, user: dict = Depends(get_current_user)):
        safe = await _get_or_create_safe()
        combo = safe["combination"]
        now = datetime.now(timezone.utc)
        is_admin = _is_admin(user)

        if not is_admin:
            daily = await _get_daily(user["id"])
            attempts_used = daily.get("attempts_used", 0)
            bonus_purchased = daily.get("bonus_purchased", False)
            attempts_limit = FREE_DAILY_ATTEMPTS + (BONUS_ATTEMPTS if bonus_purchased else 0)
            if attempts_used >= attempts_limit:
                extra = "" if bonus_purchased else f" You can purchase {BONUS_ATTEMPTS} more for ${BONUS_ATTEMPTS_COST:,}."
                raise HTTPException(status_code=400, detail=f"You have used all your attempts for today.{extra}")

        if user.get("money", 0) < SAFE_ENTRY_COST:
            raise HTTPException(status_code=400, detail=f"You need ${SAFE_ENTRY_COST:,} to attempt to crack the safe.")

        await db.users.update_one({"id": user["id"]}, {"$inc": {"money": -SAFE_ENTRY_COST}})

        jackpot_contribution = int(SAFE_ENTRY_COST * SAFE_JACKPOT_SHARE)
        await db.safe_game.update_one({}, {"$inc": {"jackpot": jackpot_contribution, "total_attempts": 1}})

        if not is_admin:
            await db.safe_daily.update_one(
                {"user_id": user["id"], "date": _today_str()},
                {"$inc": {"attempts_used": 1}},
            )

        cracked = req.numbers == combo
        correct_positions = sum(1 for a, b in zip(req.numbers, combo) if a == b)

        await db.safe_guesses.insert_one({
            "user_id": user["id"],
            "username": user.get("username", "?"),
            "guess": req.numbers,
            "guessed_at": now,
            "correct": cracked,
        })

        if cracked:
            fresh = await db.safe_game.find_one({})
            jackpot_amount = fresh.get("jackpot", SAFE_JACKPOT_SEED)
            await db.users.update_one({"id": user["id"]}, {"$inc": {"money": jackpot_amount}})
            new_combo = [random.randint(SAFE_MIN, SAFE_MAX) for _ in range(SAFE_DIGITS)]
            await db.safe_game.update_one(
                {},
                {"$set": {
                    "combination": new_combo,
                    "jackpot": SAFE_JACKPOT_SEED,
                    "total_attempts": 0,
                    "last_winner_username": user.get("username", "?"),
                    "last_won_at": now,
                }},
            )
            return {
                "cracked": True,
                "correct_positions": SAFE_DIGITS,
                "jackpot_won": jackpot_amount,
                "message": f"YOU CRACKED THE SAFE! ${jackpot_amount:,} is yours!",
            }

        fresh = await db.safe_game.find_one({})
        clues = _generate_clues(fresh["combination"], fresh.get("total_attempts", 0))

        # Refresh daily to get updated count
        if not is_admin:
            daily = await _get_daily(user["id"])
            attempts_used = daily.get("attempts_used", 0)
            bonus_purchased = daily.get("bonus_purchased", False)
            attempts_limit = FREE_DAILY_ATTEMPTS + (BONUS_ATTEMPTS if bonus_purchased else 0)
            attempts_remaining = max(0, attempts_limit - attempts_used)
        else:
            attempts_remaining = None

        # Only sometimes reveal how many digits were in the correct position (randomly, not every attempt)
        show_position_hint = random.random() < 0.5
        message = (
            f"Wrong combination. {correct_positions} number{'s' if correct_positions != 1 else ''} in the correct position."
            if show_position_hint
            else "Wrong combination."
        )
        return {
            "cracked": False,
            "correct_positions": correct_positions if show_position_hint else None,
            "clues": clues,
            "message": message,
            "attempts_remaining": attempts_remaining,
        }

    @router.post("/crack-safe/buy-attempts")
    async def crack_safe_buy_attempts(user: dict = Depends(get_current_user)):
        if _is_admin(user):
            raise HTTPException(status_code=400, detail="Admins have unlimited attempts.")

        daily = await _get_daily(user["id"])
        if daily.get("bonus_purchased"):
            raise HTTPException(status_code=400, detail="You have already purchased extra attempts today.")

        if user.get("money", 0) < BONUS_ATTEMPTS_COST:
            raise HTTPException(status_code=400, detail=f"You need ${BONUS_ATTEMPTS_COST:,} to purchase extra attempts.")

        await db.users.update_one({"id": user["id"]}, {"$inc": {"money": -BONUS_ATTEMPTS_COST}})
        await db.safe_daily.update_one(
            {"user_id": user["id"], "date": _today_str()},
            {"$set": {"bonus_purchased": True}},
        )
        return {
            "success": True,
            "message": f"You purchased {BONUS_ATTEMPTS} extra attempts for ${BONUS_ATTEMPTS_COST:,}!",
            "bonus_attempts": BONUS_ATTEMPTS,
        }
